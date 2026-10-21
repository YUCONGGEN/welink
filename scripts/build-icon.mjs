import fs from 'node:fs/promises';
import {chromium} from 'playwright';
// Keep every Windows, macOS and Android application icon on the M/Link mark.
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const svg=await fs.readFile('internal/ui/assets/icon.svg','utf8'),sizes=[16,24,32,48,64,128,256],images=[],page=await browser.newPage();
  for(const size of sizes){await page.setViewportSize({width:size,height:size});await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>'+svg);images.push(await page.screenshot({omitBackground:true}))}
  const header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  for(let i=0;i<sizes.length;i++){const n=6+i*16;header[n]=header[n+1]=sizes[i]===256?0:sizes[i];header.writeUInt16LE(1,n+4);header.writeUInt16LE(32,n+6);header.writeUInt32LE(images[i].length,n+8);header.writeUInt32LE(offset,n+12);offset+=images[i].length}
  await fs.writeFile('packaging/welink.ico',Buffer.concat([header,...images]));await fs.copyFile('packaging/welink.ico','cmd/welink/resources/linkme.ico');
  const png=images[images.length-1],chunk=Buffer.alloc(8);chunk.write('ic08');chunk.writeUInt32BE(png.length+8,4);const icns=Buffer.alloc(8);icns.write('icns');icns.writeUInt32BE(8+chunk.length+png.length,4);await fs.writeFile('packaging/linkme.icns',Buffer.concat([icns,chunk,png]));
  await page.setViewportSize({width:32,height:32});await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>'+svg.replace('#10bff5','#28d36d').replace('#347be8','#1bbd61').replace('#6650d8','#138b43'));await page.screenshot({path:'cmd/welink/resources/unread.png',omitBackground:true});
  for(const [folder,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
    await page.setViewportSize({width:size,height:size});await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>'+svg);
    const dir='mobile/android/app/src/main/res/mipmap-'+folder;await fs.mkdir(dir,{recursive:true});await page.screenshot({path:dir+'/ic_launcher.png',omitBackground:true});
    const smallDir='mobile/android/app/src/main/res/drawable-'+folder;await fs.mkdir(smallDir,{recursive:true});
    const smallSize=Math.round(size/2);await page.setViewportSize({width:smallSize,height:smallSize});
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><text x="128" y="151" text-anchor="middle" fill="#fff" font-family="Arial Black,Segoe UI Black,Arial,sans-serif" font-weight="900" font-size="64" letter-spacing="-4">M/Link</text></svg>');
    await page.screenshot({path:smallDir+'/ic_notification.png',omitBackground:true});
  }
  await page.setViewportSize({width:512,height:512});await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100%;height:100%;display:block}</style>'+svg);await fs.mkdir('.local',{recursive:true});await page.screenshot({path:'.local/linkme-m-link-icon.png',omitBackground:true});
  console.log('Created uniform M/Link Windows, macOS and Android icons');
}finally{await browser.close()}
