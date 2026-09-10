const CACHE='volley-stats-v1-7';
const LOCAL=['./','./index.html','./index.html?v=1.7','./styles.css','./styles.css?v=1.7','./app.js','./app.js?v=1.7','./manifest.webmanifest','./manifest.webmanifest?v=1.7','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./apple-touch-icon.png?v=1.7','./template.png'];
const REMOTE=[
 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/6.0.1/tesseract.min.js',
 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/6.0.1/worker.min.js',
 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/tesseract-core.wasm.js',
 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/tesseract-core-simd.wasm.js',
 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/tesseract-core-lstm.wasm.js',
 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/tesseract-core-simd-lstm.wasm.js',
 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz'
];
self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);await c.addAll(LOCAL);
 await Promise.allSettled(REMOTE.map(async u=>{const r=await fetch(u,{cache:'no-store'});if(r.ok||r.type==='opaque')await c.put(u,r)}));
 await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);
 if(e.request.mode==='navigate'){
  e.respondWith(fetch(e.request,{cache:'no-store'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return resp}).catch(()=>caches.match('./index.html')));return;
 }
 e.respondWith(caches.match(e.request,{ignoreSearch:false}).then(async cached=>{
  if(cached)return cached;
  try{const resp=await fetch(e.request);if(resp.ok||resp.type==='opaque'){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return resp}catch(err){return caches.match(e.request,{ignoreSearch:true})}
 }));
});
