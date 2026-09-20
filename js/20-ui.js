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
  const barTxt=barsOf(tr)+' 小节 · '+stepsOf(tr)+' 步';
  if(tr.kind==='drum'){
    const hits=DRUM_LANES.reduce((a,l)=>a+((tr.p[l.id]||'').match(/x/g)||[]).length,0);
    return '鼓机 · '+barTxt+' · '+(tr.drum&&tr.drum!=='custom'?PRESET_BY_ID(tr.drum).name+'·已可修改':'自定义')
      +' · '+hits+' hits';
  }
  const lo=noteName(rowMidi(ROWS-1,tr.oct)), hi=noteName(rowMidi(0,tr.oct));
  return INST_NAME(tr.inst)+' · '+barTxt+(tr.oct?' · '+(tr.oct>0?'+':'')+tr.oct+'八度':'')+' · '+lo+'–'+hi
    +(tr.follow!==false?' · ♻ 跟随和弦':' · ◌ 独立和声');
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
const PAN_TXT=v=>v===0?'中':(v<0?'L'+Math.abs(v):'R'+v);
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
    '<select class="cc-inst" title="和弦进行轨播放时的音色"></select>';
  head.querySelectorAll('button[data-act]').forEach(b=>b.addEventListener('click',()=>{
    const a=b.dataset.act;
    if(a==='rand'){
      const nb=randomSameStyle(); audChord(state.prog[0]);
      toast('🎲 已按「'+STYLE().name+'」换了一条和弦进行（保持 '+nb+' 小节 / '+progBeats()+' 拍）');
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
    ctl.appendChild(chipRange('音量',0,100,Math.round(chordVol*100),v=>v,x=>{chordVol=x/100;save();}));
  }
  const ciSel=head.querySelector('select.cc-inst');
  if(ciSel){
    fillInstSelect(ciSel,chordInstOf());
    ciSel.title='和弦进行轨播放时的音色（每拍触发一次当前和弦）';
    ciSel.addEventListener('change',()=>{
      chordInst=ciSel.value; save();
      toast('和弦进行轨音色 → '+INST_NAME(chordInst));
    });
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

  const pick=buildPicker(); if(pick) box.appendChild(pick);

  const hint=document.createElement('div'); hint.className='cc-hint';
  hint.innerHTML='每个方块的宽度＝它持续的拍数，<b>点方块</b>挑和弦（级数表里点一下即可替换并试听），'+
    '<b>‹ ›</b> 改拍长、<b>⧉</b> 拆分插入、<b>✕</b> 删除；方块的「第几拍」就是它覆盖的范围。'+
    '各声部（鼓除外）卡片上的 <b>♻ 跟随和弦 / ◌ 独立和声</b> 决定它是否照这条进行生成。';
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
  p[i]=mkChord(root,c.beats,seventh===undefined?c.seventh:seventh);
  state.progEdited=true; reharmonizeAll(); save(); audChord(p[i]);
}
function splitSeg(i){
  const p=fitProg(), c=p[i]; if(!c) return;
  if(c.beats<2){ toast('这段只有 1 拍——先按 › 把它加长，再拆分'); return; }
  const a=Math.floor(c.beats/2), b=c.beats-a;
  p.splice(i,1,mkChord(c.root,a,c.seventh),mkChord(c.root,b,c.seventh));
  state.progEdited=true; chordEdit=i+1;
  reharmonizeAll(); renderChord(); save();
  toast('已插入第 '+(i+2)+' 个和弦——点它挑个新和弦');
}
function segLen(i,d){
  const p=fitProg(), c=p[i]; if(!c) return;
  const nb=p[i+1]||p[i-1];
  if(!nb){ toast('整曲只有这一个和弦'); return; }
  if(d>0){ if(nb.beats<2){ toast('相邻的和弦只剩 1 拍，给不出更多'); return; } c.beats++; nb.beats--; }
  else{ if(c.beats<2){ toast('最短 1 拍'); return; } c.beats--; nb.beats++; }
  state.progEdited=true; reharmonizeAll(); renderChord(); save();
}
function delSeg(i){
  const p=fitProg();
  if(p.length<2){ toast('至少保留一个和弦'); return; }
  const c=p[i], nb=p[i+1]||p[i-1];
  nb.beats+=c.beats; p.splice(i,1);
  if(chordEdit!=null) chordEdit=chordEdit>=p.length?null:chordEdit;
  state.progEdited=true; reharmonizeAll(); renderChord(); save();
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
        ?'<button class="icon-btn" data-act="opt" title="按当前风格优化本声部旋律">✨</button>'+
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
  }else{
    /* 是否跟随「和弦进行轨」：决定 ✨ 优化与 🎼 编配用的和声 */
    const followOn=()=>tr.follow!==false;
    const fol=document.createElement('button');
    fol.type='button';
    const paint=()=>{
      const o=followOn();
      fol.className='chip btn-like'+(o?' on':'');
      fol.textContent=o?'♻ 跟随和弦':'◌ 独立和声';
      fol.title=o?'按「和弦进行轨」的和声优化 / 编配这一声部':'脱离和弦轨：优化时贴合本声部现有音符自行推导和声';
    };
    paint();
    fol.addEventListener('click',()=>{
      tr.follow=!followOn(); paint(); save(); refreshSub(tr);
      toast('「'+tr.name+'」'+(followOn()?'已跟随和弦进行轨':'改为独立和声'));
    });
    const sel=document.createElement('select'); fillInstSelect(sel,tr.inst);
    sel.addEventListener('change',()=>{tr.inst=sel.value;refreshSub(tr);save();});
    const oct=document.createElement('select');
    [-2,-1,0,1,2].forEach(o=>oct.add(new Option(o===0?'原调':(o>0?'+'+o:o)+' 八度',o)));
    oct.value=tr.oct;
    oct.addEventListener('change',()=>{tr.oct=+oct.value;refreshSub(tr);refreshAll();save();});
    meta.append(fol,sel,oct,
      chipRange('音量',0,100,Math.round(tr.vol*100),v=>v,x=>{tr.vol=x/100;save();}),
      chipRange('声像',-100,100,Math.round(tr.pan*100),PAN_TXT,x=>{tr.pan=x/100;save();}));
  }
  el.appendChild(meta);

  /* ---- 步进区 ---- */
  if(tr.kind==='inst'){
    el.appendChild(buildStepRow(tr,card));
  }else{
    el.appendChild(buildDrumGrid(tr,card));
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

/* ---- 旋律声部：每小节一行 16 旋钮（可 1–4 小节） ---- */
function buildStepRow(tr,card){
  const wrap=document.createElement('div'); wrap.className='stepwrap';
  const nb=barsOf(tr);
  for(let b=0;b<nb;b++){
    const line=document.createElement('div'); line.className='barrow';
    const tag=document.createElement('div'); tag.className='barnum'; tag.textContent=b+1;
    tag.title='第 '+(b+1)+' 小节（步 '+(b*BAR+1)+'–'+((b+1)*BAR)+'）';
    const body=document.createElement('div'); body.className='barbody';
    const nums=document.createElement('div'); nums.className='stepnums';
    const row=document.createElement('div'); row.className='steprow';
    for(let k=0;k<BAR;k++){
      const s=b*BAR+k, gap=STEP_GAP(k);
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
      card.knobs[s]={dial:d,ring,cap};
      attachDialEvents(d,tr,s);
      updateDial(tr,s);
    }
    body.append(nums,row); line.append(tag,body); wrap.appendChild(line);
  }
  return wrap;
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
        const cell=document.createElement('div');
        cell.className='dcell'+(STEP_GAP(k)?' gap':'');
        cell.title='第 '+(b+1)+' 小节第 '+(k+1)+' 步';
        cell.addEventListener('click',()=>{
          const val=getLane(tr,lane.id)[s]!=='x';
          setLaneCell(tr,lane.id,s,val);
          cell.classList.toggle('on',val);
          tr.drum='custom'; refreshSub(tr); save();
          if(val){ ensureAudio(); if(audioCtx.state!=='running') audioCtx.resume(); playDrumHit(tr,lane.id,audioCtx.currentTime+.02); }
        });
        grp.appendChild(cell); cells[s]=cell;
      }
      hall.appendChild(grp);
    }
    card.dc.set(lane.id,cells);
    l.append(nm,hall); wrap.appendChild(l);
  }
  refreshDrumCells(tr);
  return wrap;
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
  card.knobs[s].ring.style.transform=`rotate(${-p*360/9}deg)`;
  card.knobs[s].cap.textContent=r===-1?'—':noteName(rowMidi(r,tr.oct));
  card.knobs[s].dial.classList.toggle('on',r!==-1);
  card.knobs[s].dial.setAttribute('aria-valuenow',String(p));
}

/* ---- 播放头（所有卡片按各自小节数循环同步） ---- */
let lastHead=-2;
function paintHead(step){
  if(step===lastHead) return;
  for(const tr of state.tracks){
    const card=view.cards.get(tr.id); if(!card) continue;
    const n=stepsOf(tr), s=step<0?-1:step%n;
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
