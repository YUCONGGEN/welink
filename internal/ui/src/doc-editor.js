import {confirmDialog,inputDialog} from './dialogs.js';
import {mergeText,shiftOffset,runs,toMarkdown,plain,toHTML,domRuns,domMarkdown,caretOffset,placeCaret,sliceRuns,toggleMark,markdownBlocks,blocksMarkdown} from './docs-text.js';

// The document editor, after Feishu Docs: one editable page of blocks with
// formatted text, a "/" menu, Markdown shortcuts and a floating toolbar.
// Text the user types is kept per block and sent as operations; the browser
// only edits inside one block's text, everything structural is done here.

const TYPES=[['p','正文','T'],['h1','一级标题','H1'],['h2','二级标题','H2'],['h3','三级标题','H3'],['bullet','无序列表','•'],['ordered','有序列表','1.'],['todo','待办事项','☐'],['quote','引用','❝'],['code','代码块','</>'],['divider','分割线','—'],['table','表格','▦']];
const TEXTUAL=new Set(['p','h1','h2','h3','bullet','ordered','todo','quote','code']);
const LISTS=new Set(['bullet','ordered','todo']);
const PALETTE=['#3370ff','#f54a45','#ff8800','#2ea121','#7f3bf5','#00a3a3','#d136a2','#8f959e'];
export const peerColor=id=>{let h=0;for(const c of id||'')h=(h*31+c.charCodeAt(0))>>>0;return PALETTE[h%PALETTE.length]};

export function createDocEditor({mount,outline,content,editable,newId,onChange,onWhere,toast,esc,askAI}){
 const conf=new Map(),els=new Map(),dirty=new Set(),inflight=new Map(),localOnly=new Set();
 let pending=[],canEdit=editable,menu=null,bar=null,composing=false,whereTimer=0,lastWhere='',peers=[],outlineTimer=0;
 const undo=[],redo=[];let burst=null;
 const root=document.createElement('div');root.className='doc-blocks';root.spellcheck=true;mount.append(root);

 // Model helpers ----------------------------------------------------------
 const textEl=id=>els.get(id)?.querySelector(':scope > .blk-text');
 const typeOf=id=>els.get(id)?.dataset.type;
 const domOrder=()=>[...root.children].map(e=>e.dataset.id).filter(Boolean);
 function localText(id){const t=textEl(id);if(!t)return conf.get(id)?.text??'';return typeOf(id)==='code'?domRuns(t).map(r=>r.text).join(''):domMarkdown(t)}
 const blockOf=node=>{const el=(node?.nodeType===1?node:node?.parentElement)?.closest('.blk');return el&&el.parentElement===root?el:null};
 const prevId=id=>{const el=els.get(id)?.previousElementSibling;return el?.dataset.id||''};
 const nextId=id=>els.get(id)?.nextElementSibling?.dataset.id||'';
 function snapshot(id){const c=conf.get(id)||{};const el=els.get(id);return {id,type:el?.dataset.type||c.type,text:localText(id),checked:el?.dataset.checked==='1',lang:c.lang||'',rows:c.rows?JSON.parse(JSON.stringify(c.rows)):undefined}}
 const queue=op=>{pending.push(op);onChange()};
 const touch=id=>{dirty.add(id);onChange()};

 // Rendering --------------------------------------------------------------
 function marker(b){
  if(b.type==='bullet')return '<span class="blk-mark" contenteditable="false">•</span>';
  if(b.type==='ordered')return '<span class="blk-mark num" contenteditable="false">1.</span>';
  if(b.type==='todo')return `<span class="blk-mark" contenteditable="false"><input type="checkbox" class="blk-check" ${b.checked?'checked':''} ${canEdit?'':'disabled'} aria-label="完成"></span>`;
  return '';
 }
 function tableHTML(b){
  const rows=b.rows?.length?b.rows:[['',''],['','']];const cols=Math.max(...rows.map(r=>r.length),1);
  return `<div class="blk-table-wrap"><table class="blk-table"><tbody>${rows.map((r,i)=>`<tr>${Array.from({length:cols},(_,j)=>`<td contenteditable="${canEdit}" data-r="${i}" data-c="${j}">${esc(r[j]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table>${canEdit?'<div class="blk-table-tools"><button data-table="row">+ 行</button><button data-table="col">+ 列</button><button data-table="-row">− 行</button><button data-table="-col">− 列</button></div>':''}</div>`;
 }
 function build(b){
  const el=document.createElement('div');el.className='blk';el.dataset.id=b.id;el.dataset.type=b.type;el.dataset.checked=b.checked?'1':'0';
  const handle=canEdit?`<span class="blk-gutter" contenteditable="false"><button class="blk-handle" draggable="true" title="拖动或点击" aria-label="段落操作">⋮⋮</button></span>`:'';
  if(b.type==='divider'){el.contentEditable='false';el.innerHTML=handle+'<hr>'}
  else if(b.type==='table'){el.contentEditable='false';el.innerHTML=handle+tableHTML(b)}
  else if(b.type==='code'){el.innerHTML=`${handle}<pre class="blk-text" spellcheck="false"></pre>`;el.querySelector('.blk-text').textContent=b.text||''}
  else{el.innerHTML=`${handle}${marker(b)}<div class="blk-text" data-placeholder="${b.type==='p'?'输入“/”快速插入内容':TYPES.find(t=>t[0]===b.type)?.[1]||''}"></div>`;el.querySelector('.blk-text').innerHTML=toHTML(b.text||'')}
  els.set(b.id,el);return el;
 }
 // setText replaces a block's text and keeps the caret where it was.
 function setText(id,md){
  const t=textEl(id);if(!t)return;const had=t.contains(getSelection()?.anchorNode);let off=0,old='';
  if(had){off=caretOffset(t,getSelection().anchorNode,getSelection().anchorOffset);old=typeOf(id)==='code'?localText(id):plain(localText(id))}
  if(typeOf(id)==='code')t.textContent=md;else t.innerHTML=toHTML(md);
  if(conf.get(id))conf.get(id).lastLocal=md;
  if(had)placeCaret(t,shiftOffset(old,typeOf(id)==='code'?md:plain(md),off));
 }
 // rebuild redraws a block (type or attributes changed), keeping the caret.
 function rebuild(id,b){
  const old=els.get(id);if(!old)return;const t=textEl(id),sel=getSelection();let off=-1;
  if(t&&sel?.anchorNode&&t.contains(sel.anchorNode))off=caretOffset(t,sel.anchorNode,sel.anchorOffset);
  const el=build(b);old.replaceWith(el);renumber();
  if(off>=0&&textEl(id))placeCaret(textEl(id),off);
 }
 function renumber(){let n=0;for(const el of root.children){if(el.dataset.type==='ordered'){n++;const m=el.querySelector('.blk-mark');if(m)m.textContent=n+'.'}else n=0}scheduleOutline()}
 function render(blocks){
  root.textContent='';els.clear();conf.clear();
  for(const b of blocks){conf.set(b.id,{...b});root.append(build(b))}
  renumber();paintPeers();
 }
 function scheduleOutline(){clearTimeout(outlineTimer);outlineTimer=setTimeout(drawOutline,120)}
 function drawOutline(){
  if(!outline)return;const heads=[...root.children].filter(e=>/^h[123]$/.test(e.dataset.type));
  outline.innerHTML=heads.length?'<h5>目录</h5>'+heads.map(e=>`<button class="lvl-${e.dataset.type}" data-outline="${e.dataset.id}">${esc(plain(localText(e.dataset.id))||'无标题')}</button>`).join(''):'';
 }

 // Local changes ------------------------------------------------------------
 function record(group){if(!group.length)return;undo.push(group);if(undo.length>200)undo.shift();redo.length=0}
 function insertBlock(b,after,{focus=true,history=true,caret=0}={}){
  const el=build(b);const ref=after?els.get(after):null;
  if(after===''){root.prepend(el)}else if(ref)ref.after(el);else root.append(el);
  conf.set(b.id,{...b});localOnly.add(b.id);queue({op:'insert',after:after||'',block:{...b}});renumber();
  if(history)record([{kind:'insert',id:b.id}]);
  if(focus&&textEl(b.id))placeCaret(textEl(b.id),caret);
  return b.id;
 }
 function removeBlock(id,{history=true}={}){
  const el=els.get(id);if(!el)return;const snap=snapshot(id),after=prevId(id);
  el.remove();els.delete(id);dirty.delete(id);queue({op:'delete',id});renumber();
  if(history)record([{kind:'delete',block:snap,after}]);
  if(!root.children.length)insertBlock({id:newId(),type:'p',text:''},'',{history:false});
 }
 function setType(id,type,extra={}){
  const b=snapshot(id);if(b.type===type&&!Object.keys(extra).length)return;
  const before={type:b.type,checked:b.checked,lang:b.lang,rows:b.rows};
  let text=b.text;
  if(type==='code'&&b.type!=='code')text=plain(b.text);
  if(b.type==='code'&&type!=='code')text=toMarkdown([{text:b.text}]);
  const next={...b,type,text,...extra};if(type!=='todo')next.checked=false;if(type==='table'&&!next.rows)next.rows=[['',''],['','']];
  rebuild(id,next);
  queue({op:'block',block:{id,type,checked:!!next.checked,lang:next.lang||'',rows:type==='table'?next.rows:undefined}});
  if(text!==b.text){touch(id)}
  record([{kind:'attrs',id,before,after:{type,checked:!!next.checked,lang:next.lang||'',rows:next.rows}}]);
 }
 function textChanged(id){
  const now=localText(id),c=conf.get(id),before=c?.lastLocal??c?.text??'',g=undo[undo.length-1];
  if(burst&&burst.id===id&&Date.now()-burst.at<1200&&g&&g[0]===burst.entry){burst.entry._a=now;burst.at=Date.now()}
  else{const entry={kind:'text',id,_b:before,_a:now};record([entry]);burst={id,at:Date.now(),entry}}
  if(c)c.lastLocal=now;touch(id);scheduleOutline();
 }
 function writeText(id,md,{history=true,caret}={}){
  const before=localText(id);if(before===md)return;
  const t=textEl(id);if(!t)return;
  if(typeOf(id)==='code')t.textContent=md;else t.innerHTML=toHTML(md);
  if(caret!==undefined)placeCaret(t,caret);
  if(history)record([{kind:'text',id,_b:before,_a:md}]);
  if(conf.get(id))conf.get(id).lastLocal=md;
  touch(id);scheduleOutline();
 }
 function revert(group,dir){
  // dir='undo' applies inverses in reverse order.
  const list=dir==='undo'?[...group].reverse():group;
  for(const c of list){
   if(c.kind==='text'){if(!els.has(c.id))continue;const cur=localText(c.id),from=dir==='undo'?c._a:c._b,to=dir==='undo'?c._b:c._a;writeText(c.id,mergeText(from,to,cur),{history:false});const t=textEl(c.id);if(t)placeCaret(t,(typeOf(c.id)==='code'?to:plain(to)).length)}
   else if(c.kind==='insert'){if(dir==='undo')removeBlock(c.id,{history:false});else if(c.block)insertBlock(c.block,c.after,{history:false})}
   else if(c.kind==='delete'){if(dir==='undo'){if(!els.has(c.block.id))insertBlock(c.block,c.after&&els.has(c.after)?c.after:'',{history:false})}else removeBlock(c.block.id,{history:false})}
   else if(c.kind==='move'){if(els.has(c.id))moveRaw(c.id,dir==='undo'?c.from:c.to)}
   else if(c.kind==='attrs'){if(!els.has(c.id))continue;const a=dir==='undo'?c.before:c.after;const b=snapshot(c.id);rebuild(c.id,{...b,...a});queue({op:'block',block:{id:c.id,type:a.type,checked:!!a.checked,lang:a.lang||'',rows:a.type==='table'?a.rows:undefined}})}
  }
 }
 // Undo of an insert must know the block to redo it.
 const remember=group=>group.map(c=>c.kind==='insert'&&els.has(c.id)?{...c,block:snapshot(c.id),after:prevId(c.id)}:c);
 function doUndo(){const g=undo.pop();if(!g)return;burst=null;const full=remember(g);revert(full,'undo');redo.push(full)}
 function doRedo(){const g=redo.pop();if(!g)return;burst=null;revert(g,'redo');undo.push(g)}

 // Selection --------------------------------------------------------------
 function point(node,offset){
  const el=blockOf(node);if(!el)return null;const id=el.dataset.id,t=textEl(id);
  if(!t||!t.contains(node)&&t!==node){const pos=node===el?offset:0;return {id,off:pos>0&&t?plain(localText(id)).length:0,atom:!t}}
  return {id,off:caretOffset(t,node,offset)};
 }
 function range(){
  const sel=getSelection();if(!sel?.rangeCount||!root.contains(sel.anchorNode))return null;const r=sel.getRangeAt(0);
  const a=point(r.startContainer,r.startOffset),b=point(r.endContainer,r.endOffset);if(!a||!b)return null;
  return {start:a,end:b,collapsed:r.collapsed,single:a.id===b.id};
 }
 function selectedIds(){const r=range();if(!r)return [];const ids=domOrder();const i=ids.indexOf(r.start.id),j=ids.indexOf(r.end.id);return i<0||j<0?[]:ids.slice(i,j+1)}
 // deleteRange removes the selected content across blocks; returns the caret.
 function deleteRange(r){
  const ids=domOrder(),i=ids.indexOf(r.start.id),j=ids.indexOf(r.end.id);
  if(r.single){const id=r.start.id;if(!textEl(id))return {id,off:0};const md=localText(id);const code=typeOf(id)==='code';
   const next=code?[...md].slice(0,r.start.off).join('')+[...md].slice(r.end.off).join(''):toMarkdown([...sliceRuns(runs(md),0,r.start.off),...sliceRuns(runs(md),r.end.off)]);
   writeText(id,next,{caret:r.start.off});return {id,off:r.start.off}}
  const first=ids[i],last=ids[j];const group=[];
  const head=textEl(first)?sliceRuns(runs(localText(first)),0,r.start.off):null,tail=textEl(last)?sliceRuns(runs(localText(last)),r.end.off):[];
  for(const id of ids.slice(i+1,j+1)){group.push({kind:'delete',block:snapshot(id),after:prevId(id)});const el=els.get(id);el.remove();els.delete(id);dirty.delete(id);queue({op:'delete',id})}
  if(head){const before=localText(first),md=toMarkdown([...head,...tail]);writeText(first,md,{history:false,caret:r.start.off});group.unshift({kind:'text',id:first,_b:before,_a:md});record(group);renumber();return {id:first,off:r.start.off}}
  group.unshift({kind:'delete',block:snapshot(first),after:prevId(first)});const keep=prevId(first);els.get(first).remove();els.delete(first);queue({op:'delete',id:first});record(group);renumber();
  if(!root.children.length)insertBlock({id:newId(),type:'p',text:''},'',{history:false});
  const target=keep&&els.has(keep)?keep:root.firstElementChild.dataset.id;if(textEl(target))placeCaret(textEl(target),plain(localText(target)).length);return {id:target,off:0};
 }

 // Editing commands -------------------------------------------------------------
 function split(id,off){
  const type=typeOf(id),md=localText(id),code=type==='code';
  if(code){insertAt(id,off,'\n',true);return}
  const list=runs(md),textLen=plain(md).length;
  if(LISTS.has(type)||type==='quote'){if(!textLen){setType(id,'p');return}}
  const nextType=LISTS.has(type)?type:'p';
  if(off===0&&textLen){const nb={id:newId(),type:/^h[123]$/.test(type)?'p':nextType,text:''};insertBlock(nb,prevId(id),{focus:false});placeCaret(textEl(id),0);return}
  const before=toMarkdown(sliceRuns(list,0,off)),after=toMarkdown(sliceRuns(list,off));
  writeText(id,before,{history:false});
  const nb={id:newId(),type:nextType,text:after};
  insertBlock(nb,id,{history:false,caret:0});
  record([{kind:'text',id,_b:md,_a:before},{kind:'insert',id:nb.id}]);
 }
 function insertAt(id,off,text,raw=false){
  const md=localText(id);
  if(typeOf(id)==='code'){const c=[...md];writeText(id,c.slice(0,off).join('')+text+c.slice(off).join(''),{caret:off+[...text].length});return}
  const add=raw?[{text}]:runs(text);const list=runs(md);
  writeText(id,toMarkdown([...sliceRuns(list,0,off),...add,...sliceRuns(list,off)]),{caret:off+[...add.map(r=>r.text).join('')].length});
 }
 function mergeBack(id){
  const type=typeOf(id);
  if(type!=='p'&&type!=='code'&&TEXTUAL.has(type)){setType(id,'p');return true}
  if(type==='code'&&localText(id)===''){setType(id,'p');return true}
  const prev=prevId(id);if(!prev)return false;const pt=typeOf(prev);
  if(pt==='divider'){removeBlock(prev);return true}
  if(!textEl(prev)){return true}
  const a=localText(prev),b=localText(id),joined=pt==='code'?a+plain(b):toMarkdown([...runs(a),...runs(b)]);
  const at=pt==='code'?[...a].length:plain(a).length;
  const snap=snapshot(id);
  writeText(prev,joined,{history:false,caret:at});els.get(id).remove();els.delete(id);dirty.delete(id);queue({op:'delete',id});renumber();
  record([{kind:'text',id:prev,_b:a,_a:joined},{kind:'delete',block:snap,after:prev}]);
  placeCaret(textEl(prev),at);return true;
 }
 function mergeForward(id){const next=nextId(id);if(!next)return false;if(!textEl(next)){if(typeOf(next)==='divider')removeBlock(next);return true}placeCaret(textEl(next),0);return mergeBack(next)}
 let typing=null;
 function typeWithMarks(id,off,text){const list=runs(localText(id)),at=sliceRuns(list,off-1,off)[0]||{};const marks={b:!!at.b,i:!!at.i,s:!!at.s,u:!!at.u,code:!!at.code,link:at.link||'',...typing.marks};writeText(id,toMarkdown([...sliceRuns(list,0,off),{...marks,text},...sliceRuns(list,off)]),{caret:off+[...text].length});typing.off=off+[...text].length}
 function markSelection(mark,value){
  const r0=range();if(r0&&r0.collapsed&&r0.single&&textEl(r0.start.id)&&typeOf(r0.start.id)!=='code'&&mark!=='link'){const cur=sliceRuns(runs(localText(r0.start.id)),r0.start.off-1,r0.start.off)[0]||{};const base=typing&&typing.id===r0.start.id&&typing.off===r0.start.off?typing.marks:{};typing={id:r0.start.id,off:r0.start.off,marks:{...base,[mark]:!(mark in base?base[mark]:cur[mark])}};return}
  const r=range();if(!r||r.collapsed||!r.single||typeOf(r.start.id)==='code'||!textEl(r.start.id))return;
  const id=r.start.id,md=localText(id),next=toggleMark(md,r.start.off,r.end.off,mark,value);
  writeText(id,next);selectText(id,r.start.off,r.end.off);showBar();
 }
 function selectText(id,a,b){const t=textEl(id);placeCaret(t,a);const s=getSelection(),start=s.getRangeAt(0).cloneRange();placeCaret(t,b);const e=s.getRangeAt(0);const rr=document.createRange();rr.setStart(start.startContainer,start.startOffset);rr.setEnd(e.endContainer,e.endOffset);s.removeAllRanges();s.addRange(rr)}
 function paste(text,r){
  const pos=r.collapsed?r.start:deleteRange(r);const id=pos.id;if(!textEl(id))return;
  if(typeOf(id)==='code'){insertAt(id,pos.off,text,true);return}
  const lines=text.replace(/\r\n?/g,'\n');
  if(!lines.includes('\n')){insertAt(id,pos.off,lines);return}
  const blocks=markdownBlocks(lines,newId);if(!blocks.length)return;
  const md=localText(id),list=runs(md),before=sliceRuns(list,0,pos.off),after=toMarkdown(sliceRuns(list,pos.off));
  const group=[];let first=0;
  if(blocks[0].type==='p'){const joined=toMarkdown([...before,...runs(blocks[0].text)]);writeText(id,joined,{history:false});group.push({kind:'text',id,_b:md,_a:joined});first=1}
  else{const cut=toMarkdown(before);writeText(id,cut,{history:false});group.push({kind:'text',id,_b:md,_a:cut})}
  let at=id;for(const b of blocks.slice(first)){insertBlock(b,at,{focus:false,history:false});group.push({kind:'insert',id:b.id});at=b.id}
  const last=at;
  if(after){if(textEl(last)&&typeOf(last)!=='code'){const end=plain(localText(last)).length;writeText(last,toMarkdown([...runs(localText(last)),...runs(after)]),{history:false,caret:end})}else{const nb={id:newId(),type:'p',text:after};insertBlock(nb,last,{history:false});group.push({kind:'insert',id:nb.id})}}
  record(group);
  const t=textEl(last)||textEl(id);if(t&&!after)placeCaret(t,(typeOf(last)==='code'?localText(last):plain(localText(last))).length);
 }

 // Slash menu and toolbar ------------------------------------------------------
 function closeMenu(){menu?.el.remove();menu=null}
 function openMenu(id,off){
  closeMenu();const el=document.createElement('div');el.className='doc-slash';el.setAttribute('role','listbox');document.body.append(el);
  menu={el,id,start:off,index:0,items:[]};drawMenu('');
  const rect=getSelection().getRangeAt(0).getBoundingClientRect();const top=Math.min(rect.bottom+6,innerHeight-320);el.style.left=Math.min(rect.left,innerWidth-230)+'px';el.style.top=Math.max(8,top)+'px';
 }
 function drawMenu(q){
  if(!menu)return;menu.q=q;const query=q.trim().toLowerCase();
  menu.items=TYPES.filter(([t,label,short])=>!query||label.includes(query)||t.includes(query)||short.toLowerCase().includes(query)||({p:'zw text',h1:'bt1 title',h2:'bt2',h3:'bt3',bullet:'lb list wx',ordered:'yx num',todo:'db rw task',quote:'yy',code:'dm',divider:'fgx line hr',table:'bg table'}[t]||'').includes(query));
  menu.index=Math.min(menu.index,Math.max(0,menu.items.length-1));
  menu.el.innerHTML=menu.items.length?menu.items.map(([t,label,short],i)=>`<button role="option" class="${i===menu.index?'active':''}" data-slash="${t}"><span>${esc(short)}</span>${label}</button>`).join(''):'<p>没有匹配的内容</p>';
 }
 function chooseMenu(type){
  if(!menu)return;const {id,start}=menu;closeMenu();const t=textEl(id);if(!t)return;
  const md=localText(id),list=runs(md),end=caretOffset(t,getSelection().anchorNode,getSelection().anchorOffset);
  const rest=toMarkdown([...sliceRuns(list,0,start-1),...sliceRuns(list,Math.max(end,start))]);
  writeText(id,rest,{caret:start-1});
  if(type==='divider'||type==='table'){
   const empty=!plain(rest).trim(),nb={id:newId(),type,text:'',rows:type==='table'?[['','',''],['','',''],['','','']]:undefined};
   insertBlock(nb,id,{focus:false});if(empty)removeBlock(id);
   if(type==='divider')insertBlock({id:newId(),type:'p',text:''},nb.id);else els.get(nb.id)?.querySelector('td')?.focus();
   return}
  if(!plain(rest).trim())setType(id,type);
  else{insertBlock({id:newId(),type,text:''},id)}
 }
 function showBar(){
  const sel=getSelection(),r=range();if(!canEdit||!r||r.collapsed||!sel.rangeCount){bar?.remove();bar=null;return}
  const rect=sel.getRangeAt(0).getBoundingClientRect();if(!rect.width&&!rect.height){bar?.remove();bar=null;return}
  if(!bar){bar=document.createElement('div');bar.className='doc-toolbar';bar.addEventListener('mousedown',e=>e.preventDefault());document.body.append(bar)}
  const inline=r.single&&typeOf(r.start.id)!=='code'&&textEl(r.start.id);
  bar.innerHTML=(inline?[['b','<b>B</b>','粗体 Ctrl+B'],['i','<i>I</i>','斜体 Ctrl+I'],['s','<s>S</s>','删除线'],['u','<u>U</u>','下划线 Ctrl+U'],['code','&lt;/&gt;','行内代码 Ctrl+E'],['link','🔗','链接 Ctrl+K']].map(([m,l,t])=>`<button data-mark="${m}" title="${t}">${l}</button>`).join('')+'<span class="sep"></span>':'')+
   [['h1','H1'],['h2','H2'],['h3','H3'],['bullet','•'],['ordered','1.'],['todo','☐']].map(([t,l])=>`<button data-turn="${t}" title="${TYPES.find(x=>x[0]===t)[1]}">${l}</button>`).join('')+(askAI?'<span class="sep"></span><button data-bar-ai class="ai">✦ AI</button>':'');
  const w=bar.offsetWidth||360;bar.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left+rect.width/2-w/2))+'px';bar.style.top=Math.max(8,rect.top-46)+'px';
 }
 async function linkPrompt(){
  const r=range();if(!r||r.collapsed||!r.single)return;const current=runs(localText(r.start.id));const has=sliceRuns(current,r.start.off,r.end.off).find(x=>x.link)?.link||'';
  const url=await inputDialog('留空则移除链接',{title:'链接地址',value:has||'https://',placeholder:'https://'});if(url===null)return;
  selectText(r.start.id,r.start.off,r.end.off);const clean=url.trim();
  if(clean&&!/^(https?:\/\/|mailto:|www\.)/i.test(clean)){toast('请输入以 http:// 或 https:// 开头的链接');return}
  markSelection('link',clean===''||clean==='https://'?'':clean);
 }

 // Events -------------------------------------------------------------------------
 let composeFrom=null;
 root.addEventListener('compositionstart',()=>{composing=true;const r=range();composeFrom=r&&r.collapsed&&typing&&typing.id===r.start.id&&typing.off===r.start.off?{...typing}:null});
 root.addEventListener('compositionend',()=>{composing=false;afterInput();const r=range();if(composeFrom&&r&&r.collapsed&&r.start.id===composeFrom.id&&r.start.off>composeFrom.off){const id=r.start.id,list=runs(localText(id)),typed=sliceRuns(list,composeFrom.off,r.start.off).map(x=>({...x,...composeFrom.marks}));writeText(id,toMarkdown([...sliceRuns(list,0,composeFrom.off),...typed,...sliceRuns(list,r.start.off)]),{caret:r.start.off});typing={...composeFrom,off:r.start.off}}composeFrom=null});
 root.addEventListener('beforeinput',e=>{
  if(!canEdit){e.preventDefault();return}
  const cell=e.target.closest?.('td');if(cell){if(e.inputType==='insertParagraph'||e.inputType==='insertFromPaste'&&/\n/.test(e.dataTransfer?.getData('text/plain')||''))e.preventDefault();return}
  const r=range();if(!r){e.preventDefault();return}
  const type=e.inputType;
  if(type==='historyUndo'){e.preventDefault();doUndo();return}
  if(type==='historyRedo'){e.preventDefault();doRedo();return}
  if(type.startsWith('format')){e.preventDefault();const m={formatBold:'b',formatItalic:'i',formatUnderline:'u',formatStrikeThrough:'s'}[type];if(m)markSelection(m);return}
  if(type==='insertFromDrop'||type==='deleteByDrag'){e.preventDefault();return}
  if(type==='insertFromPaste'||type==='insertReplacementText'&&!r.single){return}
  if(type==='insertParagraph'){e.preventDefault();const p=r.collapsed?r.start:deleteRange(r);if(textEl(p.id))split(p.id,p.off);return}
  if(type==='insertLineBreak'){e.preventDefault();const p=r.collapsed?r.start:deleteRange(r);if(textEl(p.id))insertAt(p.id,p.off,'\n',true);return}
  if(!r.single||r.start.atom||r.end.atom){
   if(type.startsWith('delete')){e.preventDefault();if(!r.collapsed)deleteRange(r);return}
   if(type==='insertText'&&e.data){e.preventDefault();const p=deleteRange(r);if(textEl(p.id))insertAt(p.id,p.off,e.data,true);return}
   e.preventDefault();return;
  }
  if(type==='insertText'&&e.data&&r.collapsed&&typing&&typing.id===r.start.id&&typing.off===r.start.off){e.preventDefault();typeWithMarks(r.start.id,r.start.off,e.data);return}
  if(r.collapsed&&(type==='deleteContentBackward'||type==='deleteWordBackward'||type==='deleteSoftLineBackward')&&r.start.off===0){e.preventDefault();mergeBack(r.start.id);return}
  if(r.collapsed&&(type==='deleteContentForward'||type==='deleteWordForward')&&r.start.off===(typeOf(r.start.id)==='code'?[...localText(r.start.id)].length:plain(localText(r.start.id)).length)){e.preventDefault();mergeForward(r.start.id);return}
 });
 function afterInput(){
  if(composing)return;const sel=getSelection();const el=blockOf(sel?.anchorNode);
  // Text typed outside a block's text area goes back where it belongs.
  for(const node of [...root.childNodes])if(!(node.nodeType===1&&node.classList.contains('blk'))){node.remove()}
  if(!el)return;const id=el.dataset.id,t=textEl(id);if(!t)return;
  for(const stray of [...el.childNodes])if(stray.nodeType===3&&stray.data.trim()){t.append(stray)}
  textChanged(id);
  const off=caretOffset(t,sel.anchorNode,sel.anchorOffset),txt=plain(localText(id));
  // Markdown shortcuts at the start of a plain paragraph.
  if(typeOf(id)==='p'){
   const rules=[[/^#\s/,'h1'],[/^##\s/,'h2'],[/^###\s/,'h3'],[/^[-*+]\s/,'bullet'],[/^1[.)]\s/,'ordered'],[/^(\[\s?\]|【\s?】)\s/,'todo'],[/^>\s/,'quote'],[/^```$/,'code'],[/^---$/,'divider']];
   for(const [re,type] of rules){const m=re.exec(txt);if(m&&off===m[0].length){
    const rest=toMarkdown(sliceRuns(runs(localText(id)),m[0].length));writeText(id,rest,{history:false});
    if(type==='divider'){setType(id,'divider');const nb={id:newId(),type:'p',text:''};insertBlock(nb,id)}else{setType(id,type);placeCaret(textEl(id),0)}
    return}}
  }
  if(menu&&menu.id===id){const q=[...txt].slice(menu.start,off).join('');if(off<menu.start||/\s/.test(q)||q.length>12)closeMenu();else drawMenu(q)}
  else if(txt[off-1]==='/'&&(off===1||/\s/.test(txt[off-2]))&&typeOf(id)!=='code')openMenu(id,off);
 }
 root.addEventListener('input',e=>{
  const cell=e.target.closest?.('td');if(cell){tableEdited(cell);return}
  afterInput();
 });
 root.addEventListener('paste',e=>{
  if(!canEdit){e.preventDefault();return}
  if(e.target.closest?.('td')){e.preventDefault();const t=(e.clipboardData.getData('text/plain')||'').replace(/\s*\n\s*/g,' ');document.execCommand('insertText',false,t);return}
  e.preventDefault();const r=range();if(!r)return;
  if([...(e.clipboardData?.files||[])].length&&!e.clipboardData.getData('text/plain')){toast('文档暂不支持粘贴图片，可以把图片发到聊天或网盘');return}
  const text=e.clipboardData.getData('text/plain');if(text)paste(text,r);
 });
 function copySelection(e,cut){
  const r=range();if(!r||r.collapsed||r.single)return;e.preventDefault();
  const ids=domOrder(),i=ids.indexOf(r.start.id),j=ids.indexOf(r.end.id);
  const blocks=ids.slice(i,j+1).map((id,k)=>{const b=snapshot(id);if(textEl(id)&&b.type!=='code'){const list=runs(b.text);b.text=toMarkdown(sliceRuns(list,k===0?r.start.off:0,k===j-i?r.end.off:Infinity))}return b});
  e.clipboardData.setData('text/plain',blocksMarkdown(blocks));
  const box=document.createElement('div');box.append(getSelection().getRangeAt(0).cloneContents());box.querySelectorAll('[contenteditable=false] .blk-gutter,.blk-gutter,.blk-peer').forEach(n=>n.remove());e.clipboardData.setData('text/html',box.innerHTML);
  if(cut&&canEdit)deleteRange(r);
 }
 root.addEventListener('copy',e=>copySelection(e,false));
 root.addEventListener('cut',e=>{if(!canEdit){e.preventDefault();return}copySelection(e,true)});
 root.addEventListener('keydown',e=>{
  if(menu){
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();menu.index=(menu.index+(e.key==='ArrowDown'?1:-1)+menu.items.length)%Math.max(1,menu.items.length);drawMenu(menu.q||'');return}
   if(e.key==='Enter'||e.key==='Tab'){if(menu.items.length){e.preventDefault();chooseMenu(menu.items[menu.index][0]);return}}
   if(e.key==='Escape'){e.preventDefault();closeMenu();return}
  }
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&!e.altKey){
   const k=e.key.toLowerCase();
   if(k==='z'&&!e.shiftKey){e.preventDefault();doUndo();return}
   if(k==='y'||k==='z'&&e.shiftKey){e.preventDefault();doRedo();return}
   if(!canEdit)return;
   if(k==='b'||k==='i'||k==='u'){e.preventDefault();markSelection(k);return}
   if(k==='e'){e.preventDefault();markSelection('code');return}
   if(k==='x'&&e.shiftKey){e.preventDefault();markSelection('s');return}
   if(k==='k'){e.preventDefault();linkPrompt();return}
   if(k==='s'){e.preventDefault();toast('文档会自动保存');return}
   if(k==='enter'){const r=range();if(r?.collapsed&&typeOf(r.start.id)==='code'){e.preventDefault();insertBlock({id:newId(),type:'p',text:''},r.start.id)}return}
  }
  if(mod&&e.altKey&&/^[0-3]$/.test(e.key)&&canEdit){e.preventDefault();const r=range();if(r)for(const id of selectedIds())if(TEXTUAL.has(typeOf(id)))setType(id,e.key==='0'?'p':'h'+e.key);return}
  // Move between blocks with the arrow keys.
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&!e.shiftKey&&!mod){
   const r=range();if(!r||!r.collapsed)return;const id=r.start.id,t=textEl(id);if(!t)return;
   const len=typeOf(id)==='code'?[...localText(id)].length:plain(localText(id)).length;
   const caret=getSelection().getRangeAt(0).getBoundingClientRect(),box=t.getBoundingClientRect();
   const firstLine=!caret.height||caret.top-box.top<18,lastLine=!caret.height||box.bottom-caret.bottom<18;
   const go=(target,end)=>{if(!target)return false;let x=target;while(x&&!textEl(x)){x=e.key==='ArrowUp'||e.key==='ArrowLeft'?prevId(x):nextId(x)}if(!x)return false;e.preventDefault();placeCaret(textEl(x),end?(typeOf(x)==='code'?[...localText(x)].length:plain(localText(x)).length):0);return true};
   if(e.key==='ArrowUp'&&firstLine)go(prevId(id),true);
   else if(e.key==='ArrowDown'&&lastLine)go(nextId(id),false);
   else if(e.key==='ArrowLeft'&&r.start.off===0)go(prevId(id),true);
   else if(e.key==='ArrowRight'&&r.start.off===len)go(nextId(id),false);
  }
  if(e.key==='Tab'&&canEdit){const r=range();if(r&&typeOf(r.start.id)==='code'){e.preventDefault();insertAt(r.start.id,r.start.off,'  ',true)}else if(r)e.preventDefault()}
 });
 root.addEventListener('click',e=>{
  const check=e.target.closest('.blk-check');
  if(check){const id=blockOf(check)?.dataset.id;if(!id||!canEdit){e.preventDefault();return}const b=snapshot(id);const checked=check.checked;els.get(id).dataset.checked=checked?'1':'0';queue({op:'block',block:{id,type:'todo',checked}});record([{kind:'attrs',id,before:{type:'todo',checked:!checked},after:{type:'todo',checked}}]);return}
  const link=e.target.closest('a[data-href]');if(link&&(!canEdit||e.ctrlKey||e.metaKey)){e.preventDefault();if(link.getAttribute('href'))window.open(link.getAttribute('href'),'_blank','noopener')}
  const tool=e.target.closest('[data-table]');if(tool){e.preventDefault();tableTool(blockOf(tool).dataset.id,tool.dataset.table);return}
  const handle=e.target.closest('.blk-handle');if(handle){e.preventDefault();blockMenu(blockOf(handle).dataset.id,handle);return}
  // Clicking below the last block continues writing at the end.
  if(e.target===root&&canEdit){const last=root.lastElementChild?.dataset.id;if(last&&textEl(last)&&!localText(last))placeCaret(textEl(last),0);else if(last){insertBlock({id:newId(),type:'p',text:''},last)}}
 });
 document.addEventListener('mousedown',globalDown,true);
 function globalDown(e){
  if(menu&&!menu.el.contains(e.target))closeMenu();
  const slash=e.target.closest?.('[data-slash]');if(slash){e.preventDefault();chooseMenu(slash.dataset.slash);return}
  const mark=e.target.closest?.('.doc-toolbar [data-mark]');if(mark){e.preventDefault();if(mark.dataset.mark==='link')linkPrompt();else markSelection(mark.dataset.mark);return}
  const turn=e.target.closest?.('.doc-toolbar [data-turn]');if(turn){e.preventDefault();for(const id of selectedIds())if(TEXTUAL.has(typeOf(id)))setType(id,turn.dataset.turn);showBar();return}
  const ai=e.target.closest?.('.doc-toolbar [data-bar-ai]');if(ai){e.preventDefault();askAI?.(selectedIds());return}
  const opt=e.target.closest?.('.doc-block-menu [data-block-op]');if(opt){e.preventDefault();blockOp(opt.dataset.id,opt.dataset.blockOp);document.querySelector('.doc-block-menu')?.remove();return}
  if(!e.target.closest?.('.doc-block-menu'))document.querySelector('.doc-block-menu')?.remove();
 }
 function selectionChanged(){
  if(!root.isConnected)return;const sel=getSelection();if(!sel?.anchorNode||!root.contains(sel.anchorNode)){if(bar&&!bar.matches(':hover')){bar.remove();bar=null}return}
  showBar();const id=blockOf(sel.anchorNode)?.dataset.id||'';root.querySelector('.blk.current')?.classList.remove('current');if(id)els.get(id)?.classList.add('current');
  if(id!==lastWhere){lastWhere=id;clearTimeout(whereTimer);whereTimer=setTimeout(()=>onWhere(id),250)}
  if(menu&&id!==menu.id)closeMenu();
 }
 document.addEventListener('selectionchange',selectionChanged);

 // Block menu and drag ----------------------------------------------------------------
 function blockMenu(id,anchor){
  document.querySelector('.doc-block-menu')?.remove();const box=document.createElement('div');box.className='doc-block-menu';
  const type=typeOf(id);
  box.innerHTML=(TEXTUAL.has(type)?'<h6>转换为</h6><div class="turn-grid">'+TYPES.filter(t=>TEXTUAL.has(t[0])).map(([t,l,s])=>`<button data-block-op="turn:${t}" data-id="${id}" class="${t===type?'active':''}" title="${l}">${esc(s)}</button>`).join('')+'</div>':'')+
   `<button data-block-op="up" data-id="${id}">上移</button><button data-block-op="down" data-id="${id}">下移</button><button data-block-op="copy" data-id="${id}">复制内容</button>${askAI?`<button data-block-op="ai" data-id="${id}">✦ 让 AI 处理这段</button>`:''}<button data-block-op="delete" data-id="${id}" class="danger">删除</button>`;
  document.body.append(box);const r=anchor.getBoundingClientRect();box.style.left=Math.max(8,r.left)+'px';box.style.top=Math.min(r.bottom+4,innerHeight-box.offsetHeight-8)+'px';
 }
 function moveRaw(id,after){const el=els.get(id);if(!el||after===id)return;if(after==='')root.prepend(el);else if(els.has(after))els.get(after).after(el);else return;queue({op:'move',id,after});renumber()}
 function moveBlock(id,after){const from=prevId(id);moveRaw(id,after);record([{kind:'move',id,from,to:after}])}
 function blockOp(id,op){
  if(op.startsWith('turn:')){setType(id,op.slice(5));return}
  if(op==='delete'){removeBlock(id);return}
  if(op==='up'){const p=prevId(id);if(p)moveBlock(id,prevId(p));return}
  if(op==='down'){const n=nextId(id);if(n)moveBlock(id,n);return}
  if(op==='copy'){navigator.clipboard?.writeText(blocksMarkdown([snapshot(id)])).then(()=>toast('已复制'),()=>toast('复制失败'));return}
  if(op==='ai'){askAI?.([id])}
 }
 let dragging='';
 root.addEventListener('dragstart',e=>{const h=e.target.closest?.('.blk-handle');if(!h){e.preventDefault();return}dragging=blockOf(h).dataset.id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/x-linkme-block',dragging);els.get(dragging).classList.add('dragging')});
 root.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();const el=blockOf(e.target);root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));if(el&&el.dataset.id!==dragging){const r=el.getBoundingClientRect();el.classList.add(e.clientY<r.top+r.height/2?'drop-before':'drop-after')}});
 root.addEventListener('drop',e=>{if(!dragging)return;e.preventDefault();const el=root.querySelector('.drop-before,.drop-after');if(el){const target=el.dataset.id;moveBlock(dragging,el.classList.contains('drop-before')?prevId(target):target)}});
 root.addEventListener('dragend',()=>{if(dragging)els.get(dragging)?.classList.remove('dragging');dragging='';root.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'))});

 // Tables -----------------------------------------------------------------------------
 const tableRows=id=>[...els.get(id).querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.innerText.replace(/\n+$/,'').replace(/\n/g,' ')));
 let tableTimer=0;
 function tableEdited(cell){const id=blockOf(cell)?.dataset.id;if(!id)return;clearTimeout(tableTimer);tableTimer=setTimeout(()=>{const rows=tableRows(id);if(conf.get(id))conf.get(id).rows=rows;queue({op:'block',block:{id,type:'table',rows}})},300)}
 function tableTool(id,tool){
  const rows=tableRows(id),focus=document.activeElement?.closest?.('td');const r=focus?+focus.dataset.r:rows.length-1,c=focus?+focus.dataset.c:rows[0].length-1;
  if(tool==='row'&&rows.length<500)rows.splice(r+1,0,rows[0].map(()=>''));
  if(tool==='col'&&rows[0].length<50)rows.forEach(row=>row.splice(c+1,0,''));
  if(tool==='-row'&&rows.length>1)rows.splice(r,1);
  if(tool==='-col'&&rows[0].length>1)rows.forEach(row=>row.splice(c,1));
  const b=snapshot(id);b.rows=rows;rebuild(id,b);queue({op:'block',block:{id,type:'table',rows}});
 }

 // Remote changes ---------------------------------------------------------------------
 function reorder(order){
  const want=order.filter(id=>els.has(id));const local=domOrder().filter(id=>localOnly.has(id)&&!order.includes(id));
  // Blocks inserted here and not yet confirmed stay after their neighbour.
  for(const id of local){const prev=prevId(id);const i=want.indexOf(prev);want.splice(i+1,0,id)}
  for(const id of domOrder())if(!want.includes(id)&&!localOnly.has(id)){els.get(id).remove();els.delete(id)}
  const now=domOrder();if(now.join()===want.join()){renumber();return}
  const sel=getSelection(),focus=sel?.anchorNode&&blockOf(sel.anchorNode)?.dataset.id,t=focus&&textEl(focus);let off=-1;if(t)off=caretOffset(t,sel.anchorNode,sel.anchorOffset);
  let prev=null;for(const id of want){const el=els.get(id);if(!el)continue;if(prev?prev.nextElementSibling!==el:root.firstElementChild!==el){if(prev)prev.after(el);else root.prepend(el)}prev=el}
  renumber();if(off>=0&&textEl(focus))placeCaret(textEl(focus),off);
 }
 function applyText(id,text,own){
  const c=conf.get(id);if(!c||!els.has(id))return;
  if(own){const sent=inflight.get(id);c.text=text;if(sent===undefined)return;const L=localText(id),merged=L===sent?text:mergeText(sent,L,text);if(merged!==L)setText(id,merged);if(merged!==text)dirty.add(id);return}
  if(inflight.has(id)){c.text=text;return}
  const L=localText(id),C=c.text,merged=L===C?text:mergeText(C,L,text);c.text=text;if(merged!==L)setText(id,merged);if(merged!==text)dirty.add(id);else dirty.delete(id);
 }
 function apply(msg,own){
  for(const op of msg.ops||[]){
   if(op.op==='insert'){const b=op.block,known=els.has(b.id);localOnly.delete(b.id);
    if(!known){conf.set(b.id,{...b});const el=build(b),ref=op.after?els.get(op.after):null;if(op.after==='')root.prepend(el);else if(ref)ref.after(el);else root.append(el)}
    else if(!conf.has(b.id))conf.set(b.id,{...b})}
   else if(op.op==='delete'){conf.delete(op.id);dirty.delete(op.id);inflight.delete(op.id);localOnly.delete(op.id);const el=els.get(op.id);if(el){const had=el.contains(getSelection()?.anchorNode);const p=prevId(op.id)||nextId(op.id);el.remove();els.delete(op.id);if(had&&p&&textEl(p))placeCaret(textEl(p),plain(localText(p)).length)}}
   else if(op.op==='text')applyText(op.id,op.text,own);
   else if(op.op==='block'){const b=op.block,c=conf.get(b.id);if(!c)continue;Object.assign(c,{type:b.type,checked:!!b.checked,lang:b.lang||'',rows:b.rows});const el=els.get(b.id);if(!el)continue;
    if(own)continue;
    if(el.dataset.type!==b.type||b.type==='table'&&!el.contains(document.activeElement)){rebuild(b.id,{...snapshot(b.id),type:b.type,checked:!!b.checked,lang:b.lang,rows:b.rows,text:b.type==='code'&&el.dataset.type!=='code'?plain(localText(b.id)):localText(b.id)})}
    else if(b.type==='todo'){el.dataset.checked=b.checked?'1':'0';const box=el.querySelector('.blk-check');if(box)box.checked=!!b.checked}}
  }
  if(own)inflight.clear();
  if(msg.order)reorder(msg.order);else renumber();
  paintPeers();
 }
 function collect(){
  const ops=pending;pending=[];
  for(const id of dirty){if(!els.has(id))continue;const text=localText(id),base=conf.get(id)?.text??'';if(text!==base){ops.push({op:'text',id,base,text});inflight.set(id,text)}}
  dirty.clear();
  return ops;
 }
 function reset(content){
  const blocks=content.blocks||[];const keep=new Set(blocks.map(b=>b.id));
  for(const b of blocks){
   const old=conf.get(b.id);
   if(els.has(b.id)&&old){const L=localText(b.id),merged=L===old.text?b.text:mergeText(old.text,L,b.text);conf.set(b.id,{...b});if(els.get(b.id).dataset.type!==b.type)rebuild(b.id,{...b,text:merged});else if(merged!==L)setText(b.id,merged);if(merged!==b.text)dirty.add(b.id)}
   else{conf.set(b.id,{...b});root.append(build(b))}
  }
  for(const id of [...els.keys()])if(!keep.has(id)&&!localOnly.has(id)){els.get(id).remove();els.delete(id);conf.delete(id)}
  reorder(blocks.map(b=>b.id));inflight.clear();
 }

 // Collaborators ------------------------------------------------------------------------
 function paintPeers(){
  root.querySelectorAll('.blk-peer').forEach(n=>n.remove());root.querySelectorAll('.has-peer').forEach(n=>{n.classList.remove('has-peer');n.style.removeProperty('--peer')});
  const seen=new Set();for(const v of peers){const el=els.get(v.where);if(!el||seen.has(v.where+v.userId))continue;seen.add(v.where+v.userId);const color=peerColor(v.userId);el.classList.add('has-peer');el.style.setProperty('--peer',color);
   const tag=document.createElement('span');tag.className='blk-peer';tag.contentEditable='false';tag.dataset.skip='';tag.style.background=color;tag.textContent=v.name;tag.style.top=(el.querySelectorAll('.blk-peer').length*20)+'px';el.append(tag)}
 }

 render(content.blocks||[]);
 if(canEdit)root.contentEditable='true';
 return {
  collect,apply,reset,selectedIds,
  discardInflight(){inflight.clear()},
  hasPending:()=>pending.length>0||dirty.size>0,
  setEditable(v){if(v===canEdit)return;canEdit=v;root.contentEditable=v?'true':'false';for(const id of domOrder())rebuild(id,snapshot(id));paintPeers()},
  viewers(list){peers=list;paintPeers()},
  focusEnd(){const last=root.lastElementChild?.dataset.id;if(last&&textEl(last))placeCaret(textEl(last),plain(localText(last)).length)},
  focusStart(){const first=root.firstElementChild?.dataset.id;if(first&&textEl(first))placeCaret(textEl(first),0)},
  scrollTo(id){els.get(id)?.scrollIntoView({behavior:'smooth',block:'start'})},
  blocks:()=>domOrder().map(id=>snapshot(id)),
  // AI edits arrive as {op:replace|insert|delete,...}; returns false if stale.
  applyEdit(edit){
   if(!canEdit)return false;
   if(edit.op==='replace'){if(!els.has(edit.id))return false;const group=[];const b=snapshot(edit.id);
    if(edit.type&&edit.type!==b.type&&TEXTUAL.has(edit.type)&&TEXTUAL.has(b.type))setType(edit.id,edit.type);
    if(typeof edit.text==='string'&&textEl(edit.id)){writeText(edit.id,edit.text)}
    els.get(edit.id).classList.add('ai-flash');setTimeout(()=>els.get(edit.id)?.classList.remove('ai-flash'),1600);return true}
   if(edit.op==='delete'){if(!els.has(edit.id))return false;removeBlock(edit.id);return true}
   if(edit.op==='insert'){let at=edit.after&&els.has(edit.after)?edit.after:(edit.after===''?'':domOrder().pop());const group=[];
    for(const raw of edit.blocks||[]){const type=TYPES.some(t=>t[0]===raw.type)?raw.type:'p';const b={id:newId(),type,text:String(raw.text||''),checked:!!raw.checked,rows:type==='table'?raw.rows:undefined};insertBlock(b,at,{focus:false,history:false});group.push({kind:'insert',id:b.id});at=b.id;els.get(b.id).classList.add('ai-flash');setTimeout(()=>els.get(b.id)?.classList.remove('ai-flash'),1600)}
    record(group);return group.length>0}
   return false;
  },
  insertMarkdown(md){const blocks=markdownBlocks(md,newId);if(!blocks.length)return;const r=range();let at=r?r.end.id:domOrder().pop();const group=[];for(const b of blocks){insertBlock(b,at,{focus:false,history:false});group.push({kind:'insert',id:b.id});at=b.id}record(group);els.get(at)?.scrollIntoView({block:'nearest'})},
  undo:doUndo,redo:doRedo,
  destroy(){document.removeEventListener('selectionchange',selectionChanged);document.removeEventListener('mousedown',globalDown,true);closeMenu();bar?.remove();bar=null;document.querySelector('.doc-block-menu')?.remove();clearTimeout(whereTimer);clearTimeout(outlineTimer)},
 };
}
