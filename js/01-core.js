'use strict';
/* ============================================================
   step-sequencer · 01-core
   基础常量与工具（步长 / 小节伸缩 / 平铺 / 通用函数）
   ============================================================ */
/* ============ 基础常量：每小节 16 步 / 每声部 1–4 小节 / 8 个音阶行 + 「关」 ============ */
const BAR=16, MAX_BARS=8, ROWS=8, MAX_TRACKS=6;
/* 步进网格视觉分组：每 4 步一组（第 5/9/13 步前留间隔），一眼看清拍点 */
const STEP_GAP=k=>k>0&&k%4===0;
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const pick=a=>a[(Math.random()*a.length)|0];
/* ---- 小节 / 长度 ---- */
const barsOf=tr=>clamp(tr.bars|0,1,MAX_BARS);
const stepsOf=tr=>barsOf(tr)*BAR;
const songBars=()=>state.tracks.reduce((m,t)=>Math.max(m,barsOf(t)),1);
const songSteps=()=>songBars()*BAR;
const songBeats=()=>songBars()*4;                       // 1 拍 = 4 步
/* 和弦进行轨拥有独立长度（不随声部小节数变化）：state.progBars 小节 */
const progBars=()=>clamp(state.progBars|0||1,1,MAX_BARS);
const progSteps=()=>progBars()*BAR;
const progBeats=()=>progBars()*4;
/* 变长时把原有内容平铺重复（2 小节默认＝第 1 小节的复制），变短时保留前面 */
function tileArr(a,n){
  const src=(Array.isArray(a)&&a.length)?a:[-1];
  const out=new Array(n);
  for(let i=0;i<n;i++) out[i]=src[i%src.length];
  return out;
}
function tileStr(s,n){
  s=String(s||'.');
  if(!s.length) s='.';
  let out='';
  for(let i=0;i<n;i++) out+=s[i%s.length];
  return out;
}

