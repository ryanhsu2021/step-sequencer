'use strict';
/* ============================================================
   step-sequencer · 10-state
   数据模型 · 声部增删排序 · 持久化（polyseq.v7）
   ============================================================ */
/* ============ 数据模型 ============ */
let tid=0;
function makeTrack(kind,name,inst,oct){
  const t={
    id:++tid, kind:kind||'inst', name:name||('声部 '+tid),
    inst:inst||'piano', oct:oct||0, bars:1,
    seq:[], last:[], userSeq:null,
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
}
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
  }
  return tr;
}
/* 用户改小节数：内容平铺重复（变长）/ 保留前段（变短），和弦轨同步伸缩 */
function setBars(tr,n){
  n=clamp(n|0,1,MAX_BARS);
  if(n===barsOf(tr)) return;
  const grow=n>barsOf(tr);
  tr.bars=n;
  resizeTrack(tr,stepsOf(tr));
  fitProg();
  renderTracks(); save();
  toast('「'+tr.name+'」→ '+n+' 小节（'+stepsOf(tr)+' 步）'+(grow&&n>1?'，第 1 小节已平铺到后面各小节':''));
}
const state={tracks:[],prog:[],progEdited:false,progBars:1};
const soloActive=()=>state.tracks.some(t=>t.solo);

/* ---- 声部增删 ---- */
function addTrack(kind,opts){
  if(state.tracks.length>=MAX_TRACKS){toast('最多 '+MAX_TRACKS+' 个声部');return null;}
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
        tracks:state.tracks.map(t=>({kind:t.kind,name:t.name,inst:t.inst,oct:t.oct,bars:barsOf(t),seq:t.seq,
          useq:(t.kind==='inst'&&Array.isArray(t.userSeq))?t.userSeq:null,
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
    state.tracks=d.tracks.slice(0,MAX_TRACKS).map(o=>{
      const t=makeTrack(o.kind,o.name,o.inst,o.oct);
      const bars=clamp(o.bars|0,1,MAX_BARS);
      t.bars=bars;
      Object.assign(t,{seq:fitArr(o.seq,bars*BAR),last:new Array(bars*BAR).fill(-1),
        userSeq:Array.isArray(o.useq)?fitArr(o.useq,bars*BAR):null,
        vol:o.vol==null?.85:o.vol,
        pan:o.pan||0,mute:!!o.mute,solo:!!o.solo,fx:DELAY_IDS.has(o.fx)?o.fx:'off',
        fxMix:(typeof o.fxMix==='number'&&o.fxMix>=0&&o.fxMix<=1)?o.fxMix:1,drum:o.drum||'pop',
        p:(o.kind==='drum'&&o.p)?patForBars(o.p,bars):t.p});
      return t;
    });
    recolor();
    if(!state.prog.length) state.prog=randomProgression();
    fitProg();
    return true;
  }catch(e){ return false; }
}
const fitArr=(a,n)=>Array.from({length:n},(_,i)=>(a&&a[i]!==undefined)?clamp(a[i]|0,-1,ROWS-1):-1);

/* ---- 提示气泡 ---- */
const toastEl=$('toast'); let toastTimer=null;
function toast(msg){
  toastEl.textContent=msg; toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);
}
