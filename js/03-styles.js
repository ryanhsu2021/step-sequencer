'use strict';
/* ============================================================
   step-sequencer · 03-styles
   音色库 · 音乐风格 · 声部配色
   ============================================================ */
/* ============ 音色库 ============ */
const INSTRUMENTS=[
  {id:'piano',  name:'三角钢琴',   group:'键盘'},
  {id:'epiano', name:'电钢琴',     group:'键盘'},
  {id:'organ',  name:'管风琴',     group:'键盘'},
  {id:'pluck',  name:'竖琴拨弦',   group:'色彩'},
  {id:'guitar', name:'尼龙吉他',   group:'色彩'},
  {id:'bell',   name:'钟琴',       group:'色彩'},
  {id:'marimba',name:'马林巴',     group:'色彩'},
  {id:'strings',name:'弦乐群',     group:'氛围'},
  {id:'pad',    name:'合成铺底',   group:'氛围'},
  {id:'lead',   name:'合成主音',   group:'合成'},
  {id:'bass',   name:'电贝斯',     group:'低音'},
  {id:'subbass',name:'合成低音',   group:'低音'},
];
const INST_NAME=id=>(INSTRUMENTS.find(i=>i.id===id)||{}).name||id;

/* ============ 音乐风格：驱动「优化旋律」「一键编配」「鼓组」的生成取向 ============
   density  目标音数区间（16 步内的音符个数）
   center/range/peak  旋律音域的基准行、跨度、拱形峰值位置
   step/leap  级进偏好（越大越爱走音阶）/ 跳进容忍度（越大越敢大跳）
   run      长连音的宽松度（<1 允许长音，>1 偏好短音）
   rest     留白偏好（越大越爱空拍）
   maskDens 随机节奏候选的密度基准
   prog     该风格常用的和声进行（音阶级数，每小节一个）
   seventh  是否使用七和弦色彩        chBias  强拍和弦音权重
   bassPats/arpPats/arpOrders  低音与和弦音型的节奏库
   padRole  编配时是否额外加一条铺底声部
   drums    该风格推荐的鼓组预设（卡片上会置顶标 ★）
*/
const STYLES=[
{id:'ambient',name:'氛围 Ambient',emoji:'🌫️',bpm:[62,84],swing:0,
 desc:'慢速空灵 · 稀疏长音 · 铺底与钟琴',
 density:[6,8],center:4.3,range:1.9,peak:.45,step:1.3,leap:.55,run:.5,rest:1.25,maskDens:.3,chBias:1.05,seventh:false,
 prog:[[0,4],[0,3],[0,5],[5,3],[1,3],[0,4,5,3]],
 masks:[[1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,1],
        [1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1]],
 mel:['pad','bell','strings','marimba','epiano'],bassI:['subbass','bass'],chordI:['marimba','pluck','bell'],
 bassPats:[{0:0,6:'f'},{0:0,4:0},{0:0,3:0},{0:0}],
 arpPats:[[1,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,0],[1,0,1,0,0,0,0,0]],
 arpOrders:[[0,1,2],[0,2,1],[1,0,2]],padRole:true,drums:['ambient','ballad','folk','bossa']},

{id:'pop',name:'流行 Pop',emoji:'🎧',bpm:[96,124],swing:0,
 desc:'抓耳主线 · 规整八拍 · 电钢与拨弦',
 density:[9,11],center:4.0,range:2.3,peak:.4,step:1.05,leap:.95,run:1,rest:1,maskDens:.5,chBias:1,seventh:false,
 prog:[[0,4],[0,5],[0,3],[5,3,4,0],[0,4,5,3]],
 mel:['epiano','piano','pluck','marimba','bell'],bassI:['bass','subbass'],chordI:['epiano','pluck','marimba'],
 bassPats:[{0:0,3:0,6:'f'},{0:0,4:0,6:'f'},{0:0,2:0,4:0,6:'f'},{0:0,3:'f',6:0}],
 arpPats:[[1,0,1,0,1,1,0,1],[1,0,1,0,1,0,1,0],[1,1,0,1,0,1,1,0],[1,0,0,1,0,1,0,1]],
 arpOrders:[[0,1,2],[2,1,0],[0,1,2,1],[1,2,0]],padRole:false,drums:['pop','four','folk']},

{id:'electronic',name:'电子 Electronic',emoji:'⚡',bpm:[120,134],swing:0,
 desc:'四踩律动 · 十六分琶音 · 合成主音',
 density:[12,14],center:4.2,range:2.1,peak:.35,step:.9,leap:1.15,run:1.4,rest:.8,maskDens:.62,chBias:1,
 prog:[[0,5],[0,6],[0,5,3,4],[0,4],[3,4,5,4]],
 masks:[[1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,1],[1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1]],
 mel:['lead','pluck','epiano','bell','pad'],bassI:['subbass','bass'],chordI:['pluck','epiano','lead'],
 bassPats:[{0:0,2:0,4:0,6:0},{0:0,3:0,6:0},{0:0,1:0,2:0,4:0,6:0},{0:0,2:'f',4:0,6:'t'}],
 arpPats:[[1,1,1,1,1,1,1,1],[1,0,1,1,1,0,1,1],[1,1,0,1,1,1,0,1],[1,0,1,0,1,0,1,0]],
 arpOrders:[[0,1,2],[0,1,2,1],[2,1,0],[0,2,1],[1,2,0]],padRole:true,drums:['edm','four','trap']},

{id:'rock',name:'摇滚 Rock',emoji:'🎸',bpm:[112,144],swing:0,
 desc:'推进式律动 · 切分 riff · 失真吉他感',
 density:[10,12],center:3.9,range:2.2,peak:.35,step:.95,leap:1.2,run:1.15,rest:.9,maskDens:.55,chBias:1.05,
 prog:[[0,6],[0,3],[0,4,6,4],[0,4]],
 mel:['guitar','organ','lead','piano'],bassI:['bass'],chordI:['guitar','organ','pluck'],
 bassPats:[{0:0,2:0,3:0,6:0},{0:0,3:0,5:'f',6:0},{0:0,2:0,4:0,6:0}],
 arpPats:[[1,1,0,1,1,0,1,1],[1,0,1,0,1,1,0,1],[1,1,1,1,1,1,1,1]],
 arpOrders:[[0,1,2],[0,0,1],[2,1,0],[0,2,1]],padRole:false,drums:['rock','pop','four']},

{id:'hiphop',name:'嘻哈 Hip-Hop',emoji:'🎤',bpm:[78,98],swing:22,
 desc:'半速鼓点 · 松弛切分 · 电钢与低音',
 density:[8,10],center:3.9,range:2.2,peak:.4,step:1.15,leap:1,run:1.05,rest:1.2,maskDens:.45,chBias:1,seventh:true,
 prog:[[0,3],[0,5],[1,4],[0,4]],
 mel:['epiano','pluck','marimba','piano'],bassI:['subbass','bass'],chordI:['epiano','marimba','pad'],
 bassPats:[{0:0,3:0,6:0},{0:0,2:0,6:'f'},{0:0,4:0},{0:0,1:0,3:0,6:0}],
 arpPats:[[1,0,0,1,0,1,1,0],[1,0,1,0,0,1,0,1],[1,1,0,0,1,0,1,0]],
 arpOrders:[[0,1,2],[1,2,0],[0,2,1]],padRole:false,drums:['half','bossa','trap']},

{id:'trap',name:'Trap',emoji:'🔻',bpm:[128,150],swing:0,
 desc:'滑音 808 · 十六分镲片 · 冷冽短音',
 density:[9,11],center:4.1,range:2,peak:.35,step:1,leap:1.1,run:1.3,rest:1.1,maskDens:.6,chBias:1,seventh:false,
 prog:[[0,3],[0,5],[0,6],[1,0]],
 mel:['bell','lead','marimba','pluck','epiano'],bassI:['subbass'],chordI:['pluck','bell','marimba'],
 bassPats:[{0:0,6:0},{0:0,3:0},{0:0,5:0,6:0}],
 arpPats:[[1,0,0,1,0,1,0,0],[1,0,1,0,0,0,1,0],[1,0,0,0,1,0,0,0]],
 arpOrders:[[0,1,2],[2,1,0],[0,2,1]],padRole:true,drums:['trap','half','edm']},

{id:'jazz',name:'爵士 Jazz',emoji:'🎷',bpm:[96,136],swing:58,
 desc:'摇摆律动 · 七和弦色彩 · 走动低音',
 density:[10,12],center:4.1,range:2.4,peak:.42,step:1.1,leap:1.1,run:.9,rest:.85,maskDens:.55,chBias:.85,seventh:true,
 prog:[[0,3],[0,4],[1,4],[0,5],[3,4]],
 masks:[[1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1]],
 mel:['epiano','piano','bell','marimba'],bassI:['bass'],chordI:['epiano','piano','pluck'],
 bassPats:[{0:0,2:0,4:0,6:0},{0:0,2:'f',3:0,5:'t',6:0},{0:0,3:0,5:0,6:0},{0:0,1:0,3:0,4:0,6:0}],
 arpPats:[[1,0,1,1,0,1,1,0],[1,0,1,0,1,1,0,1],[1,0,0,1,0,1,0,1]],
 arpOrders:[[0,1,2],[1,2,0],[0,2,1],[2,1,0]],padRole:false,drums:['jazz','bossa','ballad']},

{id:'folk',name:'民谣 Folk',emoji:'🌾',bpm:[86,116],swing:0,
 desc:'分解和弦 · 温和级进 · 尼龙吉他',
 density:[9,11],center:4,range:2.2,peak:.42,step:1.1,leap:.85,run:1,rest:1,maskDens:.5,chBias:1,seventh:false,
 prog:[[0,4],[0,5],[0,3],[5,3,4,0]],
 mel:['guitar','pluck','piano','marimba'],bassI:['bass'],chordI:['guitar','pluck','marimba'],
 bassPats:[{0:0,2:0,4:0,6:0},{0:0,3:0,6:0},{0:0,4:0}],
 arpPats:[[1,0,1,0,1,1,0,1],[1,1,0,1,0,1,1,0],[1,0,1,1,0,1,0,1]],
 arpOrders:[[0,1,2],[0,1,2,1],[1,2,0]],padRole:false,drums:['folk','bossa','pop']},

{id:'guofeng',name:'国风 Guofeng',emoji:'🏮',bpm:[74,102],swing:0,
 desc:'五声骨架 · 留白呼吸 · 拨弦与钟磬',
 density:[7,9],center:4.2,range:2,peak:.45,step:1.25,leap:.8,run:.7,rest:1.15,maskDens:.38,chBias:1.05,seventh:false,
 prog:[[0,3],[0,4],[0,5],[5,3]],
 masks:[[1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1],[1,0,0,1,0,0,0,0,1,0,0,0,1,0,0,1]],
 mel:['pluck','bell','marimba','organ'],bassI:['bass','subbass'],chordI:['pluck','bell','marimba'],
 bassPats:[{0:0,6:0},{0:0,3:0},{0:0,4:0}],
 arpPats:[[1,0,0,1,0,0,1,0],[1,0,1,0,0,1,0,0],[1,0,0,0,1,0,0,0]],
 arpOrders:[[0,1,2],[2,1,0],[0,2,1]],padRole:true,drums:['folk','ambient','bossa']},
];
let styleIdx=0;
const STYLE_BY_ID=id=>STYLES.find(s=>s.id===id)||STYLES[0];
const STYLE=()=>STYLES[styleIdx]||STYLES[0];
/* 归一化后的风格参数：算法统一读 SP_，缺省值 = 上一版通用手感的等价参数 */
function styleParams(s){
  return {
    name:s.name, emoji:s.emoji, density:s.density||[10,12],
    center:s.center==null?4:s.center, range:s.range==null?2.45:s.range, peak:s.peak==null?.4:s.peak,
    step:s.step==null?1:s.step, leap:s.leap==null?1:s.leap,
    run:s.run==null?1:s.run, rest:s.rest==null?1:s.rest,
    maskDens:s.maskDens==null?.5:s.maskDens, chBias:s.chBias==null?1:s.chBias, seventh:!!s.seventh,
    prog:s.prog||null, masks:s.masks||[],
    bassPats:s.bassPats||null, arpPats:s.arpPats||null, arpOrders:s.arpOrders||null,
    mel:s.mel||null, bassI:s.bassI||null, chordI:s.chordI||null, padRole:!!s.padRole, drums:s.drums||null,
  };
}
let SP_=styleParams(STYLES[0]);
function setStyle(i,quiet){
  styleIdx=clamp(i|0,0,STYLES.length-1);
  SP_=styleParams(STYLES[styleIdx]);
  if(!quiet){
    const s=STYLE(), note=[];
    if(s.bpm&&(bpm<s.bpm[0]||bpm>s.bpm[1])){ bpm=clamp(bpm,s.bpm[0],s.bpm[1]); note.push('BPM '+bpm); }
    const sw=s.swing||0;
    if(sw!==swingPct){ swingPct=sw; note.push('摇摆 '+swingPct+'%'); }
    toast(s.emoji+' 风格：'+s.name+(note.length?'（已同步 '+note.join(' / ')+'）':'')+' · 优化与编配都会照它生成');
  }
}

/* 参考配色：高饱和马卡龙色块（bg=卡片底，deep=激活深色，ink=卡片上文字色） */
const TRACK_COLORS=[
  {bg:'#cbb6f7',deep:'#5b3fd0',ink:'#191322'},   /* 紫 */
  {bg:'#def363',deep:'#5a6a08',ink:'#181b04'},   /* 柠檬 */
  {bg:'#4c53e5',deep:'#181d78',ink:'#ffffff'},   /* 宝蓝 */
  {bg:'#f4602c',deep:'#8e2a0c',ink:'#ffffff'},   /* 橘 */
  {bg:'#f9c9dc',deep:'#d64b78',ink:'#241019'},   /* 粉 */
  {bg:'#9fe0d3',deep:'#12796a',ink:'#0e211d'},   /* 薄荷 */
];

