const CACHE='volley-stats-v2-0';
const LOCAL=[
 './',
 './index.html?v=2.0',
 './styles.css?v=2.0',
 './app.js?v=2.0',
 './manifest.webmanifest?v=2.0',
 './icon-192.png',
 './icon-512.png',
 './apple-touch-icon.png?v=2.0',
 './template.png'
];
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

self.addEventListener('message',e=>{
 if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();
});

self.addEventListener('install',e=>e.waitUntil((async()=>{
 const c=await caches.open(CACHE);
 await c.addAll(LOCAL);
 await Promise.allSettled(REMOTE.map(async u=>{
  const r=await fetch(u,{cache:'no-store'});
  if(r.ok||r.type==='opaque')await c.put(u,r);
 }));
 await self.skipWaiting();
})()));

self.addEventListener('activate',e=>e.waitUntil((async()=>{
 const keys=await caches.keys();
 await Promise.all(keys.filter(k=>k!==CACHE&&/^volley-stats-v[12]-/.test(k)).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));

self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url);

 // Installed iPhone icons can retain an old ?v= URL. Ignore it and always
 // request the current shell from the network when online.
 if(e.request.mode==='navigate'){
  e.respondWith((async()=>{
   try{
    const freshUrl=new URL('./index.html?v=2.0',self.registration.scope).href+'&_='+Date.now();
    const resp=await fetch(freshUrl,{cache:'no-store'});
    if(resp.ok){
     const c=await caches.open(CACHE);
     await c.put('./index.html?v=2.0',resp.clone());
     return resp;
    }
   }catch(err){}
   return (await caches.match('./index.html?v=2.0')) || (await caches.match('./'));
  })());
  return;
 }

 // App shell files are network-first so a new deployment wins quickly.
 if(url.origin===self.location.origin && /\.(?:js|css|webmanifest|html)$/.test(url.pathname)){
  e.respondWith((async()=>{
   try{
    const resp=await fetch(e.request,{cache:'no-store'});
    if(resp.ok){
     const c=await caches.open(CACHE);
     await c.put(e.request,resp.clone());
    }
    return resp;
   }catch(err){
    return (await caches.match(e.request,{ignoreSearch:true})) || Response.error();
   }
  })());
  return;
 }

 e.respondWith(caches.match(e.request,{ignoreSearch:false}).then(async cached=>{
  if(cached)return cached;
  try{
   const resp=await fetch(e.request);
   if(resp.ok||resp.type==='opaque'){
    const copy=resp.clone();
    caches.open(CACHE).then(c=>c.put(e.request,copy));
   }
   return resp;
  }catch(err){
   return caches.match(e.request,{ignoreSearch:true});
  }
 }));
});
