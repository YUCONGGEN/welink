// Text of a document block is Markdown inline syntax. The editor shows it
// formatted; these helpers convert between that text, formatting runs and the
// editable DOM, and merge concurrent edits exactly as the server does.

const chars=s=>Array.from(s);

function splice(a,b){let p=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;let ea=a.length,eb=b.length;while(ea>p&&eb>p&&a[ea-1]===b[eb-1]){ea--;eb--}return {pos:p,del:ea-p,ins:b.slice(p,eb)}}

// mergeText replays base→mine onto theirs; see mergeText in docs_model.go.
export function mergeText(base,mine,theirs){
 if(mine===base||theirs===mine)return theirs;if(theirs===base)return mine;
 const b=chars(base),m=chars(mine),t=chars(theirs),d1=splice(b,m),d2=splice(b,t);
 const startAt=p=>p<d2.pos?p:p>=d2.pos+d2.del?p+d2.ins.length-d2.del:d2.pos+d2.ins.length;
 const endAt=p=>p<d2.pos?p:p<=d2.pos+d2.del?d2.pos:p+d2.ins.length-d2.del;
 let start=startAt(d1.pos),end=endAt(d1.pos+d1.del);if(end<start)end=start;
 const keep=d2.ins.length&&d2.pos>=start&&d2.pos+d2.ins.length<=end?t.slice(d2.pos,d2.pos+d2.ins.length):[];
 return [...t.slice(0,start),...d1.ins,...keep,...t.slice(end)].join('');
}

// shiftOffset moves a caret offset in plain text across a change old→next.
export function shiftOffset(old,next,offset){const a=chars(old),b=chars(next),d=splice(a,b);if(offset<=d.pos)return offset;if(offset>=d.pos+d.del)return offset+d.ins.length-d.del;return d.pos+d.ins.length}

const same=(a,b)=>a.b===b.b&&a.i===b.i&&a.s===b.s&&a.u===b.u&&a.code===b.code&&a.link===b.link;
const plainMark=r=>({b:!!r.b,i:!!r.i,s:!!r.s,u:!!r.u,code:!!r.code,link:r.link||''});

// runs parses inline Markdown into [{text,b,i,s,u,code,link}].
export function runs(md){
 const out=[];let cur='',st={b:false,i:false,s:false,u:false,code:false,link:''};
 const emit=()=>{if(cur){out.push({...st,text:cur});cur=''}};
 for(let i=0;i<md.length;){
  const rest=md.slice(i);
  if(rest[0]==='\\'&&rest.length>1&&'\\*_`~[]()<>#|-'.includes(rest[1])){cur+=rest[1];i+=2;continue}
  if(st.code){if(rest[0]==='`'){emit();st.code=false;i++}else{cur+=rest[0];i++}continue}
  if(rest[0]==='`'&&rest.indexOf('`',1)>0){emit();st.code=true;i++;continue}
  if(rest.startsWith('**')){emit();st.b=!st.b;i+=2;continue}
  if(rest.startsWith('~~')){emit();st.s=!st.s;i+=2;continue}
  if(rest.startsWith('<u>')){emit();st.u=true;i+=3;continue}
  if(rest.startsWith('</u>')){emit();st.u=false;i+=4;continue}
  if(rest[0]==='*'){emit();st.i=!st.i;i++;continue}
  if(rest[0]==='['){const m=/^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);if(m){emit();for(const r of runs(m[1]))out.push({...r,b:r.b||st.b,i:r.i||st.i,s:r.s||st.s,u:r.u||st.u,link:m[2]});i+=m[0].length;continue}}
  cur+=rest[0];i++;
 }
 emit();return out;
}

const escapeMd=t=>t.replace(/[\\*`~\[\]<]/g,c=>'\\'+c);

export function toMarkdown(list){
 // Join neighbours with the same marks first, so marks are not split.
 const merged=[];for(const r of list){if(!r.text)continue;const last=merged[merged.length-1];if(last&&same(last,r))last.text+=r.text;else merged.push({...plainMark(r),text:r.text})}
 let out='';
 for(const r of merged){
  let text=r.code?'`'+r.text.replace(/`/g,"'")+'`':escapeMd(r.text);
  const lead=text.length-text.replace(/^[ \n]+/,'').length,trail=text.length-text.replace(/[ \n]+$/,'').length;
  if(lead===text.length){out+=text;continue}
  let core=text.slice(lead,text.length-trail);
  if(r.i)core='*'+core+'*';if(r.b)core='**'+core+'**';if(r.s)core='~~'+core+'~~';if(r.u)core='<u>'+core+'</u>';
  if(r.link)core='['+core+']('+r.link.replace(/\)/g,'%29')+')';
  out+=text.slice(0,lead)+core+text.slice(text.length-trail);
 }
 return out;
}

export const plain=md=>runs(md).map(r=>r.text).join('');

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=u=>/^(https?:|mailto:)/i.test(u)?u:/^www\./i.test(u)?'https://'+u:'';

export function toHTML(md){
 return runs(md).map(r=>{let h=esc(r.text).replace(/\n/g,'<br>');if(r.code)h='<code>'+h+'</code>';if(r.b)h='<b>'+h+'</b>';if(r.i)h='<i>'+h+'</i>';if(r.s)h='<s>'+h+'</s>';if(r.u)h='<u>'+h+'</u>';if(r.link){const href=safeLink(r.link);h=href?`<a href="${esc(href)}" data-href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">${h}</a>`:`<a data-href="${esc(r.link)}" class="unsafe-link" title="不支持的链接">${h}</a>`}return h}).join('')||'';
}

// domRuns reads the formatted text of an editable element back into runs.
export function domRuns(root){
 const out=[];
 const walk=(node,st)=>{
  if(node.nodeType===3){if(node.data)out.push({...st,text:node.data.replace(/\u200b/g,'')});return}
  if(node.nodeType!==1)return;
  const tag=node.tagName;
  if(tag==='BR'){if(node.nextSibling||node.parentNode!==root)out.push({...st,text:'\n'});return}
  if(node.dataset?.skip!=null)return;
  const s={...st},style=node.style||{};
  if(tag==='B'||tag==='STRONG'||+style.fontWeight>=600||style.fontWeight==='bold')s.b=true;
  if(tag==='I'||tag==='EM'||style.fontStyle==='italic')s.i=true;
  if(tag==='S'||tag==='STRIKE'||tag==='DEL'||/line-through/.test(style.textDecoration||''))s.s=true;
  if(tag==='U'||/underline/.test(style.textDecoration||''))s.u=true;
  if(tag==='CODE')s.code=true;
  if(tag==='A')s.link=node.dataset.href||node.getAttribute('href')||'';
  const block=(tag==='DIV'||tag==='P')&&node!==root;
  if(block&&out.length&&!out[out.length-1].text.endsWith('\n'))out.push({...st,text:'\n'});
  for(const c of node.childNodes)walk(c,s);
 };
 for(const c of root.childNodes)walk(c,{b:false,i:false,s:false,u:false,code:false,link:''});
 return out;
}

export const domMarkdown=el=>toMarkdown(domRuns(el));

// Plain-text offsets inside an editable element (a <br> counts as one).
export function caretOffset(el,node,offset){
 const r=document.createRange();r.selectNodeContents(el);try{r.setEnd(node,offset)}catch{return 0}
 const frag=r.cloneContents(),box=document.createElement('div');box.append(frag);return chars(domRuns(box).map(x=>x.text).join('')).length;
}
export function placeCaret(el,offset,focus=true){
 const sel=getSelection();if(!sel)return;let left=offset;
 const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let node,target=null,at=0;
 while((node=walker.nextNode())){
  if(node.nodeType===3){const len=chars(node.data).length;if(left<=len){target=node;at=chars(node.data).slice(0,left).join('').length;break}left-=len}
  else if(node.tagName==='BR'){if(left===0){target=node.parentNode;at=[...node.parentNode.childNodes].indexOf(node);break}left-=1}
 }
 const r=document.createRange();if(target)r.setStart(target,at);else{r.selectNodeContents(el);r.collapse(false)}r.collapse(true);
 if(focus&&document.activeElement!==el.closest('[contenteditable=true]'))el.closest('[contenteditable=true]')?.focus({preventScroll:true});
 sel.removeAllRanges();sel.addRange(r);
}

// sliceRuns cuts runs at plain-text offsets [from,to).
export function sliceRuns(list,from,to=Infinity){
 const out=[];let pos=0;
 for(const r of list){const t=chars(r.text),s=Math.max(0,from-pos),e=Math.min(t.length,to-pos);if(e>s)out.push({...r,text:t.slice(s,e).join('')});pos+=t.length}
 return out;
}

// toggleMark adds or removes a mark on [from,to) and returns new Markdown.
export function toggleMark(md,from,to,mark,value=true){
 const list=runs(md),inside=sliceRuns(list,from,to);
 const on=mark==='link'?!!value:!inside.length||!inside.every(r=>r[mark]);
 const changed=inside.map(r=>({...r,[mark]:mark==='link'?(value||''):on}));
 return toMarkdown([...sliceRuns(list,0,from),...changed,...sliceRuns(list,to)]);
}

// Block-level Markdown, for paste and for AI results.
export function markdownBlocks(src,id){
 const lines=src.replace(/\r\n?/g,'\n').split('\n'),out=[];let para=[];
 const add=(type,text,extra={})=>out.push({id:id(),type,text,...extra});
 const flush=()=>{if(para.length){add('p',para.join('\n'));para=[]}};
 const row=l=>l.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
 for(let i=0;i<lines.length;i++){
  const line=lines[i],t=line.trim();let m;
  if(/^(```|~~~)/.test(t)){flush();const fence=t.slice(0,3),lang=t.slice(3).trim(),code=[];for(i++;i<lines.length&&!lines[i].trim().startsWith(fence);i++)code.push(lines[i]);add('code',code.join('\n'),{lang})}
  else if(!t)flush();
  else if((m=/^(#{1,6})\s+(.*)$/.exec(t))){flush();add('h'+Math.min(3,m[1].length),m[2].replace(/\s*#+$/,''))}
  else if(/^([-*_])(\s*[-*_]){2,}$/.test(t)){flush();add('divider','')}
  else if((m=/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line))){flush();add('todo',m[2],{checked:m[1]!==' '})}
  else if((m=/^\s*[-*+]\s+(.*)$/.exec(line))){flush();add('bullet',m[1])}
  else if((m=/^\s*\d+[.)]\s+(.*)$/.exec(line))){flush();add('ordered',m[1])}
  else if(t.startsWith('>')){flush();const q=[];for(;i<lines.length&&lines[i].trim().startsWith('>');i++)q.push(lines[i].trim().replace(/^>\s?/,''));i--;add('quote',q.join('\n'))}
  else if(t.startsWith('|')&&i+1<lines.length&&/^\s*\|?\s*:?-+/.test(lines[i+1])){flush();const rows=[row(line)];for(i+=2;i<lines.length&&lines[i].trim().startsWith('|');i++)rows.push(row(lines[i]));i--;add('table','',{rows})}
  else para.push(line.replace(/\s+$/,''));
 }
 flush();return out;
}

export function blocksMarkdown(blocks){
 let n=0;return blocks.map(b=>{n=b.type==='ordered'?n+1:0;switch(b.type){
  case 'h1':return '# '+b.text;case 'h2':return '## '+b.text;case 'h3':return '### '+b.text;
  case 'bullet':return '- '+b.text;case 'ordered':return n+'. '+b.text;case 'todo':return `- [${b.checked?'x':' '}] `+b.text;
  case 'quote':return '> '+b.text.replace(/\n/g,'\n> ');case 'code':return '```'+(b.lang||'')+'\n'+b.text+'\n```';case 'divider':return '---';
  case 'table':return (b.rows||[]).map((r,i)=>'| '+r.join(' | ')+' |'+(i===0?'\n|'+' --- |'.repeat(r.length):'')).join('\n');
  default:return b.text}}).join('\n\n');
}

// A little Markdown for AI replies: paragraphs, lists, headings, bold.
export function replyHTML(md){
 const inline=t=>toHTML(t.replace(/(^|[^\\])_([^_]+)_/g,'$1*$2*'));
 return markdownBlocks(md||'',()=>'').map(b=>{switch(b.type){
  case 'h1':case 'h2':case 'h3':return `<h4>${inline(b.text)}</h4>`;
  case 'bullet':case 'todo':return `<li>${inline(b.text)}</li>`;case 'ordered':return `<li class="num">${inline(b.text)}</li>`;
  case 'code':return `<pre>${esc(b.text)}</pre>`;case 'quote':return `<blockquote>${inline(b.text)}</blockquote>`;case 'divider':return '<hr>';
  case 'table':return '<table>'+(b.rows||[]).map(r=>'<tr>'+r.map(c=>`<td>${inline(c)}</td>`).join('')+'</tr>').join('')+'</table>';
  default:return `<p>${inline(b.text)}</p>`}}).join('').replace(/(<li( class="num")?>[\s\S]*?<\/li>)+/g,m=>m.includes('class="num"')?`<ol>${m}</ol>`:`<ul>${m}</ul>`);
}
