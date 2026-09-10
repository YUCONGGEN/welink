// Original WeLink vector characters. Reproducible local artwork, no remote assets.
import fs from 'node:fs/promises';
const directory='internal/ui/assets/avatars';await fs.mkdir(directory,{recursive:true});
const species=[['cat','小猫','#f7bf78'],['dog','小狗','#d29e76'],['bear','小熊','#c98c67'],['rabbit','兔兔','#fff7ee'],['fox','狐狸','#eb965e'],['panda','熊猫','#fffaf3'],['koala','考拉','#b2c2d3'],['tiger','老虎','#f3b85c'],['lion','狮子','#eeb565'],['monkey','小猴','#b58970'],['pig','小猪','#f7b3b1'],['sheep','绵羊','#fffaf1'],['cow','奶牛','#fffaf2'],['penguin','企鹅','#66788d'],['owl','猫头鹰','#bfa0d6'],['frog','青蛙','#9ed3aa'],['chick','小鸡','#f7d880'],['raccoon','浣熊','#b9bcc2'],['seal','海豹','#c7dce5'],['hamster','仓鼠','#e3b68a']];
const styles=['元气','甜梦','花园','眼镜','星光'];
const backgrounds=['#e7f3fb','#f8e9ed','#e7f3ec','#f5eddf','#efebf8'];
const inks='#534d52',outline=`stroke="${inks}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
const circle=(x,y,r,c,stroke=true)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" ${stroke?outline:''}/>`;
const ellipse=(x,y,rx,ry,c,stroke=true)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${c}" ${stroke?outline:''}/>`;
const path=(d,c='none',stroke=true)=>`<path d="${d}" fill="${c}" ${stroke?outline:''}/>`;
const star=(x,y,color,size=7)=>`<path d="M${x},${y-size}l${size*.3},${size*.68} ${size*.75},${size*.03} -${size*.57},${size*.46} ${size*.2},${size*.73} -${size*.68},-${size*.42} -${size*.65},${size*.42} ${size*.2},-${size*.73} -${size*.57},-${size*.46} ${size*.73},-${size*.03}Z" fill="${color}"/>`;
const manifest=[];
for(let index=0;index<100;index++){
 const [type,animal,fur]=species[index%20],style=Math.floor(index/20),id=String(index+1).padStart(3,'0'),accent=['#ef987f','#bca4dd','#7ebca9','#86acd6','#d4ad67'][style];let ears='',face='',details='',hair='',accessory='';
 if(['cat','fox','tiger','raccoon'].includes(type)){ears=path('M42 66 33 27Q56 29 65 50',fur)+path('M95 50Q110 28 127 27L119 69',fur)+path('M43 50 41 37 56 48','#f0aaa4',false)+path('M105 48 119 37 116 51','#f0aaa4',false)}
 else if(type==='rabbit'){ears=ellipse(56,40,13,31,fur)+ellipse(104,40,13,31,fur)+ellipse(56,37,5,21,'#efb2b8',false)+ellipse(104,37,5,21,'#efb2b8',false)}
 else if(type==='dog'){ears=path('M44 48Q18 34 21 84Q25 103 46 88',fur)+path('M116 48Q142 34 139 84Q135 103 114 88',fur)}
 else if(type==='pig'){ears=path('M48 58Q21 53 27 32Q50 31 63 54',fur)+path('M97 54Q110 31 133 32Q139 53 112 58',fur)}
 else if(type==='cow'){ears=path('M54 53Q41 36 46 22L66 47','#e7bf83')+path('M95 47 114 22Q119 36 105 53','#e7bf83')+ellipse(34,58,18,10,'#f4c4bf')+ellipse(126,58,18,10,fur)}
 else if(type==='owl'){ears=path('M35 64 36 29 64 48',fur)+path('M98 48 124 29 126 64',fur)}
 else if(type==='frog'){ears=circle(51,50,19,fur)+circle(109,50,19,fur)}
 else if(!['penguin','chick','seal','sheep'].includes(type)){let ear=type==='koala'?23:type==='monkey'?19:15;ears=circle(39,48,ear,type==='panda'?'#62626c':fur)+circle(121,48,ear,type==='panda'?'#62626c':fur);if(type!=='panda')ears+=circle(39,48,ear*.53,'#f0c8b9',false)+circle(121,48,ear*.53,'#f0c8b9',false)}
 if(type==='lion')ears=circle(80,83,58,'#c48659');
 if(type==='sheep'){ears=ellipse(34,68,20,12,'#ddbb99')+ellipse(126,68,20,12,'#ddbb99');for(let a=0;a<12;a++){const angle=a*Math.PI/6;ears+=circle(80+44*Math.cos(angle),76+37*Math.sin(angle),17,fur)}}
 face=ellipse(80,82,48,43,fur);
 if(type==='fox')face+=path('M34 80Q50 82 77 108Q56 121 42 103Z','#fff4e3',false)+path('M126 80Q110 82 83 108Q104 121 118 103Z','#fff4e3',false);
 if(['panda','raccoon'].includes(type)){face+=ellipse(58,77,14,18,'#636773',false)+ellipse(102,77,14,18,'#636773',false)}
 if(type==='cow')face+=path('M37 62Q43 41 66 43Q80 62 60 83Q37 91 37 62','#647082',false);
 if(['bear','dog','hamster','monkey','lion'].includes(type))face+=ellipse(80,96,type==='monkey'?35:26,21,'#fce6c9',false);
 if(type==='penguin')face+=ellipse(62,84,23,33,'#fff6e9',false)+ellipse(98,84,23,33,'#fff6e9',false);
 if(type==='owl')face+=circle(57,78,22,'#fff4db',false)+circle(103,78,22,'#fff4db',false);
 if(type==='tiger'){details=path('M68 44 72 55M80 42V57M92 44 88 55M34 78 45 80M33 89 45 88M126 78 115 80M127 89 115 88');}
 if(type==='chick')hair=path('M74 42Q66 24 73 23Q83 25 84 40Q90 22 96 28Q101 35 88 44',fur);
 if(type==='seal')details=path('M53 95 31 91M52 102 31 104M107 95 129 91M108 102 129 104');
 const eyes=style===1?path('M51 79Q57 85 63 79M97 79Q103 85 109 79'):style===4?circle(58,78,5,inks,false)+path('M97 81 105 76 111 81'):circle(58,78,5,inks,false)+circle(102,78,5,inks,false);
 let nose=['penguin','owl','chick'].includes(type)?path('M73 91 87 91 80 101Z','#ecad55'):type==='pig'?ellipse(80,96,17,12,'#e9959e')+ellipse(74,96,2,4,inks,false)+ellipse(86,96,2,4,inks,false):type==='koala'?ellipse(80,89,10,16,'#646572'):type==='cow'?ellipse(80,98,25,15,'#f2c2bd',false)+circle(70,95,2.4,inks,false)+circle(90,95,2.4,inks,false):type==='frog'?'':path('M75 90Q80 86 85 90Q83 97 80 97Q77 97 75 90',inks,false);
 let smile=['penguin','owl','chick','pig'].includes(type)?'':style===0?path('M72 102Q80 114 88 102','#bd7c7f'):style===1?path('M75 104Q80 107 85 104'):path('M72 103Q80 110 88 103');
 const blush=ellipse(45,94,8,4,'#eeaca4',false)+ellipse(115,94,8,4,'#eeaca4',false);
 if(style===0)accessory=path('M45 122Q80 132 115 122L114 140Q80 150 45 140',accent)+path('M96 137 105 155 120 150 113 133',accent);
 if(style===1)accessory=path('M43 47Q56 9 99 23L120 47Q88 36 43 47',accent)+circle(105,25,9,'#fff6e9')+path('M43 46Q80 35 119 47L117 54Q80 44 44 54','#fff6e9');
 if(style===2){accessory=path('M112 47Q108 30 124 30Q130 42 112 47','#8ebda1');for(let a=0;a<5;a++)accessory+=circle(113+9*Math.cos(a*1.256),44+9*Math.sin(a*1.256),7,'#fff3dd',false);accessory+=circle(113,44,6,'#e6b467',false)}
 if(style===3)accessory=path('M39 74H75V87Q57 99 40 86ZM85 74H121L120 86Q103 99 85 87Z','none')+path('M75 79Q80 75 85 79M40 77 32 74M120 77 128 74');
 if(style===4)accessory=path('M64 126 80 132 96 126V145L80 137 64 145Z',accent)+circle(80,133,5,'#fff3d2');
 const name=styles[style]+animal;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${name}"><title>${name}</title><rect width="160" height="160" rx="36" fill="${backgrounds[(index+style)%5]}"/><path d="M14 106C-4 60 33 24 82 24S158 66 148 109 34 158 14 106" fill="#ffffff" opacity=".48"/>${star(23,31,accent,6)}${circle(137,119,4,accent,false)}${circle(23,129,2.5,accent,false)}${ears}${path('M39 160Q38 119 80 116Q122 119 121 160',accent)}${face}${details}${hair}${eyes}${blush}${nose}${smile}${accessory}</svg>\n`;
 await fs.writeFile(directory+'/'+id+'.svg',svg);manifest.push({id:'cartoon:'+id,name,animal,style:styles[style]});
}
await fs.writeFile('internal/ui/src/cartoon-catalog.js','// Generated by scripts/generate-cartoon-avatars.mjs\nexport const cartoonAvatars='+JSON.stringify(manifest)+';\n'+`
export const cartoonURL=value=>/^cartoon:(00[1-9]|0[1-9][0-9]|100)$/.test(value||'')?'/assets/avatars/'+value.slice(8)+'.svg':'';
export function cartoonChoices(count=8,exclude=[]){const pool=cartoonAvatars.filter(a=>!exclude.includes(a.id)),random=new Uint32Array(pool.length);crypto.getRandomValues(random);for(let i=pool.length-1;i>0;i--){const j=random[i]%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]]}return pool.slice(0,count)}
export function cartoonOptions(items,selected){return items.map(a=>'<button type="button" class="cartoon-option '+(a.id===selected?'selected':'')+'" data-cartoon="'+a.id+'" role="radio" aria-checked="'+(a.id===selected)+'" aria-label="'+a.name+'" title="'+a.name+'"><img loading="lazy" src="'+cartoonURL(a.id)+'" alt=""><span>'+a.name+'</span></button>').join('')}
`);
console.log('Generated 100 original cartoon avatars.');
