'use strict';
/* ============================================================
   step-sequencer · 31-transport
   步进音序器调度（lookahead）与播放控制
   ============================================================ */
/* ============ 步进音序器（lookahead 调度） ============ */
const stepDur=()=>60/bpm/4;
let isPlaying=false,currentStep=0,nextNoteTime=0,timerId=null;
const scheduled=[];
function scheduleStep(g,time){
  let t=time;
  if(g%2===1) t+=(swingPct/100)*stepDur()*.5;
  const solo=soloActive();
  for(const tr of state.tracks){
    if(tr.mute) continue;
    if(solo&&!tr.solo) continue;
    const s=g%stepsOf(tr);                 // 各声部按自己的小节数循环
    if(tr.kind==='inst'){ const r=tr.seq[s]; if(r!==undefined&&r!==-1) playTrackNote(tr,r,t,velOf(tr,s)); }
    else { for(const id of drumHits(tr,s)) playDrumHit(tr,id,t); }
  }
  if(g%4===0){                                    // 和弦进行轨：每拍触发一次当前和弦
    const seg=state.prog[segOfStep(g)];
    if(seg) playChordSeg(seg,t);
  }
  scheduled.push({step:g,time:t});
}
function schedulerTick(){
  if(!audioCtx) return;
  while(nextNoteTime<audioCtx.currentTime+.12){
    scheduleStep(currentStep,nextNoteTime);
    nextNoteTime+=stepDur();
    currentStep=(currentStep+1)%Math.max(songSteps(),progSteps());  // 循环长度取声部与和弦轨的较长者
  }
}
const playBtn=$('playBtn');
function start(){
  ensureAudio();
  if(audioCtx.state!=='running') audioCtx.resume();
  isPlaying=true; currentStep=0; scheduled.length=0;
  nextNoteTime=audioCtx.currentTime+.08;
  timerId=setInterval(schedulerTick,25);
  playBtn.textContent='⏸ 停止'; playBtn.classList.add('playing');
}
function stop(){
  isPlaying=false; clearInterval(timerId); scheduled.length=0;
  paintHead(-1);
  playBtn.textContent='▶ 播放'; playBtn.classList.remove('playing');
}
const togglePlay=()=>isPlaying?stop():start();
playBtn.addEventListener('click',()=>{togglePlay();playBtn.blur();});
function draw(){
  if(isPlaying&&audioCtx){
    const now=audioCtx.currentTime;
    while(scheduled.length&&scheduled[0].time<now-.5) scheduled.shift();
    let head=-1;
    for(const s of scheduled){ if(s.time<=now) head=s.step; else break; }
    paintHead(head);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

