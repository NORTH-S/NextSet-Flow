import { createInitialState, dispatch, getRecommendations, EXERCISES, DEMO_RULES } from './engine.js';

// Session forecasts and a repeatable, synthetic gym-floor simulation. Forecast
// release times are never written back as confirmed free equipment states.
const copy = (value) => JSON.parse(JSON.stringify(value));
const member = (state, id = 'neeka') => state.users.find((user) => user.id === id);
const machine = (state, id) => state.stations.find((station) => station.id === id);
const active = (state, user) => Boolean(user?.currentStationId && machine(state, user.currentStationId)?.occupantId === user.id);
const ENTRANCE = { x: 50, y: 95 };
const PLANS = {
  legs: ['leg_press', 'leg_curl', 'leg_extension'],
  upper: ['chest_press', 'seated_row', 'lat_pulldown'],
  full: ['leg_press', 'chest_press', 'seated_row'],
  push: ['chest_press', 'shoulder_press', 'cable_chest_press'],
  pull: ['seated_row', 'lat_pulldown', 'cable_row'],
};
const GOALS = { legs: 'Lower-body strength', upper: 'Upper-body strength', full: 'Full-body strength', push: 'Push session', pull: 'Pull session' };

function normaliseIntent(value = {}) {
  return {
    ...value,
    focus: Object.hasOwn(PLANS, value.focus) ? value.focus : 'legs',
    minutes: Math.max(5, Math.min(90, Math.round(Number(value.minutes) || 25))),
    experience: value.experience === 'Beginner' ? 'Beginner' : 'Intermediate',
    excludedExercises: Array.isArray(value.excludedExercises) ? value.excludedExercises.filter((id) => EXERCISES[id]) : [],
    preferences: { avoidWaiting: Boolean(value.preferences?.avoidWaiting), preferMachines: Boolean(value.preferences?.preferMachines) },
  };
}

/** Routes through the walkways between equipment rows, in floor coordinates. */
export function buildAislePath(from = ENTRANCE, to = ENTRANCE) {
  const origin = { x: from.x, y: from.y };
  const target = { x: to.x, y: to.y };
  const rowAisle = (p) => p.y < 30 ? 36 : p.y < 60 ? 64 : 92;
  const fromY = rowAisle(origin);
  const toY = rowAisle(target);
  const aisle = [54, 30, 77].sort((a, b) => Math.abs(origin.x - a) + Math.abs(target.x - a) - Math.abs(origin.x - b) - Math.abs(target.x - b))[0];
  const points = [origin, { x: origin.x, y: fromY }, { x: aisle, y: fromY }, { x: aisle, y: toY }, { x: target.x, y: toY }, target];
  return points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

const pathLength = (points) => points.reduce((total, point, index) => index ? total + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : total, 0);
const walkTime = (from, to) => Math.max(5, Math.ceil(pathLength(buildAislePath(from, to)) / 3));

function allowedPlan(intent, exclusions) {
  return PLANS[intent.focus].filter((target) => (DEMO_RULES[target] || []).some(([id]) => !exclusions.includes(id)));
}

export function createPlanState(rawIntent = {}) {
  const intent = normaliseIntent(rawIntent);
  let state = createInitialState('peak');
  // This scenario starts with an explicit synthetic staff confirmation, allowing
  // the third lower-body movement to be included in the walkthrough.
  state = dispatch(state, { type: 'REPORT_FREE', stationId: 'leg-extension' });
  const exclusions = [...new Set([...intent.excludedExercises, ...(intent.preferences.preferMachines ? ['goblet_squat', 'dumbbell_press'] : [])])];
  state = dispatch(state, { type: 'SET_PROFILE', userId: 'neeka', changes: {
    goal: GOALS[intent.focus], experience: intent.experience,
    remainingMinutes: intent.minutes, planned: allowedPlan(intent, exclusions), excludedExercises: exclusions,
  } });
  const user = member(state);
  user.position = { ...ENTRANCE };
  state.intent = intent;
  // Retain the protagonist id used by the underlying scheduling engine.
  state.metadata.sessionForecast = true;
  return dispatch(state, { type: 'REPLAN' });
}

function forecastOption(state, user, target, cursor, origin, busyUntil = {}) {
  const options = [];
  for (const [exerciseId, suitability] of DEMO_RULES[target] || []) {
    if (user.excludedExercises?.includes(exerciseId)) continue;
    for (const station of state.stations) {
      if (!station.capabilities.includes(exerciseId) || ['unknown', 'unavailable'].includes(station.state)) continue;
      if (station.state === 'occupied' && (!Number.isFinite(station.releaseAt) || station.releaseAt <= state.now)) continue;
      const freeAt = Math.max(state.now, station.state === 'occupied' ? station.releaseAt : state.now, busyUntil[station.id] || 0);
      const walkSeconds = walkTime(origin, station);
      const waitSeconds = Math.max(0, freeAt - cursor - walkSeconds);
      const durationSeconds = EXERCISES[exerciseId].duration;
      options.push({ stationId: station.id, stationName: station.name, exerciseId, exerciseName: EXERCISES[exerciseId].name,
        targetExerciseId: target, isAlternative: exerciseId !== target, suitability,
        waitSeconds, walkSeconds, durationSeconds, from: { ...origin }, to: { x: station.x, y: station.y }, path: buildAislePath(origin, station),
        cost: waitSeconds + walkSeconds + (1 - suitability) * 120,
      });
    }
  }
  return options.sort((a, b) => a.cost - b.cost || a.stationId.localeCompare(b.stationId))[0] || null;
}

/**
 * A contingent whole-session forecast. First suggestion mirrors the live
 * allocator; later steps may reorder to use a suitable free station first.
 * This makes no future equipment reservation or availability guarantee.
 */
export function getPlanProjection(state, userId = 'neeka') {
  const user = member(state, userId);
  const empty = { steps: [], finishAt: state.now, remainingSeconds: 0, totalWaitSeconds: 0, routePoints: [], unplannedExercises: [], forecast: true };
  if (!user) return empty;
  let cursor = state.now;
  let origin = user.position || ENTRANCE;
  const deadline = state.now + user.remainingSeconds;
  const remaining = [...user.planned];
  const steps = [];
  const busyUntil = {};
  const unplannedExercises = [];
  const addStep = (option, status, originalIndex) => {
    const startAt = cursor + option.walkSeconds + option.waitSeconds;
    const endAt = startAt + option.durationSeconds;
    if (endAt > deadline) return false;
    steps.push({ ...option, id: `${userId}-${steps.length}-${option.targetExerciseId}`, status, startAt, endAt, originalIndex, forecast: status === 'forecast' });
    cursor = endAt;
    origin = option.to;
    busyUntil[option.stationId] = endAt;
    return true;
  };
  if (active(state, user)) {
    const station = machine(state, user.currentStationId);
    const endAt = Math.max(state.now, station.releaseAt || state.now);
    const exerciseId = user.activeExerciseId || remaining[0];
    const startAt = user.activeStartedAt ?? station.updatedAt ?? state.now;
    steps.push({ id: `${userId}-active-${exerciseId}`, stationId: station.id, stationName: station.name,
      exerciseId, exerciseName: EXERCISES[exerciseId]?.name || exerciseId, targetExerciseId: remaining.shift(),
      startAt, endAt, waitSeconds: 0, walkSeconds: 0, durationSeconds: Math.max(0, endAt - startAt),
      isAlternative: exerciseId !== user.planned[0], status: 'active', from: { x: station.x, y: station.y }, to: { x: station.x, y: station.y }, path: [{ x: station.x, y: station.y }], forecast: false,
    });
    cursor = endAt;
    origin = { x: station.x, y: station.y };
    busyUntil[station.id] = endAt;
  } else if (remaining.length && user.currentRecommendation) {
    const live = user.currentRecommendation;
    const station = machine(state, live.stationId);
    const walkSeconds = walkTime(origin, station);
    const option = { ...live, from: { ...origin }, to: { x: station.x, y: station.y }, path: buildAislePath(origin, station), walkSeconds,
      waitSeconds: Math.max(0, live.waitSeconds - walkSeconds) };
    const first = remaining.shift();
    if (!addStep(option, 'next', 0)) unplannedExercises.push(first);
  }
  while (remaining.length) {
    const choices = remaining.map((target, index) => {
      const option = forecastOption(state, user, target, cursor, origin, busyUntil);
      return option ? { ...option, originalIndex: index, adjustedCost: option.cost + index * 30 } : null;
    }).filter(Boolean).sort((a, b) => a.adjustedCost - b.adjustedCost);
    const choice = choices.find((option) => cursor + option.waitSeconds + option.walkSeconds + option.durationSeconds <= deadline);
    if (!choice) { unplannedExercises.push(...remaining); break; }
    remaining.splice(choice.originalIndex, 1);
    addStep(choice, 'forecast', choice.originalIndex);
  }
  return { steps, finishAt: cursor, remainingSeconds: Math.max(0, cursor - state.now),
    totalWaitSeconds: steps.reduce((total, step) => total + step.waitSeconds, 0),
    routePoints: steps.flatMap((step) => step.path), unplannedExercises, forecast: true,
    caveat: 'Later steps depend on predicted releases and can change. They are not reservations.',
  };
}

function pathPosition(path, ratio) {
  const length = pathLength(path);
  let remaining = Math.max(0, Math.min(1, ratio)) * length;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1], end = path[index];
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= segment) return { x: start.x + (end.x - start.x) * (segment ? remaining / segment : 0), y: start.y + (end.y - start.y) * (segment ? remaining / segment : 0) };
    remaining -= segment;
  }
  return { ...path[path.length - 1] };
}

function record(sim, type, title, message, before = null) {
  const event = { id: `sim-${sim.events.length + 1}`, at: sim.state.now, type, title, message,
    planBefore: before, planAfter: getPlanProjection(sim.state), };
  sim.events.push(event);
  sim.latestUpdate = event;
  sim.narration = message;
  return event;
}

function replanOrder(sim) {
  const state = sim.state;
  const user = member(state);
  if (active(state, user) || user.planned.length < 2) return;
  const current = user.currentRecommendation;
  // Do not disturb an immediately usable route or an acceptable short wait.
  if (current && current.waitSeconds <= (sim.intent.preferences.avoidWaiting ? 30 : 90)) return;
  const alternatives = user.planned.slice(1).map((target, index) => {
    const option = forecastOption(state, user, target, state.now, user.position);
    return option ? { target, index: index + 1, ...option } : null;
  }).filter(Boolean).sort((a, b) => a.cost - b.cost);
  const next = alternatives.find((option) => option.waitSeconds <= 15 && option.walkSeconds + option.durationSeconds <= user.remainingSeconds);
  if (!next) return;
  const planned = [...user.planned];
  planned.splice(next.index, 1);
  planned.unshift(next.target);
  sim.state = dispatch(state, { type: 'SET_PROFILE', userId: user.id, changes: { planned } });
}

export function createSimulation(rawIntent = {}) {
  const intent = normaliseIntent(rawIntent);
  const state = createPlanState(intent);
  const sim = {
    state, intent, elapsed: 0, phase: 'ready', events: [], narration: '', latestUpdate: null,
    completed: false, userPosition: { ...ENTRANCE }, journeys: [], scriptedEventsProcessed: [],
    firstStartedAt: null, firstStationId: null, blockedStationId: null,
    otherStarts: {}, durationSeconds: intent.minutes * 60,
  };
  record(sim, 'plan', 'Your session is ready', 'Your request becomes a timed workout and a route from the entrance. Press play to watch the floor respond.');
  return sim;
}

function queueJourney(sim, userId) {
  const user = member(sim.state, userId);
  if (!user || active(sim.state, user) || sim.journeys.some((journey) => journey.userId === userId)) return;
  const rec = user.currentRecommendation;
  const station = machine(sim.state, rec?.stationId);
  if (!rec || !station || station.state !== 'free' || rec.assignedTo || rec.waitSeconds > 0) return;
  const from = userId === 'neeka' ? sim.userPosition : user.position;
  const path = buildAislePath(from, station);
  sim.journeys.push({ userId, stationId: station.id, from: { ...from }, to: { x: station.x, y: station.y },
    startAt: sim.state.now, endAt: sim.state.now + Math.max(5, Math.ceil(pathLength(path) / 3)), path });
  if (userId === 'neeka') {
    sim.phase = 'walking';
    sim.narration = `Follow the highlighted walkway to ${station.name}. Your next station is checked again when you arrive.`;
  }
}

function processJourneys(sim) {
  const retained = [];
  for (const journey of sim.journeys) {
    const user = member(sim.state, journey.userId);
    const station = machine(sim.state, journey.stationId);
    const progress = (sim.state.now - journey.startAt) / Math.max(1, journey.endAt - journey.startAt);
    const position = pathPosition(journey.path, progress);
    user.position = position;
    if (journey.userId === 'neeka') sim.userPosition = position;
    if (progress < 1) {
      // A station may change while someone is walking. The route must change too.
      if (station.state !== 'free' || user.currentRecommendation?.stationId !== journey.stationId) {
        if (journey.userId === 'neeka') record(sim, 'reroute', 'Route refreshed', 'Availability changed while you were walking. Your route and next station have been updated.');
      } else retained.push(journey);
      continue;
    }
    const before = journey.userId === 'neeka' ? getPlanProjection(sim.state) : null;
    sim.state = dispatch(sim.state, { type: 'ACCEPT', userId: journey.userId, stationId: journey.stationId });
    const updated = member(sim.state, journey.userId);
    if (updated.currentStationId === journey.stationId) {
      updated.activeStartedAt = sim.state.now;
      if (journey.userId === 'neeka') {
        sim.userPosition = { ...journey.to };
        sim.phase = 'training';
        sim.firstStartedAt ??= sim.state.now;
        sim.firstStationId ??= journey.stationId;
        record(sim, 'start', 'You have arrived', `Start ${EXERCISES[updated.activeExerciseId]?.name || station.name}. The station now shows In use and your remaining route stays visible.`, before);
      } else sim.otherStarts[journey.userId] = (sim.otherStarts[journey.userId] || 0) + 1;
    }
  }
  sim.journeys = retained;
}

function scripted(sim, name, run) {
  if (sim.scriptedEventsProcessed.includes(name)) return;
  sim.scriptedEventsProcessed.push(name);
  run();
}

function oneSecond(sim) {
  // Synthetic sensor heartbeats reconfirm only stations already known free.
  // They do not turn predicted completion into an actual free state.
  if (sim.state.now % 30 === 0) {
    for (const station of sim.state.stations) if (station.state === 'free') station.updatedAt = sim.state.now;
  }
  sim.state = dispatch(sim.state, { type: 'TICK', seconds: 1 });
  sim.elapsed = sim.state.now;
  if (sim.elapsed >= 20) scripted(sim, 'other-overrun', () => {
    const before = getPlanProjection(sim.state);
    const desired = member(sim.state).currentRecommendation;
    const occupied = machine(sim.state, desired?.stationId) || sim.state.stations.find((station) => station.occupantId && station.occupantId !== 'neeka');
    const target = occupied?.occupantId ? occupied : sim.state.stations.find((station) => station.occupantId && station.occupantId !== 'neeka');
    if (target) {
      sim.state = dispatch(sim.state, { type: 'EXTEND', stationId: target.id, seconds: 180 });
      replanOrder(sim);
      const next = member(sim.state).currentRecommendation;
      record(sim, 'other-overrun', 'Another member needs longer', `${target.name} is now occupied for 3 minutes longer. ${next ? `Your next station is ${next.stationName}; the route and timing have been recalculated.` : 'Your remaining session has been recalculated.'}`, before);
    }
  });
  if (sim.firstStartedAt !== null && sim.elapsed >= sim.firstStartedAt + 90) scripted(sim, 'own-overrun', () => {
    const user = member(sim.state);
    if (!active(sim.state, user)) return;
    const before = getPlanProjection(sim.state);
    sim.state = dispatch(sim.state, { type: 'EXTEND', stationId: user.currentStationId, seconds: 90 });
    record(sim, 'own-overrun', 'Your rest runs 90 seconds longer', 'Your current exercise stays in place. Your finish estimate and later station timings are updated immediately, and the floor reallocates suggestions for other members.', before);
  });
  if (sim.firstStartedAt !== null && sim.elapsed >= sim.firstStartedAt + 150) scripted(sim, 'next-station-blocked', () => {
    const user = member(sim.state);
    const target = user.planned[1];
    const station = sim.state.stations.find((item) => item.capabilities.includes(target) && item.occupantId !== user.id);
    if (!station) return;
    const before = getPlanProjection(sim.state);
    if (station.occupantId) sim.state = dispatch(sim.state, { type: 'EXTEND', stationId: station.id, seconds: 480 });
    else sim.state = dispatch(sim.state, { type: 'SET_STATUS', stationId: station.id, status: 'occupied', durationSeconds: 480 });
    sim.blockedStationId = station.id;
    record(sim, 'blocked', 'Your next station becomes busy', `${station.name} has been taken by another member. Your current set continues; the remaining workout forecast is reordered where a suitable alternative step is available.`, before);
  });
  // Each is an explicit finish signal from a synthetic actor, never a prediction
  // silently expiring into free availability.
  for (const station of [...sim.state.stations]) {
    if (station.occupantId && station.state === 'occupied' && station.releaseAt <= sim.state.now) {
      const isYou = station.occupantId === 'neeka';
      const before = isYou ? getPlanProjection(sim.state) : null;
      sim.state = dispatch(sim.state, { type: 'FINISH', stationId: station.id });
      if (isYou) {
        member(sim.state).activeStartedAt = null;
        replanOrder(sim);
        record(sim, 'finish', 'Exercise completed', `You confirm finishing ${station.name}. Your next suggestion is refreshed using the current floor, and the station is now Free.`, before);
      }
    }
  }
  if (sim.elapsed >= 20) replanOrder(sim);
  processJourneys(sim);
  if (sim.elapsed >= 30) queueJourney(sim, 'neeka');
  // Additional actors each check in once, making the floor genuinely shared.
  if (sim.elapsed >= 12 && !sim.otherStarts.zaynab) queueJourney(sim, 'zaynab');
  if (sim.elapsed >= 185 && !sim.otherStarts.ben) queueJourney(sim, 'ben');
  if (sim.elapsed >= 270 && !sim.otherStarts.steven) queueJourney(sim, 'steven');
  const user = member(sim.state);
  if (active(sim.state, user)) sim.phase = 'training';
  else if (sim.journeys.some((journey) => journey.userId === user.id)) sim.phase = 'walking';
  else if (user.planned.length && user.remainingSeconds > 0) sim.phase = 'waiting';
  if ((!user.planned.length && !active(sim.state, user)) || user.remainingSeconds <= 0) {
    sim.completed = true;
    sim.phase = 'complete';
    record(sim, 'complete', user.planned.length ? 'Your time window is complete' : 'Workout complete', user.planned.length ? 'Your available time has ended. Any unfinished movements are shown as not fitted into this session.' : 'You completed the session while the route adapted to a longer queue, extra rest and an occupied next station.');
  }
}

/** Advance in one-second steps, making large and small playback ticks equivalent. */
export function advanceSimulation(previous, deltaSeconds = 1) {
  const sim = copy(previous);
  const seconds = Math.max(0, Math.min(7200, Math.floor(Number(deltaSeconds) || 0)));
  for (let index = 0; index < seconds && !sim.completed; index += 1) oneSecond(sim);
  return sim;
}

export const stepSimulation = advanceSimulation;
