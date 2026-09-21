'use strict';
/* ============================================================
   step-sequencer · 20-ui
   渲染：声部卡 / 旋钮 / 鼓网格 / 和弦轨 UI 与段编辑 / 播放头
   ============================================================ */
/* ============ 渲染：全部声部平铺展示，直接编辑 ============ */
const view={cards:new Map(),csegs:[]};   // trackId → {el,kind,knobs:[{dial,ring,cap}],nums:[],dc:Map(lane→[cells])}
function fillInstSelect(sel,cur){
  sel.innerHTML='';
  const groups={};
  for(const it of INSTRUMENTS)(groups[it.group]=groups[it.group]||[]).push(it);
  for(const g in groups){
    const og=document.createElement('optgroup'); og.label=g;
    for(const it of groups[g]) og.appendChild(new Option(it.name,it.id));
    sel.appendChild(og);
  }
  sel.value=cur;
}
function trackDesc(tr){
  const barTxt=barsOf(tr)+' 小节 · '+stepsOf(tr)+' 步 · 速度 '+rateName(rateOf(tr));
  if(tr.kind==='drum'){
    const hits=DRUM_LANES.reduce((a,l)=>a+((tr.p[l.id]||'').match(/x/g)||[]).length,0);
    return '鼓机 · '+barTxt+' · '+(tr.drum&&tr.drum!=='custom'?PRESET_BY_ID(tr.drum).name+'·已可修改':'自定义')
      +' · '+hits+' hits';
  }
  const lo=noteName(rowMidi(ROWS-1,tr.oct)), hi=noteName(rowMidi(0,tr.oct));
  return INST_NAME(tr.inst)+' · '+barTxt+(tr.oct?' · '+(tr.oct>0?'+':'')+tr.oct+'八度':'')+' · '+lo+'–'+hi;
}
/* 每声部速度（每步时值）：1/16 默认 · 1/8 慢一倍 · 1/4 慢三倍（旋律与鼓都有） */
function chipRate(tr){
  const cur=rateOf(tr);
  const l=document.createElement('span'); l.className='chip seg';
  const t=document.createElement('span'); t.textContent='速度';
  l.appendChild(t);
  RATE_VALUES.forEach(v=>{
    const b=document.createElement('button');
    b.type='button'; b.className='seg-b'+(v===cur?' on':'');
    b.textContent=rateName(v);
    b.title='每步＝'+rateName(v)+'音符'+
      (v===1?'（默认，与其它声部同速）':v===2?'（本声部慢一倍：16 步走 2 小节）':'（本声部慢三倍：16 步走 4 小节）');
    b.addEventListener('click',()=>{ if(v!==cur) setRate(tr,v); });
    l.appendChild(b);
  });
  return l;
}
/* 每声部延时效果下拉（旋律与鼓声部共用） */
function chipFx(tr){
  const s=document.createElement('select');
  DELAY_PRESETS.forEach(p=>s.add(new Option(p.name,p.id)));
  s.value=tr.fx||'off';
  s.title='本声部延时效果：回声时间与 BPM 自动同步';
  s.addEventListener('change',()=>{setTrackFx(tr,s.value);save();toast('「'+tr.name+'」延时 → '+s.options[s.selectedIndex].text);});
  return s;
}
function chipRange(label,min,max,val,fmt,oninput){
  const l=document.createElement('label'); l.className='chip';
  const t=document.createElement('span'); t.textContent=label;
  const r=document.createElement('input'); r.type='range'; r.min=min; r.max=max; r.value=val;
  const v=document.createElement('span'); v.className='v'; v.textContent=fmt(val);
  r.addEventListener('input',()=>{v.textContent=fmt(+r.value);oninput(+r.value);});
  l.append(t,r,v);
  return l;
}
/* 小节数：胶囊里的分段小控件（1 / 2 / 3 / 4 小节） */
function chipSeg(label,opts,cur,onpick){
  const l=document.createElement('span'); l.className='chip seg';
  const t=document.createElement('span'); t.textContent=label;
  l.appendChild(t);
  opts.forEach(v=>{
    const b=document.createElement('button');
    b.type='button'; b.className='seg-b'+(v===cur?' on':'');
    b.textContent=v; b.title='这个声部占 '+v+' 小节（'+(v*BAR)+' 步）';
    b.addEventListener('click',()=>{ if(v!==cur) onpick(v); });
    l.appendChild(b);
  });
  return l;
}

function renderTracks(){
  renderChord();
  const stack=$('trackStack');
  stack.innerHTML=''; view.cards.clear();
  state.tracks.forEach((tr,i)=>stack.appendChild(buildCard(tr,i)));
  relayoutSteps();                               // 渲染完量一次行宽，决定 16 / 8 / 4 步一行
}

/* ---- 和弦进行轨：每段都能自由编辑（换和弦 / 改拍长 / 拆分 / 删除） ---- */
let chordEdit=null;
function segRange(i){
  let a=1;
  for(let k=0;k<i&&k<state.prog.length;k++) a+=state.prog[k].beats;
  const c=state.prog[i]||{beats:0};
  return {a,b:a+Math.max(0,c.beats)-1};
}
function segOfStep(g){
  const p=state.prog; if(!p.length) return -1;
  const cyc=progSteps();                             // 和弦轨按自己的长度独立循环
  g=((g%cyc)+cyc)%cyc;
  let acc=0;
  for(let i=0;i<p.length;i++){ acc+=p[i].beats*4; if(g<acc) return i; }
  return p.length-1;
}
/* ---- 常用和弦进行预设：当前风格的进行库 + 当前调式的常见走向 ----
   下拉即整条替换当前和弦（拍数自动铺满和弦轨长度），并即时试听 */
function buildProgPresetRow(){
  const L=scLen();
  const groups=[];
  if(SP_.prog&&SP_.prog.length) groups.push({label:STYLE().emoji+' '+STYLE().name+' 常用进行',plans:SP_.prog});
  if(PROG_PLANS[modeIdx]) groups.push({label:'🎚 '+MODES[modeIdx].name+' 常见走向',plans:PROG_PLANS[modeIdx]});
  if(!groups.length) return null;
  const cur=progKeyOf(state.prog), seen=new Set();
  const bar=document.createElement('div'); bar.className='cc-prow';
  const lb=document.createElement('span'); lb.className='lb'; lb.textContent='常用和弦进行';
  const sel=document.createElement('select'); sel.className='cc-prog';
  sel.title='选一条常用进行：整条替换当前和弦轨（自动铺满拍数），点一下即可试听';
  groups.forEach(g=>{
    const og=document.createElement('optgroup'); og.label=g.label;
    g.plans.forEach(pl=>{
      const norm=pl.map(d=>((((d|0)%L)+L)%L));
      const key=norm.filter((d,i)=>i===0||norm[i-1]!==d).join('-');   // 与 progKeyOf 同一套指纹
      if(seen.has(key)) return;                      // 风格库与调式库重复的走向只留一条
      seen.add(key);
      const o=new Option(norm.map(d=>ROMAN[d]||'').join(' – '),key);
      o.title=g.label+'：'+norm.map(d=>ROMAN[d]||'').join(' – ');
      og.appendChild(o);
    });
    if(og.children.length) sel.appendChild(og);
  });
  const custom=new Option('自定义（手动编辑 / 随机生成）','');
  custom.title='当前进行不在这份列表里——点方块换和弦，或用 🎲 / ⤵ 生成';
  sel.appendChild(custom);
  sel.value=seen.has(cur)?cur:'';                    // 命中就显示那一条，否则显示「自定义」
  sel.addEventListener('change',()=>{
    if(!sel.value) return;
    const n=setProgPlan(sel.value.split('-').map(Number));
    toast('和弦进行 → '+sel.options[sel.selectedIndex].text+'（'+n+' 个和弦 · '+progBeats()+' 拍）');
  });
  const info=document.createElement('span'); info.className='cur';
  const k=progKeyOf(state.prog);
  info.textContent='当前：'+(k?planRoman(state.prog):'—');
  info.title='当前和弦轨的级数走向（点方块换和弦后会跟着变）';
  bar.append(lb,sel,info);
  return bar;
}
function renderChord(){
  const box=$('chordCard'); if(!box) return;
  fitProg();
  box.innerHTML=''; view.csegs=[];
  const head=document.createElement('div'); head.className='cc-head';
  head.innerHTML=
    '<span class="cc-icon">🎹</span>'+
    '<span class="cc-title">和弦进行轨</span>'+
    '<span class="cc-sub">'+STYLE().name+' · '+ROOT_NAMES[rootIdx]+' '+MODES[modeIdx].name+
      ' · '+progBars()+' 小节 / '+progBeats()+' 拍 · '+state.prog.length+' 个和弦'+
      (state.progEdited?' · 手动':' · 跟随风格')+'</span>'+
    '<span class="cc-ctl"></span>'+
    '<div class="cc-btns">'+
      '<button class="cc-btn" data-act="rand" title="按当前风格再随机取一条进行">🎲 随机同风格</button>'+
      '<button class="cc-btn" data-act="from" title="按现有旋律反推一条和声">⤵ 从旋律推导</button>'+
      '<button class="cc-btn'+(chordMute?' off':'')+'" data-act="cmute" title="播放时和弦进行轨是否发声（每拍触发一次当前和弦）">'+
        (chordMute?'🔇 和弦声 关':'🔊 和弦声 开')+'</button>'+
    '</div>'+
    '<select class="cc-inst" title="和弦进行轨播放时的音色"></select>'+
    '<select class="cc-inst cc-fx" title="和弦进行轨的延时效果（回声时间随 BPM 自动同步）"></select>';
  head.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>{
    const a=b.dataset.act;
    if(a==='rand'){
      const nb=randomSameStyle(); audChord(state.prog[0]);
      toast('🎲 已按「'+STYLE().name+'」重新随机 '+state.prog.length+' 个和弦（个数与拍数不变，'+nb+' 小节 / '+progBeats()+' 拍）');
    }
    else if(a==='cmute'){
      chordMute=!chordMute; save();
      toast(chordMute?'和弦进行轨已静音（不再随播放发声）':'和弦进行轨开始发声 · 音色 '+INST_NAME(chordInstOf()));
      renderChord();
    }
    else{
      const mel=state.tracks.find(t=>t.kind==='inst'&&t.seq.some(v=>v>=0));
      if(!mel){ toast('还没有旋律可推导——先用 🎲，或随手在声部里摆几个音'); return; }
      setProg(deriveProgression(mel.seq),true); audChord(state.prog[0]);
      toast('⤵ 已按「'+mel.name+'」的旋律推导和声');
    }
  }));
  /* 和弦轨自己的小节数（与声部无关）+ 音量（无声像） */
  const ctl=head.querySelector('.cc-ctl');
  if(ctl){
    ctl.appendChild(chipSeg('小节',[1,2,3,4,8],progBars(),n=>setProgBars(n)));
    ctl.appendChild(chipRange('音量',0,100,Math.round(chordVol*100),v=>v,x=>{chordVol=x/100;applyChordFx();save();}));
  }
  /* 「延时 Mix」紧挨延时预设（下面和 cc-fx 一起包进 .cc-fxwrap），不再和音量挤在一起 */
  const mixChip=chipRange('Mix',0,100,Math.round((chordFxMix==null?1:chordFxMix)*100),v=>v,
    x=>{chordFxMix=x/100;applyChordFx();save();});
  mixChip.title='和弦进行轨延时效果量（干声 / 回声的比例，0＝只听干声）';
  const ciSel=head.querySelector('select.cc-inst');
  if(ciSel){
    fillInstSelect(ciSel,chordInstOf());
    ciSel.title='和弦进行轨播放时的音色（每拍触发一次当前和弦）';
    ciSel.addEventListener('change',()=>{
      chordInst=ciSel.value; save();
      toast('和弦进行轨音色 → '+INST_NAME(chordInst));
    });
  }
  const fxSel=head.querySelector('select.cc-fx');
  if(fxSel){
    DELAY_PRESETS.forEach(p=>fxSel.add(new Option(p.name,p.id)));
    fxSel.value=chordFx;
    fxSel.title='和弦进行轨的延时效果：回声时间随 BPM 自动同步（试听即时生效）';
    fxSel.addEventListener('change',()=>{
      setChordFx(fxSel.value); save();
      toast('和弦进行轨延时 → '+fxSel.options[fxSel.selectedIndex].text);
    });
    const wrap=document.createElement('span'); wrap.className='cc-fxwrap';
    head.insertBefore(wrap,fxSel);                 // 延时预设 + Mix 滑杆 并排成组
    wrap.append(fxSel,mixChip);
  }else{
    head.appendChild(mixChip);                     // 兜底：没有延时下拉时至少别把 Mix 弄丢
  }
  box.appendChild(head);

  const bars=document.createElement('div'); bars.className='cc-bars';
  state.prog.forEach((ch,i)=>{
    const l=chordLabel(ch), rg=segRange(i);
    const el=document.createElement('div');
    el.className='cseg'+(chordEdit===i?' on':'');
    el.style.flexGrow=String(clamp(ch.beats,1,12));
    el.title='点这里选择这个和弦（可试听）；右上角按钮可改拍长 / 拆分 / 删除';
    el.innerHTML=
      '<div class="ctop">'+
        '<span class="cbeat">'+ch.beats+' 拍 · '+rg.a+'–'+rg.b+'</span>'+
        '<button class="crib" data-a="len-" title="缩短 1 拍（还给相邻段）">‹</button>'+
        '<button class="crib" data-a="len+" title="延长 1 拍（从相邻段借）">›</button>'+
        '<button class="crib" data-a="split" title="从中间拆开，插入一个新和弦">⧉</button>'+
        '<button class="crib" data-a="del" title="删除这个和弦（拍数并入相邻段）">✕</button>'+
      '</div>'+
      '<div class="cname">'+l.name+'<em>'+l.deg+'</em></div>'+
      '<div class="ctones">'+l.tones.join(' · ')+'</div>';
    el.addEventListener('click',e=>{
      const a=(e.target&&e.target.dataset)?e.target.dataset.a:null;
      if(a){
        e.stopPropagation();
        if(a==='split') splitSeg(i);
        else if(a==='del') delSeg(i);
        else segLen(i,a==='len+'?1:-1);
        return;
      }
      chordEdit=(chordEdit===i?null:i);
      renderChord(); audChord(ch);
    });
    bars.appendChild(el); view.csegs[i]=el;
  });
  const add=document.createElement('button');
  add.type='button'; add.className='cc-add'; add.textContent='＋';
  add.title='把最后一个和弦拆成两段（也能用每段上的 ⧉ 在任意位置插入）';
  add.addEventListener('click',()=>splitSeg(state.prog.length-1));
  bars.appendChild(add);
  box.appendChild(bars);

  /* ---- 常用和弦进行预设（当前风格 / 当前调式），下拉即整条替换 ---- */
  const prow=buildProgPresetRow();
  if(prow) box.appendChild(prow);

  const pick=buildPicker(); if(pick) box.appendChild(pick);

  const hint=document.createElement('div'); hint.className='cc-hint';
  hint.innerHTML='每个方块的宽度＝它持续的拍数，<b>点方块</b>挑和弦（级数表里点一下即可替换并试听），'+
    '<b>‹ ›</b> 改拍长、<b>⧉</b> 拆分插入、<b>✕</b> 删除；方块的「第几拍」就是它覆盖的范围。'+
    '顶部右侧是<b>和弦音色</b>与<b>延时 Delay</b> 下拉（紧跟着 <b>Mix</b> 强度滑杆），试听即刻听得到回声；'+
    '方块下方的<b>常用和弦进行</b>是本风格 / 本调式的常用走向，选一条即整条替换（拍数自动铺满）。'+
    '各声部（鼓除外）卡片上的 <b>⟳ 吸附和弦</b> 可把现有音符一次性对齐到这条进行。';
  box.appendChild(hint);
}
/* 选择和弦的面板 */
function buildPicker(){
  if(chordEdit==null||!state.prog[chordEdit]) return null;
  const i=chordEdit, c=state.prog[i], rg=segRange(i), L=scLen();
  const box=document.createElement('div'); box.className='ccpick';
  const h=document.createElement('div'); h.className='ccpick-h';
  h.innerHTML='<span>正在编辑 <b>第 '+(i+1)+' 个和弦</b> · 覆盖第 '+rg.a+'–'+rg.b+' 拍 · 点级数即替换并试听</span>';
  const x=document.createElement('button');
  x.type='button'; x.className='ccpick-x'; x.textContent='✕'; x.title='收起';
  x.addEventListener('click',()=>{chordEdit=null;renderChord();});
  h.appendChild(x); box.appendChild(h);

  const row=document.createElement('div'); row.className='ccpick-row';
  for(let d=0;d<L;d++){
    const lab=chordLabel(mkChord(d,1,c.seventh));
    const chip=document.createElement('button');
    chip.type='button';
    chip.className='cc-deg'+(d===c.root?' on':'');
    chip.innerHTML='<b>'+lab.name+'</b><i>'+lab.deg+'</i>';
    chip.title='换成 '+lab.name;
    chip.addEventListener('click',()=>{ setSegChord(i,d,undefined); chordEdit=i; renderChord(); });
    row.appendChild(chip);
  }
  const rnd=document.createElement('button');
  rnd.type='button'; rnd.className='cc-deg';
  rnd.innerHTML='<b>🎲 随风格</b><i>随机级数</i>';
  rnd.title='从当前风格的和声进行库中随机挑一个级数';
  rnd.addEventListener('click',()=>{
    const L2=scLen(), plan=PLAN_LIB();
    const arr=(plan&&plan.length)?pick(plan):[0];
    const d=((((arr[(Math.random()*arr.length)|0]|0)%L2)+L2)%L2);
    setSegChord(i,d,undefined); chordEdit=i; renderChord();
  });
  row.appendChild(rnd);
  box.appendChild(row);

  const row2=document.createElement('div'); row2.className='ccpick-row';
  const sev=document.createElement('button');
  sev.type='button'; sev.className='cc-deg'+(c.seventh?' on':'');
  sev.innerHTML='<b>七和弦色彩</b><i>'+(c.seventh?'已开启':'关闭')+'</i>';
  sev.title='切换这个和弦的三和弦 / 七和弦（Cmaj7、Am7…）';
  sev.addEventListener('click',()=>{ setSegChord(i,c.root,!c.seventh); chordEdit=i; renderChord(); });
  row2.appendChild(sev);
  const au=document.createElement('button');
  au.type='button'; au.className='cc-deg';
  au.innerHTML='<b>🔊 试听</b><i>'+chordLabel(c).name+'</i>';
  au.addEventListener('click',()=>audChord(c));
  row2.appendChild(au);
  box.appendChild(row2);
  return box;
}
/* ---- 和弦段编辑操作 ---- */
function setSegChord(i,root,seventh){
  const p=fitProg(), c=p[i]; if(!c) return;
  pushUndo();
  p[i]=mkChord(root,c.beats,seventh===undefined?c.seventh:seventh);
  state.progEdited=true; save(); audChord(p[i]);
}
function splitSeg(i){
  const p=fitProg(), c=p[i]; if(!c) return;
  if(c.beats<2){ toast('这段只有 1 拍——先按 › 把它加长，再拆分'); return; }
  pushUndo();
  const a=Math.floor(c.beats/2), b=c.beats-a;
  p.splice(i,1,mkChord(c.root,a,c.seventh),mkChord(c.root,b,c.seventh));
  state.progEdited=true; chordEdit=i+1;
  renderChord(); save();
  toast('已插入第 '+(i+2)+' 个和弦——点它挑个新和弦');
}
function segLen(i,d){
  const p=fitProg(), c=p[i]; if(!c) return;
  const nb=p[i+1]||p[i-1];
  if(!nb){ toast('整曲只有这一个和弦'); return; }
  pushUndo();
  if(d>0){ if(nb.beats<2){ toast('相邻的和弦只剩 1 拍，给不出更多'); return; } c.beats++; nb.beats--; }
  else{ if(c.beats<2){ toast('最短 1 拍'); return; } c.beats--; nb.beats++; }
  state.progEdited=true; renderChord(); save();
}
function delSeg(i){
  const p=fitProg();
  if(p.length<2){ toast('至少保留一个和弦'); return; }
  pushUndo();
  const c=p[i], nb=p[i+1]||p[i-1];
  nb.beats+=c.beats; p.splice(i,1);
  if(chordEdit!=null) chordEdit=chordEdit>=p.length?null:chordEdit;
  state.progEdited=true; renderChord(); save();
  toast('已删除一个和弦，拍数并入相邻段');
}

function buildCard(tr,i){
  const el=document.createElement('section');
  el.className='tcard'+(tr.mute?' muted':'')+(tr.solo?' solo':'');
  el.style.setProperty('--tcb',tr.color.bg);
  el.style.setProperty('--tci',tr.color.ink);
  el.style.setProperty('--tcd',tr.color.deep);
  const card={el,kind:tr.kind,knobs:[],nums:[],dc:new Map()};
  view.cards.set(tr.id,card);

  /* ---- 头部：编号 / 名称 / 说明 / 圆形按钮 ---- */
  const head=document.createElement('div'); head.className='tc-head';
  head.innerHTML=
    '<span class="tc-num">'+(i+1)+'</span>'+
    '<input class="tc-name" maxlength="14" spellcheck="false">'+
    '<span class="tc-sub"></span><span class="spacer"></span>'+
    '<div class="tc-btns">'+
      '<button class="icon-btn" data-act="up" title="上移一位">↑</button>'+
      '<button class="icon-btn" data-act="down" title="下移一位">↓</button>'+
      (tr.kind==='inst'
        ?'<button class="icon-btn" data-act="opt" title="✨ 和声重排：按当前风格 + 和弦进行轨约束重排本声部">✨</button>'+
         '<button class="icon-btn" data-act="rand" title="按当前风格随机生成一条全新旋律">🎲</button>'
        :'<button class="icon-btn" data-act="rand" title="按当前风格随机生成一条律动">🎲</button>')+
      '<button class="icon-btn'+(tr.mute?' off':'')+'" data-act="mute" title="静音">M</button>'+
      '<button class="icon-btn'+(tr.solo?' off':'')+'" data-act="solo" title="独奏">S</button>'+
      '<button class="icon-btn" data-act="clear" title="清空本声部">⌫</button>'+
      '<button class="icon-btn" data-act="del" title="删除声部">✕</button>'+
    '</div>';
  const name=head.querySelector('.tc-name'); name.value=tr.name;
  name.addEventListener('input',()=>{tr.name=name.value||'声部';head.querySelector('.tc-sub').textContent=trackDesc(tr);save();});
  head.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>{
    const a=b.dataset.act;
    if(a==='opt') optimizeForTrack(tr);
    else if(a==='rand') (tr.kind==='drum'?randomizeDrum:randomizeForTrack)(tr);
    else if(a==='up'||a==='down') moveTrack(tr.id,a==='up'?-1:1);
    else if(a==='mute'){tr.mute=!tr.mute;renderTracks();}
    else if(a==='solo'){tr.solo=!tr.solo;renderTracks();}
    else if(a==='clear') clearTrack(tr);
    else if(a==='del') removeTrack(tr.id);
  }));
  el.appendChild(head);

  /* ---- 参数行 ---- */
  const meta=document.createElement('div'); meta.className='tc-meta';
  meta.appendChild(chipSeg('小节',[1,2,3,4,8],barsOf(tr),n=>setBars(tr,n)));
  meta.appendChild(chipRate(tr));
  if(tr.kind==='drum'){
    const want=(SP_.drums||[]);
    let alt=0;
    styleRankedDrums().forEach(p=>{
      const star=want.indexOf(p.id)>=0||p.id==='none'||tr.drum===p.id;
      const chip=document.createElement('button');
      chip.type='button';
      chip.className='chip btn-like'+(tr.drum===p.id?' on':'')+(star?' star':' alt');
      if(!star) alt++;
      chip.textContent=(star&&p.id!=='none'?'★ ':'')+p.name; chip.title=p.desc+(want.indexOf(p.id)>=0?'（'+STYLE().name+' 推荐）':'');
      chip.addEventListener('click',()=>{
        tr.p=patForBars(p.p,barsOf(tr)); tr.drum=p.id;
        refreshDrumCells(tr); refreshSub(tr); save();
        toast('已套用「'+p.name+'」'+(barsOf(tr)>1?'（已铺满 '+barsOf(tr)+' 小节）':'')+'——网格可直接继续修改');
      });
      meta.appendChild(chip);
    });
    if(alt){
      const more=document.createElement('button');
      more.type='button'; more.className='chip btn-like';
      more.textContent='更多 ▾';
      more.addEventListener('click',()=>{
        const open=meta.classList.toggle('showall');
        more.textContent=open?'收起 ▴':'更多 ▾';
      });
      meta.appendChild(more);
    }
    meta.appendChild(chipFx(tr));
    meta.appendChild(chipRange('强度',0,100,Math.round((tr.fxMix==null?1:tr.fxMix)*100),v=>v,x=>{tr.fxMix=x/100;save();}));
  }else{
    /* 「⟳ 对齐和弦」：一次性触发——点一下把本声部现有音符吸附到当前和弦进行轨；
       没有持久状态，和弦轨之后再变想重新对齐就再点一次。✨/🎼 恒用和弦轨做和声 */
    const fol=document.createElement('button');
    fol.type='button';
    fol.className='chip btn-like';
    fol.textContent='⟳ 吸附和弦 Snap';
    fol.title='把本声部现有音符一次性吸附（Snap）到最近的和弦音（和弦外的音就近挪进和弦内）';
    fol.addEventListener('click',()=>{
      const changed=reharmonizeTrack(tr);
      save();
      toast(changed?('「'+tr.name+'」已吸附到和弦进行轨（音高对齐）'):('「'+tr.name+'」的音符都已落在和弦内，无需吸附'));
    });
    const sel=document.createElement('select'); fillInstSelect(sel,tr.inst);
    sel.addEventListener('change',()=>{tr.inst=sel.value;refreshSub(tr);save();});
    const oct=document.createElement('select');
    [-2,-1,0,1,2].forEach(o=>oct.add(new Option(o===0?'原调':(o>0?'+'+o:o)+' 八度',o)));
    oct.value=tr.oct;
    oct.addEventListener('change',()=>{tr.oct=+oct.value;refreshSub(tr);refreshAll();save();});
    meta.append(fol,sel,oct,
      chipRange('音量',0,100,Math.round(tr.vol*100),v=>v,x=>{tr.vol=x/100;save();}),
      chipFx(tr),
      chipRange('强度',0,100,Math.round((tr.fxMix==null?1:tr.fxMix)*100),v=>v,x=>{tr.fxMix=x/100;save();}));
  }
  el.appendChild(meta);

  /* ---- 步进区 ---- */
  if(tr.kind==='inst'){
    card.stepArea=buildStepRow(tr,card); el.appendChild(card.stepArea);
  }else{
    card.stepArea=buildDrumGrid(tr,card); el.appendChild(card.stepArea);
    const note=document.createElement('div'); note.className='dnote';
    note.textContent='点击格子即可编辑每条音色；上面的预设只是起点，套用后仍可自由修改。';
    el.appendChild(note);
  }
  head.querySelector('.tc-sub').textContent=trackDesc(tr);
  return el;
}
function refreshSub(tr){
  const card=view.cards.get(tr.id); if(!card) return;
  const sub=card.el.querySelector('.tc-sub'); if(sub) sub.textContent=trackDesc(tr);
}

/* ---- 旋律声部：每小节若干行旋钮（宽度不够时把 16 步拆成 8 / 4 步一行，无需横向滚动） ---- */
let stepLine=BAR, drumLine=BAR;                   // 每行放多少步（自适应结果）
const CHUNKS=(n,per)=>{const o=[];for(let i=0;i<n;i+=per)o.push([i,Math.min(i+per,n)]);return o;};
function buildStepRow(tr,card){
  const wrap=document.createElement('div'); wrap.className='stepwrap';
  drawStepRow(tr,card,wrap,stepLine);
  return wrap;
}
function drawStepRow(tr,card,wrap,per){
  wrap.innerHTML=''; wrap.classList.toggle('multiline',per<BAR);
  card.knobs=[]; card.nums=[];
  const nb=barsOf(tr);
  for(let b=0;b<nb;b++){
    const line=document.createElement('div'); line.className='barrow';
    const tag=document.createElement('div'); tag.className='barnum'; tag.textContent=b+1;
    tag.title='第 '+(b+1)+' 小节（步 '+(b*BAR+1)+'–'+((b+1)*BAR)+'）';
    const body=document.createElement('div'); body.className='barbody';
    for(const [a,e] of CHUNKS(BAR,per)){         // 一小节按 per 步拆成若干行
      const seg=document.createElement('div'); seg.className='stline';
      const nums=document.createElement('div'); nums.className='stepnums';
      const row=document.createElement('div'); row.className='steprow';
      for(let k=a;k<e;k++){
        const s=b*BAR+k, gap=STEP_GAP(k)&&k>a;   // 行首不留分组缩进
        const n=document.createElement('div');
        n.className='stepnum'+(gap?' gap':''); n.textContent=k+1;
        nums.appendChild(n); card.nums[s]=n;
        const slot=document.createElement('div'); slot.className='slot'+(gap?' gap':'');
        const d=document.createElement('div');
        d.className='dial'; d.tabIndex=0; d.setAttribute('role','slider');
        d.setAttribute('aria-label','第'+(b+1)+'小节第'+(k+1)+'步音高');
        const ring=document.createElement('div'); ring.className='ring';
        const mk=document.createElement('div'); mk.className='mark'; ring.appendChild(mk);
        const cap=document.createElement('div'); cap.className='cap'; cap.textContent='—';
        d.append(ring,cap); slot.appendChild(d); row.appendChild(slot);
        card.knobs[s]={dial:d,ring,cap,mark:mk};
        attachDialEvents(d,tr,s);
        updateDial(tr,s);
      }
      seg.append(nums,row); body.appendChild(seg);
    }
    line.append(tag,body); wrap.appendChild(line);
  }
}

/* ---- 鼓声部：7 lane × (16 步 × 小节数) 自由编辑 ---- */
const getLane=(tr,id)=>{
  const n=stepsOf(tr);
  return (tr.p[id]||'').padEnd(n,'.').slice(0,n);
};
function setLaneCell(tr,id,s,val){
  const str=getLane(tr,id);
  tr.p[id]=str.substring(0,s)+(val?'x':'.')+str.substring(s+1);
}
function buildDrumGrid(tr,card){
  const wrap=document.createElement('div'); wrap.className='dgrid';
  drawDrumGrid(tr,card,wrap,drumLine);
  return wrap;
}
function drawDrumGrid(tr,card,wrap,per){
  wrap.innerHTML=''; card.dc.clear();
  if(per>=BAR) drawDrumLegacy(tr,card,wrap);      // 宽屏：每 lane 一行，可横向并排多小节（原样）
  else drawDrumRows(tr,card,wrap,per);            // 窄屏：按「小节 × 每行 per 步」分块铺开
  refreshDrumCells(tr);
}
/* 宽屏布局：7 lane × (16 步 × 小节数)，整行横向滚动 */
function drawDrumLegacy(tr,card,wrap){
  const nb=barsOf(tr);
  if(nb>1){                                     // 小节表头（多小节时）
    const h=document.createElement('div'); h.className='dl dhrow';
    const hn=document.createElement('div'); hn.className='dlname';
    const hall=document.createElement('div'); hall.className='dcells-all';
    for(let b=0;b<nb;b++){
      const grp=document.createElement('div'); grp.className='dcells';
      const lb=document.createElement('div'); lb.className='dcbar';
      lb.textContent='第 '+(b+1)+' 小节 · 步 '+(b*BAR+1)+'–'+((b+1)*BAR);
      grp.appendChild(lb); hall.appendChild(grp);
    }
    h.append(hn,hall); wrap.appendChild(h);
  }
  for(const lane of DRUM_LANES){
    const l=document.createElement('div'); l.className='dl';
    const nm=document.createElement('div'); nm.className='dlname'; nm.textContent=lane.label;
    const hall=document.createElement('div'); hall.className='dcells-all';
    const cells=[];
    for(let b=0;b<nb;b++){
      const grp=document.createElement('div'); grp.className='dcells';
      for(let k=0;k<BAR;k++){
        const s=b*BAR+k;
        const cell=makeDrumCell(tr,lane,s,b,k,STEP_GAP(k));
        grp.appendChild(cell); cells[s]=cell;
      }
      hall.appendChild(grp);
    }
    card.dc.set(lane.id,cells);
    l.append(nm,hall); wrap.appendChild(l);
  }
}
/* 窄屏布局：每块 = 一行「步 a–b」表头 + 7 条 lane，块与块纵向排开，不横向滚动 */
function drawDrumRows(tr,card,wrap,per){
  const nb=barsOf(tr);
  for(let b=0;b<nb;b++){
    for(const [a,e] of CHUNKS(BAR,per)){
      const block=document.createElement('div'); block.className='dlblock';
      const h=document.createElement('div'); h.className='dl dhrow';
      const hn=document.createElement('div'); hn.className='dlname';
      const hs=document.createElement('div'); hs.className='dcells-all';
      const hg=document.createElement('div'); hg.className='dcells';
      const lb=document.createElement('div'); lb.className='dcbar';
      lb.textContent=(nb>1?'第 '+(b+1)+' 小节 · ':'')+'步 '+(b*BAR+a+1)+'–'+(b*BAR+e);
      hg.appendChild(lb); hs.appendChild(hg); h.append(hn,hs); block.appendChild(h);
      for(const lane of DRUM_LANES){
        const l=document.createElement('div'); l.className='dl';
        const nm=document.createElement('div'); nm.className='dlname'; nm.textContent=lane.label;
        const hall=document.createElement('div'); hall.className='dcells-all';
        const grp=document.createElement('div'); grp.className='dcells';
        let cells=card.dc.get(lane.id);
        if(!cells){ cells=[]; card.dc.set(lane.id,cells); }
        for(let k=a;k<e;k++){
          const s=b*BAR+k;
          const cell=makeDrumCell(tr,lane,s,b,k,STEP_GAP(k)&&k>a);
          grp.appendChild(cell); cells[s]=cell;
        }
        hall.appendChild(grp); l.append(nm,hall); block.appendChild(l);
      }
      wrap.appendChild(block);
    }
  }
}
/* 单个鼓格：点击开 / 关并试听 */
function makeDrumCell(tr,lane,s,b,k,gap){
  const cell=document.createElement('div');
  cell.className='dcell'+(gap?' gap':'');
  cell.title='第 '+(b+1)+' 小节第 '+(k+1)+' 步';
  cell.addEventListener('click',()=>{
    const val=getLane(tr,lane.id)[s]!=='x';
    setLaneCell(tr,lane.id,s,val);
    cell.classList.toggle('on',val);
    tr.drum='custom'; refreshSub(tr); save();
    if(val){ ensureAudio(); if(audioCtx.state!=='running') audioCtx.resume(); playDrumHit(tr,lane.id,audioCtx.currentTime+.02); }
  });
  return cell;
}
function refreshDrumCells(tr){
  const card=view.cards.get(tr.id); if(!card||card.kind!=='drum') return;
  const n=stepsOf(tr);
  for(const lane of DRUM_LANES){
    const cells=card.dc.get(lane.id); if(!cells) continue;
    const str=getLane(tr,lane.id);
    for(let s=0;s<n;s++) if(cells[s]) cells[s].classList.toggle('on',str[s]==='x');
  }
}
function refreshAll(){
  for(const tr of state.tracks){
    const n=stepsOf(tr);
    if(tr.kind==='inst'){ for(let s=0;s<n;s++) updateDial(tr,s); }
    else refreshDrumCells(tr);
  }
}

/* ---- 旋钮状态 ---- */
function posOf(tr,s){return tr.seq[s]===-1?0:ROWS-tr.seq[s];}
const rowOfPos=p=>p===0?-1:ROWS-p;
function updateDial(tr,s){
  const card=view.cards.get(tr.id); if(!card||!card.knobs[s]) return;
  const p=posOf(tr,s), r=tr.seq[s];
  if(r!==-1) tr.last[s]=r;
  const v=velOf(tr,s);
  card.knobs[s].ring.style.transform=`rotate(${-p*360/9}deg)`;
  card.knobs[s].cap.textContent=r===-1?'—':noteName(rowMidi(r,tr.oct));
  card.knobs[s].mark.style.opacity=(r===-1||v==null)?1:(.35+.65*v);   // 手动调过力度：越强越实
  card.knobs[s].dial.classList.toggle('on',r!==-1);
  card.knobs[s].dial.setAttribute('aria-valuenow',String(p));
  card.knobs[s].dial.title=r===-1
    ?('第 '+(s+1)+' 步 · 空（点击 / 拖拽摆放音符）')
    :('第 '+(s+1)+' 步 · '+noteName(rowMidi(r,tr.oct))+'（第 '+(degOfRow(r)+1)+' 级）· 力度 '+(v==null?'默认 82':Math.round(v*100))+'%（滚轮调力度）');
}

/* ---- 播放头（所有卡片按各自小节数循环同步） ---- */
let lastHead=-2;
function paintHead(step){
  if(step===lastHead) return;
  for(const tr of state.tracks){
    const card=view.cards.get(tr.id); if(!card) continue;
    const n=stepsOf(tr), rt=rateOf(tr), s=step<0?-1:Math.floor(step/rt)%n;   // 速度慢的声部：播放头走得也慢
    if(card.kind==='inst'){
      for(let i=0;i<n;i++){
        const on=i===s;
        if(card.knobs[i]){card.knobs[i].dial.classList.toggle('ph',on);card.nums[i].classList.toggle('active',on);}
      }
    }else{
      for(const [,cells] of card.dc) for(let i=0;i<n;i++) if(cells[i]) cells[i].classList.toggle('ph',i===s);
    }
  }
  const cur=step<0?-1:segOfStep(step);
  view.csegs.forEach((el,i)=>{ if(el) el.classList.toggle('ph',i===cur); });
  lastHead=step;
}

/* ---- 自适应分行：宽度不够就把一小节的 16 步拆成 8 / 4 步一行（免横向滚动） ---- */
function redrawStepAreas(per){
  for(const tr of state.tracks){
    const card=view.cards.get(tr.id);
    if(card&&card.kind==='inst'&&card.stepArea) drawStepRow(tr,card,card.stepArea,per);
  }
}
function redrawDrumAreas(per){
  for(const tr of state.tracks){
    const card=view.cards.get(tr.id);
    if(card&&card.kind==='drum'&&card.stepArea) drawDrumGrid(tr,card,card.stepArea,per);
  }
}
function relayoutSteps(){
  const first=()=>document.querySelector('.stepwrap');
  if(first()){                                   // 旋律旋钮行：按实测行宽 16 → 8 → 4 逐档试
    let cur=stepLine;
    if(cur!==BAR){ redrawStepAreas(BAR); cur=BAR; }
    for(const per of [BAR,BAR/2,BAR/4]){
      if(per<cur){ redrawStepAreas(per); cur=per; }
      const w=first();
      if(!w||w.scrollWidth<=w.clientWidth+2) break;
    }
    stepLine=cur;
  }
  const narrow=(typeof window!=='undefined')&&window.innerWidth<=760;
  const want=narrow?BAR/2:BAR;                   // 鼓格：窄屏每行 8 步
  if(want!==drumLine){ redrawDrumAreas(want); drumLine=want; }
}
let rzTimer=0;
window.addEventListener('resize',()=>{           // 转屏 / 改窗口大小后重新分行
  if(rzTimer) clearTimeout(rzTimer);
  rzTimer=setTimeout(relayoutSteps,160);
});
