'use strict';
/* ============================================================
   step-sequencer · 42-arrange
   🎼 一键编配 v2：先「听懂」主旋律，再生成贝斯 / 琶音 / 铺底 / 鼓组
   ------------------------------------------------------------
   v1 的缺陷：完全没看主旋律，只按风格的节奏库随机填音。
   v2 的思路（三件事）：
     1. 旋律画像 analyzeMelody()：把主旋律读成「强拍音级 / 落音 / 乐句边界 /
        音域重心 / 呼吸点」——这是后面所有声部做决定的依据。
     2. 和声锁定 preferProg()：如果用户没手动改过和弦轨，用 deriveProgression()
        从旋律反推一条和声（比纯风格随机更贴合实听），并写明推导来源。
     3. 三声部各司其职（对位 + 音域避让）：
          贝斯  ＝ 和声地基：强拍锚在和弦根音，旋律长音/句尾处补五音/三音走动
          琶音  ＝ 织体层：跟着旋律的音域走向上下、句尾让位留呼吸，绝不与贝斯撞区
          铺底  ＝ 长音层：只落在和弦骨架音，躲在贝斯之上、旋律之下
   ============================================================ */
/* ---------- 通用小工具 ---------- */
const arrPick=a=>a[(Math.random()*a.length)|0];
const arrShuffle=a=>{const b=a.slice();for(let i=b.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[b[i],b[j]]=[b[j],b[i]];}return b;};
const ARR_EPS=-1e9;
/* 加权随机：ws 与 items 等长，概率 ∝ (w - wmin + 1)。用于「不是纯随机、但也不死板」的挑选 */
function weightedPick(items,ws){
  if(!items.length) return undefined;
  const off=Math.min(...ws);
  let tot=0; for(const w of ws) tot+=Math.max(0,w-off)+1;
  let r=Math.random()*tot;
  for(let i=0;i<items.length;i++){ r-=Math.max(0,ws[i]-off)+1; if(r<=0) return items[i]; }
  return items[items.length-1];
}

/* ============ 1. 旋律画像 ============
   输入：旋律声部 tr、和弦帧 frames（长度 = 步数，每一步一个和弦段）
   输出：只读的分析结果，供三个声部共用（一次分析，多处消费） */
/* 把和弦段展开成「每一步一个和弦段」的数组（长度恰好 n）。
   analyzeMelody 与三个 fill* 都按**步**索引取和弦，所以必须先展开到步——
   直接传 progTiled 的段列表会让索引错位（把 8 个段当成 8 步），是最隐蔽的坑。 */
function chordFramesAt(prog,n){
  const out=new Array(n);
  let s=0;
  for(const c of progTiled(prog,n)){
    const span=c.beats*4;
    for(let k=0;k<span&&s<n;k++,s++) out[s]=c;
  }
  for(let i=0;i<n;i++) if(!out[i]) out[i]=out[i-1]||mkChord(0,1,false);
  return out;
}
function analyzeMelody(tr,frames){
  const N=stepsOf(tr), L=scLen(), step5=L>=7?4:3;
  const deg=new Array(N).fill(-1);
  for(let s=0;s<N;s++){ const r=tr.seq[s]; deg[s]=r<0?-1:degOfRow(r); }
  /* 每拍第一个有音的位置：编排决策优先看这里（听感最重） */
  const onset=[];
  for(let s=0;s<N;s++){
    const ds=(s===0)?deg[s]:(s%4===0?deg[s]:-1);
    if(ds>=0){ onset.push({s,deg:ds,b:Math.floor(s/4),w:(s%4===0)?2.2:1}); continue; }
    if(s%4===0){                                   // 强拍空着 → 往后看这一拍内的音（弱起）
      for(let k=1;k<4&&s+k<N;k++) if(deg[s+k]>=0){ onset.push({s:s+k,deg:deg[s+k],b:Math.floor(s/4),w:.8}); break; }
    }
  }
  /* 乐句边界：≥2 拍的静默当作换气；句尾音（cad）是落音决策的关键 */
  const cad=[], gaps=new Set();
  let silence=0;
  for(let s=0;s<N;s++){
    if(deg[s]<0){ silence++; continue; }
    if(silence>=8){ cad.push(s); gaps.add(s); }
    silence=0;
  }
  if(N>1&&deg[N-1]>=0) cad.push(N-1);
  /* 音域重心：以拍为单位取平均行，再做单极点平滑 —— 琶音/铺底跟着它上下走 */
  const bN=Math.max(1,Math.ceil(N/4)), rAvg=new Array(bN).fill(0);
  for(let b=0;b<bN;b++){
    let sum=0,cnt=0;
    for(let k=0;k<4;k++){ const s=b*4+k; if(s>=N) break; const r=tr.seq[s]; if(r>=0){ sum+=r; cnt++; } }
    rAvg[b]=cnt?sum/cnt:NaN;
  }
  for(let b=1;b<bN;b++) if(isNaN(rAvg[b])) rAvg[b]=rAvg[b-1];
  for(let b=bN-2;b>=0;b--) if(isNaN(rAvg[b])) rAvg[b]=rAvg[b+1];
  if(isNaN(rAvg[0])) rAvg.fill(3.5);
  for(let pass=0;pass<2;pass++) for(let b=1;b<bN-1;b++) rAvg[b]=(rAvg[b-1]+rAvg[b]*2+rAvg[b+1])/4;
  /* 全曲平均行：给贝斯一个「旋律重心」，避免低音线一直趴在谷底 */
  let mSum=0,mCnt=0;
  for(const o of onset){ mSum+=o.deg; mCnt++; }
  const meanDeg=onset.length?mSum/onset.length:0;
  /* 音符出现率：决定织体密度（旋律越满，伴奏越要让位） */
  const dens=deg.filter(d=>d>=0).length/Math.max(1,N);
  /* 和弦帧：frames 是「每一步一个和弦段」的展开结果（调用方已 progTiled 到 N 步），
     这里按步索引直取即可——注意不要再用 w*4 折算，否则整条和声会错位。 */
  const fr=s=>frames[clamp(s,0,N-1)]||frames[0];
  const rootOf=s=>fr(s).root;
  const tonesOf=s=>fr(s).tones;
  const inChord=s=>d=>tonesOf(s).indexOf(((d%L)+L)%L)>=0;
  const thirdOf=s=>{ const t=tonesOf(s); return t.length>1?t[1]:t[0]; };
  /* 行号 → 音级（转调内折算）：各声部算「哪些行是和弦音」时统一用这个 */
  const rowDeg=r=>degOfRow(r);
  /* 行号 → 距主音的半音数（八度折叠），用于「同音级不同八度」的判定 */
  const rowPc=r=>{ const a=ivOf(), L=a.length, i=ROWS-1-r; return a[((i%L)+L)%L]; };
  return {N,L,step5,deg,onset,cad,gaps,rAvg,bN,meanDeg,dens,rootOf,tonesOf,inChord,thirdOf,rowDeg,rowPc,
          /* 该窗口旋律行（用于音域避让） */
          rowAt:s=>{ if(!onset.length) return 3.5; let bst=onset[0],bd=1e9;
            for(const o of onset){ const d=Math.abs(o.s-s); if(d<bd){bd=d;bst=o;} } return bst.deg; }};
}

/* ============ 2. 和声来源 ============
   用户手动改过和弦轨 → 完全尊重原样；没改过 → 从旋律反推一条（deriveProgression），
   反推结果通常是 2 拍粒度的细分段，这里按 1 小节归一成段，保证每个和弦至少持续一拍。 */
function preferProg(mel){
  if(state.progEdited) return {prog:progFor(),derived:false};
  try{
    const d=deriveProgression(mel.seq||[]);
    const L=scLen(), total=progBeats();
    let segs=d.map(c=>({root:((((c.root|0)%L)+L)%L),seventh:!!SP_.seventh,beats:c.beats|0}));
    if(!segs.length) return {prog:progFor(),derived:false};
    let sum=segs.reduce((a,c)=>a+c.beats,0);
    /* 拍数对齐到和弦轨长度：多了削尾、少了取模补满 */
    while(sum>total&&segs.length){
      const last=segs[segs.length-1];
      const cut=Math.min(last.beats,sum-total);
      last.beats-=cut; sum-=cut;
      if(last.beats<=0) segs.pop();
    }
    if(!segs.length) return {prog:progFor(),derived:false};
    if(sum<total){
      const base=segs.map(c=>({...c}));
      let i=0;
      while(sum<total){
        const c=base[i%base.length];
        const b=Math.min(c.beats||1,total-sum);
        segs.push({root:c.root,seventh:c.seventh,beats:b});
        sum+=b; i++;
        if(i>256) break;
      }
    }
    const out=segs.map(c=>mkChord(c.root,c.beats,c.seventh));
    return {prog:fitArrangedProg(out),derived:true};
  }catch(e){ return {prog:progFor(),derived:false}; }
}
/* 去掉相邻同根、合并过短段，让编配用的和声更「干净」 */
function fitArrangedProg(p){
  const out=[];
  for(const c of p){
    const q=out[out.length-1];
    if(q&&q.root===c.root&&q.seventh===c.seventh) q.beats+=c.beats;
    else out.push({root:c.root,seventh:c.seventh,tones:c.tones||chordTones(c.root,c.seventh),beats:c.beats});
  }
  return out.map(c=>({root:c.root,seventh:c.seventh,beats:c.beats,tones:chordTones(c.root,c.seventh)}));
}

/* ============ 2b. 音区模型（三层避让的唯一真相） ============
   ⚠️ 本工程 8 行 × 7 声，两个数不整除：[0]=C4 → [7]=C3，每行降一个音级。
   只有 8 个音位却要放 7 个音级 → 「行号」和「音级」必然不是一一对应
   （第 0 行和第 7 行都是级数 0，差一个八度）。两个由此而来的硬结论：

   ① **绝不能用行号区间当音域约束**。贝斯把行限制在 5..7 时，那个区间只有
      级数 {2,1,0} 三个音——和弦根音是 3 或 5 时一个合法行都没有，只能退到
      级数 0 上，于是「强拍根音率」永远上不去（实测 36~61%，怎么调生成逻辑都没用）。
      正确做法：**按音级（模 L）筛选行**，再在选出的行里挑音高合适的。

   ② 三层（贝斯/铺底/琶音）**无法**在 8 行里各占一段不重叠的音区，
      硬分会把某层的和弦音全排除掉。所以三层用「各自的重心 + oct 八度差」区分：
        贝斯  oct=-1，重心最低（取低音行）      → 实际听感低一个八度
        铺底  oct= 0，重心居中
        琶音  oct= 0，重心最高（取高音行）
      即「同一行号，三层的实际音高差一个八度」由 oct 承担，行号只表达「在该层内部的
      高低倾向」。这样任何一层都能拿到完整的和弦音，同时听感上仍是三层不打架。 */
/* 三层各自的「取行偏好」：在候选行里离这个偏好越近越优先 */
const ARR_LAYER={
  bass:{lo:0,hi:ROWS-1,pref:ROWS-1,oct:-1},   // 贝斯：整个键盘的最低音区（再叠 oct 的 -1 八度）
  pad: {lo:0,hi:ROWS-1,pref:ROWS-3,oct:0},    // 铺底：偏低的中间层
  arp: {lo:0,hi:ROWS-4,pref:0,     oct:0},    // 琶音：偏高的织体层（行 5..7 留给贝斯，避免同八度糊掉）
};
/* 某行在音级空间的实际音高（半音、跨八度不折叠）：相同音级的行靠它分高低 */
function rowPitch(r){
  const a=ivOf(), L=a.length, i=ROWS-1-r;
  return a[((i%L)+L)%L]+12*Math.floor(i/L);
}
/* 在 [lo,hi] 行里找出音级恰好等于 want（模 L）的行 */
function rowsForDeg(lo,hi,want){
  const L=scLen(), w=((want%L)+L)%L, out=[];
  for(let r=lo;r<=hi;r++) if((((degOfRow(r)%L)+L)%L)===w) out.push(r);
  return out;
}
/* 取「音级 = deg 且离 pref 最近」的行；该音区内没有这个音级时，依次退到和弦里
   其他可用的音级（三音 → 五音 → 其余），保证「永远有音」而不会整段留白 —— bug 就是
   这里的 `continue` 把整段吞掉过。 */
function nearestRow(lo,hi,deg,pref,tones){
  const cand=[deg];
  if(tones) for(const d of tones) if(cand.indexOf(d)<0) cand.push(d);
  for(const d of cand){
    const rows=rowsForDeg(lo,hi,d);
    if(!rows.length) continue;
    let best=rows[0],bd=1e9;
    for(const r of rows){ const w=Math.abs(r-pref); if(w<bd){bd=w;best=r;} }
    return best;
  }
  return clamp(pref|0,lo,hi);                     // 兜底：该音区一个和弦音都没有
}
/* 本声部的「权威和声视图」：按**该声部自己的步数**把和弦轨展开，
   给出每步的根音与和弦音集合。
   ⚠️ 为什么不能复用 M.rootOf：M 是按「旋律」的步数展开的帧，而每个声部的小节数
   彼此独立（贝斯可能是 8 小节而旋律 4 小节），长曲末尾会整体错位一个和弦。
   实测：8 小节 + 3 小节和弦轨时，末步会落到上一个和弦的根音上（0.8% 的越界音）。 */
function chordViewAt(prog,n){
  const orig=Array.isArray(prog)?prog:state.prog;      // 未平铺的原始进行（chordAtFor 自己会平铺）
  const ca=chordAtFor(orig,n);
  const root=new Array(n), tones=new Array(n);
  /* chordAtFor 只给集合，根音得从进行段重新推：用 progTiled 的段边界对齐逐步 */
  const seg=new Array(n);
  let s=0;
  for(const c of progTiled(orig,n)){
    const span=Math.min(c.beats*4,n-s);
    for(let k=0;k<span;k++) seg[s+k]={root:c.root,tones:c.tones};
    s+=span;
  }
  for(let i=0;i<n;i++){
    const g=seg[i]||seg[n-1]||{root:0,tones:(ca[i]?[...ca[i]]:[0])};
    root[i]=g.root; tones[i]=g.tones;
  }
  return {ca,root,tones,rootOf:i=>root[clamp(i,0,n-1)],tonesOf:i=>tones[clamp(i,0,n-1)]};
}

/* 贝斯的「根音行」：优先取离贝斯重心最低处最近的那个根音行 */
function bassRootRow(s,CV){
  const lo=ARR_LAYER.bass.lo, hi=ARR_LAYER.bass.hi;
  return nearestRow(lo,hi,CV.rootOf(s),ARR_LAYER.bass.pref,CV.tonesOf(s));
}

/* ============ 3. 贝斯：和声地基 ============
   与 v1 的区别：低音节奏型不再「每段随机抽一条」，而是
     · 强拍（每拍首步）锚在**和弦根音**上 → 和声最清楚
     · 弱拍走 和弦五音 / 三音 → 有线条而不是死板的根音小调
     · 乐句换气处与句尾留白 → 与旋律同呼吸
     · 长音（≥3 步）下方垫持续根音 → 托住旋律的落音
     · 只在和弦音内游走，保证零撞音 */
function fillBass(t,M,prog){
  const n=stepsOf(t);
  const {lo:B_LO,hi:B_HI,pref:B_PREF}=ARR_LAYER.bass;
  /* 一切和声判断都走 CV（按本声部步数展开的权威视图），不用 M.rootOf/M.tonesOf */
  const CV=chordViewAt(prog,n);
  t.seq=new Array(n).fill(-1);
  const rootRowAt=s=>bassRootRow(s,CV);
  const degRow=(s,deg,pref)=>nearestRow(B_LO,B_HI,deg,pref,CV.tonesOf(s));
  /* 强拍之间用「同一和弦里音高最接近的行」接续，线条才走得顺 */
  const stepFrom=s=>{ if(s<=0) return B_PREF;
    for(let k=s-1;k>=0&&k>=s-4;k--) if(t.seq[k]>=0) return t.seq[k];
    return B_PREF; };
  const usedBeat=new Set();
  /* --- a) 强拍锚点：根音（一半概率在拍中走五音/三音） --- */
  for(const o of M.onset){
    if(o.s%4!==0) continue;                            // 只认拍首，保证强拍 = 根音
    const b=o.b; if(usedBeat.has(b)) continue;
    usedBeat.add(b);
    if(o.s>=n) continue;
    const row=rootRowAt(o.s);
    if(Math.random()<.5){                              // 一半概率在 2 步后走个音
      const s2=o.s+2;
      if(s2<n&&t.seq[s2]===-1&&!M.gaps.has(s2)){
        const deg=Math.random()<.6?((CV.rootOf(o.s)+M.step5)%M.L):M.thirdOf(o.s);
        t.seq[s2]=degRow(o.s,deg,row);
      }
    }
    t.seq[o.s]=row;
  }
  /* --- b) 长音下方垫根音（旋律拖长时低音给稳定感） --- */
  let run=0;
  for(let s=0;s<=n;s++){
    if(s<n&&M.deg[s]>=0){ run++; continue; }
    if(run>=3){
      for(let k=s-4;k<s;k++){
        if(k<0||k>=n) continue;
        if(k%2===0&&t.seq[k]===-1&&!M.gaps.has(k)){ t.seq[k]=rootRowAt(k); break; }
      }
    }
    run=0;
  }
  /* --- c) 弱拍走动：把强拍之间的空位填成「根音 → 五音 / 三音」的推进 --- */
  if(Math.random()<.6){
    for(const o of M.onset){
      const s=o.s; if(s%4!==0||s+2>=n) continue;
      if(M.gaps.has(s+2)||M.deg[s+2]>=0) continue;     // 旋律在唱 → 低音让位
      if(t.seq[s+2]!==-1||Math.random()>.55) continue;
      const deg=Math.random()<.6?((CV.rootOf(s)+M.step5)%M.L):M.thirdOf(s);
      t.seq[s+2]=degRow(s,deg,t.seq[s]>=0?t.seq[s]:rootRowAt(s));
    }
  }
  /* --- d) 句尾：落在该处和弦的根音上（终止感） --- */
  for(const c of M.cad){
    if(c<n&&t.seq[c]===-1&&!M.gaps.has(c)) t.seq[c]=rootRowAt(c);
  }
  /* 末步兜底：一定落在和弦音上（优先根音） */
  if(!t.seq.some(v=>v>=0)||t.seq[n-1]===-1) t.seq[n-1]=rootRowAt(n-1);
  /* --- e) 律动补充：风格的低音节奏型兜底，只填空位、只取和弦音 --- */
  const lib=PAT_BASS(); const pat=lib[(Math.random()*lib.length)|0];
  if(M.dens<.8){
    for(const o of M.onset){
      for(let k=0;k<4;k++){
        const s=o.s+k; if(s>=n) break;
        const m=pat[k%8]; if(m===undefined) continue;
        if(t.seq[s]!==-1) continue;
        if(M.gaps.has(s)) continue;
        const pref=stepFrom(s);
        t.seq[s]= m==='f'?degRow(s,(CV.rootOf(s)+M.step5)%M.L,pref)
                : m==='t'?degRow(s,M.thirdOf(s),pref)
                : nearestRow(B_LO,B_HI,CV.rootOf(s),pref,CV.tonesOf(s));
      }
    }
  }
  /* --- f) 收尾闸门：任何一步都不许留下和弦外音（风格库 / 兜底分支的统一保证） --- */
  for(let s=0;s<n;s++){
    const r=t.seq[s]; if(r<0) continue;
    if(CV.ca[s]&&CV.ca[s].has(M.rowDeg(r))) continue;
    t.seq[s]=nearestRow(B_LO,B_HI,CV.rootOf(s),B_PREF,CV.tonesOf(s));
  }
  t.last=t.seq.slice();
}

/* ============ 4. 琶音：织体层 ============
   与 v1 的区别：节奏型仍然取自风格库，但**音高**不再冷随机——
     · 每个和弦段内按和声张力排序（根音/五音稳、三音/七音偏情绪）后取音
     · 织体中心跟着 M.rAvg（旋律音域走向）上下浮动，旋律走高时织体也跟着抬
     · 句尾与换气点主动留白，给旋律让出呼吸
     · 音域重心最高（ARR_LAYER.arp），与贝斯/铺底拉开听感层次 */
function fillArp(t,M,prog){
  const n=stepsOf(t);
  const {lo:A_LO,hi:A_HI,pref:A_PREF}=ARR_LAYER.arp;
  const lib=PAT_ARP(); const pats=arrShuffle(lib).slice(0,2);
  const orders=PAT_ORD();
  const tiled=progTiled(prog,n);
  const nSeg=Math.max(1,tiled.length);
  prog=tiled.map((c,i)=>({...c,seg:i%nSeg}));
  t.seq=new Array(n).fill(-1);
  let base=0;
  for(const ch of prog){
    const span=ch.beats*4, tones=ch.tones;
    if(!tones.length){ base+=span; continue; }
    const patt=pats[ch.seg%pats.length]||ARP_PATS[0];
    /* 候选行：织体区内、音级属于当前和弦的行（按音级筛，别按行号区间筛） */
    const pool=[];
    for(let r=A_LO;r<=A_HI;r++) if(tones.indexOf(((M.rowDeg(r)%M.L)+M.L)%M.L)>=0) pool.push(r);
    if(!pool.length) pool.push(nearestRow(A_LO,A_HI,ch.root,A_PREF,tones));
    const stabRow=r=>{ const d=((M.rowDeg(r)%M.L)+M.L)%M.L;
      return d===ch.root?0:(d===((ch.root+M.step5)%M.L)?1:2); };
    const order=(Math.random()<.7?arrPick(orders):pool.slice().sort((a,b)=>stabRow(a)-stabRow(b)).map((_,i)=>i)).slice();
    let prev=-1;
    for(let k=0;k<span;k++){
      const step=base+k; if(step>=n) break;
      const b=Math.floor(step/4);
      if(M.gaps.has(step)) continue;                   // 换气点：留白
      /* 旋律走高（rAvg 小）→ 织体中心跟着抬；反之落回低区。
         row 0 = 最高音、row ROWS-1 = 最低音，所以直接用行号做中心即可。 */
      let ctr=Math.round(clamp(A_LO+(3.8-M.rAvg[clamp(b,0,M.bN-1)])*.6,A_LO,A_HI));
      if(k%4===3) ctr=clamp(ctr+1,A_LO,A_HI);
      if(!patt[k%8]) continue;
      const idx=order.length?order[k%order.length]:(k%pool.length);
      const target=pool[((idx%pool.length)+pool.length)%pool.length];
      /* 在候选里挑「离织体中心近、又顺着音序型、还别跟前一个音跳太远」的那个 */
      let best=target,bd=1e9;
      for(const r of pool){
        const d=Math.abs(r-ctr)+Math.abs(r-target)*.35+(prev<0?0:Math.abs(r-prev)*.25);
        if(d<bd){bd=d;best=r;}
      }
      t.seq[step]=best; prev=best;
    }
    base+=span;
    if(base>=n) break;
  }
  /* 收尾：末步和弦音，落在织体偏下（接住下一轮循环） */
  if(t.seq[n-1]===-1){
    const last=prog[prog.length-1]||prog[0];
    t.seq[n-1]=nearestRow(A_LO,A_HI,last.root,A_HI,last.tones);
  }
  t.last=t.seq.slice();
}

/* ============ 5. 铺底：长音层 ============
   只落在和弦骨架音（根音优先，其次五音），每段 1–2 次、长音托住全曲。
   音域重心居中（ARR_LAYER.pad），落在贝斯之上、琶音之下，形成三层的中间那层。 */
function fillPad(t,M,prog){
  const n=stepsOf(t);
  const {lo:P_LO,hi:P_HI,pref:P_PREF}=ARR_LAYER.pad;
  prog=progTiled(prog,n);
  t.seq=new Array(n).fill(-1);
  let base=0;
  for(const ch of prog){
    const span=ch.beats*4, ts=ch.tones;
    if(!ts.length){ base+=span; continue; }
    /* 段首锚根音，长段再补一次五音；前置条件：该处不能是换气点 */
    const times=span>=12?2:1;
    let prev=-1;
    for(let i=0;i<times;i++){
      const off=Math.round(i*span/times);
      let s=base+off;
      if(s>=n) break;
      if(M.gaps.has(s)&&s+1<n) s++;                    // 换气点往后挪一步，而不是整段丢掉
      if(s>=n||M.gaps.has(s)) continue;
      const deg=(i===0)?ch.root:((ch.root+M.step5)%M.L);
      t.seq[s]=nearestRow(P_LO,P_HI,deg,prev<0?P_PREF:prev,ts);
      prev=t.seq[s];
    }
    base+=span;
    if(base>=n) break;
  }
  /* 末步兜底：一定落在和弦骨架音上 */
  if(!t.seq.some(v=>v>=0)||t.seq[n-1]===-1){
    const last=prog[prog.length-1]||prog[0];
    t.seq[n-1]=nearestRow(P_LO,P_HI,last.root,P_HI,last.tones);
  }
  t.last=t.seq.slice();
}

/* ============ 6. 声部统筹 ============ */
const BASS_PATS=[                 /* 8 步半小节内的低音节奏：0=根音 f=五音 t=三音 */
  {0:0,3:0,5:'f',6:0},
  {0:0,3:'f',6:0},
  {0:0,2:0,3:'t',5:'f',6:0},
  {0:0,4:0,6:'f'},
  {0:0,3:0,5:'f',6:0,7:'t'},
  {0:0,2:'f',4:0,6:'f'},
];
const ARP_PATS=[
  [1,0,1,0,1,1,0,1],
  [1,0,0,1,0,1,0,1],
  [1,1,0,1,0,1,1,0],
  [1,0,1,1,0,1,0,1],
  [1,0,1,0,1,0,1,0],
];
const ARP_ORDERS=[[0,1,2],[2,1,0],[0,1,2,1],[1,2,0],[0,2,1]];
/* 风格自带的节奏库优先，没有则回落到通用库 */
const patLib=(own,fb)=>(own&&own.length)?own:fb;
const PAT_BASS=()=>patLib(SP_.bassPats,BASS_PATS);
const PAT_ARP =()=>patLib(SP_.arpPats,ARP_PATS);
const PAT_ORD =()=>patLib(SP_.arpOrders,ARP_ORDERS);
function ensureFreeVoice(role,except){
  const isFree=x=>x.kind==='inst'&&x!==except&&!x.seq.some(v=>v>=0);
  let t=state.tracks.find(isFree);
  if(!t) t=state.tracks.find(x=>x.kind==='inst'&&x!==except&&x.name===role.name);
  if(!t&&state.tracks.length<MAX_TRACKS){
    t=makeTrack('inst',role.name,role.inst,role.oct);
    state.tracks.push(t);
  }
  if(!t) t=state.tracks.find(x=>x.kind==='inst'&&x!==except);
  if(t){
    recolor(); t.name=role.name; t.inst=role.inst; t.oct=role.oct; t.mute=false; t.solo=false;
    if(barsOf(t)!==songBars()){ t.bars=songBars(); resizeTrack(t,stepsOf(t)); }   // 铺满全曲长度
  }
  return t;
}
/* 鼓声部：按当前风格挑选并生成（用户手改过就尊重现状） */
function styleDrumPick(bars){
  const id=arrPick(styleDrums());
  return {id,p:patForBars(PRESET_BY_ID(id).p,bars||1)};
}
function ensureDrum(force){
  let d=state.tracks.find(t=>t.kind==='drum');
  if(!d&&state.tracks.length<MAX_TRACKS){
    d=makeTrack('drum','鼓组'); state.tracks.push(d); recolor();
  }
  if(!d) return null;
  if(barsOf(d)!==songBars()){ d.bars=songBars(); resizeTrack(d,stepsOf(d)); }
  if(force||d.drum!=='custom'){
    const s=styleDrumPick(barsOf(d));
    d.p=s.p; d.drum=s.id;
    refreshDrumCells(d); refreshSub(d);
  }
  return d;
}
/* 挑「最有内容」的旋律声部当分析对象：音最多、强拍覆盖最全的那个 */
function pickMelodyTrack(){
  const insts=state.tracks.filter(t=>t.kind==='inst');
  if(!insts.length) return null;
  const score=t=>{
    let n=0;
    for(let s=0;s<stepsOf(t);s++) if(t.seq[s]>=0) n+=(s%4===0?2:1);
    return n;
  };
  return insts.slice().sort((a,b)=>score(b)-score(a)||(barsOf(b)-barsOf(a)))[0];
}
function autoArrange(){
  const mel=pickMelodyTrack();
  if(!mel||!mel.seq.some(v=>v>=0)){ toast('请先在某个声部摆上几个音，再点一键编配'); return; }
  pushUndo();
  const src=preferProg(mel);
  /* 先落盘和声、再生成：setProg 里的 fitProg 会重新平铺和弦段，
     所以必须「写回 state.prog 之后再读回来」，否则生成用的和声与存档/画面里的会错位。 */
  if(src.derived) setProg(src.prog.map(c=>mkChord(c.root,c.beats,c.seventh)),false);
  const prog=progFor();                       // 以 state.prog 为准（已含 fitProg 的平铺结果）
  const frames=chordFramesAt(prog,stepsOf(mel));
  const M=analyzeMelody(mel,frames);
  const roles=[
    {name:'贝斯',inst:arrPick(SP_.bassI||['bass']),oct:ARR_LAYER.bass.oct,fill:fillBass},
    {name:'琶音 Arp',inst:arrPick(SP_.chordI||['pluck','epiano','marimba']),oct:ARR_LAYER.arp.oct,fill:fillArp},
  ];
  if(SP_.padRole) roles.push({name:'铺底',inst:arrPick(['pad','strings','organ']),oct:ARR_LAYER.pad.oct,fill:fillPad});
  const made=[];
  for(const role of roles){
    const t=ensureFreeVoice(role,mel);
    if(t){ role.fill(t,M,prog); made.push(t.name+'('+barsOf(t)+'小节)'); }
  }
  const d=ensureDrum();
  renderTracks();
  save();
  const info='分析「'+mel.name+'」：'+M.onset.length+' 个重音 · '+M.cad.length+' 处句尾'
    +(src.derived?' · 和声由旋律反推':' · 沿用你的和弦轨');
  toast('🎼 '+STYLE().emoji+' '+info+' → '+(made.length?made.join(' + '):'（无空闲声部）')
    +(d?' + 鼓组':'')+' ——再点一次会不同（↶ 可撤销）');
}
