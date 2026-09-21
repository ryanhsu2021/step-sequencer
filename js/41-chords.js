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
/* 🎲 随机同风格：和弦个数与每个和弦的拍数【原样保留】，只重新随机每个和弦的级数——
   级数从当前风格进行库（PLAN_LIB）里出现过的级数池抽取；首尾偏向主和弦、避免与原和弦相同 */
function randomSameStyle(){
  const cur=fitProg(), L=scLen();
  const pool=[...new Set(PLAN_LIB().flat().map(d=>(((d|0)%L)+L)%L))];
  if(!pool.length) pool.push(0);
  const next=cur.map((c,i)=>{
    let d;
    if((i===0||i===cur.length-1)&&Math.random()<.6) d=0;          // 开头 / 结尾多半落回主和弦
    else for(let t=0;t<8;t++){ d=pick(pool); if(d!==c.root||pool.length<2) break; }
    return mkChord(d==null?c.root:d,c.beats,!!SP_.seventh);
  });
  setProg(next,false);                               // 总拍数不变 → fitProg 不会改动分段
  return progBars();
}
/* 改和弦轨自己的小节数（1–8），与声部小节数无关 */
function setProgBars(n){
  n=clamp(n|0,1,MAX_BARS);
  if(n===progBars()) return;
  state.progBars=n; chordEdit=null;
  fitProg(); renderChord(); syncFollowers(); save();
  toast('和弦进行轨 → '+n+' 小节（'+progBeats()+' 拍，与声部小节数无关）');
}
function setProg(p,edited){
  state.prog=p; state.progEdited=!!edited; chordEdit=null;
  fitProg(); renderChord(); syncFollowers(); save();
}
/* ---- 常用进行预设：把一条「级数走向」铺满当前和弦轨的拍数 ----
   和弦比拍数还多 → 只取前 N 个（每个至少 1 拍）；否则平均分配、余数补给前面；相邻同根合并 */
function planToChords(plan){
  const total=progBeats(), L=scLen();
  let p=(Array.isArray(plan)?plan:[]).map(d=>((((d|0)%L)+L)%L));
  if(!p.length) p=[0];
  if(p.length>total) p=p.slice(0,total);
  const segs=[]; let left=total;
  p.forEach((d,i)=>{
    const remain=p.length-i;
    const b=Math.max(1,Math.round(left/remain));
    segs.push({root:d,seventh:!!SP_.seventh,beats:b});
    left-=b;
  });
  while(left>0){ segs[segs.length-1].beats++; left--; }
  const out=[];
  for(const c of segs){ const q=out[out.length-1]; if(q&&q.root===c.root) q.beats+=c.beats; else out.push(c); }
  return out.map(c=>mkChord(c.root,c.beats,c.seventh));
}
/* 声部（及和弦轨）的混音字段统一写入口：音量 / 声像 / 静音 / 独奏 / 延时 / 强度。
   写完后让总线立刻跟上（改音量不必等下一次发声），并持久化；面板由调用方决定是否重绘。 */
const clamp01=v=>Math.max(0,Math.min(1,v));
function setTrackVol(tr,v,quiet){
  if(!tr) return;
  tr.vol=clamp01(v); busSync(tr); save();
  if(!quiet) renderMixer();
}
function setTrackPan(tr,v,quiet){
  if(!tr||tr.kind!=='inst') return;
  tr.pan=Math.max(-1,Math.min(1,v)); busSync(tr); save();
  if(!quiet) renderMixer();
}
function setTrackMute(tr,on,quiet){
  if(!tr) return;
  tr.mute=!!on; muteLatch(tr); save();
  if(!quiet){ renderTracks(); renderMixer(); }
}
function setTrackSolo(tr,on,quiet){
  if(!tr) return;
  tr.solo=!!on; save();
  if(!quiet){ renderTracks(); renderMixer(); }
}
/* 鼓声部不提供延时（鼓点加回声容易糊）：把 fx 钉死在「关」，总线一并归零 */
function setTrackDelay(tr,id,quiet){
  if(!tr) return;
  if(tr.kind==='drum'){ tr.fx='off'; setTrackFx(tr,'off'); }
  else setTrackFx(tr,id);
  save();
  if(!quiet) renderMixer();
}
function setTrackFxMix(tr,v,quiet){
  if(!tr) return;
  tr.fxMix=clamp01(v); busSync(tr); save();
  if(!quiet) renderMixer();
}

/* 应用一条预设进行（整条替换，标记为手动），并试听新进行的第一个和弦 */
function setProgPlan(plan){
  const ch=planToChords(plan);
  if(!ch.length) return 0;
  setProg(ch,true);
  audChord(ch[0]);
  return ch.length;
}
/* 进行指纹：去掉相邻同根后的级数链，用于下拉回显「现在选的是哪一条」 */
function progKeyOf(p){
  const L=scLen(), out=[];
  (Array.isArray(p)?p:[]).forEach(c=>{
    const d=((((c&&c.root)||0)%L)+L)%L;
    if(out[out.length-1]!==d) out.push(d);
  });
  return out.join('-');
}
/* 级数链 → 罗马数字（"I – V – VI – IV"），用于预设名与「当前」回显 */
function planRoman(p){
  const L=scLen();
  return (Array.isArray(p)?p:[])
    .map(c=>ROMAN[((((c&&c.root)||0)%L)+L)%L]||'')
    .join(' – ');
}
/* ============ 跟随和弦（非破坏性） ============
   设计：音序里摆放的 step 位置永不改动（视觉稳定、关掉开关即完整复原）；
   「跟随和弦」只在播放 / 试听 / 导出时把音高折算到当前和弦内。
   followRow(tr,s) ＝ 该步「实际发声」用的行号：
     · 未跟随 / 鼓轨 / 空步 → 原样返回 tr.seq[s]
     · 已跟随 → 从原行向两侧找最近的和弦音行（找不到则原样）
   纯函数：不读写任何持久状态，因此可安全地在调度热路径里反复调用。 */
function followRow(tr,s){
  if(!tr||tr.kind!=='inst') return tr?tr.seq[s]:-1;
  const r=tr.seq[s];
  if(r==null||r<0) return r;
  if(!isFollowing(tr)) return r;
  const ca=chordAtFor(state.prog,stepsOf(tr));
  const set=ca&&ca[s];
  if(!set||!set.size) return r;
  if(set.has(degOfRow(r))) return r;               // 本来就在和弦内 → 不动
  for(let d=1;d<ROWS;d++){
    const lo=r-d, hi=r+d;
    if(lo>=0&&set.has(degOfRow(lo))) return lo;
    if(hi<ROWS&&set.has(degOfRow(hi))) return hi;
  }
  return r;
}
/* 该步实际发声的 MIDI 音高（播放 / 试听 / 力度面板 / MIDI 导出统一走这里） */
function playMidiOf(tr,s){ return rowMidi(followRow(tr,s),tr.oct); }
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
    if(!changed) pushUndo();                       // 真的有音要挪才存快照
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
    if(card&&card.kind==='inst') refreshAllSteps(tr);
  }
  return changed;
}
/* 和弦轨变化后：跟随声部的音高由 followRow 在播放时实时折算，这里只需重画面板提示。
   返回是否有跟随声部（用于 toast 判断）。 */
function syncFollowers(){
  let any=false;
  for(const tr of state.tracks){
    if(!isFollowing(tr)) continue;
    any=true;
    const card=view.cards.get(tr.id);
    if(card&&card.kind==='inst'){ refreshAllSteps(tr); refreshSummary(tr); }
  }
  return any;
}
/* ---- 和弦进行轨发声：播放时每拍触发当前和弦，音色 / 音量 / 延时可选（默认跟风格） ---- */
let chordInst='', chordMute=false, chordVol=.8, chordFx='off', chordFxMix=1;
const chordInstOf=()=>chordInst||(SP_.chordI&&SP_.chordI[0])||'epiano';
/* 和弦轨的专属输出总线：复用与声部同构的链路（gain → 延时发送 → master），
   总线号 __chordbus 不等于任何声部 id，所以与声部互不干扰 */
const CHORD_BUS_ID='__chordbus';
const chordBusSpec=()=>({id:CHORD_BUS_ID,vol:chordVol,pan:0,fx:chordFx,fxMix:chordFxMix});
function chordDest(){ ensureAudio(); return busFor(chordBusSpec()); }
function applyChordFx(){
  const b=busCache.get(CHORD_BUS_ID);
  if(b&&audioCtx) applyTrackFx(chordBusSpec(),b);
}
/* 和弦轨总线：音量 / 静音也在这里统一落值（音量走总线 gain，静音顺手哑掉，播放调度里另有短路） */
function applyChordBus(){
  const b=busCache.get(CHORD_BUS_ID);
  if(!b||!audioCtx) return;
  b.gain.gain.value=chordMute?0:chordVol;
  if(b.pan) b.pan.pan.value=0;
  applyTrackFx(chordBusSpec(),b);
}
function setChordFx(id){
  chordFx=DELAY_IDS.has(id)?id:'off';
  applyChordFx();
}
/* 和弦轨的混音（调音台里那一行）：静音 / 音量 都作用在它自己的总线上，与声部互不干扰 */
function setChordMute(on,quiet){
  chordMute=!!on; save();
  if(!quiet){ renderChord(); renderMixer(); }
}
function setChordVolume(v,quiet){
  chordVol=clamp01(v); applyChordBus(); save();
  if(!quiet) renderMixer();
}
function playChordSeg(ch,time){
  try{
    if(!audioCtx||chordMute) return;
    const dest=chordDest(); if(!dest) return;
    const inst=chordInstOf(), t0=time+.012, g=.2;      // 音量交给总线 gain（chordVol）统一控制
    ch.tones.forEach((d,i)=>{
      const r=rowForDegreeNear(d,4+i);
      (VOICE[inst]||VOICE.epiano)(440*Math.pow(2,(rowMidi(r,0)-69)/12),t0+i*.02,dest,g,stepDur()*3.6);
    });
  }catch(e){}
}
/* 试听一个和弦（用风格的色彩音色弹三/四音；同样走和弦轨总线，延时听得见） */
function audChord(ch){
  try{
    const dest=chordDest(); if(!dest) return;
    if(audioCtx.state!=='running') audioCtx.resume();
    const inst=(SP_.chordI&&SP_.chordI[0])||'epiano';
    const t0=audioCtx.currentTime+.04;
    ch.tones.forEach((d,i)=>{
      const r=rowForDegreeNear(d,4+i);
      (VOICE[inst]||VOICE.epiano)(440*Math.pow(2,(rowMidi(r,0)-69)/12),t0+i*.02,dest,.55,stepDur()*3);
    });
  }catch(e){}
}

