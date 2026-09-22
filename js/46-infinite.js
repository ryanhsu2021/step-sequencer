'use strict';
/* ============================================================
   step-sequencer · 46-infinite
   ♾ 无限演化：播放中每 1–6 小节自动微调伴奏音序
   ------------------------------------------------------------
   前提：先点过 🎼 一键编配（演化对象 = 编配生成的贝斯 / 琶音器 /
   铺底 / 鼓组，按全站统一的命名口径识别）。主旋律与所有音色不变。

   「不突兀」的三重保证：
     1. 变化只发生在小节交界（调度钩子挂在 bar 起点上）——重音乐句永远完整；
     2. 每次变换每个声部只替换 1–2 个小节，其余原样保留（杂交式演化）；
     3. 替换内容来自同一套编配生成器（fillBass/fillArp/fillPad / 风格鼓库），
        和弦内音、音区避让、节奏规律全部继承，不会跳出当前和声框架。

   非破坏性边界：演化改的是「编配生成物」的 seq/p；主旋律、音色、小节数、
   和弦轨一律不动。开启时 pushUndo 一次 → 关闭后 ↶ 可整体回到开启前。
   状态不进存档：刷新页面自动回到关闭（演化是播放中的会话行为）。
   ============================================================ */
/* 演化对象的角色名（与 42-arrange 的 ensureFreeVoice 命名口径一致） */
const INF_ROLES=['贝斯','琶音器','铺底'];
/* 窗口上下限：每 1–6 小节变换一次（用户可感知的最短/最长间隔） */
const INF_WIN_MIN=1, INF_WIN_MAX=6;
let infOn=false;            // 开关（不持久化）
let infCount=0;             // 距上次变换已经过的小节数
let infNext=4;              // 下次变换的窗口长度（1–6 随机重掷）
/* 当前是否具备演化条件：至少有一条编配生成的伴奏声部（鼓或角色 inst） */
const infTargets=()=>state.tracks.filter(t=>
  t.kind==='drum'||(t.kind==='inst'&&INF_ROLES.indexOf(t.name)>=0));
/* 演化声部各自的重生器（与一键编配同一套 fill） */
const INF_FILL={ '贝斯':fillBass, '琶音器':fillArp, '铺底':fillPad };
const infWin=()=>INF_WIN_MIN+((Math.random()*(INF_WIN_MAX-INF_WIN_MIN+1))|0);

/* ============ 开关 ============ */
function toggleInfinite(){
  if(infOn){                                        // —— 关闭 ——
    infOn=false; infCount=0;
    const b=$('infBtn'); if(b) b.classList.remove('inf-on','inf-flash');
    save();
    toast('♾ 无限演化：已关闭（演化后的音序保留——↶ 撤销可回到开启前的样子）');
    return;
  }
  /* —— 开启前置检查：得有编配生成的伴奏 —— */
  if(!infTargets().length){
    toast('♾ 请先点「🎼 一键编配」生成贝斯 / 琶音器 / 铺底 / 鼓组，再开启无限演化');
    return;
  }
  pushUndo();                                       // 开启前快照：一次撤销回到最初
  infOn=true; infCount=0; infNext=infWin();
  const b=$('infBtn'); if(b) b.classList.add('inf-on');
  save();
  toast('♾ 无限演化：已开启——播放中每 1–6 小节自动微调伴奏音序（主旋律、音色与和弦轨不变）。再点一次关闭');
}
/* 播放调度钩子：每个小节起点调一次（scheduleStep 在 g%BAR===0 时调用）。
   在 lookahead 缓冲内提前变异，恰好赶在「新小节的第一个音」被调度之前，
   所以变化永远落在小节交界上。 */
function infBarTick(){
  if(!infOn) return;
  infCount++;
  if(infCount<infNext) return;
  infCount=0; infNext=infWin();
  evolveOnce();
}

/* ============ 演化一次 ============ */
function evolveOnce(){
  if(!infOn) return;
  const targets=infTargets();
  if(!targets.length) return;
  /* 旋律画像：与一键编配同一套分析（填充器靠它做音域避让 / 让位 / 句尾留白）。
     pickMelodyTrack 在伴奏已满铺时可能选中贝斯——这里不用它筛演化对象，
     只在它确实是 inst 时当画像来源；没有旋律就退化为用和弦轨本身画基准。 */
  let M=null;
  const mel=pickMelodyTrack();
  const msrc=(mel&&mel!==null&&mel.kind==='inst'&&mel.seq.some(v=>v>=0))?mel:null;
  if(msrc) M=analyzeMelody(msrc,chordFramesAt(progFor(),stepsOf(msrc)));
  const prog=progFor();
  let changed=0;
  for(const t of targets){
    if(t.kind==='drum'){ if(evolveDrum(t)) changed++; continue; }
    if(evolveInst(t,M,prog)) changed++;
  }
  if(!changed) return;
  save();
  /* 按钮轻闪一下：给用户一个「刚刚演化过了」的可见心跳 */
  const b=$('infBtn');
  if(b){ b.classList.remove('inf-flash'); void b.offsetWidth; b.classList.add('inf-flash');
    setTimeout(()=>b.classList.remove('inf-flash'),700); }
}

/* ---- inst 声部：与「另一代生成结果」杂交，每代只换 1–2 个小节 ---- */
function evolveInst(t,M,prog){
  const fill=INF_FILL[t.name]; if(!fill) return false;
  const n=stepsOf(t), bars=barsOf(t);
  /* 在影子轨道上整条重生成一代（不碰原声部）：音色 / 八度 / 小节数 / 琶音开关全继承 */
  const tmp=Object.assign({},t,{seq:null,last:null,vel:null,userSeq:null});
  try{ fill(tmp,M||fakeProfile(n),prog); }catch(e){ return false; }
  if(!Array.isArray(tmp.seq)||tmp.seq.length!==n) return false;
  /* 杂交：随机挑 1–2 个小节换成新代，其余保留当前（「基于当前音序做变化」） */
  const k=1+((Math.random()*2)|0);
  const all=[]; for(let b=0;b<bars;b++) all.push(b);
  const picks=arrShuffle(all).slice(0,Math.min(k,bars));
  const seq=t.seq.slice();
  for(const bi of picks){
    for(let s=bi*BAR;s<(bi+1)*BAR&&s<n;s++){
      if(M&&M.gaps.has(s)&&tmp.seq[s]===-1){ seq[s]=-1; continue; }   // 换气点尊重留白
      seq[s]=tmp.seq[s];
    }
  }
  t.seq=seq; t.last=seq.slice();
  const card=view.cards.get(t.id);
  if(card&&card.kind==='inst'){ refreshAllSteps(t); refreshSummary(t); }
  return true;
}
/* 没有可用旋律时的兜底画像：全曲无换气、重心居中——填充器退化为「纯和声驱动」 */
function fakeProfile(n){
  const L=scLen();
  return {N:n,L,step5:L>=7?4:3,deg:new Array(n).fill(-1),onset:[],cad:[],gaps:new Set(),
    rAvg:new Array(Math.max(1,Math.ceil(n/4))).fill(3.5),bN:Math.max(1,Math.ceil(n/4)),
    meanDeg:0,dens:0,rowDeg:degOfRow,
    rowAt:()=>3.5};
}

/* ---- 鼓声部：与风格库里的另一套律动杂交，每代只换 1–2 个小节 ---- */
function evolveDrum(t){
  const bars=barsOf(t), n=bars*BAR;
  const pick=styleDrumPick(bars);
  if(!pick||!pick.p) return false;
  const cur=t.p||{}, nw=pick.p;
  /* 同一组小节对所有 lane 一起替换——整条律动整段换，鼓的骨架才不会散 */
  const all=[]; for(let b=0;b<bars;b++) all.push(b);
  const picks=arrShuffle(all).slice(0,Math.min(1+((Math.random()*2)|0),bars));
  const o={};
  for(const l of DRUM_LANES){
    const c=cur[l.id]||'', w=nw[l.id]||'';
    let str='';
    for(let b=0;b<bars;b++){
      str+=(picks.indexOf(b)>=0&&w)?w.substr(b*BAR,BAR):c.substr(b*BAR,BAR);
    }
    if(str.indexOf('x')>=0) o[l.id]=str;
  }
  if(!Object.keys(o).length) return false;
  t.p=o;
  t.drum='custom';                    // 混合体标记为自定义：切风格 / ensureDrum 不再覆盖
  refreshDrumCells(t); refreshSub(t);
  return true;
}
