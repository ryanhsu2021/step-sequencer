'use strict';
/* ============================================================
   step-sequencer · 42-arrange
   🎼 一键编配（贝斯 / 琶音 / 铺底 / 鼓组）
   ============================================================ */
/* ============ 🎼 一键编配（每次点击都不同） ============ */
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
function fillBass(t,prog){
  const L=scLen(), step3=L>=7?2:1, step5=L>=7?4:3, lib=PAT_BASS();
  const n=stepsOf(t);
  prog=progTiled(prog,n);                             // 和弦轨比声部短 → 循环平铺
  t.seq=new Array(n).fill(-1);
  let base=0;
  for(const ch of prog){                              // 每段和弦各配一条低音节奏型
    const span=ch.beats*4, root=ch.root;
    const rRoot=rowForDegreeNear(root,6), rFifth=rowForDegreeNear((root+step5)%L,6), rThird=rowForDegreeNear((root+step3)%L,5);
    const pat=lib[(Math.random()*lib.length)|0];
    for(let k=0;k<span;k++){
      const step=base+k; if(step>=n) break;
      const m=pat[k%8]; if(m===undefined) continue;
      t.seq[step]= m===0?rRoot : (m==='f'?rFifth:rThird);
    }
    base+=span;
    if(base>=n) break;
  }
  if(t.seq[n-1]===-1||Math.random()<.5){              // 收尾音落在末段和弦音上
    const last=prog[prog.length-1]||prog[0];
    t.seq[n-1]=rowForDegreeNear(last.tones.indexOf(0)>=0?0:last.root,6);
  }
  t.last=t.seq.slice();
}
function fillArp(t,prog){
  const lib=PAT_ARP(); const patt=lib[(Math.random()*lib.length)|0];
  const orders=PAT_ORD(); const order=orders[(Math.random()*orders.length)|0];
  const center=clamp(Math.round(SP_.center-1+(Math.random()<.5?0:1)),2,6);
  const n=stepsOf(t);
  prog=progTiled(prog,n);
  t.seq=new Array(n).fill(-1);
  let base=0;
  for(const ch of prog){
    const span=ch.beats*4, tones=ch.tones;
    for(let k=0;k<span;k++){
      const step=base+k; if(step>=n) break;
      if(!patt[k%8]) continue;
      const deg=tones[order[k%order.length]%tones.length];
      t.seq[step]=rowForDegreeNear(deg,center+((k%4===3)?1:0));
    }
    base+=span;
    if(base>=n) break;
  }
  t.last=t.seq.slice();
}
/* 铺底声部：每拍放和弦音，靠长音色拉出"垫子"（氛围 / 电子 / Trap 常用） */
function fillPad(t,prog){
  const center=clamp(Math.round(SP_.center-1),2,6);
  const n=stepsOf(t);
  prog=progTiled(prog,n);
  t.seq=new Array(n).fill(-1);
  let base=0;
  for(const ch of prog){
    const span=ch.beats*4, ts=ch.tones;
    const rev=Math.random()<.5;
    for(let off=0;off<span;off+=4){
      const s=base+off; if(s>=n) break;
      t.seq[s]=rowForDegreeNear(ts[(rev?1+off/4:off/4)%ts.length],center);
    }
    if(Math.random()<.45){ const s=base+span-2; if(s>=0&&s<n) t.seq[s]=rowForDegreeNear(ts[0],center-1); }
    base+=span;
    if(base>=n) break;
  }
  t.last=t.seq.slice();
}
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
  const id=pick(styleDrums());
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
function autoArrange(){
  let mel=state.tracks.find(t=>t.kind==='inst'&&t.seq.some(v=>v>=0))||state.tracks.find(t=>t.kind==='inst');
  if(!mel){ toast('请先添加一个旋律声部'); return; }
  const prog=progFor();                              // 恒用和弦进行轨
  const pk=a=>a[(Math.random()*a.length)|0];
  const roles=[
    {name:'贝斯',inst:pk(SP_.bassI||['bass']),oct:-1,fill:fillBass},
    {name:'琶音 Arp',inst:pk(SP_.chordI||['pluck','epiano','marimba']),oct:0,fill:fillArp},
  ];
  if(SP_.padRole) roles.push({name:'铺底',inst:pk(['pad','strings','organ']),oct:0,fill:fillPad});
  const made=[];
  for(const role of roles){
    const t=ensureFreeVoice(role,mel);
    if(t){ role.fill(t,prog); made.push(t.name+'('+barsOf(t)+'小节)'); }
  }
  const d=ensureDrum();
  renderTracks();
  save();
  toast('🎼 '+STYLE().emoji+' 按「'+STYLE().name+'」+ 和弦进行轨编配：'
    +(made.length?made.join(' + '):'（无空闲声部）')+(d?' + 鼓组':'')+' ——再点一次会不同（↶ 可撤销）');
}

