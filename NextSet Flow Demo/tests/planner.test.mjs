import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, getValidationSnapshot } from '../dist/engine.js';
import { createPlanState, getPlanProjection, createSimulation, advanceSimulation, buildAislePath } from '../dist/planner.js';

const intent = { focus: 'legs', minutes: 25, experience: 'Intermediate', excludedExercises: [], preferences: { avoidWaiting: true, preferMachines: true } };
const user = (state) => state.users.find((entry) => entry.id === 'neeka');

test('request creates a leg session at the entrance without mutating the request', () => {
  const original = structuredClone(intent);
  const state = createPlanState(intent);
  assert.deepEqual(user(state).position, { x: 50, y: 95 });
  assert.deepEqual(user(state).planned, ['leg_press', 'leg_curl', 'leg_extension']);
  assert.deepEqual(intent, original);
  assert.ok(user(state).excludedExercises.includes('goblet_squat'));
});

test('whole-session forecast has timed steps, a route, and explicit forecast labels', () => {
  const state = createPlanState(intent);
  const before = structuredClone(state);
  const plan = getPlanProjection(state);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].status, 'next');
  assert.equal(plan.steps[1].forecast, true);
  assert.ok(plan.steps.every((step) => step.endAt > step.startAt && step.path.length));
  assert.ok(plan.steps.every((step, index) => !index || step.startAt >= plan.steps[index - 1].endAt));
  assert.deepEqual(state, before, 'projection must not make forecast availability real');
});

test('short time window omits movements that cannot fit', () => {
  const plan = getPlanProjection(createPlanState({ ...intent, minutes: 5 }));
  assert.ok(plan.unplannedExercises.length > 0);
  assert.ok(plan.steps.every((step) => step.endAt <= 300));
});

test('explicit exclusions are respected by projected alternatives', () => {
  const state = createPlanState({ ...intent, excludedExercises: ['leg_press', 'hack_squat', 'goblet_squat'] });
  const plan = getPlanProjection(state);
  assert.ok(!user(state).planned.includes('leg_press'));
  assert.ok(plan.steps.every((step) => !['leg_press', 'hack_squat', 'goblet_squat'].includes(step.exerciseId)));
});

test('unknown equipment never appears in the projection', () => {
  let state = createPlanState(intent);
  state = dispatch(state, { type: 'SET_STATUS', stationId: 'leg-curl', status: 'unknown' });
  const plan = getPlanProjection(state);
  assert.ok(!plan.steps.some((step) => step.stationId === 'leg-curl'));
  assert.ok(plan.unplannedExercises.includes('leg_curl'));
});

test('walkway path avoids crossing a middle equipment row', () => {
  const path = buildAislePath({ x: 50, y: 95 }, { x: 42, y: 22 });
  assert.deepEqual(path[0], { x: 50, y: 95 });
  assert.deepEqual(path.at(-1), { x: 42, y: 22 });
  assert.ok(path.some((point) => point.x === 54 && point.y === 36));
});

test('other member overrun triggers a real reassignment, leaving occupied stations occupied', () => {
  const original = createSimulation(intent);
  const next = advanceSimulation(original, 20);
  assert.equal(original.state.now, 0);
  assert.ok(next.events.some((event) => event.type === 'other-overrun'));
  assert.notEqual(user(next.state).currentRecommendation.stationId, 'leg-press');
  assert.equal(next.state.stations.find((station) => station.id === 'leg-press').occupantId, 'steven');
  assert.ok(next.state.stats.extensions > 0);
});

test('walk animation position progresses through the actual floor route', () => {
  const sim = advanceSimulation(createSimulation(intent), 35);
  assert.equal(sim.phase, 'walking');
  assert.notDeepEqual(sim.userPosition, { x: 50, y: 95 });
  assert.ok(sim.journeys.some((journey) => journey.userId === 'neeka' && journey.path.length > 2));
});

test('own extra rest extends the active station and overwrites later timing', () => {
  const sim = advanceSimulation(createSimulation(intent), 220);
  const event = sim.events.find((item) => item.type === 'own-overrun');
  assert.ok(event);
  assert.equal(user(sim.state).currentStationId, sim.firstStationId);
  assert.ok(event.planAfter.steps[0].endAt > event.planBefore.steps[0].endAt);
});

test('blocked next station changes the remaining order after current exercise finishes', () => {
  const sim = advanceSimulation(createSimulation(intent), 500);
  assert.ok(sim.events.some((item) => item.type === 'blocked'));
  const completed = user(sim.state).completed;
  assert.equal(completed[0].exerciseId, 'hack_squat');
  assert.equal(user(sim.state).activeExerciseId, 'leg_extension');
  assert.equal(sim.state.stations.find((station) => station.id === 'leg-curl').state, 'occupied');
});

test('simulation finishes through confirmed check-ins and finishes with no allocation conflicts', () => {
  const sim = advanceSimulation(createSimulation(intent), 1500);
  assert.equal(sim.completed, true);
  assert.equal(sim.phase, 'complete');
  assert.equal(user(sim.state).completed.length, 3);
  const validation = getValidationSnapshot(sim.state);
  assert.ok(validation.checks.every((check) => check.passed));
  assert.ok(sim.state.availabilityAudit.filter((transition) => transition.to === 'free').every((transition) => ['member-finish', 'staff-confirmation', 'operator-confirmation'].includes(transition.origin)));
});

test('playback is deterministic across large and small ticks', () => {
  const once = advanceSimulation(createSimulation(intent), 120);
  let many = createSimulation(intent);
  for (let index = 0; index < 12; index += 1) many = advanceSimulation(many, 10);
  assert.deepEqual(many, once);
});

test('lack of a live allocation is labelled as forecast rather than a ready next station', () => {
  const state = createPlanState(intent);
  user(state).currentRecommendation = null;
  const plan = getPlanProjection(state);
  assert.ok(plan.steps.every((step) => step.status === 'forecast' && step.forecast));
});

test('all supported training focuses complete through the shared-floor simulation', () => {
  for (const focus of ['legs', 'upper', 'full', 'push', 'pull']) {
    const sim = advanceSimulation(createSimulation({ ...intent, focus }), 1500);
    assert.equal(user(sim.state).planned.length, 0, focus);
    assert.equal(user(sim.state).completed.length, 3, focus);
    assert.ok(getValidationSnapshot(sim.state).checks.every((check) => check.passed), focus);
  }
});
