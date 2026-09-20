'use strict';
/* ============================================================
   step-sequencer · 02-modes
   调式（音阶）体系
   ============================================================ */
/* ============ 调式（音阶）体系 ============ */
const ROOT_NAMES=['C','C#','D','E♭','E','F','F#','G','A♭','A','B♭','B'];
const MODES=[
  {name:'大调',       iv:[0,2,4,5,7,9,11]},
  {name:'自然小调',   iv:[0,2,3,5,7,8,10]},
  {name:'Dorian',     iv:[0,2,3,5,7,9,10]},
  {name:'Mixolydian', iv:[0,2,4,5,7,9,11]},
  {name:'Lydian',     iv:[0,2,4,6,7,9,11]},
  {name:'Phrygian',   iv:[0,1,3,5,7,8,10]},
  {name:'大调五声',   iv:[0,2,4,7,9]},
  {name:'小调五声',   iv:[0,3,5,7,10]},
];
let rootIdx=0, modeIdx=0;
const ivOf=()=>MODES[modeIdx].iv;
const scLen=()=>MODES[modeIdx].iv.length;
function rowMidi(r,oct){
  const a=ivOf(), L=a.length, i=ROWS-1-r;
  return rootIdx+60+a[i%L]+12*Math.floor(i/L)+(oct||0)*12;
}
const noteName=m=>ROOT_NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1);
const degOfRow=r=>{const L=scLen();return (((ROWS-1-r)%L)+L)%L;};
function lowRowForDegree(deg){
  for(let r=ROWS-1;r>=0;r--) if(degOfRow(r)===deg) return r;
  return ROWS-1;
}
/* 找「级数精确等于 deg」且离 pref 最近的行——保证和弦音落在正确的和弦音上 */
function rowForDegreeNear(deg,pref){
  const L=scLen(), want=((deg%L)+L)%L;
  let best=-1,bd=1e9;
  for(let r=0;r<ROWS;r++){
    if(degOfRow(r)!==want) continue;
    const w=Math.abs(r-pref);
    if(w<bd){bd=w;best=r;}
  }
  return best<0?clamp(pref|0,0,ROWS-1):best;
}

