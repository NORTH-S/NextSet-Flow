import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {classifyText} from '../runtime/classifier.js';

const html=await readFile(new URL('../Try NextSet Classifier.html',import.meta.url),'utf8');
const model=JSON.parse(await readFile(new URL('../model/model.json',import.meta.url),'utf8'));
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

function mount(){
  const elements=new Map(),examples=[];
  const element=()=>({value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},dataset:{},children:[],listeners:{},classList:{toggle(){},add(){}},
    addEventListener(type,callback){this.listeners[type]=callback;},focus(){},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
    querySelector(selector){this.nested??=new Map();if(!this.nested.has(selector))this.nested.set(selector,element());return this.nested.get(selector);}});
  const get=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const document={querySelector:get,querySelectorAll:()=>examples,createElement:element};
  const context={document,console,performance:{now:()=>Date.now()},location:{protocol:'file:'},fetch(){throw Error('Offline demo attempted a network request');}};
  vm.runInNewContext(scripts[0],context);
  return {get,async submit(text){get('#request').value=text;get('#classify-form').listeners.submit({preventDefault(){}});await new Promise(setImmediate);}};
}

test('delivered HTML embeds the learned model and runs under file protocol without network/module loading',async()=>{
  assert.equal(scripts.length,1);
  assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+rel="stylesheet"|\bfetch\(|\bimport\(/);
  const app=mount();assert.match(app.get('#model-status').innerHTML,/Model ready.*offline/);
  assert.equal(app.get('#classify-button').disabled,false);
  const query='I want to train legs.';await app.submit(query);
  const expected=classifyText(query,model);
  assert.equal(app.get('#empty-result').hidden,true);
  assert.equal(app.get('#result-content').hidden,false);
  assert.equal(app.get('#candidate-list').children.length,3);
  assert.match(app.get('#inference-time').textContent,/local/);
  if(expected.needsClarification)assert.equal(app.get('#prediction-label').textContent,'Let’s narrow it down.');
  else assert.equal(app.get('#prediction-label').textContent,'Legs');
  assert.equal(app.get('#classified-request').textContent,query);
});

test('offline classification preserves untrusted input as text and handles missing requests',async()=>{
  const app=mount();await app.submit('   ');
  assert.match(app.get('#input-message').textContent,/Write a short workout request/);
  const query='</blockquote><script>globalThis.untrustedExecuted=true</script> legs';
  await app.submit(query);assert.equal(app.get('#classified-request').textContent,query);
  assert.equal(app.get('#input-message').textContent,'');
});
