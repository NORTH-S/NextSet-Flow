/*
 * NextSet Flow demonstration scheduler.
 * All people, state and timings are synthetic. Exercise relationships are
 * illustrative rules awaiting trainer review, not validated exercise advice.
 * This is deterministic scheduling logic, not a trained machine learning model.
 */

export const EXERCISES = {
  leg_press: { name: 'Leg press', movement: 'Knee dominant', duration: 300 },
  hack_squat: { name: 'Hack squat', movement: 'Knee dominant', duration: 300 },
  goblet_squat: { name: 'Goblet squat', movement: 'Knee dominant', duration: 240 },
  leg_curl: { name: 'Seated leg curl', movement: 'Knee flexion', duration: 240 },
  leg_extension: { name: 'Leg extension', movement: 'Knee extension', duration: 240 },
  chest_press: { name: 'Chest press', movement: 'Horizontal push', duration: 300 },
  dumbbell_press: { name: 'Dumbbell bench press', movement: 'Horizontal push', duration: 300 },
  cable_chest_press: { name: 'Cable chest press', movement: 'Horizontal push', duration: 300 },
  seated_row: { name: 'Seated row', movement: 'Horizontal pull', duration: 240 },
  cable_row: { name: 'Cable row', movement: 'Horizontal pull', duration: 240 },
  lat_pulldown: { name: 'Lat pulldown', movement: 'Vertical pull', duration: 240 },
  shoulder_press: { name: 'Shoulder press', movement: 'Vertical push', duration: 240 },
  treadmill_walk: { name: 'Treadmill walk', movement: 'Cardio', duration: 300 },
};

// Explicit relationships only. There is no generic muscle-name substitution.
export const DEMO_RULES = {
  leg_press: [['leg_press', 1], ['hack_squat', 0.92], ['goblet_squat', 0.86]],
  hack_squat: [['hack_squat', 1], ['leg_press', 0.94], ['goblet_squat', 0.86]],
  goblet_squat: [['goblet_squat', 1], ['leg_press', 0.9], ['hack_squat', 0.88]],
  leg_curl: [['leg_curl', 1]],
  leg_extension: [['leg_extension', 1]],
  chest_press: [['chest_press', 1], ['dumbbell_press', 0.93], ['cable_chest_press', 0.9]],
  dumbbell_press: [['dumbbell_press', 1], ['chest_press', 0.94], ['cable_chest_press', 0.9]],
  cable_chest_press: [['cable_chest_press', 1], ['chest_press', 0.94], ['dumbbell_press', 0.9]],
  seated_row: [['seated_row', 1], ['cable_row', 0.93]],
  cable_row: [['cable_row', 1], ['seated_row', 0.95]],
  lat_pulldown: [['lat_pulldown', 1]],
  shoulder_press: [['shoulder_press', 1]],
  treadmill_walk: [['treadmill_walk', 1]],
};

export const SCENARIOS = [
  { id: 'peak', name: 'Peak-time gym' },
  { id: 'quiet', name: 'Quieter floor' },
  { id: 'uncertain', name: 'Uncertain equipment data' },
];

const MAX_EVENTS = 80;
const GRACE_SECONDS = 60;
const FREE_STATE_TTL = 600;
const HOLD_SECONDS = 90;
const SWITCH_BONUS = 4;

const clone = (value) => JSON.parse(JSON.stringify(value));
const bound = (value, min, max) => Math.min(max, Math.max(min, value));
const findStation = (state, id) => state.stations.find((station) => station.id === id);
const findUser = (state, id) => state.users.find((user) => user.id === id);
const isActive = (state, user) => Boolean(user.currentStationId && findStation(state, user.currentStationId)?.occupantId === user.id);
const formatDuration = (seconds) => seconds < 60 ? `${Math.ceil(seconds)} sec` : `${Math.round(seconds / 60 * 10) / 10} min`;

function nextExercise(state, user) {
  if (!user || user.remainingSeconds <= 0) return null;
  return isActive(state, user) ? user.planned[1] || null : user.planned[0] || null;
}

function addEvent(state, type, message, userIds = [], details = {}) {
  state.eventCounter += 1;
  state.events.unshift({ id: state.eventCounter, at: state.now, time: state.now, type, message, userIds, ...details });
  state.events = state.events.slice(0, MAX_EVENTS);
}

function stationOptions(state, user) {
  const target = nextExercise(state, user);
  if (!target) return [];
  const relations = DEMO_RULES[target] || [];
  const origin = user.currentStationId ? findStation(state, user.currentStationId) : user.position;
  const old = user.currentRecommendation;
  const options = [];
  for (const [exerciseId, suitability] of relations) {
    if (user.excludedExercises?.includes(exerciseId)) continue;
    const exercise = EXERCISES[exerciseId];
    for (const station of state.stations) {
      if (!station.capabilities.includes(exerciseId)) continue;
      if (station.state === 'unknown' || station.state === 'unavailable') continue;
      if (station.occupantId === user.id) continue;
      if ((state.declined[user.id]?.[station.id] || 0) > state.now) continue;
      const waitSeconds = station.state === 'occupied' ? Math.max(0, station.releaseAt - state.now) : 0;
      const walkSeconds = Math.max(5, Math.round(Math.hypot(station.x - (origin?.x || 8), station.y - (origin?.y || 85)) / 3));
      const durationSeconds = exercise.duration;
      if (waitSeconds + walkSeconds + durationSeconds > user.remainingSeconds) continue;
      const stabilityBonus = old?.stationId === station.id ? SWITCH_BONUS : 0;
      const score = Math.round((suitability * 100 - waitSeconds / 15 - walkSeconds * 0.1 - (1 - station.confidence) * 15 + stabilityBonus) * 10) / 10;
      const isAlternative = exerciseId !== target;
      const reasons = [
        isAlternative ? `Illustrative ${exercise.movement.toLowerCase()} alternative to ${EXERCISES[target]?.name || target}` : 'Keeps your planned exercise',
        waitSeconds ? `Estimated wait ${formatDuration(waitSeconds)}` : 'Available now',
        `Fits within your ${Math.floor(user.remainingSeconds / 60)} minutes remaining`,
      ];
      if (old?.stationId === station.id) reasons.push('Keeps your current route stable');
      options.push({
        stationId: station.id, stationName: station.name, zone: station.zone,
        exerciseId, exerciseName: exercise.name, targetExerciseId: target,
        movement: exercise.movement, isAlternative, suitability,
        score, waitSeconds, walkSeconds, durationSeconds,
        availableAt: state.now + waitSeconds, finishAt: state.now + waitSeconds + walkSeconds + durationSeconds,
        confidence: station.confidence, state: station.state,
        reason: reasons.slice(0, 2).join(' · '), reasons,
        assignedTo: null, claimedBy: null, rulesStatus: 'Demo rules pending trainer review',
      });
    }
  }
  return options.sort((a, b) => b.score - a.score || a.stationId.localeCompare(b.stationId));
}

/**
 * Returns ranked candidates, including alternatives assigned to another user.
 * assignedTo identifies that advisory allocation; accepting it is rechecked.
 */
export function getRecommendations(state, userId) {
  const user = findUser(state, userId);
  if (!user) return [];
  return stationOptions(state, user).map((option) => {
    const assignment = state.assignments.find((a) => a.stationId === option.stationId && a.userId !== userId);
    return { ...option, assignedTo: assignment?.userId || null, claimedBy: assignment?.userId || null };
  });
}

function allocate(state, cause = 'Floor updated', logChanges = true) {
  const previous = new Map(state.users.map((user) => [user.id, user.currentRecommendation]));
  const ready = state.users.filter((user) => !isActive(state, user) && user.remainingSeconds > 0 && user.planned.length);
  ready.sort((a, b) => a.waitingSince - b.waitingSince || a.id.localeCompare(b.id));
  const options = ready.map((user) => stationOptions(state, user).slice(0, 7));
  let bestScore = -Infinity;
  let bestChoices = [];

  // A tiny exact assignment search is enough for this four-user demo.
  // Each station receives at most one advisory allocation per scheduling pass.
  function search(index, used, score, choices) {
    if (index === ready.length) {
      if (score > bestScore) { bestScore = score; bestChoices = [...choices]; }
      return;
    }
    const fairness = bound((state.now - ready[index].waitingSince) / 30, 0, 10);
    for (const option of options[index]) {
      if (used.has(option.stationId)) continue;
      used.add(option.stationId);
      choices.push(option);
      search(index + 1, used, score + option.score + 100 + fairness, choices);
      choices.pop();
      used.delete(option.stationId);
    }
    choices.push(null);
    search(index + 1, used, score, choices);
    choices.pop();
  }
  search(0, new Set(), 0, []);
  state.assignments = [];
  for (const user of state.users) {
    if (isActive(state, user)) { user.currentRecommendation = null; user.status = 'training'; }
    else { user.currentRecommendation = null; user.status = user.remainingSeconds <= 0 || !user.planned.length ? 'complete' : 'ready'; }
    user.route = [];
  }
  ready.forEach((user, index) => {
    const option = bestChoices[index];
    if (!option) return;
    const old = previous.get(user.id);
    const same = old?.stationId === option.stationId && old?.exerciseId === option.exerciseId;
    const holdValid = same && old.expiresAt > state.now;
    user.currentRecommendation = {
      ...option, heldAt: holdValid ? old.heldAt : state.now,
      expiresAt: holdValid ? old.expiresAt : state.now + HOLD_SECONDS,
      updatedAt: state.now,
    };
    user.status = option.waitSeconds > 0 ? 'waiting' : 'ready';
    user.route = [{ ...user.currentRecommendation }];
    state.assignments.push({ userId: user.id, ...user.currentRecommendation });
    if (logChanges && old && !same) {
      state.stats.reroutes += 1;
      addEvent(state, 'reroute', `${user.name}: ${old.stationName} → ${option.stationName}. ${cause}.`, [user.id], { fromStationId: old.stationId, toStationId: option.stationId });
    }
    if (logChanges && !old && cause !== 'Session started') {
      addEvent(state, 'recommendation', `${user.name}: ${option.stationName} recommended${option.waitSeconds ? ` after an estimated ${formatDuration(option.waitSeconds)}` : ' now'}.`, [user.id]);
    }
  });
  for (const user of ready) {
    if (previous.get(user.id) && !user.currentRecommendation && logChanges) {
      addEvent(state, 'no-route', `${user.name}: no suitable confirmed option fits the remaining time. Ask staff or update your plan.`, [user.id]);
    }
  }
  state.revision += 1;
}

function makeStation(id, name, zone, x, y, capabilities, state = 'free', occupantId = null, releaseAt = null, confidence = 0.96) {
  return { id, name, zone, x, y, capabilities, state, occupantId, releaseAt, confidence, updatedAt: 0, isParticipating: !occupantId?.startsWith('guest'), lastStateChange: { at: 0, from: null, to: state, origin: 'scenario' } };
}

function makeUser(id, name, color, goal, experience, remainingSeconds, planned, currentStationId = null, position = { x: 16, y: 76 }) {
  return { id, name, color, goal, experience, remainingSeconds, planned, completed: [], currentStationId, currentRecommendation: null, route: [], position, waitingSince: 0, excludedExercises: [], status: currentStationId ? 'training' : 'ready' };
}

export function createInitialState(scenario = 'peak') {
  const recognised = SCENARIOS.some((item) => item.id === scenario) ? scenario : 'peak';
  const state = {
    scenario: recognised, now: 0, revision: 0, eventCounter: 0,
    startedAt: 0, assignments: [], events: [], declined: {}, availabilityAudit: [],
    stats: { reroutes: 0, extensions: 0, accepted: 0, declined: 0, completed: 0, stateChanges: 0, rejectedActions: 0 },
    stations: [
      makeStation('leg-press', 'Leg press', 'Strength A', 18, 22, ['leg_press'], 'occupied', 'steven', 90),
      makeStation('hack-squat', 'Hack squat', 'Strength A', 42, 22, ['hack_squat']),
      makeStation('leg-curl', 'Seated leg curl', 'Strength A', 66, 22, ['leg_curl']),
      makeStation('leg-extension', 'Leg extension', 'Strength A', 88, 22, ['leg_extension'], 'unknown', null, null, 0.25),
      makeStation('chest-press', 'Chest press', 'Strength B', 18, 50, ['chest_press'], 'occupied', 'guest-1', 240),
      makeStation('seated-row', 'Seated row', 'Strength B', 42, 50, ['seated_row']),
      makeStation('lat-pulldown', 'Lat pulldown', 'Strength B', 66, 50, ['lat_pulldown'], 'occupied', 'guest-2', 180),
      makeStation('shoulder-press', 'Shoulder press', 'Strength B', 88, 50, ['shoulder_press']),
      makeStation('cable-station', 'Cable station', 'Functional', 18, 78, ['cable_row', 'cable_chest_press'], 'occupied', 'ben', 180),
      makeStation('dumbbell-bench', 'Dumbbell bench', 'Functional', 42, 78, ['dumbbell_press']),
      makeStation('goblet-zone', 'Free weights zone', 'Functional', 66, 78, ['goblet_squat']),
      makeStation('treadmill', 'Treadmill', 'Cardio', 88, 78, ['treadmill_walk'], 'unavailable', null, null, 1),
    ],
    users: [
      makeUser('steven', 'Steven', '#b7e34b', 'Lower-body strength', 'Intermediate', 1500, ['leg_press', 'leg_curl', 'seated_row'], 'leg-press'),
      makeUser('neeka', 'Neeka', '#b595f4', 'Full-body strength', 'Intermediate', 1500, ['leg_press', 'leg_curl', 'lat_pulldown'], null, { x: 17, y: 37 }),
      makeUser('ben', 'Ben', '#74bfd4', 'Upper-body strength', 'Intermediate', 1680, ['cable_row', 'lat_pulldown', 'chest_press'], 'cable-station'),
      makeUser('zaynab', 'Zaynab', '#eab17d', 'Build confidence', 'Beginner', 1200, ['chest_press', 'seated_row', 'treadmill_walk'], null, { x: 47, y: 66 }),
    ],
    metadata: {
      mode: 'Synthetic simulation', model: 'Deterministic rules and exact assignment',
      trainerReview: 'Pending', trainedAI: false, sensorConnected: false,
      note: 'Illustrative exercise relationships require qualified trainer review before a real gym pilot.',
    },
  };
  if (recognised === 'quiet') {
    for (const station of state.stations) {
      if (station.occupantId?.startsWith('guest')) Object.assign(station, { state: 'free', occupantId: null, releaseAt: null });
    }
    Object.assign(findStation(state, 'leg-extension'), { state: 'free', confidence: 0.98 });
    Object.assign(findStation(state, 'treadmill'), { state: 'free' });
  }
  if (recognised === 'uncertain') {
    Object.assign(findStation(state, 'hack-squat'), { state: 'unknown', confidence: 0.3 });
    Object.assign(findStation(state, 'dumbbell-bench'), { state: 'unknown', confidence: 0.3 });
    Object.assign(findStation(state, 'lat-pulldown'), { releaseAt: 30, confidence: 0.55 });
  }
  // Presets supply explicit synthetic initial state, including scenario changes.
  for (const station of state.stations) station.lastStateChange = { at: 0, from: null, to: station.state, origin: 'scenario' };
  addEvent(state, 'system', 'Demo ready. Steven is expected to finish the leg press in 90 seconds. Neeka currently plans to wait.', ['steven', 'neeka']);
  allocate(state, 'Session started', false);
  return state;
}

function rejected(state, message, userIds = []) {
  state.stats.rejectedActions += 1;
  addEvent(state, 'notice', message, userIds);
}

function completeStation(state, station, reason = 'confirmed finished') {
  const user = findUser(state, station.occupantId);
  if (user) {
    const completedExercise = user.activeExerciseId || user.planned[0];
    user.completed.push({ exerciseId: completedExercise, exerciseName: EXERCISES[completedExercise]?.name || completedExercise, stationId: station.id, at: state.now });
    user.planned.shift();
    user.currentStationId = null;
    user.activeExerciseId = null;
    user.position = { x: station.x, y: station.y };
    user.waitingSince = state.now;
    state.stats.completed += 1;
  }
  const name = user?.name || 'Guest member';
  addEvent(state, 'finished', `${name} ${reason} on ${station.name}. The station is available.`, user ? [user.id] : []);
  Object.assign(station, { state: 'free', occupantId: null, releaseAt: null, confidence: 0.99, updatedAt: state.now });
}

export function dispatch(previousState, action = {}) {
  if (action.type === 'RESET') return createInitialState(action.scenario || previousState.scenario);
  const state = clone(previousState);
  let cause = 'Floor availability changed';
  const station = findStation(state, action.stationId);
  const user = findUser(state, action.userId);
  switch (action.type) {
    case 'TICK': {
      const seconds = bound(Number(action.seconds ?? 15) || 0, 0, 3600);
      state.now += seconds;
      for (const member of state.users) member.remainingSeconds = Math.max(0, member.remainingSeconds - seconds);
      for (const item of state.stations) {
        if (item.state === 'occupied' && item.releaseAt !== null && state.now > item.releaseAt + GRACE_SECONDS) {
          item.state = 'unknown';
          item.confidence = 0.3;
          addEvent(state, 'stale', `${item.name}: predicted finish passed without confirmation. Availability is unknown, not free.`, item.occupantId ? [item.occupantId] : []);
        } else if (item.state === 'free' && state.now - item.updatedAt > FREE_STATE_TTL) {
          item.state = 'unknown';
          item.confidence = 0.3;
          addEvent(state, 'stale', `${item.name}: availability update is stale. Confirm before assigning a member.`);
        }
      }
      cause = 'Time and availability estimates updated';
      break;
    }
    case 'EXTEND': {
      if (!station || !station.occupantId || !['occupied', 'unknown'].includes(station.state)) {
        rejected(state, 'An active occupant is required to extend a session.'); break;
      }
      const seconds = bound(Number(action.seconds ?? 180) || 180, 15, 900);
      station.releaseAt = Math.max(state.now, station.releaseAt || state.now) + seconds;
      station.state = 'occupied';
      station.updatedAt = state.now;
      station.confidence = 0.95;
      state.stats.extensions += 1;
      const occupant = findUser(state, station.occupantId);
      addEvent(state, 'extension', `${occupant?.name || 'Guest member'} extended ${station.name} by ${formatDuration(seconds)}. New estimated release in ${formatDuration(station.releaseAt - state.now)}.`, occupant ? [occupant.id] : []);
      cause = `${station.name} will be occupied longer`;
      break;
    }
    case 'FINISH':
    case 'REPORT_FREE': {
      if (!station) { rejected(state, 'Station not found.'); break; }
      completeStation(state, station, action.type === 'REPORT_FREE' ? 'was confirmed finished' : 'finished');
      state.stats.stateChanges += 1;
      cause = `${station.name} is now confirmed available`;
      break;
    }
    case 'SET_STATUS': {
      const status = action.status || action.state;
      if (!station || !['free', 'occupied', 'unknown', 'unavailable'].includes(status)) { rejected(state, 'Choose a valid station status.'); break; }
      if (status === 'free') {
        completeStation(state, station, 'was confirmed finished');
      } else {
        if (status === 'unavailable' && station.occupantId) {
          const occupant = findUser(state, station.occupantId);
          if (occupant) {
            occupant.currentStationId = null;
            occupant.activeExerciseId = null;
            occupant.position = { x: station.x, y: station.y };
            occupant.waitingSince = state.now;
          }
          station.occupantId = null;
        }
        station.state = status;
        station.updatedAt = state.now;
        station.confidence = status === 'unknown' ? 0.3 : 0.96;
        if (status === 'occupied') {
          station.occupantId ||= `guest-${station.id}`;
          station.releaseAt = state.now + bound(Number(action.durationSeconds || 180), 30, 1800);
        } else if (status !== 'unknown') station.releaseAt = null;
        addEvent(state, 'status', `${station.name} marked ${status}.`, station.occupantId ? [station.occupantId] : []);
      }
      state.stats.stateChanges += 1;
      cause = `${station.name} status changed`;
      break;
    }
    case 'ACCEPT': {
      if (!user) { rejected(state, 'Member not found.'); break; }
      if (isActive(state, user)) { rejected(state, `${user.name} is already training. Finish the current station first.`, [user.id]); break; }
      const targetId = action.stationId || user.currentRecommendation?.stationId;
      const selected = getRecommendations(state, user.id).find((option) => option.stationId === targetId);
      const targetStation = findStation(state, targetId);
      if (!selected || !targetStation) { rejected(state, 'That option is no longer suitable. Recommendations have been refreshed.', [user.id]); break; }
      if (selected.assignedTo) { rejected(state, `${targetStation.name} is currently suggested to another member. Choose another option.`, [user.id]); break; }
      if (targetStation.state !== 'free') {
        addEvent(state, 'waiting', `${user.name} chose to wait for ${targetStation.name}. Its release remains an estimate.`, [user.id]);
        user.currentRecommendation = { ...selected, heldAt: state.now, expiresAt: state.now + HOLD_SECONDS };
        break;
      }
      targetStation.state = 'occupied';
      targetStation.occupantId = user.id;
      targetStation.releaseAt = state.now + selected.durationSeconds;
      targetStation.confidence = 0.99;
      targetStation.updatedAt = state.now;
      user.currentStationId = targetStation.id;
      user.activeExerciseId = selected.exerciseId;
      user.currentRecommendation = null;
      user.position = { x: targetStation.x, y: targetStation.y };
      state.stats.accepted += 1;
      addEvent(state, 'accepted', `${user.name} started ${selected.exerciseName} at ${targetStation.name}.`, [user.id]);
      cause = `${user.name} started ${targetStation.name}`;
      break;
    }
    case 'DECLINE': {
      if (!user || !user.currentRecommendation) { rejected(state, 'No recommendation is currently selected.'); break; }
      const old = user.currentRecommendation;
      state.declined[user.id] ||= {};
      state.declined[user.id][old.stationId] = state.now + 120;
      state.stats.declined += 1;
      addEvent(state, 'declined', `${user.name} declined ${old.stationName}. Other suitable options will be considered.`, [user.id]);
      cause = `${user.name} requested another option`;
      break;
    }
    case 'SET_PROFILE': {
      if (!user) { rejected(state, 'Member not found.'); break; }
      const changes = action.changes || {};
      if (changes.remainingSeconds !== undefined) user.remainingSeconds = bound(Number(changes.remainingSeconds) || 0, 0, 7200);
      if (changes.remainingMinutes !== undefined) user.remainingSeconds = bound(Number(changes.remainingMinutes) || 0, 0, 120) * 60;
      if (typeof changes.goal === 'string') user.goal = changes.goal.slice(0, 80);
      if (typeof changes.experience === 'string') user.experience = changes.experience.slice(0, 40);
      if (Array.isArray(changes.planned) && !isActive(state, user)) user.planned = changes.planned.filter((id) => Boolean(EXERCISES[id])).slice(0, 8);
      if (Array.isArray(changes.excludedExercises)) user.excludedExercises = changes.excludedExercises.filter((id) => Boolean(EXERCISES[id]));
      addEvent(state, 'profile', `${user.name}'s session preferences were updated.`, [user.id]);
      cause = 'Session preferences changed';
      break;
    }
    case 'REPLAN':
      cause = 'Recommendations refreshed';
      break;
    default:
      return previousState;
  }
  const originByAction = {
    TICK: 'time-estimate', EXTEND: 'member-extension', FINISH: 'member-finish',
    REPORT_FREE: 'staff-confirmation', SET_STATUS: 'operator-confirmation', ACCEPT: 'member-check-in',
  };
  for (const current of state.stations) {
    const previous = findStation(previousState, current.id);
    if (previous?.state !== current.state) {
      const transition = { stationId: current.id, at: state.now, from: previous?.state || null, to: current.state, origin: originByAction[action.type] || action.type.toLowerCase() };
      current.lastStateChange = { ...transition };
      state.availabilityAudit.unshift(transition);
    }
  }
  state.availabilityAudit = state.availabilityAudit.slice(0, 100);
  allocate(state, cause);
  return state;
}

export function getMetrics(state) {
  const count = (status) => state.stations.filter((station) => station.state === status).length;
  const waits = state.assignments.map((assignment) => assignment.waitSeconds);
  const occupied = count('occupied');
  return {
    total: state.stations.length, free: count('free'), occupied, unknown: count('unknown'), unavailable: count('unavailable'),
    activeUsers: state.users.filter((user) => isActive(state, user)).length,
    waitingUsers: state.users.filter((user) => !isActive(state, user) && user.remainingSeconds > 0 && user.planned.length).length,
    assignedUsers: state.assignments.length,
    avgWaitSeconds: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    utilisation: Math.round(occupied / state.stations.length * 100),
    elapsedSeconds: state.now, totalEvents: state.eventCounter,
    ...state.stats,
  };
}

export function getValidationSnapshot(state) {
  const conflicts = [];
  const invalidRecommendations = [];
  const seen = new Set();
  for (const assignment of state.assignments) {
    if (seen.has(assignment.stationId)) conflicts.push(assignment.stationId);
    seen.add(assignment.stationId);
    const station = findStation(state, assignment.stationId);
    const allowed = DEMO_RULES[assignment.targetExerciseId] || [];
    if (!station || ['unknown', 'unavailable'].includes(station.state) || !allowed.some(([id]) => id === assignment.exerciseId)) invalidRecommendations.push(assignment.userId);
  }
  const confirmationOrigins = new Set(['scenario', 'member-finish', 'staff-confirmation', 'operator-confirmation']);
  const unsupportedFreeStations = state.stations
    .filter((station) => station.state === 'free' && (station.lastStateChange?.to !== 'free' || !confirmationOrigins.has(station.lastStateChange?.origin)))
    .map((station) => station.id);
  const unsupportedFreeTransitions = (state.availabilityAudit || [])
    .filter((transition) => transition.to === 'free' && !confirmationOrigins.has(transition.origin));
  const confirmedAvailability = unsupportedFreeStations.length === 0 && unsupportedFreeTransitions.length === 0;
  return {
    at: state.now, revision: state.revision,
    algorithm: 'Deterministic scoring plus exact multi-user assignment',
    trainedModel: false, dataset: 'Synthetic demonstration data', trainerReview: 'Pending',
    allocationConflicts: conflicts, invalidRecommendations,
    confirmationEvidence: {
      scope: 'Current free stations and the most recent 100 state transitions',
      unsupportedFreeStations, unsupportedFreeTransitions,
      retainedTransitionCount: (state.availabilityAudit || []).length,
      initialState: 'Explicit synthetic scenario data',
    },
    staleStations: state.stations.filter((station) => station.state === 'unknown').map((station) => station.id),
    checks: [
      { id: 'capacity', name: 'No duplicate advisory allocations', passed: conflicts.length === 0 },
      { id: 'availability', name: 'Unknown and unavailable stations excluded', passed: invalidRecommendations.length === 0 },
      { id: 'governance', name: 'Explicit exercise relationships only', passed: invalidRecommendations.length === 0 },
      { id: 'confirmation', name: 'Free status has explicit confirmation or scenario evidence', passed: confirmedAvailability },
    ],
    metrics: getMetrics(state),
  };
}
