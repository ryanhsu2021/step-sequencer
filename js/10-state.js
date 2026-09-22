'use strict';
/* ============================================================
   step-sequencer · 10-state
   数据模型 · 声部增删排序 · 持久化（polyseq.v7）
   ============================================================ */
/* ============ 数据模型 ============ */
let tid=0;
/* 音色 id 校验：旧存档可能持有已删除 / 改名的音色（如 chip），失效 id 统一回落钢琴 */
const instValid=id=>typeof id==='string'&&INSTRUMENTS.some(x=>x.id===id);
const instOr=id=>instValid(id)?id:'piano';
function makeTrack(kind,name,inst,oct){
  const t={
    id:++tid, kind:kind||'inst', name:name||('声部 '+tid),
    inst:inst||'piano', oct:oct||0, bars:1, rate:1, open:true,
    seq:[], last:[], userSeq:null, vel:null, follow:false,
    arp:{on:false,mode:'up',rate:0,oct:1,gate:.75},    // 琶音模式（非破坏性；rate＝节奏档 0 跟画 / 1·2·4 每格·每2格·每4格；oct＝八度范围 1–4；gate＝音长 .25–1。见 41-chords）
    vol:.85, pan:0, mute:false, solo:false, fx:'off', fxMix:1,
    color:TRACK_COLORS[0], p:{},
  };
  if(t.kind==='drum') t.p=patForBars(PRESET_BY_ID('pop').p,1);
  else resetSeq(t);
  return t;
}
function resetSeq(t,n){
  n=n||stepsOf(t);
  t.seq=new Array(n).fill(-1);
  t.last=new Array(n).fill(-1);
  t.userSeq=null;
  t.vel=null;
}
/* 每步力度：取该步的手动力度；未手动调过（null）→ 由播放层用默认人性化力度 */
const velOf=(tr,s)=>(tr&&Array.isArray(tr.vel)&&tr.vel[s]!=null)?tr.vel[s]:null;
const fitVelArr=(a,n)=>Array.from({length:n},(_,i)=>{const v=a?a[i]:null;return (typeof v==='number'&&v>=.2&&v<=1)?v:null;});
/* 预设（16 步）→ 按小节平铺成 n 步 */
function patForBars(p,bars){
  const n=clamp(bars,1,MAX_BARS)*BAR, o={};
  for(const l of DRUM_LANES){ const s=p&&p[l.id]; if(s) o[l.id]=tileStr(s,n); }
  return o;
}
/* 只改长度（不渲染），用于编配等内部流程 */
function resizeTrack(tr,n){
  n=clamp(n|0,1,MAX_BARS*BAR);
  if(tr.kind==='drum'){
    const o={};
    for(const l of DRUM_LANES){
      const s=tr.p[l.id]; if(!s) continue;
      const str=tileStr(s,n);
      if(str.indexOf('x')>=0) o[l.id]=str;
    }
    tr.p=o;
  }else{
    tr.seq=tileArr(tr.seq,n);
    tr.last=tileArr(tr.last,n);
    if(Array.isArray(tr.userSeq)&&tr.userSeq.length) tr.userSeq=tileArr(tr.userSeq,n);
    if(Array.isArray(tr.vel)) tr.vel=fitVelArr(tileArr(tr.vel.map(v=>v==null?0:v),n).map(v=>v===0?null:v),n);
  }
  return tr;
}
/* 用户改小节数：内容平铺重复（变长）/ 保留前段（变短），和弦轨同步伸缩 */
function setBars(tr,n){
  n=clamp(n|0,1,MAX_BARS);
  if(n===barsOf(tr)) return;
  pushUndo();
  const grow=n>barsOf(tr);
  tr.bars=n;
  resizeTrack(tr,stepsOf(tr));
  fitProg();
  renderTracks(); save();
  toast('「'+tr.name+'」→ '+n+' 小节（'+stepsOf(tr)+' 步）'+(grow&&n>1?'，第 1 小节已平铺到后面各小节':''));
}
const state={tracks:[],prog:[],progEdited:false,progBars:1};
const soloActive=()=>state.tracks.some(t=>t.solo);
let openTrackId=null;                 // 手风琴式展开：同时只留一个声部的音序面板展开（null＝全部收起）
/* 每声部速度（每步时值）：1/16 默认 · 1/8 慢一倍 · 1/4 慢三倍。
   只改本声部的播放速率与发音长度，音序内容与小节数都不变；全曲循环长度会取所有声部中最长的那个 */
function setRate(tr,v){
  v=RATE_VALUES.indexOf(v|0)>=0?(v|0):1;
  if(v===rateOf(tr)) return;
  pushUndo();
  tr.rate=v;
  renderTracks(); save();
  toast('「'+tr.name+'」速度 → '+rateName(v)+
    (v===1?'（每步 1/16，与其它声部同速）':v===2?'（每步 1/8，本声部慢一倍：16 步走 2 小节）':'（每步 1/4，本声部慢三倍：16 步走 4 小节）'));
}

/* 声部展开 / 收起（步进音序器面板）：只影响显示，不影响播放 */
function toggleOpen(tr){
  tr.open=!tr.open;
  if(tr.open) openTrackId=tr.id; else if(openTrackId===tr.id) openTrackId=null;
  renderTracks(); save();
}
/* 「跟随和弦进行」开关（非破坏性）：音序里 step 的位置永不改动，
   只在播放 / 试听 / 导出时把音高折算到当前和弦内（见 41-chords 的 followRow）。
   关闭后音高立刻恢复为原样——因为 tr.seq 从头到尾没被改过。
   开 / 关只需重画面板（在网格上标出「跟随后的实际音高」） */
const isFollowing=tr=>tr.kind==='inst'&&!!tr.follow;
function applyFollow(tr,quiet){
  if(!tr||tr.kind!=='inst') return false;
  const card=view.cards.get(tr.id);
  if(card&&card.kind==='inst'){ refreshAllSteps(tr); refreshSummary(tr); }
  return isFollowing(tr);
}
function toggleFollow(tr){
  tr.follow=!tr.follow;
  applyFollow(tr,true);
  renderTracks(); save();
  toast(tr.follow
    ?('🔗 「'+tr.name+'」跟随和弦进行：已开启（音序位置不变，播放音高随和弦实时跟随）')
    :('🔓 「'+tr.name+'」跟随和弦进行：已关闭（播放音高已恢复为原样）'));
}

/* ---- 声部增删 ---- */
function addTrack(kind,opts){
  if(state.tracks.length>=MAX_TRACKS){toast('最多 '+MAX_TRACKS+' 个声部');return null;}
  pushUndo();
  const t=makeTrack(kind);
  if(opts) Object.assign(t,opts);
  if(kind==='drum'&&state.tracks.some(x=>x.kind==='drum')){toast('已经有一个鼓声部了');return null;}
  state.tracks.push(t);
  recolor(); save(); renderTracks();
  return t;
}
function removeTrack(id){
  if(state.tracks.length<=1){toast('至少保留一个声部');return;}
  const i=state.tracks.findIndex(t=>t.id===id);
  if(i<0) return;
  pushUndo();
  state.tracks.splice(i,1);
  busCache.delete(id);
  recolor(); save(); renderTracks();
}
function recolor(){ state.tracks.forEach((t,i)=>t.color=TRACK_COLORS[i%TRACK_COLORS.length]); }
/* ---- 声部排序：↑ / ↓ 与相邻声部交换（配色随位置走） ---- */
function moveTrack(id,dir){
  const i=state.tracks.findIndex(t=>t.id===id), j=i+dir;
  if(i<0) return;
  if(j<0||j>=state.tracks.length){ toast(dir<0?'已经是第一个声部':'已经是最后一个声部'); return; }
  pushUndo();
  const [t]=state.tracks.splice(i,1);
  state.tracks.splice(j,0,t);
  recolor(); save(); renderTracks();
  toast('「'+t.name+'」已移到第 '+(j+1)+' 位');
}

/* ---- 持久化 ---- */
const LS_KEY='polyseq.v7';
let saveTimer=null;
function save(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
    try{
      localStorage.setItem(LS_KEY,JSON.stringify({
        rootIdx,modeIdx,styleIdx,bpm,swingPct,volume,reverb:revPreset,revMix:revMix==null?1:revMix,
        chordInst:chordInst||null,chordMute:!!chordMute,
        prog:(state.prog||[]).map(c=>({r:c.root,s:c.seventh?1:0,b:clamp(c.beats|0,1,64)})),
        progBars:progBars(),
        progEdited:!!state.progEdited,
        chordVol:chordVol,
        chordFx:chordFx||'off',chordFxMix:chordFxMix==null?1:chordFxMix,
        openTrackId:openTrackId==null?null:openTrackId,
        tracks:state.tracks.map(t=>({kind:t.kind,name:t.name,inst:t.inst,oct:t.oct,bars:barsOf(t),rate:rateOf(t),seq:t.seq,
          open:t.open!==false,follow:!!t.follow,
          arpOn:arpOn(t),arpMode:(t.arp&&t.arp.mode)||'up',arpRate:(t.arp&&t.arp.rate)|0,arpOct:arpOctOf(t),arpGate:arpGateOf(t),
          useq:(t.kind==='inst'&&Array.isArray(t.userSeq))?t.userSeq:null,
          vel:(t.kind==='inst'&&Array.isArray(t.vel))?t.vel:null,
          vol:t.vol,pan:t.pan,mute:t.mute,solo:t.solo,fx:t.fx||'off',fxMix:t.fxMix==null?1:t.fxMix,drum:t.drum,p:t.p}))
      }));
    }catch(e){}
  },320);
}
/* 旧档（v6 及更早）：两个和弦、各占 8 步 → 迁移成「2 拍 + 2 拍」的段 */
function migrateProg(raw){
  const arr=Array.isArray(raw)?raw:[];
  const out=[];
  for(const c of arr){
    if(c==null) continue;
    if(typeof c==='number'||typeof c==='string') out.push({root:+c||0,seventh:false,beats:2});
    else out.push({root:c.r|0,seventh:!!c.s,beats:clamp(c.b|0,1,64)});
  }
  return out;
}
function loadSaved(){
  try{
    const raw=localStorage.getItem(LS_KEY); if(!raw) return false;
    const d=JSON.parse(raw); if(!d||!Array.isArray(d.tracks)||!d.tracks.length) return false;
    rootIdx=d.rootIdx|0; modeIdx=d.modeIdx|0; setStyle(d.styleIdx|0,true);
    bpm=d.bpm||112; swingPct=d.swingPct||0; volume=d.volume==null?80:d.volume;
    revPreset=REV_IDS.has(d.reverb)?d.reverb:'off';
    revMix=(typeof d.revMix==='number'&&d.revMix>=0&&d.revMix<=1)?d.revMix:1;
    chordInst=(typeof d.chordInst==='string'&&INSTRUMENTS.some(x=>x.id===d.chordInst))?d.chordInst:'';
    chordMute=!!d.chordMute;
    state.progEdited=!!d.progEdited;
    state.prog=migrateProg(d.prog);
    const pb=d.progBars|0;
    const psum=state.prog.reduce((a,c)=>a+(c.beats|0),0);
    state.progBars=pb||clamp(Math.round(psum/4)||1,1,MAX_BARS);   // 旧档：按原进行的总拍数反推小节数
    chordVol=(typeof d.chordVol==='number'&&d.chordVol>=0&&d.chordVol<=1)?d.chordVol:.8;
    chordFx=DELAY_IDS.has(d.chordFx)?d.chordFx:'off';
    chordFxMix=(typeof d.chordFxMix==='number'&&d.chordFxMix>=0&&d.chordFxMix<=1)?d.chordFxMix:1;
    openTrackId=(typeof d.openTrackId==='number')?d.openTrackId:null;
    state.tracks=d.tracks.slice(0,MAX_TRACKS).map(o=>{
      const t=makeTrack(o.kind,o.name,instOr(o.inst),o.oct);
      const bars=clamp(o.bars|0,1,MAX_BARS);
      t.bars=bars;
      Object.assign(t,{seq:fitArr(o.seq,bars*BAR),last:new Array(bars*BAR).fill(-1),
        userSeq:Array.isArray(o.useq)?fitArr(o.useq,bars*BAR):null,
        vel:Array.isArray(o.vel)?fitVelArr(o.vel,bars*BAR):null,
        rate:(RATE_VALUES.indexOf(o.rate|0)>=0?o.rate|0:1),
        open:o.open!==false,
        follow:(o.kind==='inst')&&!!o.follow,
        arp:{on:(o.kind==='inst')&&!!o.arpOn,mode:ARP_MODE_IDS.indexOf(o.arpMode)>=0?o.arpMode:'up',
             rate:ARP_RATES.indexOf(o.arpRate|0)>=0?(o.arpRate|0):0,
             oct:ARP_OCTS.indexOf(o.arpOct|0)>=0?(o.arpOct|0):1,
             gate:ARP_GATES.indexOf(o.arpGate)>=0?o.arpGate:.75},
        vol:o.vol==null?.85:o.vol,
        pan:o.pan||0,mute:!!o.mute,solo:!!o.solo,fx:DELAY_IDS.has(o.fx)?o.fx:'off',
        fxMix:(typeof o.fxMix==='number'&&o.fxMix>=0&&o.fxMix<=1)?o.fxMix:1,drum:o.drum||'pop',
        p:(o.kind==='drum'&&o.p)?patForBars(o.p,bars):t.p});
      return t;
    });
    recolor();
    if(!state.prog.length) state.prog=randomProgression();
    fitProg();
    /* 手风琴一致性：读档后只允许一个声部展开；若都收起则展开第一个，避免整屏空壳 */
    if(openTrackId!=null&&!state.tracks.some(t=>t.id===openTrackId)) openTrackId=null;
    if(openTrackId==null&&state.tracks.length){
      const opened=state.tracks.filter(t=>t.open!==false);
      if(!opened.length){ state.tracks[0].open=true; openTrackId=state.tracks[0].id; }
      else{ const keep=opened.find(t=>t.id===openTrackId)||opened[0]; openTrackId=keep.id;
        state.tracks.forEach(t=>{ t.open=(t.id===keep.id); }); }
    }
    return true;
  }catch(e){ return false; }
}
const fitArr=(a,n)=>Array.from({length:n},(_,i)=>(a&&a[i]!==undefined)?clamp(a[i]|0,-1,ROWS-1):-1);

/* ---- 撤销（Undo）：破坏性操作前 pushUndo() 存快照，Ctrl+Z / ↶ 撤销按钮回退 ---- */
const undoStack=[]; const UNDO_MAX=60;
function snapState(){
  return JSON.stringify({
    tracks:state.tracks.map(t=>({id:t.id,kind:t.kind,name:t.name,inst:t.inst,oct:t.oct,bars:barsOf(t),rate:rateOf(t),
      open:t.open!==false,follow:!!t.follow,
      arpOn:arpOn(t),arpMode:(t.arp&&t.arp.mode)||'up',arpRate:(t.arp&&t.arp.rate)|0,arpOct:arpOctOf(t),arpGate:arpGateOf(t),
      seq:t.seq,useq:(t.kind==='inst'&&Array.isArray(t.userSeq))?t.userSeq:null,
      vel:(t.kind==='inst'&&Array.isArray(t.vel))?t.vel:null,
      vol:t.vol,pan:t.pan,mute:t.mute,solo:t.solo,fx:t.fx,fxMix:t.fxMix,drum:t.drum,p:t.p})),
    prog:(state.prog||[]).map(c=>({r:c.root,s:c.seventh?1:0,b:c.beats})),
    progBars:progBars(),progEdited:!!state.progEdited,rootIdx,modeIdx});
}
function pushUndo(){
  try{ undoStack.push(snapState()); if(undoStack.length>UNDO_MAX) undoStack.shift(); }catch(e){}
}
function undo(){
  const raw=undoStack.pop();
  if(!raw){ toast('没有可撤销的操作了'); return; }
  try{
    const d=JSON.parse(raw);
    busCache.clear();
    rootIdx=d.rootIdx|0; modeIdx=d.modeIdx|0;
    state.progEdited=!!d.progEdited; state.progBars=clamp(d.progBars|0,1,MAX_BARS);
    state.prog=migrateProg(d.prog);
    if(!state.prog.length) state.prog=randomProgression();
    fitProg();
    state.tracks=(d.tracks||[]).map(o=>{
      const t=makeTrack(o.kind,o.name,o.inst,o.oct);
      t.id=o.id;
      const bars=clamp(o.bars|0,1,MAX_BARS);
      t.bars=bars;
      Object.assign(t,{seq:fitArr(o.seq,bars*BAR),last:new Array(bars*BAR).fill(-1),
        userSeq:Array.isArray(o.useq)?fitArr(o.useq,bars*BAR):null,
        vel:Array.isArray(o.vel)?fitVelArr(o.vel,bars*BAR):null,
        rate:(RATE_VALUES.indexOf(o.rate|0)>=0?o.rate|0:1),
        open:o.open!==false,follow:(o.kind==='inst')&&!!o.follow,
        arp:{on:(o.kind==='inst')&&!!o.arpOn,mode:ARP_MODE_IDS.indexOf(o.arpMode)>=0?o.arpMode:'up',
             rate:ARP_RATES.indexOf(o.arpRate|0)>=0?(o.arpRate|0):0,
             oct:ARP_OCTS.indexOf(o.arpOct|0)>=0?(o.arpOct|0):1,
             gate:ARP_GATES.indexOf(o.arpGate)>=0?o.arpGate:.75},
        vol:o.vol==null?.85:o.vol,pan:o.pan||0,mute:!!o.mute,solo:!!o.solo,
        fx:DELAY_IDS.has(o.fx)?o.fx:'off',fxMix:o.fxMix==null?1:o.fxMix,drum:o.drum||'pop',
        p:(o.kind==='drum'&&o.p)?patForBars(o.p,bars):t.p});
      return t;
    });
    if(state.tracks.length) tid=Math.max(tid,...state.tracks.map(t=>t.id));
    chordEdit=null;
    recolor(); renderTracks(); save();
    toast('↶ 已撤销上一步');
  }catch(e){ toast('撤销失败（快照损坏）'); }
}

/* ---- 提示气泡 ---- */
const toastEl=$('toast'); let toastTimer=null;
function toast(msg){
  toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);
}
