'use strict';
/* ============================================================
   step-sequencer · 30-audio
   音频引擎：总线 / 合成音色 / 鼓机合成
   ============================================================ */
/* ============ 音频引擎：总线 / 合成音色 ============ */
let audioCtx=null, masterGain=null;
let bpm=112, swingPct=0, volume=80;
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
  applyVolume();
}
function applyVolume(){ if(masterGain) masterGain.gain.value=Math.pow(volume/100,1.55)*.95; }

/* 每声部输出链：gain → panner → master（音量与声像实时同步） */
const busCache=new Map();
function busFor(tr){
  if(!audioCtx) return null;
  let b=busCache.get(tr.id);
  if(!b){
    const g=audioCtx.createGain(); g.gain.value=tr.vol;
    if(audioCtx.createStereoPanner){
      const p=audioCtx.createStereoPanner(); p.pan.value=tr.pan; g.connect(p); p.connect(masterGain); b={gain:g,pan:p};
    }else{ g.connect(masterGain); b={gain:g,pan:null}; }
    busCache.set(tr.id,b);
  }
  b.gain.gain.value=tr.vol;
  if(b.pan) b.pan.pan.value=tr.pan;
  return b.gain;
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
  const damp=type==='guitar'?.9965:.995, tone=type==='guitar'?.52:.44;
  let idx=0;
  for(let i=0;i<len;i++){
    const cur=ring[idx], nxt=ring[(idx+1)%N];
    ring[idx]=(cur*(1-tone)+nxt*tone)*damp;
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
  const s=audioCtx.createBufferSource(); s.buffer=ksBuffer(freq,type==='guitar'?1.9:2.4,type);
  const lp=audioCtx.createBiquadFilter(); lp.type='lowpass';
  lp.frequency.value=type==='guitar'?3600:6200;
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
    sustainOsc(f,t,dest,{types:['sine','sine','sine'],mix:.5,attack:.02,dur,peak:.34*vel,sus:.92,cutoff:5400,release:.06});
    additive(f,t,dest,[[2,.18,dur+.7],[3,.12,dur+.55],[4,.08,dur+.5],[6,.05,dur+.4]],vel*.45);
  },
  pluck(f,t,dest,vel){ ksPlay(f,t,dest,'harp',vel); },
  guitar(f,t,dest,vel){ ksPlay(f,t,dest,'guitar',vel); noiseBurst(t,dest,.05*vel,.02,1800); },
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
  pad(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','triangle','sawtooth'],mix:1.7,attack:.42,dur:dur*1.5,peak:.18*vel,sus:.9,
      cutoff:2100,release:.85,lfo:{rate:3.1,depth:.01}});
  },
  lead(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['square','sawtooth'],mix:.8,attack:.012,dur,peak:.18*vel,sus:.8,cutoff:4600,release:.15});
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
    sustainOsc(f,t,dest,{types:['sawtooth','sawtooth'],mix:1.4,attack:.055,dur,peak:.22*vel,sus:.86,
      cutoff:2700,release:.2,lfo:{rate:4.6,depth:.008}});
  },
  chip(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['square'],attack:.003,dur,peak:.19*vel,sus:.34,cutoff:3400,release:.045});
  },
  acid(f,t,dest,vel,dur){
    sustainOsc(f,t,dest,{types:['sawtooth','square'],mix:1.2,attack:.004,dur:dur*.85,peak:.23*vel,sus:.42,
      cutoff:1150,release:.1});
    const o=audioCtx.createOscillator(); o.type='sine'; o.frequency.value=f;
    const g=audioCtx.createGain(); g.gain.setValueAtTime(.1*vel,t);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t+dur+.1);
  },
};
function playTrackNote(tr,row,t){
  ensureAudio();
  const dest=busFor(tr); if(!dest) return;
  const freq=440*Math.pow(2,(rowMidi(row,tr.oct)-69)/12);
  const vel=.82+Math.random()*.16;
  (VOICE[tr.inst]||VOICE.piano)(freq,t,dest,vel,stepDur()*1.9);
  sendMidiNote(tr,row,t);
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

