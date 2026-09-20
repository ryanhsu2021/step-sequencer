'use strict';
/* ============================================================
   step-sequencer · 04-drums
   鼓机预设与风格推荐
   ============================================================ */
/* ============ 鼓机：预设 + 自由编辑 ============ */
const DRUM_LANES=[
  {id:'kick',label:'底鼓'},{id:'snare',label:'军鼓'},{id:'clap',label:'拍手'},
  {id:'hat',label:'闭镲'},{id:'ohat',label:'开镲'},{id:'tom',label:'嗵鼓'},{id:'ride',label:'吊镲'},
];
const DRUM_PRESETS=[
  {id:'none', name:'空白',      desc:'清空，从零编辑',                              styles:['*'],
   p:{}},
  {id:'pop',  name:'流行八拍',  desc:'反拍军鼓 + 八分闭镲',                        styles:['pop','folk','rock'],
   p:{kick:'x.......x.......',snare:'....x.......x...',hat:'x.x.x.x.x.x.x.x.'}},
  {id:'four', name:'四踩舞曲',  desc:'每拍底鼓 + 反拍开镲',                        styles:['electronic','pop','rock'],
   p:{kick:'x...x...x...x...',clap:'....x.......x...',ohat:'..x...x...x...x.',hat:'x.x.x.x.x.x.x.x.'}},
  {id:'rock', name:'摇滚基础',  desc:'底鼓推进 + 八分吊镲',                        styles:['rock','pop'],
   p:{kick:'x.......x.x.....',snare:'....x.......x...',hat:'x.x.x.x.x.x.x.x.'}},
  {id:'half', name:'半速嘻哈',  desc:'厚重底鼓 + 稀疏军鼓',                        styles:['hiphop','trap','pop'],
   p:{kick:'x.....x...x.....',snare:'........x.......',hat:'x.xxx.x.x.xxx.x.'}},
  {id:'trap', name:'Trap',     desc:'滑音底鼓 + 十六分闭镲',                       styles:['trap','hiphop','electronic'],
   p:{kick:'x......x..x.....',snare:'........x.......',hat:'xxxxxxxxxxxxxxxx'}},
  {id:'bossa',name:'Bossa',    desc:'轻柔拉丁切分',                               styles:['jazz','folk','ambient','hiphop'],
   p:{kick:'x.....x...x.....',snare:'....x.......x...',hat:'..x...x...x...x.'}},
  {id:'edm',  name:'电子舞曲',  desc:'四踩 + 拍手 + 开镲',                          styles:['electronic','trap'],
   p:{kick:'x...x...x...x...',clap:'....x.......x...',ohat:'..x...x...x...x.',hat:'x.x.x.x.x.x.x.x.',ride:'x...............'}},
  {id:'folk', name:'民谣轻敲',  desc:'安静的底鼓与四分镲',                          styles:['folk','ambient','guofeng','pop'],
   p:{kick:'x.......x.......',snare:'....x.......x...',hat:'x...x...x...x...'}},
  {id:'jazz', name:'爵士摇摆',  desc:'吊镲摇摆 + 轻底鼓 + 幽灵军鼓',                styles:['jazz','folk'],
   p:{kick:'x.....x...x.....',snare:'....x.......x...',ride:'x..x..x.x..x..x.',tom:'..............x.'}},
  {id:'ambient',name:'氛围声场',desc:'极简底鼓 + 吊镲余韵 + 嗵鼓点缀',              styles:['ambient','guofeng'],
   p:{kick:'x...............',ride:'x.......x.......',tom:'..............x.',ohat:'........x.......'}},
  {id:'ballad',name:'抒情慢歌', desc:'稀疏底鼓与军鼓，留白呼吸',                    styles:['ambient','pop','folk','jazz'],
   p:{kick:'x.....x.........',snare:'........x.......',hat:'x...x...x...x...',tom:'..............x.'}},
];
const PRESET_BY_ID=id=>DRUM_PRESETS.find(p=>p.id===id)||DRUM_PRESETS[0];
const styleRankedDrums=()=>{
  const want=SP_.drums||[];
  return DRUM_PRESETS.map((p,i)=>({p,i,on:want.indexOf(p.id)>=0||p.id==='none'}))
    .sort((a,b)=>(b.on-a.on)||(a.i-b.i)).map(x=>x.p);
};
const styleDrums=()=>{const w=SP_.drums;return (w&&w.length)?w:['pop','rock'];};
function drumHits(tr,s){                        // 鼓声部第 s 步命中的音色
  const out=[];
  for(const l of DRUM_LANES) if((tr.p[l.id]||'')[s]==='x') out.push(l.id);
  return out;
}

