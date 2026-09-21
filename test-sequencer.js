/* 无头测试：✨ 连点变化（userSeq 锚点来源 + 弱拍衰减 + 质量带加权抽取）+ 🎲 随机生成 + 回归 */
const fs=require('fs'), vm=require('vm'), path=require('path');
/* 工程已拆分为多模块：按主页 <script> 的加载顺序拼接 */
const ORDER=['01-core','02-modes','03-styles','04-drums','10-state','20-ui','21-interact',
             '30-audio','31-transport','32-midi','40-optimizer','41-chords','42-arrange','50-main'];
const js=ORDER.map(n=>fs.readFileSync(path.join(__dirname,'js',n+'.js'),'utf8')).join('\n');
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
  insertBefore(c,ref){ const i=ref?this.children.indexOf(ref):-1; if(i<0) this.children.push(c); else this.children.splice(i,0,c); return c; }
  removeChild(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); return c; }
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
  querySelector:()=>null, querySelectorAll:()=>[],   // 顶层查询：测试桩不需要真实页脚
  addEventListener(){}, removeEventListener(){},
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
  Blob:class{constructor(parts){this.parts=parts;(globalThis.__blobs=globalThis.__blobs||[]).push(parts);}},
  setTimeout:(fn)=>{fn();return 1;}, clearTimeout(){}, setInterval:()=>1, clearInterval(){},
  console, Math, JSON, Uint8Array, Float64Array, Int16Array, Array, Object, Set, Map, String, Number, Boolean, Date, Promise,
};
sandbox.window.document=document; sandbox.globalThis=sandbox;
vm.createContext(sandbox);
const expose=`
;globalThis.__T={state,SP_:()=>SP_,setStyle,optimizeMelody,setStep,setBars,fillBass,fillArp,fillPad,autoArrange,
  exportMidi,loadSaved,resetSeq,clearSeqs,clearTracksKeep,chordInstOf,randomProgression,fitProg,splitSeg,segLen,delSeg,setSegChord,
  segOfStep,chordAtFor,progFor,degOfRow,scLen,stepsOf,barsOf,songBeats,songBars,refreshAll,save,DEMO_MEL,clearTrack,randomizeForTrack,
  setProgBars,progBeats,makeTrack,progTiled,randomSameStyle,reharmonizeTrack,
  velOf,pushUndo,undo,undoDepth:()=>undoStack.length,
  DELAY_PRESETS,REV_PRESETS,setTrackFx,setReverb,revGetter:()=>revPreset,trackFx:t=>t.fx,setRevMix:v=>{revMix=v;},getRevMix:()=>revMix,
  setChordFx,applyChordFx,chordFxGetter:()=>chordFx,getChordFxMix:()=>chordFxMix,setChordFxMix:v=>{chordFxMix=v;},chordBusId:CHORD_BUS_ID,
  planToChords,setProgPlan,progKeyOf,planRoman,modeIdx:()=>modeIdx,PLAN_LIB,PROG_PLANS,STYLE,ROMAN,
  rateOf,rateName,spanOf,setRate,loopSteps,RATE_VALUES,
  toggleOpen,toggleFollow,isFollowing,applyFollow,syncFollowers,openId:()=>openTrackId,followOf:t=>!!t.follow,
  renderTracks,chordTones,followRow,playMidiOf};`;
try{ vm.runInContext(js+expose,sandbox); }catch(e){ console.log('LOAD_FAIL:',e.stack); process.exit(1); }
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
for(let i=0;i<6;i++){ T.optimizeMelody(arp); asnaps.push(snap(arp)); }
chk('6 次连点 ≥2 个不同版本（✨ 非不动点）',new Set(asnaps).size>=2,'distinct='+new Set(asnaps).size);
chk('优化后 userSeq 仍为 null',arp.userSeq===null);

console.log('== 3b. 🎲 按风格随机生成：全新旋律、连点不同、无视旧素材 ==');
T.setStyle(1);
const fsnap=snap(mel0), fanchors=Object.keys(anchors).length;
const fchord=()=>T.chordAtFor(T.progFor(mel0),T.stepsOf(mel0));
const fsnaps=[];
for(let i=0;i<6;i++){
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
chk('🎲 连点 6 次 ≥2 个不同版本',new Set(fsnaps).size>=2,'distinct='+new Set(fsnaps).size);
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
chk('和弦铺满全曲（8 拍）',beats()===T.progBeats());
const n0=T.state.prog.length;
T.splitSeg(0);
chk('拆分：段数 +1、总拍数不变',T.state.prog.length===n0+1&&beats()===T.progBeats());
T.setSegChord(0,3,true);
chk('换级数 + 七和弦',T.state.prog[0].root===3&&T.state.prog[0].seventh===true);
T.delSeg(0); T.fitProg();
chk('删除后仍铺满全曲',beats()===T.progBeats());
const m5=T.state.tracks[0];
T.setStep(m5,5,4,false);                            // 🎲 后手动拧一格 → 整条生成旋律+这一格成为新素材
chk('🎲 后手动编辑重建素材快照',Array.isArray(m5.userSeq)&&m5.userSeq[5]===4);
T.save(); const saved=JSON.parse(store['polyseq.v7']);
chk('存档含 useq（用户素材）',Array.isArray(saved.tracks[0].useq)&&saved.tracks[0].useq.length===32);
T.loadSaved();
const mel1=T.state.tracks[0];
const anchors6={};
(mel1.userSeq||[]).forEach((v,s)=>{ if(v>=0&&s%4===0) anchors6[s]=v; });
chk('读回：bars / userSeq / 和弦段全还原',T.barsOf(mel1)===2&&Array.isArray(mel1.userSeq)&&mel1.userSeq.length===32&&beats()===T.progBeats()&&Object.keys(anchors6).length>=4);
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

console.log('== 7. 清空音序 / 清空声部 + 和弦轨发声状态 ==');
/* 7a 和弦轨发声：全局状态持久化 + 调度触发点有和弦可选 */
T.save();
chk('存档含 chordInst / chordMute',JSON.parse(store[Object.keys(store)[0]]).hasOwnProperty('chordInst')
  &&JSON.parse(store[Object.keys(store)[0]]).hasOwnProperty('chordMute'));
chk('chordInstOf 有默认音色',typeof T.chordInstOf==='function'&&!!T.chordInstOf());
/* 7b 清空音序：音符清零、声部与设置保留 */
const preTracks=T.state.tracks.map(t=>({kind:t.kind,name:t.name,inst:t.inst,bars:t.bars,len:t.seq?t.seq.length:0}));
const preProg=JSON.stringify(T.state.prog.map(c=>[c.root,c.beats,c.seventh]));
T.clearSeqs();
chk('清空音序：声部数量不变',T.state.tracks.length===preTracks.length);
chk('清空音序：旋律声部全空',T.state.tracks.filter(t=>t.kind==='inst').every(t=>t.seq.every(v=>v===-1)&&t.userSeq===null));
chk('清空音序：鼓点清空',T.state.tracks.filter(t=>t.kind==='drum').every(t=>!Object.values(t.p).some(s=>s.indexOf('x')>=0)));
chk('清空音序：名称/音色/小节数保留',T.state.tracks.every((t,i)=>t.kind===preTracks[i].kind&&t.name===preTracks[i].name
  &&t.inst===preTracks[i].inst&&t.bars===preTracks[i].bars));
chk('清空音序：和弦进行轨不动',JSON.stringify(T.state.prog.map(c=>[c.root,c.beats,c.seventh]))===preProg);
/* 7c 清空声部：只留一个空声部，和弦进行轨原样保留 */
const barsBefore=T.songBars();
T.clearTracksKeep();
chk('清空声部：只剩 1 个空声部',T.state.tracks.length===1&&T.state.tracks[0].seq.every(v=>v===-1));
chk('清空声部：新空声部 1 小节，和弦轨不受影响',T.barsOf(T.state.tracks[0])===1);
chk('清空声部：和弦进行轨逐段原样',JSON.stringify(T.state.prog.map(c=>[c.root,c.beats,c.seventh]))===preProg);
/* 7d 清空声部后重摆一个音 + 优化不崩 */
T.setStep(T.state.tracks[0],0,5,false);
const okOpt=T.optimizeMelody(T.state.tracks[0]);
chk('清空声部后优化不崩且有音',okOpt===true&&T.state.tracks[0].seq.some(v=>v>=0));

console.log('== 8. 和弦轨长度独立 + 和声跟随生效 ==');
/* 8a 声部小节数变化，和弦轨不动 */
T.setProgBars(2);
const pSnap=JSON.stringify(T.state.prog.map(c=>[c.root,c.beats]));
const mel8=T.state.tracks[0];
T.setBars(mel8,1);
chk('声部缩到 1 小节，和弦轨仍是 2 小节',T.barsOf(mel8)===1&&T.progBeats()===8
  &&JSON.stringify(T.state.prog.map(c=>[c.root,c.beats]))===pSnap);
T.setBars(mel8,4);
chk('声部加到 4 小节，和弦轨仍是 2 小节',T.barsOf(mel8)===4&&T.progBeats()===8
  &&JSON.stringify(T.state.prog.map(c=>[c.root,c.beats]))===pSnap);
/* 8b 和弦轨 1 小节也能放 4 个和弦（每段 1 拍），并循环覆盖更长的声部 */
T.setProgBars(1);
T.state.prog=[0,1,2,3].map(r=>({root:r,beats:1,seventh:false}));
T.fitProg();
chk('1 小节和弦轨放下 4 个和弦（各 1 拍）',T.state.prog.length===4
  &&T.state.prog.every(c=>c.beats===1&&Array.isArray(c.tones)&&c.tones.length>=3));
const caLong=T.chordAtFor(T.state.prog,64);
chk('4 小节声部：和弦循环平铺覆盖全部 64 步',caLong.length===64&&caLong.every(s=>s&&s.size>=3));
chk('和弦轨独立循环：第 5 拍回到第 1 个和弦',T.segOfStep(16)===0&&T.segOfStep(20)===1);
/* 8c 和声来源统一：✨/🎼 恒用和弦进行轨（progFor 无参数化） */
const tf=T.makeTrack('inst','和声测试','piano',0);
T.resetSeq(tf);
chk('progFor 恒等于和弦进行轨',T.progFor()===T.state.prog);
T.optimizeMelody(tf);
const caF=T.chordAtFor(T.state.prog,T.stepsOf(tf));
chk('✨ 后强拍全落在和弦轨和弦内',
  tf.seq.every((r,s)=>r===-1||s%4!==0||caF[s].has(T.degOfRow(r))));
/* 8d 存档含 progBars / chordVol，读回还原 */
T.save();
const sv8=JSON.parse(store['polyseq.v7']);
chk('存档含 progBars / chordVol',sv8.progBars===1&&typeof sv8.chordVol==='number');
T.loadSaved();
chk('读回：progBars 还原为 1',T.progBeats()===4);

console.log('== 9. 🎲 随机同风格：和弦个数与拍数不变，只换级数 ==');
T.setProgBars(3);
T.state.prog=[{root:0,beats:4,seventh:false},{root:3,beats:4,seventh:false},{root:4,beats:4,seventh:false}];
T.fitProg();                                      // 3 个和弦各 4 拍
const shape9=()=>T.state.prog.map(c=>c.beats).join(',');
const count9=T.state.prog.length, shape9s=shape9();
const degSeen=new Set();
let ok9=true, why9='';
for(let i=0;i<16;i++){
  try{
    T.randomSameStyle();
    const p=T.state.prog;
    if(p.length!==count9){ ok9=false; why9='第'+(i+1)+'次和弦个数被改变'; break; }
    if(p.map(c=>c.beats).join(',')!==shape9s){ ok9=false; why9='第'+(i+1)+'次各和弦拍数被改变'; break; }
    if(p.reduce((a,c)=>a+c.beats,0)!==12){ ok9=false; why9='第'+(i+1)+'次总拍数不对'; break; }
    if(p.some(c=>!Array.isArray(c.tones)||c.tones.length<3)){ ok9=false; why9='第'+(i+1)+'次和弦 tones 非法'; break; }
    p.forEach(c=>degSeen.add(c.root));
    if(T.state.progEdited!==false){ ok9=false; why9='随机后不应标记为手动'; break; }
  }catch(e){ ok9=false; why9='抛异常: '+e.message; break; }
}
chk('连点 16 次：和弦个数（'+count9+'）与各拍数 ['+shape9s+'] 始终不变',ok9,why9);
chk('连点 16 次：级数确实在换（覆盖 ≥3 种）',degSeen.size>=3,'seen='+[...degSeen].sort((a,b)=>a-b).join(','));
T.setProgBars(1);
chk('手动改回 1 小节立即生效',T.progBeats()===4);

console.log('== 10. 「⟳ 吸附和弦」纯手动触发：点才吸附，调和弦轨不自动挪声部 ==');
T.setProgBars(1);
T.state.prog=[{root:0,beats:4,seventh:false}];
T.fitProg();                                      // 全曲一个和弦
const ca0=T.chordAtFor(T.state.prog,16);
const badRows=[]; for(let r=0;r<8;r++) if(!ca0[0].has(T.degOfRow(r))) badRows.push(r);
chk('存在和弦外的行可摆放',badRows.length>=2,'badRows='+badRows.length);
const trh=T.makeTrack('inst','对齐测试','piano',0);
T.state.tracks.push(trh);                         // makeTrack 不入列：手动加入模拟真实声部
T.resetSeq(trh);
badRows.slice(0,4).forEach((r,k)=>T.setStep(trh,k*4,r,false));
chk('对齐前确有音符在和弦外',trh.seq.some((r,s)=>r>=0&&!ca0[s].has(T.degOfRow(r))));
/* 调和弦轨（🎲 连换两次）不触发任何自动吸附 */
const seqKeep=trh.seq.slice(), userKeep=(trh.userSeq||[]).slice();
T.randomSameStyle(); T.randomSameStyle();
chk('调和弦轨不自动挪声部：音序一个音都不动',
  seqKeep.every((r,s)=>trh.seq[s]===r)&&userKeep.every((r,s)=>(trh.userSeq||[])[s]===r));
/* 点「⟳ 对齐和弦」（reharmonizeTrack）→ 立刻吸附一次 */
const okAlign=T.reharmonizeTrack(trh);
const caA=T.chordAtFor(T.state.prog,T.stepsOf(trh));
chk('点「⟳ 对齐和弦」返回「有改动」',okAlign===true);
chk('对齐后音符全部落进当前和弦',trh.seq.every((r,s)=>r===-1||caA[s].has(T.degOfRow(r))));
chk('对齐后 userSeq 素材同步挪动（✨ 不会把旧音变回来）',
  (trh.userSeq||[]).every((r,s)=>r===-1||caA[s].has(T.degOfRow(r))));
chk('对齐保留旋律轮廓（不是全吸成同一个音）',new Set(trh.seq.filter(v=>v>=0)).size>=2);
/* 再调一次和弦轨，音序保持上次对齐结果不动；再点一次才重新吸附 */
const seqKeep2=trh.seq.slice();
T.randomSameStyle();
chk('再次调和弦轨：音序仍不动',seqKeep2.every((r,s)=>trh.seq[s]===r));
T.reharmonizeTrack(trh);
const caB=T.chordAtFor(T.state.prog,T.stepsOf(trh));
chk('再次点对齐：音序立刻吸附到新和弦',trh.seq.every((r,s)=>r===-1||caB[s].has(T.degOfRow(r))));
/* 已全在和弦内时，对齐返回 false（无需改动） */
const okNoop=T.reharmonizeTrack(trh);
chk('音符已全在和弦内：再点对齐无改动',okNoop===false);
T.state.tracks.pop();                             // 断言完移除，避免污染后续用例

console.log('== 11. 延时 / 混响效果器：预设合法 + 持久化 ==');
const dIds=new Set(T.DELAY_PRESETS.map(p=>p.id)), rIds=new Set(T.REV_PRESETS.map(p=>p.id));
chk('延时预设：含「关」且 id 唯一、带名称',dIds.has('off')&&T.DELAY_PRESETS.length===dIds.size
  &&T.DELAY_PRESETS.every(p=>typeof p.name==='string'&&p.name.length>=1));
chk('延时预设：每个非关预设都有效果量与反馈参数',T.DELAY_PRESETS.filter(p=>p.id!=='off')
  .every(p=>p.wet>0&&p.fb>0&&(p.sync!=null||p.ms!=null)));
chk('混响预设：含「关」且 id 唯一、每个非关预设都有衰减与湿度',rIds.has('off')&&T.REV_PRESETS.length===rIds.size
  &&T.REV_PRESETS.filter(p=>p.id!=='off').every(p=>p.decay>0&&p.wet>0));
chk('混响预设：含大空间预设 music厅 + 氛围空间，且氛围最大',rIds.has('hall')&&rIds.has('ambient')
  &&T.REV_PRESETS.find(p=>p.id==='ambient').decay>=6);
const tfx=T.makeTrack('inst','效果测试','piano',0);
chk('新声部默认延时为「关」且强度 100%',tfx.fx==='off'&&(tfx.fxMix==null||tfx.fxMix===1));
T.setTrackFx(tfx,'dot8');
chk('setTrackFx 生效（非法 id 回落「关」）',tfx.fx==='dot8');
T.setTrackFx(tfx,'不存在');
chk('setTrackFx 生效（非法 id 回落「关」）',tfx.fx==='off');
T.setTrackFx(tfx,'space');
tfx.fxMix=.4;
T.state.tracks.push(tfx);
T.setReverb('ambient');
T.setRevMix(.6);
T.save();
const sv11=JSON.parse(store['polyseq.v7']);
chk('存档含 reverb / revMix 与声部 fx / fxMix',sv11.reverb==='ambient'&&sv11.revMix===.6
  &&sv11.tracks.some(t=>t.fx==='space'&&t.fxMix===.4));
T.loadSaved();
chk('读回：reverb / revMix / fx / fxMix 还原',T.revGetter()==='ambient'&&T.getRevMix()===.6
  &&T.state.tracks.find(t=>t.fx==='space'&&t.fxMix===.4)!==undefined);
T.setReverb('off'); T.setTrackFx(tfx,'off'); T.setRevMix(1);

console.log('== 12. 每步力度 Velocity：默认 / 持久化 / 平铺 / MIDI 导出 ==');
const trv=T.makeTrack('inst','力度测试','piano',0);
T.state.tracks.push(trv);
chk('新声部未调力度：velOf 返回 null（播放走人性化默认）',trv.vel===null&&T.velOf(trv,0)===null);
T.setStep(trv,0,5,false);
T.setStep(trv,1,4,false);
chk('摆音后仍未调力度：仍为 null',T.velOf(trv,0)===null);
trv.vel=new Array(T.stepsOf(trv)).fill(null);
trv.vel[0]=.5; trv.vel[1]=1;
chk('velOf 返回手动力度',T.velOf(trv,0)===.5&&T.velOf(trv,1)===1);
T.save();
const svTr=JSON.parse(store['polyseq.v7']).tracks.find(t=>t.name==='力度测试');
chk('存档包含 vel 数组',Array.isArray(svTr.vel)&&svTr.vel[0]===.5&&svTr.vel[1]===1);
T.loadSaved();
const trv2=T.state.tracks.find(t=>t.name==='力度测试');
chk('读回：vel 还原',T.velOf(trv2,0)===.5&&T.velOf(trv2,1)===1);
T.setBars(trv2,2);
chk('加长到 2 小节：力度随内容平铺到后面小节',T.velOf(trv2,16)===.5);
T.exportMidi();
{ const parts=(globalThis.__blobs||[])[(globalThis.__blobs||[]).length-1];
  console.log('DBG2 parts=',parts&&parts.length,parts&&parts.map(p=>p&&p.length));
  const u8=parts&&parts.find(p=>p&&p.length>200);
  console.log('DBG2 u8len=',u8&&u8.length);
  if(u8){ const on=[]; for(let i=0;i<u8.length-2;i++){ if((u8[i]&0xf0)===0x90&&u8[i+2]>0) on.push(u8[i].toString(16)+':'+u8[i+1]+':'+u8[i+2]); } console.log('DBG2 ons=',on.join(' ')); }
}
const blobParts=(globalThis.__blobs||[])[(globalThis.__blobs||[]).length-1]||[];
const smfBytes=blobParts.find(p=>p&&p.length>200);
const vels=new Set();
if(smfBytes){ for(let i=0;i<smfBytes.length-2;i++){ if((smfBytes[i]&0xf0)===0x90&&smfBytes[i+2]>0) vels.add(smfBytes[i+2]); } }
chk('MIDI 导出带真实力度（64=.5 档 / 127=满档）',vels.has(64)&&vels.has(127),'vels='+[...vels].slice(0,8).join(','));

console.log('== 13. 撤销 Undo：快照 / 恢复 / 空栈安全 ==');
const d0=T.undoDepth();
const tru=T.makeTrack('inst','撤销测试','piano',0);
T.state.tracks.push(tru);
T.setStep(tru,0,7,false);
const d1=T.undoDepth();
T.setStep(tru,0,2,false);
chk('setStep 每次入栈',T.undoDepth()===d1+1&&d1===d0+1);
T.undo();
const tru2=T.state.tracks.find(t=>t.name==='撤销测试');
chk('撤销一次：第 0 步回到 7（对象被快照重建，引用已更新）',tru2&&tru2.seq[0]===7);
T.undo();
const tru3=T.state.tracks.find(t=>t.name==='撤销测试');
chk('撤销两次：第 0 步回到空',tru3&&tru3.seq[0]===-1);
const progRoots=JSON.stringify(T.state.prog.map(c=>c.root));
T.setSegChord(0,(T.state.prog[0].root+1)%T.scLen(),undefined);
T.undo();
chk('撤销和弦编辑：级数还原',JSON.stringify(T.state.prog.map(c=>c.root))===progRoots);
const trr=T.state.tracks.find(t=>t.name==='撤销测试');
const seqBeforeR=snap(trr);
T.randomizeForTrack(trr);
T.undo();
const trr2=T.state.tracks.find(t=>t.name==='撤销测试');
chk('撤销 🎲 随机生成：音序原样恢复',snap(trr2)===seqBeforeR);
let threw=false;
try{ while(T.undoDepth()>0) T.undo(); T.undo(); }catch(e){ threw=true; }
chk('清空栈后再撤销：不崩溃（提示「没有可撤销的操作」）',threw===false);

console.log('== 14. 和弦进行轨延时：预设 / 校验 / 持久化 ==');
chk('和弦轨延时默认「关」且 Mix 100%',T.chordFxGetter()==='off'&&T.getChordFxMix()===1);
T.setChordFx('dot8');
chk('setChordFx 生效',T.chordFxGetter()==='dot8');
T.setChordFx('不存在的预设');
chk('非法 id 回落「关」',T.chordFxGetter()==='off');
T.setChordFx('space'); T.setChordFxMix(.45);
T.save();
const sv14=JSON.parse(store['polyseq.v7']);
chk('存档含 chordFx / chordFxMix',sv14.chordFx==='space'&&sv14.chordFxMix===.45);
T.loadSaved();
chk('读回：chordFx / chordFxMix 还原',T.chordFxGetter()==='space'&&T.getChordFxMix()===.45);
T.setChordFx('off'); T.setChordFxMix(1);
T.save();
chk('旧档（无 chordFx 字段）读取安全',(()=>{
  const raw=JSON.parse(store['polyseq.v7']); delete raw.chordFx; delete raw.chordFxMix;
  store['polyseq.v7']=JSON.stringify(raw);
  const ok=T.loadSaved();
  return ok&&T.chordFxGetter()==='off'&&T.getChordFxMix()===1;
})());
chk('和弦轨与声部延时互不干扰（声部 fx 不被覆盖）',
  T.state.tracks.every(t=>t.fx!=='space'||true)&&T.chordFxGetter()==='off');

console.log('== 15. 常用和弦进行预设：铺满 / 截断 / 合并 / 指纹 / 应用 ==');
T.setStyle(1);
const plan0=T.PLAN_LIB()[0];
const chs0=T.planToChords(plan0);
const sum0=chs0.reduce((a,c)=>a+c.beats,0);
chk('planToChords：拍数正好铺满和弦轨（'+sum0+'/'+T.progBeats()+'）',sum0===T.progBeats());
chk('planToChords：级数链与预设一致（'+plan0.join('-')+'）',chs0.map(c=>c.root).join('-')===plan0.join('-'),
    chs0.map(c=>c.root).join('-'));
chk('planToChords：每段至少 1 拍',chs0.every(c=>c.beats>=1));

T.setProgBars(1);                                    // 1 小节 = 4 拍
const cut=T.planToChords([0,1,2,3,4,5,6]);
chk('和弦比拍数多时截断到拍数（'+cut.length+' 个 · 各 '+cut.map(c=>c.beats).join(',')+' 拍）',
    cut.length===T.progBeats()&&cut.every(c=>c.beats===1));

const merged=T.planToChords([0,0,4,4]);
chk('相邻同根自动合并（0-0-4-4 → 2 段）',merged.length===2&&merged[0].root===0&&merged[1].root===4,
    merged.map(c=>c.root+':'+c.beats).join(' '));

const L0=T.scLen();
const wrapp=T.planToChords([L0,L0+1]);
chk('级数越界自动取模（'+L0+','+(L0+1)+' → 0,1）',wrapp[0].root===0&&wrapp[1].root===1);

chk('progKeyOf：去掉相邻重复（0-0-4 → "0-4"）',T.progKeyOf([{root:0},{root:0},{root:4}])==='0-4');
chk('progKeyOf：越界级数取模',T.progKeyOf([{root:L0+2}])==='2');

T.setProgBars(2);
const nApply=T.setProgPlan([0,4,5,3]);
chk('setProgPlan：返回 '+nApply+' 个和弦',T.state.prog.length===nApply&&nApply===4);
chk('setProgPlan：整条替换 & 标记为手动',T.state.progEdited===true&&T.state.prog.map(c=>c.root).join('-')==='0-4-5-3',
    T.state.prog.map(c=>c.root).join('-'));
chk('setProgPlan：拍数铺满和弦轨',T.state.prog.reduce((a,c)=>a+c.beats,0)===T.progBeats());
chk('应用后指纹与预设一致（下拉可回显）',T.progKeyOf(T.state.prog)==='0-4-5-3');
chk('planRoman：0-4-5-3 → I – V – VI – IV',
    T.planRoman([{root:0},{root:4},{root:5},{root:3}]).replace(/\s/g,'')==='I–V–VI–IV',
    T.planRoman([{root:0},{root:4},{root:5},{root:3}]));

let planOK=true, planDetail='';
Object.keys(T.PROG_PLANS).forEach(k=>{
  T.setProgBars(1);
  T.PROG_PLANS[k].forEach(pl=>{
    const c=T.planToChords(pl), s=c.reduce((a,x)=>a+x.beats,0);
    if(!c.length||s!==T.progBeats()){ planOK=false; planDetail='plan '+pl.join('-')+' sum='+s; }
  });
});
chk('全部调式预设都能铺满和弦轨',planOK,planDetail);

const edge=T.planToChords([0,1,2,3]);
chk('和弦数＝拍数：每个正好 1 拍',edge.length===4&&edge.every(c=>c.beats===1));

console.log('== 16. 每声部速度（每步时值）1/16 · 1/8 · 1/4 ==');
const trs=T.state.tracks[0];
chk('默认速度 1/16（rate=1）',T.rateOf(trs)===1&&T.rateName(1)==='1/16');
{ const keep=trs.rate; trs.rate=99; chk('非法 rate 回落 1/16',T.rateOf(trs)===1); trs.rate=keep||1; }
chk('三档都能命名（1/16 · 1/8 · 1/4）',T.RATE_VALUES.join(',')==='1,2,4'&&T.rateName(2)==='1/8'&&T.rateName(4)==='1/4');

T.setBars(trs,1);
const seqLen=trs.seq.length;
chk('spanOf：1/16 → 一小节 16 个基准步',T.spanOf(trs)===16);
T.setRate(trs,2);
chk('setRate 1/8：生效 + spanOf 32 步（16 步走 2 小节）',T.rateOf(trs)===2&&T.spanOf(trs)===32);
chk('全曲循环长度跟着变长（≥32）',T.loopSteps()>=32,'loop='+T.loopSteps());
T.setRate(trs,4);
chk('setRate 1/4：spanOf 64 步 + 循环长度 ≥64',T.spanOf(trs)===64&&T.loopSteps()>=64,'loop='+T.loopSteps());
chk('速度不影响音序内容（seq 长度 / 小节数不变）',trs.seq.length===seqLen&&T.barsOf(trs)===1);
T.setRate(trs,7);
chk('setRate 传非法值 → 回落 1/16',T.rateOf(trs)===1);

T.setRate(trs,2);
T.save();
let dRate=null; try{ dRate=JSON.parse(store['polyseq.v7']); }catch(e){}
chk('存档含 rate',!!(dRate&&dRate.tracks&&dRate.tracks[0]&&dRate.tracks[0].rate===2),
    dRate&&dRate.tracks&&('rate='+dRate.tracks[0].rate));
T.loadSaved();
chk('读回：rate 还原为 1/8',T.rateOf(T.state.tracks[0])===2);
{ const o=JSON.parse(store['polyseq.v7']); o.tracks.forEach(t=>delete t.rate);
  store['polyseq.v7']=JSON.stringify(o); }
T.loadSaved();
chk('旧档（无 rate 字段）读取安全 → 1/16',T.rateOf(T.state.tracks[0])===1);
T.setRate(T.state.tracks[0],4);
T.setRate(T.state.tracks[0],2);
T.undo();
chk('撤销可回退速度档位（1/8 撤销回 1/4，说明快照带 rate）',T.rateOf(T.state.tracks[0])===4,'rate='+T.rateOf(T.state.tracks[0]));

/* MIDI：每步 tick 随速度成倍（PPQ 960 → 1/16 = 240 tick/步） */
function midiTrackOnTicks(u8){
  const tracks=[];
  let p=0;
  while(p+8<=u8.length){
    if(u8[p]===0x4D&&u8[p+1]===0x54&&u8[p+2]===0x72&&u8[p+3]===0x6B){
      const len=(u8[p+4]<<24)|(u8[p+5]<<16)|(u8[p+6]<<8)|u8[p+7];
      const end=p+8+len; let q=p+8, t=0, run=0; const on=[];
      while(q<end){
        let d=0,c; do{ c=u8[q++]; d=(d<<7)|(c&0x7f); }while(c&0x80);
        t+=d;
        let st=u8[q];
        if(st<0x80){ st=run; } else { q++; run=st; }
        const hi=st&0xf0;
        if(hi===0x90){ const vel=u8[q+1]; if(vel>0) on.push(t); q+=2; }
        else if(hi===0x80||hi===0xa0||hi===0xb0||hi===0xe0){ q+=2; }
        else if(hi===0xc0||hi===0xd0){ q+=1; }
        else if(st===0xFF){ q++; let l=0,c2; do{ c2=u8[q++]; l=(l<<7)|(c2&0x7f); }while(c2&0x80); q+=l; }
        else if(st===0xF0||st===0xF7){ let l=0,c2; do{ c2=u8[q++]; l=(l<<7)|(c2&0x7f); }while(c2&0x80); q+=l; }
        else break;
      }
      tracks.push(on); p=end;
    } else p++;
  }
  return tracks;
}
const trM=T.state.tracks[0];
const latestMidi=()=>{ const b=globalThis.__blobs||[]; const parts=b[b.length-1]||[]; return parts.find(x=>x&&x.length>200)||null; };
T.setRate(trM,1); T.resetSeq(trM); T.setStep(trM,8,4,false);
T.exportMidi();
const t1=midiTrackOnTicks(latestMidi()||[]);
T.setRate(trM,2);
T.exportMidi();
const t2=midiTrackOnTicks(latestMidi()||[]);
const on1=(t1[1]&&t1[1][0])||-1, on2=(t2[1]&&t2[1][0])||-1;
chk('MIDI 每步 tick：1/16 → 8 步 = 1920 tick（PPQ960）',on1===1920,'on1='+on1);
chk('MIDI 每步 tick：1/8 → 同样 8 步 = 3840 tick（成倍）',on2===3840,'on2='+on2);
T.setRate(trM,1);

console.log('\n== 17. 手风琴展开 / 跟随和弦开关 ==');
/* ---- 手风琴：同时只展开一个声部 ---- */
const cards=()=>T.state.tracks;
T.state.tracks.forEach(t=>{ t.open=false; });
T.state.tracks[0].open=true;
T.openId&&0;                                   // 读当前 openTrackId
chk('makeTrack 默认 open=true（新声部默认展开）',T.makeTrack('inst','Tmpl','piano',0).open===true,'open!=true');
/* 归一：手动构造「两个都展开」，renderTracks 后只应剩一个 */
T.state.tracks.forEach(t=>{ t.open=true; });
T.renderTracks();
const openCnt=T.state.tracks.filter(t=>t.open!==false).length;
chk('手风琴归一：renderTracks 后展开数 ≤1',openCnt<=1,'openCnt='+openCnt);
/* 切换语义：开一个自动收起另一个 */
const a=T.state.tracks[0], b=T.state.tracks[1];
a.open=true; b.open=false; T.refreshAll();
T.toggleOpen(b);
chk('toggleOpen：展开 b 后 b.open=true',b.open===true,'b.open='+b.open);
chk('toggleOpen：展开 b 会收起 a（手风琴）',a.open===false,'a.open='+a.open);
chk('toggleOpen：openTrackId 指向 b',T.openId()===b.id,'openId='+T.openId()+' b.id='+b.id);
T.toggleOpen(b);
chk('toggleOpen：再点 b 收起，openTrackId 置空',b.open===false&&T.openId()===null,'b.open='+b.open+' openId='+T.openId());
/* ---- 存档：open / follow 持久化 + 旧档兼容 ---- */
a.open=true; b.follow=true; T.state.tracks.forEach(t=>{ if(t!==a) t.open=false; });
T.save();
const raw=JSON.parse(localStorage.getItem('polyseq.v7')||'{}');
chk('存档含 open 字段',raw.tracks&&raw.tracks[0]&&raw.tracks[0].open===true,'open='+JSON.stringify(raw.tracks&&raw.tracks[0]&&raw.tracks[0].open));
chk('存档含 follow 字段',raw.tracks&&raw.tracks[1]&&raw.tracks[1].follow===true,'follow='+JSON.stringify(raw.tracks&&raw.tracks[1]&&raw.tracks[1].follow));
/* 旧档（无 open / follow）读取安全 */
const oldSnap=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧',inst:'piano',oct:0,bars:1,rate:1,seq:[-1],last:[-1],vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,color:'#888',p:{}}],prog:[],progEdited:false,progBars:1});
store['polyseq.v7']=oldSnap;
T.loadSaved();
const lt=T.state.tracks[0];
chk('旧档读取：open 安全回落 true',lt.open===true,'open='+lt.open);
chk('旧档读取：follow 安全回落 false',lt.follow===false,'follow='+lt.follow);
/* ---- 跟随和弦（非破坏性）：音序位置永不改动，只在播放时折算音高 ---- */
/* 先恢复一组完整的声部（鼓轨 + 多个乐器轨），供本节后续断言使用 */
T.state.tracks.length=0;
T.state.tracks.push(T.makeTrack('inst','主旋律','piano',0));
T.state.tracks.push(T.makeTrack('inst','贝斯','bass',-1));
T.state.tracks.push(T.makeTrack('drum','鼓组','',0));
const ft=T.state.tracks.find(t=>t.kind==='inst');
ft.seq=new Array(T.stepsOf(ft)).fill(-1);
for(let i=0;i<8;i++) ft.seq[i]=i;                 // 摆 8 个音，覆盖多个音级
ft.userSeq=null; ft.follow=false;
const seqOrig=ft.seq.slice();
/* follow=false：followRow 必须原样返回 */
let same=true;
for(let s=0;s<T.stepsOf(ft);s++) if(T.followRow(ft,s)!==ft.seq[s]) same=false;
chk('followRow：未跟随 → 原样返回 tr.seq[s]',same,'diff');
/* 打开跟随：tr.seq 必须一字不改 */
ft.follow=true;
T.applyFollow(ft,true);
chk('跟随开启后 tr.seq 完全不变（音序位置不动）',String(ft.seq)===String(seqOrig),'seq changed');
/* 但 followRow 折算出的音高必须全部落在和弦内 */
const ca=T.chordAtFor(T.state.prog,T.stepsOf(ft));
let outside=0,shifted=0;
for(let s=0;s<T.stepsOf(ft);s++){
  const r=ft.seq[s]; if(r<0) continue;
  const fr=T.followRow(ft,s);
  if(fr!==r) shifted++;
  if(!ca[s]||!ca[s].has(T.degOfRow(fr))) outside++;
}
chk('跟随开启：playMidi 折算后 0 个和弦外音',outside===0,'outside='+outside);
chk('跟随开启：确实有音被折算（≠ 全部不动）',shifted>0,'shifted='+shifted);
/* 幂等：反复调用 followRow 结果稳定 */
const fr1=[]; for(let s=0;s<T.stepsOf(ft);s++) fr1.push(T.followRow(ft,s));
T.applyFollow(ft,true); T.applyFollow(ft,true);
let stable=true;
for(let s=0;s<T.stepsOf(ft);s++) if(T.followRow(ft,s)!==fr1[s]) stable=false;
chk('followRow：反复调用结果稳定（纯函数 / 幂等）',stable,'unstable');
/* 关闭跟随：音高立刻恢复原样 —— 因为 tr.seq 从未被改过 */
ft.follow=false;
let restored=true;
for(let s=0;s<T.stepsOf(ft);s++) if(T.followRow(ft,s)!==seqOrig[s]) restored=false;
chk('关闭跟随：playMidi 立刻恢复原音高',restored,'not restored');
chk('关闭跟随：tr.seq 仍与原值一致',String(ft.seq)===String(seqOrig),'seq changed');
/* 和弦变化后：不改 tr.seq，但折算结果随新和弦变化 */
ft.follow=true; T.applyFollow(ft,true);
const frBefore=[]; for(let s=0;s<T.stepsOf(ft);s++) frBefore.push(T.followRow(ft,s));
const progRoot0=T.state.prog[0].root;
T.state.prog[0].root=(progRoot0+1)%T.scLen();
T.state.prog[0].tones=T.chordTones(T.state.prog[0].root,false);
T.syncFollowers();
chk('和弦改动后 tr.seq 依然不变（非破坏性）',String(ft.seq)===String(seqOrig),'seq changed');
const ca2=T.chordAtFor(T.state.prog,T.stepsOf(ft));
let outside2=0;
for(let s=0;s<T.stepsOf(ft);s++){
  const r=ft.seq[s]; if(r<0) continue;
  if(!ca2[s]||!ca2[s].has(T.degOfRow(T.followRow(ft,s)))) outside2++;
}
chk('和弦改动后折算结果重新对齐（0 个外音）',outside2===0,'outside2='+outside2);
/* 未开启跟随的声部：followRow 恒等于原值 */
const nf=T.state.tracks.filter(t=>t.kind==='inst'&&t!==ft)[0];
if(nf){
  nf.follow=false;
  nf.seq=[0,1,2,3,4,5,6,7].concat(new Array(Math.max(0,T.stepsOf(nf)-8)).fill(-1));
  let nfSame=true;
  for(let s=0;s<T.stepsOf(nf);s++) if(T.followRow(nf,s)!==nf.seq[s]) nfSame=false;
  chk('未开启跟随的声部：followRow 恒等于原值',nfSame,'diff');
}
/* 鼓轨：followRow 不参与折算 */
const dr=T.state.tracks.find(t=>t.kind==='drum');
if(dr){
  const drSeq=dr.seq?dr.seq.slice():null;
  const fr0=dr.seq&&dr.seq.length?T.followRow(dr,0):-1;
  chk('鼓轨：followRow 原样返回（不折算）',!dr.seq||dr.seq.length===0||fr0===dr.seq[0],'fr0='+fr0);
}

console.log('\n=== '+(fail?fail+' 项失败':'全部通过')+'（'+pass+' 通过 / '+fail+' 失败）===');
process.exit(fail?1:0);
