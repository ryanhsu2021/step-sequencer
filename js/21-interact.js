'use strict';
/* ============================================================
   step-sequencer · 21-interact
   旋钮交互（步进/拖拽/键盘） · 声部级操作
   ============================================================ */
/* ============ 旋钮交互：点击步进 / Shift·右键逆转 / 中键开关 / 拖拽旋转 ============ */
const MID_ROW=(ROWS-1)>>1;
const mod9=x=>((x%9)+9)%9;
let audioPreview=true, lastAudit=0;
function auditionNote(tr,s){
  if(!audioPreview) return;
  const now=performance.now();
  if(now-lastAudit<55) return;
  lastAudit=now;
  ensureAudio(); if(audioCtx.state!=='running') audioCtx.resume();
  const r=tr.seq[s];
  if(r!==-1) playTrackNote(tr,r,audioCtx.currentTime+.02);
}
function setStep(tr,s,r,tap){
  if(tr.kind==='inst'){                            // 手动编辑才计入「用户素材」——✨ 优化的锚点来源
    if(!Array.isArray(tr.userSeq)||tr.userSeq.length!==tr.seq.length) tr.userSeq=tr.seq.slice();
    tr.userSeq[s]=r;
  }
  tr.seq[s]=r;
  updateDial(tr,s); save();
  if(tap!==false) auditionNote(tr,s);
}
function toggleStep(tr,s){
  setStep(tr,s, tr.seq[s]===-1 ? (tr.last[s]!==-1?tr.last[s]:MID_ROW) : -1);
}
const angleOf=(e,el)=>{
  const b=el.getBoundingClientRect();
  return Math.atan2(e.clientY-(b.top+b.height/2),e.clientX-(b.left+b.width/2))*180/Math.PI;
};
function attachDialEvents(el,tr,s){
  let dragging=false,lastA=0,acc=0,startPos=0,moved=false;
  el.addEventListener('pointerdown',e=>{
    if(e.button===2) return;
    if(e.button===1){e.preventDefault();toggleStep(tr,s);return;}
    dragging=true;moved=false;lastA=angleOf(e,el);
    startPos=posOf(tr,s);acc=startPos*360/9;
    el.classList.add('drag');
    try{el.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  });
  el.addEventListener('mousedown',e=>{if(e.button===1)e.preventDefault();});
  el.addEventListener('pointermove',e=>{
    if(!dragging) return;
    const a=angleOf(e,el);
    let d=a-lastA; lastA=a;
    if(d>180)d-=360; else if(d<-180)d+=360;
    acc+=d;
    const p=mod9(Math.round(acc/(360/9)));
    if(p!==startPos) moved=true;
    const r=rowOfPos(p), k=view.cards.get(tr.id).knobs[s];
    k.ring.style.transform=`rotate(${-acc}deg)`;
    k.cap.textContent=r!==-1?noteName(rowMidi(r,tr.oct)):'—';
    k.dial.classList.toggle('on',p!==0);
  });
  const finish=e=>{
    if(!dragging) return;
    dragging=false; el.classList.remove('drag');
    let p=mod9(Math.round(acc/(360/9)));
    if(e&&e.type==='pointerup'&&!moved) p=posOf(tr,s)+(e.shiftKey?-1:1);
    setStep(tr,s,rowOfPos(p));
  };
  el.addEventListener('pointerup',finish);
  el.addEventListener('pointercancel',()=>{dragging=false;el.classList.remove('drag');updateDial(tr,s);});
  el.addEventListener('contextmenu',e=>{
    e.preventDefault();
    setStep(tr,s,rowOfPos(mod9(posOf(tr,s)-1)));
  });
  el.addEventListener('keydown',e=>{
    if(e.key==='ArrowUp'||e.key==='ArrowRight'){setStep(tr,s,rowOfPos(mod9(posOf(tr,s)+1)));e.preventDefault();}
    else if(e.key==='ArrowDown'||e.key==='ArrowLeft'){setStep(tr,s,rowOfPos(mod9(posOf(tr,s)-1)));e.preventDefault();}
    else if(e.key==='Delete'||e.key==='Backspace'){setStep(tr,s,-1,false);e.preventDefault();}
  });
}

/* ============ 声部级操作 ============ */
function clearTrack(tr){
  if(tr.kind==='drum'){ tr.p={}; tr.drum='custom'; refreshDrumCells(tr); }
  else { const n=stepsOf(tr); tr.seq=new Array(n).fill(-1); tr.last=new Array(n).fill(-1); tr.userSeq=null; for(let s=0;s<n;s++) updateDial(tr,s); }
  refreshSub(tr); save();
}
/* 随机鼓律动：从当前风格的推荐预设里挑一条骨架（按小节平铺），再做随机加花 / 删减 */
function randomizeDrum(tr){
  if(tr.kind!=='drum') return;
  const n=stepsOf(tr), nb=barsOf(tr);
  const cands=styleDrums().filter(x=>x!=='none');
  const id=cands.length?pick(cands):'pop';
  const p=patForBars(PRESET_BY_ID(id).p,nb);
  const get=l=>p[l]||'';
  const setl=(l,arr)=>{ p[l]=Array.from({length:n},(_,i)=>arr.includes(i)?'x':'.').join(''); };
  const on=l=>{const o=[];const c=get(l);for(let i=0;i<n;i++) if(c[i]==='x') o.push(i); return o;};
  const add=l=>{ const a=on(l); const s=(Math.random()*n)|0; if(a.indexOf(s)<0) a.push(s); setl(l,a); };
  const drop=l=>{ const a=on(l); if(a.length<=1) return; const rm=pick(a); setl(l,a.filter(x=>x!==rm)); };
  if(Math.random()<.75) add('hat');
  if(Math.random()<.45) drop('hat');
  if(Math.random()<.6) add('kick');
  if(Math.random()<.5) add('snare');
  if(Math.random()<.45) add('ohat');
  if(Math.random()<.4) setl('tom',[pick([n-3,n-2,n-1])]);
  let hits=0; DRUM_LANES.forEach(l=>hits+=on(l.id).length);
  if(hits<5) setl('kick',[0,8].concat(Math.random()<.5?[11]:[]));      // 兜底：别生成空节奏
  tr.p=p; tr.drum=id;
  refreshDrumCells(tr); refreshSub(tr); save();
  toast('🎲 已按「'+STYLE().name+'」生成律动（骨架：'+PRESET_BY_ID(id).name+'），可继续点击网格修改');
}
