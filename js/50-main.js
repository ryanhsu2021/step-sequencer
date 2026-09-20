'use strict';
/* ============================================================
   step-sequencer · 50-main
   初始乐句 · 全部清空 · 控件接线 · 启动
   ============================================================ */
/* ============ 初始乐句 / 全部清空 ============ */
const DEMO_MEL=[5,-1,4,3, 2,-1,1,2, 4,-1,3,2, 3,4,5,7];
function seedDefault(){
  busCache.clear();
  state.progBars=2;                                  // 和弦轨默认 2 小节（8 拍），与声部小节数无关
  state.prog=randomProgression(); state.progEdited=false;
  const mel=makeTrack('inst','主旋律',(SP_.mel&&SP_.mel[0])||'epiano',0);
  mel.seq=DEMO_MEL.slice();
  mel.userSeq=mel.seq.slice();                       // 示例乐句视作用户素材：✨ 保留它的强拍锚点
  const bass=makeTrack('inst','贝斯',(SP_.bassI&&SP_.bassI[0])||'bass',-1);
  const arp=makeTrack('inst','和弦音型',(SP_.chordI&&SP_.chordI[0])||'pluck',0);
  const drum=makeTrack('drum','鼓组');
  state.tracks=[mel,bass,arp,drum];
  recolor();
  fillBass(bass,state.prog); fillArp(arp,state.prog);
  const sd=styleDrumPick(1);
  drum.p=sd.p; drum.drum=sd.id;
  renderTracks(); save();
}
/* 清空音序：所有声部的音符/鼓点清零，声部本身、音色与小节数保留 */
function clearSeqs(){
  state.tracks.forEach(t=>{
    if(t.kind==='drum'){ t.p={}; t.drum='custom'; }
    else resetSeq(t);
  });
  renderTracks(); save();
  toast('已清空所有声部的音序（音色、小节数与和弦进行轨保留）');
}
/* 清空声部：删除全部声部，只保留和弦进行轨（其长度独立，自动留一个空声部方便重新开始） */
function clearTracksKeep(){
  busCache.clear();
  state.tracks=[];
  const t=makeTrack('inst');
  t.name='主旋律';
  state.tracks=[t];
  recolor(); save(); renderTracks();
  toast('已删除所有声部，只保留和弦进行轨（留了一个空声部，和弦进行原样保留）');
}
/* ============ 控件接线 ============ */
$('bpm').addEventListener('input',e=>{bpm=+e.target.value;$('bpmVal').textContent=bpm;save();});
$('swing').addEventListener('input',e=>{swingPct=+e.target.value;$('swingVal').textContent=swingPct+'%';save();});
$('vol').addEventListener('input',e=>{volume=+e.target.value;$('volVal').textContent=volume;applyVolume();save();});

const addVoice=()=>{
  const t=addTrack('inst');
  if(t){ t.name='声部 '+state.tracks.filter(x=>x.kind==='inst').length; renderTracks(); save(); toast('已添加旋律声部，选个音色开始吧'); }
};
$('addVoiceBtn').addEventListener('click',addVoice);
$('addDrumBtn').addEventListener('click',()=>{
  const d=addTrack('drum',{name:'鼓组'});
  if(d){ renderTracks(); save(); toast('已添加鼓声部：套用预设或直接点击格子编辑'); }
});

const rootSel=$('rootSel'), modeSel=$('modeSel'), styleSel=$('styleSel');
ROOT_NAMES.forEach((n,i)=>rootSel.add(new Option(n,i)));
MODES.forEach((m,i)=>modeSel.add(new Option(m.name,i)));
STYLES.forEach((s,i)=>styleSel.add(new Option(s.emoji+' '+s.name,i)));
const styleTip=()=>{const s=STYLE();return s.name+' · '+s.desc+' · 建议 BPM '+s.bpm[0]+'–'+s.bpm[1]+(s.swing>5?' · 摇摆 '+s.swing+'%':'');};
styleSel.title=styleTip();
rootSel.addEventListener('change',()=>{rootIdx=+rootSel.value;refreshAll();renderChord();save();});
modeSel.addEventListener('change',()=>{modeIdx=+modeSel.value;refreshAll();renderChord();save();});
styleSel.addEventListener('change',()=>{
  setStyle(+styleSel.value);                     // 只同步 BPM / 摇摆 等全局项
  styleSel.title=styleTip();
  const d=state.tracks.find(t=>t.kind==='drum');
  if(d&&d.drum!=='custom'){                      // 鼓声部随风格重新生成（手改过的保留）
    const s=styleDrumPick(barsOf(d)); d.p=s.p; d.drum=s.id;
    refreshDrumCells(d); refreshSub(d);
  }
  if(!state.progEdited){ state.prog=randomProgression(); reharmonizeAll(); }   // 和弦进行轨跟随风格（手动改过则保留）
  fitProg();
  $('bpm').value=bpm; $('bpmVal').textContent=bpm;
  $('swing').value=swingPct; $('swingVal').textContent=swingPct+'%';
  renderTracks(); save();
});

$('arrangeBtn').addEventListener('click',e=>{autoArrange();e.target.blur();});
$('clearSeqBtn').addEventListener('click',e=>{clearSeqs();e.target.blur();});
$('clearTracksBtn').addEventListener('click',e=>{clearTracksKeep();e.target.blur();});

window.addEventListener('keydown',e=>{
  if(e.code!=='Space'||e.repeat) return;
  const ae=document.activeElement;
  if(ae&&(ae.tagName==='BUTTON'||ae.tagName==='INPUT'||ae.tagName==='SELECT')) return;
  e.preventDefault(); togglePlay();
});
window.addEventListener('beforeunload',()=>{ if(!audioCtx) save(); });

/* ============ 启动 ============ */
(function init(){
  if(!loadSaved()) seedDefault();
  $('bpm').value=bpm;       $('bpmVal').textContent=bpm;
  $('swing').value=swingPct;$('swingVal').textContent=swingPct+'%';
  $('vol').value=volume;    $('volVal').textContent=volume;
  rootSel.value=String(rootIdx); modeSel.value=String(modeIdx);
  styleSel.value=String(styleIdx); styleSel.title=styleTip();
  renderTracks();
  initMidi();
})();
