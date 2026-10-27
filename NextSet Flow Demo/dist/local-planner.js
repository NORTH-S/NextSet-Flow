import { classifyText } from './trained-classifier.js';
import { TRAINED_MODEL, LOCAL_MODEL_INFO } from './trained-model.js';
import { extractWorkoutDetails, validateIntent } from './intent.js';

export const localModelInfo = LOCAL_MODEL_INFO;
const FOCUSES = ['legs', 'upper', 'full', 'push', 'pull'];
const NAMES = { legs: 'Legs', upper: 'Upper body', full: 'Full body', push: 'Push', pull: 'Pull' };

/** Compose learned focus classification with bounded rule-extracted fields. */
export function planWorkoutLocally(text, { confirmedFocus } = {}) {
  const fields = extractWorkoutDetails(text);
  if (!fields.ok) return { ...fields, needsFocusConfirmation: false, classification: null };
  const classification = classifyText(text, TRAINED_MODEL);
  if (classification.label === 'unsupported') {
    return { ok: false, classification, needsFocusConfirmation: false, warnings: fields.warnings,
      clarification: 'This request is outside the supported gym-training categories. Please describe a legs, upper-body, full-body, push or pull session.', unsupported: ['request-scope'] };
  }
  if (confirmedFocus !== undefined && !FOCUSES.includes(confirmedFocus)) {
    return { ok: false, classification, needsFocusConfirmation: true, details: fields.details, warnings: fields.warnings,
      clarification: 'Please choose legs, upper body, full body, push or pull.' };
  }
  const userConfirmed = confirmedFocus !== undefined;
  if (!userConfirmed && !FOCUSES.includes(classification.label)) {
    return { ok: false, classification, needsFocusConfirmation: true, details: fields.details, warnings: fields.warnings,
      clarification: 'Please confirm your training focus so I can build the right session.' };
  }
  const focus = userConfirmed ? confirmedFocus : classification.label;
  const { minutes, experience, excludedExercises, preferences } = fields.details;
  const result = validateIntent({ focus, minutes, experience, excludedExercises, preferences,
    summary: `${NAMES[focus]} · ${minutes} min · ${experience}${preferences.avoidWaiting ? ' · minimise waiting' : ''}${preferences.preferMachines ? ' · prefer machines' : ''}`,
  }, userConfirmed ? 'user-confirmed-local-classifier' : 'trained-local-classifier');
  return { ...result, classification, needsFocusConfirmation: false, warnings: [...(result.warnings || []), ...fields.warnings] };
}
