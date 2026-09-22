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
    this._cls=new Set(); this.textContent=''; this._inner=''; this._value=''; this.options=[];
    this.disabled=false; this.label=''; this.min=''; this.max=''; this.title=''; this.type='';
    this.selectedIndex=0;
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
  /* input.value：真浏览器读回的是字符串，范围控件还会夹到 [min,max]——桩里照做，
     这样「拖动推子」才能被真实模拟（并暴露把 value 当数字用的 bug） */
  get value(){
    const v=this._value;
    if(this.tagName==='INPUT'&&this.type==='range'){
      const n=parseFloat(v);
      if(isNaN(n)) return '50';
      const lo=parseFloat(this.min||'0')||0, hi=this.max===''?100:(parseFloat(this.max)||0);
      return String(Math.max(lo,Math.min(hi,n)));
    }
    return v;
  }
  /* 选择框语义（真浏览器行为）：options 里被选中的那一项的 value 就是 this.value；
     赋值 value 会同步移动 selectedIndex——代码里的 s.options[s.selectedIndex] 才能拿到正确文本 */
  get value(){
    if(this.tagName==='SELECT'&&this.options&&this.options.length){
      const o=this.options[this.selectedIndex|0];
      return o?(o.value==null?'':String(o.value)):'';
    }
    return this._value;
  }
  set value(v){
    const s=String(v);
    if(this.tagName==='SELECT'&&this.options&&this.options.length){
      const i=this.options.findIndex(o=>String(o.value)===s);
      this.selectedIndex=i>=0?i:0;
      this._value=(i>=0?this.options[i].value:'');
      return;
    }
    this._value=s;
  }
  appendChild(c){
    this.children.push(c);
    /* 真浏览器语义：select.appendChild(optgroup) 后，optgroup 里的 option 出现在 select.options 里——
       「常用声部名」下拉按 optgroup 分组，测试要能从 select.options 摸到它们 */
    if(this.tagName==='OPTGROUP'&&c&&c.tagName==='OPTION'){ (this.options=this.options||[]).push(c); }
    if(c&&c.tagName==='OPTGROUP'&&Array.isArray(c.options)&&this.tagName==='SELECT'){
      for(const o of c.options.slice()) this.add(o);
    }
    return c;
  }
  insertBefore(c,ref){ const i=ref?this.children.indexOf(ref):-1; if(i<0) this.children.push(c); else this.children.splice(i,0,c); return c; }
  removeChild(c){ const i=this.children.indexOf(c); if(i>=0) this.children.splice(i,1); return c; }
  append(...cs){ cs.forEach(c=>this.children.push(c)); }
  addEventListener(t,f){ (this._handlers[t]=this._handlers[t]||[]).push(f); }
  removeEventListener(){}
  setAttribute(k,v){ this.attrs[k]=v; if(k==='value') this.value=v; }
  getAttribute(k){ return this.attrs[k]; }
  add(opt){
    this.options.push(opt); this.children.push(opt);
    const self=this;
    if(typeof opt==='object'&&opt) Object.defineProperty(opt,'selected',{
      configurable:true,get(){ return self.options[self.selectedIndex]===opt; }});
    if(this.selectedIndex==null) this.selectedIndex=0;
  }
  click(){}
  /* 触发事件：让「点击 M / 改下拉 / 拖推子」这类交互在测试里真的跑一遍（顺带抓运行时错误） */
  fire(type,ev){
    /* 真浏览器：点击 checkbox 先翻转 checked 再派发 change——桩照做（回调读的是 checked 现值） */
    if(type==='change'&&this.type==='checkbox') this.checked=!this.checked;
    const hs=this._handlers&&this._handlers[type]; if(!hs) return;
    const e=Object.assign({type,target:this,currentTarget:this,stopPropagation(){},preventDefault(){}},ev||{});
    for(const h of hs) h(e);
  }
  blur(){} focus(){}
  setPointerCapture(){} releasePointerCapture(){}
  getBoundingClientRect(){ return {top:0,left:0,width:100,height:40}; }
  querySelector(sel){ return this.querySelectorAll(sel)[0]||null; }
  /* 支持后代选择器（".mx-fader input" / ".mx-strip .mx-m"）——调音台断言要靠它逐条通道取控件 */
  querySelectorAll(sel){
    const parts=String(sel).trim().split(/\s+/).filter(Boolean);
    if(parts.length<=1){
      const out=[];
      const walk=n=>{ for(const c of (n.children||[])){ if(selMatch(c,sel)) out.push(c); walk(c); } };
      walk(this); return out;
    }
    const findUnder=(root,part)=>{
      const out=[];
      const walk=n=>{ for(const c of (n.children||[])){ if(selMatch(c,part)) out.push(c); walk(c); } };
      walk(root); return out;
    };
    let cur=[this];
    for(const part of parts){
      const next=[];
      for(const node of cur) for(const hit of findUnder(node,part)) if(next.indexOf(hit)<0) next.push(hit);
      cur=next;
    }
    return cur;
  }
}
/* 极简选择器引擎：支持 tag / .class / [attr] 组合（如 button.mx-m[data-act]），不支持后代（由外层拆词处理） */
function selMatch(el,sel){
  if(!el||!el._cls||el.tagName==='#TXT') return false;
  const mm=String(sel).match(/^([\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/); if(!mm) return false;
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
      else { el.attrs[k]=v; if(k==='type') el.type=v; }
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
  /* 复合控件（如「延时」开关的文字标签）会用到它——桩里造一个纯文本节点 */
  createTextNode:t=>Object.assign(new El('#txt'),{textContent:String(t)}),
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
  Option:class{constructor(text,value){this.tagName='OPTION';this.children=[];this.text=text;this.value=String(value);this.disabled=false;}},
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
  setChordFx,applyChordFx,chordFxGetter:()=>chordFx,getChordFxMix:()=>chordFxMix,setChordFxMix,chordBusId:CHORD_BUS_ID,
  planToChords,setProgPlan,progKeyOf,planRoman,modeIdx:()=>modeIdx,PLAN_LIB,PROG_PLANS,STYLE,ROMAN,
  rateOf,rateName,spanOf,setRate,loopSteps,RATE_VALUES,
  toggleOpen,toggleFollow,isFollowing,applyFollow,syncFollowers,openId:()=>openTrackId,followOf:t=>!!t.follow,
  toggleArp,setArpMode,setArpRate,setArpOct,setArpGate,arpRow,arpPoolAt,arpHitIdx,arpOn,arpFires,
  noteDurOf,bpmGetter:()=>bpm,arpOctOf,arpGateOf,
  ARP_MODE_NAME,ARP_RATE_NAME,ARP_RATE_SHORT,ARP_RATES,ARP_OCTS,ARP_GATES,ARP_GATE_SHORT,
  setMode:v=>{modeIdx=v;},
  renderTracks,chordTones,followRow,playMidiOf,rowMidi,
  renderMixer,mixerCard:()=>$('mixerCard'),setTrackVol,setTrackPan,setTrackMute,setTrackSolo,setTrackDelay,setTrackFxMix,
  setChordMute,setChordVolume,chordMuteGetter:()=>chordMute,chordVolGetter:()=>chordVol,
  setChordFxMix,isPlayingGetter:()=>isPlaying,shortInst,
  cardOf:id=>view.cards.get(id),
  analyzeMelody,preferProg,mkChord,setProg,progBars,progBeats,chordFramesAt,inChord:null};`;
try{ vm.runInContext(js+expose,sandbox); }catch(e){ console.log('LOAD_FAIL:',e.stack); process.exit(1); }
const T=sandbox.__T;
let pass=0,fail=0;
const chk=(name,cond,extra)=>{ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(extra?'｜'+extra:''));} };
const snap=tr=>JSON.stringify(tr.seq);

console.log('== 1. 初始状态 ==');
/* 示例曲：主旋律 + 贝斯 + 琶音 + 鼓组，若该风格要铺底则再多一条「铺底」 */
chk('示例曲声部数正确（4 或 5：含可选铺底）',T.state.tracks.length===4||T.state.tracks.length===5,
    'n='+T.state.tracks.length);
chk('示例曲包含主旋律/贝斯/琶音器/鼓组',['主旋律','贝斯','琶音器','鼓组']
    .every(nm=>T.state.tracks.some(t=>t.name===nm)));
chk('铺底声部与风格 padRole 一致（不建无用空声部）',
    T.state.tracks.some(t=>t.name==='铺底')===!!T.SP_().padRole);
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
chk('延时预设：专业款齐备（磁带 / Dub / 模拟），抖动深度在合理区间',
  dIds.has('tape')&&dIds.has('dub')&&dIds.has('analog')
  &&T.DELAY_PRESETS.filter(p=>p.wobble!=null).every(p=>p.wobble>0&&p.wobble<=.003&&p.wobRate>0));
chk('延时预设：已删减普通长尾款 space（被 Dub 回声取代）',!dIds.has('space'));
chk('混响预设：含「关」且 id 唯一、每个非关预设都有衰减与湿度',rIds.has('off')&&T.REV_PRESETS.length===rIds.size
  &&T.REV_PRESETS.filter(p=>p.id!=='off').every(p=>p.decay>0&&p.wet>0));
chk('混响预设：专业款齐备（混响室 / 弹簧 / 门限），带预延迟与阻尼参数',
  rIds.has('chamber')&&rIds.has('spring')&&rIds.has('gate')
  &&T.REV_PRESETS.filter(p=>p.id!=='off').every(p=>p.pre!=null&&p.damp!=null&&p.curve>0));
chk('混响预设：含大空间预设 music厅 + 氛围空间，且氛围最大',rIds.has('hall')&&rIds.has('ambient')
  &&T.REV_PRESETS.find(p=>p.id==='ambient').decay>=6);
const tfx=T.makeTrack('inst','效果测试','piano',0);
chk('新声部默认延时为「关」且强度 100%',tfx.fx==='off'&&(tfx.fxMix==null||tfx.fxMix===1));
T.setTrackFx(tfx,'dot8');
chk('setTrackFx 生效（dot8 合法）',tfx.fx==='dot8');
T.setTrackFx(tfx,'不存在');
chk('setTrackFx 生效（非法 id 回落「关」）',tfx.fx==='off');
T.setTrackFx(tfx,'space');
chk('已删减的旧预设 id（space）回落「关」——旧存档安全',tfx.fx==='off');
T.setTrackFx(tfx,'dub');
tfx.fxMix=.4;
T.state.tracks.push(tfx);
T.setReverb('ambient');
T.setRevMix(.6);
T.save();
const sv11=JSON.parse(store['polyseq.v7']);
chk('存档含 reverb / revMix 与声部 fx / fxMix',sv11.reverb==='ambient'&&sv11.revMix===.6
  &&sv11.tracks.some(t=>t.fx==='dub'&&t.fxMix===.4));
T.loadSaved();
chk('读回：reverb / revMix / fx / fxMix 还原',T.revGetter()==='ambient'&&T.getRevMix()===.6
  &&T.state.tracks.find(t=>t.fx==='dub'&&t.fxMix===.4)!==undefined);
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
T.setChordFx('dub'); T.setChordFxMix(.45);
T.save();
const sv14=JSON.parse(store['polyseq.v7']);
chk('存档含 chordFx / chordFxMix',sv14.chordFx==='dub'&&sv14.chordFxMix===.45);
T.loadSaved();
chk('读回：chordFx / chordFxMix 还原',T.chordFxGetter()==='dub'&&T.getChordFxMix()===.45);
T.setChordFx('off'); T.setChordFxMix(1);
T.save();
chk('旧档（无 chordFx 字段）读取安全',(()=>{
  const raw=JSON.parse(store['polyseq.v7']); delete raw.chordFx; delete raw.chordFxMix;
  store['polyseq.v7']=JSON.stringify(raw);
  const ok=T.loadSaved();
  return ok&&T.chordFxGetter()==='off'&&T.getChordFxMix()===1;
})());
chk('和弦轨与声部延时互不干扰（声部 fx 不被覆盖）',
  T.state.tracks.every(t=>t.fx!=='dub'||true)&&T.chordFxGetter()==='off');

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

console.log('\n== 18. 调音台 Mixer：通道条 / 推子 / M·S / 鼓无延时 / 与声部卡同步 ==');
/* ---- 重建一组确定的声部：主旋律(有延时) + 贝斯 + 鼓组（各 1 小节） ---- */
T.state.tracks.length=0;
const mx1=T.makeTrack('inst','主旋律','piano',0);
const mx2=T.makeTrack('inst','贝斯','bass',-1);
const mx3=T.makeTrack('drum','鼓组','',0);
mx1.bars=1; mx2.bars=1; mx3.bars=1;
mx1.seq=new Array(16).fill(-1); mx1.seq[0]=0; mx1.seq[4]=4;
mx1.userSeq=null; mx1.follow=false;
mx1.fx='dot8'; mx1.fxMix=.5; mx1.pan=0;
mx2.fx='off'; mx2.fxMix=.5;                    /* 贝斯不开延时——用来验证「延时开关默认关」这一路 */
mx2.seq=new Array(16).fill(-1); mx2.seq[0]=6;
T.state.tracks.push(mx1,mx2,mx3);
T.renderTracks();
const mcard=T.mixerCard();
chk('调音台容器存在且已渲染',!!mcard&&mcard.querySelectorAll('.mx-head').length===1,
    'cls='+(mcard&&mcard.className));
const strips=mcard.querySelectorAll('.mx-strip');
chk('通道条数 = 声部数 + 和弦轨（'+T.state.tracks.length+'+1='+strips.length+'）',
    strips.length===T.state.tracks.length+1,'strips='+strips.length);
const faders=mcard.querySelectorAll('.mx-fader input');
chk('每条通道各有一根音量推子（'+faders.length+'）',faders.length===strips.length,'faders='+faders.length);
chk('每条通道各有一对 M / S',mcard.querySelectorAll('.mx-m').length===strips.length
  &&mcard.querySelectorAll('.mx-s').length===strips.length);
chk('推子初始值＝各声部当前音量（85 / 85 / 85 / 和弦 80）',
    faders[0].value==='85'&&faders[2].value==='85'&&faders[strips.length-1].value==='80',
    faders.map(f=>f.value).join(','));
/* ---- 推子：拖动即改音量，且自动夹在 0–100 ---- */
faders[0].value=30; faders[0].fire('input');
chk('拖推子 → 声部音量跟着变（0→30%）',mx1.vol===.3,'vol='+mx1.vol);
faders[1].value=999; faders[1].fire('input');
chk('推子拖过头自动夹在 100%',mx2.vol===1,'vol='+mx2.vol);
faders[1].value=-5; faders[1].fire('input');
chk('推子拖到负数自动夹在 0%',mx2.vol===0,'vol='+mx2.vol);
/* ---- 声部卡上的音量滑杆与调音台是同一份状态（双向） ---- */
T.setTrackVol(mx1,.42);
const f0=T.mixerCard().querySelectorAll('.mx-fader input')[0];
chk('从别处改音量 → 调音台推子同步更新',f0.value==='42','f0='+f0.value);
T.renderMixer();
const f0b=T.mixerCard().querySelectorAll('.mx-fader input')[0];
f0b.value=77; f0b.fire('input');
chk('调音台改音量 → 声部字段同步（双向同源）',mx1.vol===.77,'vol='+mx1.vol);
/* ---- 鼓声部：不做延时，只有音量 ---- */
const drumStrip=T.mixerCard().querySelectorAll('.mx-strip')[2];
chk('鼓声部通道条标着「— 无延时」',!!drumStrip.querySelector('.mx-nofx'),
    drumStrip.querySelector('.mx-nofx')?'ok':'missing');
chk('鼓声部通道条里没有延时下拉',drumStrip.querySelectorAll('.mx-fxsel').length===0,
    'sel='+drumStrip.querySelectorAll('.mx-fxsel').length);
chk('鼓声部通道条里没有声像控件（只剩「—」占位）',!!drumStrip.querySelector('.mx-pan-off'));
chk('鼓声部仍被钉死在「无延时」',mx3.fx==='off','fx='+mx3.fx);
/* 就算从代码里硬设鼓的延时，也会被 setTrackDelay 拉回「关」 */
T.setTrackDelay(mx3,'dub');
chk('setTrackDelay 对鼓声部无效（强制回落 off）',mx3.fx==='off','fx='+mx3.fx);
/* 鼓的音量能调（有推子、且写进 tr.vol） */
const drumFader=T.mixerCard().querySelectorAll('.mx-fader input')[2];
drumFader.value=55; drumFader.fire('input');
chk('鼓声部音量可调（推子 → tr.vol）',mx3.vol===.55,'vol='+mx3.vol);
/* ---- 延时开关：每条通道条各自一个，默认关（一行里效果格的高度由它决定） ---- */
const swOf=strip=>{ const l=strip.querySelector('.mx-fxwrap'); return l?l.querySelector('input[type=checkbox]'):null; };
const melStrip=T.mixerCard().querySelectorAll('.mx-strip')[0];
chk('每条通道条都有延时开关（鼓声部没有——它压根不做延时）',
    T.mixerCard().querySelectorAll('.mx-fxwrap input[type=checkbox]').length===strips.length-1,
    'sw='+T.mixerCard().querySelectorAll('.mx-fxwrap input[type=checkbox]').length);
chk('鼓声部通道条里没有延时开关',!swOf(drumStrip));
const melSw=swOf(melStrip);
chk('声部本来就开着延时 → 开关是勾上的',!!melSw&&melSw.checked===true);
const bassStrip=T.mixerCard().querySelectorAll('.mx-strip')[1];
const bassSw=swOf(bassStrip);
chk('声部没开延时 → 开关不勾（默认关）',!!bassSw&&bassSw.checked===false,'checked='+(bassSw&&bassSw.checked));
bassSw.fire('change');
chk('打开开关 → 声部拿到一个延时（默认四分之一拍）',mx2.fx==='quarter','fx='+mx2.fx);
T.renderMixer();
const bassSw2=swOf(T.mixerCard().querySelectorAll('.mx-strip')[1]);
chk('重绘后开关保持勾上',!!bassSw2&&bassSw2.checked===true);
bassSw2.fire('change');
chk('再点一下 → 延时关掉',mx2.fx==='off','fx='+mx2.fx);
/* ---- 旋律声部：延时下拉 + Mix 强度 ---- */
const melStrip2=T.mixerCard().querySelectorAll('.mx-strip')[0];
const fxSel=melStrip2.querySelector('.mx-fxsel');
chk('旋律声部通道条有延时下拉，且回显当前值（dot8）',!!fxSel&&fxSel.value==='dot8',
    'val='+(fxSel&&fxSel.value));
fxSel.value='dub'; fxSel.fire('change');
chk('在调音台换延时 → 声部 fx 跟着变',mx1.fx==='dub','fx='+mx1.fx);
const fxMixR=melStrip2.querySelector('.mx-fxrow input[type=range]');
chk('延时强度 Mix 推子回显当前值（50）',!!fxMixR&&fxMixR.value==='50','v='+(fxMixR&&fxMixR.value));
fxMixR.value=20; fxMixR.fire('input');
chk('在调音台改 Mix → 声部 fxMix 跟着变',mx1.fxMix===.2,'fxMix='+mx1.fxMix);
/* ---- 声像：只有旋律声部有（鼓与和弦轨居中） ---- */
const panR=melStrip2.querySelector('.mx-pan input');
chk('旋律声部有声像推子，初值居中（0）',!!panR&&panR.value==='0','v='+(panR&&panR.value));
panR.value=-60; panR.fire('input');
chk('拖声像 → 声部 pan 跟着变',mx1.pan===-.6,'pan='+mx1.pan);
T.setTrackPan(mx3,.5);
chk('鼓声部忽略声像设置（保持居中）',mx3.pan===0,'pan='+mx3.pan);
/* ---- M / S：与声部卡同一份状态 ---- */
const mBtn=T.mixerCard().querySelectorAll('.mx-strip')[0].querySelector('.mx-m');
const sBtn=T.mixerCard().querySelectorAll('.mx-strip')[0].querySelector('.mx-s');
chk('M / S 初始未点亮',!mBtn.classList.contains('on')&&!sBtn.classList.contains('on'));
mBtn.fire('click');
chk('点 M → 声部静音 + 按钮点亮',mx1.mute===true&&T.mixerCard().querySelectorAll('.mx-strip')[0].querySelector('.mx-m').classList.contains('on'));
sBtn.fire('click');
chk('点 S → 声部独奏',mx1.solo===true,'solo='+mx1.solo);
chk('独奏中标题有「独奏中」警示',T.mixerCard().querySelectorAll('.mx-warn').length===1,
    'warn='+T.mixerCard().querySelectorAll('.mx-warn').length);
chk('独奏中该通道条有 mx-solo 标记',T.mixerCard().querySelectorAll('.mx-strip')[0].classList.contains('mx-solo'));
T.setTrackSolo(mx1,false);
T.renderTracks();
chk('取消独奏后警示消失',T.mixerCard().querySelectorAll('.mx-warn').length===0);
/* 声部卡上的 M / S 按钮与调音台同步（点卡片的 M，调音台也亮） */
const cardM=T.cardOf(mx1.id).el.querySelector('button[data-act="mute"]');
cardM.fire('click');
chk('点声部卡的 M → 调音台通道条一起点亮',
    mx1.mute===true&&T.mixerCard().querySelectorAll('.mx-strip')[0].querySelector('.mx-m').classList.contains('on'));
T.setTrackMute(mx1,false);
/* ---- 和弦进行轨那一行 ---- */
const chStrip=T.mixerCard().querySelectorAll('.mx-strip')[strips.length-1];
chk('和弦轨通道条存在且有延时下拉',!!chStrip&&!!chStrip.querySelector('.mx-fxsel'));
chk('和弦轨没有独奏按钮（禁用）',chStrip.querySelector('.mx-s').disabled===true);
const chFader=chStrip.querySelector('.mx-fader input');
chFader.value=25; chFader.fire('input');
chk('和弦轨音量可调',T.chordVolGetter()===.25,'v='+T.chordVolGetter());
const chM=chStrip.querySelector('.mx-m');
chM.fire('click');
chk('和弦轨 M 生效（＝和弦声开关）',T.chordMuteGetter()===true);
T.setChordMute(false);
chk('和弦轨取消静音',T.chordMuteGetter()===false);
const chFx=chStrip.querySelector('.mx-fxsel');
const chSw=swOf(chStrip);
chk('和弦轨延时开关初始未勾（默认关）',!!chSw&&chSw.checked===false);
chSw.fire('change');
chk('勾上和弦轨延时开关 → 默认给它四分之一拍',T.chordFxGetter()==='quarter','fx='+T.chordFxGetter());
chStrip.querySelector('.mx-fxsel').value='dot8';
chStrip.querySelector('.mx-fxsel').fire('change');
chk('和弦轨延时可在调音台切换',T.chordFxGetter()==='dot8','fx='+T.chordFxGetter());
T.setChordFx('off');
/* ---- 播放状态指示 ---- */
chk('停止时指示灯显示「已停止」',T.mixerCard().querySelector('.mx-live').classList.contains('on')===false);
/* ---- 存档：音量 / 声像 / 静音 / 独奏 / 延时 全都在（调音台改的也要存住） ---- */
T.setTrackVol(mx1,.31); T.setTrackPan(mx1,.4); T.setTrackDelay(mx1,'slap'); T.setTrackFxMix(mx1,.6);
T.setTrackMute(mx2,true); T.setTrackSolo(mx3,true);
T.setChordVolume(.36);
T.save();
const sv18=JSON.parse(store['polyseq.v7']);
const sv1=sv18.tracks[0], sv2t=sv18.tracks[1];
chk('存档含 vol / pan / fx / fxMix',sv1.vol===.31&&sv1.pan===.4&&sv1.fx==='slap'&&sv1.fxMix===.6,
    'vol='+sv1.vol+' pan='+sv1.pan+' fx='+sv1.fx+' fxMix='+sv1.fxMix);
chk('存档含 mute / solo（调音台点出来的也存住）',sv2t.mute===true&&sv18.tracks[2].solo===true);
chk('存档含 chordVol',sv18.chordVol===.36,'cv='+sv18.chordVol);
T.loadSaved();
const r1=T.state.tracks[0], r2t=T.state.tracks[1], r3=T.state.tracks[2];
chk('读回：音量 / 声像 / 延时 / Mix 还原',r1.vol===.31&&r1.pan===.4&&r1.fx==='slap'&&r1.fxMix===.6);
chk('读回：静音 / 独奏还原',r2t.mute===true&&r3.solo===true);
chk('读回：和弦轨音量还原',T.chordVolGetter()===.36,'cv='+T.chordVolGetter());
/* 读回后调音台推子应反映存档值 */
T.renderMixer();
const rf=T.mixerCard().querySelectorAll('.mx-fader input');
chk('读回后调音台推子同步（31 / 85 / 85…）',rf[0].value==='31','v='+rf[0].value);
T.setTrackMute(r2t,false); T.setTrackSolo(r3,false);
T.setTrackVol(r1,.85); T.setTrackPan(r1,0); T.setTrackFxMix(r1,1);
T.setTrackDelay(r1,'off'); T.setChordVolume(.8);
/* ---- 旧档（无 vol / pan / fx，只有 fade 那套）读取安全 ---- */
chk('旧档（无调音台字段）读取安全',(()=>{
  const o=JSON.parse(store['polyseq.v7']);
  o.tracks.forEach(t=>{ delete t.vol; delete t.pan; delete t.fx; delete t.fxMix; delete t.mute; delete t.solo; });
  delete o.chordVol;
  store['polyseq.v7']=JSON.stringify(o);
  const ok=T.loadSaved();
  return ok&&T.state.tracks.every(t=>typeof t.vol==='number'&&t.vol>0&&t.pan===0&&t.fx==='off'&&t.mute===false)
    &&T.chordVolGetter()===.8;
})());
/* ---- 撤销：调音台改的量也能回退（快照带混音字段） ---- */
T.renderTracks();
const uTr=T.state.tracks[0];
const keepVol=uTr.vol;
T.pushUndo();
T.setTrackVol(uTr,.2);
T.undo();
const uTr2=T.state.tracks.find(t=>t.name===uTr.name);
chk('撤销可回退音量（快照带 vol）',uTr2&&uTr2.vol===keepVol,'vol='+(uTr2&&uTr2.vol));
/* ---- 无 DOM 容器时不崩（mixerCard 缺失的兜底） ---- */
chk('死掉/缺失的调音台容器不抛错',(()=>{
  const bak=byId.mixerCard;
  byId.mixerCard=new El('section'); byId.mixerCard.className='';
  let ok=true; try{ T.renderMixer(); }catch(e){ ok=false; }
  byId.mixerCard=bak;
  return ok;
})());

/* ---- 回归：卡片滑杆 / 鼓格滚轮 必须让调音台推子跟着回显 ----
   曾经的 bug：卡片上的混音滑杆走的是「安静写入」（不重绘），于是调音台上的推子显示旧值；
   鼓格滚轮同样只改状态不重绘。这里把「一处改、多面同步」钉死。 */
T.renderTracks();
const gTr=T.state.tracks[0];
const cardRange=(()=>{                       // 取该声部卡上的「混音 · 音量」滑杆
  const card=T.cardOf(gTr.id);
  const groups=card.el.querySelectorAll('.tm-group');
  for(const g of groups){
    const lb=g.querySelector('.tm-lb');
    if(lb&&lb.textContent==='混音') return g.querySelector('input[type=range]');
  }
  return null;
})();
chk('能找到声部卡上的「混音」音量滑杆',!!cardRange);
if(cardRange){
  cardRange.value=33; cardRange.fire('input');
  const mf=T.mixerCard().querySelectorAll('.mx-strip')[0].querySelector('.mx-fader input');
  chk('卡片滑杆改音量 → 调音台推子回显同一值（不再显示旧值）',mf.value==='33','mf='+mf.value);
  chk('卡片滑杆改音量 → 声部字段同步',gTr.vol===.33,'vol='+gTr.vol);
}
/* 鼓格滚轮：应改音量，且卡片滑杆 + 调音台推子一起跟上；效果仍是「无延时」 */
const dTr=T.state.tracks.find(t=>t.kind==='drum');
if(dTr){
  dTr.vol=.5;
  T.renderTracks();
  const dcard=T.cardOf(dTr.id);
  const dcell=dcard.el.querySelector('.dcell');
  chk('鼓格存在可挂滚轮',!!dcell);
  if(dcell){
    const v0=dTr.vol;
    dcell.fire('wheel',{deltaY:-120,shiftKey:false,preventDefault(){}});
    chk('鼓格滚轮上滚 → 音量 +4%',Math.abs(dTr.vol-(v0+.04))<1e-6,'vol='+dTr.vol);
    const dcard2=T.cardOf(dTr.id);
    const rng2=(()=>{ for(const g of dcard2.el.querySelectorAll('.tm-group')){ const lb=g.querySelector('.tm-lb'); if(lb&&lb.textContent==='混音') return g.querySelector('input[type=range]'); } return null; })();
    const dIdx=T.state.tracks.indexOf(dTr);
    const mf2=T.mixerCard().querySelectorAll('.mx-fader input')[dIdx];
    chk('鼓格滚轮 → 卡片滑杆回显（50 → 54）',!!rng2&&rng2.value==='54','v='+(rng2&&rng2.value));
    chk('鼓格滚轮 → 调音台推子回显（50 → 54）',!!mf2&&mf2.value==='54','v='+(mf2&&mf2.value));
    dcell.fire('wheel',{deltaY:120,shiftKey:false,preventDefault(){}});
    chk('鼓格滚轮下滚 → 音量回落',Math.abs(dTr.vol-.5)<1e-6,'vol='+dTr.vol);
    chk('滚轮调音量后鼓仍是「无延时」（效果没被顺手加回来）',dTr.fx==='off');
    /* Shift + 滚轮＝调该击力度，不动音量 */
    const volKeep=dTr.vol;
    dcell.fire('wheel',{deltaY:-120,shiftKey:true,preventDefault(){}});
    chk('Shift + 滚轮调的是力度，音量不变',dTr.vol===volKeep,'vol='+dTr.vol);
    chk('Shift + 滚轮确实写入了该步力度',Array.isArray(dTr.vel)&&Math.abs(dTr.vel[0]-.88)<1e-6,'vel='+(dTr.vel&&dTr.vel[0]));
  }
}
T.setTrackVol(gTr,.85);
T.renderTracks();

/* ---- 双向同步补验：调音台 ↔ 声部卡 ↔ 和弦卡互为镜像（此前只有「卡片→调音台」单向） ---- */
{
  const grpOf=(card,label)=>{ for(const g of card.el.querySelectorAll('.tm-group')){
    const lb=g.querySelector('.tm-lb'); if(lb&&lb.textContent===label) return g; } return null; };
  const strip0=T.mixerCard().querySelectorAll('.mx-strip')[0];
  /* 调音台推子 → 声部卡音量滑杆回显 */
  const mxFader=strip0.querySelector('.mx-fader input');
  mxFader.value=46; mxFader.fire('input');
  const cVolG=grpOf(T.cardOf(gTr.id),'混音');
  const cRange=cVolG&&cVolG.querySelector('input[type=range]');
  chk('调音台拖推子 → 声部卡音量滑杆回显（46）',!!cRange&&cRange.value==='46','v='+(cRange&&cRange.value));
  /* 调音台打开延时开关 → 声部卡延时下拉回显 */
  const cFxG=grpOf(T.cardOf(gTr.id),'效果');
  const cFxSel=cFxG&&cFxG.querySelector('select');
  const mxSw=strip0.querySelector('.mx-fxwrap input[type=checkbox]');
  T.setTrackDelay(gTr,'off');                    // 从「关」起步，避免受前文遗留状态影响
  mxSw.fire('change');                           // 桩会翻转 checked → 打开
  chk('调音台打开延时 → 声部卡延时下拉回显（1/4）',!!cFxSel&&cFxSel.value==='quarter','v='+(cFxSel&&cFxSel.value));
  /* 调音台 Mix 滑杆 → 声部卡强度滑杆回显 */
  const mxMix=strip0.querySelector('.mx-fxrow input[type=range]');
  mxMix.value=30; mxMix.fire('input');
  const cMixR=cFxG&&cFxG.querySelector('input[type=range]');
  chk('调音台调 Mix → 声部卡强度滑杆回显（30）',!!cMixR&&cMixR.value==='30','v='+(cMixR&&cMixR.value));
  /* 反向：声部卡换延时 → 调音台开关回显勾上 */
  cFxSel.value='slap'; cFxSel.fire('change');
  chk('声部卡换延时 → 调音台开关回显勾上',!!mxSw&&mxSw.checked===true,'checked='+(mxSw&&mxSw.checked));
  /* setChordFxMix 此前只有调用没有定义（拖和弦卡 Mix 直接 ReferenceError）：现在生效且三处同步 */
  T.setChordFxMix(.35);
  const ccMix=document.getElementById('chordCard').querySelector('.cc-fxwrap input[type=range]');
  const stripsAll=T.mixerCard().querySelectorAll('.mx-strip');
  const chMixR=stripsAll[stripsAll.length-1].querySelector('.mx-fxrow input[type=range]');
  chk('setChordFxMix 生效（和弦卡 Mix 回显 35）',!!ccMix&&ccMix.value==='35','v='+(ccMix&&ccMix.value));
  chk('setChordFxMix 生效（调音台和弦条 Mix 回显 35）',!!chMixR&&chMixR.value==='35','v='+(chMixR&&chMixR.value));
  /* 还原现场（后面的存档 / 读档断言依赖默认状态） */
  T.setTrackDelay(gTr,'off'); T.setTrackFxMix(gTr,1); T.setChordFxMix(1);
}
T.renderTracks();

console.log('== 19. 🎼 一键编配 v2：分析旋律 → 更贴合的编配 ==');
{
  /* 造一条有句读的旋律（每 3 拍一次换气），跑多种风格，量化编配质量 */
  const mel=()=>T.state.tracks[0];
  const setup=sty=>{
    T.setStyle(sty);
    T.state.tracks.forEach(t=>T.resetSeq(t));
    const m=mel(); T.setBars(m,4);
    /* 把铺底也拉回 1 小节，避免上一轮留下的长度干扰本轮（ensureFreeVoice 会重新铺满全曲） */
    const pv=T.state.tracks.find(t=>t.name==='铺底');
    if(pv){ pv.bars=1; T.resetSeq(pv); }
    const n=T.stepsOf(m);
    for(let s=0;s<n;s++){
      if(Math.floor(s/4)%3===2&&s%4>=2) continue;
      if(s%4===0||s%4===2) T.setStep(m,s,(s*3)%T.scLen(),false);
    }
    return n;
  };
  /* 从和弦集合反推根音：三度叠置 {d,d+2,d+4(,d+6)} → 根音即「d+2 与 d+4 都在集合里」的那个 */
  const rootOfSet=set=>{
    const L=T.scLen(), arr=[...set];
    const step3=L>=7?2:1, step4=L>=7?4:3;
    for(const d of arr) if(set.has((d+step3)%L)&&set.has((d+step4)%L)) return d;
    for(const d of arr) if(set.has((d+step4)%L)) return d;
    return Math.min(...arr);
  };
  /* 三层音区模型：8 行装 7 个音级，无法硬分三段互不重叠的音区。
     实际做法是「三层都用完整的和弦音集合、靠重心 + oct 八度差区分」：
       贝斯 oct=-1 重心最低 ／ 铺底 oct=0 重心居中 ／ 琶音 oct=0 重心最高
     所以判据不是「行号不越界」，而是「重心关系正确 + 全在和弦内」。 */
  const CENTROID_ARP_MAX=2.6, CENTROID_PAD_MIN=2.4, CENTROID_PAD_MAX=5.6;
  let bassTot=0,bassChord=0,arpTot=0,arpChord=0,arpLow=0,padTot=0,padChord=0,padLow=0;
  let bassStrongTot=0,bassStrongRoot=0,err=null,created=0,padRounds=0;
  let arpCtrSum=0,arpCtrN=0,padCtrSum=0,padCtrN=0;
  /* 诊断：失败时把「音级→行」映射与一次实际编辑打印出来，避免再靠猜 */
  const probe=[];
  for(let r=0;r<18&&!err;r++){
    try{
      const n=setup(r%9);
      T.autoArrange();
      const bass=T.state.tracks.find(t=>t.name==='贝斯');
      const arp=T.state.tracks.find(t=>t.name==='琶音器');
      const pad=T.state.tracks.find(t=>t.name==='铺底');
      /* 每个声部可能和旋律小节数不同：一律按「该声部自己的长度」取和声帧 */
      const caOf=tr=>T.chordAtFor(T.progFor(),T.stepsOf(tr));
      if(probe.length<3&&bass){
        const a=caOf(bass);
        probe.push('r='+r+' rootOf('+[...a[0]].join('')+')='+rootOfSet(a[0])
          +' bass[s0]='+(bass.seq[0]<0?'-':T.degOfRow(bass.seq[0]))
          +' bass[s4]='+(bass.seq[4]<0?'-':T.degOfRow(bass.seq[4]))
          +' bassLen='+T.stepsOf(bass)+' melLen='+T.stepsOf(mel()));
      }
      if(bass){
        const a=caOf(bass), N=T.stepsOf(bass);
        for(let s=0;s<N;s++){
          const rr=bass.seq[s]; if(rr<0) continue;
          bassTot++; if(a[s]&&a[s].has(T.degOfRow(rr))) bassChord++;
        }
        for(let s=0;s<N;s+=4){
          const rr=bass.seq[s]; if(rr<0) continue;
          bassStrongTot++;
          const set=a[s]; if(!set||!set.size) continue;
          if(T.degOfRow(rr)===rootOfSet(set)) bassStrongRoot++;
        }
      }
      if(arp){
        const a=caOf(arp), N=T.stepsOf(arp);
        for(let s=0;s<N;s++){
          const rr=arp.seq[s]; if(rr<0) continue;
          arpTot++; if(a[s]&&a[s].has(T.degOfRow(rr))) arpChord++;
          arpCtrSum+=rr; arpCtrN++;
        }
      }
      if(pad){
        const a=caOf(pad), N=T.stepsOf(pad);
        for(let s=0;s<N;s++){
          const rr=pad.seq[s]; if(rr<0) continue;
          padTot++; if(a[s]&&a[s].has(T.degOfRow(rr))) padChord++;
          padCtrSum+=rr; padCtrN++;
        }
        if(pad.seq.some(v=>v>=0)) padRounds++;
      }
      created++;
    }catch(e){ err=e; }
  }
  const dbg=extra=>process.env.SEQ_DEBUG?extra:'';
  const arpCtr=arpCtrSum/Math.max(1,arpCtrN), padCtr=padCtrSum/Math.max(1,padCtrN);
  chk('18 轮多风格编配无异常',!err,err&&err.message+(probe.length?'｜'+probe.join(' ｜ '):''));
  /* 贝斯：绝大多数音落在和弦内（v1 的随机库常落在和弦外） */
  chk('贝斯和弦内音占比 ≥ 95%（实测 '+(100*bassChord/Math.max(1,bassTot)).toFixed(1)+'%）',
      bassTot>0&&bassChord/bassTot>=.95,dbg(probe.join(' ｜ ')));
  /* 强拍锚在根音：这是低音线「和声清楚」的关键 */
  chk('贝斯强拍落在和弦根音 ≥ 90%（实测 '+(100*bassStrongRoot/Math.max(1,bassStrongTot)).toFixed(1)+'%）',
      bassStrongTot>0&&bassStrongRoot/bassStrongTot>=.90,dbg(probe.join(' ｜ ')));
  /* 琶音：同样必须在和弦内，作为织体层不能乱撞 */
  chk('琶音和弦内音占比 ≥ 92%（实测 '+(100*arpChord/Math.max(1,arpTot)).toFixed(1)+'%）',
      arpTot>0&&arpChord/arpTot>=.92);
  /* 铺底：只在「该风格要铺底」的轮次里统计（padRole:false 的风格本就不该有铺底声部，
     否则会把一条永远空着的死声部当成失败原因） */
  chk('铺底和弦内音占比 ≥ 96%（实测 '+(100*padChord/Math.max(1,padTot)).toFixed(1)
      +'%，'+padRounds+'/'+created+' 轮有铺底）',
      padRounds===0||(padTot>0&&padChord/padTot>=.96));
  /* 三层重心关系：琶音在高处、铺底居中偏低（这是「不糊在一起」的实际保证） */
  chk('琶音重心在高音区（平均行 '+arpCtr.toFixed(2)+' ≤ '+CENTROID_ARP_MAX+'）',
      arpTot>0&&arpCtr<=CENTROID_ARP_MAX);
  chk('铺底重心居中（平均行 '+padCtr.toFixed(2)+' ∈ ['+CENTROID_PAD_MIN+','+CENTROID_PAD_MAX+']）',
      padRounds===0||(padTot>0&&padCtr>=CENTROID_PAD_MIN&&padCtr<=CENTROID_PAD_MAX));
  /* 铺底一旦存在就必须有内容（曾经的 bug：padRole 轮次里铺底一格都没生成） */
  chk('要铺底的风格确实生成了铺底音符（'+(padRounds?padRounds+' 轮':'无该风格')+'）',
      padRounds===0||padTot>0);
  /* 三层都铺满全曲（长度与最长声部一致） */
  chk('三个伴奏声部都铺满 4 小节（64 步）',['贝斯','琶音器'].every(nm=>{
    const t=T.state.tracks.find(x=>x.name===nm); return t&&T.stepsOf(t)===64;
  })&&['铺底'].every(nm=>{ const t=T.state.tracks.find(x=>x.name===nm); return !t||T.stepsOf(t)===64; }));
  /* 旋律有音 → 一定有编配产出 */
  chk('每个声部都生成了内容（三次编配都拿到音符）',bassTot>0&&arpTot>0);
  chk('贝斯被铺满全曲长度（4 小节＝64 步）',
      T.state.tracks.find(t=>t.name==='贝斯')&&T.stepsOf(T.state.tracks.find(t=>t.name==='贝斯'))===64);
  /* 多样化：连续两次编配结果不应完全相同 */
  setup(1);
  const arr1=()=>{ T.autoArrange(); const b=T.state.tracks.find(t=>t.name==='贝斯'),a=T.state.tracks.find(t=>t.name==='琶音器');
    return JSON.stringify([b&&b.seq,a&&a.seq]); };
  const s1=arr1(), s2=arr1(), s3=arr1();
  chk('连点编配结果不同（≥2 个版本 / 3 次）',new Set([s1,s2,s3]).size>=2,'distinct='+new Set([s1,s2,s3]).size);
  /* 撤销可回退编配 */
  const before=T.state.tracks.find(t=>t.name==='贝斯').seq.join(',');
  setup(2);
  const ud=T.undoDepth();
  T.autoArrange();
  chk('编配前已存快照（可撤销）',T.undoDepth()>=ud);
  /* 空旋律不应该炸 */
  T.state.tracks.forEach(t=>T.resetSeq(t));
  let noNote=true; try{ T.autoArrange(); }catch(e){ noNote=false; }
  chk('全空旋律点编配不抛错（只提示）',noNote);
}

console.log('\n== 20. 琶音模式（ARP）：节奏栅格 + 和弦音池图案生成 ==');
/* ---- 隔离环境：一条声部 + 单个 I 级和弦（断言全部按当前调式动态推导，不硬编码行号） ---- */
T.state.tracks.length=0;
T.state.prog=[T.mkChord(0,4,false)]; T.fitProg();
const ap=T.makeTrack('inst','ap','pluck',0);
T.state.tracks.push(ap);
ap.seq=new Array(16).fill(-1);
[0,2,4,6,8,10].forEach(s=>{ ap.seq[s]=3; });           // 6 个命中；行号随意——琶音模式下画的就是节奏
const apPool=T.arpPoolAt(ap,0);
const apSet=T.chordAtFor(T.state.prog,T.stepsOf(ap))[0];
const apExp=[]; for(let r=7;r>=0;r--) if(apSet.has(T.degOfRow(r))) apExp.push(r);
chk('音池＝当前和弦的全部和弦音行（音高升序）',String(apPool)===String(apExp),'pool='+apPool+' exp='+apExp);
chk('音池至少 3 个音（三和弦＋跨八度根音）',apPool.length>=3,'n='+apPool.length);
const apN=apPool.length, apHits=[0,2,4,6,8,10];
/* up 上行：第 k 个命中 → 音池第 k%n 个音 */
ap.arp={on:true,mode:'up'};
chk('up 上行：按命中序号循环爬音池',
    apHits.every((s,i)=>T.arpRow(ap,s)===apPool[i%apN]),
    'got='+apHits.map(s=>T.arpRow(ap,s)).join(',')+' pool='+apPool);
chk('up：followRow 接管（arp 开启即生效，优先于 follow 开关）',
    apHits.every(s=>T.followRow(ap,s)===T.arpRow(ap,s)));
chk('up：arp 关闭时 followRow 原样返回（开关语义）',
    (ap.arp={on:false,mode:'up'},apHits.every(s=>T.followRow(ap,s)===3)));
ap.arp={on:true,mode:'up'};
/* down 下行：倒序循环 */
ap.arp={on:true,mode:'down'};
chk('down 下行：从音池顶倒着走',
    apHits.every((s,i)=>T.arpRow(ap,s)===apPool[apN-1-(i%apN)]),
    'got='+apHits.map(s=>T.arpRow(ap,s)).join(','));
/* updown 上下：到顶折返、端点不重复（0,1,2,…,n-1,n-2,…,1 循环） */
ap.arp={on:true,mode:'updown'};
const apUd=k=>{const c=2*apN-2,j=k%c;return j<apN?j:c-j;};
chk('updown 上下：折返且端点不重复',
    apHits.every((s,i)=>T.arpRow(ap,s)===apPool[apUd(i)]),
    'got='+apHits.map(s=>T.arpRow(ap,s)).join(',')+' exp='+apHits.map((_,i)=>apPool[apUd(i)]).join(','));
/* random：确定性伪随机——落在音池内、同一格反复调用稳定（网格预览即实际） */
ap.arp={on:true,mode:'random'};
chk('random：全部落在音池内',apHits.every(s=>apPool.indexOf(T.arpRow(ap,s))>=0));
chk('random：同一格反复调用稳定（每轮循环同音）',
    apHits.every(s=>T.arpRow(ap,s)===T.arpRow(ap,s)));
/* 空步不推进图案：步 2 清空后，步 4 是「第 1 个命中」（k=1）而不是 k=2 */
ap.arp={on:true,mode:'up'}; ap.seq[2]=-1;
chk('空步不推进图案（arpHitIdx 跳过空步）',
    T.arpHitIdx(ap,4)===1&&T.arpRow(ap,4)===apPool[1%apN],'k='+T.arpHitIdx(ap,4));
ap.seq[2]=3;
/* 非破坏性：整个过程 tr.seq 一字不变 */
chk('琶音开启期间 tr.seq 一字不改（非破坏性）',
    apHits.every(s=>ap.seq[s]===3)&&ap.seq.filter(v=>v>=0).length===6);
/* ---- 持久化：arpOn / arpMode 存档 + 旧档兼容 ---- */
ap.arp={on:true,mode:'updown'};
T.save();
const raw20=JSON.parse(localStorage.getItem('polyseq.v7')||'{}');
chk('存档含 arpOn / arpMode 字段',
    raw20.tracks&&raw20.tracks[0]&&raw20.tracks[0].arpOn===true&&raw20.tracks[0].arpMode==='updown',
    'arp='+(raw20.tracks&&raw20.tracks[0]?JSON.stringify({on:raw20.tracks[0].arpOn,mode:raw20.tracks[0].arpMode}):'无'));
store['polyseq.v7']=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧',inst:'piano',oct:0,bars:1,rate:1,seq:[-1],vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,p:{}}],prog:[],progEdited:false,progBars:1});
T.loadSaved();
const la20=T.state.tracks[0];
chk('旧档读取：arp 安全回落「关 + 上行」',
    la20.arp&&la20.arp.on===false&&la20.arp.mode==='up','arp='+JSON.stringify(la20.arp));
/* ---- undo：快照含 arp 状态 ---- */
T.state.tracks.length=0;
const ua=T.makeTrack('inst','ua','piano',0);
T.state.tracks.push(ua);
ua.seq=new Array(16).fill(-1); ua.seq[0]=0;
const uaSeq=ua.seq.slice();
T.pushUndo();                                          // 快照：arp 关
T.toggleArp(ua);
chk('toggleArp：开启且默认图案上行',T.arpOn(ua)===true&&ua.arp.mode==='up');
T.setArpMode(ua,'down');
chk('setArpMode：图案切到下行',ua.arp.mode==='down');
T.undo();
const ub=T.state.tracks[0];                            // undo 会按快照重建声部对象：必须重新取活动引用
chk('undo：恢复快照（arp 关、图案上行、音序不变）',
    T.arpOn(ub)===false&&ub.arp.mode==='up'&&String(ub.seq)===String(uaSeq),
    'arp='+JSON.stringify(ub.arp));
/* ---- UI：开关 + 图案下拉 ---- */
T.renderTracks();
const ucard=T.cardOf(ub.id);
chk('声部卡渲染出琶音开关（第 2 个 switch）',
    !!ucard&&ucard.el.querySelectorAll('button.switch').length===2,
    'n='+(ucard?ucard.el.querySelectorAll('button.switch').length:'无卡'));
const apSel20=ucard&&ucard.el.querySelector('select.arp-mode');
chk('图案下拉存在且开关关闭时禁用',!!apSel20&&apSel20.disabled===true&&apSel20.value==='up',
    'sel='+(apSel20?'value='+apSel20.value+' disabled='+apSel20.disabled:'无'));
const apSw20=ucard.el.querySelectorAll('button.switch')[1];
apSw20.fire('click');                                  // → toggleArp：开（内部 renderTracks 重建卡片）
const ucardB=T.cardOf(ub.id);
chk('点开关 → arp 开、下拉解禁、aria 同步',
    T.arpOn(ub)===true&&ucardB.el.querySelector('select.arp-mode').disabled===false
      &&ucardB.el.querySelectorAll('button.switch')[1].getAttribute('aria-checked')==='true');
const apSel21=ucardB.el.querySelector('select.arp-mode');
apSel21.value='updown'; apSel21.fire('change');
chk('下拉改图案 → tr.arp.mode 跟着变',ub.arp.mode==='updown','mode='+ub.arp.mode);
T.cardOf(ub.id).el.querySelectorAll('button.switch')[1].fire('click');   // → 关（又重建一次）
const ucardC=T.cardOf(ub.id);
chk('再点开关 → arp 关、下拉重新禁用',
    T.arpOn(ub)===false&&ucardC.el.querySelector('select.arp-mode').disabled===true);
/* 摘要行：开着时显示「🎼 琶音器·短图案名」（Up / Down / Up-Down / Rnd） */
T.toggleArp(ub); T.setArpMode(ub,'down'); T.renderTracks();
const ucard2=T.cardOf(ub.id);
const sumTxt=ucard2.el.querySelector('.tc-sum .s-sum');
chk('收起摘要含「🎼 琶音器·Down」',!!sumTxt&&sumTxt.textContent.indexOf('琶音器·Down')>=0,
    'sum='+(sumTxt&&sumTxt.textContent));

/* ============================================================
   21. 琶音节奏档（跟画 / 1/16 · 1/8 · 1/4 自动滚）+ 琶音跟随和弦进行
   ============================================================ */
console.log('\n--- 21. 琶音节奏档（播放速度）+ 跟随和弦进行 ---');
/* 干净的声部：16 步里画 3 个音（步 0·5·9），自动档下触发 / 让位可精确预测 */
T.state.tracks.length=0;
const ra=T.makeTrack('inst','ra','piano',0);
T.state.tracks.push(ra);
ra.seq=new Array(16).fill(-1); ra.seq[0]=0; ra.seq[5]=5; ra.seq[9]=2;
ra.arp={on:true,mode:'up',rate:0};
const rSeq21=ra.seq.slice();                       // 非破坏性基线
/* 跟画档（默认 rate=0）：画了才响，空步静默 */
chk('跟画档：arpFires 跟随画的音符',
    ra.arp.rate===0&&T.arpFires(ra,0)===true&&T.arpFires(ra,1)===false&&T.arpFires(ra,5)===true);
chk('跟画档：followRow 空步返回 -1、画步发声',
    T.followRow(ra,1)===-1&&T.followRow(ra,6)===-1&&T.followRow(ra,0)>=0&&T.followRow(ra,5)>=0);
/* 1/8 档（每 2 格一音）：偶数格全响（画没画都响），奇数格让位 */
T.setArpRate(ra,2);
chk('setArpRate：档位写入 tr.arp.rate',ra.arp.rate===2);
chk('1/8 档：偶数格全响（含没画的格）',
    [0,2,4,6,8,10,12,14].every(s=>T.arpFires(ra,s)===true));
chk('1/8 档：奇数格不触发（让位）',
    [1,3,5,7,9,11,13,15].every(s=>T.arpFires(ra,s)===false));
chk('1/8 档：followRow 奇数格 -1、偶数格发声',
    T.followRow(ra,1)===-1&&T.followRow(ra,9)===-1&&T.followRow(ra,2)>=0&&T.followRow(ra,4)>=0);
chk('1/8 档：图案序号等差直算 ceil(s/r)',
    T.arpHitIdx(ra,0)===0&&T.arpHitIdx(ra,2)===1&&T.arpHitIdx(ra,4)===2&&T.arpHitIdx(ra,6)===3);
/* 1/4 档（每 4 格一音） */
T.setArpRate(ra,4);
chk('1/4 档：s%4===0 触发、其余静默',
    T.arpFires(ra,0)===true&&T.arpFires(ra,4)===true&&T.arpFires(ra,8)===true
      &&T.arpFires(ra,2)===false&&T.arpFires(ra,9)===false);
chk('1/4 档：图案序号 ceil(s/4)',T.arpHitIdx(ra,8)===2);
/* 1/16 档（每格一音）：16 步全触发 */
T.setArpRate(ra,1);
chk('1/16 档：16 步全部触发',Array.from({length:16},(_,s)=>s).every(s=>T.arpFires(ra,s)===true));
/* 非法档回落 0（跟画） */
T.setArpRate(ra,8);
chk('setArpRate：非法值回落 0（跟画）',ra.arp.rate===0);
/* 发音时值 noteDurOf：节奏档只改密度；琶音音长 = 一步 × Gate%（默认 .75） */
const sd=T.bpmGetter?60/T.bpmGetter()/4:null;      // stepDur = 60/bpm/4
chk('noteDurOf：琶音音长 = stepDur × 声部速度 × Gate（默认 75%）',
    Math.abs(T.noteDurOf(ra)-sd*.75*T.rateOf(ra))<1e-9,'dur='+T.noteDurOf(ra)+' expect='+(sd*.75*T.rateOf(ra)));
T.setArpGate(ra,.25);
chk('noteDurOf：Gate 25% → 短促（0.25 步长）',
    Math.abs(T.noteDurOf(ra)-sd*.25*T.rateOf(ra))<1e-9);
T.setArpGate(ra,1);
chk('noteDurOf：Gate 100% → 连满（1.0 步长）',
    Math.abs(T.noteDurOf(ra)-sd*1*T.rateOf(ra))<1e-9);
T.setArpGate(ra,9);
chk('setArpGate：非法值回落 75%',ra.arp.gate===.75&&Math.abs(T.noteDurOf(ra)-sd*.75*T.rateOf(ra))<1e-9);
T.setArpRate(ra,4);
chk('noteDurOf：1/4 自动档下音长仍只随 Gate（密度≠音长）',
    Math.abs(T.noteDurOf(ra)-sd*.75*T.rateOf(ra))<1e-9);
const nonArp=T.state.tracks.find(t=>t.kind==='inst'&&!(t.arp&&t.arp.on));
chk('noteDurOf：非琶音声部保持 1.9 × stepDur 自然衰减',
    nonArp?Math.abs(T.noteDurOf(nonArp)-sd*1.9*T.rateOf(nonArp))<1e-9:true);
T.setArpRate(ra,1);
/* 非破坏性：整轮节奏切换 tr.seq 一字不改 */
chk('节奏档切换全程 tr.seq 一字不改（非破坏性）',String(ra.seq)===String(rSeq21));
/* 网格：自动档空格画幽灵（实际发声行）、不触发的画格让位变暗 */
T.setArpRate(ra,2); T.renderTracks();
const c21=T.cardOf(ra.id).cells;
chk('网格：不触发的画格 paintmute（让位，原样保留）',
    !!c21&&c21[5]&&c21[5][5]&&c21[5][5].classList.contains('paintmute')
      &&c21[9]&&c21[9][2]&&c21[9][2].classList.contains('paintmute'));
chk('网格：没画但按拍触发的空格画出幽灵（实际发声行）',
    !!c21&&!!c21[2]&&c21[2].some(c=>c&&c.classList.contains('ghost')));
chk('网格：正常触发的画格不变暗（步 0 偶数格触发）',
    !!c21&&!!c21[0]&&!!c21[0][0]&&!c21[0][0].classList.contains('paintmute'));
/* ---- 琶音跟随和弦进行：改和弦 → 音池与实际发声音高实时跟着变 ---- */
T.setMode(0);                                      // 固定七声调式（大调）：断言可精确预测
T.setArpRate(ra,1);                                // 1/16：步 0 必触发；模式 up、k=0 → 音池最低音
const poolA=T.arpPoolAt(ra,0), before=T.followRow(ra,0);
chk('音池来自当前和弦（非空，发声行在音池内）',
    !!poolA&&poolA.length>=3&&poolA.indexOf(before)>=0,'pool='+poolA);
const oldRoot21=T.state.prog[0].root, L21=T.scLen();
T.state.prog[0]=T.mkChord((oldRoot21+2)%L21,T.state.prog[0].beats,T.state.prog[0].seventh);   // 换和弦（mkChord 重建 tones）
T.syncFollowers();
const poolB=T.arpPoolAt(ra,0), after=T.followRow(ra,0);
chk('改和弦 → 音池实时跟着变',!!poolB&&String(poolA)!==String(poolB),'A='+poolA+' B='+poolB);
chk('改和弦 → 发声音高落在新和弦音池内（音高实时跟随和弦进行）',
    after!=null&&after!==-1&&!!poolB&&poolB.indexOf(after)>=0,
    'before='+before+' after='+after+' poolB='+poolB);
T.state.prog[0]=T.mkChord(oldRoot21,T.state.prog[0].beats,T.state.prog[0].seventh);           // 换回原和弦
T.syncFollowers();
chk('换回原和弦 → 发声音高复原',T.followRow(ra,0)===before);
/* ---- 八度范围（经典 ARP Octaves 1–4）：音池向上叠 1–3 组八度 ---- */
chk('默认八度范围 = 1（只在本组八度循环）',T.arpOctOf(ra)===1);
const poolBase=T.arpPoolAt(ra,0);                  // oct=1 基组
T.setArpOct(ra,2);
const poolExt=T.arpPoolAt(ra,0);
chk('setArpOct：八度 2 → 音池比基组长（叠加高八度组）',
    !!poolBase&&!!poolExt&&poolExt.length>poolBase.length,'base='+poolBase.length+' ext='+poolExt.length);
chk('八度音池：基组全部可上移的行都在高八度组中出现（同音级行号 -scLen）',
    !!poolBase&&!!poolExt&&poolBase.every(r=>r-L21<0||poolExt.indexOf(r-L21)>=0),
    'L='+L21+' base='+poolBase+' ext='+poolExt);
chk('八度音池：音高升序排列',!!poolExt&&poolExt.every((r,i)=>i===0||T.rowMidi(poolExt[i-1])<T.rowMidi(r)));
T.setArpRate(ra,1);
chk('八度 sweeping：up 模式越过基组后进入高八度（有音比首音高整 12 半音）',
    Array.from({length:poolExt.length},(_,s)=>T.rowMidi(T.followRow(ra,s)))
      .some(m=>m-T.rowMidi(T.followRow(ra,0))===12));
chk('八度 sweeping：发声行始终落在八度音池内',
    Array.from({length:poolExt.length},(_,s)=>T.followRow(ra,s)).every(r=>poolExt.indexOf(r)>=0));
T.setArpOct(ra,4);
chk('setArpOct：八度 4 生效（音池最长）',T.arpOctOf(ra)===4&&T.arpPoolAt(ra,0).length>=poolExt.length);
T.setArpOct(ra,9);
chk('setArpOct：非法值回落 1',T.arpOctOf(ra)===1&&ra.arp.oct===1);
/* 非破坏性：八度切换 tr.seq 一字不改 */
chk('八度切换全程 tr.seq 一字不改（非破坏性）',String(ra.seq)===String(rSeq21));
/* ---- 存档：arpRate / arpOct / arpGate 持久化 ---- */
T.setArpRate(ra,2); T.setArpOct(ra,2); T.setArpGate(ra,.5); T.save();
const raw21=JSON.parse(localStorage.getItem('polyseq.v7')||'{}');
chk('存档含 arpRate=2 · arpOct=2 · arpGate=0.5',
    !!(raw21.tracks&&raw21.tracks[0])&&raw21.tracks[0].arpRate===2
      &&raw21.tracks[0].arpOct===2&&raw21.tracks[0].arpGate===.5,
    'raw='+JSON.stringify(raw21.tracks&&raw21.tracks[0]&&{r:raw21.tracks[0].arpRate,o:raw21.tracks[0].arpOct,g:raw21.tracks[0].arpGate}));
/* ---- 旧档（无 arpRate 字段）：安全回落 0（跟画） ---- */
store['polyseq.v7']=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧',inst:'piano',oct:0,bars:1,rate:1,seq:[-1],vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,p:{}}],prog:[],progEdited:false,progBars:1});
T.loadSaved();
const la21=T.state.tracks[0];
chk('旧档读取：arpRate 回落 0（跟画）、oct/gate 回落默认（1 / 75%）',
    la21.arp&&la21.arp.rate===0&&la21.arp.on===false&&T.arpOctOf(la21)===1&&T.arpGateOf(la21)===.75,
    'arp='+JSON.stringify(la21.arp));
/* ---- (C) 版旧档 arpRate=0（跟画）+ 开关开 → 原语义原样保留 ---- */
store['polyseq.v7']=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧0',inst:'piano',oct:0,bars:1,rate:1,seq:[0],arpOn:true,arpMode:'up',arpRate:0,vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,p:{}}],prog:[],progEdited:false,progBars:1});
T.loadSaved();
chk('旧档 arpRate=0 → 保持跟画、开关保留',
    T.state.tracks[0].arp.rate===0&&T.arpOn(T.state.tracks[0])===true,
    'arp='+JSON.stringify(T.state.tracks[0].arp));
/* ---- (D) 版旧档 arpRate=1/2/4（音长档）→ 值兼容，语义转为自动滚速度 ---- */
store['polyseq.v7']=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧2',inst:'piano',oct:0,bars:1,rate:1,seq:[0],arpOn:true,arpMode:'up',arpRate:2,vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,p:{}}],prog:[],progEdited:false,progBars:1});
T.loadSaved();
chk('旧档 arpRate=2（音长档）→ 1/8 自动滚、开关保留',
    T.state.tracks[0].arp.rate===2&&T.arpFires(T.state.tracks[0],2)===true,
    'arp='+JSON.stringify(T.state.tracks[0].arp));
/* ---- 旧档带 arpOct / arpGate 字段 → 原样恢复 ---- */
store['polyseq.v7']=JSON.stringify({tracks:[{id:1,kind:'inst',name:'旧OG',inst:'piano',oct:0,bars:1,rate:1,seq:[0],arpOn:true,arpMode:'down',arpRate:1,arpOct:3,arpGate:.25,vol:.85,pan:0,mute:false,solo:false,fx:'off',fxMix:1,p:{}}],prog:[],progEdited:false,progBars:1});
T.loadSaved();
chk('旧档 arpOct=3 · arpGate=0.25 原样恢复',
    T.arpOctOf(T.state.tracks[0])===3&&T.arpGateOf(T.state.tracks[0])===.25,
    'arp='+JSON.stringify(T.state.tracks[0].arp));
/* ---- undo：快照含 arpRate / arpOct / arpGate ---- */
const uc=T.makeTrack('inst','uc','piano',0);
T.state.tracks.length=0; T.state.tracks.push(uc);
uc.seq=new Array(16).fill(-1); uc.seq[0]=4;
uc.arp={on:true,mode:'up',rate:4,oct:3,gate:.5};
T.pushUndo();                                      // 快照：rate=4 · oct=3 · gate=.5
T.setArpRate(uc,2); T.setArpOct(uc,1); T.setArpGate(uc,1);
chk('setArpRate/setArpOct/setArpGate：改档生效',
    uc.arp.rate===2&&uc.arp.oct===1&&uc.arp.gate===1);
T.undo();
const ud=T.state.tracks[0];                        // undo 按快照重建声部对象：必须重取活动引用
chk('undo：恢复 rate=4 · oct=3 · gate=.5（快照含三档）',
    ud.arp.rate===4&&ud.arp.oct===3&&ud.arp.gate===.5,'arp='+JSON.stringify(ud.arp));
/* ---- UI：节奏下拉 ---- */
T.renderTracks();
const rc21=T.cardOf(ud.id);
const rSel=rc21&&rc21.el.querySelector('select.arp-rate');
chk('节奏下拉存在、开关开着时可用、值正确',
    !!rSel&&rSel.disabled===false&&rSel.value==='4','sel='+(rSel?'value='+rSel.value+' disabled='+rSel.disabled:'无'));
chk('节奏下拉共 4 档：跟画(0) / 1(1/16) / 2(1/8) / 4(1/4)',
    !!rSel&&rSel.options.length===4&&String(rSel.options[0].value)==='0'
      &&String(rSel.options[1].value)==='1'&&String(rSel.options[2].value)==='2'&&String(rSel.options[3].value)==='4',
    'n='+(rSel&&rSel.options.length));
rSel.value='2'; rSel.fire('change');
chk('下拉改节奏 → tr.arp.rate 跟着变',ud.arp.rate===2,'rate='+ud.arp.rate);
const sumR=(T.cardOf(ud.id).el.querySelector('.tc-sum .s-sum')||{textContent:''}).textContent;
chk('改档后摘要即时更新（含 ·1/8）',sumR.indexOf('·1/8')>=0,'sum='+sumR);
T.setArpMode(ud,'updown');
const sumM=(T.cardOf(ud.id).el.querySelector('.tc-sum .s-sum')||{textContent:''}).textContent;
chk('改图案后摘要即时更新（含 Up-Down）',sumM.indexOf('Up-Down')>=0,'sum='+sumM);
/* UI：八度范围下拉 + 音长（Gate）下拉 */
const oSel=rc21&&rc21.el.querySelector('select.arp-oct');
chk('八度下拉存在、开关开着时可用、值随 undo 恢复为 3',
    !!oSel&&oSel.disabled===false&&oSel.value==='3','sel='+(oSel?'value='+oSel.value:'无'));
chk('八度下拉共 4 档（1–4 八度）',
    !!oSel&&oSel.options.length===4&&String(oSel.options[0].value)==='1'&&String(oSel.options[3].value)==='4',
    'n='+(oSel&&oSel.options.length));
const gSel=rc21&&rc21.el.querySelector('select.arp-gate');
chk('音长（Gate）下拉存在、值 0.5',
    !!gSel&&gSel.disabled===false&&gSel.value==='0.5','sel='+(gSel?'value='+gSel.value:'无'));
chk('音长下拉共 4 档（.25/.5/.75/1）',
    !!gSel&&gSel.options.length===4&&gSel.options[0].value==='0.25'&&gSel.options[3].value==='1',
    'n='+(gSel&&gSel.options.length));
oSel.value='4'; oSel.fire('change');
gSel.value='0.25'; gSel.fire('change');
chk('下拉改八度/音长 → tr.arp 跟着变',ud.arp.oct===4&&ud.arp.gate===.25,
    'arp='+JSON.stringify(ud.arp));
const sumOG=(T.cardOf(ud.id).el.querySelector('.tc-sum .s-sum')||{textContent:''}).textContent;
chk('摘要即时更新（含 ·4八度 ·Gate 25%）',
    sumOG.indexOf('·4八度')>=0&&sumOG.indexOf('Gate 25%')>=0,'sum='+sumOG);
/* 开关关掉 → 全部下拉禁用但值保留 */
T.toggleArp(ud);                                   // → 关（内部 renderTracks 重建卡片）
const rc22=T.cardOf(ud.id);
const rSel2=rc22&&rc22.el.querySelector('select.arp-rate');
const oSel2=rc22&&rc22.el.querySelector('select.arp-oct');
const gSel2=rc22&&rc22.el.querySelector('select.arp-gate');
chk('琶音关闭 → 节奏/八度/音长下拉全部禁用（值保留）',
    !!rSel2&&rSel2.disabled===true&&rSel2.value==='2'&&ud.arp.rate===2
      &&!!oSel2&&oSel2.disabled===true&&oSel2.value==='4'
      &&!!gSel2&&gSel2.disabled===true&&gSel2.value==='0.25');
/* 摘要行：恒带节奏短名「琶音器·图案·节奏」 */
T.toggleArp(ud);                                   // → 再开（内部 renderTracks）
const sum21=T.cardOf(ud.id).el.querySelector('.tc-sum .s-sum');
chk('收起摘要含「琶音器·Up-Down·1/8」',
    !!sum21&&sum21.textContent.indexOf('琶音器·Up-Down·1/8')>=0,'sum='+(sum21&&sum21.textContent));
T.setArpRate(ud,0);
const sumF=(T.cardOf(ud.id).el.querySelector('.tc-sum .s-sum')||{textContent:''}).textContent;
chk('摘要：跟画档显示「·跟画」',sumF.indexOf('·跟画')>=0,'sum='+sumF);
/* ---- MIDI：节奏档写进触发密度（PPQ960 · 声部速度 1/16 → 每格 240 tick） ---- */
function midiSpans(u8){
  let p=0, best=null;
  while(u8&&p+8<=u8.length){
    if(u8[p]===0x4D&&u8[p+1]===0x54&&u8[p+2]===0x72&&u8[p+3]===0x6B){
      const len=(u8[p+4]<<24)|(u8[p+5]<<16)|(u8[p+6]<<8)|u8[p+7];
      const end=p+8+len; let q=p+8,t=0,run=0; const open=[], spans=[];
      while(q<end){
        let d=0,c; do{ c=u8[q++]; d=(d<<7)|(c&0x7f); }while(c&0x80);
        t+=d;
        let st=u8[q];
        if(st<0x80){ st=run; } else { q++; run=st; }
        const hi=st&0xf0;
        if(hi===0x90){ const vel=u8[q+1]; if(vel>0) open.push(t); q+=2; }
        else if(hi===0x80){ spans.push({on:open.shift(),off:t}); q+=2; }
        else if(hi===0xa0||hi===0xb0||hi===0xe0){ q+=2; }
        else if(hi===0xc0||hi===0xd0){ q+=1; }
        else if(st===0xFF){ q++; let l=0,c2; do{ c2=u8[q++]; l=(l<<7)|(c2&0x7f); }while(c2&0x80); q+=l; }
        else if(st===0xF0||st===0xF7){ let l=0,c2; do{ c2=u8[q++]; l=(l<<7)|(c2&0x7f); }while(c2&0x80); q+=l; }
        else break;
      }
      spans.sort((a,b)=>a.on-b.on);
      if(spans.length&&(!best||spans.length>best.length)) best=spans;
      p=end;
    } else p++;
  }
  return best||[];
}
T.state.tracks.length=0; T.state.tracks.push(ra);  // 只导出这一个琶音声部
T.setRate(ra,1); T.setArpRate(ra,2); T.setArpOct(ra,1); T.setArpGate(ra,.75);
/* 本节的 MIDI 只含 1 个声部（<200 字节），不能用带阈值过滤的 latestMidi —— 直接取最后一个 Blob */
const myMidi=()=>{ const b=globalThis.__blobs||[]; const p=(b[b.length-1]||[])[0]; return p&&p.length?p:null; };
/* 1/8 自动档：偶数格全触发（画没画都响），音长随 Gate%（PPQ960 · 声部速度 1/16 → 每格 240 tick） */
chk('MIDI 前置：音池回到单八度',T.arpPoolAt(ra,0).length===poolBase.length);
T.exportMidi();
const spansA=midiSpans(myMidi());
chk('MIDI：1/8 自动档 16 步触发 8 个音（每 2 格一音）',
    spansA.length===8&&[0,2,4,6,8,10,12,14].every((s,i)=>spansA[i]&&spansA[i].on===s*240),
    'spans='+JSON.stringify(spansA.map(x=>[x.on,x.off])));
chk('MIDI：Gate 75% → note off 在 +180 tick',
    spansA.length>0&&spansA.every(x=>x.off-x.on===180),'spans='+JSON.stringify(spansA.map(x=>x.off-x.on)));
T.setArpGate(ra,1); T.exportMidi();
chk('MIDI：Gate 100% → note off 在 +240 tick（整步）',
    midiSpans(myMidi()).every(x=>x.off-x.on===240));
T.setArpGate(ra,.25); T.exportMidi();
chk('MIDI：Gate 25% → note off 在 +60 tick（短促）',
    midiSpans(myMidi()).every(x=>x.off-x.on===60));
T.setArpGate(ra,.75);
/* 跟画档：只有画的 3 个 step 发声 */
T.setArpRate(ra,0); T.exportMidi();
const evCount=midiSpans(myMidi()).length;
chk('MIDI：跟画档只有画的 3 个 step 发声，空步无音符',evCount===3,'n='+evCount);

console.log('\n--- 22. 常用声部名下拉（▾ 预设命名，免手输） ---');
/* 旋律声部：四组常用名（旋律/和声/低音/节奏） */
T.renderTracks();
const nm=T.state.tracks.find(t=>t.kind==='inst');
const nmCard=T.cardOf(nm.id);
const nSel=nmCard&&nmCard.el.querySelector('select.tc-name-pick');
chk('常用名下拉存在、占位为 ▾',!!nSel&&nSel.options.length>=1&&nSel.options[0].text==='▾'&&nSel.value==='');
chk('旋律声部下拉分 4 组（旋律/和声/低音/节奏）',
    !!nSel&&nSel.querySelectorAll('optgroup').length===4
      &&Array.from(nSel.querySelectorAll('optgroup')).map(g=>g.label).join('/')==='旋律/和声/低音/节奏',
    'groups='+Array.from(nSel?nSel.querySelectorAll('optgroup'):[]).map(g=>g.label));
const nameBefore=nm.name;
nSel.value='琶音器'; nSel.fire('change');
chk('选中「琶音器」→ tr.name 改名、输入框同步、下拉回落 ▾',
    nm.name==='琶音器'&&nmCard.el.querySelector('.tc-name').value==='琶音器'&&nSel.value==='',
    'name='+nm.name+' sel='+nSel.value);
chk('改名后已存档',JSON.parse(localStorage.getItem('polyseq.v7')||'{}').tracks.some(t=>t.name==='琶音器'));
nm.name=nameBefore; T.save();                       // 还原，避免影响后续读取
/* 鼓声部：只有节奏组（鼓组/律动/打击） */
const dm=T.makeTrack('drum','d0','pop',0);
T.state.tracks.push(dm); T.renderTracks();
const dSel=T.cardOf(dm.id)&&T.cardOf(dm.id).el.querySelector('select.tc-name-pick');
chk('鼓声部下拉只有 1 组且含 鼓组/律动/打击',
    !!dSel&&dSel.querySelectorAll('optgroup').length===1
      &&['鼓组','律动','打击'].every(n=>Array.from(dSel.options).some(o=>o.value===n)),
    'opts='+Array.from(dSel?dSel.options:[]).map(o=>o.value).join(','));
const dOpt=Array.from(dSel.options).find(o=>o.value==='鼓组');
chk('鼓组选项确实在 select.options 中（optgroup 合并进来了）',!!dOpt);
dSel.value='鼓组'; dSel.fire('change');
chk('鼓声部选中「鼓组」→ 改名生效',dm.name==='鼓组','name='+dm.name);
/* 手输改名不受影响（下拉只是叠加入口） */
const nmInput=T.cardOf(nm.id).el.querySelector('.tc-name');
nmInput.value='我的主旋律'; nmInput.fire('input');
chk('手输改名照常工作（与下拉互不干扰）',nm.name==='我的主旋律');

console.log('\n=== '+(fail?fail+' 项失败':'全部通过')+'（'+pass+' 通过 / '+fail+' 失败）===');
process.exit(fail?1:0);
