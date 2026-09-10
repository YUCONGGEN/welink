// Blobs are separate from queue metadata so opening a conversation never loads
// every pending attachment into memory. All records carry the backend/account scope.
let database;
export function openLocalStore(){
 if(database)return database;
 database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('welink-local',1);
  request.onupgradeneeded=()=>{const db=request.result;for(const name of ['queue','drafts','cache']){const store=db.createObjectStore(name,{keyPath:'id'});store.createIndex('scope','scope')}db.createObjectStore('blobs')};
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('请关闭其他 WeLink 窗口后重试'));
 }).catch(error=>{database=null;throw error});return database;
}
export async function transaction(names,mode,work){
 const db=await openLocalStore();return new Promise((resolve,reject)=>{
  const tx=db.transaction(names,mode),stores={};for(const name of names)stores[name]=tx.objectStore(name);let result,error;
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error('本地保存失败'));tx.onerror=()=>{};
  try{work(stores,value=>{result=value},reason=>{error=reason;tx.abort()})}catch(reason){error=reason;tx.abort()}
 });
}
export const scopedRows=(name,scope)=>transaction([name],'readonly',(stores,done)=>{const r=stores[name].index('scope').getAll(scope);r.onsuccess=()=>done(r.result)});
export const localGet=(name,id)=>transaction([name],'readonly',(stores,done)=>{const r=stores[name].get(id);r.onsuccess=()=>done(r.result)});
export const localPut=(name,value)=>transaction([name],'readwrite',stores=>stores[name].put(value));
