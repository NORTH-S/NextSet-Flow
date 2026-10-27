import { EXERCISES } from './engine.js';

// Rule-based field extraction and a legacy keyword parser. The local trained
// focus classifier is composed with these fields in local-planner.js.
export const samplePrompts = [
  'I have 30 minutes. Train legs, mostly machines, and avoid queues.',
  '20 minutes of upper body. I am a beginner. No dumbbell presses.',
  '我有半小时，想练腿，尽量用固定器械，不想排队。',
];

const FOCUSES = ['legs', 'upper', 'full', 'push', 'pull'];
const SOURCES = ['local-demo-parser', 'openai', 'trained-local-classifier', 'user-confirmed-local-classifier'];
const INTENT_KEYS = ['focus', 'minutes', 'experience', 'excludedExercises', 'preferences', 'summary', 'source'];
const EXERCISE_ALIASES = {
  leg_press: /\bleg\s*press(?:es)?\b|腿举|蹬腿/iu,
  hack_squat: /\bhack\s*squats?\b|哈克(?:深蹲)?/iu,
  goblet_squat: /\bgoblet\s*squats?\b|高脚杯(?:深蹲)?|酒杯(?:深蹲)?/iu,
  leg_curl: /\b(?:seated\s+)?leg\s*curls?\b|腿弯举|屈腿/iu,
  leg_extension: /\bleg\s*extensions?\b|腿屈伸|腿伸展|伸腿/iu,
  chest_press: /\b(?:machine\s+)?chest\s*press(?:es)?\b|推胸/iu,
  dumbbell_press: /\bdumbbell\s*(?:bench\s*)?press(?:es)?\b|哑铃(?:卧推|推举)/iu,
  cable_chest_press: /\bcable\s*(?:chest\s*)?press(?:es)?\b|绳索推胸/iu,
  seated_row: /\bseated\s*rows?\b|坐姿划船/iu,
  cable_row: /\bcable\s*rows?\b|绳索划船/iu,
  lat_pulldown: /\blat\s*pull\s*downs?\b|高位下拉/iu,
  shoulder_press: /\bshoulder\s*press(?:es)?\b|肩推|推肩/iu,
  treadmill_walk: /\btreadmill(?:\s*walk(?:ing)?)?\b|跑步机/iu,
};
const ownObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const errorResult = (clarification) => ({ ok: false, clarification, warnings: [], unsupported: [] });
const normaliseRequest = (text) => text.normalize('NFKC').replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu, ' ').trim();

/** Accept an intent, never arbitrary exercise plans or executable model output. */
export function validateIntent(value, source = 'local-demo-parser') {
  if (!ownObject(value) || Object.keys(value).some((key) => !INTENT_KEYS.includes(key))) {
    return errorResult('Please describe your training focus and time. The planner accepts workout preferences only.');
  }
  if (!FOCUSES.includes(value.focus)) return errorResult('Would you like legs, upper body, full body, push, or pull?');
  if (!Number.isInteger(value.minutes) || value.minutes < 5 || value.minutes > 90) {
    return errorResult('Please choose a session between 5 and 90 minutes.');
  }
  if (!['Beginner', 'Intermediate'].includes(value.experience)) return errorResult('Please choose beginner or intermediate experience for this demo.');
  if (!Array.isArray(value.excludedExercises) || value.excludedExercises.some((id) => typeof id !== 'string' || !Object.hasOwn(EXERCISES, id))) {
    return errorResult('One of the excluded exercises is outside the demo exercise library.');
  }
  if (!ownObject(value.preferences) || Object.keys(value.preferences).some((key) => !['avoidWaiting', 'preferMachines'].includes(key)) ||
      typeof value.preferences.avoidWaiting !== 'boolean' || typeof value.preferences.preferMachines !== 'boolean') {
    return errorResult('Please describe whether you prefer machines or want to avoid waiting.');
  }
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 300) return errorResult('Please provide a short workout request.');
  // source is assigned by the trusted caller, never copied from the payload.
  if (!SOURCES.includes(source)) return errorResult('The planner response source is unsupported.');
  return {
    ok: true,
    intent: {
      focus: value.focus, minutes: value.minutes, experience: value.experience,
      excludedExercises: [...new Set(value.excludedExercises)],
      preferences: { avoidWaiting: value.preferences.avoidWaiting, preferMachines: value.preferences.preferMachines },
      summary: value.summary.trim(), source,
    }, warnings: [], unsupported: [],
  };
}

function exclusionsIn(text) {
  const excluded = new Set();
  // Keep negation in its own clause so “no queues, and leg press” does not
  // accidentally exclude the following positive preference.
  for (const clause of text.split(/[,，;；.!。！\n]|\b(?:but|and|instead)\b|但是|而且/iu)) {
    const negation = clause.match(/\b(?:no|not|avoid|without|exclude|skip|don['’]?t\s+(?:want|use|do))\s+(.+)|(?:不要|不想做|不做|避开|避免|不用|不使用|排除)(.+)/iu);
    if (!negation) continue;
    const target = negation[1] || negation[2];
    for (const [id, alias] of Object.entries(EXERCISE_ALIASES)) if (alias.test(target)) excluded.add(id);
    if (/\bsquats?\b|深蹲/iu.test(target) && !/\bhack\b|\bgoblet\b|哈克|高脚杯|酒杯/iu.test(target)) {
      excluded.add('hack_squat'); excluded.add('goblet_squat');
    }
    if (/\bfree\s*weights?\b|\bdumbbells?\b(?!\s*(?:bench\s*)?press)|自由重量|哑铃(?!卧推|推举)/iu.test(target)) {
      excluded.add('goblet_squat'); excluded.add('dumbbell_press');
    }
  }
  // Cable chest press is a more specific alias than generic chest press.
  // Excluding the cable variant alone should preserve the fixed machine.
  if (excluded.has('cable_chest_press') && !/(?:no|without|avoid|skip|不要|不做)\s*(?:machine\s+)?chest\s*press/iu.test(text) && !/(?:不要|不做|避开|不用)推胸/iu.test(text)) excluded.delete('chest_press');
  return [...excluded];
}

function minutesIn(text) {
  const chineseNumber = (word) => {
    if (/^\d+(?:\.\d+)?$/.test(word)) return Number(word);
    const digits = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
    if (!/[十百千]/u.test(word)) return Number([...word].map((c)=>digits[c]).join(''));
    let value=0, digit=0;
    for (const char of word) { if (Object.hasOwn(digits,char)) digit=digits[char]; else { value+=(digit||1)*({十:10,百:100,千:1000}[char]||0);digit=0; } }
    return value+digit;
  };
  const englishValues = {zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
  const englishNumber = (word) => { let value=0;for (const part of word.toLowerCase().split(/[ -]+/)) { if (part==='hundred') value=(value||1)*100; else value+=englishValues[part]||0; }return value; };
  const enTokens = Object.keys(englishValues).join('|')+'|hundred|and';
  let canonical=text
    .replace(/([零〇一二两三四五六七八九十百千\d]+)(?:个)?半(?:小时|钟头)|([零〇一二两三四五六七八九十百千\d]+)(?:个)?(?:小时|钟头)半/gu, (_,a,b)=>`${(chineseNumber(a||b)+0.5)*60}分钟`)
    .replace(/\b(one|two|three|\d+)\s+and\s+a\s+half\s+hours?\b/giu,(_,n)=>`${((Number(n)||englishNumber(n))+0.5)*60} minutes`)
    .replace(/\bthree\s+quarters?\s+(?:of\s+)?an?\s+hour\b/giu,'45 minutes')
    .replace(/\b(?:a\s+)?quarter\s+(?:of\s+)?an?\s+hour\b|(?:一|1)刻钟/giu,'15 minutes')
    .replace(/\b(?:half\s*(?:an?\s*)?hour|half-hour)\b|半(?:个)?小时/giu,'30 minutes')
    .replace(/\ban?\s+hour\b/giu,'1 hour')
    .replace(/([零〇一二两三四五六七八九十百千]+)(?:个)?\s*(小时|钟头|分钟|分(?=[，。！？\s]|$))/gu,(_,n,u)=>`${chineseNumber(n)}${u}`);
  const writtenEnglish = new RegExp(`\\b((?:(?:${enTokens})[ -]+){0,4}(?:${enTokens}))\\s*-?\\s*(hours?|hrs?|minutes?|mins?)\\b`,'giu');
  canonical=canonical.replace(writtenEnglish,(_,n,u)=>`${englishNumber(n)} ${u}`);
  let total = 0;
  let found = false;
  for (const match of canonical.matchAll(/(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h\b|小时|钟头)|(\d+(?:\.\d+)?)\s*-?\s*(minutes?|mins?|m\b|分钟|分(?=[，。！？\s]|$))/giu)) {
    total += match[1] ? Number(match[1]) * 60 : Number(match[3]);
    found = true;
  }
  return found ? Math.round(total) : null;
}

function positiveFocusText(text) {
  return text
    .replace(/\b(?:no|not|without|skip|avoid|don['’]?t\s+(?:want|train|do))\s+(?:a\s+)?(?:to\s+)?(?:train(?:ing)?\s+)?(?:legs?|lower\s*body|upper\s*body|full\s*body|push|pull)(?:\s+(?:day|workout))?/giu, ' ')
    .replace(/(?:不想|不要|不)(?:练|做|训练)?(?:腿部?|下肢|上肢|上半身|全身|推|拉)(?:训练)?/gu, ' ');
}

/** Extract bounded fields only. This function never chooses a training focus. */
export function extractWorkoutDetails(request) {
  if (typeof request !== 'string' || !normaliseRequest(request)) return errorResult('Tell me what you want to train and how much time you have.');
  const text = normaliseRequest(request);
  if (Array.from(request).length > 1200) return errorResult('Please shorten your request to 1,200 characters or fewer.');
  const healthText = text
    .replace(/\b(?:no|without)\s+(?:pain|injur(?:y|ies))\b/giu, '')
    .replace(/没有(?:疼痛|受伤|伤病)|无伤病/gu, '');
  if (/\b(?:pain(?:ful)?|injur(?:y|ies|ed)|rehab(?:ilitation)?|recovering|hurt|medical|pregnan(?:t|cy))\b|疼|痛|受伤|伤病|康复|术后|怀孕/iu.test(healthText)) {
    return errorResult('This demo cannot assess pain, injury, or medical restrictions. Please check suitable exercises with a qualified professional before planning a session.');
  }
  const parsedMinutes = minutesIn(text);
  const minutes = parsedMinutes ?? 30;
  if (minutes < 5 || minutes > 90) return errorResult('Please choose a session between 5 and 90 minutes.');
  if (/\b(?:advanced|expert|professional\s+athlete)\b|高级|资深/iu.test(text)) return errorResult('This demo supports beginner and intermediate sessions. Which should I use?');
  const experience = /\b(?:intermediate|experienced)\b|中级|有经验/iu.test(text) ? 'Intermediate' : 'Beginner';
  const avoidWaiting = /\b(?:avoid|no|without|skip|hate|don['’]?t\s+want\s+to)\s+(?:the\s+)?(?:queues?|queueing|queuing|waiting|wait)\b|(?:不想|不要|避免|少|不)排队|无需等待|不想等/iu.test(text);
  const preferMachines = /\b(?:machines?|machine[-\s]*based)\b|固定器械|器械为主|多用器械/iu.test(text) && !/\b(?:no|without|avoid)\s+machines?\b|不用固定器械/iu.test(text);
  return { ok: true, details: { minutes, experience, excludedExercises: exclusionsIn(text), preferences: { avoidWaiting, preferMachines } },
    warnings: parsedMinutes === null ? ['No duration provided; using a 30-minute session.'] : [], unsupported: [] };
}

/** Legacy parser for compatibility and the initial example, not trained inference. */
export function parseWorkoutRequest(request) {
  const fields = extractWorkoutDetails(request);
  if (!fields.ok) return fields;
  const positive = positiveFocusText(normaliseRequest(request));
  const matches = [];
  if (/\b(?:legs?|lower\s*body)\b|练腿|腿部训练|下肢/iu.test(positive)) matches.push('legs');
  if (/\bupper\s*(?:body)?\b|上半身|上肢/iu.test(positive)) matches.push('upper');
  if (/\b(?:full|whole|total)[-\s]*body\b|全身/iu.test(positive)) matches.push('full');
  if (/\bpush(?:\s*day)?\b|推日|推的训练|推类/iu.test(positive)) matches.push('push');
  if (/\bpull(?:\s*day)?\b|拉日|拉的训练|拉类/iu.test(positive)) matches.push('pull');
  if (!matches.length && /\b(?:chest|back|shoulders?|arms?)\b|练胸|练背|练肩|练手臂/iu.test(positive)) matches.push('upper');
  if (matches.length !== 1) return errorResult(matches.length > 1 ? 'Which single focus should I plan: legs, upper body, full body, push, or pull?' : 'Would you like to train legs, upper body, full body, push, or pull?');
  const { minutes, experience, excludedExercises, preferences } = fields.details;
  const { avoidWaiting, preferMachines } = preferences;
  const focusLabel = { legs: 'Legs', upper: 'Upper body', full: 'Full body', push: 'Push', pull: 'Pull' }[matches[0]];
  const result = validateIntent({
    focus: matches[0], minutes, experience, excludedExercises,
    preferences,
    summary: `${focusLabel} · ${minutes} min · ${experience}${avoidWaiting ? ' · minimise waiting' : ''}${preferMachines ? ' · prefer machines' : ''}`,
  });
  result.warnings.push(...fields.warnings);
  return result;
}
