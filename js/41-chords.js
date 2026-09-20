'use strict';
/* ============================================================
   step-sequencer · 41-chords
   🎹 和弦进行轨模型（随机 / 循环铺满 / 跟随）
   ============================================================ */
/* ============================================================
   🎹 和弦进行轨：全曲和声的单一来源（2 小节 × 每 8 步一个和弦）
   ============================================================ */
const ROMAN=['I','II','III','IV','V','VI','VII','VIII'];
const PLAN_LIB=()=>SP_.prog||PROG_PLANS[modeIdx]||PROG_PLANS[0];
/* 按当前风格取一条进行，铺满和弦轨自己的拍数（可反向 / 对调开头 / 合并出长和弦）→ 每次不同 */
function randomProgression(){
  const total=progBeats(), L=scLen();
  let plan=pick(PLAN_LIB()).slice().map(d=>(((d|0)%L)+L)%L);
  if(Math.random()<.4) plan=plan.slice().reverse();
  if(plan.length>=2&&Math.random()<.28){ const t=plan[0]; plan[0]=plan[1]; plan[1]=t; }
  if(plan.length>total) plan=plan.slice(0,total);
  const segs=[]; let left=total;
  plan.forEach((d,i)=>{
    const remain=plan.length-i;
    const b=Math.max(1,Math.round(left/remain));
    segs.push({root:d,seventh:!!SP_.seventh,beats:b});
    left-=b;
  });
  while(left>0){ segs[segs.length-1].beats++; left--; }
  const out=[];
  for(const c of segs){ const p=out[out.length-1]; if(p&&p.root===c.root) p.beats+=c.beats; else out.push(c); }
  if(out.length>1&&Math.random()<.3){ const a=out[out.length-2],b=out[out.length-1]; a.beats+=b.beats; out.pop(); }
  return out.map(c=>mkChord(c.root,c.beats,c.seventh));
}
/* 和弦轨长度对齐到自己的拍数（state.progBars，独立于声部小节数）：变长时把原进行【整段循环铺满】，变短时从尾部削 */
function fitProg(){
  const total=progBeats();
  let p=(Array.isArray(state.prog)?state.prog:[])
    .filter(c=>c&&c.root!=null)
    .map(c=>({root:((((c.root|0)%scLen())+scLen())%scLen()),seventh:!!c.seventh,beats:clamp(c.beats|0,1,64)}));
  if(!p.length) p=[{root:0,seventh:!!SP_.seventh,beats:total}];
  let sum=p.reduce((a,c)=>a+c.beats,0);
  if(sum<total){                                       // 循环铺满（每个原段至少 1 拍 → 必然终止）
    const base=p.map(c=>({root:c.root,seventh:c.seventh,beats:c.beats}));
    const out=[]; let acc=0;
    while(acc<total){
      for(const c of base){
        const room=total-acc; if(room<=0) break;
        const b=Math.min(c.beats,room);
        out.push({root:c.root,seventh:c.seventh,beats:b});
        acc+=b;
      }
    }
    p=out; sum=acc;
  }
  while(sum>total){
    const last=p[p.length-1];
    if(last.beats>sum-total){ last.beats-=sum-total; sum=total; }
    else if(last.beats>1){ last.beats--; sum--; }
    else{ p.pop(); sum--; if(!p.length){ p=[{root:0,seventh:!!SP_.seventh,beats:total}]; sum=total; } }
  }
  p.forEach(c=>c.tones=chordTones(c.root,c.seventh));
  state.prog=p;
  return p;
}
function chordLabel(ch){
  const L=scLen(), iv=ivOf(), step3=L>=7?2:1, step5=L>=7?4:3;
  const pc=((rootIdx+iv[ch.root])%12+12)%12;
  const th=((iv[(ch.root+step3)%L]-iv[ch.root])%12+12)%12;
  const fi=((iv[(ch.root+step5)%L]-iv[ch.root])%12+12)%12;
  let q;
  if(th===3) q = fi===6?(ch.tones.length>3?'ø':'°'):'m';   // 三和弦用 °，七和弦才是 ø；五声的 ♭6 仍记作小和弦
  else if(th===4) q = fi===6?'°':(fi===8?'aug':'');
  else if(th===5) q='sus4';                       // 五声调式：三音位置是四度
  else if(th===2) q='sus2';
  else q='5';
  if(ch.tones.length>3&&q!=='°'&&q!=='ø') q+='7';
  return {name:ROOT_NAMES[pc]+q,deg:ROMAN[ch.root]||'',tones:ch.tones.map(d=>ROOT_NAMES[((rootIdx+iv[d])%12+12)%12])};
}
/* 所有声部（除鼓）统一用和弦进行轨做和声（✨/🎼/编配）。「对齐和弦」按钮是手动一次性触发 */
function progFor(){
  return state.prog;
}
const ensureProg=()=>{ fitProg(); return state.prog; };
/* 🎲 随机同风格：只换和弦内容，小节数保持当前值不动 */
function randomSameStyle(){
  setProg(randomProgression(),false);                // randomProgression 按当前 progBeats 铺满
  return progBars();
}
/* 改和弦轨自己的小节数（1–8），与声部小节数无关 */
function setProgBars(n){
  n=clamp(n|0,1,MAX_BARS);
  if(n===progBars()) return;
  state.progBars=n; chordEdit=null;
  fitProg(); renderChord(); save();
  toast('和弦进行轨 → '+n+' 小节（'+progBeats()+' 拍，与声部小节数无关）');
}
function setProg(p,edited){
  state.prog=p; state.progEdited=!!edited; chordEdit=null;
  fitProg(); renderChord(); save();
}
/* 「⟳ 对齐和弦」触发：把该声部现有音符一次性吸附到最近的和弦音（鼓除外；手动素材 userSeq 同步挪，
   ✨ 不会把旧音变回来）。没有持久跟随状态——和弦轨之后再变，需要再点一次才重新对齐 */
function reharmonizeTrack(tr){
  if(!tr||tr.kind!=='inst') return false;
  const n=stepsOf(tr);
  if(!tr.seq.some(v=>v>=0)) return false;
  const ca=chordAtFor(state.prog,n);
  let changed=false;
  for(let s=0;s<n;s++){
    const r=tr.seq[s]; if(r<0||!ca[s]||!ca[s].size) continue;
    if(ca[s].has(degOfRow(r))) continue;
    let best=r;
    for(let d=1;d<ROWS;d++){
      const lo=r-d, hi=r+d;
      if(lo>=0&&ca[s].has(degOfRow(lo))){ best=lo; break; }
      if(hi<ROWS&&ca[s].has(degOfRow(hi))){ best=hi; break; }
    }
    tr.seq[s]=best;
    if(tr.last) tr.last[s]=best;
    if(Array.isArray(tr.userSeq)&&tr.userSeq[s]>=0) tr.userSeq[s]=best;   // 手动素材也一起挪，✨ 不会把旧音变回来
    changed=true;
  }
  if(changed){
    const card=view.cards.get(tr.id);
    if(card&&card.kind==='inst') for(let s=0;s<n;s++) updateDial(tr,s);
  }
  return changed;
}
/* ---- 和弦进行轨发声：播放时每拍触发当前和弦，音色 / 音量可选（默认跟风格） ---- */
let chordInst='', chordMute=false, chordVol=.8;
const chordInstOf=()=>chordInst||(SP_.chordI&&SP_.chordI[0])||'epiano';
function playChordSeg(ch,time){
  try{
    if(!audioCtx||chordMute) return;
    const inst=chordInstOf(), t0=time+.012, g=.2*chordVol;
    ch.tones.forEach((d,i)=>{
      const r=rowForDegreeNear(d,4+i);
      (VOICE[inst]||VOICE.epiano)(440*Math.pow(2,(rowMidi(r,0)-69)/12),t0+i*.02,masterGain,g,stepDur()*3.6);
    });
  }catch(e){}
}
/* 试听一个和弦（用风格的色彩音色弹三/四音） */
function audChord(ch){
  try{
    ensureAudio(); if(!audioCtx) return;
    if(audioCtx.state!=='running') audioCtx.resume();
    const inst=(SP_.chordI&&SP_.chordI[0])||'epiano';
    const t0=audioCtx.currentTime+.04;
    ch.tones.forEach((d,i)=>{
      const r=rowForDegreeNear(d,4+i);
      (VOICE[inst]||VOICE.epiano)(440*Math.pow(2,(rowMidi(r,0)-69)/12),t0+i*.02,masterGain,.55,stepDur()*3);
    });
  }catch(e){}
}

