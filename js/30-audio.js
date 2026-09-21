'use strict';
/* ============================================================
   step-sequencer · 30-audio
   音频引擎：总线 / 合成音色 / 鼓机合成
   ============================================================ */
/* ============ 音频引擎：总线 / 合成音色 ============ */
let audioCtx=null, masterGain=null;
let bpm=112, swingPct=0, volume=80;
/* ============ 效果器预设 ============ */
/* 每声部延时：sync＝以「四分音符＝60/bpm 秒」为基准的倍率（随 BPM 自动同步）；ms＝固定毫秒；fb＝回声次数；wet＝效果量 */
const DELAY_PRESETS=[
  {id:'off',    name:'延时 Delay · 关'},
  {id:'slap',   name:'拍打回声 Slapback',   ms:.09,  fb:.18, wet:.22, damp:4200},
  {id:'8th',    name:'1/8 短延 8th',        sync:.5, fb:.28, wet:.26, damp:3600},
  {id:'dot8',   name:'附点 1/8 Dotted 8th', sync:.75,fb:.38, wet:.28, damp:3200},
  {id:'quarter',name:'1/4 回声 1/4 Note',   sync:1,  fb:.44, wet:.28, damp:2800},
  {id:'space',  name:'空间漂移 Ambient Echo',sync:1.5,fb:.52, wet:.32, damp:2200},
];
const DELAY_IDS=new Set(DELAY_PRESETS.map(p=>p.id));
/* 总输出混响（卷积）：decay＝衰减秒数；wet＝基准湿度（实际湿度 × revMix 强度） */
const REV_PRESETS=[
  {id:'off',      name:'混响 Reverb · 关'},
  {id:'room',     name:'房间 Room',       decay:.9, wet:.16},
  {id:'plate',    name:'板式 Plate',      decay:1.9,wet:.24},
  {id:'hall',     name:'音乐厅 Hall',     decay:3.2,wet:.30},
  {id:'cathedral',name:'教堂 Cathedral',  decay:4.6,wet:.34},
  {id:'ambient',  name:'氛围空间 Ambient',decay:6.5,wet:.38},
];
const REV_IDS=new Set(REV_PRESETS.map(p=>p.id));
let revPreset='off', revMix=1, revConv=null, revWet=null, revDecay=-1;

function ensureAudio(){
  if(audioCtx) return;
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return;                                    // 无 Web Audio 时不阻塞其余功能
  audioCtx=new AC();
  masterGain=audioCtx.createGain();
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=15000;
  const cmp=audioCtx.createDynamicsCompressor();
  cmp.threshold.value=-13; cmp.knee.value=16; cmp.ratio.value=3.2; cmp.attack.value=.004; cmp.release.value=.18;
  masterGain.connect(lp); lp.connect(cmp); cmp.connect(audioCtx.destination);
  /* 总输出混响发送：masterGain → 卷积 → 湿度 → 压缩器 */
  revConv=audioCtx.createConvolver();
  revWet=audioCtx.createGain(); revWet.gain.value=0;
  masterGain.connect(revConv); revConv.connect(revWet); revWet.connect(cmp);
  applyVolume(); applyReverb();
}
function applyVolume(){ if(masterGain) masterGain.gain.value=Math.pow(volume/100,1.55)*.95; }
/* 程序生成脉冲响应：双声道去相关噪声 × 指数衰减（decay 变了才重建） */
function makeIR(decay){
  const sr=audioCtx.sampleRate, len=Math.max(1,(sr*decay)|0);
  const buf=audioCtx.createBuffer(2,len,sr);
  for(let ch=0;ch<2;ch++){
    const d=buf.getChannelData(ch);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.8);
  }
  return buf;
}
function applyReverb(){
  const p=REV_PRESETS.find(x=>x.id===revPreset)||REV_PRESETS[0];
  if(!audioCtx||!revConv) return;
  if(p.decay!==revDecay){ revConv.buffer=makeIR(p.decay); revDecay=p.decay; }
  revWet.gain.setTargetAtTime(Math.min(1,p.wet*(revMix==null?1:revMix)),audioCtx.currentTime,.05);
}
function setReverb(id){ revPreset=REV_IDS.has(id)?id:'off'; applyReverb(); }

/* 每声部输出链：gain → panner → master；并行延时发送（send → delay → 阻尼 → 反馈循环 → 湿度 → panner） */
const busCache=new Map();
/* 声部总线的「哑音」开关：安放在 gain 之前。
   为什么必须有它：静音之后总线上仍可能有残留（延时的反馈循环、长音尾巴），
   只把 gain 设成 0 挡不住已经进了延时线的信号；从源头切断才是干净的静音，
   这也让 M / S 在播放中途点下就立刻见效。 */
function muteLatch(tr){
  const b=busCache.get(tr.id);
  if(b&&b.latch&&audioCtx) b.latch.gain.value=(tr.mute||(soloActive()&&!tr.solo))?0:1;
  return b;
}
/* 改音量 / 声像后让总线立刻跟上（等着下一次发声才更新的体感太迟钝） */
function busSync(tr){
  const b=busCache.get(tr.id);
  if(!b||!audioCtx) return;
  b.gain.gain.value=tr.vol;
  if(b.pan) b.pan.pan.value=tr.pan;
  applyTrackFx(tr,b);
  muteLatch(tr);
}
function applyTrackFx(tr,b){
  const p=DELAY_PRESETS.find(x=>x.id===(tr.fx||'off'))||DELAY_PRESETS[0];
  if(!b.fx) return;
  const t=(p.sync!=null)?(60/bpm)*p.sync:(p.ms||0);
  b.fx.dl.delayTime.setTargetAtTime(Math.min(2.4,t),audioCtx.currentTime,.03);
  b.fx.fb.gain.setTargetAtTime(p.fb||0,audioCtx.currentTime,.03);
  b.fx.send.gain.setTargetAtTime((p.wet||0)*(tr.fxMix==null?1:tr.fxMix),audioCtx.currentTime,.03);
  if(p.damp) b.fx.damp.frequency.setTargetAtTime(p.damp,audioCtx.currentTime,.03);
}
function setTrackFx(tr,id){
  tr.fx=DELAY_IDS.has(id)?id:'off';
  const b=busCache.get(tr.id);
  if(b&&audioCtx) applyTrackFx(tr,b);
}
function busFor(tr){
  if(!audioCtx) return null;
  let b=busCache.get(tr.id);
  if(!b){
    /* latch（哑音闸，源头）→ g（音量推子）→ panner → master；延时发送从 g 之后取 */
    const latch=audioCtx.createGain(); latch.gain.value=1;
    const g=audioCtx.createGain(); g.gain.value=tr.vol;
    latch.connect(g);
    let p;
    if(audioCtx.createStereoPanner){ p=audioCtx.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); p.connect(masterGain); }
    else{ g.connect(masterGain); }
    const send=audioCtx.createGain(); send.gain.value=0;
    const dl=audioCtx.createDelay(2.5); dl.delayTime.value=.25;
    const damp=audioCtx.createBiquadFilter(); damp.type='lowpass'; damp.frequency.value=3400;
    const fb=audioCtx.createGain(); fb.gain.value=0;
    const wet=audioCtx.createGain(); wet.gain.value=1;
    g.connect(send); send.connect(dl); dl.connect(damp);
    damp.connect(fb); fb.connect(dl);                 // 反馈循环（带阻尼）
    damp.connect(wet); wet.connect(p||masterGain);
    b={latch,gain:g,pan:p,fx:{send,dl,fb,damp}};
    busCache.set(tr.id,b);
  }
  b.gain.gain.value=tr.vol;
  if(b.pan) b.pan.pan.value=tr.pan;
  applyTrackFx(tr,b);
  muteLatch(tr);
  return b.latch;                                     // 音源接在闸门之前：静音＝从源头断掉
}

/* 通用工具：噪声击弦 / 加法合成 */
function noiseBurst(t,dest,level,dur,hp){
  const sr=audioCtx.sampleRate, len=Math.max(1,(sr*dur)|0);
  const buf=audioCtx.createBuffer(1,len,sr), d=buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3.2);
  const s=audioCtx.createBufferSource(); s.buffer=buf;
  let node=s;
  if(hp){const f=audioCtx.createBiquadFilter();f.type='highpass';f.frequency.value=hp;s.connect(f);node=f;}
  const g=audioCtx.createGain(); g.gain.value=level;
  node.connect(g); g.connect(dest); s.start(t);
}
function additive(freq,t,dest,parts,vel){
  for(const [n,amp,dur] of parts){
    const o=audioCtx.createOscillator(); o.type='sine';
    o.frequency.value=freq*n*(1+.0007*n*n);
    const g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002,amp*vel),t+.006);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+dur+.12);
  }
}
/* Karplus-Strong 拨弦（现场生成缓冲） */
const ksCache=new Map();
function ksBuffer(freq,seconds,type){
  const key=type+'|'+Math.round(freq);
  if(ksCache.has(key)) return ksCache.get(key);
  const sr=audioCtx.sampleRate;
  const N=Math.max(2,Math.round(sr/freq));
  const len=Math.max(N+1,Math.round(sr*seconds));
  const out=new Float32Array(len), ring=new Float32Array(N);
  for(let i=0;i<N;i++) ring[i]=Math.random()*2-1;
  const pr={guitar:{damp:.9965,tone:.52},eguitar:{damp:.9972,tone:.46}}[type]||{damp:.995,tone:.44};
  let idx=0;
  for(let i=0;i<len;i++){
    const cur=ring[idx], nxt=ring[(idx+1)%N];
    ring[idx]=(cur*(1-pr.tone)+nxt*pr.tone)*pr.damp;
    out[i]=cur; idx=(idx+1)%N;
  }
  const atk=Math.min(48,len);
  for(let i=0;i<atk;i++) out[i]*=i/atk;
  const buf=audioCtx.createBuffer(1,len,sr);
  if(buf.copyToChannel) buf.copyToChannel(out,0); else buf.getChannelData(0).set(out);
  if(ksCache.size>200) ksCache.clear();
  ksCache.set(key,buf);
  return buf;
}
function ksPlay(freq,t,dest,type,vel){
  const sec=type==='guitar'?1.9:(type==='eguitar'?2.3:2.4);
  const s=audioCtx.createBufferSource(); s.buffer=ksBuffer(freq,sec,type);
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass';
  lp.frequency.value=type==='guitar'?3600:(type==='eguitar'?3000:6200);
  const g=audioCtx.createGain(); g.gain.value=.5*vel;
  s.connect(lp); lp.connect(g); g.connect(dest); s.start(t);
}
/* 持续型音色通用包络：attack → 保持 dur → release */
function sustainOsc(freq,t,dest,o){
  const g=audioCtx.createGain();
  const sus=o.sus==null?.82:o.sus;
  const atk=o.attack||.01, dur=o.dur||.3, rel=o.release||.2;
  g.gain.setValueAtTime(.0001,t);
  g.gain.linearRampToValueAtTime(o.peak,t+atk);
  g.gain.linearRampToValueAtTime(o.peak*sus,t+atk+dur);
  g.gain.setTargetAtTime(.0001,t+atk+dur+.02,rel);
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=o.cutoff||6000;
  g.connect(lp); lp.connect(dest);
  const stop=t+atk+dur+rel*6+.6;
  (o.types||['sawtooth']).forEach((tp,i)=>{
    const osc=audioCtx.createOscillator(); osc.type=tp;
    osc.frequency.value=freq*(i?1+(i%2?1:-1)*(o.mix||.5)*.005*(1+i*.5):1);
    osc.connect(g); osc.start(t); osc.stop(stop);
  });
  if(o.lfo){
    const l=audioCtx.createOscillator(); l.type='sine'; l.frequency.value=o.lfo.rate;
    const lg=audioCtx.createGain(); lg.gain.value=o.lfo.depth;
    l.connect(lg); lg.connect(g.gain); l.start(t); l.stop(stop);
  }
}
/* FM 音色（调制指数随时间衰减） */
function fmVoice(freq,t,dest,o){
  const car=audioCtx.createOscillator(); car.type='sine'; car.frequency.value=freq;
  const mod=audioCtx.createOscillator(); mod.type='sine'; mod.frequency.value=freq*(o.ratio||2);
  const mg=audioCtx.createGain();
  mg.gain.setValueAtTime(Math.max(1,o.index*freq),t);
  mg.gain.exponentialRampToValueAtTime(Math.max(.5,o.index*freq*.02),t+(o.dur*(o.decay||.2)));
  mod.connect(mg); mg.connect(car.frequency);
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002,o.amp),t+(o.attack||.006));
  g.gain.exponentialRampToValueAtTime(.0001,t+o.dur);
  car.connect(g); g.connect(dest);
  car.start(t); car.stop(t+o.dur+.1); mod.start(t); mod.stop(t+o.dur+.1);
}
/* 滤波扫频音色（合成拨弦 / 酸性贝斯 / 失真的底子）：
   振荡器 → 共振低通（截止频率从 cHi 滑到 cLo）→ 音量包络。
   q 越大「呜哇」感越强；decay 是滤波器滑落的时间尺度。 */
function filterPluck(freq,t,dest,o){
  const f=audioCtx.createBiquadFilter(); f.type='lowpass'; f.Q.value=o.q||8;
  const cHi=Math.min(16000,o.cutoffHi||freq*8), cLo=Math.max(60,o.cutoffLo||freq*1.2);
  f.frequency.setValueAtTime(cHi,t);
  f.frequency.exponentialRampToValueAtTime(cLo,t+(o.decay||.18));
  const g=audioCtx.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002,o.peak),t+(o.attack||.004));
  g.gain.exponentialRampToValueAtTime(.0001,t+o.dur);
  f.connect(g); g.connect(dest);
  (o.types||['sawtooth']).forEach((tp,i)=>{
    const os=audioCtx.createOscillator(); os.type=tp;
    os.frequency.value=freq*(i?1+(i%2?1:-1)*(o.mix||.4)*.006:1);
    os.connect(f); os.start(t); os.stop(t+o.dur+.3);
  });
}
/* 失真曲线（WaveShaper 软削波，带缓存）：amount 0~1，越大越炸 */
const shaperCache=new Map();
function shaperCurve(amount){
  amount=clamp(amount,0,1);
  if(shaperCache.has(amount)) return shaperCache.get(amount);
  const n=2048, c=new Float32Array(n), k=amount*90+.5;
  for(let i=0;i<n;i++){ const x=i*2/n-1; c[i]=(1+k)*x/(1+k*Math.abs(x)); }
  shaperCache.set(amount,c);
  return c;
}

/* 各音色：VOICE[instId](freq, t, dest, vel, dur) */
const VOICE={
  piano(f,t,dest,vel){ additive(f,t,dest,[[1,1,3.4],[2,.5,2.4],[3,.3,1.7],[4,.2,1.25],[5,.14,1],
    [6,.1,.85],[7,.07,.7],[8,.05,.6],[10,.03,.5],[12,.02,.36]],vel); noiseBurst(t,dest,.1*vel,.025,2800); },
  epiano(f,t,dest,vel){
    fmVoice(f,t,dest,{ratio:2.01,index:1.7,decay:.2,amp:.46*vel,dur:2.6,attack:.005});
    fmVoice(f*2,t,dest,{ratio:3.51,index:.5,decay:.08,amp:.13*vel,dur:1.1,attack:.004});
    noiseBurst(t,dest,.03*vel,.012,4200);
  },
  organ(f,t,dest,vel,dur){
    /* 音轮风琴：1/2/3/4/6/8 泛音拉杆 + 双排微失谐的合唱感，方波般的饱满持续 */
    const g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,t);
    g.gain.linearRampToValueAtTime(.3*vel,t+.02);
    g.gain.setValueAtTime(.3*vel,t+Math.max(dur*.85,.1));
    g.gain.setTargetAtTime(.0001,t+dur*.9,.05);
    const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=5600;
    g.connect(lp); lp.connect(dest);
    const stop=t+dur+1;
    for(const [n,amp] of [[1,.3],[2,.24],[3,.17],[4,.12],[6,.09],[8,.06]]){
      for(const det of [0,1.2,-1.2]){                  // 双排微失谐 ≈ Leslie 合唱
        const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=f*n; o.detune.value=det;
        const og=audioCtx.createGain(); og.gain.value=amp/3;
        o.connect(og); og.connect(g); o.start(t); o.stop(stop);
      }
    }
  },
  pluck(f,t,dest,vel){ ksPlay(f,t,dest,'harp',vel); },
  guitar(f,t,dest,vel){ ksPlay(f,t,dest,'guitar',vel); noiseBurst(t,dest,.05*vel,.02,1800); },
  eguitar(f,t,dest,vel){ ksPlay(f,t,dest,'eguitar',vel); noiseBurst(t,dest,.035*vel,.012,2400); },
  dist(f,t,dest,vel,dur){
    /* 失真吉他：三把微失谐锯齿 → 软削波 → 低通（高频随音长收掉） */
    dur=Math.max(.18,dur);
    const ws=audioCtx.createWaveShaper(); ws.curve=shaperCurve(.72); ws.oversample='2x';
    const pre=audioCtx.createGain(); pre.gain.value=2.4;
    const post=audioCtx.createBiquadFilter(); post.type='lowpass';
    post.frequency.setValueAtTime(3600,t);
    post.frequency.exponentialRampToValueAtTime(1900,t+dur*.7);
    const g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,t);
    g.gain.linearRampToValueAtTime(.16*vel,t+.008);
    g.gain.setValueAtTime(.16*vel,t+dur*.7);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur*1.05);
    for(const det of [0,-7,7]){
      const o=audioCtx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.detune.value=det;
      o.connect(pre); o.start(t); o.stop(t+dur*1.1);
    }
    pre.connect(ws); ws.connect(post); post.connect(g); g.connect(dest);
  },
  bell(f,t,dest,vel){
    fmVoice(f,t,dest,{ratio:1.41,index:2.4,decay:.13,amp:.4*vel,dur:3.6,attack:.003});
    fmVoice(f*2.76,t,dest,{ratio:1.1,index:.9,decay:.06,amp:.11*vel,dur:1.6,attack:.002});
  },
  marimba(f,t,dest,vel){
    additive(f,t,dest,[[1,1,.85],[4,.24,.22],[9.2,.06,.11]],vel*.85);
    noiseBurst(t,dest,.06*vel,.014,900);
  },
  strings(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','sawtooth','sawtooth'],mix:1.1,attack:.19,dur,peak:.21*vel,sus:.85,
      cutoff:3400,release:.4,lfo:{rate:5.2,depth:.012}});
  },
  cello(f,t,dest,vel,dur){
    /* 大提琴：弓弦感的双锯齿 + 低八度腔体共鸣 */
    sustainOsc(f,t,dest,{types:['sawtooth','sawtooth'],mix:.75,attack:.14,dur,peak:.22*vel,sus:.85,
      cutoff:2500,release:.38,lfo:{rate:5.5,depth:.014}});
    sustainOsc(f/2,t,dest,{types:['sawtooth'],attack:.18,dur,peak:.08*vel,sus:.8,cutoff:1200,release:.4});
  },
  pad(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','triangle','sawtooth'],mix:1.7,attack:.42,dur:dur*1.5,peak:.18*vel,sus:.9,
      cutoff:2100,release:.85,lfo:{rate:3.1,depth:.01}});
  },
  lead(f,t,dest,vel,dur){
    /* 合成主音：方波+锯齿双层 + 轻微颤音 + 低八度衬底 */
    sustainOsc(f,t,dest,{types:['square','sawtooth'],mix:.9,attack:.01,dur,peak:.17*vel,sus:.78,cutoff:5200,release:.16,
      lfo:{rate:5.6,depth:.006}});
    sustainOsc(f/2,t,dest,{types:['square'],attack:.012,dur:dur*.9,peak:.05*vel,sus:.6,cutoff:2200,release:.12});
  },
  supersaw(f,t,dest,vel,dur){
    /* 超锯：五把微失谐锯齿叠出宽厚的「墙」，再垫一个低八度锯齿 */
    sustainOsc(f,t,dest,{types:['sawtooth','sawtooth','sawtooth','sawtooth','sawtooth'],mix:2.4,attack:.02,dur,
      peak:.15*vel,sus:.75,cutoff:5200,release:.22});
    sustainOsc(f/2,t,dest,{types:['sawtooth'],attack:.025,dur,peak:.07*vel,sus:.6,cutoff:1600,release:.2});
  },
  bass(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','sine'],mix:.6,attack:.006,dur:dur*.9,peak:.26*vel,sus:.5,cutoff:1500,release:.13});
    const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=f/2;
    const g=audioCtx.createGain(); g.gain.setValueAtTime(.22*vel,t);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur*1.5);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+dur*1.6);
  },
  subbass(f,t,dest,vel,dur){
    const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=f/2;
    const g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(.34*vel,t+.025);
    g.gain.setValueAtTime(.34*vel,t+dur*.75);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur*1.4);
    const lp=audioCtx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=520;
    o.connect(g); g.connect(lp); lp.connect(dest); o.start(t); o.stop(t+dur*1.5);
  },
  /* ---- 扩充音色 ---- */
  musicbox(f,t,dest,vel){
    fmVoice(f,t,dest,{ratio:3.01,index:1.15,decay:.09,amp:.4*vel,dur:1.7,attack:.002});
    fmVoice(f*4,t,dest,{ratio:1,index:.4,decay:.05,amp:.08*vel,dur:.7,attack:.002});
  },
  vibes(f,t,dest,vel){
    fmVoice(f,t,dest,{ratio:2,index:.75,decay:.32,amp:.42*vel,dur:2.4,attack:.004});
    fmVoice(f*3.98,t,dest,{ratio:1,index:.28,decay:.1,amp:.09*vel,dur:1.1,attack:.003});
  },
  koto(f,t,dest,vel){
    additive(f,t,dest,[[1,1,1.7],[2,.34,.75],[3,.17,.42],[5.01,.06,.22]],vel*.92);
    noiseBurst(t,dest,.07*vel,.02,2600);
  },
  choir(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','sine'],mix:.65,attack:.26,dur:dur*1.2,peak:.2*vel,sus:.88,
      cutoff:1850,release:.55,lfo:{rate:5,depth:.022}});
    sustainOsc(f*2,t,dest,{types:['sine'],attack:.3,dur:dur,peak:.05*vel,sus:.8,cutoff:2600,release:.5});
  },
  flute(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sine'],attack:.07,dur,peak:.27*vel,sus:.85,cutoff:3900,release:.22,
      lfo:{rate:5.4,depth:.007}});
    noiseBurst(t,dest,.05*vel,.09,3200);
  },
  brass(f,t,dest,vel,dur){
    /* 合成铜管：滤波器「吹开」上扫（低→高）才是铜管感，纯锯齿只是蜂鸣 */
    dur=Math.max(.18,dur);
    const fl=audioCtx.createBiquadFilter(); fl.type='lowpass'; fl.Q.value=2;
    fl.frequency.setValueAtTime(Math.max(200,f*1.5),t);
    fl.frequency.linearRampToValueAtTime(Math.min(6000,f*7),t+.13);
    fl.frequency.setTargetAtTime(Math.min(4200,f*4.5),t+.13,.3);
    const g=audioCtx.createGain();
    g.gain.setValueAtTime(.0001,t);
    g.gain.linearRampToValueAtTime(.23*vel,t+.05);
    g.gain.setValueAtTime(.23*vel,t+dur*.8);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur*1.1);
    for(const [det,amp] of [[0,1],[8,.5],[-8,.5]]){
      const o=audioCtx.createOscillator(); o.type='sawtooth'; o.frequency.value=f; o.detune.value=det;
      const og=audioCtx.createGain(); og.gain.value=amp;
      o.connect(og); og.connect(fl); o.start(t); o.stop(t+dur*1.15);
    }
    fl.connect(g); g.connect(dest);
  },
  plucksyn(f,t,dest,vel){
    /* 合成拨弦：滤波器快速下滑的「弹」感，比真实拨弦更亮更规整 */
    filterPluck(f,t,dest,{types:['sawtooth','square'],mix:.5,q:3,
      cutoffHi:Math.min(9000,f*9),cutoffLo:Math.max(120,f*1.4),decay:.16,dur:1.5,peak:.3*vel});
  },
  acid(f,t,dest,vel,dur){
    /* 酸性贝斯（303 味）：高 Q 共振滤波大幅下扫，低八度正弦托底 */
    filterPluck(f,t,dest,{types:['sawtooth'],q:14,
      cutoffHi:Math.min(7000,f*7),cutoffLo:Math.max(80,f*1.6),decay:.22,dur:Math.max(.4,dur*.9),peak:.3*vel});
    const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=f/2;
    const g=audioCtx.createGain(); g.gain.setValueAtTime(.12*vel,t);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur*1.2);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+dur*1.3);
  },
};
function playTrackNote(tr,row,t,vel){
  ensureAudio();
  const dest=busFor(tr); if(!dest) return;
  const freq=440*Math.pow(2,(rowMidi(row,tr.oct)-69)/12);
  /* 手动力度优先；未手动调过的步保留 ±随机人性化 */
  const v=(vel==null?.82+Math.random()*.16:vel*(.94+Math.random()*.12));
  (VOICE[tr.inst]||VOICE.piano)(freq,t,dest,v,stepDur()*rateOf(tr)*1.9);   // 发音长度随该声部速度缩放
  sendMidiNote(tr,row,t,vel);
}
/* ============ 鼓机合成 ============ */
const GM_DRUM={kick:36,snare:38,clap:39,hat:42,ohat:46,tom:45,ride:51};
function playDrumHit(tr,id,t,vel){
  ensureAudio();
  const dest=busFor(tr); if(!dest) return;
  sendMidiDrum(id,t);
  const v=(vel==null?1:vel)*(.88+Math.random()*.14);
  const env=(g,a,peak,dur)=>{g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+dur);};
  if(id==='kick'){
    const o=audioCtx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(160,t); o.frequency.exponentialRampToValueAtTime(44,t+.085);
    const g=audioCtx.createGain(); env(g,.002,.95*v,.5);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+.55);
    noiseBurst(t,dest,.14*v,.016,300);
  }else if(id==='snare'){
    const o=audioCtx.createOscillator(); o.type='triangle'; o.frequency.value=196;
    const og=audioCtx.createGain(); env(og,.002,.3*v,.16);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t+.2);
    const sr=audioCtx.sampleRate,len=(sr*.24)|0;
    const buf=audioCtx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6);
    const s=audioCtx.createBufferSource(); s.buffer=buf;
    const bp=audioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1750; bp.Q.value=.8;
    const g=audioCtx.createGain(); g.gain.value=.42*v;
    s.connect(bp); bp.connect(g); g.connect(dest); s.start(t);
  }else if(id==='clap'){
    const sr=audioCtx.sampleRate,len=(sr*.3)|0;
    const buf=audioCtx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const x=i/sr, a=(x<.012?1:(x<.024?.8:(x<.036?.65:Math.pow(Math.max(0,1-(x-.036)/.26),2.4))));
      d[i]=(Math.random()*2-1)*a;
    }
    const s=audioCtx.createBufferSource(); s.buffer=buf;
    const bp=audioCtx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1150; bp.Q.value=.6;
    const g=audioCtx.createGain(); g.gain.value=.4*v;
    s.connect(bp); bp.connect(g); g.connect(dest); s.start(t);
  }else if(id==='hat'||id==='ohat'){
    const open=id==='ohat';
    const sr=audioCtx.sampleRate,len=(sr*(open?.42:.075))|0;
    const buf=audioCtx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,open?2.2:5);
    const s=audioCtx.createBufferSource(); s.buffer=buf;
    const hp=audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=open?6800:7600;
    const pk=audioCtx.createBiquadFilter(); pk.type='peaking'; pk.frequency.value=9000; pk.gain.value=5; pk.Q.value=1.1;
    const g=audioCtx.createGain(); g.gain.value=(open?.24:.3)*v;
    s.connect(hp); hp.connect(pk); pk.connect(g); g.connect(dest); s.start(t);
  }else if(id==='tom'){
    const o=audioCtx.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(240,t); o.frequency.exponentialRampToValueAtTime(120,t+.22);
    const g=audioCtx.createGain(); env(g,.003,.6*v,.34);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+.4);
    noiseBurst(t,dest,.08*v,.02,600);
  }else if(id==='ride'){
    const parts=[[1,.16,1.6],[2.76,.09,1.1],[5.4,.05,.8],[8.9,.03,.5]];
    for(const [n,amp,dur] of parts){
      const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=520*n;
      const g=audioCtx.createGain(); env(g,.004,amp*v,dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t+dur+.1);
    }
    const sr=audioCtx.sampleRate,len=(sr*1.1)|0;
    const buf=audioCtx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.5);
    const s=audioCtx.createBufferSource(); s.buffer=buf;
    const hp=audioCtx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=5200;
    const g=audioCtx.createGain(); g.gain.value=.16*v;
    s.connect(hp); hp.connect(g); g.connect(dest); s.start(t);
  }
}

