// Spreadsheet formulas: the common Excel functions and operators. The server
// stores what was typed; every client computes the values, so this is the only
// evaluator. Errors are values like Excel's (#DIV/0!, #REF!, …).

export class FormulaError{constructor(code,why=''){this.code=code;this.why=why}toString(){return this.code}}
const E=(code,why)=>new FormulaError(code,why);
export const isError=v=>v instanceof FormulaError;

export const colName=n=>{let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
export const colNumber=s=>{let n=0;for(const c of s)n=n*26+c.charCodeAt(0)-64;return n};
export function parseRef(ref){const m=/^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,5})$/.exec(ref||'');return m?{col:colNumber(m[1]),row:+m[2]}:null}
export const refName=(col,row)=>colName(col)+row;

// Tokens ---------------------------------------------------------------------
function tokenize(src){
 const out=[];let i=0;
 const sheetRef=/^(?:'((?:[^']|'')+)'|([A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*))!(\$?[A-Z]{1,3}\$?[0-9]+(?::\$?[A-Z]{1,3}\$?[0-9]+)?|[A-Z]{1,3}:[A-Z]{1,3}|[0-9]+:[0-9]+)/;
 while(i<src.length){
  const rest=src.slice(i),c=src[i];let m;
  if(/\s/.test(c)){i++;continue}
  if(c==='"'){let j=i+1,s='';while(j<src.length){if(src[j]==='"'){if(src[j+1]==='"'){s+='"';j+=2;continue}break}s+=src[j++]}if(j>=src.length)throw E('#ERROR!','引号没有闭合');out.push({t:'str',v:s});i=j+1;continue}
  if((m=sheetRef.exec(rest))){out.push({t:'ref',sheet:(m[1]?m[1].replace(/''/g,"'"):m[2]),v:m[3].replace(/\$/g,'')});i+=m[0].length;continue}
  if((m=/^\$?[A-Z]{1,3}\$?[0-9]+(?::\$?[A-Z]{1,3}\$?[0-9]+)?(?![A-Za-z0-9_(])/.exec(rest))){out.push({t:'ref',v:m[0].replace(/\$/g,'')});i+=m[0].length;continue}
  if((m=/^[A-Z]{1,3}:[A-Z]{1,3}(?![A-Za-z0-9_(])/.exec(rest))||(m=/^[0-9]+:[0-9]+(?![0-9.])/.exec(rest))){out.push({t:'ref',v:m[0]});i+=m[0].length;continue}
  if((m=/^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(rest))){out.push({t:'num',v:parseFloat(m[0])});i+=m[0].length;continue}
  if((m=/^#(DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.exec(rest))){out.push({t:'err',v:m[0]});i+=m[0].length;continue}
  if((m=/^(TRUE|FALSE)(?![A-Za-z0-9_(])/i.exec(rest))){out.push({t:'bool',v:m[1].toUpperCase()==='TRUE'});i+=m[0].length;continue}
  if((m=/^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest))){out.push({t:'fn',v:m[1].toUpperCase()});i+=m[0].length;continue}
  if((m=/^(<=|>=|<>|[-+*\/^&=<>%(),;:])/.exec(rest))){out.push({t:'op',v:m[1]===';'?',':m[1]});i+=m[1].length;continue}
  if((m=/^[A-Za-z_一-鿿][A-Za-z0-9_.一-鿿]*/.exec(rest))){throw E('#NAME?','无法识别 '+m[0])}
  throw E('#ERROR!','无法识别的字符 '+c);
 }
 return out;
}

// Parser (precedence climbing) -------------------------------------------------
function parse(src){
 const tok=tokenize(src);let p=0;
 const peek=()=>tok[p],take=()=>tok[p++],isOp=v=>peek()?.t==='op'&&peek().v===v;
 const expect=v=>{if(!isOp(v))throw E('#ERROR!','缺少 '+v);p++};
 const levels=[['=','<>','<','>','<=','>='],['&'],['+','-'],['*','/'],['^']];
 function binary(l){if(l>=levels.length)return unary();let left=binary(l+1);while(peek()?.t==='op'&&levels[l].includes(peek().v)){const op=take().v;left={k:'bin',op,a:left,b:binary(l+1)}}return left}
 function unary(){if(isOp('-')){p++;return {k:'neg',a:unary()}}if(isOp('+')){p++;return unary()}return percent()}
 function percent(){let e=primary();while(isOp('%')){p++;e={k:'pct',a:e}}return e}
 function primary(){
  const t=take();if(!t)throw E('#ERROR!','公式不完整');
  if(t.t==='num')return {k:'val',v:t.v};if(t.t==='str')return {k:'val',v:t.v};if(t.t==='bool')return {k:'val',v:t.v};if(t.t==='err')return {k:'val',v:E(t.v)};
  if(t.t==='ref')return {k:'ref',sheet:t.sheet,v:t.v};
  if(t.t==='fn'){const args=[];if(!isOp(')')){do{if(isOp(',')||isOp(')'))args.push({k:'val',v:null});else args.push(binary(0))}while(isOp(',')&&++p)}expect(')');return {k:'fn',name:t.v,args}}
  if(t.t==='op'&&t.v==='('){const e=binary(0);expect(')');return e}
  throw E('#ERROR!','公式有误');
 }
 const tree=binary(0);if(p<tok.length)throw E('#ERROR!','公式有多余内容');return tree;
}

// Values ---------------------------------------------------------------------
const blank=v=>v===null||v===undefined||v==='';
export function toNumber(v){
 if(isError(v))return v;if(blank(v))return 0;if(typeof v==='number')return v;if(typeof v==='boolean')return v?1:0;
 const s=String(v).trim().replace(/,/g,'');if(/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/.test(s))return s.endsWith('%')?parseFloat(s)/100:parseFloat(s);
 return E('#VALUE!','“'+v+'”不是数字');
}
const toText=v=>isError(v)?v:blank(v)?'':typeof v==='boolean'?(v?'TRUE':'FALSE'):typeof v==='number'?formatNumber(v):String(v);
const toBool=v=>{if(isError(v))return v;if(typeof v==='boolean')return v;if(typeof v==='number')return v!==0;if(blank(v))return false;const s=String(v).toUpperCase();if(s==='TRUE')return true;if(s==='FALSE')return false;return E('#VALUE!')};
export function formatNumber(n){if(!isFinite(n))return '#NUM!';if(Number.isInteger(n))return String(n);const r=+n.toPrecision(12);return Math.abs(r)>=1e15||(Math.abs(r)<1e-9&&r!==0)?r.toExponential(6).replace(/\.?0+e/,'e'):String(r)}
const flat=args=>args.flatMap(a=>a&&a.range?a.values.flat():[a]);
const firstError=list=>list.find(isError);

// Typed cell input: numbers become numbers, TRUE/FALSE booleans.
export function literal(raw){
 if(raw===undefined||raw===null||raw==='')return null;
 const s=String(raw).trim();
 if(/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s))return parseFloat(s);
 if(/^-?(\d+\.?\d*|\.\d+)%$/.test(s))return parseFloat(s)/100;
 if(/^(TRUE|FALSE)$/i.test(s))return s.toUpperCase()==='TRUE';
 if(/^#(DIV\/0!|REF!|VALUE!|NAME\?|N\/A|NUM!|NULL!)$/.test(s))return E(s);
 return String(raw);
}

function criteria(c){
 if(typeof c==='number'||typeof c==='boolean')return v=>v===c||(typeof c==='number'&&toNumber(v)===c&&!blank(v));
 const s=String(c??'');const m=/^(<=|>=|<>|<|>|=)?(.*)$/.exec(s);const op=m[1]||'=',rhs=m[2];
 const num=rhs!==''&&!isError(toNumber(rhs))?toNumber(rhs):null;
 const wild=new RegExp('^'+rhs.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');
 return v=>{
  if(num!==null&&!blank(v)&&!isError(toNumber(v))){const x=toNumber(v);return {'=':x===num,'<>':x!==num,'<':x<num,'>':x>num,'<=':x<=num,'>=':x>=num}[op]}
  const t=toText(v);if(op==='=')return rhs===''?blank(v):wild.test(t);if(op==='<>')return rhs===''?!blank(v):!wild.test(t);
  if(num!==null)return false;const cmp=t.localeCompare(rhs);return {'<':cmp<0,'>':cmp>0,'<=':cmp<=0,'>=':cmp>=0}[op];
 };
}

const num1=(f)=>(a)=>{const n=toNumber(a);return isError(n)?n:f(n)};
const round=(n,d,mode)=>{const k=10**d,x=n*k,r=mode==='up'?Math.sign(x)*Math.ceil(Math.abs(x)-1e-9):mode==='down'?Math.trunc(x):Math.sign(x)*Math.round(Math.abs(x)+1e-9);return r/k};
const numbers=args=>flat(args).filter(v=>typeof v==='number');
const numbersStrict=args=>{const out=[];for(const a of args){if(a&&a.range){for(const v of a.values.flat())if(typeof v==='number')out.push(v);else if(isError(v))return v}else{const n=toNumber(a);if(isError(n))return n;out.push(n)}}return out};
const pad=n=>String(n).padStart(2,'0');
const serial=d=>(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-Date.UTC(1899,11,30))/864e5;
const fromSerial=n=>{const d=new Date(Date.UTC(1899,11,30)+Math.floor(n)*864e5);return d};

const FN={
 SUM:a=>{const n=numbersStrict(a);return isError(n)?n:n.reduce((x,y)=>x+y,0)},
 AVERAGE:a=>{const n=numbersStrict(a);return isError(n)?n:n.length?n.reduce((x,y)=>x+y,0)/n.length:E('#DIV/0!','没有可平均的数字')},
 MIN:a=>{const n=numbersStrict(a);return isError(n)?n:n.length?Math.min(...n):0},
 MAX:a=>{const n=numbersStrict(a);return isError(n)?n:n.length?Math.max(...n):0},
 PRODUCT:a=>{const n=numbersStrict(a);return isError(n)?n:n.reduce((x,y)=>x*y,1)},
 MEDIAN:a=>{const n=numbersStrict(a);if(isError(n))return n;if(!n.length)return E('#NUM!');n.sort((x,y)=>x-y);const m=n.length>>1;return n.length%2?n[m]:(n[m-1]+n[m])/2},
 COUNT:a=>numbers(a).length,
 COUNTA:a=>flat(a).filter(v=>!blank(v)).length,
 COUNTBLANK:a=>flat(a).filter(blank).length,
 ABS:a=>num1(Math.abs)(a[0]),SQRT:a=>num1(n=>n<0?E('#NUM!'):Math.sqrt(n))(a[0]),INT:a=>num1(Math.floor)(a[0]),
 ROUND:a=>{const n=toNumber(a[0]),d=toNumber(a[1]??0);return firstError([n,d])||round(n,d)},
 ROUNDUP:a=>{const n=toNumber(a[0]),d=toNumber(a[1]??0);return firstError([n,d])||round(n,d,'up')},
 ROUNDDOWN:a=>{const n=toNumber(a[0]),d=toNumber(a[1]??0);return firstError([n,d])||round(n,d,'down')},
 MOD:a=>{const n=toNumber(a[0]),d=toNumber(a[1]);return firstError([n,d])||(d===0?E('#DIV/0!'):n-d*Math.floor(n/d))},
 POWER:a=>{const n=toNumber(a[0]),d=toNumber(a[1]);return firstError([n,d])||n**d},
 IF:a=>{const c=toBool(a[0]);return isError(c)?c:c?(a[1]??true):(a.length>2?a[2]:false)},
 IFS:a=>{for(let i=0;i+1<a.length;i+=2){const c=toBool(a[i]);if(isError(c))return c;if(c)return a[i+1]}return E('#N/A','没有满足的条件')},
 IFERROR:a=>isError(a[0])?a[1]:a[0],
 AND:a=>{const v=flat(a).filter(x=>!blank(x)).map(toBool);return firstError(v)||v.every(Boolean)},
 OR:a=>{const v=flat(a).filter(x=>!blank(x)).map(toBool);return firstError(v)||v.some(Boolean)},
 NOT:a=>{const v=toBool(a[0]);return isError(v)?v:!v},
 LEN:a=>{const t=toText(a[0]);return isError(t)?t:Array.from(t).length},
 LEFT:a=>{const t=toText(a[0]),n=toNumber(a[1]??1);return firstError([t,n])||Array.from(t).slice(0,n).join('')},
 RIGHT:a=>{const t=toText(a[0]),n=toNumber(a[1]??1);return firstError([t,n])||(n?Array.from(t).slice(-n).join(''):'')},
 MID:a=>{const t=toText(a[0]),s=toNumber(a[1]),n=toNumber(a[2]);return firstError([t,s,n])||Array.from(t).slice(s-1,s-1+n).join('')},
 UPPER:a=>{const t=toText(a[0]);return isError(t)?t:t.toUpperCase()},LOWER:a=>{const t=toText(a[0]);return isError(t)?t:t.toLowerCase()},
 TRIM:a=>{const t=toText(a[0]);return isError(t)?t:t.trim().replace(/\s+/g,' ')},
 CONCAT:a=>{const v=flat(a).map(toText);return firstError(v)||v.join('')},CONCATENATE:a=>FN.CONCAT(a),
 TEXTJOIN:a=>{const sep=toText(a[0]),skip=toBool(a[1]);const v=flat(a.slice(2)).filter(x=>!skip||!blank(x)).map(toText);return firstError([sep,skip,...v])||v.join(sep)},
 VALUE:a=>toNumber(a[0]),
 TEXT:a=>{const n=toNumber(a[0]),f=toText(a[1]);if(isError(n))return toText(a[0]);const dec=(/0\.(0+)/.exec(f)||[,''])[1].length;let s=n.toFixed(dec);if(/,/.test(f))s=s.replace(/\B(?=(\d{3})+(?!\d))/g,',');if(f.endsWith('%'))s=(n*100).toFixed(dec)+'%';if(/yyyy|mm|dd/i.test(f)){const d=fromSerial(n);s=f.replace(/yyyy/i,d.getUTCFullYear()).replace(/mm/i,pad(d.getUTCMonth()+1)).replace(/dd/i,pad(d.getUTCDate()))}return s},
 TODAY:()=>serial(new Date()),NOW:()=>{const d=new Date();return serial(d)+(d.getHours()*3600+d.getMinutes()*60+d.getSeconds())/86400},
 DATE:a=>{const [y,m,d]=a.map(toNumber);return firstError([y,m,d])||serial(new Date(y,m-1,d))},
 YEAR:a=>num1(n=>fromSerial(n).getUTCFullYear())(a[0]),MONTH:a=>num1(n=>fromSerial(n).getUTCMonth()+1)(a[0]),DAY:a=>num1(n=>fromSerial(n).getUTCDate())(a[0]),
 SUMIF:a=>{const r=a[0],test=criteria(a[1]),s=a[2]||r;if(!r?.range||!s?.range)return E('#VALUE!');let t=0;r.values.forEach((row,i)=>row.forEach((v,j)=>{if(test(v)){const x=s.values[i]?.[j];if(typeof x==='number')t+=x}}));return t},
 COUNTIF:a=>{const r=a[0],test=criteria(a[1]);if(!r?.range)return E('#VALUE!');return r.values.flat().filter(test).length},
 AVERAGEIF:a=>{const r=a[0],test=criteria(a[1]),s=a[2]||r;if(!r?.range||!s?.range)return E('#VALUE!');let t=0,n=0;r.values.forEach((row,i)=>row.forEach((v,j)=>{if(test(v)){const x=s.values[i]?.[j];if(typeof x==='number'){t+=x;n++}}}));return n?t/n:E('#DIV/0!')},
 VLOOKUP:a=>{const key=a[0],t=a[1],c=toNumber(a[2]),approx=a.length>3?toBool(a[3]):true;if(!t?.range)return E('#VALUE!');if(isError(c))return c;if(c<1||c>(t.values[0]?.length||0))return E('#REF!','列号超出查找范围');
  let hit=-1;for(let i=0;i<t.values.length;i++){const v=t.values[i][0];if(approx===false?equal(v,key):compare(v,key)<=0){hit=i;if(approx===false)break}else if(approx!==false&&hit>=0)break}
  return hit<0?E('#N/A','找不到 '+toText(key)):t.values[hit][c-1]},
 HLOOKUP:a=>{const t=a[1];if(!t?.range)return E('#VALUE!');const rot={range:true,values:t.values[0].map((_,j)=>t.values.map(r=>r[j]))};return FN.VLOOKUP([a[0],rot,a[2],a[3]])},
 INDEX:a=>{const t=a[0];if(!t?.range)return E('#VALUE!');const r=toNumber(a[1]??1),c=toNumber(a[2]??1);if(isError(r)||isError(c))return E('#VALUE!');const row=t.values[(r||1)-1];return row&&(c||1)<=row.length?row[(c||1)-1]:E('#REF!')},
 MATCH:a=>{const key=a[0],t=a[1],type=a.length>2?toNumber(a[2]):1;if(!t?.range)return E('#N/A');const list=t.values.length===1?t.values[0]:t.values.map(r=>r[0]);if(type===0){const i=list.findIndex(v=>equal(v,key));return i<0?E('#N/A'):i+1}let hit=-1;for(let i=0;i<list.length;i++){if(type>0?compare(list[i],key)<=0:compare(list[i],key)>=0)hit=i;else break}return hit<0?E('#N/A'):hit+1},
 RANK:a=>{const n=toNumber(a[0]),t=a[1],desc=!(a.length>2&&toNumber(a[2]));if(!t?.range||isError(n))return E('#N/A');const list=numbers([t]);if(!list.includes(n))return E('#N/A');return list.filter(x=>desc?x>n:x<n).length+1},
 ISBLANK:a=>blank(a[0]),ISNUMBER:a=>typeof a[0]==='number',ISTEXT:a=>typeof a[0]==='string'&&a[0]!=='',ISERROR:a=>isError(a[0]),
};
export const functionNames=Object.keys(FN).sort();

function equal(a,b){if(typeof a==='number'||typeof b==='number')return toNumber(a)===toNumber(b);return toText(a).toLowerCase()===toText(b).toLowerCase()}
function compare(a,b){if(typeof a==='number'&&typeof b==='number')return a-b;if(typeof a==='number')return -1;if(typeof b==='number')return 1;return toText(a).localeCompare(toText(b))}

// Workbook evaluation ---------------------------------------------------------
// get(sheetName,col,row) returns the raw input of a cell; names maps a sheet
// name to whether it exists. Values are cached until clear().
export function createCalculator({raw,exists}){
 const cache=new Map(),trees=new Map(),busy=new Set();
 function value(sheet,col,row){
  const key=sheet+'!'+col+':'+row;if(cache.has(key))return cache.get(key);
  const input=raw(sheet,col,row);let v;
  if(typeof input==='string'&&input.startsWith('=')&&input.length>1){
   if(busy.has(key))return E('#CYCLE!','公式循环引用了自己');
   busy.add(key);try{v=evaluate(input,sheet)}finally{busy.delete(key)}
  }else v=literal(input);
  cache.set(key,v);return v;
 }
 function range(sheet,ref){
  if(sheet!==undefined&&!exists(sheet))return E('#REF!','工作表不存在');
  let [a,b]=ref.split(':');
  if(/^[A-Z]+$/.test(a)){a+='1';b+='5000'}else if(/^[0-9]+$/.test(a)){a='A'+a;b='GR'+b}
  const p=parseRef(a),q=parseRef(b||a);if(!p||!q)return E('#REF!');
  if(!b)return value(sheet,p.col,p.row);
  const r1=Math.min(p.row,q.row),r2=Math.max(p.row,q.row),c1=Math.min(p.col,q.col),c2=Math.max(p.col,q.col);
  if((r2-r1+1)*(c2-c1+1)>200000)return E('#REF!','范围过大');
  const values=[];for(let r=r1;r<=r2;r++){const row=[];for(let c=c1;c<=c2;c++)row.push(value(sheet,c,r));values.push(row)}
  return {range:true,values};
 }
 function run(n,sheet){
  switch(n.k){
   case 'val':return n.v;
   case 'ref':{const v=range(n.sheet??sheet,n.v);return v===null?null:v}
   case 'neg':{const x=toNumber(scalar(run(n.a,sheet)));return isError(x)?x:-x}
   case 'pct':{const x=toNumber(scalar(run(n.a,sheet)));return isError(x)?x:x/100}
   case 'bin':{const a=scalar(run(n.a,sheet)),b=scalar(run(n.b,sheet));if(isError(a))return a;if(isError(b))return b;
    switch(n.op){
     case '&':return toText(a)+toText(b);
     case '=':return equal(a,b);case '<>':return !equal(a,b);
     case '<':return compare(a,b)<0;case '>':return compare(a,b)>0;case '<=':return compare(a,b)<=0;case '>=':return compare(a,b)>=0;
    }
    const x=toNumber(a),y=toNumber(b);if(isError(x))return x;if(isError(y))return y;
    switch(n.op){case '+':return x+y;case '-':return x-y;case '*':return x*y;case '/':return y===0?E('#DIV/0!','除数为 0'):x/y;case '^':return x**y}
    return E('#ERROR!')}
   case 'fn':{const f=FN[n.name];if(!f)return E('#NAME?','没有函数 '+n.name);
    // IF and IFERROR evaluate lazily, as Excel does.
    if(n.name==='IF'){const c=toBool(scalar(run(n.args[0],sheet)));if(isError(c))return c;return c?(n.args[1]?scalar(run(n.args[1],sheet)):true):(n.args[2]?scalar(run(n.args[2],sheet)):false)}
    if(n.name==='IFERROR'){const v=scalar(run(n.args[0],sheet));return isError(v)?scalar(run(n.args[1],sheet)):v}
    const args=n.args.map(a=>run(a,sheet));const bad=args.find(a=>isError(a)&&!['IFERROR','ISERROR','IFS'].includes(n.name));
    if(bad&&!['COUNT','COUNTA','COUNTBLANK'].includes(n.name))return bad;
    try{const v=f(args);return v===undefined?null:v}catch{return E('#VALUE!')}}
  }
  return E('#ERROR!');
 }
 const scalar=v=>v&&v.range?(v.values.length===1&&v.values[0].length===1?v.values[0][0]:E('#VALUE!','需要单个单元格')):v;
 function evaluate(input,sheet){
  let tree=trees.get(input);if(!tree){try{tree=parse(input.slice(1))}catch(e){tree={k:'val',v:isError(e)?e:E('#ERROR!')}}trees.set(input,tree)}
  const v=scalar(run(tree,sheet));return typeof v==='number'&&!isFinite(v)?E('#NUM!'):v;
 }
 return {value,clear(){cache.clear()},evaluate};
}

export const display=v=>v===null||v===undefined?'':isError(v)?v.code:typeof v==='boolean'?(v?'TRUE':'FALSE'):typeof v==='number'?formatNumber(v):String(v);
