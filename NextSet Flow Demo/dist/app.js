import { dispatch, getRecommendations, EXERCISES } from './engine.js';
import { parseWorkoutRequest, samplePrompts } from './intent.js';
import { planWorkoutLocally } from './local-planner.js';
import { createPlanState, getPlanProjection, createSimulation, advanceSimulation, buildAislePath } from './planner.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const clock = (s) => `${String(Math.floor(Math.max(0,s)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,s)%60)).padStart(2,'0')}`;
const length = (s) => s < 60 ? `${Math.ceil(s)} sec` : `${Math.round(s/60*10)/10} min`;
const focusNames = {legs:'Legs',upper:'Upper body',full:'Full body',push:'Push',pull:'Pull'};
const initialPrompt = 'I want to train legs for 30 minutes.';
let requestText = initialPrompt;
let plannedText = initialPrompt;
let intent = parseWorkoutRequest(initialPrompt).intent;
let state = createPlanState(intent);
let simulation = null;
let playing = false;
let speed = 15;
let simulationCarry = 0;
let modal = null;
let modalFocus = null;
let busy = false;
let pendingRequest = null;
let submitted = false;
let formMessage = '';
let updateNotice = '';
let alternativesOpen = false;
let previousPosition = {x:50,y:95};
let requestSequence = 0;
const user = () => state.users.find((u) => u.id === 'neeka');
const station = (id) => state.stations.find((s) => s.id === id);
const activeStation = () => state.stations.find((s) => s.occupantId === 'neeka' && user().currentStationId === s.id);
const projection = () => getPlanProjection(state,'neeka');
const statusName = (s) => s.state === 'free' ? 'Free' : s.state === 'occupied' ? 'In use' : s.state === 'unknown' ? 'Check status' : 'Offline';

function notify(message) {
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `${icon('check')}<span>${esc(message)}</span>`;
  $('#toast-region').replaceChildren(el); setTimeout(() => el.remove(),4500);
}

function confirmationMarkup(){
  if(!pendingRequest)return '';
  return `<div class="focus-confirmation" aria-label="Confirm your training focus"><span>Choose your focus to continue</span><div>${Object.entries(focusNames).map(([focus,label])=>`<button type="button" data-action="confirm-focus" data-focus="${focus}">${label}</button>`).join('')}</div></div>`;
}

function composerMarkup() {
  return `<section class="intro"><div><span class="eyebrow">LESS WAITING. MORE WORKOUT.</span><h1>Tell us your goal.<br><span>We’ll find your flow.</span></h1><p>A workout that moves with you, even when the gym changes.</p></div><div class="intro-note"><span class="mini-orbit">${icon('flow')}</span><strong>One plan. Always adapting.</strong><span>Goal → equipment → route → live updates</span></div></section>
  <section class="composer" aria-label="Plan your workout"><form id="workout-form"><label for="workout-request">What would you like to train today?</label><div class="input-line"><textarea id="workout-request" rows="2" maxlength="1200" placeholder="I have 30 minutes. I want to train legs, mostly machines, and avoid queues." ${busy?'disabled':''}>${esc(requestText)}</textarea><button type="submit" class="primary-button" ${busy?'disabled':''}>${busy?'<span class="spinner"></span>Planning…':`Plan my workout${icon('arrow')}`}</button></div></form><div class="composer-bottom"><div class="sample-prompts">${['Legs · 30 min','Upper body · 20 min','中文示例'].map((label,i)=>`<button data-action="example" data-index="${i}" ${busy?'disabled':''}>${label}</button>`).join('')}</div><span class="connection is-connected"><i></i>Local model ready</span></div>${formMessage?`<div class="form-message" role="status">${icon('flow')}<span>${esc(formMessage)}</span></div>`:''}${confirmationMarkup()}</section>`;
}

function simulationMarkup() {
  const elapsed = simulation?.elapsed || 0, completed = simulation?.completed;
  return `<section class="simulation-bar" aria-label="Full demonstration"><div class="simulation-intro"><span class="simulation-icon">${icon('play')}</span><div><strong>${simulation?completed?'Simulation complete':'Your workout, playing live':'See the whole experience'}</strong><p>${simulation?'Watch your location, station times and plan update together.':'One click: arrive → train → someone runs late → your plan adapts.'}</p></div></div><div class="simulation-actions">${simulation?`<span class="sim-clock">${clock(elapsed)} <small>elapsed</small></span><select id="speed-select" aria-label="Simulation speed">${[5,15,30].map(s=>`<option value="${s}" ${speed===s?'selected':''}>${s}× speed</option>`).join('')}</select>${!completed?`<button class="round-button" data-action="toggle-play" aria-label="${playing?'Pause':'Resume'} simulation">${icon(playing?'pause':'play')}</button>`:''}`:''}<button class="simulation-button" data-action="simulate" ${busy?'disabled':''}>${icon(simulation?'reset':'play')}${simulation?'Replay simulation':'Run full simulation'}</button></div></section>`;
}

function machineShape(s) {
  if(s.id==='treadmill')return '<path d="M-23 10h43l-9-21H-8m-8 21-5 9m35-9 5 9M-7-11l2-9h16"/>';
  if(['dumbbell-bench','goblet-zone'].includes(s.id))return '<path d="M-23 4h46M-16 5l-5 14m38-14 5 14M-12-17v13m24-13v13m-24-6h24m-28-4v9m32-9v9"/>';
  if(['leg-press','hack-squat'].includes(s.id))return '<path d="m-22 18 16-34m22 34-7-28M-27 18h53M-4-15l18 5 9 20M-13 4l17 5 8-14m-25 14 13 4m-21-27v13m-6-10v7"/>';
  return '<path d="M-22 18v-35h38v35M-29 18h57M-12 7H9V-9H-6m-5 16v11m26-35 10 6v24M-18-10h12"/>';
}
const point = (p) => `${p.x*10},${p.y*6.4}`;
const pathData = (points=[]) => points.map((p,i)=>`${i?'L':'M'}${point(p)}`).join(' ');

function floorMarkup(id='main-floor') {
  const plan = projection(),rec=user().currentRecommendation;
  const pos=simulation?.userPosition || user().position || {x:50,y:95};
  const next=plan.steps.find(s=>s.status==='next') || plan.steps[0];
  const paths=plan.steps.map((step,i)=>`<path d="${pathData(step.path || buildAislePath(step.from,step.to))}" class="route ${i===0?'route-current':'route-future'}" marker-end="url(#arrow-${id})"/>`).join('');
  return `<div class="floor-scroll"><svg class="floor-plan" viewBox="0 0 1000 710" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">Live gym floor plan</title><desc id="${id}-desc">Entrance at the bottom. Twelve labelled stations show availability. A highlighted route links the exercises in your plan.</desc><defs><pattern id="grid-${id}" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#dce3d5"/></pattern><marker id="arrow-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 1 9 5 0 9" fill="none" stroke="#7c9f52" stroke-width="1.7"/></marker></defs>
  <rect x="20" y="20" width="960" height="620" rx="22" fill="#f4f5ee"/><rect x="24" y="24" width="952" height="612" rx="20" fill="url(#grid-${id})"/><path class="gym-wall" d="M450 640H42Q20 640 20 618V42Q20 20 42 20H958Q980 20 980 42V618Q980 640 958 640H550"/>
  <rect class="zone-fill" x="70" y="72" width="880" height="136" rx="15"/><rect class="zone-fill" x="70" y="252" width="880" height="136" rx="15"/><rect class="zone-fill" x="70" y="432" width="880" height="136" rx="15"/>
  <text class="zone-label" x="91" y="57">LOWER BODY</text><text class="zone-label" x="91" y="237">UPPER BODY</text><text class="zone-label" x="91" y="417">FUNCTIONAL / FREE WEIGHTS</text><text class="zone-label" x="808" y="417">CARDIO</text><g class="routes">${paths}</g>
  ${state.stations.map((s,index)=>{
    const stepIndex=plan.steps.findIndex(step=>step.stationId===s.id),isNext=rec?.stationId===s.id,isYou=s.occupantId==='neeka';
    const sub=s.state==='occupied'?s.releaseAt>state.now?`~${clock(s.releaseAt-state.now)} left`:'Awaiting confirmation':s.state==='free'?'Ready to use':s.state==='unknown'?'Availability unconfirmed':'Out of service';
    return `<g class="map-station ${s.state} ${isNext?'recommended':''} ${isYou?'is-you':''}" transform="translate(${s.x*10} ${s.y*6.4})" role="button" tabindex="0" aria-label="${esc(s.name)}, ${statusName(s)}, ${esc(sub)}" data-action="station-detail" data-station="${s.id}"><rect class="station-tile" x="-80" y="-52" width="160" height="109" rx="13"/><text class="station-number" x="-66" y="-35">${String(index+1).padStart(2,'0')}</text><circle class="station-status-dot" cx="63" cy="-36" r="4"/><g class="machine-symbol" transform="translate(0 -15)">${machineShape(s)}</g><text class="station-name" y="20" text-anchor="middle">${esc(s.name)}</text><text class="station-state" y="37" text-anchor="middle">${isYou?'You · training':statusName(s)}</text><text class="station-estimate" y="49" text-anchor="middle">${esc(sub)}</text>${stepIndex>=0?`<g class="route-number" transform="translate(-76 -52)"><circle r="12"/><text y="4" text-anchor="middle">${stepIndex+1}</text></g>`:''}</g>`;
  }).join('')}
  <path d="M450 640v-34m100 34v-34" stroke="#b1bea8" stroke-width="3"/><path d="m476 655 24-16 24 16" fill="none" stroke="#a2b78a" stroke-width="2"/><text x="500" y="687" text-anchor="middle" class="entrance-label">ENTRANCE</text>
  <g class="you-position" transform="translate(${pos.x*10} ${pos.y*6.4})"><animateTransform attributeName="transform" type="translate" from="${previousPosition.x*10} ${previousPosition.y*6.4}" to="${pos.x*10} ${pos.y*6.4}" dur=".28s" fill="freeze"/><circle class="you-halo" r="21"/><circle class="you-dot" r="11"/><circle r="3" fill="#fff"/><rect x="-21" y="-41" width="42" height="20" rx="10"/><text y="-27" text-anchor="middle">YOU</text></g>
  </svg></div><p class="map-scroll-hint">Swipe the map to explore the floor →</p><div class="map-legend"><span><i class="free-dot"></i>Free</span><span><i class="busy-dot"></i>In use</span><span><i class="unknown-dot"></i>Unconfirmed</span><span class="legend-route">— Your route</span></div>${next?`<div class="map-direction">${icon('map')}<span>${activeStation()?`You’re at <strong>${esc(activeStation().name)}</strong>.`:`From ${pos.x===50&&pos.y===95?'the entrance':'your location'}, head to <strong>${esc(next.stationName)}</strong>.`} ${!activeStation()?`About ${length(next.walkSeconds)} walk.`:''}</span></div>`:''}`;
}

function recommendationMarkup() {
  const member=user(),active=activeStation(),rec=member.currentRecommendation;
  const complete=!active&&(!member.planned.length||member.remainingSeconds<=0);
  if(!active&&!rec)return `<section class="next-card empty-card"><span class="eyebrow">${complete?'ALL DONE':'LET’S CHECK THE FLOOR'}</span><h2>${complete?'A good session.<br>Nicely done.':'No clear next move yet.'}</h2><p>${complete?'Your session is complete. Try a different goal or replay the full experience.':'No confirmed station fits right now. Check a station or adjust your request.'}</p><button class="light-button" data-action="${complete?'reset':'floor'}">${complete?'Try another session':'Check the floor'}${icon('arrow')}</button></section>`;
  const s=active||station(rec.stationId),free=s.state==='free';
  const title=active?EXERCISES[member.activeExerciseId]?.name||s.name:rec.exerciseName;
  const reason=active?'Keep your focus here. The rest of your plan adapts around you.':rec.isAlternative?`${EXERCISES[rec.targetExerciseId]?.name} is busy. This movement alternative keeps you going.`:free?'This planned movement is available and fits your time.':`Estimated ${length(rec.waitSeconds)} wait. Your plan will update if availability changes.`;
  return `<section class="next-card"><div class="next-card-top"><span class="eyebrow">${active?'RIGHT NOW':'YOUR NEXT MOVE'}</span><span class="next-state"><i></i>${active?'Training':free?'Free now':'Estimated wait'}</span></div><h2>${esc(title)}</h2><p>${esc(reason)}</p><div class="next-facts"><span>${icon('clock')}${active?`${clock(s.releaseAt-state.now)} est. remaining`:`${length(rec.durationSeconds)} exercise`}</span><span>${icon('map')}${esc(s.zone)}</span></div><div class="next-actions"><button class="light-button" data-action="${active?'finish':'start'}" data-station="${s.id}" ${playing?'disabled':''}>${active?'Finish exercise':free?'Start exercise':'Choose this station'}${icon(active?'check':'arrow')}</button><button class="dark-text-button" data-action="${active?'rest':'alternatives'}" data-station="${s.id}" ${playing?'disabled':''}>${active?'+1 min rest':'Other options'}</button></div></section>`;
}

function timelineMarkup() {
  const plan=projection(),member=user();
  return `<section class="timeline-card"><div class="section-heading"><div><span class="eyebrow">YOUR LIVE PLAN</span><h2>${focusNames[intent.focus]} <span>· ${intent.minutes} min window</span></h2></div><span class="estimated-finish">~${clock(plan.finishAt)}<small>finish estimate</small></span></div><ol class="timeline">${member.completed.map(item=>`<li class="done-step"><span class="step-number">${icon('check')}</span><div><strong>${esc(EXERCISES[item.exerciseId]?.name||EXERCISES[item.targetExerciseId]?.name||'Exercise')}</strong><small>Completed</small></div></li>`).join('')}${plan.steps.map((step,i)=>`<li class="${i===0?'current-step':''}"><span class="step-number">${member.completed.length+i+1}</span><div><div class="step-title"><strong>${esc(step.exerciseName)}</strong><span>${clock(step.startAt)}–${clock(step.endAt)}</span></div><small>${step.status==='active'?'In progress':i===0?'Next':'Forecast'} · ${length(step.durationSeconds)}${step.waitSeconds?` · ~${length(step.waitSeconds)} wait`:''}${step.isAlternative?` · replaces ${esc(EXERCISES[step.targetExerciseId]?.name)}`:''}</small></div></li>`).join('')}</ol>${plan.unplannedExercises?.length?`<p class="plan-note">${plan.unplannedExercises.length} movement${plan.unplannedExercises.length>1?'s':''} need more time or confirmed equipment.</p>`:''}<p class="forecast-note">${icon('flow')}Timings update live. Later steps are forecasts; stations aren’t reserved.</p></section>`;
}

function alternativesMarkup() {
  if(!alternativesOpen||activeStation())return '';
  const candidates=getRecommendations(state,'neeka').filter(r=>r.stationId!==user().currentRecommendation?.stationId).slice(0,3);
  return `<section class="alternatives"><div class="section-heading"><h2>Other options</h2><button class="text-button" data-action="alternatives">Close${icon('close')}</button></div><div class="alternative-list">${candidates.map(r=>`<button data-action="start" data-station="${r.stationId}" ${r.assignedTo?'disabled':''}><span>${icon('dumbbell')}<strong>${esc(r.exerciseName)}</strong></span><small>${r.assignedTo?'Suggested to another member':r.waitSeconds?`~${length(r.waitSeconds)} wait`:'Free now'}</small>${icon('arrow')}</button>`).join('')||'<p>No other confirmed alternative fits right now.</p>'}</div></section>`;
}

function updateMarkup() {
  const latest=simulation?.latestUpdate,message=updateNotice||latest?.message;
  if(!message)return '';
  return `<section class="live-update" role="status"><span class="update-icon">${icon('flow')}</span><div><span class="eyebrow">${latest?'LIVE OPTIMISATION':'PLAN UPDATED'}</span><strong>${esc(updateNotice?'Your next move has changed':latest.title||'Your plan has adapted')}</strong><p>${esc(message)}</p></div><span class="update-time">${clock(state.now)}</span></section>`;
}

function render() {
  const focused=document.activeElement?.id,input=$('#workout-request');
  const start=input?.selectionStart,end=input?.selectionEnd;
  $('#workout').innerHTML=`${composerMarkup()}${simulationMarkup()}<div class="plan-summary"><div><span class="focus-chip">${icon('dumbbell')}${focusNames[intent.focus]}</span><span>${intent.minutes} min available</span><span>${intent.experience}</span>${intent.preferences.avoidWaiting?'<span>Avoid queues</span>':''}${intent.preferences.preferMachines?'<span>Mostly machines</span>':''}</div><small>${submitted?intent.source==='user-confirmed-local-classifier'?'Focus confirmed by you · planned on this device':'Focus recognised by our local model':'Example session · edit the request above'}</small></div>${updateMarkup()}<div class="workspace"><section class="map-card"><div class="section-heading"><div><span class="eyebrow">KNOW WHERE TO GO</span><h2>Your gym, live.</h2></div><span class="floor-live"><i></i>${state.stations.filter(s=>s.state==='free').length} free · ${state.stations.filter(s=>s.state==='occupied').length} in use</span><button class="round-button expand-floor" data-action="floor" aria-label="Expand gym floor">${icon('map')}</button></div>${floorMarkup()}</section><aside class="plan-column">${recommendationMarkup()}${timelineMarkup()}</aside></div>${alternativesMarkup()}${simulation?`<section class="simulation-story"><div class="section-heading"><h2>The story so far</h2><span class="phase-chip">${esc(simulation.phase)}</span></div><p class="narration">${esc(simulation.narration||'Your session is ready at the entrance.')}</p><div class="event-strip">${(simulation.events||[]).slice(-4).reverse().map(e=>`<article><time>${clock(e.at)}</time><strong>${esc(e.title||e.type)}</strong><p>${esc(e.message)}</p></article>`).join('')}</div></section>`:''}<p class="demo-footnote">Simulated gym data · Movement alternatives are illustrative and await trainer review.</p>`;
  if(focused){const target=document.getElementById(focused);target?.focus({preventScroll:true});if(focused==='workout-request'&&target?.setSelectionRange&&start!==undefined)target.setSelectionRange(start,end);}
  previousPosition={...(simulation?.userPosition||user().position||{x:50,y:95})};
  if(modal)renderModal();
}

function stopSimulation(){playing=false;simulation=null;simulationCarry=0;}
function updateState(action){
  stopSimulation();const before=user().currentRecommendation?.stationName;state=dispatch(state,action);
  const after=user().currentRecommendation?.stationName;
  updateNotice=before&&after&&before!==after?`${before} is no longer the best next option. Head to ${after}; the route and timings have been updated.`:'';render();
}
function reset(){requestSequence++;stopSimulation();pendingRequest=null;busy=false;requestText=initialPrompt;plannedText=initialPrompt;intent=parseWorkoutRequest(initialPrompt).intent;state=createPlanState(intent);submitted=false;formMessage='';updateNotice='';alternativesOpen=false;previousPosition={x:50,y:95};closeModal();render();}
function beginSimulation(){pendingRequest=null;simulation=createSimulation(intent);state=simulation.state;simulationCarry=0;playing=true;updateNotice='';alternativesOpen=false;previousPosition={x:50,y:95};closeModal();render();}

async function planRequest(runAfter=false,confirmedFocus=null) {
  if(busy)return;
  if(activeStation()&&!simulation){pendingRequest=null;formMessage='Finish your current exercise before starting a new session.';render();return;}
  requestText=$('#workout-request')?.value?.trim()||requestText.trim();
  if(!requestText){pendingRequest=null;formMessage='Tell us your training focus and the time you have.';render();return;}
  const sequence=++requestSequence;busy=true;playing=false;formMessage='';render();
  try {
    const result=planWorkoutLocally(requestText,confirmedFocus?{confirmedFocus}:{});
    if(sequence!==requestSequence)return;
    if(!result.ok){
      pendingRequest=result.needsFocusConfirmation?{text:requestText,runAfter}:null;
      formMessage=result.clarification||'Please give a clear training focus and a time between 5 and 90 minutes.';
      return;
    }
    pendingRequest=null;intent=result.intent;state=createPlanState(intent);simulation=null;plannedText=requestText;submitted=true;alternativesOpen=false;updateNotice='';previousPosition={x:50,y:95};
    if(result.warnings?.length)formMessage=result.warnings.join(' ');
    if(runAfter)beginSimulation();
  }catch{
    pendingRequest=null;formMessage='The local model could not interpret this request. Try a shorter description.';
  }finally{if(sequence===requestSequence){busy=false;render();}}
}

function openModal(kind){modalFocus=document.activeElement;modal=kind;renderModal();$('#modal-root .close-modal')?.focus();}
function closeModal(){modal=null;$('#modal-root').replaceChildren();document.body.style.overflow='';if(modalFocus?.isConnected)modalFocus.focus({preventScroll:true});}
function renderModal(){
  if(!modal)return;let title,content;
  if(modal==='floor'){title='The gym floor';content=floorMarkup('expanded-floor');}
  else if(modal.startsWith('station:')){
    const s=station(modal.slice(8));title=s.name;
    content=`<span class="detail-status ${s.state}">${statusName(s)}</span><p>${esc(s.zone)} · ${s.state==='occupied'?'Estimated availability is a forecast until someone confirms they have finished.':'Select a status to simulate a change on the floor.'}</p><label class="field-label">Demo station status<select id="station-status" data-station="${s.id}" ${playing?'disabled':''}>${[['free','Free'],['occupied','In use'],['unknown','Unconfirmed'],['unavailable','Out of service']].map(([value,label])=>`<option value="${value}" ${s.state===value?'selected':''}>${label}</option>`).join('')}</select></label>${s.occupantId?`<div class="detail-actions"><button class="secondary-button" data-action="rest" data-station="${s.id}" ${playing?'disabled':''}>+1 min rest</button><button class="primary-button" data-action="finish" data-station="${s.id}" ${playing?'disabled':''}>Confirm finished${icon('check')}</button></div>`:''}<button class="text-button back-floor" data-action="floor">Back to floor${icon('arrow')}</button>`;
  }else{title='A workout that moves with you';content='<p>Describe what you want to train. NextSet Flow interprets your goal, then builds a route using the equipment available.</p><p>When someone takes longer or you need extra rest, the scheduler recalculates the remaining session and explains the change.</p><p>This prototype uses synthetic people, equipment states and timing. Every browser runs its own simulation. Equipment suggestions are advisory, and exercise alternatives need trainer review before real use.</p><p>Our small trained model recognises your training focus on this device. It may ask you to confirm uncertain requests. Time, preferences and exclusions use explicit parsing rules; live equipment allocation uses a deterministic scheduler. No external model API is called.</p>';}
  $('#modal-root').innerHTML=`<div class="modal-backdrop" data-backdrop="true"><section class="modal ${modal==='floor'?'floor-modal':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><span class="eyebrow">NEXTSET FLOW</span><h2 id="modal-title">${esc(title)}</h2></div><button class="round-button close-modal" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-content">${content}</div></section></div>`;document.body.style.overflow='hidden';
}

document.addEventListener('input',event=>{if(event.target.id==='workout-request'){requestText=event.target.value;if(pendingRequest){pendingRequest=null;formMessage='';render();}}});
document.addEventListener('submit',event=>{if(event.target.id==='workout-form'){event.preventDefault();return planRequest();}});
document.addEventListener('click',event=>{
  if(event.target.matches('[data-backdrop]')){closeModal();return;}
  const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
  const action=el.dataset.action,id=el.dataset.station;
  if(action==='reset')reset();
  else if(action==='floor'||action==='about')openModal(action);
  else if(action==='station-detail')openModal('station:'+id);
  else if(action==='close')closeModal();
  else if(action==='example'){requestText=samplePrompts[Number(el.dataset.index)];pendingRequest=null;formMessage='';render();$('#workout-request')?.focus();}
  else if(action==='confirm-focus'){
    const current=$('#workout-request')?.value?.trim()||requestText.trim();
    if(!pendingRequest||current!==pendingRequest.text){pendingRequest=null;formMessage='Your request changed. Please plan it again.';render();return;}
    return planRequest(pendingRequest.runAfter,el.dataset.focus);
  }
  else if(action==='simulate'){const text=$('#workout-request')?.value?.trim()||requestText;if(!submitted||text!==plannedText){requestText=text;return planRequest(true);}else beginSimulation();}
  else if(action==='toggle-play'){playing=!playing;render();}
  else if(action==='alternatives'){alternativesOpen=!alternativesOpen;render();}
  else if(action==='rest'){updateState({type:'EXTEND',stationId:id,seconds:60});notify('Extra rest added. Remaining timings have updated.');}
  else if(action==='finish'){updateState({type:'FINISH',stationId:id});closeModal();notify('Exercise finished. Your next step is ready.');}
  else if(action==='start'){updateState({type:'ACCEPT',userId:'neeka',stationId:id});alternativesOpen=false;render();}
});
document.addEventListener('change',event=>{if(event.target.id==='speed-select')speed=Number(event.target.value);else if(event.target.id==='station-status')updateState({type:'SET_STATUS',stationId:event.target.dataset.station,status:event.target.value});});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&modal)closeModal();
  if((event.key==='Enter'||event.key===' ')&&event.target?.matches?.('.map-station')){event.preventDefault();openModal('station:'+event.target.dataset.station);}
  if(event.key==='Tab'&&modal){const elements=[...document.querySelectorAll('#modal-root button:not([disabled]), #modal-root select:not([disabled]), #modal-root [tabindex="0"]')];const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
setInterval(()=>{if(playing&&simulation&&!document.hidden){simulationCarry+=speed/4;const seconds=Math.floor(simulationCarry);simulationCarry-=seconds;simulation=advanceSimulation(simulation,seconds);state=simulation.state;if(simulation.completed)playing=false;render();}},250);
render();
