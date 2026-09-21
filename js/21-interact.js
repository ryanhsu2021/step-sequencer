'use strict';
/* ============================================================
   step-sequencer · 21-interact
   步进网格交互 · 旋钮交互（兼容旧版） · 声部级操作
   ============================================================ */
/* ============ 步进网格：单击点放 / 双击清除 / 长按力度面板 / 拖拽划过涂抹 ============ */
let paintMode=null;                     // 拖拽涂抹时统一为「放置」或「清除」
function attachStepCellEvents(cell,tr,s,r){
  let lpTimer=0,sx=0,sy=0,dragging=false,moved=false,lastTap=0;
  const has=()=>tr.seq[s]===r;
  const preview=()=>{
    ensureAudio(); if(audioCtx.state!=='running') audioCtx.resume();
    /* 试听用「实际发声」的音高：跟随和弦开启时听到的就是折算后的音，所见即所得 */
    const rr=tr.seq[s]===r?followRow(tr,s):r;
    playTrackNote(tr,rr,audioCtx.currentTime+.02,velOf(tr,s));
  };
  const place=()=>{ setStep(tr,s,r); };
  cell.addEventListener('pointerdown',e=>{
    if(e.button===2) return;
    if(e.pointerType==='touch'){
      sx=e.clientX; sy=e.clientY;
      if(lpTimer) clearTimeout(lpTimer);
      lpTimer=setTimeout(()=>{
        lpTimer=0; dragging=false;
        if(has()) openVelPop(tr,s,cell);
      },480);
    }
    dragging=true; moved=false;
    paintMode=null;                     // 本次拖拽的首格决定涂抹方向
    try{cell.setPointerCapture(e.pointerId);}catch(_){}
    e.preventDefault();
  });
  cell.addEventListener('pointermove',e=>{
    if(lpTimer&&(Math.abs(e.clientX-sx)>9||Math.abs(e.clientY-sy)>9)){clearTimeout(lpTimer);lpTimer=0;}
    if(!dragging) return;
    if(Math.abs(e.clientX-sx)>7||Math.abs(e.clientY-sy)>7) moved=true;
    if(!moved) return;
    /* 拖拽划过：沿指针下的格子连续涂抹（同方向：首次放置则全放置，首次清除则全清除） */
    const el=document.elementFromPoint(e.clientX,e.clientY);
    const c=el&&el.closest?el.closest('.sqcell'):null;
    if(!c||c.__tr!==tr||c.__s==null) return;
    if(paintMode===null) paintMode=has()?'off':'on';
    if(paintMode==='on'){ if(!(tr.seq[c.__s]===c.__r)) setStep(tr,c.__s,c.__r,false); }
    else { if(tr.seq[c.__s]!==-1) setStep(tr,c.__s,-1,false); }
  });
  const finish=e=>{
    if(lpTimer){clearTimeout(lpTimer);lpTimer=0;}
    const wasDrag=paintMode!==null;
    dragging=false; paintMode=null;
    if(wasDrag){ auditionNote(tr,s); return; }        // 涂抹过：不再做点按判定
    if(moved) return;
    const now=Date.now();
    if(now-lastTap<300){ place(); lastTap=0; return; } // 双击＝再点一次（放音）
    lastTap=now;
    if(has()){ setStep(tr,s,-1,false); return; }      // 单击已亮的格＝清除
    place(); preview();
  };
  cell.addEventListener('pointerup',finish);
  cell.addEventListener('pointercancel',()=>{
    if(lpTimer){clearTimeout(lpTimer);lpTimer=0;}
    dragging=false; paintMode=null;
  });
  cell.addEventListener('contextmenu',e=>e.preventDefault());
  cell.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){ e.preventDefault(); has()?setStep(tr,s,-1,false):place(); }
    else if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); setStep(tr,s,-1,false); }
  });
  /* 滚轮＝调该步力度（有音符才生效）；上滚增强 / 下滚减弱，步长 10% */
  cell.addEventListener('wheel',e=>{
    if(tr.seq[s]===-1) return;
    e.preventDefault();
    if(!Array.isArray(tr.vel)) tr.vel=new Array(stepsOf(tr)).fill(null);
    const cur=tr.vel[s]==null?.82:tr.vel[s];
    const nv=clamp(Math.round((cur+(e.deltaY<0?.1:-.1))*10)/10,.2,1);
    if(nv===cur) return;
    tr.vel[s]=nv; refreshStepCell(tr,s); save(); auditionNote(tr,s);
  },{passive:false});
  cell.__tr=tr; cell.__s=s; cell.__r=r;
}
const MID_ROW=(ROWS-1)>>1;
const mod9=x=>((x%9)+9)%9;
let audioPreview=true, lastAudit=0;
function auditionNote(tr,s){
  if(!audioPreview) return;
  const now=performance.now();
  if(now-lastAudit<55) return;
  lastAudit=now;
  ensureAudio(); if(audioCtx.state!=='running') audioCtx.resume();
  const r=followRow(tr,s);                          // 试听折算后的实际音高
  if(r!==-1) playTrackNote(tr,r,audioCtx.currentTime+.02,velOf(tr,s));
}
function setStep(tr,s,r,tap){
  pushUndo();                                        // 每次手动编辑前存快照，Ctrl+Z 可回退
  if(tr.kind==='inst'){                            // 手动编辑才计入「用户素材」——✨ 优化的锚点来源
    if(!Array.isArray(tr.userSeq)||tr.userSeq.length!==tr.seq.length) tr.userSeq=tr.seq.slice();
    tr.userSeq[s]=r;
  }
  tr.seq[s]=r;
  refreshStepCell(tr,s); save();
  if(tap!==false) auditionNote(tr,s);
}
function toggleStep(tr,s){
  setStep(tr,s, tr.seq[s]===-1 ? (tr.last[s]!==-1?tr.last[s]:MID_ROW) : -1);
}

/* ============ 声部级操作 ============ */
function clearTrack(tr){
  pushUndo();
  if(tr.kind==='drum'){ tr.p={}; tr.drum='custom'; refreshDrumCells(tr); }
  else { const n=stepsOf(tr); tr.seq=new Array(n).fill(-1); tr.last=new Array(n).fill(-1); tr.userSeq=null; tr.vel=null; refreshAllSteps(tr); }
  refreshSub(tr); save();
}
/* 随机鼓律动：从当前风格的推荐预设里挑一条骨架（按小节平铺），再做随机加花 / 删减 */
function randomizeDrum(tr){
  if(tr.kind!=='drum') return;
  pushUndo();
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

/* ============ 触屏：长按旋钮呼出「力度 / 清除」面板 ============
   手机没有滚轮与右键，力度与清除都从这里走：
   · 有音符：滑杆实时调力度（20%–100%），「清除音符」一键删除该步
   · 没音符：只给关闭按钮（点按旋钮本身即可放音）
   桌面端不受影响：单击步进 / 拖拽旋转 / 滚轮力度 / 右键逆转照旧 */
let velPop=null, velPopCtl=null;
function ensureVelPop(){
  if(velPop) return velPop;
  velPop=document.createElement('div');
  velPop.className='velpop';
  velPop.innerHTML='<div class="vp-title"></div>'+
    '<div class="vp-row"><span>力度</span><input type="range" min="20" max="100" step="5"><b class="vp-val"></b></div>'+
    '<div class="vp-row"><button type="button" class="vp-off">清除音符</button><button type="button" class="vp-close">关闭</button></div>';
  document.body.appendChild(velPop);
  return velPop;
}
function closeVelPop(){
  if(velPopCtl){ velPopCtl.cleanup(); velPopCtl=null; }
  if(velPop) velPop.classList.remove('show');
}
function openVelPop(tr,s,dial){
  closeVelPop();
  const pop=ensureVelPop();
  const has=tr.seq[s]!==-1;
  const shownM=has?playMidiOf(tr,s):0;                 // 跟随和弦时显示折算后的实际音高
  const followHint=tr.follow&&has&&followRow(tr,s)!==tr.seq[s]?'（跟随和弦 → '+noteName(shownM)+'）':'';
  pop.querySelector('.vp-title').textContent='第 '+(s+1)+' 步 · '+(has?noteName(shownM)+followHint:'空');
  const rng=pop.querySelector('input'), val=pop.querySelector('.vp-val');
  const offBtn=pop.querySelector('.vp-off'), xBtn=pop.querySelector('.vp-close');
  const row=rng.closest('.vp-row');
  row.style.display=has?'':'none';                     // 空步没有力度可调
  offBtn.style.display=has?'':'none';
  const cur=velOf(tr,s);
  rng.value=Math.round((cur==null?.82:cur)*100);
  val.textContent=rng.value+'%';
  const onInput=()=>{
    if(tr.seq[s]===-1) return;
    if(!Array.isArray(tr.vel)) tr.vel=new Array(stepsOf(tr)).fill(null);
    tr.vel[s]=+rng.value/100;
    val.textContent=rng.value+'%';
    updateDial(tr,s); save();
  };
  const onOff=()=>{ setStep(tr,s,-1,false); closeVelPop(); };
  const onX=()=>closeVelPop();
  const onDoc=e=>{ if(!pop.contains(e.target)&&e.target!==dial) closeVelPop(); };
  const onScroll=()=>closeVelPop();
  rng.addEventListener('input',onInput);
  offBtn.addEventListener('click',onOff);
  xBtn.addEventListener('click',onX);
  setTimeout(()=>document.addEventListener('pointerdown',onDoc,true),0);   // 稍后注册：不拦截本次长按
  window.addEventListener('scroll',onScroll,{capture:true,passive:true});
  velPopCtl={cleanup(){
    rng.removeEventListener('input',onInput);
    offBtn.removeEventListener('click',onOff);
    xBtn.removeEventListener('click',onX);
    document.removeEventListener('pointerdown',onDoc,true);
    window.removeEventListener('scroll',onScroll,{capture:true});
  }};
  pop.classList.add('show');                           // 先显示才能量尺寸
  const b=dial.getBoundingClientRect();
  let x=b.left+b.width/2-pop.offsetWidth/2, y=b.top-pop.offsetHeight-10;
  if(y<8) y=b.bottom+10;                               // 顶上放不下就翻到下面
  x=clamp(x,8,window.innerWidth-pop.offsetWidth-8);
  pop.style.left=x+'px'; pop.style.top=y+'px';
  if(navigator.vibrate){ try{navigator.vibrate(12);}catch(_){} }   // 轻震动反馈
}
