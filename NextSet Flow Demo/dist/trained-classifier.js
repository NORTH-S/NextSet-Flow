// Portable inference only. All feature weights are learned and exported by train.py.
const cache = new WeakMap();
export const labelNames = {legs:'Legs / 腿部',upper:'Upper body / 上半身',full:'Full body / 全身',push:'Push / 推类',pull:'Pull / 拉类',clarify:'Please clarify / 需要澄清',unsupported:'Outside scope / 超出范围'};
export function normalize(text) { return text.normalize('NFKC').toLowerCase().replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu,' ').replace(/^ +| +$/g,''); }
function grams(text, analyzer, low, high) {
  const units=analyzer==='char'?Array.from(text):Array.from(text.matchAll(/[a-z0-9_]{2,}/g),m=>m[0]);
  const counts=new Map();
  for(let n=low;n<=high;n++)for(let i=0;i<=units.length-n;i++){
    const term=units.slice(i,i+n).join(analyzer==='char'?'':' ');counts.set(term,(counts.get(term)||0)+1);
  }
  return counts;
}
export function vectorize(text,model) {
  if(model.format!=='nextset-tfidf-logreg-v1')throw new Error('Unsupported model format');
  if(!cache.has(model))cache.set(model,model.blocks.map(b=>new Map(b.vocabulary.map((v,i)=>[v,i]))));
  const vocabularies=cache.get(model),features=new Map();let offset=0,known=0,total=0;
  model.blocks.forEach((block,bi)=>{
    const counts=grams(normalize(text),block.analyzer,...block.ngramRange),values=[];let squares=0;
    for(const [term,count] of counts){
      const index=vocabularies[bi].get(term);
      if(block.analyzer==='char'){total+=count;if(index!==undefined)known+=count;}
      if(index!==undefined){const value=(1+Math.log(count))*block.idf[index];values.push([index,value]);squares+=value*value;}
    }
    const norm=Math.sqrt(squares)||1;
    for(const [index,value] of values)features.set(offset+index,value/norm*block.weight);
    offset+=block.vocabulary.length;
  });
  return {features,known:total?known/total:0};
}
export function classifyText(text,model) {
  if(typeof text!=='string'||!normalize(text)||Array.from(text).length>1200)return {label:'clarify',topLabel:null,confidence:0,margin:0,needsClarification:true,candidates:[],knownFeatureFraction:0,reason:'Enter a workout request of 1–1,200 characters.',source:'trained-local-classifier',scoreType:'uncalibrated-softmax'};
  const {features,known}=vectorize(text,model);
  const logits=model.coefficients.map((weights,i)=>{let sum=model.intercept[i];for(const [index,value] of features)sum+=weights[index]*value;return sum;});
  const max=Math.max(...logits),values=logits.map(x=>Math.exp(x-max)),total=values.reduce((a,b)=>a+b,0);
  const candidates=model.labels.map((label,i)=>({label,probability:values[i]/total})).sort((a,b)=>b.probability-a.probability);
  const confidence=candidates[0].probability,margin=confidence-candidates[1].probability,p=model.abstention;
  const uncertain=known<p.minKnownFraction||confidence<p.minConfidence||margin<p.minMargin;
  const label=uncertain?'clarify':candidates[0].label;
  const reason=uncertain?'The model is uncertain. Please state one training focus more clearly.':label==='clarify'?'Please choose one training focus.':label==='unsupported'?'This request is outside the supported gym-focus categories; no workout is prescribed.':'Classified by the trained local model. This is a focus label, not a full workout plan.';
  return {label,topLabel:candidates[0].label,confidence,margin,needsClarification:['clarify','unsupported'].includes(label),candidates,knownFeatureFraction:known,reason,source:'trained-local-classifier',scoreType:'uncalibrated-softmax'};
}
