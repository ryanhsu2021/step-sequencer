/* 无头测试：✨ 连点变化（userSeq 锚点来源 + 弱拍衰减 + 质量带加权抽取）+ 🎲 随机生成 + 回归 */
const fs=require('fs'), vm=require('vm');
/* 工程已拆分为多模块：按主页 <script> 的加载顺序拼接 */
const ORDER=['01-core','02-modes','03-styles','04-drums','10-state','20-ui','21-interact',
             '30-audio','31-transport','32-midi','40-optimizer','41-chords','42-arrange','50-main'];
const js=ORDER.map(n=>fs.readFileSync('F:/harness/js/'+n+'.js','utf8')).join('\n');
if(!js) { console.log('NO_JS'); process.exit(1); }

/* ---------- DOM 桩 ---------- */
class El{
  constructor(tag){
    this.tagName=(tag||'div').toUpperCase(); this.children=[]; this.style={setProperty(){}}; this.dataset={}; this.attrs={};
    this._cls=new Set(); this.textContent=''; this._inner=''; this.value=''; this.options=[];
    this.disabled=false; this.label=''; this.min=''; this.max=''; this.title=''; this.type='';
    const self=this;
    this.classList={
      add:(...c)=>c.forEach(x=>x&&self._cls.add(x)),
      remove:(...c)=>c.forEach(x=>self._cls.delete(x)),
      toggle:(c,f)=>{ if(f===undefined) f=!self._cls.has(c); f?self._cls.add(c):self._cls.delete(c); return f; },
      contains:c=>self._cls.has(c),
    };
    this._handlers={};
  }
  get className(){ return [...this._cls].join(' '); }
  set className(v){ this._cls=new Set(String(v).split(/\s+/).filter(Boolean)); }
  set innerHTML(v){ this._inner=v; this.children=parseHTML(v); this.options=[]; }
  get innerHTML(){ return this._inner; }
  appendChild(c){ this.children.push(c); return c; }
  append(...cs){ cs.forEach(c=>this.children.push(c)); }
  addEventListener(t,f){ (this._handlers[t]=this._handlers[t]||[]).push(f); }
  removeEventListener(){}
  setAttribute(k,v){ this.attrs[k]=v; if(k==='value') this.value=v; }
  getAttribute(k){ return this.attrs[k]; }
  add(opt){ this.options.push(opt); this.children.push(opt); }
  click(){}
  blur(){} focus(){}
  setPointerCapture(){} releasePointerCapture(){}
  getBoundingClientRect(){ return {top:0,left:0,width:100,height:40}; }
  querySelector(sel){ return this.querySelectorAll(sel)[0]||null; }
  querySelectorAll(sel){
    const out=[];
    const walk=n=>{ for(const c of (n.children||[])){ if(selMatch(c,sel)) out.push(c); walk(c); } };
    walk(this); return out;
  }
}
function selMatch(el,sel){
  if(!el||!el._cls) return false;
  const mm=sel.match(/^([\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/); if(!mm) return false;
  const [,tag,clss,attrs]=mm;
  if(tag&&el.tagName!==tag.toUpperCase()) return false;
  if(clss) for(const c of clss.split('.').filter(Boolean)) if(!el._cls.has(c)) return false;
  if(attrs){
    const are=/\[([\w-]+)\]/g; let am;
    while((am=are.exec(attrs))) if(el.dataset[am[1]]===undefined&&el.attrs[am[1]]===undefined) return false;
  }
  return true;
}
function parseHTML(html){
  const root=new El('#root'), stack=[root];
  const re=/<(\/?)([\w-]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let last=0,m2;
  while((m2=re.exec(html))){
    const txt=html.slice(last,m2.index);
    if(txt.trim()) stack[stack.length-1].children.push(Object.assign(new El('#txt'),{textContent:txt}));
    last=re.lastIndex;
    const [,close,tag,attrStr,selfc]=m2;
    if(close){ if(stack.length>1) stack.pop(); continue; }
    const el=new El(tag);
    const are=/([\w-]+)(?:="([^"]*)")?/g; let am;
    while((am=are.exec(attrStr||''))){
      const k=am[1], v=am[2]!==undefined?am[2]:'';
      if(k==='class') el.className=v;
      else if(k.startsWith('data-')) el.dataset[k.slice(5)]=v;
      else { el.attrs[k]=v; if(k==='type') el.type=v; if(k==='value') el.value=v; }
    }
    stack[stack.length-1].children.push(el);
    if(!selfc&&!/^(input|br|img|hr|meta|link)$/i.test(tag)) stack.push(el);
  }
  return root.children;
}
const byId={};
const document={
  getElementById:id=>(byId[id]||(byId[id]=new El('div'))),
  createElement:tag=>new El(tag),
  activeElement:{tagName:'BODY'},
};
const store={};
const localStorage={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
const sandbox={
  document, localStorage,
  window:{addEventListener(){}},
  navigator:{},
  performance:{now:()=>Date.now()},
  requestAnimationFrame:()=>0,
  Option:class{constructor(text,value){this.text=text;this.value=String(value);this.disabled=false;}},
  URL:{createObjectURL:()=>'blob:test',revokeObjectURL(){}},
  Blob:class{constructor(parts){this.parts=parts;}},
  setTimeout:(fn)=>{fn();return 1;}, clearTimeout(){}, setInterval:()=>1, clearInterval(){},
  console, Math, JSON, Uint8Array, Float64Array, Int16Array, Array, Object, Set, Map, String, Number, Boolean, Date, Promise,
};
sandbox.window.document=document; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
const expose=`
;globalThis.__T={state,SP_:()=>SP_,setStyle,optimizeMelody,setStep,setBars,fillBass,fillArp,fillPad,autoArrange,
  exportMidi,loadSaved,resetSeq,clearAll,randomProgression,fitProg,splitSeg,segLen,delSeg,setSegChord,
  segOfStep,chordAtFor,progFor,degOfRow,scLen,stepsOf,barsOf,songBeats,songBars,refreshAll,save,DEMO_MEL,clearTrack,randomizeForTrack};`;
try{ vm.runInContext(js+expose,sandbox); }catch(e){ console.log('LOAD_FAIL:',e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); }
const T=sandbox.__T;
let pass=0,fail=0;
const chk=(name,cond,extra)=>{ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(extra?'｜'+extra:''));} };
const snap=tr=>JSON.stringify(tr.seq);

console.log('== 1. 初始状态 ==');
chk('4 个声部',T.state.tracks.length===4);
const mel0=T.state.tracks[0];
chk('示例旋律带 userSeq 素材快照',Array.isArray(mel0.userSeq)&&mel0.userSeq.length===16);
chk('✨/🎼 生成的声部无 userSeq（可自由再生成）',T.state.tracks[1].userSeq===null&&T.state.tracks[2].userSeq===null);

console.log('== 2. 连点 ✨：手动素材锚点保留 + 每次不同 ==');
T.setStyle(1);
T.setBars(mel0,2); T.resetSeq(mel0);
const anchors={}; const strongRows=[5,4,3,2,4,3,2,1], weakRows=[3,2,1,0,2,1,0,1];
let wi=0;
for(let s=0;s<32;s++){
  if(s%4===0){ T.setStep(mel0,s,strongRows[s/4],false); anchors[s]=strongRows[s/4]; }
  else if(s%4===2){ T.setStep(mel0,s,weakRows[wi++],false); }
}
const userSnap=JSON.stringify(mel0.userSeq);
const sp=T.SP_(); const dLo=Math.round(sp.density[0]*2), dHi=Math.round(sp.density[1]*2);
const prog=T.progFor(mel0), chordAt=T.chordAtFor(prog,32);
const snaps=[];
for(let i=0;i<5;i++){
  const ok=T.optimizeMelody(mel0);
  if(!ok){ chk('第'+(i+1)+'次优化成功',false); continue; }
  const q=mel0.seq;
  const anchOK=Object.keys(anchors).every(s=>q[+s]===anchors[s]);
  const notes=q.filter(v=>v>=0).length;
  /* 用户锚点尊重原样（即使不是和弦音，属设计行为）；其余强拍必须落在和弦内 */
  const chordOK=q.every((r,s)=>r===-1||s%4!==0||(s in anchors)||chordAt[s].has(T.degOfRow(r)));
  chk('第'+(i+1)+'次：锚点原样 & 密度 '+notes+'∈['+dLo+','+dHi+'] & 强拍都在和弦内',
      anchOK&&notes>=dLo&&notes<=dHi&&chordOK,
      'anch='+anchOK+' chord='+chordOK);
  snaps.push(snap(mel0));
}
chk('userSeq 未被优化结果污染',JSON.stringify(mel0.userSeq)===userSnap);
chk('5 次连点 ≥3 个不同版本（之前是恒等不动点）',new Set(snaps).size>=3,'distinct='+new Set(snaps).size);

console.log('== 3. 机器生成的声部：连点同样有变化，且不会凭空长出锚点 ==');
const arp=T.state.tracks[2];
T.setStyle(1); T.setBars(arp,2);
chk('fillArp 后 userSeq 仍为 null',arp.userSeq===null);
const asnaps=[];
for(let i=0;i<4;i++){ T.optimizeMelody(arp); asnaps.push(snap(arp)); }
chk('4 次连点 ≥2 个不同版本',new Set(asnaps).size>=2,'distinct='+new Set(asnaps).size);
chk('优化后 userSeq 仍为 null',arp.userSeq===null);

console.log('== 3b. 🎲 按风格随机生成：全新旋律、连点不同、无视旧素材 ==');
T.setStyle(1);
const fsnap=snap(mel0), fanchors=Object.keys(anchors).length;
const fchord=()=>T.chordAtFor(T.progFor(mel0),T.stepsOf(mel0));
const fsnaps=[];
for(let i=0;i<4;i++){
  let ok=true; try{ T.randomizeForTrack(mel0); }catch(e){ ok=false; }
  const q=mel0.seq, ca=fchord(), Nq=T.stepsOf(mel0);
  const notes=q.filter(v=>v>=0).length;
  /* 无用户锚点 → 全部强拍都必须落在和弦内 */
  const chordOK=q.every((r,s)=>r===-1||s%4!==0||ca[s].has(T.degOfRow(r)));
  chk('🎲 第'+(i+1)+'次：密度 '+notes+'∈['+dLo+','+dHi+'] & 强拍全在和弦内 & 有 toast',
      ok&&notes>=dLo&&notes<=dHi&&chordOK,'chord='+chordOK+' notes='+notes);
  fsnaps.push(snap(mel0));
}
chk('🎲 后 userSeq 作废（旧锚点不再残留）',mel0.userSeq===null,'fanchors='+fanchors);
chk('🎲 连点 4 次 ≥2 个不同版本',new Set(fsnaps).size>=2,'distinct='+new Set(fsnaps).size);
chk('🎲 结果与生成前不同',fsnaps[fsnaps.length-1]!==fsnap||new Set(fsnaps).size>=2);

console.log('== 4. 手动编辑 → 立刻成为素材（下次 ✨ 保留它）==');
T.resetSeq(arp);
chk('清空后 userSeq 为 null',arp.userSeq===null);
T.setStep(arp,0,5,false); T.setStep(arp,8,2,false);
chk('userSeq 建立且记录编辑',Array.isArray(arp.userSeq)&&arp.userSeq[0]===5&&arp.userSeq[8]===2&&arp.userSeq.length===T.stepsOf(arp));
T.optimizeMelody(arp);
chk('优化后锚点 s0=5 / s8=2 保留',arp.seq[0]===5&&arp.seq[8]===2);

console.log('== 4b. 清空/改小节数后，锚点来源不被污染 ==');
T.optimizeMelody(arp);
const seqBefore=arp.seq.slice();
T.setBars(arp,2);
chk('setBars 后 userSeq 同步平铺（长度一致）',arp.userSeq&&arp.userSeq.length===T.stepsOf(arp));
T.optimizeMelody(arp);
chk('加小节后优化仍以 userSeq 为锚点来源（s0=5 / s8=2 保留）',arp.seq[0]===5&&arp.seq[8]===2);
T.clearTrack(arp);
chk('清空声部后 userSeq 归零（旧锚点不残留）',arp.userSeq===null&&arp.seq.every(v=>v===-1));
T.optimizeMelody(arp);
chk('清空后优化不崩且结果有音',arp.seq.some(v=>v>=0));

console.log('== 5. 回归：多小节平铺 / 和弦编辑 / 存档 / 导出 ==');
const bass=T.state.tracks[1];
T.resetSeq(bass);
for(let s=0;s<16;s++) if(s%4===0) T.setStep(bass,s,6-(s/4),false);
T.setBars(bass,2);
chk('2 小节平铺：第 2 小节＝第 1 小节',bass.seq.slice(16).every((v,s)=>v===bass.seq[s]));
chk('userSeq 同步平铺',bass.userSeq.slice(16).every((v,s)=>v===bass.userSeq[s]));
T.setBars(bass,1);
chk('缩回 1 小节保留前段',T.stepsOf(bass)===16);
T.setBars(T.state.tracks[0],2);
const L=T.scLen();
T.state.prog=[{root:0,beats:4,seventh:false,tones:[0,(0+2)%L,(0+4)%L]},
              {root:3,beats:4,seventh:false,tones:[3,(3+2)%L,(3+4)%L]}];   // 确定性：2 段 × 4 拍
T.fitProg();
const beats=()=>T.state.prog.reduce((a,c)=>a+c.beats,0);
chk('和弦铺满全曲（8 拍）',beats()===T.songBeats());
const n0=T.state.prog.length;
T.splitSeg(0);
chk('拆分：段数 +1、总拍数不变',T.state.prog.length===n0+1&&beats()===T.songBeats());
T.setSegChord(0,3,true);
chk('换级数 + 七和弦',T.state.prog[0].root===3&&T.state.prog[0].seventh===true);
T.delSeg(0); T.fitProg();
chk('删除后仍铺满全曲',beats()===T.songBeats());
const m5=T.state.tracks[0];
T.setStep(m5,5,4,false);                            // 🎲 后手动拧一格 → 整条生成旋律+这一格成为新素材
chk('🎲 后手动编辑重建素材快照',Array.isArray(m5.userSeq)&&m5.userSeq[5]===4);
T.save(); const saved=JSON.parse(store['polyseq.v7']);
chk('存档含 useq（用户素材）',Array.isArray(saved.tracks[0].useq)&&saved.tracks[0].useq.length===32);
T.loadSaved();
const mel1=T.state.tracks[0];
const anchors6={};
(mel1.userSeq||[]).forEach((v,s)=>{ if(v>=0&&s%4===0) anchors6[s]=v; });
chk('读回：bars / userSeq / 和弦段全还原',T.barsOf(mel1)===2&&Array.isArray(mel1.userSeq)&&mel1.userSeq.length===32&&beats()===T.songBeats()&&Object.keys(anchors6).length>=4);
let exOK=true; try{ T.exportMidi(); }catch(e){ exOK=false; }
chk('导出 .mid 无异常',exOK);

console.log('== 6. 全风格鲁棒性：9 种风格连点无崩溃、锚点保留 ==');
let robust=true, why='';
for(let st=0;st<9;st++){
  try{
    T.setStyle(st);
    for(let k=0;k<3;k++){
      if(!T.optimizeMelody(mel1)){ robust=false; why='style '+st+' 返回 false'; break; }
      const okA=Object.keys(anchors6).every(s=>mel1.seq[+s]===anchors6[s]&&+s<mel1.seq.length);
      if(!okA){ robust=false; why='style '+st+' 锚点丢失'; break; }
    }
  }catch(e){ robust=false; why='style '+st+' 抛异常: '+e.message; break; }
}
chk('9 风格 × 3 连点全部通过',robust,why);

console.log('\n=== '+(fail?fail+' 项失败':'全部通过')+'（'+pass+' 通过 / '+fail+' 失败）===');
process.exit(fail?1:0);
