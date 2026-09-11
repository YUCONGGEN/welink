// YuDesk-style direct probing, followed by relay fallback. WebRTC keeps media
// encrypted on both paths; this module only controls ICE and reports its route.
export function directFirstICE(pc, policy, {alive, changed, negotiate}) {
 const servers=policy.iceServers||[],hasRelay=servers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)));
 let relay=false,closed=false,deadline,recovery,statsTimer,restarts=0,path='正在直连';
 const connected=()=>['connected','completed'].includes(pc.iceConnectionState)||pc.connectionState==='connected';
 const valid=()=>!closed&&alive()&&pc.connectionState!=='closed';
 const setPath=value=>{if(path!==value){path=value;changed()}};
 async function stats(){if(!valid()||!connected())return;try{const report=await pc.getStats();if(!valid())return;let pair;for(const value of report.values())if(value.type==='transport'&&value.selectedCandidatePairId)pair=report.get(value.selectedCandidatePairId);if(!pair)for(const value of report.values())if(value.type==='candidate-pair'&&value.state==='succeeded'&&(value.nominated||value.selected)){pair=value;break}if(pair){const local=report.get(pair.localCandidateId),remote=report.get(pair.remoteCandidateId);setPath(local?.candidateType==='relay'||remote?.candidateType==='relay'?'中转连接':'P2P 直连')}}catch{}}
 function fallback(){if(!valid()||connected())return;if(!hasRelay){setPath('直连未成功');return}clearTimeout(deadline);relay=true;setPath('正在连接中转');try{pc.setConfiguration({...pc.getConfiguration(),iceServers:servers,iceTransportPolicy:'all'});pc.restartIce();Promise.resolve(negotiate()).catch(()=>setPath('网络连接不稳定'))}catch{setPath('网络连接不稳定')}}
 function update(){if(!valid())return;if(connected()){clearTimeout(deadline);clearTimeout(recovery);recovery=null;stats();return}if(pc.iceConnectionState==='failed'||pc.connectionState==='failed'){if(!relay)fallback();else if(restarts++<2){setPath('正在重连');pc.restartIce();Promise.resolve(negotiate()).catch(()=>{})}else setPath('网络连接不稳定')}else if(pc.iceConnectionState==='disconnected'&&!recovery){setPath('正在重连');recovery=setTimeout(()=>{recovery=null;fallback()},5000)}}
 deadline=setTimeout(fallback,policy.directTimeoutMs||8000);statsTimer=setInterval(stats,2500);
 return {update,get path(){return path},close(){closed=true;clearTimeout(deadline);clearTimeout(recovery);clearInterval(statsTimer)}};
}
export function directIceServers(policy){return (policy.iceServers||[]).map(s=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>/^stun:/.test(u))})).filter(s=>s.urls.length)}
