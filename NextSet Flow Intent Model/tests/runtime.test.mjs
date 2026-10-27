import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyText, normalize } from '../runtime/classifier.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = JSON.parse(await readFile(resolve(root, 'model/model.json'), 'utf8'));
const python = process.env.NEXTSET_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const tolerance = 1e-7;

// Independently authored runtime probes. These compare implementations and input
// boundaries; they are not held-out evidence of classification accuracy.
const probes = [
  'Please make today a lower-body session, with machines if possible.',
  'I would like a general upper-body workout before I leave.',
  'A short whole-body session would suit me today.',
  'Today is push day: chest, shoulders and triceps.',
  'Can this be a pull session for my back and biceps?',
  '今天安排腿部训练，器械优先，少排队。',
  '不是练腿，今天我要练上半身。',
  '我想全身都活动一下，时间不多。',
  '今天做 pull day，主要是背部和二头。',
  'I cannot choose between legs and upper body yet.',
  'I want a yoga-only programme for this afternoon.',
  'I need a session adapted to my recent shoulder surgery.',
  '  ＬＥＧＳ ＴＯＤＡＹ, PLEASE.  ',
  '\u0085\uFEFF\tLEGS\u00a0only\u2028today\u0085',
  '\u001clegs\u001donly\u001etoday\u001f',
  'Leg day 🏋️‍♀️ — fewer queues please! 💪',
  '',
  '\u0085\uFEFF \t\n\r',
  'legs '.repeat(240),
  'legs '.repeat(240) + 'x',
];

const pythonCode = `
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'runtime'))
from classifier import load_model, classify_text, normalize
model = load_model(Path.cwd() / 'model' / 'model.json')
probes = json.load(sys.stdin)
rows = [{'normalized': normalize(text), 'result': classify_text(text, model)} for text in probes]
print(json.dumps(rows, ensure_ascii=True, allow_nan=False))
`;
const pythonRows = JSON.parse(execFileSync(python, ['-c', pythonCode], {
  cwd: root,
  input: JSON.stringify(probes),
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  maxBuffer: 2 * 1024 * 1024,
}));
const close = (actual, expected, context) => assert.ok(Math.abs(actual - expected) <= tolerance, `${context}: ${actual} differs from ${expected}`);

test('JavaScript and Python normalize all 20 independent Unicode and boundary probes identically', () => {
  assert.equal(probes.length, 20);
  assert.equal(pythonRows.length, probes.length);
  probes.forEach((text, index) => assert.equal(normalize(text), pythonRows[index].normalized, `probe ${index + 1}`));
  assert.equal(normalize('  ＬＥＧＳ \t TODAY  '), 'legs today');
});

test('portable runtimes agree on decisions, confidence and every class score within 1e-7', () => {
  probes.forEach((text, index) => {
    const js = classifyText(text, model), py = pythonRows[index].result;
    assert.equal(js.label, py.label, `decision on probe ${index + 1}`);
    assert.equal(js.topLabel, py.topLabel, `top label on probe ${index + 1}`);
    assert.equal(js.needsClarification, py.needsClarification, `clarification on probe ${index + 1}`);
    assert.equal(js.reason, py.reason, `reason on probe ${index + 1}`);
    close(js.confidence, py.confidence, `confidence on probe ${index + 1}`);
    close(js.margin, py.margin, `margin on probe ${index + 1}`);
    close(js.knownFeatureFraction, py.knownFeatureFraction, `known feature fraction on probe ${index + 1}`);
    assert.equal(js.candidates.length, py.candidates.length);
    js.candidates.forEach((candidate, candidateIndex) => {
      assert.equal(candidate.label, py.candidates[candidateIndex].label, `candidate order on probe ${index + 1}`);
      close(candidate.probability, py.candidates[candidateIndex].probability, `${candidate.label} score on probe ${index + 1}`);
    });
  });
});

test('learned score distributions are finite, normalized, ordered and explicitly uncalibrated', () => {
  for (const text of probes) {
    const result = classifyText(text, model);
    assert.equal(result.source, 'trained-local-classifier');
    assert.equal(result.scoreType, 'uncalibrated-softmax');
    if (!result.candidates.length) continue;
    assert.equal(result.candidates.length, model.labels.length);
    assert.equal(new Set(result.candidates.map(candidate => candidate.label)).size, model.labels.length);
    close(result.candidates.reduce((sum, candidate) => sum + candidate.probability, 0), 1, 'probability sum');
    result.candidates.forEach((candidate, index) => {
      assert.ok(Number.isFinite(candidate.probability));
      assert.ok(candidate.probability >= 0 && candidate.probability <= 1);
      if (index) assert.ok(result.candidates[index - 1].probability >= candidate.probability);
    });
    close(result.confidence, result.candidates[0].probability, 'reported confidence');
    close(result.margin, result.candidates[0].probability - result.candidates[1].probability, 'reported margin');
  }
});

test('blank or overlong text asks for clarification without pretending a model decision', () => {
  for (const text of ['', ' \t\n', '\u0085\uFEFF \t', 'legs '.repeat(240) + 'x', '💪'.repeat(1201)]) {
    const result = classifyText(text, model);
    assert.equal(result.label, 'clarify');
    assert.equal(result.topLabel, null);
    assert.equal(result.needsClarification, true);
    assert.equal(result.confidence, 0);
    assert.deepEqual(result.candidates, []);
  }
  for (const text of ['legs '.repeat(240), '💪'.repeat(1200)]) {
    const result = classifyText(text, model);
    assert.equal(result.candidates.length, model.labels.length, 'exactly 1,200 Unicode code points reach the model');
  }
});

test('non-string input is rejected without throwing', () => {
  for (const value of [null, undefined, 3, {}, [], false]) {
    const result = classifyText(value, model);
    assert.equal(result.label, 'clarify');
    assert.equal(result.topLabel, null);
    assert.equal(result.needsClarification, true);
  }
});

test('inference follows numerical weights rather than an encoded focus keyword', () => {
  const toy = {
    format: 'nextset-tfidf-logreg-v1',
    labels: ['legs', 'upper'],
    blocks: [{ analyzer: 'word', ngramRange: [1, 1], vocabulary: ['sprocket'], idf: [1], weight: 1 }],
    coefficients: [[3], [-3]],
    intercept: [0, 0],
    abstention: { minKnownFraction: 0, minConfidence: 0, minMargin: 0 },
  };
  const first = classifyText('sprocket', toy);
  assert.equal(first.label, 'legs');
  assert.ok(first.confidence > 0.99);
  toy.coefficients = [[-3], [3]];
  const changed = classifyText('sprocket', toy);
  assert.equal(changed.label, 'upper');
  assert.ok(changed.confidence > 0.99);
});
