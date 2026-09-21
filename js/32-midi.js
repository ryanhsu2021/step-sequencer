'use strict';
/* ============================================================
   step-sequencer · 32-midi
   Web MIDI 实时输出 + 多轨 .mid 导出
   ============================================================ */
/* ============ MIDI：Web MIDI 实时输出 + 多轨 .mid 导出 ============ */
const midiOutSel=$('midiOutSel');
let midiAccess=null, midiOut=null;
const midiChan=t=>{
  if(t.kind==='drum') return 9;
  const idx=state.tracks.filter(x=>x.kind==='inst').indexOf(t);
  return Math.max(0,Math.min(8,idx))%9;
};
async function initMidi(){
  if(!navigator.requestMIDIAccess){
    const o=new Option('浏览器不支持 Web MIDI','na'); o.disabled=true;
    midiOutSel.add(o); midiOutSel.disabled=true; return;
  }
  try{ midiAccess=await navigator.requestMIDIAccess(); populateMidiOuts(); midiAccess.onstatechange=populateMidiOuts; }
  catch(e){ const o=new Option('MIDI 不可用','err'); o.disabled=true; midiOutSel.add(o); midiOutSel.disabled=true; }
}
function populateMidiOuts(){
  const prev=midiOut?midiOut.name:null;
  midiOutSel.innerHTML='';
  midiOutSel.add(new Option('不发 MIDI','off'));
  for(const out of midiAccess.outputs.values())
    midiOutSel.add(new Option(out.name+(out.manufacturer?' · '+out.manufacturer:''),out.id));
  const m=[...midiOutSel.options].find(o=>o.text.startsWith(prev||'__'));
  if(m) midiOutSel.value=m.value;
}
midiOutSel.addEventListener('change',()=>{
  midiOut=(midiOutSel.value==='off'||!midiAccess)?null:(midiAccess.outputs.get(midiOutSel.value)||null);
});
function sendMidiNote(tr,row,t,vel){
  if(!midiOut) return;
  const ch=midiChan(tr), note=clamp(rowMidi(row,tr.oct),0,127);
  const vv=vel==null?88:clamp(Math.round(vel*127),1,127);
  try{ midiOut.send([0x90|ch,note,vv],t); midiOut.send([0x80|ch,note,0],t+stepDur()); }catch(e){}
}
function sendMidiDrum(id,t){
  if(!midiOut) return;
  const note=GM_DRUM[id]; if(!note) return;
  try{ midiOut.send([0x99,note,100],t); midiOut.send([0x89,note,0],t+stepDur()*.6); }catch(e){}
}
/* Standard MIDI File（format 1，多轨） */
function vlq(n){ const b=[n&0x7f]; n>>=7; while(n>0){ b.unshift((n&0x7f)|0x80); n>>=7; } return b; }
const ascii=s=>{ const ok=/^[\x20-\x7e]*$/.test(s); const str=ok?s:'Track'; return [...str].map(c=>c.charCodeAt(0)&0x7f); };
const GM_PROG={piano:0,epiano:4,organ:19,pluck:46,guitar:24,bell:14,marimba:12,strings:48,pad:89,lead:80,bass:33,subbass:38,
  musicbox:10,vibes:11,koto:107,choir:52,flute:73,brass:62,chip:80,acid:38};
function midiTrackChunk(events,name,program,channel){
  const body=[]; let last=0;
  const nm=ascii(name);                     // 非 ASCII 声部名会回退成「Track」，长度必须按实际写入的字节算
  const push=(tick,...bytes)=>{ body.push(...vlq(tick-last),...bytes); last=tick; };
  push(0,0xFF,0x03,nm.length,...nm);
  if(program!=null) push(0,0xC0|channel,program);
  events.sort((a,b)=>a.tick-b.tick||a.seq-b.seq);
  for(const ev of events) push(ev.tick,...ev.bytes);
  body.push(0,0xFF,0x2F,0);
  return body;
}
function exportMidi(){
  const PPQ=960;
  let any=false;
  const chunks=[];
  for(const tr of state.tracks){
    const ev=[], ch=midiChan(tr), n=stepsOf(tr), stepT=(PPQ/4)*rateOf(tr);   // 每步时值随该声部速度缩放
    if(tr.kind==='inst'){
      for(let s=0;s<n;s++){
        if(tr.seq[s]===-1) continue;
        const nte=clamp(rowMidi(followRow(tr,s),tr.oct),0,127);   // 跟随和弦：导出用折算后的音高
        const vv=velOf(tr,s)==null?88:clamp(Math.round(velOf(tr,s)*127),1,127);
        ev.push({tick:s*stepT,seq:1,bytes:[0x90|ch,nte,vv]});
        ev.push({tick:(s+1)*stepT,seq:0,bytes:[0x80|ch,nte,0]});
      }
    }else{
      for(let s=0;s<n;s++) for(const id of drumHits(tr,s)){
        const n=GM_DRUM[id]; if(!n) continue;
        ev.push({tick:s*stepT,seq:1,bytes:[0x99,n,102]});
        ev.push({tick:s*stepT+stepT*.6,seq:0,bytes:[0x89,n,0]});
      }
    }
    if(!ev.length) continue;
    any=true;
    const program=tr.kind==='drum'?null:(GM_PROG[tr.inst]||0);
    chunks.push(midiTrackChunk(ev,tr.name,program,tr.kind==='drum'?9:ch));
  }
  if(!any){ toast('还没有任何音符，先摆几个旋钮或选个鼓节奏'); return; }
  const tempo=Math.round(6e7/bpm);
  const tempoTrack=[0,0xFF,0x51,3,(tempo>>16)&255,(tempo>>8)&255,tempo&255,
                    0,0xFF,0x58,4,4,2,24,8, 0,0xFF,0x2F,0];
  const u16=n=>[n>>8,n&255],u32=n=>[n>>24,(n>>16)&255,(n>>8)&255,n&255];
  const all=[tempoTrack,...chunks];
  const smf=[...u32(0x4D546864),...u32(6),0,1,...u16(all.length),...u16(PPQ)];
  for(const c of all) smf.push(...u32(0x4D54726B),...u32(c.length),...c);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([new Uint8Array(smf)],{type:'audio/midi'}));
  a.download=`multiseq-${ROOT_NAMES[rootIdx]}${MODES[modeIdx].name}-${bpm}bpm.mid`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  toast('已导出多轨 .mid（'+(all.length-1)+' 个声部）');
}
$('exportBtn').addEventListener('click',e=>{exportMidi();e.target.blur();});
