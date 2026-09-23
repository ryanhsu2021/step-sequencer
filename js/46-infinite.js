'use strict';
/* ============================================================
   step-sequencer · 46-infinite
   ♾ 无限演化：播放中每 1–6 小节自动微调伴奏音序
   ------------------------------------------------------------
   前提：先点过 🎼 一键编配（演化对象 = 主旋律 + 编配生成的贝斯 / 副旋律 /
   铺底 / 鼓组，按全站统一的命名口径识别）。和弦轨与所有音色不变。

   「不突兀」的三重保证：
     1. 变化只发生在小节交界（调度钩子挂在 bar 起点上）——重音乐句永远完整；
     2. 每次变换每个声部只替换 1–2 个小节，其余原样保留（杂交式演化）；
     3. 替换内容来自同一套编配生成器（fillBass/fillCounter/fillPad / 风格鼓库），
        和弦内音、音区避让、节奏规律全部继承，不会跳出当前和声框架。
     4. 主旋律是「和声内变奏」：节奏骨架一字不动，只把选中小节里的音在当前
        和弦 / 音阶内改音（强拍偏和弦音、弱拍偏级进、句尾只许和弦音落在
        和弦上），音区不越出旋律自身的范围——听感是「同一段旋律的变奏」。

   非破坏性边界：演化改的是 seq/p；和弦轨、音色、小节数一律不动。
   开启时 pushUndo 一次 → 关闭后 ↶ 可整体回到开启前。
   状态不进存档：刷新页面自动回到关闭（演化是播放中的会话行为）。
   ============================================================ */
/* 演化对象的角色名（与 42-arrange 的 ensureFreeVoice 命名口径一致） */
const INF_ROLES=['贝斯','副旋律','铺底'];
/* 窗口上下限：每 1–6 小节变换一次（用户可感知的最短/最长间隔） */
const INF_WIN_MIN=1, INF_WIN_MAX=6;
let infOn=false;            // 开关（不持久化）
let infCount=0;             // 距上次变换已经过的小节数
let infNext=4;              // 下次变换的窗口长度（1–6 随机重掷）
/* 当前是否具备演化条件：至少有一条编配生成的伴奏声部（鼓或角色 inst） */
const infTargets=()=>state.tracks.filter(t=>
  t.kind==='drum'||(t.kind==='inst'&&INF_ROLES.indexOf(t.name)>=0));
/* 演化声部各自的重生器（与一键编配同一套 fill） */
const INF_FILL={ '贝斯':fillBass, '副旋律':fillCounter, '铺底':fillPad };
/* 主旋律声部：非伴奏角色的 inst 里「内容最多」的那条（与 pickMelodyTrack 同口径，
   但明确排除贝斯 / 副旋律 / 铺底——它们就算更满也只是伴奏，不是旋律）。
   另排除开着「琶音器」的声部：那种声部的实际音高由 ARP 引擎实时生成，音序只是
   节奏栅格，拿它当旋律画像会把整首曲子的重心算歪。 */
function infMelody(){
  const cand=state.tracks.filter(t=>t.kind==='inst'&&
    INF_ROLES.indexOf(t.name)<0&&!arpOn(t)&&t.seq.some(v=>v>=0));
  if(!cand.length) return null;
  const score=t=>{ let n=0;
    for(let s=0;s<stepsOf(t);s++) if(t.seq[s]>=0) n+=(s%4===0?2:1);
    return n; };
  return cand.slice().sort((a,b)=>score(b)-score(a)||(barsOf(b)-barsOf(a)))[0];
}
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
  /* —— 开启前置检查：得有主旋律或编配生成的伴奏 —— */
  if(!infTargets().length&&!infMelody()){
    toast('♾ 请先画好主旋律（或点「🎼 一键编配」），再开启无限演化');
    return;
  }
  pushUndo();                                       // 开启前快照：一次撤销回到最初
  infOn=true; infCount=0; infNext=infWin();
  const b=$('infBtn'); if(b) b.classList.add('inf-on');
  save();
  toast('♾ 无限演化：已开启——播放中每 1–6 小节自动微调音序（主旋律做和声内变奏，和弦轨与音色不变）。再点一次关闭');
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
  const mel=infMelody();
  const targets=infTargets().filter(t=>t!==mel);
  if(!targets.length&&!mel) return;
  const prog=progFor();
  let changed=0;
  /* ① 主旋律先动：和声内变奏（节奏不动、只改音），同样只换 1–2 个小节 */
  if(mel&&evolveMelody(mel,prog)) changed++;
  /* ② 旋律画像：演化后再取一次，伴奏跟着「最新旋律」做音域避让 / 让位。
     没有可用旋律（极端情况）就传 null，填充器内部退化为纯和声驱动。 */
  let M=null;
  const pm=mel||pickMelodyTrack();
  if(pm&&pm.kind==='inst'&&pm.seq.some(v=>v>=0)) M=analyzeMelody(pm,chordFramesAt(prog,stepsOf(pm)));
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
/* ---- 主旋律：和声内变奏 —— 节奏骨架一字不动，只把选中小节里的音在
   当前和弦 / 音阶内改音。强拍偏向换成和弦的其他和弦音，弱拍偏向级进
   （±1/±2 音级），句尾（换气后的落音 / 末步）只许落和弦音。
   音区不越出旋律自身的 min/max 行——听感是「同一段旋律的变奏」而非重写。 ---- */
function evolveMelody(t,prog){
  const n=stepsOf(t), bars=barsOf(t);
  if(!bars||!n) return false;
  const CV=chordViewAt(prog,n), L=scLen();
  /* 旋律自身的音区边界（改动永远夹在里面） */
  let lo=-1,hi=-1;
  for(let s=0;s<n;s++){ const r=t.seq[s]; if(r>=0){ if(lo<0||r<lo)lo=r; if(hi<0||r>hi)hi=r; } }
  if(lo<0) return false;
  /* 杂交式：随机挑 1–2 个小节参与本轮变奏，其余小节原样保留 */
  const k=1+((Math.random()*2)|0);
  const all=[]; for(let b=0;b<bars;b++) all.push(b);
  const picks=arrShuffle(all).slice(0,Math.min(k,bars));
  const seq=t.seq.slice();
  /* 句尾集合：≥2 拍静默后的第一个音 + 全曲末步（与 analyzeMelody 同口径） */
  const cad=new Set();
  {
    let silence=0;
    for(let s=0;s<n;s++){
      if(t.seq[s]<0){ silence++; continue; }
      if(silence>=8) cad.add(s);
      silence=0;
    }
    cad.add(n-1);
  }
  let mutated=0;
  for(const bi of picks){
    for(let s=bi*BAR;s<(bi+1)*BAR&&s<n;s++){
      const r=seq[s]; if(r<0) continue;             // 休止 / 换气：节奏结构不碰
      if(Math.random()>=.55) continue;              // 不是每个音都动——大部分保留原样
      const cur=((degOfRow(r)%L)+L)%L;
      const strong=(s%4===0), tail=cad.has(s);
      const tones=CV.tonesOf(s)||[];
      /* 候选（音级 + 权重）：级进为主；强拍 / 句尾才允许跳到和弦的其他音 */
      const items=[],ws=[];
      if(!tail){
        for(const mv of [[-1,3],[1,3],[-2,1.5],[2,1.5]]){
          if(rowsForDeg(lo,hi,cur+mv[0]).length){ items.push(cur+mv[0]); ws.push(strong?mv[1]*.6:mv[1]); }
        }
      }
      if(strong||tail){
        for(const dgn of tones){
          if((((dgn%L)+L)%L)===cur) continue;
          if(rowsForDeg(lo,hi,dgn).length){ items.push(dgn); ws.push(tail?3:2); }
        }
      }
      if(!items.length) continue;
      const nd=weightedPick(items,ws);
      const rows=rowsForDeg(lo,hi,nd);
      /* 同音级可能跨八度有多行：取离原音最近的行，线条走得最顺 */
      let best=rows[0],bd=1e9;
      for(const rr of rows){ const w=Math.abs(rr-r); if(w<bd){bd=w;best=rr;} }
      if(best!==r){ seq[s]=best; mutated++; }
    }
  }
  if(!mutated) return false;
  t.seq=seq; t.last=seq.slice();
  refreshAllSteps(t); refreshSummary(t);
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
