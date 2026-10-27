import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as engine from '../dist/engine.js';
import * as intentModule from '../dist/intent.js';
import * as planner from '../dist/planner.js';
import * as localPlanner from '../dist/local-planner.js';

const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).replace(/^import\s+\{[\s\S]*?\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
const shell = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const inspect = '\nglobalThis.readUI = () => ({ state, intent, simulation, playing, modal, busy, requestText, submitted, formMessage, speed, pendingRequest });';
const decode = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Runs actual UI handlers/rendering at a DOM boundary. Textarea replacement is
// modelled so programmatic render/focus bugs are visible. This is not visual QA.
function mount({ code } = {}) {
  const elements = new Map(), listeners = new Map(), timeouts = new Map(), intervals = new Map(), fetchCalls = [], descendants = new Map();
  let timerId = 0, document;
  function element(selector = '') {
    let markup = '';
    const node = {
      id: selector.startsWith('#') && !selector.includes(' ') ? selector.slice(1) : '',
      textContent: '', value: '', style: {}, dataset: {}, disabled: false, isConnected: true,
      selectionStart: 0, selectionEnd: 0, classList: { toggle() {} }, setAttribute() {},
      focus() { document.activeElement = this; }, setSelectionRange(a,b) { this.selectionStart = a; this.selectionEnd = b; },
      replaceChildren(value) { this.innerHTML = value?.innerHTML || ''; },
      remove() { this.isConnected = false; }, click() {},
    };
    Object.defineProperty(node, 'innerHTML', { get: () => markup, set(value) {
      markup = value;
      if (!['#workout', '#modal-root'].includes(selector)) return;
      for (const child of descendants.get(selector) || []) { elements.get(child).isConnected = false; elements.delete(child); }
      const children = [];
      for (const match of String(value).matchAll(/<(textarea|select)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g)) {
        const key = '#' + match[3], child = element(key);
        child.disabled = /\bdisabled\b/.test(match[2]);
        child.value = match[1] === 'textarea' ? decode(match[4]) : match[4].match(/<option\s+value="([^"]+)"\s+selected/)?.[1] || match[4].match(/<option\s+value="([^"]+)"/)?.[1] || '';
        child.dataset.station = match[2].match(/data-station="([^"]+)"/)?.[1];
        elements.set(key, child); children.push(key);
      }
      if (selector === '#modal-root' && value) { const key = '#modal-root .close-modal'; elements.set(key, element()); children.push(key); }
      descendants.set(selector, children);
    }});
    return node;
  }
  for (const selector of ['#workout', '#modal-root', '#toast-region']) elements.set(selector, element(selector));
  const get = selector => elements.get(selector) || null;
  document = {
    activeElement: null, hidden: false, body: { style: {} }, querySelector: get,
    querySelectorAll: () => [get('#modal-root .close-modal'), get('#station-status')].filter(Boolean),
    getElementById: id => get('#' + id), createElement: () => element(),
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  const context = {
    ...engine, ...intentModule, ...planner, ...localPlanner, document, console,
    fetch(...args) { fetchCalls.push(args); throw new Error('Model planning must not call a network API'); },
    location: { protocol: 'https:', origin: 'https://demo.test' },
    setTimeout(callback, delay) { const id = ++timerId; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  vm.runInNewContext(code || source + inspect, context);
  function click(action, fields = {}, { disabled = false, retainFocus = false } = {}) {
    const button = element(); button.dataset = { action, ...fields }; button.disabled = disabled;
    if (!retainFocus) button.focus();
    return listeners.get('click')({ target: { matches() { return false; }, closest(selector) { return selector === '[data-action]' ? button : null; } } });
  }
  function input(value) { const node = get('#workout-request'); node.value = value; node.focus(); listeners.get('input')({ target: node }); }
  function submit(text) {
    if (text !== undefined) input(text);
    let prevented = false;
    const pending = listeners.get('submit')({ target: { id: 'workout-form' }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); return pending;
  }
  return {
    get, document, fetchCalls, click, input, submit,
    change(id, value, dataset = {}) { return listeners.get('change')({ target: { id, value, dataset } }); },
    runInterval(count = 1) { for (let n = 0; n < count; n++) for (const timer of intervals.values()) timer.callback(); },
    key(key, fields = {}) { return listeners.get('keydown')({ key, ...fields }); },
    ui: () => context.readUI?.(), state: () => context.readUI().state,
    html: () => get('#workout').innerHTML, modalHtml: () => get('#modal-root').innerHTML,
  };
}
const user = app => app.state().users.find(entry => entry.id === 'neeka');
const station = (app,id) => app.state().stations.find(entry => entry.id === id);

test('initial screen retains simple planning, complete floor and simulation with the local model ready', () => {
  const app = mount();
  for (const text of [/id="workout-form"/, /id="workout-request"/, /Plan my workout/, /Run full simulation/, /ENTRANCE/, /Free/, /In use/, /route-current/, /Local model ready/]) assert.match(app.html(),text);
  assert.equal((app.html().match(/class="map-station /g) || []).length,12);
  assert.match(app.html(),/Forecast/); assert.match(app.html(),/stations aren’t reserved/); assert.match(app.html(),/Example session/);
  assert.equal(app.ui().simulation,null); assert.equal(app.ui().playing,false); assert.equal(app.fetchCalls.length,0);
  assert.doesNotMatch(shell + app.html(),/AI configured|Use offline demo|Try AI mode|Technical validation|Operator dashboard/i);
});

test('a real trained classification creates a workout with rule-extracted time without an API', async () => {
  const app = mount(); await app.submit('Upper body 20 minutes');
  assert.equal(app.ui().intent.focus,'upper'); assert.equal(app.ui().intent.source,'trained-local-classifier');
  assert.equal(user(app).remainingSeconds,1200); assert.ok(user(app).planned.includes('chest_press'));
  assert.equal(app.ui().pendingRequest,null); assert.equal(app.ui().busy,false); assert.equal(app.fetchCalls.length,0);
  assert.equal(app.get('#workout-request').value,'Upper body 20 minutes');
  assert.match(app.html(),/Upper body/);
});

test('uncertain complex requests keep the existing plan until the user confirms focus and retain all extracted constraints', async () => {
  const app = mount(), before = JSON.stringify(user(app).planned);
  const query='Upper body for 20 minutes, no dumbbell presses, avoid queues';
  await app.submit(query);
  assert.ok(app.ui().pendingRequest); assert.equal(JSON.stringify(user(app).planned),before);
  assert.match(app.html(),/data-action="confirm-focus"/);
  await app.click('confirm-focus',{focus:'upper'});
  assert.equal(app.ui().intent.focus,'upper'); assert.equal(app.ui().intent.source,'user-confirmed-local-classifier');
  assert.equal(user(app).remainingSeconds,1200); assert.ok(user(app).excludedExercises.includes('dumbbell_press'));
  assert.equal(app.ui().intent.preferences.avoidWaiting,true); assert.equal(app.ui().pendingRequest,null);
  assert.equal(app.fetchCalls.length,0);
});

test('the Chinese model uncertainty path can be explicitly confirmed without a keyword fallback', async () => {
  const app = mount(); await app.submit('我有半小时，想练腿，尽量用固定器械，不想排队。');
  assert.ok(app.ui().pendingRequest); assert.equal(app.ui().submitted,false);
  await app.click('confirm-focus',{focus:'legs'});
  assert.equal(app.ui().intent.focus,'legs'); assert.equal(app.ui().intent.minutes,30);
  assert.equal(app.ui().intent.preferences.preferMachines,true); assert.equal(app.ui().intent.preferences.avoidWaiting,true);
  assert.equal(app.ui().intent.source,'user-confirmed-local-classifier');
});

test('editing an uncertain request invalidates stale confirmation instead of applying old fields', async () => {
  const app = mount(); await app.submit('Upper body for 20 minutes, no dumbbell presses, avoid queues');
  assert.ok(app.ui().pendingRequest);
  app.input('Pull for 25 minutes');
  assert.equal(app.ui().pendingRequest,null);
  await app.click('confirm-focus',{focus:'upper'});
  assert.equal(app.ui().intent.focus,'legs');
  await app.submit(); assert.equal(app.ui().intent.focus,'pull'); assert.equal(app.ui().intent.minutes,25);
  assert.equal(app.ui().intent.source,'trained-local-classifier');
});

test('medical and invalid-time requests are blocked without offering focus confirmation or changing the plan', async () => {
  const app = mount(), before = JSON.stringify(user(app).planned);
  await app.submit('Legs for 30 minutes with knee pain');
  assert.match(app.html(),/cannot assess pain|pain, injury|pain or injur/i);
  assert.equal(app.ui().pendingRequest,null); assert.doesNotMatch(app.html(),/data-action="confirm-focus"/);
  await app.click('confirm-focus',{focus:'legs'}); assert.equal(JSON.stringify(user(app).planned),before);
  await app.submit('Upper body for 200 minutes');
  assert.match(app.html(),/5 and 90 minutes/); assert.equal(app.ui().pendingRequest,null);
  assert.equal(JSON.stringify(user(app).planned),before); assert.equal(app.fetchCalls.length,0);
});

test('examples and reset replace the composer and clear any pending confirmation', async () => {
  const app = mount(), initialRequest=app.ui().requestText; app.input('My unsent custom text');
  app.click('example',{index:'1'},{retainFocus:true});
  assert.equal(app.get('#workout-request').value,intentModule.samplePrompts[1]);
  assert.equal(app.ui().requestText,intentModule.samplePrompts[1]);
  await app.submit('Give me a good workout'); assert.ok(app.ui().pendingRequest);
  app.click('reset',{}, {retainFocus:true});
  assert.equal(app.ui().pendingRequest,null); assert.equal(app.get('#workout-request').value,initialRequest);
  assert.equal(app.ui().requestText,initialRequest); assert.equal(app.ui().submitted,false);
});

test('untrusted request text remains escaped in the composer and does not inject markup', async () => {
  const app = mount(); await app.submit('Legs 30 minutes </textarea><script>alert(1)</script>');
  assert.doesNotMatch(app.html(),/<script>alert/); assert.match(app.html(),/&lt;script&gt;alert/);
  assert.equal(app.fetchCalls.length,0);
});

test('global simulation still produces actual overruns, replanning and completion', async () => {
  const app = mount(); await app.click('simulate');
  assert.equal(app.ui().pendingRequest,null,'The clear default request starts a simulation in one click.');
  assert.equal(app.ui().intent.source,'trained-local-classifier');
  assert.equal(app.ui().playing,true); assert.equal(app.ui().simulation.userPosition.x,50); assert.equal(app.ui().simulation.userPosition.y,95);
  assert.match(app.html(),/Your workout, playing live/); app.change('speed-select','30');
  for(let i=0;i<600&&!app.ui().simulation.completed;i++)app.runInterval();
  const sim=app.ui().simulation; assert.equal(sim.completed,true); assert.equal(app.ui().playing,false);
  for(const type of ['other-overrun','own-overrun','blocked','start','finish','complete'])assert.ok(sim.events.some(event=>event.type===type),type);
  assert.ok(user(app).completed.length>0); assert.ok(app.state().stats.reroutes>0);
  assert.match(app.html(),/Simulation complete/); assert.match(app.html(),/LIVE OPTIMISATION/); assert.equal(app.fetchCalls.length,0);
});

test('simulation speed, pause, hidden tab and reset control real progression', async () => {
  const app=mount(); await app.click('simulate');
  if(app.ui().pendingRequest)await app.click('confirm-focus',{focus:'legs'});
  app.runInterval(4); assert.equal(app.ui().simulation.elapsed,15);
  app.click('toggle-play'); app.runInterval(4); assert.equal(app.ui().simulation.elapsed,15);
  app.click('toggle-play'); app.document.hidden=true; app.runInterval(4); assert.equal(app.ui().simulation.elapsed,15);
  app.document.hidden=false; app.click('reset'); app.runInterval(4);
  assert.equal(app.ui().simulation,null); assert.equal(app.state().now,0); assert.equal(app.ui().playing,false);
});

test('a changed confident request can plan and start simulation in one click', async () => {
  const app=mount(); app.input('Upper body 20 minutes'); await app.click('simulate');
  assert.equal(app.ui().intent.focus,'upper'); assert.equal(app.ui().intent.source,'trained-local-classifier');
  assert.equal(app.ui().simulation.intent.focus,'upper'); assert.equal(app.ui().playing,true); assert.equal(app.fetchCalls.length,0);
});

test('simulation waits for explicit confirmation of an uncertain goal, then uses the confirmed request', async () => {
  const app=mount(); app.input('我有半小时，想练腿，尽量用固定器械，不想排队。'); await app.click('simulate');
  assert.ok(app.ui().pendingRequest); assert.equal(app.ui().pendingRequest.runAfter,true); assert.equal(app.ui().simulation,null);
  await app.click('confirm-focus',{focus:'legs'});
  assert.equal(app.ui().pendingRequest,null); assert.equal(app.ui().simulation.intent.focus,'legs'); assert.equal(app.ui().playing,true);
});

test('manual start, extra rest and finish preserve active training and advance the plan', async () => {
  const app=mount(); app.click('start',{station:'hack-squat'}); assert.equal(user(app).currentStationId,'hack-squat');
  const release=station(app,'hack-squat').releaseAt; app.click('rest',{station:'hack-squat'});
  assert.equal(station(app,'hack-squat').releaseAt,release+60); assert.equal(user(app).currentStationId,'hack-squat');
  await app.submit('Upper body 20 minutes'); assert.match(app.html(),/Finish your current exercise/); assert.equal(app.ui().intent.focus,'legs');
  app.click('finish',{station:'hack-squat'}); assert.equal(user(app).completed.length,1); assert.equal(station(app,'hack-squat').state,'free');
  assert.equal(user(app).planned[0],'leg_curl'); assert.match(app.html(),/Seated leg curl/);
});

test('station controls and keyboard dialog access still change actual availability', () => {
  const app=mount(); app.click('station-detail',{station:'hack-squat'}); assert.equal(app.ui().modal,'station:hack-squat');
  assert.match(app.modalHtml(),/id="station-status"/); app.change('station-status','unknown',{station:'hack-squat'});
  assert.equal(station(app,'hack-squat').state,'unknown'); assert.match(app.modalHtml(),/Unconfirmed/); app.click('close');
  let prevented=false; app.key('Enter',{target:{matches:()=>true,dataset:{station:'leg-press'}},preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.equal(app.ui().modal,'station:leg-press'); app.key('Escape'); assert.equal(app.ui().modal,null);
});

test('disabled playback actions cannot start a second exercise', async () => {
  const app=mount(); await app.click('simulate');
  if(app.ui().pendingRequest)await app.click('confirm-focus',{focus:'legs'});
  assert.equal(app.ui().playing,true); const accepted=app.state().stats.accepted;
  app.click('start',{station:'hack-squat'},{disabled:true}); assert.equal(app.state().stats.accepted,accepted); assert.equal(user(app).currentStationId,null);
});

test('the product explains learned focus classification, rule fields and synthetic scheduling honestly', () => {
  const app=mount(); app.click('about');
  assert.match(app.modalHtml(),/trained|learned/i); assert.match(app.modalHtml(),/recognises your training focus|classif/i);
  assert.match(app.modalHtml(),/deterministic scheduler/); assert.match(app.modalHtml(),/synthetic/); assert.match(app.modalHtml(),/trainer review/);
  assert.doesNotMatch(app.modalHtml(),/connected model interprets your request|Offline mode uses a limited local parser/);
});

test('standalone bundle includes the trained model and plans without network, imports or credentials', async () => {
  await promisify(execFile)(process.execPath,['build-offline.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url))});
  const offlineHtml=await readFile(new URL('../NextSet Flow Demo.html',import.meta.url),'utf8');
  assert.doesNotMatch(offlineHtml,/OPENAI_API_KEY|sk-proj-|<script[^>]+src=|<link\s+rel="stylesheet"|\bfetch\(|\bimport\(/);
  assert.match(offlineHtml,/nextset-tfidf-logreg-v1/);
  const bundled=offlineHtml.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]; assert.ok(bundled);
  const app=mount({code:bundled}); assert.match(app.html(),/Local model ready/); assert.match(app.html(),/ENTRANCE/);
  await app.submit('Upper body 20 minutes'); assert.match(app.html(),/Upper body/); assert.equal(app.fetchCalls.length,0);
});
