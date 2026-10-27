import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkoutRequest, validateIntent, samplePrompts } from '../dist/intent.js';

const valid = () => ({ focus: 'legs', minutes: 30, experience: 'Beginner', excludedExercises: [], preferences: { avoidWaiting: true, preferMachines: true }, summary: 'Leg day' });

test('English example captures useful planning constraints', () => {
  const result = parseWorkoutRequest(samplePrompts[0]);
  assert.equal(result.ok, true);
  assert.equal(result.intent.focus, 'legs');
  assert.equal(result.intent.minutes, 30);
  assert.equal(result.intent.preferences.avoidWaiting, true);
  assert.equal(result.intent.preferences.preferMachines, true);
  assert.equal(result.intent.source, 'local-demo-parser');
});

test('Chinese example understands half an hour and preferences', () => {
  const result = parseWorkoutRequest(samplePrompts[2]);
  assert.equal(result.ok, true);
  assert.equal(result.intent.minutes, 30);
  assert.equal(result.intent.focus, 'legs');
  assert.deepEqual(result.intent.preferences, { avoidWaiting: true, preferMachines: true });
});

test('exclusions preserve positive exercise mentions in separate clauses', () => {
  const result = parseWorkoutRequest('Upper body for 20 mins, no dumbbell presses, and seated rows are fine.');
  assert.equal(result.ok, true);
  assert.ok(result.intent.excludedExercises.includes('dumbbell_press'));
  assert.ok(!result.intent.excludedExercises.includes('goblet_squat'));
  assert.ok(!result.intent.excludedExercises.includes('seated_row'));
});

test('specific cable press exclusion does not exclude fixed chest machine', () => {
  const result = parseWorkoutRequest('Upper body 30 minutes, no cable chest press.');
  assert.ok(result.intent.excludedExercises.includes('cable_chest_press'));
  assert.ok(!result.intent.excludedExercises.includes('chest_press'));
});

test('squats and free weights exclusions expand only to known exercise ids', () => {
  const result = parseWorkoutRequest('Legs 30m, no squats, without free weights');
  assert.deepEqual(new Set(result.intent.excludedExercises), new Set(['hack_squat', 'goblet_squat', 'dumbbell_press']));
});

test('negative leg mention does not override upper body', () => {
  const result = parseWorkoutRequest('Not legs, upper body for half an hour');
  assert.equal(result.ok, true);
  assert.equal(result.intent.focus, 'upper');
  assert.equal(result.intent.minutes, 30);
  assert.equal(parseWorkoutRequest('今天不练腿，想练上半身，20分钟').intent.focus, 'upper');
  assert.equal(parseWorkoutRequest('Not a leg day, upper body for 20 minutes').intent.focus, 'upper');
});

test('time units combine and fractional hours work', () => {
  assert.equal(parseWorkoutRequest('full body 0.5h').intent.minutes, 30);
  assert.equal(parseWorkoutRequest('push day 1 hour 15 minutes').intent.minutes, 75);
  assert.equal(parseWorkoutRequest('全身训练一刻钟').intent.minutes, 15);
  assert.equal(parseWorkoutRequest('40-minute legs workout').intent.minutes, 40);
});

test('missing duration is explicit and unknown focus requests clarification', () => {
  const result = parseWorkoutRequest('Train legs');
  assert.equal(result.intent.minutes, 30);
  assert.match(result.warnings[0], /No duration/);
  assert.equal(parseWorkoutRequest('I want a good workout').ok, false);
  assert.equal(parseWorkoutRequest('Legs or upper body 30 minutes').ok, false);
  assert.equal(parseWorkoutRequest('').ok, false);
});

test('pain and injury require clarification, with no prescription returned', () => {
  for (const request of ['Legs 30 minutes with knee pain', 'I am recovering from injury, upper body 20m', '膝盖疼，练腿20分钟']) {
    const result = parseWorkoutRequest(request);
    assert.equal(result.ok, false);
    assert.equal(result.intent, undefined);
  }
  assert.equal(parseWorkoutRequest('Legs for 30 minutes, no injuries').ok, true);
});

test('out of range sessions and unsupported experience do not silently coerce', () => {
  assert.equal(parseWorkoutRequest('Legs for 2 hours').ok, false);
  assert.equal(parseWorkoutRequest('Legs 3 minutes').ok, false);
  assert.equal(parseWorkoutRequest('Advanced legs 30 minutes').ok, false);
});

test('offline input limit matches the 1,200-character UI and API boundary', () => {
  const prefix = 'Legs for 30 minutes. ';
  const request = prefix + 'x'.repeat(1200 - prefix.length);
  assert.equal(request.length, 1200);
  const accepted = parseWorkoutRequest(request);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.intent.focus, 'legs');
  assert.equal(accepted.intent.minutes, 30);
  const rejected = parseWorkoutRequest(request + 'x');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.intent, undefined);
  assert.match(rejected.clarification, /1,200 characters/);
});

test('schema validation rejects invented plans, ids and malformed preferences', () => {
  assert.equal(validateIntent({ ...valid(), plan: ['deadlift'] }).ok, false);
  assert.equal(validateIntent({ ...valid(), excludedExercises: ['deadlift'] }).ok, false);
  assert.equal(validateIntent({ ...valid(), preferences: { avoidWaiting: 'yes', preferMachines: true } }).ok, false);
  assert.equal(validateIntent({ ...valid(), minutes: '30' }).ok, false);
  assert.equal(validateIntent({ ...valid(), minutes: 30.5 }).ok, false);
  assert.equal(validateIntent({ ...valid(), summary: '<x>'.repeat(150) }).ok, false);
});

test('source is set only by caller and object is copied', () => {
  const payload = { ...valid(), source: 'openai', excludedExercises: ['leg_press', 'leg_press'] };
  const local = validateIntent(payload);
  const model = validateIntent(payload, 'openai');
  assert.equal(local.intent.source, 'local-demo-parser');
  assert.equal(model.intent.source, 'openai');
  assert.deepEqual(model.intent.excludedExercises, ['leg_press']);
  model.intent.preferences.avoidWaiting = false;
  assert.equal(payload.preferences.avoidWaiting, true);
  assert.equal(validateIntent(payload, 'untrusted').ok, false);
});
