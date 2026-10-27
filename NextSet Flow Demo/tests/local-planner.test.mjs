import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { planWorkoutLocally, localModelInfo } from '../dist/local-planner.js';
import { classifyText } from '../dist/trained-classifier.js';
import { TRAINED_MODEL } from '../dist/trained-model.js';
import { extractWorkoutDetails, parseWorkoutRequest, validateIntent } from '../dist/intent.js';

test('a trained English classification becomes a validated schedulable intent', () => {
  const result = planWorkoutLocally('I want to train legs.');
  assert.equal(result.ok, true);
  assert.equal(result.intent.focus, 'legs');
  assert.equal(result.intent.source, 'trained-local-classifier');
  assert.deepEqual(result.classification, classifyText('I want to train legs.', TRAINED_MODEL));
  assert.equal(result.intent.minutes, 30);
  assert.match(result.warnings[0], /No duration/);
});

test('learned vocabulary can plan a request the legacy focus keyword parser cannot', () => {
  const text = 'Let us work my lower limbs today.';
  assert.equal(parseWorkoutRequest(text).ok, false);
  const result = planWorkoutLocally(text);
  assert.equal(result.ok, true);
  assert.equal(result.intent.focus, 'legs');
  assert.equal(result.classification.topLabel, 'legs');
  assert.equal(result.needsFocusConfirmation, false);
});

test('uncertain Chinese input requests confirmation instead of silently accepting keyword focus', () => {
  const text = '我有半小时，想练腿，尽量用固定器械，不想排队。';
  assert.equal(parseWorkoutRequest(text).intent.focus, 'legs');
  const result = planWorkoutLocally(text);
  assert.equal(result.ok, false);
  assert.equal(result.intent, undefined);
  assert.equal(result.needsFocusConfirmation, true);
  assert.equal(result.classification.label, 'clarify');
  assert.equal(result.classification.topLabel, 'legs');
  assert.equal(result.details.minutes, 30);
  assert.deepEqual(result.details.preferences, { avoidWaiting: true, preferMachines: true });
});

test('explicit confirmation is attributed to the user and preserves extracted constraints', () => {
  const text = '我有半小时，想练腿，尽量用固定器械，不想排队。';
  const result = planWorkoutLocally(text, { confirmedFocus: 'legs' });
  assert.equal(result.ok, true);
  assert.equal(result.intent.focus, 'legs');
  assert.equal(result.intent.minutes, 30);
  assert.equal(result.intent.source, 'user-confirmed-local-classifier');
  assert.equal(result.classification.label, 'clarify');
  assert.equal(result.needsFocusConfirmation, false);
});

test('scope and medical guard cannot be bypassed by focus confirmation', () => {
  const diet = planWorkoutLocally('I need help with my diet.', { confirmedFocus: 'legs' });
  assert.equal(diet.classification.label, 'unsupported');
  assert.equal(diet.ok, false);
  assert.equal(diet.needsFocusConfirmation, false);
  for (const text of ['Legs 30 minutes with knee pain', '膝盖疼痛，二十分钟腿部训练', 'Recovering from injury, train upper body']) {
    const result = planWorkoutLocally(text, { confirmedFocus: 'upper' });
    assert.equal(result.ok, false);
    assert.equal(result.intent, undefined);
    assert.equal(result.needsFocusConfirmation, false);
    assert.match(result.clarification, /pain, injury, or medical/);
  }
});

test('invalid time, unsupported experience and invalid choices do not create coerced plans', () => {
  for (const text of ['Legs for two hours', '腿部三分钟', 'Advanced legs for twenty minutes']) {
    const result = planWorkoutLocally(text, { confirmedFocus: 'legs' });
    assert.equal(result.ok, false);
    assert.equal(result.intent, undefined);
    assert.equal(result.needsFocusConfirmation, false);
  }
  assert.equal(planWorkoutLocally('I want to train legs.', { confirmedFocus: 'deadlift' }).ok, false);
});

test('field extraction understands written Chinese/English time without choosing focus', () => {
  for (const [text, minutes] of [
    ['今天不练腿，想做上半身训练。我有二十分钟。', 20],
    ['三十分钟，不想排队', 30],
    ['I have twenty minutes', 20],
    ['Forty-five minutes, mostly machines', 45],
    ['One hour fifteen minutes', 75],
    ['半小时再加十五分钟', 45],
    ['一个半小时', 90],
    ['４０ minutes', 40],
  ]) {
    const result = extractWorkoutDetails(text);
    assert.equal(result.ok, true, text);
    assert.equal(result.details.minutes, minutes, text);
    assert.equal(result.warnings.length, 0, text);
    assert.equal(Object.hasOwn(result.details, 'focus'), false);
  }
});

test('field extraction preserves exercise exclusions and normalizes Unicode blank input', () => {
  const fields = extractWorkoutDetails('Twenty minutes, no dumbbell presses, mostly machines, avoid queues.');
  assert.equal(fields.details.minutes, 20);
  assert.deepEqual(fields.details.excludedExercises, ['dumbbell_press']);
  assert.deepEqual(fields.details.preferences, { avoidWaiting: true, preferMachines: true });
  assert.equal(planWorkoutLocally('\u0085\ufeff', { confirmedFocus: 'legs' }).ok, false);
  assert.equal(planWorkoutLocally('x'.repeat(1201), { confirmedFocus: 'legs' }).ok, false);
});

test('planning is synchronous and makes no external fetch calls', () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('Unexpected network request'); };
  try {
    const result = planWorkoutLocally('Push day for 25 minutes.');
    assert.equal(result instanceof Promise, false);
    assert.equal(result.ok, true);
    assert.equal(result.intent.focus, 'push');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('deployed model/runtime are the exact frozen standalone artifacts and keep original thresholds', async () => {
  const [sourceModel, sourceRuntime, copiedRuntime, selectionText] = await Promise.all([
    readFile(new URL('../../NextSet Flow Intent Model/model/model.json', import.meta.url)),
    readFile(new URL('../../NextSet Flow Intent Model/runtime/classifier.js', import.meta.url)),
    readFile(new URL('../dist/trained-classifier.js', import.meta.url)),
    readFile(new URL('../../NextSet Flow Intent Model/model/selection.json', import.meta.url), 'utf8'),
  ]);
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const selection = JSON.parse(selectionText);
  assert.equal(localModelInfo.modelSHA256, selection.modelSHA256);
  assert.equal(sha(sourceModel), selection.modelSHA256);
  assert.equal(sha(sourceRuntime), sha(copiedRuntime));
  assert.equal(localModelInfo.runtimeSHA256, sha(copiedRuntime));
  assert.deepEqual(TRAINED_MODEL, JSON.parse(sourceModel));
  assert.deepEqual(TRAINED_MODEL.abstention, { minConfidence: 0.5, minMargin: 0.05, minKnownFraction: 0.15 });
  assert.equal(localModelInfo.evaluation.rows, 105);
  assert.equal(localModelInfo.evaluation.rawAccuracy, 76 / 105);
});

test('validator accepts trusted local provenance but cannot be spoofed by payload source', () => {
  const payload = { focus: 'legs', minutes: 30, experience: 'Beginner', excludedExercises: [], preferences: { avoidWaiting: false, preferMachines: false }, summary: 'Legs', source: 'trained-local-classifier' };
  assert.equal(validateIntent(payload).intent.source, 'local-demo-parser');
  assert.equal(validateIntent(payload, 'trained-local-classifier').intent.source, 'trained-local-classifier');
  assert.equal(validateIntent(payload, 'user-confirmed-local-classifier').intent.source, 'user-confirmed-local-classifier');
  assert.equal(validateIntent(payload, 'made-up-model').ok, false);
});
