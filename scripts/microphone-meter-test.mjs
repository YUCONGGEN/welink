import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('http://localhost:17719/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="meter">'+ '<i></i>'.repeat(7)+'</div>'}));
 await page.goto('http://localhost:17719/');await page.addScriptTag({type:'module',content:await fs.readFile('internal/ui/src/microphone-meter.js','utf8')+'\nwindow.startMeter=microphoneMeter;'});
 await page.waitForFunction(()=>window.startMeter);
 await page.evaluate(async()=>{const Native=AudioContext;window.meterContexts=[];window.AudioContext=class extends Native{constructor(...args){super(...args);window.meterContexts.push(this)}};window.generator=new Native();window.gain=generator.createGain();gain.gain.value=.1;window.tone=generator.createOscillator();window.destination=generator.createMediaStreamDestination();tone.connect(gain).connect(destination);tone.start();await generator.resume();window.track=destination.stream.getAudioTracks()[0];window.monitor=startMeter(track,document.querySelector('#meter'));});
 await page.waitForFunction(()=>Number(document.querySelector('#meter').dataset.level)>40);
 await page.evaluate(()=>gain.gain.value=.00001);await page.waitForFunction(()=>Number(document.querySelector('#meter').dataset.level)<3);
 await page.evaluate(()=>{gain.gain.value=.7;track.enabled=true});await page.waitForFunction(()=>Number(document.querySelector('#meter').dataset.level)>80);
 await page.evaluate(()=>track.enabled=false);await page.waitForFunction(()=>document.querySelector('#meter').dataset.level==='0');
 await page.evaluate(()=>{monitor.close();monitor.close()});await page.waitForFunction(()=>meterContexts.every(context=>context.state==='closed'));
 assert.equal(await page.evaluate(()=>track.readyState),'live','meter must not stop the call-owned track');
 await page.evaluate(()=>{tone.stop();track.stop();generator.close()});assert.deepEqual(errors,[]);
 console.log('PASS: real audio amplitude drives meter; silence decays, mute resets, close releases analyser/context without stopping call track');
}finally{await browser.close()}
