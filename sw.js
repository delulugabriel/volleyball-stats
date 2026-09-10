const CACHE='volley-stats-v1-5';
const ASSETS=['./','./index.html','./index.html?v=1.5','./styles.css','./styles.css?v=1.5','./app.js','./app.js?v=1.5','./manifest.webmanifest','./manifest.webmanifest?v=1.5','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./apple-touch-icon.png?v=1.5','./template.png','./vendor/jszip.min.js','./vendor/xlsx.full.min.js','./vendor/tesseract.min.js','./vendor/worker.min.js','./vendor/core/tesseract-core.wasm.js','./vendor/core/tesseract-core-simd.wasm.js','./vendor/core/tesseract-core-lstm.wasm.js','./vendor/core/tesseract-core-simd-lstm.wasm.js','./vendor/lang/eng.traineddata.gz'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
 const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
 await Promise.all(clients.map(c=>c.navigate(c.url).catch(()=>null)));
})()));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return resp}).catch(()=>caches.match('./index.html')));
  return;
 }
 e.respondWith(caches.match(e.request,{ignoreSearch:false}).then(cached=>cached||fetch(e.request).then(resp=>{if(url.origin===location.origin){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return resp}).catch(()=>caches.match(e.request,{ignoreSearch:true}))));
});
