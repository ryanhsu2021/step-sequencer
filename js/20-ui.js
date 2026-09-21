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
  s.addEventListener('change',()=>{setTrackDelay(tr,s.value);toast('「'+tr.name+'」延时 → '+s.options[s.selectedIndex].text);});
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
  /* 手风琴一致性：至多一个声部展开。都收起时保持收起（不强制打开）；有多个时只留 openTrackId / 第一个 */
  const opened=state.tracks.filter(t=>t.open!==false);
  if(opened.length>1){
    const keep=opened.find(t=>t.id===openTrackId)||opened[0];
    state.tracks.forEach(t=>{ t.open=(t.id===keep.id); });
    openTrackId=keep.id;
  }else openTrackId=opened.length?opened[0].id:null;
  state.tracks.forEach((tr,i)=>stack.appendChild(buildCard(tr,i)));
  renderMixer();                                 // 调音台跟声部列表同源，一起重画
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
      setChordMute(!chordMute);
      toast(chordMute?'和弦进行轨已静音（不再随播放发声）':'和弦进行轨开始发声 · 音色 '+INST_NAME(chordInstOf()));
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
    ctl.appendChild(chipRange('音量',0,100,Math.round(chordVol*100),v=>v,x=>setChordVolume(x/100)));
  }
  /* 「延时 Mix」紧挨延时预设（下面和 cc-fx 一起包进 .cc-fxwrap），不再和音量挤在一起 */
  const mixChip=chipRange('Mix',0,100,Math.round((chordFxMix==null?1:chordFxMix)*100),v=>v,
    x=>setChordFxMix(x/100));
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
  state.progEdited=true; syncFollowers(); save(); audChord(p[i]);
}
function splitSeg(i){
  const p=fitProg(), c=p[i]; if(!c) return;
  if(c.beats<2){ toast('这段只有 1 拍——先按 › 把它加长，再拆分'); return; }
  pushUndo();
  const a=Math.floor(c.beats/2), b=c.beats-a;
  p.splice(i,1,mkChord(c.root,a,c.seventh),mkChord(c.root,b,c.seventh));
  state.progEdited=true; renderChord(); syncFollowers(); save();
  toast('已插入第 '+(i+2)+' 个和弦——点它挑个新和弦');
}
function segLen(i,d){
  const p=fitProg(), c=p[i]; if(!c) return;
  const nb=p[i+1]||p[i-1];
  if(!nb){ toast('整曲只有这一个和弦'); return; }
  pushUndo();
  if(d>0){ if(nb.beats<2){ toast('相邻的和弦只剩 1 拍，给不出更多'); return; } c.beats++; nb.beats--; }
  else{ if(c.beats<2){ toast('最短 1 拍'); return; } c.beats--; nb.beats++; }
  state.progEdited=true; renderChord(); syncFollowers(); save();
}
function delSeg(i){
  const p=fitProg();
  if(p.length<2){ toast('至少保留一个和弦'); return; }
  pushUndo();
  const c=p[i], nb=p[i+1]||p[i-1];
  nb.beats+=c.beats; p.splice(i,1);
  if(chordEdit!=null) chordEdit=chordEdit>=p.length?null:chordEdit;
  state.progEdited=true; renderChord(); syncFollowers(); save();
  toast('已删除一个和弦，拍数并入相邻段');
}

/* ============================================================
   调音台（Mixer）：页面最底部，纵向各声部一条通道条
   每条 = 声部名 + 色标 / 音色 / 效果 / 静音独奏 / 音量推子 / 声像
   ============================================================ */
/* 音色名太长会挤爆通道条：取中文别名，英文名截断到 8 字符 */
function shortInst(id){
  const nm=INST_NAME(id)||'';
  const cn=nm.match(/[\u4e00-\u9fa5]{1,4}/);
  return cn?cn[0]:(nm.length>8?nm.slice(0,8):nm);
}
/* 原生 range 在桩里没有 setter：包一层，方便测试直接驱动 */
function setRangeVal(r,v){ r.value=v; if(r.dispatchEvent) r.dispatchEvent('input',{target:r}); }
/* 延时效果开关 + 下拉 + Mix：每条通道条共用（鼓声部不生成它，直接显示「无延时」）。
   开关是<b>每条通道条自己的</b>——默认关，所以一行里只要有一条旋律声部开着延时，
   那条通道条的「效果」格就会占两行，其余通道条按同一高度对齐，效果格不再空出大片留白。 */
/* 每个开关需要唯一 id 才能让 label 用 for 指过来（避免依赖 label 嵌套） */
let mxFxSeq=0;
function mxFxControl(o){
  const wrap=document.createElement('span'); wrap.className='mx-fxbox';
  /* 上排：开关 + 预设下拉 */
  const rowA=document.createElement('span'); rowA.className='mx-fxwrap';
  const cb=document.createElement('input'); cb.type='checkbox';
  cb.className='mx-fxon';
  const id='mxon-'+String(mxFxSeq++);
  cb.id=id;
  const on0=o.on();
  cb.checked=on0;
  /* label 显式指向 checkbox（htmlFor），不靠嵌套——避免任何重排/克隆把节点搬走 */
  const lab=document.createElement('label'); lab.className='mx-hasfx';
  lab.htmlFor=id; lab.setAttribute('for',id);
  lab.textContent='延时';
  cb.title='给「'+o.name+'」开 / 关延时（回声时间随 BPM 自动同步）';
  lab.title=cb.title;
  const s=document.createElement('select');
  s.className='mx-fxsel';
  DELAY_PRESETS.forEach(p=>s.add(new Option(p.name,p.id)));
  s.value=o.val();
  s.disabled=!on0;
  s.title='「'+o.name+'」延时效果（回声时间随 BPM 自动同步）';
  cb.addEventListener('change',()=>{
    o.set(on0?'off':(s.value==='off'?'quarter':s.value));
    toast(cb.checked?('🎚 「'+o.name+'」延时已开 → '+s.options[s.selectedIndex].text)
                    :('「'+o.name+'」延时已关'));
  });
  s.addEventListener('change',()=>{
    if(s.value==='off'){ o.set('off'); toast('「'+o.name+'」延时已关'); return; }
    o.set(s.value);
    toast('「'+o.name+'」延时 → '+s.options[s.selectedIndex].text);
  });
  rowA.append(cb,lab,s);
  /* 下排：强度 Mix 滑杆（关着的时候禁用，避免误导） */
  const rowB=document.createElement('span'); rowB.className='mx-fxrow';
  const mix=document.createElement('input'); mix.type='range'; mix.min=0; mix.max=100;
  mix.value=Math.round((o.mix()==null?1:o.mix())*100);
  mix.disabled=!on0;
  mix.title='延时强度 Mix（干声 / 回声的比例）';
  const mv=document.createElement('span'); mv.className='mx-v'; mv.textContent=mix.value;
  mix.addEventListener('input',()=>{ mv.textContent=mix.value; o.setMix(+mix.value/100); });
  rowB.append(mix,mv);
  wrap.append(rowA,rowB);
  return wrap;
}
/* 一条通道条：上行「色点 · 编号 · 名称/音色 · 效果」，下行「M S · 推子 · 声像」 */
function mixerStrip(o){
  const row=document.createElement('div');
  row.className='mx-strip'+(o.kind==='chord'?' chord':'');
  if(o.mute) row.classList.add('mx-muted');
  if(o.solo) row.classList.add('mx-solo');

  const dot=document.createElement('span'); dot.className='mx-dot';
  if(o.bg) dot.style.background=o.bg;
  if(o.bg) row.style.setProperty('--tcd',o.bg);   /* 通道条左侧色带与声部卡同色 */
  dot.title=o.title||o.name;

  const tag=document.createElement('span'); tag.className='mx-tag'; tag.textContent=o.tag||'';
  tag.title=o.name;

  const cap=document.createElement('span'); cap.className='mx-cap';
  const nm=document.createElement('b'); nm.className='mx-name'; nm.textContent=o.name;
  const sub=document.createElement('i'); sub.className='mx-sub'; sub.textContent=o.sub||'';
  sub.title=o.subFull||o.sub||'';
  cap.append(nm,sub);

  const fx=document.createElement('span'); fx.className='mx-fx';
  fx.appendChild(o.fxEl);

  const ctl=document.createElement('span'); ctl.className='mx-ctl';
  const mk=cls=>{ const b=document.createElement('button'); b.type='button'; b.className='mx-btn '+cls; return b; };
  const mb=mk('mx-m'+(o.mute?' on':''));   mb.textContent='M'; mb.title='静音（点亮＝已静音）';
  const sb=mk('mx-s'+(o.solo?' on':''));   sb.textContent='S'; sb.title='独奏（点亮＝只听它）';
  if(!o.canSolo){ sb.disabled=true; sb.title='和弦进行轨没有独奏——用「和弦声」开关控制它'; }
  mb.addEventListener('click',()=>o.onMute(!o.mute));
  sb.addEventListener('click',()=>{ if(o.canSolo) o.onSolo(!o.solo); });
  ctl.append(mb,sb);

  const fader=document.createElement('span'); fader.className='mx-fader';
  const r=document.createElement('input'); r.type='range'; r.min=0; r.max=100;
  r.value=Math.round((o.vol==null?.85:o.vol)*100);
  r.title='「'+o.name+'」音量';
  const v=document.createElement('span'); v.className='mx-v'; v.textContent=r.value;
  r.addEventListener('input',()=>{ v.textContent=r.value; o.onVol(+r.value/100); });
  fader.append(r,v);

  const pan=document.createElement('span'); pan.className='mx-pan';
  if(o.pan==null||o.panOff){
    pan.classList.add('mx-pan-off'); pan.textContent='—';
    pan.title=(o.kind==='drum'?'鼓声部':'和弦进行轨')+'不走声像（保持居中）';
  }else{
    const pr=document.createElement('input'); pr.type='range'; pr.min=-100; pr.max=100;
    pr.value=Math.round(o.pan*100); pr.title='「'+o.name+'」声像：L 左 / R 右';
    const pv=document.createElement('span'); pv.className='mx-v';
    pv.textContent=(o.pan>0?'R':o.pan<0?'L':'C')+Math.abs(Math.round(o.pan*100));
    pr.addEventListener('input',()=>{
      const x=+pr.value;
      pv.textContent=(x>0?'R':x<0?'L':'C')+Math.abs(x);
      o.onPan(x/100);
    });
    pan.append(pr,pv);
  }

  row.append(dot,tag,cap,fx,ctl,fader,pan);
  return row;
}
/* 渲染整台调音台：纵向各声部 + 和弦进行轨总线（横向换行，一行至少放得下 3 条） */
function renderMixer(){
  const box=$('mixerCard'); if(!box) return;
  const soloSome=soloActive();
  const on=isPlaying;
  box.innerHTML='';
  const head=document.createElement('div'); head.className='mx-head';
  head.innerHTML=
    '<span class="mx-icon">🎚</span><span class="mx-title">调音台 Mixer</span>'+
    '<span class="mx-hsub">'+state.tracks.length+' 个声部 + 和弦轨 · 拖动推子即调音量，M 静音 / S 独奏'+
      (soloSome?' · <b class="mx-warn">独奏中</b>':'')+'</span>';
  const live=document.createElement('span'); live.className='mx-live'+(on?' on':'');
  live.textContent=on?'● 播放中':'○ 已停止';
  live.title='播放中改推子 / M / S 立刻听得到';
  head.appendChild(live);
  box.appendChild(head);

  const grid=document.createElement('div'); grid.className='mx-grid';
  state.tracks.forEach((tr,i)=>{
    const drum=tr.kind==='drum';
    grid.appendChild(mixerStrip({
      kind:'track',tag:String(i+1),name:tr.name,bg:tr.color&&tr.color.bg,
      title:'第 '+(i+1)+' 个声部「'+tr.name+'」',mute:!!tr.mute,solo:!!tr.solo,canSolo:true,
      sub:drum?('鼓机 · '+INST_NAME(tr.inst)):shortInst(tr.inst),
      subFull:drum?'鼓机合成音源':INST_NAME(tr.inst),
      fxEl:(()=>{
        if(drum){
          const c=document.createElement('span');
          c.className='mx-nofx'; c.textContent='— 无延时';
          c.title='鼓声部不做延时：给鼓点加回声容易糊，音量用右侧推子调';
          return c;
        }
        return mxFxControl({
          name:tr.name, on:()=>(tr.fx||'off')!=='off', val:()=>tr.fx||'off', mix:()=>tr.fxMix,
          set:v=>setTrackDelay(tr,v), setMix:v=>setTrackFxMix(tr,v),
        });
      })(),
      vol:tr.vol,
      pan:drum?null:tr.pan,
      onVol:v=>setTrackVol(tr,v),
      onPan:v=>setTrackPan(tr,v),
      onMute:v=>{ setTrackMute(tr,v); toast(v?('🔇 「'+tr.name+'」已静音'):('🔊 「'+tr.name+'」取消静音')); },
      onSolo:v=>{ setTrackSolo(tr,v); toast(v?('🎧 独奏：「'+tr.name+'」（其它声部暂时不发声）'):'🎧 取消独奏'); },
    }));
  });
  /* 和弦进行轨：它也有自己的总线（音量 / 静音 / 延时都能在这调） */
  grid.appendChild(mixerStrip({
    kind:'chord',tag:'♩',name:'和弦进行轨',bg:'#141414',
    title:'和弦进行轨的总线',mute:!!chordMute,solo:false,canSolo:false,
    sub:shortInst(chordInstOf()),subFull:'和弦音色：'+INST_NAME(chordInstOf()),
    fxEl:mxFxControl({
      name:'和弦进行轨', on:()=>(chordFx||'off')!=='off', val:()=>chordFx||'off', mix:()=>chordFxMix,
      set:v=>setChordFx(v), setMix:v=>setChordFxMix(v),
    }),
    vol:chordVol,
    pan:null,
    onVol:v=>setChordVolume(v),
    onPan:()=>{},
    onMute:v=>{ setChordMute(v); toast(v?'🔇 和弦进行轨已静音（不再随播放发声）':'🔊 和弦进行轨开始发声 · 音色 '+INST_NAME(chordInstOf())); },
    onSolo:()=>{},
  }));
  box.appendChild(grid);
  const hint=document.createElement('div'); hint.className='mx-hint';
  hint.innerHTML='每个声部一条通道条：<b>推子</b>＝音量（拖动即时生效）、<b>M</b> 静音、<b>S</b> 独奏；'+
    '中间的<b>延时</b>开关默认关——勾上才生效，右边的下拉选回声预设、下面的滑杆调回声比例'+
    '（鼓声部不做延时，所以显示「— 无延时」）；'+
    '右侧 <b>L / C / R</b> 是声像（鼓与和弦轨保持居中）。'+
    '这里和声部卡里的参数是<b>同一份状态</b>——在哪边改都会一起变，也会一起存档。';
  box.appendChild(hint);
}

function buildCard(tr,i){
  const isOpen=tr.open!==false;
  const el=document.createElement('section');
  el.className='tcard'+(tr.mute?' muted':'')+(tr.solo?' solo':'')+(isOpen?' open':' collapsed');
  el.style.setProperty('--tcb',tr.color.bg);
  el.style.setProperty('--tci',tr.color.ink);
  el.style.setProperty('--tcd',tr.color.deep);
  const card={el,kind:tr.kind,knobs:[],nums:[],cells:[],dc:new Map()};
  view.cards.set(tr.id,card);

  /* ---- 头部：编号 / 展开▸ / 名称 / 说明 / 圆形按钮（DAW 式分区：混音 · 生成 · 排序 · 危险） ---- */
  const head=document.createElement('div'); head.className='tc-head';
  head.innerHTML=
    '<button class="tc-caret" data-act="fold" aria-expanded="'+(isOpen?'true':'false')+'" title="'+
      (isOpen?'收起音序面板':'展开音序面板')+'"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
    '<span class="tc-num">'+(i+1)+'</span>'+
    '<input class="tc-name" maxlength="14" spellcheck="false">'+
    '<span class="tc-sub"></span><span class="spacer"></span>'+
    '<div class="tc-btns">'+
      '<span class="tb-group">'+
        '<button class="icon-btn'+(tr.mute?' m-on':'')+'" data-act="mute" title="静音（点亮＝已静音）">M</button>'+
        '<button class="icon-btn'+(tr.solo?' s-on':'')+'" data-act="solo" title="独奏（点亮＝独奏中）">S</button>'+
      '</span>'+
      '<span class="tb-sep"></span>'+
      '<span class="tb-group">'+
        (tr.kind==='inst'
          ?'<button class="icon-btn" data-act="opt" title="✨ 和声重排：按当前风格 + 和弦进行轨约束重排本声部">✨</button>'+
           '<button class="icon-btn" data-act="rand" title="按当前风格随机生成一条全新旋律">🎲</button>'
          :'<button class="icon-btn" data-act="rand" title="按当前风格随机生成一条律动">🎲</button>')+
      '</span>'+
      '<span class="tb-sep"></span>'+
      '<span class="tb-group">'+
        '<button class="icon-btn ghost" data-act="up" title="上移一位">↑</button>'+
        '<button class="icon-btn ghost" data-act="down" title="下移一位">↓</button>'+
      '</span>'+
      '<span class="tb-sep"></span>'+
      '<span class="tb-group">'+
        '<button class="icon-btn ghost danger" data-act="clear" title="清空本声部">⌫</button>'+
        '<button class="icon-btn ghost danger" data-act="del" title="删除声部">✕</button>'+
      '</span>'+
    '</div>';
  const name=head.querySelector('.tc-name'); name.value=tr.name;
  name.addEventListener('input',()=>{tr.name=name.value||'声部';head.querySelector('.tc-sub').textContent=trackDesc(tr);save();});
  head.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>{
    const a=b.dataset.act;
    if(a==='fold') toggleOpen(tr);
    else if(a==='opt') optimizeForTrack(tr);
    else if(a==='rand') (tr.kind==='drum'?randomizeDrum:randomizeForTrack)(tr);
    else if(a==='up'||a==='down') moveTrack(tr.id,a==='up'?-1:1);
    else if(a==='mute') setTrackMute(tr,!tr.mute);
    else if(a==='solo') setTrackSolo(tr,!tr.solo);
    else if(a==='clear') clearTrack(tr);
    else if(a==='del') removeTrack(tr.id);
  }));
  /* 摘要行：收起时在头部下方给一行「小节 · 速度 · 音色 · 跟随」小标，方便不开面板也能看清状态 */
  const summary=document.createElement('div'); summary.className='tc-sum';
  summary.innerHTML='<span class="s-sum"></span>';
  el.append(head,summary);

  /* 收起态：只保留头部 + 摘要（点击标题区也能展开） */
  const toggleFromBar=e=>{
    if(e.target.closest('button,input,select,label')) return;
    toggleOpen(tr);
  };
  head.addEventListener('click',toggleFromBar);
  summary.addEventListener('click',()=>toggleOpen(tr));

  const pane=document.createElement('div'); pane.className='tc-pane';
  el.appendChild(pane);

  /* ---- 参数行（DAW 式分区：编排 · 鼓组/和声 · 音色 · 混音 · 效果） ---- */
  const meta=document.createElement('div'); meta.className='tc-meta';
  const tmGroup=(lb)=>{
    const g=document.createElement('span'); g.className='tm-group';
    if(lb){ const t=document.createElement('span'); t.className='tm-lb'; t.textContent=lb; g.appendChild(t); }
    meta.appendChild(g); return g;
  };
  const gSeq=tmGroup('编排');
  gSeq.appendChild(chipSeg('小节',[1,2,3,4,8],barsOf(tr),n=>setBars(tr,n)));
  gSeq.appendChild(chipRate(tr));
  if(tr.kind==='drum'){
    const want=(SP_.drums||[]);
    let alt=0;
    const gPreset=tmGroup('鼓组');
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
      gPreset.appendChild(chip);
    });
    if(alt){
      const more=document.createElement('button');
      more.type='button'; more.className='chip btn-like';
      more.textContent='更多 ▾';
      more.addEventListener('click',()=>{
        const open=meta.classList.toggle('showall');
        more.textContent=open?'收起 ▴':'更多 ▾';
      });
      gPreset.appendChild(more);
    }
    /* 鼓组：不要延时效果（鼓点加回声容易糊），改为音量控制（与调音台推子同一份状态） */
    const gMix=tmGroup('混音');
    gMix.appendChild(chipRange('音量',0,100,Math.round((tr.vol==null?.85:tr.vol)*100),v=>v,x=>setTrackVol(tr,x/100)));
  }else{
    /* 「跟随和弦进行」开关：开启时该声部音高实时随和弦轨吸附（改和弦即跟随），
       关闭时不动音高；回到和弦内音不再二次改动（幂等）。✨/🎼 恒用和弦轨做和声 */
    const gHar=tmGroup('和声');
    const fol=document.createElement('button');
    fol.type='button';
    fol.className='chip btn-like switch'+(tr.follow?' on':'');
    fol.setAttribute('role','switch');
    fol.setAttribute('aria-checked',tr.follow?'true':'false');
    fol.innerHTML='<span class="sw-lb">跟随和弦</span><span class="sw-track"><i></i></span>';
    fol.title=tr.follow
      ?'跟随和弦进行：已开启——调整上方和弦轨时，本声部音高会自动吸附到和弦音（已落在和弦内的音不会二次改动）。点一下关闭'
      :'跟随和弦进行：已关闭——播放与编辑互不干扰。点一下开启，现有音符会立即吸附一次，之后继续跟随';
    fol.addEventListener('click',()=>toggleFollow(tr));
    gHar.appendChild(fol);
    const gVoice=tmGroup('音色');
    const sel=document.createElement('select'); fillInstSelect(sel,tr.inst);
    sel.addEventListener('change',()=>{tr.inst=sel.value;refreshSub(tr);save();});
    const oct=document.createElement('select');
    [-2,-1,0,1,2].forEach(o=>oct.add(new Option(o===0?'原调':(o>0?'+'+o:o)+' 八度',o)));
    oct.value=tr.oct;
    oct.addEventListener('change',()=>{tr.oct=+oct.value;refreshSub(tr);refreshAll();save();});
    gVoice.append(sel,oct);
    const gMix=tmGroup('混音');
    gMix.appendChild(chipRange('音量',0,100,Math.round(tr.vol*100),v=>v,x=>setTrackVol(tr,x/100)));
    const gFx=tmGroup('效果');
    gFx.appendChild(chipFx(tr));
    gFx.appendChild(chipRange('强度',0,100,Math.round((tr.fxMix==null?1:tr.fxMix)*100),v=>v,x=>setTrackFxMix(tr,x/100)));
  }
  pane.appendChild(meta);

  /* ---- 步进区 ---- */
  if(tr.kind==='inst'){
    card.stepArea=buildStepRow(tr,card); pane.appendChild(card.stepArea);
  }else{
    card.stepArea=buildDrumGrid(tr,card); pane.appendChild(card.stepArea);
    const note=document.createElement('div'); note.className='dnote';
    note.textContent='点击格子即可编辑每条音色；上面的预设只是起点，套用后仍可自由修改。';
    pane.appendChild(note);
  }
  head.querySelector('.tc-sub').textContent=trackDesc(tr);
  refreshSummary(tr);
  return el;
}
/* 收起态摘要：小节 · 速度 · 音色 / 命中数 · 跟随状态 */
function refreshSummary(tr){
  const card=view.cards.get(tr.id); if(!card) return;
  const s=card.el.querySelector('.tc-sum .s-sum'); if(!s) return;
  const parts=[barsOf(tr)+' 小节', rateName(rateOf(tr))];
  if(tr.kind==='drum'){
    const hits=DRUM_LANES.reduce((a,l)=>a+((tr.p[l.id]||'').match(/x/g)||[]).length,0);
    parts.push(hits+' hits');
  }else{
    const notes=tr.seq.filter(v=>v>=0).length;
    parts.push(INST_NAME(tr.inst));
    parts.push(notes+' 音');
    if(tr.follow) parts.push('🔗 跟随和弦');
  }
  s.textContent=parts.join(' · ');
}
function refreshSub(tr){
  const card=view.cards.get(tr.id); if(!card) return;
  const sub=card.el.querySelector('.tc-sub'); if(sub) sub.textContent=trackDesc(tr);
  refreshSummary(tr);
}

/* ---- 旋律声部：步进音序器网格（行＝音级 · 列＝步），音高直接点格；宽度不够时拆成 8 / 4 步一行 ---- */
let stepLine=BAR, drumLine=BAR;                   // 每行放多少步（自适应结果）
const CHUNKS=(n,per)=>{const o=[];for(let i=0;i<n;i+=per)o.push([i,Math.min(i+per,n)]);return o;};
function buildStepRow(tr,card){
  const wrap=document.createElement('div'); wrap.className='stepwrap sq';
  drawStepRow(tr,card,wrap,stepLine);
  return wrap;
}
/* 音高行表（自上而下：高音 → 低音），用当前调式的音名标注 */
function buildSqRows(tr,wrap,per,card){
  const n=stepsOf(tr), stepLabelCol=document.createElement('div');
  return {n,stepLabelCol};
}
function drawStepRow(tr,card,wrap,per){
  wrap.innerHTML=''; wrap.classList.toggle('multiline',per<BAR);
  card.knobs=[]; card.nums=[]; card.cells=[];
  const nb=barsOf(tr);
  /* 行首音名列（与网格贴合，随滚动不动）＋ 步号行 */
  for(let b=0;b<nb;b++){
    for(const [a,e] of CHUNKS(BAR,per)){         // 一小节按 per 步拆成若干行
      const seg=document.createElement('div'); seg.className='sqseg';
      const head=document.createElement('div'); head.className='shead';
      /* 左上角小标签：小节 / 步范围 */
      const tag=document.createElement('div'); tag.className='sqtag';
      tag.textContent=(nb>1?(b+1)+'·':'')+(a+1)+'–'+e;
      tag.title='第 '+(b+1)+' 小节 · 步 '+((b*BAR+a)+1)+'–'+(b*BAR+e);
      head.appendChild(tag);
      const nums=document.createElement('div'); nums.className='stepnums sq';
      for(let k=a;k<e;k++){
        const s=b*BAR+k, gap=STEP_GAP(k)&&k>a;   // 行首不留分组缩进
        const nn=document.createElement('div');
        nn.className='stepnum'+(gap?' gap':''); nn.textContent=k+1;
        nums.appendChild(nn); card.nums[s]=nn;
      }
      head.appendChild(nums);
      seg.appendChild(head);
      /* 网格本体：ROWS 行 × per 列 */
      const body=document.createElement('div'); body.className='sqbody';
      for(let r=0;r<ROWS;r++){
        const row=document.createElement('div'); row.className='sqrow';
        const lb=document.createElement('div'); lb.className='sqlb';
        lb.textContent=noteName(rowMidi(r,tr.oct));
        lb.title='第 '+(degOfRow(r)+1)+' 级 · '+noteName(rowMidi(r,tr.oct));
        row.appendChild(lb);
        for(let k=a;k<e;k++){
          const s=b*BAR+k, gap=STEP_GAP(k)&&k>a;
          const cell=document.createElement('div');
          cell.className='sqcell'+(gap?' gap':'')+(r===MID_ROW?' mid':'');
          cell.tabIndex=0;
          cell.setAttribute('role','button');
          cell.setAttribute('aria-label','第'+(b*BAR+k+1)+'步 '+noteName(rowMidi(r,tr.oct)));
          attachStepCellEvents(cell,tr,s,r);
          row.appendChild(cell);
          if(!card.cells[s]) card.cells[s]=[];
          card.cells[s][r]=cell;
        }
        body.appendChild(row);
      }
      seg.appendChild(body);
      wrap.appendChild(seg);
    }
  }
  refreshAllSteps(tr);
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
  /* 在鼓格上滚动＝调这个鼓声部的音量（和调音台推子、卡片「混音」滑杆同一份状态）；
     按住 Shift 滚动才是调这一击的力度——音量与力度分开，不会互相踩。
     这里必须走完整重绘：卡片滑杆与调音台推子都靠重绘回显，不然它们会显示旧值。 */
  cell.addEventListener('wheel',e=>{
    e.preventDefault();
    if(e.shiftKey){
      const cur=velOf(tr,s), nv=Math.max(.2,Math.min(1,(cur==null?.82:cur)+(e.deltaY<0?.06:-.06)));
      if(!Array.isArray(tr.vel)) tr.vel=new Array(stepsOf(tr)).fill(null);
      tr.vel[s]=nv; refreshStepCell(tr,s); save();
      toast('第 '+(s+1)+' 步力度 → '+Math.round(nv*100)+'%');
      return;
    }
    const nv=clamp01((tr.vol==null?.85:tr.vol)+(e.deltaY<0?.04:-.04));
    tr.vol=nv; busSync(tr); save(); renderTracks();
    toast('「'+tr.name+'」音量 → '+Math.round(nv*100)+'%');
  },{passive:false});
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
    if(tr.kind==='inst'){ refreshAllSteps(tr); }
    else refreshDrumCells(tr);
  }
}

/* ---- 步进音序器网格状态 ---- */
function updateDial(tr,s){ refreshStepCell(tr,s); }
function refreshStepCell(tr,s){
  const card=view.cards.get(tr.id); if(!card||!card.cells||!card.cells[s]) return;
  const col=card.cells[s], r=tr.seq[s];
  if(r!==-1&&tr.last) tr.last[s]=r;
  const v=velOf(tr,s);
  const on=!!tr.userSeq&&Array.isArray(tr.userSeq)&&tr.userSeq[s]!==-1;
  /* 跟随和弦：音序格位置不动（r），但实际发声可能被折算到别的行（fr）。
     用 .ghost 在「实际发声行」画一枚淡色标记，让你看见它到底播成什么音。 */
  const fr=(r!==-1)?followRow(tr,s):-1;
  const shifted=(fr!==r&&fr!==-1);
  for(let i=0;i<col.length;i++){
    const cell=col[i]; if(!cell) continue;
    cell.classList.toggle('on',i===r);
    cell.classList.toggle('anchor',i===r&&on);            // 手摆的音（✨ 的锚点）：加一圈描边
    cell.classList.toggle('ghost',shifted&&i===fr);       // 跟随折算后的实际发声位置
    cell.style.setProperty('--v',r===i?(v==null?.82:v):0); // 力度→格子不透明度
    const tail='（第 '+(degOfRow(i)+1)+' 级）';
    if(i===r){
      cell.title='第 '+(s+1)+' 步 · '+noteName(rowMidi(i,tr.oct))+tail+
        (shifted?' · 🔗 跟随和弦 → 实际发 '+noteName(rowMidi(fr,tr.oct)):'')+
        ' · 力度 '+(v==null?'默认 82':Math.round(v*100)+'%');
    }else if(shifted&&i===fr){
      cell.title='第 '+(s+1)+' 步 · 跟随和弦后的实际发声音高 '+noteName(rowMidi(i,tr.oct))+tail;
    }else{
      cell.title='第 '+(s+1)+' 步 · '+noteName(rowMidi(i,tr.oct))+tail+'（点这里放置音符）';
    }
  }
}
function refreshAllSteps(tr){
  const n=stepsOf(tr);
  for(let s=0;s<n;s++) refreshStepCell(tr,s);
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
        if(card.nums[i]) card.nums[i].classList.toggle('active',on);
        if(card.cells[i]) for(const c of card.cells[i]) if(c) c.classList.toggle('ph',on);
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
  const first=()=>document.querySelector('.stepwrap.sq')||document.querySelector('.stepwrap');
  if(first()){                                   // 步进网格：按实测行宽 16 → 8 → 4 逐档试
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
