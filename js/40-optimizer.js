'use strict';
/* ============================================================
   step-sequencer · 40-optimizer
   ✨ 优化旋律 / 🎲 随机生成（和声推导 + DP 全局最优 + 润色）
   ============================================================ */
/* ============================================================
   ✨ 优化旋律 v4（每个声部独立）：和声推导 + DP 全局最优 + 润色
   ============================================================ */
const STABLE_DEG=()=>{const L=scLen();return new Set(L>=7?[0,2,4]:(L===5?[0,2,3]:[0,2,4]));};
/* 和弦组成音（级数）：七声用三度叠置（可加七音），五声用 1-2-5(+6) 叠置避免"四度和弦" */
function chordTones(deg,seventh){
  const L=scLen(); let ds;
  if(L>=7){
    ds=[deg%L,(deg+2)%L,(deg+4)%L];
    if(seventh) ds.push((deg+6)%L);
  }else{
    ds=[deg%L,(deg+1)%L,(deg+3)%L];
    if(seventh) ds.push((deg+4)%L);
  }
  return [...new Set(ds.map(d=>((d%L)+L)%L))];
}
const chordFromRoot=deg=>chordTones(deg,!!SP_.seventh);
/* 一个和弦段：root 级数 / beats 持续拍数（1 拍＝4 步）/ seventh 七和弦色彩 */
const mkChord=(deg,beats,seventh)=>{
  const L=scLen(), r=((((deg|0)%L)+L)%L);
  return {root:r, beats:clamp(beats|0,1,64), seventh:!!seventh, tones:chordTones(r,!!seventh)};
};
const PROG_PLANS={
  0:[[0,4],[0,3],[0,5],[5,3],[1,4]],
  1:[[0,4],[0,5],[0,6],[3,4]],
  2:[[0,3],[0,6],[0,4]],
  3:[[0,6],[0,3],[0,0]],
  4:[[0,4],[0,3],[5,3]],
  5:[[0,1],[0,5],[0,3]],
  6:[[0,3],[0,4],[0,0]],
  7:[[0,3],[0,4],[0,2]],
};
/* 从乐句反推和声：每半小节一个候选窗口，再合并相邻同根音 → 每次结果不同 */
function deriveProgression(mel){
  const L=scLen(), step3=L>=7?2:1, step5=L>=7?4:3;
  const bars=songBars(), wins=Math.max(1,bars*2), win=2;         // 窗口＝2 拍
  const nMel=(mel&&mel.length)?mel.length:BAR;
  const cnt=[];
  for(let i=0;i<wins;i++) cnt.push(new Array(L).fill(0));
  for(let s=0;s<songSteps();s++){
    const r=mel[s%nMel]; if(r===undefined||r<0) continue;
    const w=Math.min(wins-1,Math.floor((s/4)/win));
    const d=degOfRow(r), wt=(s%4===0)?2.2:1;
    cnt[w][d]+=wt;
    cnt[w][((d-2)%L+L)%L]+=wt*.55;
    cnt[w][((d-step5)%L+L)%L]+=wt*.4;
  }
  const sel=(w)=>{
    const scored=[];
    for(let d=0;d<L;d++){
      let v=cnt[w][d];
      if(d===0) v+=w?1.6:1.1;
      if(w===wins-1&&(d===step5||d===4)) v+=.45;
      v+=styleRootBias(w,d);                          // 风格常用的和弦根音更受青睐
      scored.push([v,d]);
    }
    scored.sort((a,b)=>b[0]-a[0]);
    const r=Math.random();
    return scored[Math.min(r<.55?0:(r<.85?1:2),scored.length-1)][1];
  };
  const raw=[];
  for(let w=0;w<wins;w++) raw.push({root:sel(w),beats:win,seventh:!!SP_.seventh});
  const out=[];
  for(const c of raw){ const p=out[out.length-1]; if(p&&p.root===c.root) p.beats+=c.beats; else out.push(c); }
  return out.map(c=>mkChord(c.root,c.beats,c.seventh));
}
/* 风格和声偏好：plan 里出现过的级数加分（位置越靠后越像"解决"） */
function styleRootBias(q,d){
  const plans=SP_.prog; if(!plans) return 0;
  let b=0;
  for(const pl of plans) pl.forEach((deg,i)=>{ if(deg%scLen()===d) b+= (i<2? .28:.42); });
  return b*(q?1.1:.85);
}
/* 把和弦进行循环平铺到 n 步（和弦轨长度与声部无关：短了就循环重复，超出部分截断） */
function progTiled(prog,n){
  const base=(Array.isArray(prog)&&prog.length)?prog:[mkChord(0,1,false)];
  const out=[]; let s=0,i=0;
  while(s<n&&i<base.length*8){
    const c=base[i%base.length];
    const span=Math.min(Math.max(1,c.beats|0)*4,n-s);
    out.push({root:c.root,seventh:c.seventh,tones:c.tones,beats:Math.max(1,Math.round(span/4))});
    s+=span; i++;
  }
  if(!out.length) out.push({root:0,seventh:false,tones:chordTones(0,!!SP_.seventh),beats:Math.max(1,Math.round(n/4))});
  return out;
}
/* 把和弦段展开成「每步属于哪个和弦」的集合数组（和弦轨比声部短时循环平铺，比声部长时截断） */
function chordAtFor(prog,n){
  const a=new Array(n);
  let s=0;
  for(const c of progTiled(prog,n)){
    const set=new Set(c.tones);
    for(let k=0;k<c.beats*4&&s<n;k++) a[s+k]=set;
    s+=c.beats*4;
  }
  const fb=new Set(((Array.isArray(prog)?prog[prog.length-1]:null)||{tones:[0]}).tones||[0]);
  for(let i=0;i<n;i++) if(!a[i]) a[i]=fb;
  return a;
}

function targetRow(s,N){
  const p=SP_, t=s/Math.max(1,N-1), peak=p.peak;
  const x=t<peak?t/peak:(1-t)/(1-peak);
  return p.center-p.range*Math.pow(x,.9);
}
function transScore(s,pr,r,plp){
  if(r===-1||pr===-1) return 0;
  const p=SP_, dd=Math.abs(r-pr);
  let sc;
  if(dd===0) sc=(s%4===0)?-3.4:.5;
  else if(dd===1) sc=2.5*p.step;                       // 级进：风格越"旋律化"越受奖
  else if(dd===2) sc=1.1*p.step;
  else if(dd===3) sc=-1.4/p.leap;                      // 跳进：容忍度越高扣得越少
  else sc=-1.7*(dd-2)/p.leap;
  if(plp){ if(dd<=1) sc+=3.2*p.step; else if(dd>=3) sc-=3.4/p.leap; }
  return sc;
}
function emitScore(s,r,nrun,seed,chordAt,STABLE,N){
  const p=SP_;
  if(r===-1){
    let sc=-1.1*p.rest;                                // 留白偏好
    if(s%4===0) sc-=4.2*p.rest;
    if(s===0||s===N-1) sc-=40;
    if(seed[s]>=0) sc-=40;
    return sc;
  }
  const d=degOfRow(r), strong=s%4===0, chord=chordAt[s];
  let sc=0;
  if(chord.has(d)) sc+=(strong?9:4.8)*p.chBias;
  else if(STABLE.has(d)) sc+=strong?3.2:.4;
  else sc+=strong?-4.4:-2.6;
  sc-=1.05*Math.abs(r-targetRow(s,N));
  if(nrun===1) sc+=.9;
  if(nrun>=4) sc-=1.5*(nrun-3)*p.run;                  // 连音长度：风格决定爱长音还是碎音
  if(s===0) sc+= chord.has(d)?3.2:0;
  if(s===N-1) sc+= (d===0?14:(STABLE.has(d)?8:-9));
  if(seed[s]>=0) sc+= (r===seed[s])?(strong?5:3.2):(strong?0:-2.4);
  return sc;
}
/* 节奏候选：1 小节的骨架 × 小节数（后续小节带轻微变化，用户自己的节奏原样保留） */
function makeMasks(seed,bars){
  bars=clamp(bars|0,1,MAX_BARS);
  const pats=[];
  if(seed) pats.push({m:seed.map(v=>v>=0?1:0),lock:true});
  SP_.masks.forEach(m=>pats.push({m:m.map(v=>v?1:0)}));
  [[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,1],
   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,1],
   [1,0,0,1,0,1,0,1,0,1,0,0,1,0,1,1],
   [1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1],
   [1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,1]].forEach(m=>pats.push({m:m.slice()}));
  for(let k=0;k<2;k++){
    const m=[]; for(let s=0;s<BAR;s++) m.push(Math.random()<clamp(SP_.maskDens+(Math.random()-.5)*.34,.12,.9)?1:0);
    m[0]=1; m[BAR-1]=1; pats.push({m});
  }
  const out=[];
  for(const pt of pats){
    const base=pt.m.slice(0,BAR);
    const full=[];
    for(let b=0;b<bars;b++){
      const seg=base.slice();
      if(b>0&&!pt.lock&&Math.random()<.5){
        for(let k=0;k<3;k++){ const i=(Math.random()*BAR)|0; seg[i]=seg[i]?0:1; }
      }
      seg[0]=1;
      full.push(...seg);
    }
    full[0]=1; full[full.length-1]=1;
    out.push(full);
  }
  return out;
}
const NEG=-1e18;
function dpSolve(mask,seed,chordAt,STABLE,N){
  const NS=90;
  const idxS=(r,run,lp)=>((r+1)*5+run)*2+lp;
  const ok=[];
  for(let s=0;s<N;s++){
    const sd=clamp(seed[s]|0,-1,ROWS-1);        // 越界的锚点会被夹到合法行，避免状态丢失
    if(mask[s]===0) ok.push(r=>r===-1);
    else if(sd>=0&&s%4===0) ok.push(r=>r===sd);
    else ok.push(()=>true);
  }
  let cur=new Float64Array(NS).fill(NEG), nxt=new Float64Array(NS).fill(NEG);
  const back=new Int16Array(NS*N).fill(-1);
  cur[idxS(-1,0,0)]=0;
  for(let s=0;s<N;s++){
    nxt.fill(NEG);
    const okf=ok[s];
    for(let st=0;st<NS;st++){
      const base=cur[st]; if(base<=NEG/2) continue;
      const lp=st%2, t0=(st-lp)/2, run=t0%5, pr=(t0-run)/5-1;
      for(let r=-1;r<ROWS;r++){
        if(!okf(r)) continue;
        const nrun=r===-1?0:Math.min(run+1,4);
        const nlp=(r!==-1&&pr!==-1&&Math.abs(r-pr)>=3)?1:0;
        const val=base+emitScore(s,r,nrun,seed,chordAt,STABLE,N)+transScore(s,pr,r,lp);
        const ns=idxS(r,nrun,nlp);
        if(ns>=0&&ns<NS&&val>nxt[ns]){ nxt[ns]=val; back[s*NS+ns]=st; }
      }
    }
    const tmp=cur; cur=nxt; nxt=tmp;
  }
  let bst=-1,bv=NEG;
  for(let st=0;st<NS;st++) if(cur[st]>bv){bv=cur[st];bst=st;}
  if(bst<0) return null;
  const mel=new Array(N).fill(-1);
  let st=bst;
  for(let s=N-1;s>=0;s--){
    const lp=st%2, t0=(st-lp)/2, run=t0%5, pr=(t0-run)/5-1;
    mel[s]=pr;
    if(s>0){ st=back[s*NS+st]; if(st<0) break; }
  }
  return {mel,value:bv};
}
function polish(mel,seed,chordAt,STABLE,N){
  for(let s=0;s<N;s+=4){                              // 强拍落在和弦音上
    if(seed[s]>=0) continue;
    if(mel[s]===-1){ mel[s]=rowForDegreeNear([...chordAt[s]][0],3); continue; }
    if(!chordAt[s].has(degOfRow(mel[s]))){
      let bestR=mel[s],bd=99;
      for(const cd of chordAt[s]) for(let r=0;r<ROWS;r++) if(degOfRow(r)===cd&&Math.abs(r-mel[s])<bd){bd=Math.abs(r-mel[s]);bestR=r;}
      mel[s]=bestR;
    }
  }
  for(let s=1;s<N-1;s++){
    if(mel[s]!==-1&&mel[s]===mel[s-1]&&mel[s]===mel[s-2]){
      if(seed[s]>=0) continue;                        // 三连重复的这格是用户锚点：宁可保留重复也不动它
      const up=clamp(mel[s]+1,0,ROWS-1), dn=clamp(mel[s]-1,0,ROWS-1);   // 去重时优先保住和弦音
      const cands=[up,dn].filter(v=>v!==mel[s]);
      let pool=cands.filter(v=>chordAt[s].has(degOfRow(v)));
      if(!pool.length){ if(s%4===0) continue; pool=cands; }   // 强拍必须留在和弦内：找不到就不去重
      mel[s]=pool[(Math.random()*pool.length)|0];
    }
  }
  const pos=[]; for(let s=0;s<N;s++) if(mel[s]!==-1) pos.push(s);
  for(let i=0;i+1<pos.length;i++){
    const a=pos[i],b=pos[i+1];
    if(b-a>1&&Math.abs(mel[b]-mel[a])>=3){
      for(let s=a+1;s<b;s++) if(mel[s]===-1)
        mel[s]=clamp(Math.round(mel[a]+(mel[b]-mel[a])*(s-a)/(b-a)),0,ROWS-1);
    }
  }
  for(let s=0;s+7<N;s++){
    let full=true; for(let k=0;k<8;k++) if(mel[s+k]===-1){full=false;break;}
    if(!full) continue;
    const cut=(s%4===2)?s:s+1;
    if(cut>0&&cut<N-1&&seed[cut]===-1&&cut%4!==0) mel[cut]=-1;
  }
  const last=N-1;
  if(mel[last]!==-1&&degOfRow(mel[last])!==0&&seed[last]<0){
    let bestR=mel[last],bd=99;
    for(let r=1;r<ROWS;r++) if(degOfRow(r)===0&&Math.abs(r-mel[last])<bd){bd=Math.abs(r-mel[last]);bestR=r;}
    mel[last]=bestR;
  }
  return mel;
}
function optimizeMelody(tr,fresh){
  const N=stepsOf(tr), bars=barsOf(tr);
  const STABLE=STABLE_DEG();
  const prog=progFor();                              // 恒用和弦进行轨
  const chordAt=chordAtFor(prog,N);
  /* seed 只取「用户手动摆的音」（userSeq）——机器上次生成的结果不算，
     否则连点 ✨ 会被上一次的输出锁死，收敛成不动点、毫无变化。
     fresh=true（🎲 随机生成）：无视现有内容，从零按风格造一条全新旋律 */
  const userSeed=(!fresh&&Array.isArray(tr.userSeq)&&tr.userSeq.length===N)?tr.userSeq.slice():tr.seq.slice();
  const hasSeed=!fresh&&userSeed.some(v=>v>=0);
  const NOSEED=new Array(N).fill(-1);                // 全 -1 = 无锚点、无倾向（dpSolve/polish 均安全）
  const seedArr=hasSeed?userSeed:NOSEED;
  /* 强拍锚点全保留；弱拍的音高倾向每轮随机衰减（~62% 保留），让每次 DP 的评分面都不同 */
  const dpSeed=hasSeed?userSeed.map((v,s)=>(v>=0&&s%4!==0&&Math.random()>=.62)?-1:v):NOSEED;
  const masks=makeMasks(hasSeed?userSeed:null,bars);
  if(fresh) for(let k=0;k<3;k++){                    // 🎲 额外扔几条纯随机节奏，拉开多样性
    const base=[]; for(let s=0;s<BAR;s++) base.push(Math.random()<clamp(SP_.maskDens+(Math.random()-.5)*.5,.12,.92)?1:0);
    base[0]=1; base[BAR-1]=1;
    const full=[];
    for(let b=0;b<bars;b++){
      const seg=base.slice();
      if(b>0&&Math.random()<.5) for(let j=0;j<3;j++){ const i=(Math.random()*BAR)|0; seg[i]=seg[i]?0:1; }
      seg[0]=1; full.push(...seg);
    }
    full[full.length-1]=1; masks.push(full);
  }
  const dLo=Math.round(SP_.density[0]*bars), dHi=Math.round(SP_.density[1]*bars);   // 密度窗口按小节放大
  let cands=[];
  for(const mk of masks){
    const mask=mk.slice();
    /* 只把你摆在强拍（每拍首步）上的音锁成节奏锚点；弱拍的音保留为音高倾向，
       这样「氛围」这类稀疏风格才能真的把句子疏开 */
    if(hasSeed) for(let s=0;s<N;s++) if(userSeed[s]>=0&&s%4===0) mask[s]=1;
    mask[0]=1; mask[N-1]=1;
    const res=dpSolve(mask,dpSeed,chordAt,STABLE,N);
    if(!res) continue;
    const notes=res.mel.filter(v=>v>=0).length;
    const dist=notes>dHi?notes-dHi:(notes<dLo?dLo-notes:0);
    cands.push({res,notes,dist});
  }
  if(!cands.length) return false;
  /* 两段式：先只保留密度最贴近风格窗口的一档候选，再在「质量带」里加权随机抽一个（55/30/15）
     ——保证质量的同时，连点每次给出不同的方案；🎲 的质量带更宽（≤12 分），变化更大 */
  const minDist=Math.min(...cands.map(c=>c.dist));
  const pool=cands.filter(c=>c.dist===minDist);
  pool.sort((a,b)=>b.res.value-a.res.value);
  const band=pool.filter(c=>pool[0].res.value-c.res.value<=(fresh?12:8));
  let bi=0;
  if(band.length>1){
    const r=Math.random();
    bi=r<.55?0:(r<.85?Math.min(1,band.length-1):Math.min(2,band.length-1));
  }
  const best=band[bi].res.mel;
  const keep=best.map(v=>v>=0);                      // DP 自己摆的音（非润色补的）
  polish(best,seedArr,chordAt,STABLE,N);
  trimToWindow(best,keep,seedArr,dHi,N);             // 润色若补过头，按优先级削回窗口
  tr.seq=best; tr.last=best.slice();
  if(fresh) tr.userSeq=null;                         // 🎲 产物算机器素材：旧的手动锚点一并作废
  return true;
}
/* 密度收束：超过风格上限时，优先删掉「润色补的 / 不在强拍 / 用户没摆的」音 */
function trimToWindow(mel,keep,seed,dHi,N){
  let notes=mel.filter(v=>v>=0).length;
  if(notes<=dHi) return;
  const cand=[];
  for(let s=1;s<N-1;s++){
    if(mel[s]===-1||s%4===0) continue;
    let sc=0;
    if(!keep[s]) sc+=2;                              // 润色补进来的
    if(seed[s]===-1) sc+=1.5;                        // 本来就不是用户摆的
    if(mel[s]===mel[s-1]) sc+=.5;                    // 重复音
    cand.push([sc,s]);
  }
  cand.sort((a,b)=>b[0]-a[0]);
  for(let i=0;i<cand.length&&notes>dHi;i++){ mel[cand[i][1]]=-1; notes--; }
}
function optimizeForTrack(tr){
  if(tr.kind!=='inst') return;
  const ok=optimizeMelody(tr);
  refreshAll(); save();
  const src='和弦进行轨';
  toast(ok?(STYLE().emoji+' 按「'+STYLE().name+'」+ '+src+' 重排「'+tr.name+'」——可连点得到不同版本'):'优化失败');
}
/* 🎲 按当前风格从零随机生成一条全新旋律（无视现有内容；连点每次不同） */
function randomizeForTrack(tr){
  if(tr.kind!=='inst') return;
  const ok=optimizeMelody(tr,true);
  refreshAll(); save();
  toast(ok?(STYLE().emoji+' 按「'+STYLE().name+'」给「'+tr.name+'」随机生成了一条新旋律——连点每次都不同'):'生成失败');
}

