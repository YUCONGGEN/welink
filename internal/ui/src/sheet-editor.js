import {createCalculator,display,isError,parseRef,refName,colName,functionNames} from './formula.js';
import {peerColor} from './doc-editor.js';
import {confirmDialog,inputDialog} from './dialogs.js';

// The spreadsheet editor, after Feishu Sheets: a grid that only draws what is
// on screen, a formula bar, sheet tabs and a toolbar. Cell edits are applied
// at once and sent as operations; inserting or deleting rows and columns is
// done by the server (it also fixes formulas) and comes back as a new page.

const ROW_H=28,HEAD_H=26,HEAD_W=48,COL_W=100;

// moveRefs shifts the relative parts of references, as when copying a
// formula from one cell to another.
export function moveRefs(formula,dc,dr){
 let out='',inString=false;
 const re=/((?:'(?:[^']|'')+'|[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*)!)?(\$?)([A-Z]{1,3})(\$?)([0-9]+)/g;
 const fix=chunk=>chunk.replace(re,(m,sheet,ac,col,ar,row,offset,all)=>{
  const before=all[offset-1]||'',after=all[offset+m.length]||'';
  if(/[A-Za-z0-9_.]/.test(before)||/[A-Za-z_(]/.test(after))return m;
  let c=0;for(const ch of col)c=c*26+ch.charCodeAt(0)-64;let r=+row;
  if(!ac)c+=dc;if(!ar)r+=dr;if(c<1||r<1)return (sheet||'')+'#REF!';
  return (sheet||'')+ac+colName(c)+ar+r;
 });
 let start=0;
 for(let i=0;i<formula.length;i++){if(formula[i]!=='"')continue;if(!inString){out+=fix(formula.slice(start,i));start=i;inString=true}else if(formula[i+1]==='"'){i++}else{out+=formula.slice(start,i+1);start=i+1;inString=false}}
 return out+(inString?formula.slice(start):fix(formula.slice(start)));
}

export function createSheetEditor({mount,content,editable,newId,onChange,onWhere,toast,esc,askAI}){
 let pages=(content.sheets||[]).map(p=>({...p,cells:{...(p.cells||{})},cols:{...(p.cols||{})}}));
 let active=0,canEdit=editable,queueOps=[],seq=0,peers=[],editing=null,clip=null,frame=0,afterAdd='';
 const pendingKeys=new Map(),inflight=new Map(),undo=[],redo=[];
 let sel={r1:1,c1:1,r2:1,c2:1,ar:1,ac:1};
 const page=()=>pages[active];
 const byName=name=>pages.find(p=>p.name===name);
 const calc=createCalculator({raw:(name,col,row)=>byName(name)?.cells[refName(col,row)]?.v,exists:name=>!!byName(name)});
 const value=(p,c,r)=>calc.value(p.name,c,r);

 mount.innerHTML=`<div class="sheet">
  <div class="sheet-toolbar" role="toolbar" aria-label="表格工具">
   <button data-sh="undo" title="撤销 Ctrl+Z">↶</button><button data-sh="redo" title="重做 Ctrl+Y">↷</button><span class="sep"></span>
   <button data-sh="b" title="粗体 Ctrl+B"><b>B</b></button><button data-sh="i" title="斜体 Ctrl+I"><i>I</i></button><button data-sh="u" title="下划线 Ctrl+U"><u>U</u></button><button data-sh="s" title="删除线"><s>S</s></button><span class="sep"></span>
   <button data-sh="left" title="左对齐">⇤</button><button data-sh="center" title="居中">↔</button><button data-sh="right" title="右对齐">⇥</button><span class="sep"></span>
   <label class="sheet-color" title="填充颜色">▧<input type="color" data-sh-color="bg" value="#fff2cc"></label><label class="sheet-color" title="文字颜色">A<input type="color" data-sh-color="c" value="#d83931"></label><button data-sh="clearStyle" title="清除格式">⌫</button><span class="sep"></span>
   <button data-sh="rowAbove" title="在上方插入行">+行</button><button data-sh="colLeft" title="在左侧插入列">+列</button><button data-sh="delRows" title="删除所选行">−行</button><button data-sh="delCols" title="删除所选列">−列</button><span class="sep"></span>
   <button data-sh="sum" title="自动求和">Σ</button>${askAI?'<button data-sh="ai" class="ai" title="让 AI 分析或修改所选区域">✦ AI</button>':''}
  </div>
  <div class="sheet-formula"><span class="sheet-ref" aria-label="当前单元格">A1</span><span class="fx">fx</span><input class="sheet-input" aria-label="单元格内容或公式" spellcheck="false" autocomplete="off"></div>
  <div class="sheet-grid" tabindex="0" aria-label="表格">
   <div class="sheet-corner"></div><div class="sheet-colhead"></div><div class="sheet-rowhead"></div>
   <div class="sheet-scroll"><div class="sheet-space"><div class="sheet-cells"></div><div class="sheet-peers"></div><div class="sheet-sel"></div><textarea class="sheet-editor hidden" spellcheck="false"></textarea></div></div>
  </div>
  <div class="sheet-tabs"></div>
 </div>`;
 const $=s=>mount.querySelector(s);
 const grid=$('.sheet-grid'),scroll=$('.sheet-scroll'),space=$('.sheet-space'),cellsEl=$('.sheet-cells'),colhead=$('.sheet-colhead'),rowhead=$('.sheet-rowhead'),selEl=$('.sheet-sel'),editor=$('.sheet-editor'),bar=$('.sheet-input'),refBox=$('.sheet-ref');

 // Geometry ----------------------------------------------------------------
 const colW=c=>page().cols?.[colName(c)]||COL_W;
 function extent(){let mr=0,mc=0;for(const ref in page().cells){const p=parseRef(ref);if(p){mr=Math.max(mr,p.row);mc=Math.max(mc,p.col)}}return {rows:Math.min(50000,Math.max(200,mr+100,sel.r2+50)),cols:Math.min(200,Math.max(26,mc+8,sel.c2+5))}}
 let xs=[0],size={rows:200,cols:26};
 function measure(){size=extent();xs=[0];for(let c=1;c<=size.cols;c++)xs.push(xs[c-1]+colW(c));space.style.width=xs[size.cols]+'px';space.style.height=size.rows*ROW_H+'px'}
 const colAt=x=>{let lo=1,hi=size.cols;while(lo<hi){const m=(lo+hi+1)>>1;if(xs[m-1]<=x)lo=m;else hi=m-1}return lo};

 // Drawing ----------------------------------------------------------------
 function cellHTML(c,r){
  const p=page(),ref=refName(c,r),cell=p.cells[ref],v=cell?value(p,c,r):null,s=cell?.s||{};
  const text=display(v),num=typeof v==='number',err=isError(v);
  const cls=['c',num?'num':'',err?'err':'',typeof v==='boolean'?'bool':'',s.b?'b':'',s.i?'i':'',s.u?'u':'',s.s?'s':'',s.a?'a-'+s.a:''].filter(Boolean).join(' ');
  const style=`left:${xs[c-1]}px;top:${(r-1)*ROW_H}px;width:${colW(c)}px;${s.bg?'background:'+s.bg+';':''}${s.c?'color:'+s.c+';':''}`;
  return `<div class="${cls}" style="${style}"${err&&v.why?` title="${esc(v.why)}"`:''}>${esc(text)}</div>`;
 }
 function draw(){
  frame=0;measure();
  const top=scroll.scrollTop,left=scroll.scrollLeft,h=scroll.clientHeight,w=scroll.clientWidth;
  const r1=Math.max(1,Math.floor(top/ROW_H)+1),r2=Math.min(size.rows,Math.ceil((top+h)/ROW_H)+1),c1=colAt(left),c2=Math.min(size.cols,colAt(left+w)+1);
  let html='';for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)html+=cellHTML(c,r);
  cellsEl.innerHTML=html;
  let ch='';for(let c=c1;c<=c2;c++)ch+=`<div class="h${c>=Math.min(sel.c1,sel.c2)&&c<=Math.max(sel.c1,sel.c2)?' on':''}" data-col="${c}" style="left:${xs[c-1]-left}px;width:${colW(c)}px">${colName(c)}<span class="resize" data-resize="${c}"></span></div>`;
  colhead.innerHTML=ch;
  let rh='';for(let r=r1;r<=r2;r++)rh+=`<div class="h${r>=Math.min(sel.r1,sel.r2)&&r<=Math.max(sel.r1,sel.r2)?' on':''}" data-row="${r}" style="top:${(r-1)*ROW_H-top}px">${r}</div>`;
  rowhead.innerHTML=rh;
  drawSel();drawPeers();
 }
 const redraw=()=>{if(!frame)frame=requestAnimationFrame(draw)};
 function drawSel(){
  const r1=Math.min(sel.r1,sel.r2),r2=Math.max(sel.r1,sel.r2),c1=Math.min(sel.c1,sel.c2),c2=Math.max(sel.c1,sel.c2);
  Object.assign(selEl.style,{left:xs[c1-1]+'px',top:(r1-1)*ROW_H+'px',width:(xs[c2]-xs[c1-1])+'px',height:(r2-r1+1)*ROW_H+'px'});
  const ref=refName(sel.ac,sel.ar);refBox.textContent=r1===r2&&c1===c2?ref:`${refName(c1,r1)}:${refName(c2,r2)}`;
  if(!editing)bar.value=page().cells[ref]?.v||'';
 }
 function drawPeers(){
  const box=$('.sheet-peers');box.innerHTML=peers.filter(v=>v.where?.startsWith(page().id+'!')).map(v=>{const p=parseRef(v.where.split('!')[1]);if(!p||p.col>size.cols)return '';const color=peerColor(v.userId);return `<div class="peer" style="left:${xs[p.col-1]}px;top:${(p.row-1)*ROW_H}px;width:${colW(p.col)}px;border-color:${color}"><span style="background:${color}">${esc(v.name)}</span></div>`}).join('');
 }
 function drawTabs(){
  $('.sheet-tabs').innerHTML=pages.map((p,i)=>`<button class="tab${i===active?' active':''}" data-tab="${i}" title="双击重命名，右键更多">${esc(p.name)}</button>`).join('')+(canEdit?'<button class="add" data-sh="addSheet" title="新建工作表">＋</button>':'');
 }

 // Selection ----------------------------------------------------------------
 function select(r,c,extend=false){
  r=Math.max(1,Math.min(50000,r));c=Math.max(1,Math.min(200,c));
  if(extend){sel.r2=r;sel.c2=c}else sel={r1:r,c1:c,r2:r,c2:c,ar:r,ac:c};
  if(!extend){sel.ar=r;sel.ac=c}
  const y=(r-1)*ROW_H;if(y<scroll.scrollTop)scroll.scrollTop=y;else if(y+ROW_H>scroll.scrollTop+scroll.clientHeight)scroll.scrollTop=y+ROW_H-scroll.clientHeight;
  measure();const x=xs[c-1];if(x<scroll.scrollLeft)scroll.scrollLeft=x;else if(xs[c]>scroll.scrollLeft+scroll.clientWidth)scroll.scrollLeft=xs[c]-scroll.clientWidth;
  redraw();onWhere(page().id+'!'+refName(sel.ac,sel.ar));
 }
 const bounds=()=>({r1:Math.min(sel.r1,sel.r2),r2:Math.max(sel.r1,sel.r2),c1:Math.min(sel.c1,sel.c2),c2:Math.max(sel.c1,sel.c2)});

 // Local edits ----------------------------------------------------------------
 const same=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
 function setCell(p,ref,cell,group){
  const before=p.cells[ref]?JSON.parse(JSON.stringify(p.cells[ref])):null;
  const clean=cell&&(cell.v||cell.s&&Object.keys(cell.s).length)?{...(cell.v?{v:cell.v}:{}),...(cell.s&&Object.keys(cell.s).length?{s:cell.s}:{})}:null;
  if(same(before,clean))return;
  if(clean)p.cells[ref]=clean;else delete p.cells[ref];
  const key=p.id+'!'+ref;pendingKeys.set(key,++seq);
  queueOps.push({op:'cell',sheet:p.id,ref,cell:clean||undefined});
  group?.push({sheet:p.id,ref,before,after:clean});
 }
 function commit(group){if(!group.length)return;undo.push(group);if(undo.length>100)undo.shift();redo.length=0;calc.clear();redraw();onChange()}
 function revert(group,back){const g=[];for(const ch of back?[...group].reverse():group){const p=pages.find(x=>x.id===ch.sheet);if(p)setCell(p,ch.ref,back?ch.before:ch.after,g)}calc.clear();redraw();onChange()}
 function writeValue(r,c,v){const p=page(),ref=refName(c,r),old=p.cells[ref];const g=[];setCell(p,ref,{...(old||{}),v:String(v)},g);commit(g)}
 function eachSelected(fn){const b=bounds(),g=[];for(let r=b.r1;r<=b.r2;r++)for(let c=b.c1;c<=b.c2;c++)fn(r,c,g);commit(g)}
 function style(patch){if(!canEdit)return;const p=page(),b=bounds();const ref=refName(b.c1,b.r1);const toggle=Object.keys(patch).length===1&&typeof Object.values(patch)[0]==='boolean'?Object.keys(patch)[0]:null;const on=toggle?!p.cells[ref]?.s?.[toggle]:null;
  eachSelected((r,c,g)=>{const ref=refName(c,r),old=p.cells[ref]||{};const s={...(old.s||{})};for(const [k,v] of Object.entries(toggle?{[toggle]:on}:patch)){if(v===false||v===''||v===null)delete s[k];else s[k]=v}setCell(p,ref,{...old,s},g)})}
 function clearRange(){if(!canEdit)return;const p=page();eachSelected((r,c,g)=>{const ref=refName(c,r),old=p.cells[ref];if(old?.v)setCell(p,ref,old.s?{s:old.s}:null,g)})}

 // Cell editor -----------------------------------------------------------------
 function startEdit(initial){
  if(!canEdit)return;const r=sel.ar,c=sel.ac;editing={r,c,sheet:page().id};
  Object.assign(editor.style,{left:xs[c-1]+'px',top:(r-1)*ROW_H+'px',minWidth:colW(c)+'px',height:ROW_H+'px'});
  editor.value=initial??page().cells[refName(c,r)]?.v??'';editor.classList.remove('hidden');editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length);bar.value=editor.value;
 }
 function finishEdit(save,move){
  if(!editing)return;const {r,c,sheet}=editing;editing=null;editor.classList.add('hidden');
  if(save&&page().id===sheet){let v=editor.value;if(v.startsWith('=')){v=v.replace(/\s+$/,'');const open=(v.match(/\(/g)||[]).length-(v.match(/\)/g)||[]).length;if(open>0)v+=')'.repeat(open)}writeValue(r,c,v)}
  grid.focus({preventScroll:true});
  if(move)select(r+(move==='down'?1:move==='up'?-1:0),c+(move==='right'?1:move==='left'?-1:0));else redraw();
 }
 editor.addEventListener('input',()=>{bar.value=editor.value});
 editor.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.altKey){e.preventDefault();finishEdit(true,e.shiftKey?'up':'down')}
  else if(e.key==='Enter'&&e.altKey){e.preventDefault();const s=editor.selectionStart;editor.setRangeText('\n',s,editor.selectionEnd,'end')}
  else if(e.key==='Tab'){e.preventDefault();finishEdit(true,e.shiftKey?'left':'right')}
  else if(e.key==='Escape'){e.preventDefault();finishEdit(false)}
 });
 editor.addEventListener('blur',()=>{setTimeout(()=>{if(editing&&document.activeElement!==editor&&document.activeElement!==bar)finishEdit(true)},0)});
 bar.addEventListener('focus',()=>{if(!canEdit){bar.blur();return}if(!editing){startEdit();bar.focus()}});
 bar.addEventListener('input',()=>{if(editing)editor.value=bar.value});
 bar.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();editor.value=bar.value;finishEdit(true,'down')}else if(e.key==='Escape'){e.preventDefault();finishEdit(false)}});

 // Mouse --------------------------------------------------------------------------
 const cellAt=e=>{const rect=space.getBoundingClientRect();const x=e.clientX-rect.left,y=e.clientY-rect.top;return {r:Math.max(1,Math.floor(y/ROW_H)+1),c:colAt(Math.max(0,x))}};
 let dragging=false;
 space.addEventListener('mousedown',e=>{
  if(e.target===editor)return;const {r,c}=cellAt(e);
  // While typing a formula, a click inserts the cell's reference.
  if(editing&&editor.value.startsWith('=')&&/[=(,+\-*/^&<>:]$/.test(editor.value.slice(0,editor.selectionStart).trimEnd())){e.preventDefault();const ref=refName(c,r);editor.setRangeText(ref,editor.selectionStart,editor.selectionEnd,'end');bar.value=editor.value;editor.focus();return}
  if(editing)finishEdit(true);
  e.preventDefault();grid.focus({preventScroll:true});select(r,c,e.shiftKey);dragging=true;
 });
 space.addEventListener('dblclick',e=>{if(e.target!==editor)startEdit()});
 const move=e=>{if(dragging){const {r,c}=cellAt(e);if(r!==sel.r2||c!==sel.c2){sel.r2=r;sel.c2=c;redraw()}}};
 const up=()=>{dragging=false;resizing=null};
 window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
 scroll.addEventListener('scroll',redraw,{passive:true});
 const ro=new ResizeObserver(redraw);ro.observe(scroll);
 let resizing=null;
 colhead.addEventListener('mousedown',e=>{
  const handle=e.target.closest('[data-resize]');
  if(handle&&canEdit){e.preventDefault();const c=+handle.dataset.resize,start=e.clientX,w0=colW(c);resizing={c};
   const onMove=ev=>{const w=Math.max(30,Math.min(1000,w0+ev.clientX-start));page().cols={...page().cols,[colName(c)]:w};redraw()};
   const onUp=()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);queueOps.push({op:'width',sheet:page().id,col:colName(c),width:colW(c)});onChange()};
   window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);return}
  const h=e.target.closest('[data-col]');if(h){e.preventDefault();const c=+h.dataset.col;if(e.shiftKey){sel.c2=c;sel.r1=1;sel.r2=size.rows}else sel={r1:1,r2:size.rows,c1:c,c2:c,ar:1,ac:c};grid.focus();redraw()}
 });
 rowhead.addEventListener('mousedown',e=>{const h=e.target.closest('[data-row]');if(h){e.preventDefault();const r=+h.dataset.row;if(e.shiftKey){sel.r2=r;sel.c1=1;sel.c2=size.cols}else sel={r1:r,r2:r,c1:1,c2:size.cols,ar:r,ac:1};grid.focus();redraw()}});
 colhead.addEventListener('contextmenu',e=>{const h=e.target.closest('[data-col]');if(!h||!canEdit)return;e.preventDefault();headerMenu(e,[['在左侧插入列','colLeft'],['在右侧插入列','colRight'],['删除所选列','delCols']])});
 rowhead.addEventListener('contextmenu',e=>{const h=e.target.closest('[data-row]');if(!h||!canEdit)return;e.preventDefault();headerMenu(e,[['在上方插入行','rowAbove'],['在下方插入行','rowBelow'],['删除所选行','delRows']])});
 space.addEventListener('contextmenu',e=>{if(!canEdit)return;e.preventDefault();const {r,c}=cellAt(e);const b=bounds();if(r<b.r1||r>b.r2||c<b.c1||c>b.c2)select(r,c);headerMenu(e,[['在上方插入行','rowAbove'],['在下方插入行','rowBelow'],['在左侧插入列','colLeft'],['在右侧插入列','colRight'],['删除所选行','delRows'],['删除所选列','delCols'],['清除内容','clear']])});
 function headerMenu(e,items){document.querySelector('.sheet-menu')?.remove();const m=document.createElement('div');m.className='sheet-menu doc-block-menu';m.innerHTML=items.map(([l,a])=>`<button data-sh="${a}">${l}</button>`).join('');document.body.append(m);m.style.left=Math.min(e.clientX,innerWidth-180)+'px';m.style.top=Math.min(e.clientY,innerHeight-m.offsetHeight-8)+'px';m.addEventListener('mousedown',ev=>{const b=ev.target.closest('[data-sh]');if(b){ev.preventDefault();command(b.dataset.sh);m.remove()}});setTimeout(()=>document.addEventListener('mousedown',function off(ev){if(!m.contains(ev.target)){m.remove();document.removeEventListener('mousedown',off)}}),0)}

 // Keyboard -------------------------------------------------------------------------
 grid.addEventListener('keydown',e=>{
  if(editing||e.target===bar)return;const mod=e.ctrlKey||e.metaKey;
  const moves={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
  if(moves[e.key]){e.preventDefault();const [dr,dc]=moves[e.key];
   if(mod){let r=e.shiftKey?sel.r2:sel.ar,c=e.shiftKey?sel.c2:sel.ac;const p=page();const filled=(r,c)=>!!p.cells[refName(c,r)]?.v;const step=()=>{r+=dr;c+=dc};const start=filled(r,c);step();if(start&&filled(r,c)){while(r>1&&c>1&&r<size.rows&&c<size.cols&&filled(r+dr,c+dc))step()}else{while(r>1&&c>1&&r<size.rows&&c<size.cols&&!filled(r,c))step()}select(r,c,e.shiftKey);return}
   if(e.shiftKey)select(sel.r2+dr,sel.c2+dc,true);else select(sel.ar+dr,sel.ac+dc);return}
  if(e.key==='Enter'){e.preventDefault();if(e.shiftKey)select(sel.ar-1,sel.ac);else startEdit();return}
  if(e.key==='Tab'){e.preventDefault();select(sel.ar,sel.ac+(e.shiftKey?-1:1));return}
  if(e.key==='F2'){e.preventDefault();startEdit();return}
  if(e.key==='Home'){e.preventDefault();select(mod?1:sel.ar,1);return}
  if(e.key==='PageDown'||e.key==='PageUp'){e.preventDefault();const n=Math.floor(scroll.clientHeight/ROW_H);select(sel.ar+(e.key==='PageDown'?n:-n),sel.ac);return}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();clearRange();return}
  if(mod&&!e.altKey){const k=e.key.toLowerCase();
   if(k==='z'&&!e.shiftKey){e.preventDefault();command('undo');return}
   if(k==='y'||k==='z'&&e.shiftKey){e.preventDefault();command('redo');return}
   if(k==='b'||k==='i'||k==='u'){e.preventDefault();style({[k]:true});return}
   if(k==='a'){e.preventDefault();sel={r1:1,c1:1,r2:size.rows,c2:size.cols,ar:sel.ar,ac:sel.ac};redraw();return}
   return}
  if(e.key.length===1&&!mod&&!e.altKey&&canEdit){e.preventDefault();startEdit(e.key)}
 });
 // Clipboard: tab-separated values, with formulas kept when pasted back here.
 grid.addEventListener('copy',e=>{if(editing)return;e.preventDefault();copy(e.clipboardData,false)});
 grid.addEventListener('cut',e=>{if(editing)return;e.preventDefault();copy(e.clipboardData,true)});
 grid.addEventListener('paste',e=>{if(editing||!canEdit)return;e.preventDefault();paste(e.clipboardData.getData('text/plain'))});
 function copy(data,cut){
  const b=bounds(),p=page();const rows=[],raws=[];
  for(let r=b.r1;r<=Math.min(b.r2,size.rows);r++){const line=[],raw=[];for(let c=b.c1;c<=Math.min(b.c2,size.cols);c++){const cell=p.cells[refName(c,r)];line.push(display(cell?value(p,c,r):null));raw.push(cell?{...cell}:null)}rows.push(line);raws.push(raw)}
  const text=rows.map(r=>r.map(v=>/[\t\n"]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v).join('\t')).join('\n');
  data.setData('text/plain',text);clip={text,raws,r:b.r1,c:b.c1};if(cut)clearRange();
 }
 function parseTSV(text){const rows=[];let row=[],cur='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}else if(ch==='"'&&cur==='')q=true;else if(ch==='\t'){row.push(cur);cur=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cur);rows.push(row);row=[];cur=''}else cur+=ch}if(cur!==''||row.length){row.push(cur);rows.push(row)}return rows}
 function paste(text){
  const p=page(),g=[],r0=sel.ar,c0=sel.ac;
  if(clip&&clip.text===text){clip.raws.forEach((row,i)=>row.forEach((cell,j)=>{const ref=refName(c0+j,r0+i);if(c0+j>200||r0+i>50000)return;const v=cell?.v?.startsWith('=')?moveRefs(cell.v,c0-clip.c,r0-clip.r):cell?.v;setCell(p,ref,cell?{...cell,v}:null,g)}))}
  else{const rows=parseTSV(text.replace(/\n$/,''));if(rows.length*Math.max(...rows.map(r=>r.length))>50000){toast('一次最多粘贴 5 万个单元格');return}rows.forEach((row,i)=>row.forEach((v,j)=>{if(c0+j>200||r0+i>50000)return;const ref=refName(c0+j,r0+i),old=p.cells[ref];setCell(p,ref,{...(old||{}),v},g)}))}
  commit(g);
 }

 // Commands ----------------------------------------------------------------------------
 function structural(op,at,n){queueOps.push({op,sheet:page().id,at,n});onChange()}
 function command(cmd){
  const b=bounds();
  switch(cmd){
   case 'undo':{const g=undo.pop();if(g){revert(g,true);redo.push(g)}break}
   case 'redo':{const g=redo.pop();if(g){revert(g,false);undo.push(g)}break}
   case 'b':case 'i':case 'u':case 's':style({[cmd]:true});break;
   case 'left':case 'center':case 'right':style({a:cmd});break;
   case 'clearStyle':if(canEdit){const p=page();eachSelected((r,c,g)=>{const ref=refName(c,r),old=p.cells[ref];if(old?.s)setCell(p,ref,old.v?{v:old.v}:null,g)})}break;
   case 'clear':clearRange();break;
   case 'rowAbove':structural('insertRows',b.r1,b.r2-b.r1+1);break;
   case 'rowBelow':structural('insertRows',b.r2+1,b.r2-b.r1+1);break;
   case 'colLeft':structural('insertCols',b.c1,b.c2-b.c1+1);break;
   case 'colRight':structural('insertCols',b.c2+1,b.c2-b.c1+1);break;
   case 'delRows':if(b.r2-b.r1+1>=size.rows-1){toast('请先选择要删除的行');break}structural('deleteRows',b.r1,b.r2-b.r1+1);break;
   case 'delCols':if(b.c2-b.c1+1>=size.cols-1){toast('请先选择要删除的列');break}structural('deleteCols',b.c1,b.c2-b.c1+1);break;
   case 'sum':{if(!canEdit)break;const p=page();let r=b.r2+1,c=b.c1;if(b.r1===b.r2&&b.c1===b.c2){let top=b.r1-1;while(top>=1&&typeof value(p,c,top)==='number')top--;if(top===b.r1-1){toast('上方没有可以求和的数字');break}writeValue(b.r1,c,`=SUM(${refName(c,top+1)}:${refName(c,b.r1-1)})`);break}
    const g=[];for(let col=b.c1;col<=b.c2;col++)setCell(p,refName(col,r),{v:`=SUM(${refName(col,b.r1)}:${refName(col,b.r2)})`},g);commit(g);select(r,b.c1);break}
   case 'addSheet':{let n=pages.length+1;while(byName('Sheet'+n))n++;const id=newId();afterAdd=id;queueOps.push({op:'addSheet',page:{id,name:'Sheet'+n}});onChange();break}
   case 'ai':askAI?.();break;
  }
 }
 mount.querySelector('.sheet-toolbar').addEventListener('mousedown',e=>{const b=e.target.closest('[data-sh]');if(b){e.preventDefault();if(!canEdit&&!['ai'].includes(b.dataset.sh)){toast('你只有阅读权限');return}command(b.dataset.sh);grid.focus({preventScroll:true})}});
 mount.querySelectorAll('[data-sh-color]').forEach(input=>input.addEventListener('change',()=>{style({[input.dataset.shColor]:input.value});grid.focus({preventScroll:true})}));
 const tabs=$('.sheet-tabs');
 tabs.addEventListener('click',e=>{const t=e.target.closest('[data-tab]');if(t){switchTo(+t.dataset.tab);return}const a=e.target.closest('[data-sh]');if(a)command(a.dataset.sh)});
 tabs.addEventListener('dblclick',e=>{const t=e.target.closest('[data-tab]');if(t&&canEdit)rename(+t.dataset.tab)});
 tabs.addEventListener('contextmenu',e=>{const t=e.target.closest('[data-tab]');if(!t||!canEdit)return;e.preventDefault();const i=+t.dataset.tab;document.querySelector('.sheet-menu')?.remove();const m=document.createElement('div');m.className='sheet-menu doc-block-menu';m.innerHTML=`<button data-tab-op="rename">重命名</button><button data-tab-op="left">左移</button><button data-tab-op="right">右移</button><button data-tab-op="delete" class="danger">删除工作表</button>`;document.body.append(m);m.style.left=e.clientX+'px';m.style.top=Math.max(8,e.clientY-m.offsetHeight)+'px';
  m.addEventListener('mousedown',async ev=>{const b=ev.target.closest('[data-tab-op]');if(!b)return;ev.preventDefault();m.remove();const op=b.dataset.tabOp,p=pages[i];
   if(op==='rename')rename(i);else if(op==='delete'){if(pages.length===1){toast('至少保留一个工作表');return}if(await confirmDialog('引用它的公式会显示 #REF!。',{title:`删除工作表“${p.name}”`,ok:'删除',danger:true})){queueOps.push({op:'deleteSheet',sheet:p.id});onChange()}}
   else{const at=op==='left'?i-1:i+1;if(at>=0&&at<pages.length){queueOps.push({op:'moveSheet',sheet:p.id,at});onChange()}}});
  setTimeout(()=>document.addEventListener('mousedown',function off(ev){if(!m.contains(ev.target)){m.remove();document.removeEventListener('mousedown',off)}}),0)});
 async function rename(i){const p=pages[i];const name=await inputDialog('工作表名称',{value:p.name,max:31});if(name===null||!name.trim()||name.trim()===p.name)return;queueOps.push({op:'renameSheet',sheet:p.id,name:name.trim()});onChange()}
 function switchTo(i){if(editing)finishEdit(true);active=Math.max(0,Math.min(pages.length-1,i));sel={r1:1,c1:1,r2:1,c2:1,ar:1,ac:1};scroll.scrollTop=0;scroll.scrollLeft=0;drawTabs();redraw();onWhere(page().id+'!A1')}

 // Sync ------------------------------------------------------------------------------------
 function collect(){const ops=queueOps;queueOps=[];for(const op of ops)if(op.op==='cell')inflight.set(op.sheet+'!'+op.ref,pendingKeys.get(op.sheet+'!'+op.ref));return ops}
 function reapply(p){for(const [key] of pendingKeys){const [sid,ref]=key.split('!');if(sid!==p.id)continue;const local=localCells.get(key);if(local===null)delete p.cells[ref];else if(local)p.cells[ref]=local}}
 const localCells=new Map();
 const trackLocal=()=>{for(const [key] of pendingKeys){const [sid,ref]=key.split('!');const p=pages.find(x=>x.id===sid);localCells.set(key,p?.cells[ref]??null)}};
 function apply(msg,own){
  trackLocal();const curId=page()?.id;
  for(const op of msg.ops||[]){
   if(op.op==='cell'){const key=op.sheet+'!'+op.ref;if(own){if(pendingKeys.get(key)===inflight.get(key))pendingKeys.delete(key);continue}if(pendingKeys.has(key))continue;const p=pages.find(x=>x.id===op.sheet);if(!p)continue;if(op.cell)p.cells[op.ref]=op.cell;else delete p.cells[op.ref]}
   else if(op.op==='width'){const p=pages.find(x=>x.id===op.sheet);if(p)p.cols={...p.cols,[op.col]:op.width}}
   else if(op.op==='page'){const next={...op.page,cells:{...(op.page.cells||{})},cols:{...(op.page.cols||{})}};const i=pages.findIndex(x=>x.id===next.id);if(i>=0)pages[i]=next;else pages.push(next);reapply(next)}
   else if(op.op==='pages'){const byId=new Map(pages.map(p=>[p.id,p]));pages=op.pages.map(m=>{const p=byId.get(m.id)||{id:m.id,cells:{},cols:{}};p.name=m.name;return p})}
  }
  if(own)inflight.clear();
  let i=pages.findIndex(p=>p.id===(afterAdd&&pages.some(p=>p.id===afterAdd)?afterAdd:curId));if(afterAdd&&pages.some(p=>p.id===afterAdd))afterAdd='';
  active=i<0?Math.min(active,pages.length-1):i;
  calc.clear();drawTabs();redraw();
 }
 function reset(content){trackLocal();pages=(content.sheets||[]).map(p=>({...p,cells:{...(p.cells||{})},cols:{...(p.cols||{})}}));for(const p of pages)reapply(p);active=Math.min(active,pages.length-1);calc.clear();drawTabs();redraw()}

 drawTabs();requestAnimationFrame(draw);
 return {
  collect,apply,reset,discardInflight(){inflight.clear()},hasPending:()=>queueOps.length>0,
  setEditable(v){canEdit=v;mount.querySelector('.sheet').classList.toggle('readonly',!v);drawTabs()},
  viewers(list){peers=list;drawPeers()},
  selection(){const b=bounds();return `${page().name}!${refName(b.c1,b.r1)}:${refName(b.c2,b.r2)}`},
  values(){const out={};let n=0;for(const p of pages)for(const ref in p.cells){if(n>=50000)break;if(p.cells[ref].v?.startsWith('=')){const q=parseRef(ref);out[p.id+'!'+ref]=display(calc.value(p.name,q.col,q.row));n++}}return out},
  applyEdit(edit){if(!canEdit||edit.op!=='cell')return false;const p=byName(edit.sheet)||page();const q=parseRef(edit.ref||'');if(!q)return false;const g=[];setCell(p,refName(q.col,q.row),{...(p.cells[refName(q.col,q.row)]||{}),v:String(edit.v??'')},g);commit(g);if(p===page())select(q.row,q.col);return true},
  focus(){grid.focus({preventScroll:true})},
  activeSheet:()=>page().id,
  functions:functionNames,
  destroy(){window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);ro.disconnect();cancelAnimationFrame(frame);document.querySelector('.sheet-menu')?.remove()},
 };
}
