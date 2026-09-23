'use strict';
/* ============================================================
   step-sequencer · 03-styles
   音色库 · 音乐风格 · 声部配色
   ============================================================ */
/* ============ 音色库 ============
   分组按制作习惯排：下拉框的 optgroup 顺序与这里一致。
   精选原则（实用性优先）：
     · 删掉了合成味太假且低频使用的「芯片音 chip」
     · 薄弱实现全部重做（organ 饱满拉杆 / brass 滤波吹开 / acid 303 扫频 / lead 颤音衬底）
     · 新增高频实用音色：清音电吉他 / 失真吉他 / 大提琴 / 超锯 / 合成拨弦 */
const INSTRUMENTS=[
  {id:'piano',  name:'三角钢琴',   group:'键盘'},
  {id:'epiano', name:'电钢琴',     group:'键盘'},
  {id:'organ',  name:'管风琴',     group:'键盘'},
  {id:'retrokeys',name:'复古合成键',group:'键盘'},
  {id:'guitar', name:'尼龙吉他',   group:'吉他'},
  {id:'eguitar',name:'清音电吉他', group:'吉他'},
  {id:'dist',   name:'失真吉他',   group:'吉他'},
  {id:'bass',   name:'电贝斯',     group:'贝斯'},
  {id:'subbass',name:'合成低音',   group:'贝斯'},
  {id:'acid',   name:'酸性贝斯',   group:'贝斯'},
  {id:'analogbass',name:'模拟低音',group:'贝斯'},
  {id:'pluck',  name:'竖琴拨弦',   group:'拨弦·敲击'},
  {id:'marimba',name:'马林巴',     group:'拨弦·敲击'},
  {id:'bell',   name:'钟琴',       group:'拨弦·敲击'},
  {id:'vibes',  name:'电颤琴',     group:'拨弦·敲击'},
  {id:'musicbox',name:'音乐盒',    group:'拨弦·敲击'},
  {id:'plucksyn',name:'合成拨弦',  group:'拨弦·敲击'},
  {id:'strings',name:'弦乐群',     group:'氛围'},
  {id:'cello',  name:'大提琴',     group:'氛围'},
  {id:'ensemble',name:'模拟合奏',  group:'氛围'},
  {id:'pad',    name:'合成铺底',   group:'氛围'},
  {id:'choir',  name:'人声合唱',   group:'氛围'},
  {id:'flute',  name:'长笛',       group:'氛围'},
  {id:'lead',   name:'合成主音',   group:'合成'},
  {id:'supersaw',name:'超锯合成',  group:'合成'},
  {id:'pwmlead',name:'PWM 主音',   group:'合成'},
  {id:'brass',  name:'合成铜管',   group:'合成'},
  {id:'koto',   name:'古筝',       group:'民族'},
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
   arpPats/arpOrders  和弦音型的节奏库（供示例曲的琶音声部使用）
   ctrI     一键编配生成「副旋律」声部时的音色池（旋律性音色，会避开主旋律已用的那个）
   bass     一键编配的低音语法（见 42-arrange 的 BASS_SKEL）：
              long 长音铺底 / root5 根-五交替 / eighth 八分推进 / offbeat 反拍 /
              drive 八分驱动 / boom 稀疏散点 / slide 808 长音 / walk 走动低音
   ctrPats  一键编配「副旋律」的节奏库（8 步半小节的起音掩码，每半小节换一条）
   pad      铺底织体：drone 持续长音 / hold 段首长音 / swell 稍晚进 / stab 反拍短音
   mix      三声部音量平衡 [贝斯, 副旋律, 铺底]（0–1，决定「谁在前谁在后」）
   padRole  编配时是否额外加一条铺底声部
   drums    该风格推荐的鼓组预设（卡片上会置顶标 ★）
*/
const STYLES=[
{id:'ambient',name:'氛围 Ambient',emoji:'🌫️',bpm:[62,84],swing:0,
 desc:'慢速空灵 · 稀疏长音 · 铺底与钟琴',
 density:[6,8],center:4.3,range:1.9,peak:.45,step:1.3,leap:.55,run:.5,rest:1.25,maskDens:.3,chBias:1.05,seventh:false,
 prog:[[0,4],[0,3],[0,5],[5,3],[0,4,5,3],[0,5,3,4],[0,3,0,5]],
 masks:[[1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,1],
        [1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,1],
        [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,1]],
 mel:['pad','bell','strings','ensemble','marimba','epiano'],bassI:['subbass','bass'],chordI:['marimba','pluck','bell'],
 arpPats:[[1,0,0,0,0,0,1,0],[1,0,0,0,0,0,0,0],[1,0,1,0,0,0,0,0]],
arpOrders:[[0,1,2],[0,2,1],[1,0,2]],padRole:true,drums:['ambient','ballad','folk','bossa'],
ctrI:['strings','cello','choir','musicbox','flute'],
bass:'long',pad:'drone',mix:[.82,.78,.6],
ctrPats:[[1,0,0,0,0,0,0,0],[1,0,0,0,1,0,0,0],[1,0,0,0,0,0,0,1]]},

{id:'pop',name:'流行 Pop',emoji:'🎧',bpm:[96,124],swing:0,
 desc:'抓耳主线 · 规整八拍 · 电钢与拨弦',
 density:[9,11],center:4.0,range:2.3,peak:.4,step:1.05,leap:.95,run:1,rest:1,maskDens:.5,chBias:1,seventh:false,
 prog:[[0,4],[0,5],[0,3],[5,3,4,0],[0,4,5,3],[5,3,0,4],[3,4,2,5],[0,3,5,4]],
 mel:['epiano','piano','pluck','eguitar','marimba'],bassI:['bass','subbass'],chordI:['epiano','pluck','marimba'],
 arpPats:[[1,0,1,0,1,1,0,1],[1,0,1,0,1,0,1,0],[1,1,0,1,0,1,1,0],[1,0,0,1,0,1,0,1]],
arpOrders:[[0,1,2],[2,1,0],[0,1,2,1],[1,2,0]],padRole:false,drums:['pop','four','folk'],
ctrI:['strings','epiano','pluck','vibes','flute'],
bass:'eighth',pad:'hold',mix:[.86,.8,.56],
ctrPats:[[1,0,0,1,0,0,1,0],[1,0,1,0,0,0,1,0],[1,0,0,0,1,0,0,1]]},

{id:'electronic',name:'电子 Electronic',emoji:'⚡',bpm:[120,134],swing:0,
 desc:'四踩律动 · 十六分琶音 · 合成主音',
 density:[12,14],center:4.2,range:2.1,peak:.35,step:.9,leap:1.15,run:1.4,rest:.8,maskDens:.62,chBias:1,
 prog:[[0,5],[0,6],[0,5,3,4],[0,4],[3,4,5,4],[0,5,6,0],[5,3,0,4]],
 masks:[[1,1,0,1,1,0,1,1,1,0,1,1,0,1,1,1],[1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1]],
 mel:['lead','supersaw','pwmlead','pluck','epiano','bell'],bassI:['analogbass','subbass','acid','bass'],chordI:['pluck','plucksyn','epiano','lead'],
 arpPats:[[1,1,1,1,1,1,1,1],[1,0,1,1,1,0,1,1],[1,1,0,1,1,1,0,1],[1,0,1,0,1,0,1,0]],
arpOrders:[[0,1,2],[0,1,2,1],[2,1,0],[0,2,1],[1,2,0]],padRole:true,drums:['edm','four','trap'],
ctrI:['lead','supersaw','pwmlead','pluck','brass'],
bass:'offbeat',pad:'stab',mix:[.9,.76,.56],
ctrPats:[[1,0,1,0,1,0,1,0],[1,1,0,1,0,1,1,0],[1,0,1,1,0,1,0,1]]},

{id:'rock',name:'摇滚 Rock',emoji:'🎸',bpm:[112,144],swing:0,
 desc:'推进式律动 · 切分 riff · 失真吉他感',
 density:[10,12],center:3.9,range:2.2,peak:.35,step:.95,leap:1.2,run:1.15,rest:.9,maskDens:.55,chBias:1.05,
 prog:[[0,6],[0,3],[0,4,6,4],[0,4],[0,6,3,4],[0,6,0,3]],
 mel:['guitar','eguitar','dist','organ','lead'],bassI:['bass','acid'],chordI:['eguitar','organ','pluck'],
 arpPats:[[1,1,0,1,1,0,1,1],[1,0,1,0,1,1,0,1],[1,1,1,1,1,1,1,1]],
arpOrders:[[0,1,2],[0,0,1],[2,1,0],[0,2,1]],padRole:false,drums:['rock','pop','four'],
ctrI:['organ','eguitar','strings','brass','lead'],
bass:'drive',pad:'hold',mix:[.88,.8,.6],
ctrPats:[[1,0,1,0,0,1,0,0],[1,0,0,1,0,0,1,0],[1,1,0,0,1,0,0,0]]},

{id:'hiphop',name:'嘻哈 Hip-Hop',emoji:'🎤',bpm:[78,98],swing:22,
 desc:'半速鼓点 · 松弛切分 · 电钢与低音',
 density:[8,10],center:3.9,range:2.2,peak:.4,step:1.15,leap:1,run:1.05,rest:1.2,maskDens:.45,chBias:1,seventh:true,
 prog:[[0,3],[0,5],[1,4,0],[0,4],[0,5,2,6],[0,3,5,4]],
 mel:['epiano','retrokeys','pluck','marimba','piano'],bassI:['analogbass','subbass','bass'],chordI:['epiano','marimba','pad'],
 arpPats:[[1,0,0,1,0,1,1,0],[1,0,1,0,0,1,0,1],[1,1,0,0,1,0,1,0]],
arpOrders:[[0,1,2],[1,2,0],[0,2,1]],padRole:false,drums:['half','bossa','trap'],
ctrI:['epiano','retrokeys','vibes','organ','musicbox'],
bass:'boom',pad:'hold',mix:[.9,.78,.58],
ctrPats:[[1,0,0,0,1,0,0,0],[1,0,0,1,0,0,0,0],[1,0,0,0,0,0,1,0]]},

{id:'trap',name:'Trap',emoji:'🔻',bpm:[128,150],swing:0,
 desc:'滑音 808 · 十六分镲片 · 冷冽短音',
 density:[9,11],center:4.1,range:2,peak:.35,step:1,leap:1.1,run:1.3,rest:1.1,maskDens:.6,chBias:1,seventh:false,
 prog:[[0,3],[0,5],[0,6],[0,5,6,0],[0,3,6,0],[0,5,2,6]],
 mel:['bell','lead','pwmlead','pluck','marimba','epiano'],bassI:['analogbass','subbass','acid'],chordI:['pluck','bell','marimba'],
 arpPats:[[1,0,0,1,0,1,0,0],[1,0,1,0,0,0,1,0],[1,0,0,0,1,0,0,0]],
arpOrders:[[0,1,2],[2,1,0],[0,2,1]],padRole:true,drums:['trap','half','edm'],
ctrI:['bell','vibes','musicbox','pluck','pwmlead'],
bass:'slide',pad:'swell',mix:[.92,.76,.6],
ctrPats:[[1,0,0,0,0,0,0,0],[1,0,0,0,1,0,0,0],[1,0,0,1,0,0,0,1]]},

{id:'jazz',name:'爵士 Jazz',emoji:'🎷',bpm:[96,136],swing:58,
 desc:'摇摆律动 · 七和弦色彩 · 走动低音',
 density:[10,12],center:4.1,range:2.4,peak:.42,step:1.1,leap:1.1,run:.9,rest:.85,maskDens:.55,chBias:.85,seventh:true,
 prog:[[0,3],[0,4],[1,4,0],[0,5],[0,5,1,4],[2,5,1,4]],
 masks:[[1,0,1,1,0,1,1,0,1,0,1,1,0,1,0,1]],
 mel:['epiano','piano','bell','marimba'],bassI:['bass'],chordI:['epiano','piano','pluck'],
 arpPats:[[1,0,1,1,0,1,1,0],[1,0,1,0,1,1,0,1],[1,0,0,1,0,1,0,1]],
arpOrders:[[0,1,2],[1,2,0],[0,2,1],[2,1,0]],padRole:false,drums:['jazz','bossa','ballad'],
ctrI:['epiano','vibes','organ','cello','flute','marimba'],
bass:'walk',pad:'hold',mix:[.84,.8,.6],
ctrPats:[[1,0,1,1,0,1,1,0],[1,0,1,0,1,1,0,1],[1,1,0,1,1,0,1,0]]},

{id:'folk',name:'民谣 Folk',emoji:'🌾',bpm:[86,116],swing:0,
 desc:'分解和弦 · 温和级进 · 尼龙吉他',
 density:[9,11],center:4,range:2.2,peak:.42,step:1.1,leap:.85,run:1,rest:1,maskDens:.5,chBias:1,seventh:false,
 prog:[[0,4],[0,5],[0,3],[5,3,4,0],[0,3,4,0],[0,5,3,4],[5,3,0,4]],
 mel:['guitar','pluck','piano','marimba'],bassI:['bass'],chordI:['guitar','pluck','marimba'],
 arpPats:[[1,0,1,0,1,1,0,1],[1,1,0,1,0,1,1,0],[1,0,1,1,0,1,0,1]],
arpOrders:[[0,1,2],[0,1,2,1],[1,2,0]],padRole:false,drums:['folk','bossa','pop'],
ctrI:['pluck','guitar','flute','strings','musicbox'],
bass:'root5',pad:'hold',mix:[.84,.8,.56],
ctrPats:[[1,0,1,0,1,0,1,0],[1,0,0,1,0,1,0,0],[1,0,1,0,0,1,0,0]]},

{id:'guofeng',name:'国风 Guofeng',emoji:'🏮',bpm:[74,102],swing:0,
 desc:'五声骨架 · 留白呼吸 · 拨弦与钟磬',
 density:[7,9],center:4.2,range:2,peak:.45,step:1.25,leap:.8,run:.7,rest:1.15,maskDens:.38,chBias:1.05,seventh:false,
 prog:[[0,3],[0,4],[0,5],[5,3],[0,3,4,0],[0,4,3,0]],
 masks:[[1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1],[1,0,0,1,0,0,0,0,1,0,0,0,1,0,0,1]],
 mel:['koto','pluck','bell','marimba'],bassI:['bass','subbass'],chordI:['koto','pluck','bell','marimba'],
 arpPats:[[1,0,0,1,0,0,1,0],[1,0,1,0,0,1,0,0],[1,0,0,0,1,0,0,0]],
arpOrders:[[0,1,2],[2,1,0],[0,2,1]],padRole:true,drums:['folk','ambient','bossa'],
ctrI:['koto','flute','pluck','marimba','musicbox'],
bass:'root5',pad:'drone',mix:[.82,.78,.6],
ctrPats:[[1,0,0,0,0,0,1,0],[1,0,0,0,1,0,0,0],[1,0,0,1,0,0,0,0]]},
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
    arpPats:s.arpPats||null, arpOrders:s.arpOrders||null,
    mel:s.mel||null, bassI:s.bassI||null, chordI:s.chordI||null, padRole:!!s.padRole, drums:s.drums||null,
    ctrI:s.ctrI||null,
    bass:s.bass||'eighth', pad:s.pad||'hold', ctrPats:s.ctrPats||null, mix:s.mix||null,
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

/* ============ 全局 UI 配色主题 ============
   vars 整组覆盖 css/style.css :root 里的同名衍生变量（必须给全，切回来才干净）；
   tracks 是六个声部的循环配色（bg=卡片底 · deep=激活音块 · ink=卡上文字）。
   setTheme() 把 vars 逐条写到 documentElement，并把 TRACK_COLORS 指向该主题的
   声部色，再由 recolor() 落到每条声部（mixer 色带等随 renderTracks 刷新）。 */
const UI_THEMES=[
  {id:'cream',name:'奶油马卡龙',emoji:'🍦',vars:{
    '--bg':'#f1f0ec','--card':'#ffffff','--ink':'#141414','--on-ink':'#fff',
    '--text':'#141414','--muted':'#75726b','--dim':'#a29f97','--line':'#e5e3dc','--soft':'#e9e7e1',
    '--ctl-bd':'rgba(20,20,20,.22)','--ctl-hv':'rgba(20,20,20,.07)','--ctl-line':'rgba(20,20,20,.16)',
    '--selbg':'rgba(255,255,255,.88)','--chip-hv':'rgba(255,255,255,.75)',
    '--cell':'rgba(255,255,255,.42)','--cell-mid':'rgba(255,255,255,.6)','--cell-hv':'rgba(255,255,255,.95)','--cell-line':'rgba(20,20,20,.08)',
    '--bar-btm':'rgba(241,240,236,.72)',
    '--glow1':'rgba(244,96,44,.055)','--glow2':'rgba(60,157,232,.05)',
  },tracks:[
    {bg:'#cbb6f7',deep:'#5b3fd0',ink:'#191322'},   /* 紫 */
    {bg:'#def363',deep:'#5a6a08',ink:'#181b04'},   /* 柠檬 */
    {bg:'#4c53e5',deep:'#181d78',ink:'#ffffff'},   /* 宝蓝 */
    {bg:'#f4602c',deep:'#8e2a0c',ink:'#ffffff'},   /* 橘 */
    {bg:'#f9c9dc',deep:'#d64b78',ink:'#241019'},   /* 粉 */
    {bg:'#9fe0d3',deep:'#12796a',ink:'#0e211d'},   /* 薄荷 */
  ]},
  {id:'neon',name:'赛博霓虹',emoji:'🌃',vars:{
    '--bg':'#0a0d22','--card':'#141833','--ink':'#e8ecff','--on-ink':'#0a0d22',
    '--text':'#dde2f7','--muted':'#8f96bf','--dim':'#5d648e','--line':'#252b52','--soft':'#1b2140',
    '--ctl-bd':'rgba(210,220,255,.30)','--ctl-hv':'rgba(140,160,255,.12)','--ctl-line':'rgba(210,220,255,.18)',
    '--selbg':'rgba(30,36,70,.85)','--chip-hv':'rgba(140,160,255,.25)',
    '--cell':'rgba(120,150,255,.10)','--cell-mid':'rgba(120,150,255,.16)','--cell-hv':'rgba(160,190,255,.30)','--cell-line':'rgba(160,190,255,.14)',
    '--bar-btm':'rgba(10,13,34,.72)',
    '--glow1':'rgba(34,211,238,.10)','--glow2':'rgba(217,70,239,.12)',
  },tracks:[
    {bg:'#10173d',deep:'#33d6ff',ink:'#d8f6ff'},   /* 深蓝卡 · 霓虹青音块 */
    {bg:'#22d3e0',deep:'#076e7a',ink:'#02282c'},   /* 亮青 */
    {bg:'#1c2fc4',deep:'#0a1256',ink:'#dfe7ff'},   /* 电光蓝 */
    {bg:'#ff4433',deep:'#8c1005',ink:'#ffe6df'},   /* 霓虹红 */
    {bg:'#a83bf0',deep:'#4b0b7d',ink:'#f8e6ff'},   /* 品红紫 */
    {bg:'#2bd9b4',deep:'#0b6f5b',ink:'#03322a'},   /* 荧光薄荷 */
  ]},
  {id:'haze',name:'淡雾蓝',emoji:'🌫️',vars:{
    '--bg':'#edeff5','--card':'#ffffff','--ink':'#1b2130','--on-ink':'#fff',
    '--text':'#242a3a','--muted':'#6d7488','--dim':'#9ba1b3','--line':'#dfe2ec','--soft':'#e9ebf3',
    '--ctl-bd':'rgba(27,33,48,.22)','--ctl-hv':'rgba(27,33,48,.06)','--ctl-line':'rgba(27,33,48,.15)',
    '--selbg':'rgba(255,255,255,.88)','--chip-hv':'rgba(255,255,255,.8)',
    '--cell':'rgba(255,255,255,.55)','--cell-mid':'rgba(255,255,255,.72)','--cell-hv':'#ffffff','--cell-line':'rgba(27,33,48,.07)',
    '--bar-btm':'rgba(237,239,245,.72)',
    '--glow1':'rgba(99,102,241,.06)','--glow2':'rgba(14,165,233,.06)',
  },tracks:[
    {bg:'#c8cef6',deep:'#4753b5',ink:'#151a36'},   /* 雾蓝紫 */
    {bg:'#a8cdb6',deep:'#4d7a5e',ink:'#112418'},   /* 灰绿 */
    {bg:'#7189ad',deep:'#2b3f62',ink:'#ffffff'},   /* 灰蓝 */
    {bg:'#e08a60',deep:'#96431c',ink:'#ffffff'},   /* 陶土橘 */
    {bg:'#f0c8d3',deep:'#ad6379',ink:'#381320'},   /* 藕粉 */
    {bg:'#b7dcd1',deep:'#528e7d',ink:'#0f2f29'},   /* 雾薄荷 */
  ]},
  {id:'midnight',name:'午夜紫',emoji:'🌌',vars:{
    '--bg':'#141118','--card':'#1e1a26','--ink':'#f0eaf8','--on-ink':'#141118',
    '--text':'#e4def0','--muted':'#9c93ae','--dim':'#675e7c','--line':'#2f2939','--soft':'#252031',
    '--ctl-bd':'rgba(230,220,250,.26)','--ctl-hv':'rgba(200,160,255,.10)','--ctl-line':'rgba(230,220,250,.16)',
    '--selbg':'rgba(38,32,50,.85)','--chip-hv':'rgba(200,160,255,.22)',
    '--cell':'rgba(200,170,255,.08)','--cell-mid':'rgba(200,170,255,.13)','--cell-hv':'rgba(220,190,255,.28)','--cell-line':'rgba(200,170,255,.12)',
    '--bar-btm':'rgba(20,17,24,.72)',
    '--glow1':'rgba(168,85,247,.14)','--glow2':'rgba(59,130,246,.09)',
  },tracks:[
    {bg:'#262032',deep:'#a78bfa',ink:'#efe9ff'},   /* 暗卡 · 柔紫音块 */
    {bg:'#b7bac2',deep:'#43474f',ink:'#0f1013'},   /* 银灰 */
    {bg:'#1a2445',deep:'#0b1330',ink:'#d5ddfa'},   /* 暗夜蓝 */
    {bg:'#7c1330',deep:'#3f0715',ink:'#ffd9e2'},   /* 深绯红 */
    {bg:'#a12e81',deep:'#4e0d3b',ink:'#ffe4f4'},   /* 洋红 */
    {bg:'#123540',deep:'#071e26',ink:'#cceef4'},   /* 暗青 */
  ]},
  {id:'morandi',name:'奶油大地',emoji:'🧸',vars:{
    '--bg':'#f2ede2','--card':'#f9f6ee','--ink':'#3a2f22','--on-ink':'#fff',
    '--text':'#3a2f22','--muted':'#8a7d69','--dim':'#b1a58f','--line':'#e2dbc8','--soft':'#ebe5d4',
    '--ctl-bd':'rgba(58,47,34,.26)','--ctl-hv':'rgba(58,47,34,.07)','--ctl-line':'rgba(58,47,34,.17)',
    '--selbg':'rgba(255,253,246,.9)','--chip-hv':'rgba(255,253,246,.82)',
    '--cell':'rgba(255,255,255,.5)','--cell-mid':'rgba(255,255,255,.68)','--cell-hv':'#fffdf6','--cell-line':'rgba(58,47,34,.09)',
    '--bar-btm':'rgba(242,237,226,.75)',
    '--glow1':'rgba(217,142,95,.07)','--glow2':'rgba(146,168,196,.08)',
  },tracks:[
    {bg:'#ece1cb',deep:'#8a7351',ink:'#2b2113'},   /* 米杏 */
    {bg:'#aebfa5',deep:'#5c7357',ink:'#192516'},   /* 灰绿 */
    {bg:'#93a9c4',deep:'#3f5e83',ink:'#ffffff'},   /* 灰蓝 */
    {bg:'#d98e5f',deep:'#8e461c',ink:'#ffffff'},   /* 陶土 */
    {bg:'#e5c6c6',deep:'#a46464',ink:'#331414'},   /* 藕粉 */
    {bg:'#b6cdc6',deep:'#5f8b7d',ink:'#0f2b25'},   /* 灰青 */
  ]},
];
let TRACK_COLORS=UI_THEMES[0].tracks;              /* 当前生效的声部色（随主题切换） */
let themeIdx=0;
function setTheme(i,quiet){
  themeIdx=Math.max(0,Math.min(UI_THEMES.length-1,i|0));
  const th=UI_THEMES[themeIdx];
  TRACK_COLORS=th.tracks;
  /* vars 写到根元素上；测试桩没有 documentElement，静默跳过 */
  if(typeof document!=='undefined'&&document.documentElement&&document.documentElement.style){
    const st=document.documentElement.style;
    for(const k in th.vars) st.setProperty(k,th.vars[k]);
  }
  if(!quiet){ recolor(); renderTracks(); save(); toast('🎨 配色：'+th.name); }
}

