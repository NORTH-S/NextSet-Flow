const $ = (selector) => document.querySelector(selector);
const LABELS = {
  legs: { name: 'Legs', detail: 'A lower-body training request.' },
  upper: { name: 'Upper body', detail: 'A general upper-body training request.' },
  full: { name: 'Full body', detail: 'A whole-body training request.' },
  push: { name: 'Push', detail: 'A pushing-focused training request.' },
  pull: { name: 'Pull', detail: 'A pulling-focused training request.' },
  clarify: { name: 'Clarify the request', detail: 'Ask the user to choose a clear training focus before planning.' },
  unsupported: { name: 'Outside this demo', detail: 'This request needs support beyond the classifier’s defined training categories.' },
};
const EXAMPLES = {
  legs: 'I have 30 minutes and want to train legs. Mostly machines, with less waiting.',
  chinese: '今天不练腿，想做上半身训练。我有二十分钟。',
  unclear: 'I have some time at the gym, but I have not decided what to train.',
};
let model = null;
let classifyText = null;
let busy = false;
let runId = 0;

function labelName(value) { return LABELS[value]?.name || String(value || 'Unknown label'); }
function probability(value) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function updateCount() { $('#character-count').textContent = `${$('#request').value.length.toLocaleString('en-GB')} / 1,200`; }
function setBusy(value) {
  busy = value;
  const button = $('#classify-button');
  button.disabled = value || !model || !classifyText;
  button.classList.toggle('is-busy', value);
  button.querySelector('span').textContent = value ? 'Classifying…' : 'Classify my request';
}

function renderResult(result, text, elapsed) {
  const label = result.label || result.topLabel || 'clarify';
  const clarification = Boolean(result.needsClarification) || label === 'clarify' || label === 'unsupported';
  $('#empty-result').hidden = true;
  $('#result-content').hidden = false;
  const decision = $('#decision-status');
  decision.textContent = label === 'unsupported' ? 'Outside supported scope' : clarification ? 'Follow-up needed' : 'Intent identified';
  decision.classList.toggle('is-clarification', clarification);
  $('#prediction-label').textContent = clarification && label !== 'unsupported' ? 'Let’s narrow it down.' : labelName(label);
  $('#prediction-detail').textContent = typeof result.reason === 'string' && result.reason.trim() ? result.reason : LABELS[label]?.detail || 'Review this request before continuing.';
  $('#classified-request').textContent = text;
  $('#inference-time').textContent = `${elapsed < 1 ? '<1' : Math.round(elapsed)} ms · local`;

  const candidates = Array.isArray(result.candidates) ? result.candidates.slice(0, 3) : [];
  const items = candidates.map((candidate) => {
    const item = document.createElement('li');
    const top = document.createElement('div'); top.className = 'candidate-row-top';
    const name = document.createElement('span'); name.textContent = labelName(candidate.label);
    const score = document.createElement('span'); score.textContent = `${(probability(candidate.probability) * 100).toFixed(1)}%`;
    const track = document.createElement('div'); track.className = 'score-track';
    const fill = document.createElement('span'); fill.className = 'score-fill'; fill.style.width = `${probability(candidate.probability) * 100}%`;
    top.append(name, score); track.append(fill); item.append(top, track);
    return item;
  });
  $('#candidate-list').replaceChildren(...items);
  $('#raw-top-label').textContent = result.topLabel && result.topLabel !== label ? `Highest-scoring learned class: ${labelName(result.topLabel)}. The confidence gate asks for clarification.` : '';
}

async function runClassification() {
  if (busy || !model || !classifyText) return;
  const text = $('#request').value.trim();
  if (!text) { $('#input-message').textContent = 'Write a short workout request first.'; $('#request').focus(); return; }
  if (text.length > 1200) { $('#input-message').textContent = 'Please keep the request within 1,200 characters.'; return; }
  const current = ++runId;
  $('#input-message').textContent = '';
  setBusy(true);
  const start = performance.now();
  try {
    const result = await classifyText(text, model);
    if (current !== runId) return;
    if (!result || typeof result !== 'object') throw new Error('Invalid classification output');
    renderResult(result, text, performance.now() - start);
  } catch {
    $('#input-message').textContent = 'This request could not be classified. Try a shorter description, or review the model files and README.';
  } finally { if (current === runId) setBusy(false); }
}

$('#classify-form').addEventListener('submit', (event) => { event.preventDefault(); void runClassification(); });
$('#request').addEventListener('input', () => { updateCount(); $('#input-message').textContent = ''; });
$('#request').addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void runClassification(); } });
document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    $('#request').value = EXAMPLES[button.dataset.example] || '';
    updateCount(); $('#input-message').textContent = ''; $('#request').focus();
    void runClassification();
  });
});

try {
  if (globalThis.location?.protocol === 'file:') throw new Error('Local file protocol');
  const [runtime, response] = await Promise.all([import('../runtime/classifier.js'), fetch('../model/model.json', { cache: 'no-cache' })]);
  if (!response.ok || typeof runtime.classifyText !== 'function') throw new Error('Model unavailable');
  model = await response.json();
  classifyText = runtime.classifyText;
  $('#model-status').innerHTML = '<i></i>Model ready';
  setBusy(false);
} catch {
  const status = $('#model-status'); status.classList.add('is-error');
  status.innerHTML = '<i></i>Model not loaded';
  $('#input-message').textContent = 'Open this preview through the local server described in README, after training has created model/model.json. A double-clicked HTML file cannot load the model modules.';
}
updateCount();
