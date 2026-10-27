import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, dispatch, getRecommendations, getMetrics, getValidationSnapshot, DEMO_RULES } from '../dist/engine.js';

const user = (state, id) => state.users.find((entry) => entry.id === id);
const station = (state, id) => state.stations.find((entry) => entry.id === id);

test('peak scenario begins with Neeka waiting for the planned leg press', () => {
  const state = createInitialState();
  assert.equal(user(state, 'neeka').currentRecommendation.stationId, 'leg-press');
  assert.equal(user(state, 'neeka').currentRecommendation.waitSeconds, 90);
  assert.equal(user(state, 'steven').currentStationId, 'leg-press');
  assert.equal(state.stations.length, 12);
  assert.equal(state.users.length, 4);
});

test('an extended rest reroutes Neeka without interrupting Steven or Ben', () => {
  const original = createInitialState();
  const state = dispatch(original, { type: 'EXTEND', stationId: 'leg-press', seconds: 180 });
  assert.equal(station(original, 'leg-press').releaseAt, 90, 'dispatcher must not mutate old state');
  assert.equal(station(state, 'leg-press').releaseAt, 270);
  assert.equal(user(state, 'neeka').currentRecommendation.stationId, 'hack-squat');
  assert.equal(user(state, 'steven').currentStationId, 'leg-press');
  assert.equal(user(state, 'ben').currentStationId, 'cable-station');
  assert.equal(state.stats.reroutes, 1);
  assert.ok(state.events.some((event) => event.type === 'reroute' && event.userIds.includes('neeka')));
});

test('accepting a reroute occupies exactly one station and releases the advisory allocation', () => {
  let state = dispatch(createInitialState(), { type: 'EXTEND', stationId: 'leg-press', seconds: 180 });
  state = dispatch(state, { type: 'ACCEPT', userId: 'neeka', stationId: 'hack-squat' });
  assert.equal(station(state, 'hack-squat').occupantId, 'neeka');
  assert.equal(user(state, 'neeka').currentStationId, 'hack-squat');
  assert.equal(user(state, 'neeka').activeExerciseId, 'hack_squat');
  assert.ok(!state.assignments.some((assignment) => assignment.userId === 'neeka'));
  const secondAccept = dispatch(state, { type: 'ACCEPT', userId: 'neeka', stationId: 'goblet-zone' });
  assert.equal(station(secondAccept, 'goblet-zone').occupantId, null);
  assert.equal(secondAccept.stats.rejectedActions, 1);
});

test('finishing an alternative completes the original plan item and advances the route', () => {
  let state = dispatch(createInitialState(), { type: 'EXTEND', stationId: 'leg-press', seconds: 180 });
  state = dispatch(state, { type: 'ACCEPT', userId: 'neeka', stationId: 'hack-squat' });
  state = dispatch(state, { type: 'FINISH', stationId: 'hack-squat' });
  assert.equal(station(state, 'hack-squat').state, 'free');
  assert.equal(user(state, 'neeka').planned[0], 'leg_curl');
  assert.equal(user(state, 'neeka').completed[0].exerciseId, 'hack_squat');
  assert.equal(user(state, 'neeka').currentRecommendation.stationId, 'leg-curl');
});

test('predicted completion never auto-frees equipment', () => {
  let state = dispatch(createInitialState(), { type: 'TICK', seconds: 90 });
  assert.equal(station(state, 'leg-press').state, 'occupied');
  assert.equal(station(state, 'leg-press').occupantId, 'steven');
  state = dispatch(state, { type: 'TICK', seconds: 61 });
  assert.equal(station(state, 'leg-press').state, 'unknown');
  assert.equal(station(state, 'leg-press').occupantId, 'steven');
  assert.equal(user(state, 'steven').currentStationId, 'leg-press');
  assert.ok(!state.assignments.some((assignment) => assignment.stationId === 'leg-press'));
});

test('fresh occupant confirmation restores a stale station without forcing a finish', () => {
  let state = dispatch(createInitialState(), { type: 'TICK', seconds: 151 });
  state = dispatch(state, { type: 'EXTEND', stationId: 'leg-press', seconds: 120 });
  assert.equal(station(state, 'leg-press').state, 'occupied');
  assert.equal(station(state, 'leg-press').releaseAt, 271);
});

test('unknown and broken stations never become candidates', () => {
  const state = createInitialState('uncertain');
  for (const member of state.users) {
    for (const option of getRecommendations(state, member.id)) {
      assert.ok(!['unknown', 'unavailable'].includes(station(state, option.stationId).state));
      assert.ok(DEMO_RULES[option.targetExerciseId].some(([id]) => id === option.exerciseId));
    }
  }
});

test('global allocation never recommends the same station to two waiting members', () => {
  let state = createInitialState('quiet');
  state = dispatch(state, { type: 'FINISH', stationId: 'leg-press' });
  state = dispatch(state, { type: 'FINISH', stationId: 'cable-station' });
  state = dispatch(state, { type: 'SET_PROFILE', userId: 'steven', changes: { planned: ['leg_press'] } });
  state = dispatch(state, { type: 'SET_PROFILE', userId: 'ben', changes: { planned: ['leg_press'] } });
  const allocated = state.assignments.map((assignment) => assignment.stationId);
  assert.equal(new Set(allocated).size, allocated.length);
  assert.equal(getValidationSnapshot(state).allocationConflicts.length, 0);
});

test('manual occupancy rechecks advisory holds and prevents double booking', () => {
  let state = dispatch(createInitialState(), { type: 'EXTEND', stationId: 'leg-press', seconds: 180 });
  state = dispatch(state, { type: 'SET_STATUS', stationId: 'hack-squat', status: 'occupied', durationSeconds: 600 });
  assert.notEqual(user(state, 'neeka').currentRecommendation.stationId, 'hack-squat');
  state = dispatch(state, { type: 'ACCEPT', userId: 'neeka', stationId: 'hack-squat' });
  assert.notEqual(station(state, 'hack-squat').occupantId, 'neeka');
});

test('very short sessions return no infeasible option', () => {
  const state = dispatch(createInitialState(), { type: 'SET_PROFILE', userId: 'neeka', changes: { remainingSeconds: 30 } });
  assert.equal(getRecommendations(state, 'neeka').length, 0);
  assert.equal(user(state, 'neeka').currentRecommendation, null);
});

test('declining a suggestion temporarily excludes it and returns another rule-approved option', () => {
  const original = createInitialState();
  const state = dispatch(original, { type: 'DECLINE', userId: 'neeka' });
  assert.notEqual(user(state, 'neeka').currentRecommendation.stationId, 'leg-press');
  assert.equal(state.stats.declined, 1);
  assert.ok(getRecommendations(state, 'neeka').every((option) => option.stationId !== 'leg-press'));
});

test('minor ticks preserve stable routes and history stays bounded', () => {
  let state = createInitialState();
  const initialId = user(state, 'zaynab').currentRecommendation.stationId;
  state = dispatch(state, { type: 'TICK', seconds: 15 });
  assert.equal(user(state, 'zaynab').currentRecommendation.stationId, initialId);
  assert.equal(state.stats.reroutes, 0);
  for (let index = 0; index < 100; index += 1) state = dispatch(state, { type: 'EXTEND', stationId: 'leg-press', seconds: 15 });
  assert.equal(state.events.length, 80);
  assert.ok(state.eventCounter > 80);
  assert.ok(getMetrics(state).extensions === 100);
});

test('maintenance interruption requeues the active user without marking work complete', () => {
  const state = dispatch(createInitialState(), { type: 'SET_STATUS', stationId: 'leg-press', status: 'unavailable' });
  assert.equal(user(state, 'steven').currentStationId, null);
  assert.equal(user(state, 'steven').completed.length, 0);
  assert.equal(user(state, 'steven').planned[0], 'leg_press');
  assert.equal(station(state, 'leg-press').occupantId, null);
  assert.equal(station(state, 'leg-press').state, 'unavailable');
  assert.equal(getValidationSnapshot(state).allocationConflicts.length, 0);
});

test('reset reliably restores the selected scenario', () => {
  const state = dispatch(dispatch(createInitialState(), { type: 'TICK', seconds: 100 }), { type: 'RESET', scenario: 'quiet' });
  assert.equal(state.now, 0);
  assert.equal(state.scenario, 'quiet');
  assert.equal(station(state, 'chest-press').state, 'free');
});

test('live availability validation derives its pass from transition provenance', () => {
  let state = dispatch(createInitialState(), { type: 'TICK', seconds: 151 });
  let snapshot = getValidationSnapshot(state);
  assert.equal(snapshot.checks.find((check) => check.id === 'confirmation').passed, true);
  assert.ok(state.availabilityAudit.some((transition) => transition.stationId === 'leg-press' && transition.to === 'unknown' && transition.origin === 'time-estimate'));
  state = dispatch(state, { type: 'REPORT_FREE', stationId: 'leg-press' });
  snapshot = getValidationSnapshot(state);
  assert.equal(snapshot.checks.find((check) => check.id === 'confirmation').passed, true);
  assert.equal(station(state, 'leg-press').lastStateChange.origin, 'staff-confirmation');
  const tampered = structuredClone(state);
  station(tampered, 'leg-press').lastStateChange.origin = 'time-estimate';
  assert.equal(getValidationSnapshot(tampered).checks.find((check) => check.id === 'confirmation').passed, false);
});

test('audited timeout-to-free transitions fail even if current stations are valid', () => {
  const state = createInitialState();
  state.availabilityAudit.push({ stationId: 'leg-press', at: 90, from: 'occupied', to: 'free', origin: 'time-estimate' });
  const snapshot = getValidationSnapshot(state);
  assert.equal(snapshot.checks.find((check) => check.id === 'confirmation').passed, false);
  assert.equal(snapshot.confirmationEvidence.unsupportedFreeTransitions.length, 1);
});
