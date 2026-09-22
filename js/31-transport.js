'use strict';
/* ============================================================
   step-sequencer · 31-transport
   步进音序器调度（lookahead）与播放控制
   ============================================================ */
/* ============ 步进音序器（lookahead 调度） ============ */
const stepDur=()=>60/bpm/4;
/* 全曲循环长度：声部按「自身长度 × 速度倍率」算（1/4 速度的 1 小节声部要 64 个基准步才走完），
   与和弦轨长度取较长者 */
const loopSteps=()=>{
  let m=BAR;
  for(const t of state.tracks) m=Math.max(m,spanOf(t));
  return Math.max(m,progSteps());
};
let isPlaying=false,currentStep=0,nextNoteTime=0,timerId=null;
const scheduled=[];
function scheduleStep(g,time){
  let t=time;
  if(g%2===1) t+=(swingPct/100)*stepDur()*.5;
  if(g%BAR===0&&typeof infBarTick==='function') infBarTick();   // ♾ 无限演化：小节起点检查窗口（lookahead 内提前变异，变化落在小节交界）
  const solo=soloActive();
  for(const tr of state.tracks){
    /* 哑音闸每步同步一次：播放途中点 M / S 立刻见效，延时的残留回声也一起断掉 */
    muteLatch(tr);
    if(tr.mute) continue;
    if(solo&&!tr.solo) continue;
    const rt=rateOf(tr);
    if(g%rt!==0) continue;                 // 速度慢的声部：每 rt 个基准步才走一格（1/8 → 每 2 步）
    const s=Math.floor(g/rt)%stepsOf(tr);  // 各声部按自己的小节数 × 自己的速度循环
    if(tr.kind==='inst'){
      const r=followRow(tr,s);                   // 跟随和弦：音序位置不变，仅播放音高折算到和弦内
      if(r!==undefined&&r!==-1) playTrackNote(tr,r,t,velOf(tr,s));
    }
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
    currentStep=(currentStep+1)%loopSteps();    // 循环长度取声部（含速度）与和弦轨的较长者
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
/* ⚙ 更多设置面板（手机端）：展开 / 收起顶栏其余控件组 */
const transportBar=$('transport'), moreBtn=$('moreBtn');
if(transportBar&&moreBtn){
  moreBtn.addEventListener('click',()=>{
    const open=transportBar.classList.toggle('open');
    moreBtn.textContent=open?'✕':'⚙';
    moreBtn.setAttribute('aria-expanded',String(open));
    moreBtn.title=open?'收起设置面板':'更多设置（风格 / 混音 / 调性 / 导出 / 操作）';
  });
}
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

