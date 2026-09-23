'use strict';
/* ============================================================
   step-sequencer · 42-arrange
   🎼 一键编配 v4：先「听懂」主旋律，再按**当前风格**生成贝斯 / 副旋律 / 铺底 / 鼓组
   ------------------------------------------------------------
   v1 的缺陷：完全没看主旋律，只按风格的节奏库随机填音。
   v2 的思路（三件事）：
     1. 旋律画像 analyzeMelody()：把主旋律读成「强拍音级 / 落音 / 乐句边界 /
        音域重心 / 呼吸点」——这是后面所有声部做决定的依据。
     2. 和声锁定：和声只有一个来源——和弦进行轨。编配**只读不写**（progFor()），
        绝不改写和弦轨。想换和声用和弦卡上的两个按钮：
        🎲 随机同风格 / ⤵ 从旋律推导（deriveProgression）。
   v3：编配不再产出「琶音器」（与卡片 ARP 开关语义纠缠），织体层换成「副旋律」。
   v4（本轮）：把「专业 / 贴风格 / 融合」三件事落到可检验的规则上——
     · **风格语法**：每个风格都有自己的低音语法（BASS_SKEL：长音 / 根-五 /
       八分推进 / 反拍 / 驱动 / 稀疏 / 808 长音 / 走动低音）、副旋律节奏库
       （ctrPats）与铺底织体（pad：持续 / 段首 / 稍晚进 / 反拍短音）。
       此前副旋律九种风格共用一套节奏型、铺底完全没有风格差异。
     · **低频合一**：先出鼓、再出贝斯——贝斯主动补在**底鼓落下的位置**，
       同一风格里「鼓与贝斯一起发力」，低频不再互相错开成一团糊；
       贝斯线还按「贴着上一个音走」选八度（低音的级进比跳进专业得多）。
     · **声部交错**：副旋律的起音避让贝斯（撞在一步上时后移到十六分反拍），
       上行「你进我让」的互补织体；同时避开铺底所占的行（不隔八度重合）。
     · **融合（混音层）**：三声部各配一条音量（bass > ctr > pad，pad 永远垫底）
       与一点点声像展开（低音居中、副旋律偏右、铺底偏左），
       并写入**每步力度**（强拍重、弱拍轻、底鼓处最实、铺底最轻）——
       各声部听感分层，才是「融而不糊」。
   v3 的变化：编配不再产出「琶音器」声部（见 6b）。需要琶音时用卡片上的
   「琶音器」开关或示例曲里那条真琶音声部。
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
          /* 旋律每步的**行号**（-1=无音）。deg 是音级、row 是行号，画副旋律时
             需要行号才能算出「在旋律下方几度」，两者不能混用。 */
          row:tr.seq.slice(),
          /* 该窗口旋律行（用于音域避让） */
          rowAt:s=>{ if(!onset.length) return 3.5; let bst=onset[0],bd=1e9;
            for(const o of onset){ const d=Math.abs(o.s-s); if(d<bd){bd=d;bst=o;} } return bst.deg; }};
}

/* ============ 2. 和声来源：只读和弦进行轨 ============
   ⚠️ 编配**绝不改写和弦进行轨**。v2 曾在这里做「未手动改过 → 用 deriveProgression
   从旋律反推一条并写回 state.prog」；但「🎲 随机同风格」按设计不置 progEdited
   （它仍属风格派生），于是用户刚挑好的进行会在点一键编配时被悄悄换掉。
   和弦轨的所有权只属于和弦卡上的两个按钮：
     · 🎲 随机同风格（randomSameStyle）——换级数不换个数与拍数
     · ⤵ 从旋律推导（deriveProgression）——标记为手动
   编配只做一件事：读 progFor()，然后写贝斯 / 副旋律 / 铺底 / 鼓组。 */

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
  pad: {lo:0,hi:ROWS-1,pref:ROWS-4,oct:0},    // 铺底：偏低的中间层（register 锚点，见 fillPad）
  arp: {lo:0,hi:ROWS-4,pref:0,     oct:0},    // 琶音：偏高的织体层（示例曲用，编配已不产出）
  ctr: {lo:0,hi:ROWS-1,pref:ROWS-2,oct:0},    // 副旋律：实际行号由「主旋律行 + 2~4」实时推出，这里只给兜底重心
};
/* 三声部的默认音量与声像（风格可用 mix 覆盖音量）：
   bass > ctr > pad 是刻意的层级——低音与副旋律是「内容」，铺底只是「床」；
   声像微微展开（低音居中、副旋律偏右、铺底偏左）让三层在立体声里各占一处，
   比全部居中叠在一起「融而不糊」。 */
const ARR_MIX={bass:.86,ctr:.79,pad:.58};
const ARR_PAN={bass:0,ctr:.16,pad:-.16};
/* 角色音量：风格 mix=[贝斯,副旋律,铺底] 优先，缺省回落到 ARR_MIX */
function arrMixOf(key){
  const m=SP_.mix;
  const i=key==='bass'?0:(key==='ctr'?1:2);
  const v=(Array.isArray(m)&&typeof m[i]==='number')?m[i]:ARR_MIX[key];
  return clamp01(v);
}
/* 把某声部已占用的「起音步 / 行」登记进 M，供后生成的声部避让（声部交错的依据） */
function markPart(M,t){
  if(!M) return;
  if(!M.taken) M.taken=new Set();
  if(!M.rows) M.rows=new Set();
  const n=stepsOf(t);
  for(let s=0;s<n;s++){ const r=t.seq[s]; if(r<0) continue; M.taken.add(s); M.rows.add(r); }
}
/* 提示条里显示的「声部语法」名——让用户一眼看见这次编配用了哪套语法 */
function roleGrammar(key){
  if(key==='bass'){
    const n={long:'长音铺底',root5:'根五交替',eighth:'八分推进',offbeat:'反拍律动',
             drive:'八分驱动',boom:'稀疏散点',slide:'808 长音',walk:'走动低音'};
    return n[SP_.bass]||'八分推进';
  }
  if(key==='pad'){
    const n={drone:'持续长音',hold:'段首长音',swell:'稍晚进',stab:'反拍短音'};
    return n[SP_.pad]||'段首长音';
  }
  return '对位线';
}
/* 鼓声部某条通道的命中步（低频合一 / 声部交错都要读它） */
function drumSteps(d,lane){
  const out=[];
  if(!d||d.kind!=='drum') return out;
  const str=(d.p&&d.p[lane])||'', n=stepsOf(d);
  for(let s=0;s<n;s++) if(str[s]==='x') out.push(s);
  return out;
}
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

/* 贝斯重心行（低音线的兜底起点） */

/* ============ 3. 贝斯：和声地基（风格语法） ============
   变化（相对 v2 的「一律强拍根音」）：低音不再是「跟着旋律强拍摆根音」，
   而是每个风格有自己的**低音语法**——氛围的长音、流行的八分推进、电子的反拍、
   摇滚的八分驱动、嘻哈的稀疏散点、Trap 的 808 长音、爵士的走动低音、
   民谣的根-五交替。三条通用规则把语法收在专业范围内：

     · 强拍（每小节第 1 拍）永远是根音 → 和声最清楚（也是最强拍根音率的保证）；
       其余位置按语法走 根音 / 五音 / 三音 / 引导音，全部取自当前和弦，零撞音。
     · **低频合一**：底鼓落下的地方低音也落下——同一风格里鼓与贝斯一起发力，
       低频只有一个「发力点」，不再互相错开成一团糊。这是「更融合」最有效的一条。
     · **线条连接**：每一次选行都贴着上一个低音走（低音的级进比跳进专业得多），
       而不是每次都回到最低行；跨和弦时优先走「引导音」（下一个和弦根音的
       下方五度 / 相邻级进，且必须在当前和弦内），把两个和弦缝起来。

   另加：长音（≥3 步）下方垫根音托住旋律、句尾落根音给终止感、
   以及逐音力度（强拍重 / 弱拍轻 / 底鼓处最实）。 */
/* 每个小节的起音骨架：off=步偏移、kind=走什么音、pr=采纳概率；
   hum＝人性化幅度（小节头永远不参与，保证每小节头必落在根音）：
     sub 改走和弦内另一个音 / drop 留白 / push 抢拍（提前一个 1/16 落下）
   这三项的存在让「每一次生成都不同」——低音语法不变成死循环的节拍器，
   ♾ 无限演化改这条声部时才听得出变化。 */
const BASS_SKEL={
  long:   {kick:.45,hum:{sub:.25,drop:0,  push:.12},ons:[[0,'root',1],[8,'fifth',.5],[12,'root',.35]]},
  root5:  {kick:.5, hum:{sub:.22,drop:.05,push:.15},ons:[[0,'root',1],[4,'root',.55],[8,'fifth',1],[12,'fifth',.5]]},
  eighth: {kick:.6, hum:{sub:.18,drop:.08,push:.12},ons:[[0,'root',1],[2,'root',.7],[4,'fifth',1],[6,'root',.7],
                                                       [8,'root',1],[10,'root',.7],[12,'fifth',1],[14,'root',.7]]},
  offbeat:{kick:.85,hum:{sub:.16,drop:.06,push:.06},ons:[[0,'root',1],[2,'root',1],[6,'root',1],[10,'root',1],[14,'root',1]]},
  drive:  {kick:.8, hum:{sub:.14,drop:.07,push:.08},ons:[[0,'root',1],[2,'root',1],[4,'root',1],[6,'root',1],
                                                       [8,'fifth',1],[10,'root',1],[12,'root',1],[14,'root',1]]},
  boom:   {kick:.8, hum:{sub:.3, drop:0,  push:.18},ons:[[0,'root',1],[10,'root',.6]]},
  slide:  {kick:.9, hum:{sub:.2, drop:0,  push:.14},ons:[[0,'root',1],[8,'root',.75]]},
  walk:   {kick:.5, hum:{sub:.35,drop:0,  push:.10},ons:[[0,'root',1],[4,'fifth',1],[8,'third',1],[12,'appr',1]]},
};
const BASS_STYLES=Object.keys(BASS_SKEL);
/* 铺底织体模式（见 fillPad） */
const PAD_MODES=['drone','hold','swell','stab'];
/* 引导音：走向下一个和弦的「缝」——下方五度优先，其次相邻级进，仍须落在当前和弦内 */
function bassApproach(s,CV,L,step5){
  const cur=((CV.rootOf(s)%L)+L)%L;
  let nx=cur;
  for(let k=s+1;k<s+9;k++){ const r=((CV.rootOf(k)%L)+L)%L; if(r!==cur){ nx=r; break; } }
  if(nx===cur) return cur;
  const cand=[((nx-step5)%L+L)%L,((nx-1)%L+L)%L,((nx+1)%L+L)%L,cur];
  const tones=(CV.tonesOf(s)||[]).map(d=>((d%L)+L)%L);
  for(const d of cand) if(tones.indexOf(d)>=0) return d;
  return cur;
}
function fillBass(t,M,prog){
  const n=stepsOf(t), L=M.L, step5=M.step5;
  const {lo:B_LO,hi:B_HI,pref:B_PREF}=ARR_LAYER.bass;
  /* 一切和声判断都走 CV（按本声部步数展开的权威视图），不用 M.rootOf/M.tonesOf */
  const CV=chordViewAt(prog,n);
  const sk=BASS_SKEL[SP_.bass]||BASS_SKEL.eighth;
  const thirdOf=s=>{ const tn=CV.tonesOf(s)||[]; return tn.length>1?((tn[1]%L)+L)%L:((CV.rootOf(s)%L)+L)%L; };
  t.seq=new Array(n).fill(-1);
  /* 线条连接：优先贴着「上一个低音」选行（找不到就退回贝斯重心） */
  const prevRowAt=s=>{
    for(let k=s-1;k>=0&&k>=s-16;k--) if(t.seq[k]>=0) return t.seq[k];
    for(let k=s+1;k<n&&k<=s+16;k++) if(t.seq[k]>=0) return t.seq[k];
    return B_PREF;
  };
  const place=(s,kind,force)=>{
    if(s<0||s>=n||t.seq[s]!==-1) return false;
    /* 小节头是低音的「和声锚点」：即便旋律正好在此换气重入，也要落下去
       （低音与旋律音区不同，不会盖住它）——旋律强拍根音率因此稳在 ~100%。 */
    if(!force&&M.gaps.has(s)) return false;
    const rootD=((CV.rootOf(s)%L)+L)%L;
    let deg=rootD;
    if(kind==='fifth') deg=(rootD+step5)%L;
    else if(kind==='third') deg=thirdOf(s);
    else if(kind==='appr') deg=bassApproach(s,CV,L,step5);
    t.seq[s]=nearestRow(B_LO,B_HI,deg,prevRowAt(s),CV.tonesOf(s));
    return true;
  };
  /* --- a) 风格骨架：低音的「语法」（+ 人性化：换音 / 留白 / 抢拍） --- */
  const hum=sk.hum||{sub:.2,drop:.06,push:.1};
  for(let b=0;b*BAR<n;b++){
    for(const [off,kind,pr] of sk.ons){
      let s=b*BAR+off; if(s>=n) break;
      const head=(off===0);
      if(!head&&Math.random()<hum.drop) continue;              // 留白：低音也需要呼吸
      let k2=kind;
      if(!head&&Math.random()<hum.sub)                         // 换音：和弦内另一个音
        k2=(kind==='fifth')?'third':(kind==='third')?'fifth':(Math.random()<.6?'fifth':'third');
      if(!head&&Math.random()<hum.push&&s-1>=0&&s-1>=b*BAR)     // 抢拍：提前一个 1/16
        s-=1;
      if(pr<1&&!head&&Math.random()>pr) continue;
      place(s,k2,head);                // 小节头强制落下（即便旋律在此换气重入）
    }
  }
  /* --- b) 低频合一：底鼓落下的地方低音也落下（鼓与贝斯一起发力） --- */
  for(const k of (M.kick||[])){
    if(k>=n) continue;
    if(Math.random()>sk.kick) continue;
    place(k,'root');
  }
  /* --- c) 长音下方垫根音（旋律拖长时低音给稳定感） --- */
  let run=0;
  for(let s=0;s<=n;s++){
    if(s<n&&M.deg[s]>=0){ run++; continue; }
    if(run>=3){
      for(let k=s-4;k<s;k++){
        if(k<0||k>=n) continue;
        if(k%2===0&&t.seq[k]===-1&&!M.gaps.has(k)){ t.seq[k]=nearestRow(B_LO,B_HI,((CV.rootOf(k)%L)+L)%L,prevRowAt(k),CV.tonesOf(k)); break; }
      }
    }
    run=0;
  }
  /* --- d) 句尾：落在该处和弦的根音上（终止感） --- */
  for(const c of M.cad){
    if(c<n&&t.seq[c]===-1&&!M.gaps.has(c))
      t.seq[c]=nearestRow(B_LO,B_HI,((CV.rootOf(c)%L)+L)%L,prevRowAt(c),CV.tonesOf(c));
  }
  /* 末步兜底：一定落在和弦音上（优先根音） */
  if(!t.seq.some(v=>v>=0)||t.seq[n-1]===-1)
    t.seq[n-1]=nearestRow(B_LO,B_HI,((CV.rootOf(n-1)%L)+L)%L,B_PREF,CV.tonesOf(n-1));
  /* --- e) 收尾闸门：任何一步都不许留下和弦外音（语法 / 引导音 / 兜底的统一保证） --- */
  for(let s=0;s<n;s++){
    const r=t.seq[s]; if(r<0) continue;
    if(CV.ca[s]&&CV.ca[s].has(M.rowDeg(r))) continue;
    t.seq[s]=nearestRow(B_LO,B_HI,((CV.rootOf(s)%L)+L)%L,prevRowAt(s),CV.tonesOf(s));
  }
  /* --- f) 力度层次：小节头最实、底鼓处实、强拍次之、弱拍轻 --- */
  t.vel=new Array(n).fill(null);
  for(let s=0;s<n;s++){
    if(t.seq[s]<0) continue;
    t.vel[s]= (s%BAR===0)?.94 : (M.kick&&M.kick.indexOf(s)>=0)?.9 : (s%4===0)?.86 : .74;
  }
  t.last=t.seq.slice();
}

/* ============ 4. 琶音：织体层（示例曲专用；一键编配自 v3 起不再产出） ============
   注：v3 把编配的织体层换成了「副旋律」（见 4b）——琶音声部与卡片的 ARP 开关
   语义容易互相纠缠（同名不同义），编配不再生成它。本函数保留给示例曲
   seedDefault 与旧存档里的琶音声部使用。
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

/* ============ 4b. 副旋律：对位层 ============
   目标不是「伴奏音型」，而是一条能独立哼出来的第二旋律线（Counter-melody）。
   对位法里最要紧的四条，这里全部落实：

     · 音区在旋律**下方**：行号取「主旋律当前行 + 2~4」（约下方三度到六度）——
       旋律走高副旋律跟着抬，但永远沉在它下面，听感上是「主 + 副」而不是两条
       旋律抢戏。旋律已经压到最低几行（下方没空间）时自动翻到它上方，
       免得钻到贝斯里糊成一团。
     · 反向 / 斜向优先：上一动是上行 → 本音优先下行，反之亦然（对位禁则里最忌
       平行同向）；实在走不动时保持同高度（斜向停留）也完全可用。
     · 让位与接话：旋律在唱（±1 步内有音）时副旋律只肯在隔了 1.5 拍以上的地方
       补一个长音；旋律一旦停顿（连续 ≥1 拍静默）就进来接话——「呼应」由此而来。
       旋律换气后重新起唱的那一步（M.gaps）永远让开。
     · 和弦内音 + 终止感：所有音都取自当前和弦（强拍偏三音 / 五音，根音留给贝斯），
       末步必定落音。另有一条硬禁则：**不与主旋律同度**（同行号重罚、
       同音级轻罚）。

   节奏型来自 CTR_PATS（每半小节换一条），配合上面三条限制，长出的线有起伏、
   有呼吸、也有休止——不是匀速的音型。 */
const CTR_PATS=[
  [1,0,0,1,0,0,1,0],
  [1,0,1,0,0,1,0,0],
  [1,0,1,0,1,0,0,1],
  [1,0,0,1,0,1,0,1],
  [1,0,1,0,1,0,1,0],
];
function fillCounter(t,M,prog){
  const n=stepsOf(t), L=M.L, R_LO=0, R_HI=ROWS-1;
  const CV=chordViewAt(prog,n);
  t.seq=new Array(n).fill(-1);
  /* ---- 主旋律行轮廓：无音步沿用最近的前音（长音延续），开头借用后音 ---- */
  const N=M.N, mr=new Array(N).fill(-1);
  {
    let last=-1;
    for(let s=0;s<N;s++){ const r=(M.row&&M.row[s]>=0)?M.row[s]:-1; if(r>=0) last=r; mr[s]=last; }
    let nxt=-1;
    for(let s=N-1;s>=0;s--){ if(mr[s]<0) mr[s]=nxt; else nxt=mr[s]; }
    for(let s=0;s<N;s++) if(mr[s]<0) mr[s]=ARR_LAYER.ctr.pref;
  }
  const mrAt=s=>mr[clamp(s,0,N-1)];
  /* ---- 忙闲判定 / 静默窗 ---- */
  const near=new Array(N).fill(false);          // ±1 步内有旋律音 = 旋律在唱
  for(let s=0;s<N;s++) if(M.deg[s]>=0){
    for(let k=-1;k<=1;k++){ const q=s+k; if(q>=0&&q<N) near[q]=true; }
  }
  const holes=new Set();                        // 连续 ≥1 拍的静默 = 副旋律的接话位
  { let run=0,st=0;
    for(let s=0;s<=N;s++){
      if(s<N&&M.deg[s]<0){ if(!run) st=s; run++; continue; }
      if(run>=4) for(let k=st;k<st+run;k++) holes.add(k);
      run=0;
    } }
  let prev=-1, prev2=-1;                        // 前两个副旋律音的行号（判反向用）
  /* ---- 音高选取：旋律下方、和弦内、反向优先、不撞同度 ---- */
  const pickRow=(s,strong,tail)=>{
    const rm=mrAt(clamp(s,0,N-1));
    const tones=CV.tonesOf(s)||[CV.rootOf(s)];
    const rootD=((CV.rootOf(s)%L)+L)%L;
    const want=rm+2+((Math.random()*3)|0);      // 目标：旋律下方 2~4 行（三度~六度）
    let lo=clamp(rm+1,R_LO,R_HI), hi=clamp(rm+5,R_LO,R_HI);
    if(hi<=lo){ lo=clamp(rm-4,R_LO,R_HI); hi=clamp(rm-1,R_LO,R_HI); }   // 下方没空间 → 翻到上方
    const pool=[];
    const collect=(a,b)=>{ for(let r=a;r<=b;r++){
      const d=((degOfRow(r)%L)+L)%L;
      if(tones.indexOf(d)>=0&&pool.indexOf(r)<0) pool.push(r); } };
    collect(lo,hi);
    if(!pool.length) collect(R_LO,R_HI);        // 放宽到全键盘（仍限和弦音）
    if(!pool.length) return nearestRow(R_LO,R_HI,rootD,rm+2,tones);
    const dm=((degOfRow(clamp(rm,R_LO,R_HI))%L)+L)%L;
    const third=((rootD+2)%L), fifth=((rootD+M.step5)%L);
    let best=pool[0],bd=1e9;
    for(const r of pool){
      const d=((degOfRow(r)%L)+L)%L;
      let c=Math.abs(r-want)*1.1;
      if(r===rm) c+=5;                          // 与旋律同度：对位最忌
      if(d===dm) c+=2.5;                        // 与旋律同音级（隔八度重合）
      if(prev>=0){
        const jump=Math.abs(r-prev);
        c+= jump<=1?0:(jump<=4?.4:1.6);         // 以级进 / 小跳为主
        if(prev2>=0) c+=((prev<prev2)===(r<prev))?1.8:0;   // 与上一动同向 → 罚（反向免费）
      }
      if(strong||tail) c+=(d===third||d===fifth)?0:(d===rootD?.8:.3);
      if(M.rows&&M.rows.has(r)) c+=.9;          // 与铺底占同一行（隔八度重合）→ 轻罚
      if(c<bd){ bd=c; best=r; }
    }
    return best;
  };
  /* ---- 走位：风格节奏型给候选位，让位 / 接话 / 交错 / 呼吸四条限制决定起不起音 ---- */
  const lib=(SP_.ctrPats&&SP_.ctrPats.length)?SP_.ctrPats:CTR_PATS;
  const pats=arrShuffle(lib).slice(0,2);
  t.vel=new Array(n).fill(null);
  let lastOn=-99, run=0;
  for(let s=0;s<n;s++){
    if(M.gaps.has(s)) continue;                 // 旋律换气后重新起唱：副旋律让开
    const pat=pats[Math.floor(s/(BAR/2))%pats.length]||lib[0];
    if(!pat[s%8]) continue;
    /* 声部交错：贝斯正在这一步发力 → 后移到十六分反拍（小节 / 半小节头除外，
       那些位置本来就该一起砸）。「你进我让」比同刻起音清楚得多。 */
    let cs=s;
    if(M.taken&&M.taken.has(s)&&s%8!==0&&s+1<n&&t.seq[s+1]===-1&&!M.gaps.has(s+1)) cs=s+1;
    if(t.seq[cs]!==-1) continue;
    const sm=clamp(cs,0,N-1);
    /* 旋律在唱 → 只肯隔 3 步以上补一个长音；旋律停顿（holes）→ 自由接话。
       阈值取 3 步（0.75 拍）：再宽下去副旋律会稀疏到几乎听不出是一条线
       （实测 6 步时只剩零星点缀），再紧又会跟主旋律抢拍子。 */
    if(near[sm]&&!holes.has(sm)&&cs-lastOn<3) continue;
    if(run>=3){ run=0; continue; }              // 连续三个音后强制空一拍（留呼吸）
    const r=pickRow(cs,s%4===0,(cs===n-1)||M.cad.indexOf(cs)>=0);
    if(r<0) continue;
    t.seq[cs]=r; prev2=prev; prev=r; lastOn=cs; run++;
    t.vel[cs]= holes.has(sm)?.8:(cs%BAR===0?.82:.68);   // 接话略强、小节头次之、暗位最轻
  }
  /* 末步兜底：一定落音，副旋律才有终止感 */
  if(t.seq[n-1]===-1){ t.seq[n-1]=pickRow(n-1,true,true); t.vel[n-1]=.74; }
  /* ---- 声部交错后处理：与贝斯撞在同一 1/16 上的音就近错开 ----
     小节头除外（那里本来就该一起砸）。优先往「旋律不在唱」的空位挪（后移为主，
     形成「贝斯在前、副旋律在后」的交错织体）；四步内找不到空位就留在原地——
     宁可偶尔撞一下，也不为了错位把线条拆散。 */
  if(M.taken&&M.taken.size){
    const mv=t.seq.slice();
    for(let s=0;s<n;s++){
      if(mv[s]<0||!M.taken.has(s)) continue;
      if(s%BAR===0) continue;                       // 小节头不挪
      let dst=-1;
      const root0=((CV.rootOf(s)%L)+L)%L;
      for(const q of [s+1,s-1,s+2,s-2,s+3]){
        if(q<0||q>=n||mv[q]!==-1||M.gaps.has(q)||M.taken.has(q)) continue;
        /* 只在**同一个和弦段内**错位：否则挪过去的音可能已不属于新和弦
           （实测会让「和弦内音 100%」掉到 98%），宁可留在原地。 */
        if((((CV.rootOf(q)%L)+L)%L)!==root0) continue;
        const sm2=clamp(q,0,N-1);
        if(near[sm2]&&!holes.has(sm2)&&(q-s)>1) continue;    // 旋律在唱时不要挪太远
        dst=q; break;
      }
      if(dst<0) continue;
      mv[dst]=mv[s]; mv[s]=-1;
      if(t.vel){ t.vel[dst]=t.vel[s]; t.vel[s]=null; }
    }
    if(mv[n-1]===-1){ mv[n-1]=pickRow(n-1,true,true); if(t.vel) t.vel[n-1]=.74; }
    t.seq=mv;
  }
  t.last=t.seq.slice();
}

/* ============ 5. 铺底：长音层（风格织体） ============
   只落在和弦骨架音，托住全曲。音域重心居中（ARR_LAYER.pad），
   落在贝斯之上、副旋律之下，形成三层的中间那层。
   v4 起按风格的 pad 织体分化（此前九种风格完全一样）：
     drone 持续长音（氛围 / 国风：段首一个长音，长段中间再叠一次五音）
     hold  段首长音（最稳的通用床）
     swell 稍晚进（Trap：错过拍点半步再进来，避开与贝斯的板正感）
     stab  反拍短音（电子：每拍后半的短音，与贝斯正拍错开，织体「跳」起来）
   力度永远最轻（.52–.62）——铺底是「床」，不该与人争。

   ⚠️ 取音必须是 **register 锚定**（挑「离偏好行最近的可用和弦音」），不能「根音优先」：
   行号与级数是 (7-级数)%L 的映射，同一和弦的根音行完全由级数决定——I 级在第 7 行（最低），
   V 级却只能落在第 2 行（很高）。编配现在还跟着用户的任意和弦轨走，只要进行里多几个
   V / vi / vii，铺底就被整段抬到 2 附近（实测平均行 2.08，跌破「居中」区间），
   听起来是忽高忽低地跳。改成 register 锚定后，任何进行下都稳坐在同一带里，
   同时仍是 100% 和弦内音（就近 voicing、线条不跳，本就是这个声部的正确写法）。 */
function fillPad(t,M,prog){
  const n=stepsOf(t);
  const {lo:P_LO,hi:P_HI,pref:P_PREF}=ARR_LAYER.pad;
  const CV=chordViewAt(prog,n);
  const tiled=progTiled(prog,n);
  const mode=SP_.pad||'hold';
  t.seq=new Array(n).fill(-1);
  /* 段内锚点：段首取重心 P_PREF（不要跨段取「上一个音」——那会让铺底一路往高处
     累积漂移，实测平均行从 5 掉到 2.05，与「居中偏低」的定位不符）。
     hint（可选）＝ 当前织体想要的音级（stab 的根五交替）：同等距离时额外优先它。 */
  const put=(s,pref,hint)=>{
    if(s<0||s>=n||t.seq[s]!==-1) return -1;
    const pf=pref==null?P_PREF:pref, tones=CV.tonesOf(s), rt=CV.rootOf(s);
    const fif=(rt+M.step5)%M.L;
    let best=-1,bs=1e9;
    for(let r=P_LO;r<=P_HI;r++){
      const d=degOfRow(r);                              // 已是 0..L-1
      if(tones.indexOf(d)<0) continue;                  // 只在和弦内音里挑
      let sc=Math.abs(r-pf)*10;                          // 主判据：离偏好行越近越好
      if(d===rt) sc-=1; else if(d===fif) sc-=.5;         // 同等距离时：根音 > 五音（和声清楚）
      if(hint!=null&&d===hint) sc-=1;
      if(sc<bs){ bs=sc; best=r; }
    }
    t.seq[s]=best>=0?best:nearestRow(P_LO,P_HI,rt,pf,tones);
    return t.seq[s];
  };
  let base=0;
  for(const ch of tiled){
    const span=ch.beats*4, ts=ch.tones;
    if(base>=n) break;
    let prev=-1;                                  // 本段内的前一个铺底音（段内连接）
    const seg=(s,hint)=>{ const r=put(s,prev<0?P_PREF:prev,hint); if(r>=0) prev=r; return r; };
    if(ts&&ts.length){
      if(mode==='stab'){
        /* 电子的反拍短音：每拍后半的 8 分位置，根音与五音交替 */
        for(let k=0;k<span;k++){
          const s=base+k; if(s>=n) break;
          if(s%4!==2||M.gaps.has(s)) continue;
          seg(s,(k%8===2)?ch.root:((ch.root+M.step5)%M.L));
        }
      }else{
        const times=(mode==='drone')?1:(span>=12?(Math.random()<.4?2:1):1);
        for(let i=0;i<times;i++){
          let s=base+Math.round(i*span/times);
          if(mode==='swell'&&i===0) s=Math.min(s+1,n-1);
          if(s>=n) break;
          if(M.gaps.has(s)&&s+1<n) s++;
          if(s>=n||M.gaps.has(s)) continue;
          seg(s,(i===0)?ch.root:((ch.root+M.step5)%M.L));
          /* 持续长音：长段中间再叠一次五音（换气感的轻微起伏） */
          if(mode==='drone'&&span>=16&&Math.random()<.5)
            put(Math.min(s+Math.floor(span/2),n-1),null,((ch.root+M.step5)%M.L));
        }
      }
    }
    base+=span;
    if(base>=n) break;
  }
  /* 末步兜底：一定落在和弦骨架音上 */
  if(!t.seq.some(v=>v>=0)||t.seq[n-1]===-1){
    const last=tiled[tiled.length-1]||tiled[0];
    if(last) t.seq[n-1]=nearestRow(P_LO,P_HI,last.root,P_HI,last.tones);
  }
  /* 力度：铺底永远最轻，只在段首（小节头）略抬一点点 */
  t.vel=new Array(n).fill(null);
  for(let s=0;s<n;s++) if(t.seq[s]>=0) t.vel[s]= s%BAR===0?.62:.52;
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
const PAT_ARP =()=>patLib(SP_.arpPats,ARP_PATS);
const PAT_ORD =()=>patLib(SP_.arpOrders,ARP_ORDERS);
function ensureFreeVoice(role,except){
  const usable=x=>x.kind==='inst'&&x!==except;
  const isFree=x=>usable(x)&&!x.seq.some(v=>v>=0);
  /* 复用顺序很关键（v4 调整）：
     ① 先找**同名**声部 → 就地重生成。改了风格再点编配时，旧的「副旋律」会被原地替换，
        而不是「那条留着 + 再新建一条」，声部列表不会攒出两条同名轨；
     ② 再找空闲声部 → 复用（示例曲里那条空着的「琶音器」轨就是这样被用作副旋律的）；
     ③ 都没有就新建一条。 */
  let t=state.tracks.find(x=>usable(x)&&x.name===role.name);
  if(!t) t=state.tracks.find(isFree);
  if(!t&&state.tracks.length<MAX_TRACKS){
    t=makeTrack('inst',role.name,role.inst,role.oct);
    state.tracks.push(t);
  }
  if(!t) t=state.tracks.find(usable);
  if(t){
    recolor(); t.name=role.name; t.inst=role.inst; t.oct=role.oct; t.mute=false; t.solo=false;
    /* 编配产出的是**写死音高的织体线**：如果这条声部原来开着「琶音器」，实际发声
       会被 ARP 引擎接管，编配刚刚写下的音序就白写了（贝斯 / 副旋律 / 铺底同理）。
       复用空闲声部时把 ARP 关掉——配置本身保留，用户想再开随时可以开。 */
    if(t.arp&&t.arp.on) t.arp.on=false;
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
  /* 优先挑「不是琶音器」的声部：开着 ARP 的声部实际音高由引擎实时生成、
     音序只是节奏栅格，拿它当旋律画像会把音域重心和句尾都算歪。
     全站只有琶音器可挑时才退回全部（否则会误报「没有旋律」）。 */
  const plain=insts.filter(t=>!arpOn(t));
  const pool=plain.length?plain:insts;
  return pool.slice().sort((a,b)=>score(b)-score(a)||(barsOf(b)-barsOf(a)))[0];
}
/* ============ 6b. 编配产出的声部清单（v4） ============
   贝斯 + 副旋律（+ 风格需要时的铺底）+ 鼓组。**不再产出琶音器**：
     · 一条声部叫「琶音器」而 ARP 开关是灭的，读起来就是同名不同义
       （示例曲里另有一条真·琶音声部，两处含义不同）；
     · 反过来把编配的织体强行开着 ARP，又等于让 ARP 引擎接管它的音高——
       编配写下的织体线只在关掉 ARP 时才是实际发声，语义绕。
   织体层由「副旋律」承担后，这个权衡就不存在了。
   v4 的生成顺序（顺序本身就是「融合」的一部分）：
     ① 先落鼓  → 拿到底鼓位置，作为低音的对齐基准（低频合一）
     ② 贝斯    → 风格低音语法 + 补在底鼓位 + 登记占用步/行
     ③ 铺底    → 长音床，最轻，登记占用
     ④ 副旋律  → 用风格节奏库，避让贝斯（撞步则后移十六分）与铺底行号
   最后按风格 mix 写三声部音量、按 ARR_PAN 做轻微声像展开。 */
/* 副旋律的通用音色池（风格没给 ctrI 时的兜底）：偏旋律性、能拉长音 */
const CTR_INSTS=['strings','cello','flute','epiano','vibes','musicbox','organ','plucksyn','lead'];
function autoArrange(){
  const mel=pickMelodyTrack();
  if(!mel||!mel.seq.some(v=>v>=0)){ toast('请先在某个声部摆上几个音，再点一键编配'); return; }
  pushUndo();
  /* 和声只读和弦进行轨：编配不改写它（想换和声用和弦卡上的 🎲 / ⤵）。
     progFor() 已是 fitProg 平铺后的结果，逐步取和弦时直接用它。 */
  const prog=progFor();
  const frames=chordFramesAt(prog,stepsOf(mel));
  const M=analyzeMelody(mel,frames);
  /* ① 先鼓：底鼓位置是「低频合一」与声部交错的基准（鼓组也照当前风格选） */
  const d=ensureDrum();
  M.kick=drumSteps(d,'kick');
  M.taken=new Set(); M.rows=new Set();
  /* 副旋律音色：风格池里挑，避开主旋律已经用着的音色（两条线同音色会糊成一条） */
  const ctrPool=(SP_.ctrI&&SP_.ctrI.length?SP_.ctrI:CTR_INSTS).filter(id=>id!==mel.inst);
  const roles=[
    {key:'bass',name:'贝斯',inst:arrPick(SP_.bassI||['bass']),oct:ARR_LAYER.bass.oct,fill:fillBass},
  ];
  /* ② 铺底先于副旋律：让副旋律能避开铺底所占的行 */
  if(SP_.padRole) roles.push({key:'pad',name:'铺底',inst:arrPick(['pad','strings','choir','cello','organ']),oct:ARR_LAYER.pad.oct,fill:fillPad});
  roles.push({key:'ctr',name:'副旋律',inst:arrPick(ctrPool.length?ctrPool:CTR_INSTS),oct:ARR_LAYER.ctr.oct,fill:fillCounter});
  const made=[];
  for(const role of roles){
    const t=ensureFreeVoice(role,mel);
    if(!t) continue;
    role.fill(t,M,prog);                          // 写下织体线：音高全部取自当前和弦
    /* 融合（混音层）：按风格的音量平衡 + 轻微声像展开，而不是全部 .85 / 居中 */
    t.vol=arrMixOf(role.key); t.pan=ARR_PAN[role.key]||0;
    busSync(t);
    markPart(M,t);                                // 登记占用，供后面的声部避让
    made.push({name:t.name,txt:t.name+'('+barsOf(t)+'小节·'+roleGrammar(role.key)+')'});
  }
  const ORDER=['贝斯','副旋律','铺底'];
  made.sort((a,b)=>ORDER.indexOf(a.name)-ORDER.indexOf(b.name));
  renderTracks();
  save();
  const info='分析「'+mel.name+'」：'+M.onset.length+' 个重音 · '+M.cad.length+' 处句尾'
    +' · 和声沿用和弦进行轨（不改写）';
  toast('🎼 '+STYLE().emoji+' '+info+' → '+(made.length?made.map(x=>x.txt).join(' + '):'（无空闲声部）')
    +(d?' + 鼓组('+d.drum+')':'')+' ——再点一次会不同（↶ 可撤销）');
}
