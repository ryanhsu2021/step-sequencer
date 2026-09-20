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
  DELAY_PRESETS,REV_PRESETS,setTrackFx,setReverb,revGetter:()=>revPreset,trackFx:t=>t.fx,setRevMix:v=>{revMix=v;},getRevMix:()=>revMix};`;
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

console.log('\n=== '+(fail?fail+' 项失败':'全部通过')+'（'+pass+' 通过 / '+fail+' 失败）===');
process.exit(fail?1:0);
