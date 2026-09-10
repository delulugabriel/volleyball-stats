'use strict';
const APP_VERSION='1.8';
const $=id=>document.getElementById(id);
const GRID={W:1650,H:1275,table:[[88,111],[1555,111],[1555,982],[88,982]],xs:[88,317.5,425.5,542.5,656.5,767.5,854.5,1006.5,1096.5,1179.5,1273.5,1361,1454.5,1554.5],ys:[111.5,150.5,200.5,260.5,321.5,379.5,440.5,500.5,560.5,621.5,681.5,742.5,800.5,860.5,921.5,981.5],stats:[['p0',1],['p1',2],['p2',3],['p3',4],['A',6],['K',7],['E',8],['SA',10],['SE',11],['B',12]],headers:{date:[125,48,390,112],opponent:[515,48,875,112],setScore:[1005,42,1555,118]}};
const DB_NAME='volleyStatsOfflineDB',DB_VER=1;let db=null,settings=null,sheets=[],currentFile=null,currentSourceBlob=null,currentProcessedBlob=null,currentImage=null,currentCorners=[],currentAnalysis=null,ocrWorker=null,editingId=null,currentRotation=0,currentWarpedCanvas=null,currentGrid=null,currentInspect=null,currentRosterOCR=null;

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function fmt(x,d=2){return Number.isFinite(x)?x.toFixed(d):'—'}
function pct(x,d=1){return Number.isFinite(x)?(x*100).toFixed(d)+'%':'—'}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function today(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function median(a){const b=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!b.length)return NaN;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}

function noteAppVersion(){
 try{
  const previous=localStorage.getItem('volleyStatsAppVersion');
  localStorage.setItem('volleyStatsAppVersion',APP_VERSION);
  if(previous&&previous!==APP_VERSION)setTimeout(()=>flash(`Updated to v${APP_VERSION}. Your saved season data is unchanged.`,'good'),350);
 }catch(e){}
}
async function setupServiceWorker(){
 if(!('serviceWorker' in navigator))return;
 let reloading=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloading)return;reloading=true;location.reload()});
 try{
  const reg=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
  const check=()=>reg.update().catch(()=>{});
  await check();
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check()});
  setInterval(check,60*60*1000);
 }catch(e){console.warn('App update check unavailable',e)}
}

function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VER);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv');if(!d.objectStoreNames.contains('sheets'))d.createObjectStore('sheets',{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function kvGet(k){return new Promise((res,rej)=>{const t=db.transaction('kv','readonly').objectStore('kv').get(k);t.onsuccess=()=>res(t.result);t.onerror=()=>rej(t.error)})}
function kvSet(k,v){return new Promise((res,rej)=>{const t=db.transaction('kv','readwrite').objectStore('kv').put(v,k);t.onsuccess=()=>res();t.onerror=()=>rej(t.error)})}
function allSheets(){return new Promise((res,rej)=>{const t=db.transaction('sheets','readonly').objectStore('sheets').getAll();t.onsuccess=()=>res(t.result||[]);t.onerror=()=>rej(t.error)})}
function putSheet(s){return new Promise((res,rej)=>{const t=db.transaction('sheets','readwrite').objectStore('sheets').put(s);t.onsuccess=()=>res();t.onerror=()=>rej(t.error)})}
function deleteSheet(id){return new Promise((res,rej)=>{const t=db.transaction('sheets','readwrite').objectStore('sheets').delete(id);t.onsuccess=()=>res();t.onerror=()=>rej(t.error)})}

function makeRoster(){return Array.from({length:12},(_,i)=>({id:uid(),number:'',name:'Player '+(i+1)}))}
function defaultSettings(){const t1={id:uid(),name:'Team 1',roster:makeRoster()},t2={id:uid(),name:'Team 2',roster:makeRoster()};return {seasonName:'2026 Volleyball',teams:[t1,t2],activeTeamId:t1.id,teamName:t1.name,roster:t1.roster,markUnit:null,markSamples:0,tallyProfile:'blue-ink-strokes-v2'}}
function migrateTeams(){if(!Array.isArray(settings.teams)||!settings.teams.length){const old={id:uid(),name:settings.teamName||'Team 1',roster:Array.isArray(settings.roster)&&settings.roster.length?settings.roster:makeRoster()};settings.teams=[old,{id:uid(),name:'Team 2',roster:makeRoster()}];settings.activeTeamId=old.id}while(settings.teams.length<2)settings.teams.push({id:uid(),name:'Team '+(settings.teams.length+1),roster:makeRoster()});const t=settings.teams.find(x=>x.id===settings.activeTeamId)||settings.teams[0];settings.activeTeamId=t.id;settings.teamName=t.name;settings.roster=t.roster}
function activeTeam(){migrateTeams();return settings.teams.find(t=>t.id===settings.activeTeamId)||settings.teams[0]}
function activateTeam(id,save=false){migrateTeams();const t=settings.teams.find(x=>x.id===id)||settings.teams[0];settings.activeTeamId=t.id;settings.teamName=t.name;settings.roster=t.roster;if(save&&db)kvSet('settings',settings).catch(()=>{});fillTeamSelects();}
function teamSheets(list=sheets){const id=activeTeam().id;return list.filter(s=>!s.teamId||s.teamId===id)}
async function init(){
 bind(); // Wire navigation and photo controls immediately; do not wait for iPhone storage.
 settings=defaultSettings();migrateTeams();sheets=[];fillSetup();renderAll();$('sheetDate').value=today();
 try{
   await openDB();settings=await kvGet('settings')||settings;migrateTeams();await kvSet('settings',settings);sheets=(await allSheets()).sort(sortSheets);fillSetup();renderAll();
 }catch(e){
   console.error('Local storage unavailable',e);flash('Storage did not start yet — photo capture still works. Reopen the installed app before saving.','warn');
 }
 await setupServiceWorker();
 noteAppVersion();
 if(!window.matchMedia('(display-mode: standalone)').matches && /iPhone|iPad|iPod/i.test(navigator.userAgent))$('installCard').classList.remove('hide')
}
function sortSheets(a,b){return (a.date||'').localeCompare(b.date||'')||num(a.setNumber)-num(b.setNumber)||num(a.createdAt)-num(b.createdAt)}

function bind(){
 document.querySelectorAll('#nav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
 $('cameraInput').addEventListener('change',e=>loadPhoto(e.target.files[0]));$('photoInput').addEventListener('change',e=>loadPhoto(e.target.files[0]));
 $('alignCanvas').addEventListener('pointerup',addCorner);$('resetCorners').addEventListener('click',resetCorners);$('rotateLeft').addEventListener('click',()=>rotateSource(-90));$('rotateRight').addEventListener('click',()=>rotateSource(90));$('analyzeBtn').addEventListener('click',analyzeCurrent);$('inspectMinus').addEventListener('click',()=>adjustInspect(-1));$('inspectPlus').addEventListener('click',()=>adjustInspect(1));
 $('saveSheetBtn').addEventListener('click',saveCurrentSheet);$('cancelCapture').addEventListener('click',resetCapture);
 $('saveSeason').addEventListener('click',saveSetup);$('saveRoster').addEventListener('click',saveRoster);$('teamEditorSelect').addEventListener('change',e=>{activateTeam(e.target.value);fillSetup();renderAll()});$('sheetTeam').addEventListener('change',e=>{activateTeam(e.target.value);if(currentWarpedCanvas){currentAnalysis=analyzeTallies(currentWarpedCanvas);renderVerify()}renderAll()});$('globalTeamSelect').addEventListener('change',e=>{activateTeam(e.target.value,true);fillSetup();renderAll()});$('addPlayer').addEventListener('click',()=>{settings.roster.push({id:uid(),number:'',name:'New player'});renderRosterEditor()});
 $('playerSelect').addEventListener('change',renderPlayerView);['exploreScope','explorePlayer','exploreOpponent','exploreEvent','exploreFrom','exploreTo'].forEach(id=>$(id).addEventListener('change',renderExplore));$('clearExplore').addEventListener('click',clearExploreFilters);$('closeModal').addEventListener('click',()=>$('sheetModal').classList.remove('open'));
 $('exportCSV').addEventListener('click',exportCSV);$('exportExcel').addEventListener('click',exportExcel);$('exportArchive').addEventListener('click',exportArchive);$('importArchive').addEventListener('change',e=>importArchive(e.target.files[0]));
 $('resetCalibration').addEventListener('click',async()=>{settings.markUnit=null;settings.markSamples=0;await kvSet('settings',settings);renderCalibration()});
}
function showView(v){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===v));document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));if(v==='players')renderPlayerView();if(v==='matches')renderExplore();if(v==='home')renderHome();window.scrollTo(0,0)}

function fillTeamSelects(){migrateTeams();for(const id of ['teamEditorSelect','sheetTeam','globalTeamSelect']){const el=$(id);if(!el)continue;const prev=el.value;el.innerHTML=settings.teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name||'Unnamed team')}</option>`).join('');el.value=settings.activeTeamId;if(!el.value&&prev)el.value=prev}}
function fillSetup(){migrateTeams();$('seasonName').value=settings.seasonName||'';$('teamName').value=activeTeam().name||'';fillTeamSelects();renderRosterEditor();renderCalibration();updateOpponents();updateEvents()}
function renderRosterEditor(){const box=$('rosterEditor');box.innerHTML='';settings.roster.forEach((p,i)=>{const r=document.createElement('div');r.className='roster-row';r.innerHTML=`<input data-k="number" data-i="${i}" placeholder="#" value="${esc(p.number)}"><input data-k="name" data-i="${i}" placeholder="Name" value="${esc(p.name)}"><button class="secondary" data-up="${i}" ${i===0?'disabled':''}>↑</button><button class="secondary" data-down="${i}" ${i===settings.roster.length-1?'disabled':''}>↓</button>`;box.appendChild(r)});box.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',e=>{const i=+e.target.dataset.i;settings.roster[i][e.target.dataset.k]=e.target.value}));box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>moveRoster(+b.dataset.up,-1));box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>moveRoster(+b.dataset.down,1))}
function moveRoster(i,d){const j=i+d;if(j<0||j>=settings.roster.length)return;[settings.roster[i],settings.roster[j]]=[settings.roster[j],settings.roster[i]];renderRosterEditor()}
async function saveRoster(){const t=activeTeam();t.name=$('teamName').value.trim()||t.name||'Team';t.roster=settings.roster.slice(0,12);settings.teamName=t.name;settings.roster=t.roster;await kvSet('settings',settings);fillTeamSelects();renderAll();flash('Team and roster saved.','good')}
async function saveSetup(){settings.seasonName=$('seasonName').value.trim()||'Volleyball Season';await kvSet('settings',settings);renderAll();flash('Season settings saved.','good')}
function renderCalibration(){$('calibrationInfo').textContent='v1.8 uses blue-ink stroke recognition. Black/grey grid lines and printed text are ignored before tally counting; verified corrections are still saved with each sheet.'}
function flash(msg,type=''){$('seasonSub').textContent=msg;setTimeout(()=>$('seasonSub').textContent='Private • offline season tracker',2600)}

async function loadPhoto(file){if(!file)return;editingId=null;currentFile=file;currentCorners=[];currentAnalysis=null;currentProcessedBlob=null;currentWarpedCanvas=null;currentGrid=null;currentInspect=null;$('captureWork').classList.remove('hide');showView('capture');$('verifyWrap').classList.add('hide');$('verifyEmpty').classList.remove('hide');$('cellInspector').classList.add('hide');$('saveSheetBtn').disabled=true;$('ocrStatus').textContent='Header OCR will run after alignment.';$('sheetDate').value=today();$('sheetOpponent').value='';$('sheetEvent').value='';$('sheetSet').value='';$('ourScore').value='';$('oppScore').value='';
 const img=await fileToImage(file);currentImage=img;currentSourceBlob=file;currentRotation=(img.naturalHeight>img.naturalWidth*1.08)?270:0;drawSourceImage();const ok=autoDetectCorners();$('alignStatus').textContent=(currentRotation?'Photo auto-rotated. ':'')+(ok?'Sheet detected from the page/template. Check the four dots, then Analyze sheet.':'I could not confidently find the table. Set the four corners manually.');drawCorners();}
function drawSourceImage(){if(!currentImage)return;const c=$('alignCanvas'),img=currentImage,rot=((currentRotation%360)+360)%360,max=2000,sw=img.naturalWidth,sh=img.naturalHeight,rw=(rot===90||rot===270)?sh:sw,rh=(rot===90||rot===270)?sw:sh,scale=Math.min(1,max/Math.max(rw,rh));c.width=Math.round(rw*scale);c.height=Math.round(rh*scale);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.save();if(rot===90){ctx.translate(c.width,0);ctx.rotate(Math.PI/2)}else if(rot===180){ctx.translate(c.width,c.height);ctx.rotate(Math.PI)}else if(rot===270){ctx.translate(0,c.height);ctx.rotate(-Math.PI/2)}ctx.drawImage(img,0,0,Math.round(sw*scale),Math.round(sh*scale));ctx.restore();}
function rotateSource(delta){if(!currentImage)return;currentRotation=(currentRotation+delta+360)%360;currentCorners=[];currentAnalysis=null;currentWarpedCanvas=null;currentGrid=null;drawSourceImage();$('alignStatus').className='status';const ok=autoDetectCorners();$('alignStatus').textContent=ok?'Rotation changed and table corners re-detected.':'Rotation changed. Set the four table corners manually.';drawCorners();}
function fileToImage(file){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im)};im.onerror=rej;im.src=u})}
function addCorner(e){if(!currentImage||currentCorners.length>=4)return;const c=e.currentTarget,r=c.getBoundingClientRect();currentCorners.push({x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height});const labels=['top-right','bottom-right','bottom-left'];$('alignStatus').textContent=currentCorners.length<4?`Now tap the ${labels[currentCorners.length-1]} corner of the table.`:'Four corners set. Analyze when ready.';$('analyzeBtn').disabled=currentCorners.length!==4;drawCorners()}
function resetCorners(){currentCorners=[];$('analyzeBtn').disabled=true;$('alignStatus').textContent='Tap top-left corner of the main stats table.';drawCorners()}
function drawCorners(){const host=$('cornerDots'),c=$('alignCanvas');host.innerHTML='';const r=c.getBoundingClientRect();currentCorners.forEach((p,i)=>{const d=document.createElement('div');d.className='corner-dot';d.style.left=(p.x/c.width*100)+'%';d.style.top=(p.y/c.height*100)+'%';d.title=String(i+1);host.appendChild(d)})}
function quadArea(q){let a=0;for(let i=0;i<4;i++){const p=q[i],n=q[(i+1)%4];a+=p.x*n.y-n.x*p.y}return Math.abs(a)/2}
function projectHomography(H,x,y){const z=H[6]*x+H[7]*y+H[8];return {x:(H[0]*x+H[1]*y+H[2])/z,y:(H[3]*x+H[4]*y+H[5])/z}}
function detectPaperQuad(){
 const c=$('alignCanvas');if(!c.width||!c.height)return null;
 const target=Math.min(720,c.width),scale=target/c.width,w=Math.max(100,Math.round(c.width*scale)),h=Math.max(80,Math.round(c.height*scale));
 const t=document.createElement('canvas');t.width=w;t.height=h;const x=t.getContext('2d',{willReadFrequently:true});x.drawImage(c,0,0,w,h);const d=x.getImageData(0,0,w,h).data;
 const lum=new Uint8Array(w*h),sat=new Uint8Array(w*h),sample=[];for(let i=0,p=0;i<d.length;i+=4,p++){const r=d[i],g=d[i+1],b=d[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b),L=Math.round(.299*r+.587*g+.114*b);lum[p]=L;sat[p]=mx-mn;if((p%19)===0)sample.push(L)}
 sample.sort((a,b)=>a-b);const p70=sample[Math.floor(sample.length*.70)]||180,p85=sample[Math.floor(sample.length*.85)]||210;const bright=clamp((p70+p85)/2-18,145,220);
 const mask=new Uint8Array(w*h);for(let y=1;y<h-1;y++)for(let xx=1;xx<w-1;xx++){const p=y*w+xx;let av=0,ss=0,n=0;for(let yy=-1;yy<=1;yy++)for(let dx=-1;dx<=1;dx++){const q=p+yy*w+dx;av+=lum[q];ss+=sat[q];n++}av/=n;ss/=n;if(av>=bright&&ss<72)mask[p]=1}
 // Close small holes caused by printed grid/text.
 const closed=new Uint8Array(mask);for(let y=2;y<h-2;y++)for(let xx=2;xx<w-2;xx++){const p=y*w+xx;if(mask[p])continue;let n=0;for(let yy=-2;yy<=2;yy++)for(let dx=-2;dx<=2;dx++)n+=mask[p+yy*w+dx];if(n>=15)closed[p]=1}
 const seen=new Uint8Array(w*h),stack=[],comps=[];for(let p=0;p<closed.length;p++){if(!closed[p]||seen[p])continue;seen[p]=1;stack.length=0;stack.push(p);let count=0,minx=w,maxx=0,miny=h,maxy=0,tl=null,tr=null,br=null,bl=null,tlv=1e9,trv=-1e9,brv=-1e9,blv=1e9;while(stack.length){const q=stack.pop(),xx=q%w,yy=(q/w)|0;count++;minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,yy);maxy=Math.max(maxy,yy);const a=xx+yy,b=xx-yy;if(a<tlv){tlv=a;tl={x:xx,y:yy}}if(b>trv){trv=b;tr={x:xx,y:yy}}if(a>brv){brv=a;br={x:xx,y:yy}}if(b<blv){blv=b;bl={x:xx,y:yy}}for(const off of [-1,1,-w,w,-w-1,-w+1,w-1,w+1]){const z=q+off;if(z<0||z>=closed.length||seen[z]||!closed[z])continue;const zx=z%w,zy=(z/w)|0;if(Math.abs(zx-xx)>1||Math.abs(zy-yy)>1)continue;seen[z]=1;stack.push(z)}}if(count>w*h*.08)comps.push({count,minx,maxx,miny,maxy,q:[tl,tr,br,bl]})}
 comps.sort((a,b)=>b.count-a.count);for(const comp of comps.slice(0,4)){let q=comp.q;if(q.some(v=>!v))continue;const area=quadArea(q);const bw=comp.maxx-comp.minx,bh=comp.maxy-comp.miny;if(area<w*h*.24||bw<w*.55||bh<h*.45)continue;const edge=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);if(Math.min(edge(q[0],q[1]),edge(q[1],q[2]),edge(q[2],q[3]),edge(q[3],q[0]))<Math.min(w,h)*.18)continue;return q.map(v=>({x:v.x/scale,y:v.y/scale}))}
 return null;
}
function autoDetectCorners(){
 const page=detectPaperQuad();
 if(page){
  try{const src=[[0,0],[GRID.W,0],[GRID.W,GRID.H],[0,GRID.H]],dst=page.map(p=>[p.x,p.y]),H=homography(src,dst);const table=GRID.table.map(([x,y])=>projectHomography(H,x,y));if(quadArea(table)>$('alignCanvas').width*$('alignCanvas').height*.18){currentCorners=table;$('analyzeBtn').disabled=false;return true}}catch(e){console.warn('Paper-based alignment failed',e)}
 }
 return autoDetectTableLegacy();
}

function autoDetectTableLegacy(){
 const c=$('alignCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});if(!c.width||!c.height)return false;
 const targetW=Math.min(900,c.width),scale=targetW/c.width,w=Math.max(80,Math.round(c.width*scale)),h=Math.max(60,Math.round(c.height*scale));
 const dcan=document.createElement('canvas');dcan.width=w;dcan.height=h;const dc=dcan.getContext('2d',{willReadFrequently:true});dc.drawImage(c,0,0,w,h);const im=dc.getImageData(0,0,w,h).data;
 const dark=(x,y)=>{const i=(y*w+x)*4;return im[i]*.299+im[i+1]*.587+im[i+2]*.114<115};
 const rs=new Float32Array(h),cs=new Float32Array(w);for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){if(dark(x,y)){rs[y]+=2;cs[x]+=2}}
 const smooth=(a,r=3)=>Array.from(a,(_,i)=>{let z=0,n=0;for(let j=Math.max(0,i-r);j<=Math.min(a.length-1,i+r);j++){z+=a[j];n++}return z/n});const R=smooth(rs,4),C=smooth(cs,4);
 function peaks(a,lo,hi,minGap){const arr=[];for(let i=lo;i<=hi;i++)arr.push([a[i],i]);arr.sort((x,y)=>y[0]-x[0]);const out=[];for(const [,i] of arr){if(out.every(j=>Math.abs(i-j)>minGap)){out.push(i);if(out.length>=18)break}}return out.sort((a,b)=>a-b)}
 const yp=peaks(R,Math.round(h*.05),Math.round(h*.9),Math.max(8,Math.round(h*.025)));let top=null,bottom=null,best=-1;for(const a of yp)for(const b of yp){if(b-a<h*.35)continue;const score=R[a]+R[b]-(Math.abs(a-h*.12)+Math.abs(b-h*.78))*.03;if(score>best){best=score;top=a;bottom=b}}
 if(top==null||bottom==null)return false;const xp=peaks(C,Math.round(w*.01),Math.round(w*.99),Math.max(8,Math.round(w*.025)));let left=null,right=null;best=-1;for(const a of xp)for(const b of xp){if(b-a<w*.55)continue;const score=C[a]+C[b]-(Math.abs(a-w*.06)+Math.abs(b-w*.94))*.02;if(score>best){best=score;left=a;right=b}}
 if(left==null||right==null)return false;
 function fitHorizontal(y0,xA,xB){const pts=[],rad=Math.max(5,Math.round(h*.025));for(let x=xA;x<=xB;x+=Math.max(4,Math.round(w/120))){let by=y0,bv=999;for(let y=Math.max(0,y0-rad);y<=Math.min(h-1,y0+rad);y++){let v=0,n=0;for(let k=-1;k<=1;k++){const yy=y+k;if(yy>=0&&yy<h){const i=(yy*w+x)*4;v+=im[i]*.299+im[i+1]*.587+im[i+2]*.114;n++}}v/=n;if(v<bv){bv=v;by=y}}if(bv<145)pts.push([x,by])}return linfit(pts)}
 function fitVertical(x0,yA,yB){const pts=[],rad=Math.max(5,Math.round(w*.02));for(let y=yA;y<=yB;y+=Math.max(4,Math.round(h/100))){let bx=x0,bv=999;for(let x=Math.max(0,x0-rad);x<=Math.min(w-1,x0+rad);x++){const i=(y*w+x)*4,v=im[i]*.299+im[i+1]*.587+im[i+2]*.114;if(v<bv){bv=v;bx=x}}if(bv<145)pts.push([y,bx])}return linfit(pts)}
 function linfit(pts){if(pts.length<6)return null;let sx=0,sy=0,sxx=0,sxy=0;for(const [x,y] of pts){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y}const n=pts.length,den=n*sxx-sx*sx;if(Math.abs(den)<1e-6)return null;const a=(n*sxy-sx*sy)/den,b=(sy-a*sx)/n;return {a,b}}
 const T=fitHorizontal(top,left,right),B=fitHorizontal(bottom,left,right),L=fitVertical(left,top,bottom),Rr=fitVertical(right,top,bottom);
 function intersect(hline,vline,fx,fy){if(!hline||!vline)return{x:fx,y:fy};const den=1-hline.a*vline.a;if(Math.abs(den)<.2)return{x:fx,y:fy};const x=(vline.a*hline.b+vline.b)/den,y=hline.a*x+hline.b;return{x,y}}
 const q=[intersect(T,L,left,top),intersect(T,Rr,right,top),intersect(B,Rr,right,bottom),intersect(B,L,left,bottom)];
 if(q.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return false;currentCorners=q.map(p=>({x:p.x/scale,y:p.y/scale}));$('analyzeBtn').disabled=false;return true;
}

function solveLinear(A,b){const n=b.length,M=A.map((r,i)=>r.slice().concat(b[i]));for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;[M[i],M[p]]=[M[p],M[i]];let div=M[i][i];if(Math.abs(div)<1e-10)throw Error('Could not align those corners. Try tapping the table corners again.');for(let k=i;k<=n;k++)M[i][k]/=div;for(let j=0;j<n;j++)if(j!==i){const f=M[j][i];for(let k=i;k<=n;k++)M[j][k]-=f*M[i][k]}}return M.map(r=>r[n])}
function homography(from,to){const A=[],b=[];for(let i=0;i<4;i++){const [x,y]=from[i],[u,v]=to[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v)}const h=solveLinear(A,b);return [...h,1]}
function warpCanvas(srcCanvas,srcPts){const out=document.createElement('canvas');out.width=GRID.W;out.height=GRID.H;const sctx=srcCanvas.getContext('2d',{willReadFrequently:true}),s=sctx.getImageData(0,0,srcCanvas.width,srcCanvas.height),octx=out.getContext('2d'),o=octx.createImageData(out.width,out.height);const dst=GRID.table,H=homography(dst,srcPts.map(p=>[p.x,p.y]));const sd=s.data,od=o.data,sw=srcCanvas.width,sh=srcCanvas.height,W=out.width,Hh=out.height;for(let y=0;y<Hh;y++){for(let x=0;x<W;x++){const z=H[6]*x+H[7]*y+H[8],sx=(H[0]*x+H[1]*y+H[2])/z,sy=(H[3]*x+H[4]*y+H[5])/z,di=(y*W+x)*4;if(sx>=0&&sy>=0&&sx<sw-1&&sy<sh-1){const ix=Math.round(sx),iy=Math.round(sy),si=(iy*sw+ix)*4;od[di]=sd[si];od[di+1]=sd[si+1];od[di+2]=sd[si+2];od[di+3]=255}else{od[di]=od[di+1]=od[di+2]=255;od[di+3]=255}}}octx.putImageData(o,0,0);return out}

async function analyzeCurrent(){if(currentCorners.length!==4)return;$('analyzeBtn').disabled=true;$('alignStatus').textContent='Straightening the sheet…';await nextFrame();try{const warped=warpCanvas($('alignCanvas'),currentCorners);currentWarpedCanvas=warped;currentGrid=GRID;currentProcessedBlob=await canvasBlob(warped,.86);$('alignStatus').textContent='Aligned. Reading roster to identify the team…';await nextFrame();try{await detectTeamFromRoster(warped)}catch(e){console.warn('Team OCR unavailable',e)}$('alignStatus').textContent='Isolating blue pen and counting tally strokes…';currentAnalysis=analyzeTallies(warped);renderVerify();$('verifyEmpty').classList.add('hide');$('verifyWrap').classList.remove('hide');$('saveSheetBtn').disabled=false;runHeaderOCR(warped).catch(e=>{$('ocrStatus').className='status warn';$('ocrStatus').textContent='OCR could not read every header field. Verify the highlighted information manually.';console.warn(e)});$('alignStatus').className='status good';$('alignStatus').textContent=`Blue-ink analysis complete. ${currentAnalysis.uncertain} cells are flagged for a quick check.`}catch(e){$('alignStatus').className='status bad';$('alignStatus').textContent=e.message||String(e)}finally{$('analyzeBtn').disabled=false}}
function nextFrame(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,10)))}
function canvasBlob(c,q=.85){return new Promise(r=>c.toBlob(r,'image/jpeg',q))}

function groupsFromFlags(flags,gap=1){const out=[];let i=0;while(i<flags.length){if(!flags[i]){i++;continue}let a=i,last=i,miss=0;i++;while(i<flags.length){if(flags[i]){last=i;miss=0;i++;continue}miss++;if(miss>gap)break;i++}out.push([a,last]);}return out}
function bluePixel(r,g,b){
 // Blue/purple ballpoint: require chroma, and blue must clearly exceed red.
 // Neutral black/grey grid ink has almost no channel separation and is rejected.
 const mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=mx?((mx-mn)/mx):0;
 return sat>=0.16 && (b-r)>=14 && b>=g-10 && r<205;
}
function groupsFromArray(flags,gap=1){const out=[];let i=0;while(i<flags.length){if(!flags[i]){i++;continue}let a=i,last=i,miss=0;i++;while(i<flags.length){if(flags[i]){last=i;miss=0;i++;continue}miss++;if(miss>gap)break;i++}out.push([a,last]);}return out}
function blueCellInfo(ctx,x0,x1,y0,y1){
 const padX=Math.max(7,Math.round((x1-x0)*.09)),padY=Math.max(6,Math.round((y1-y0)*.12));
 const x=Math.round(x0+padX),y=Math.round(y0+padY),w=Math.max(8,Math.round(x1-x0-2*padX)),h=Math.max(8,Math.round(y1-y0-2*padY));
 const im=ctx.getImageData(x,y,w,h),d=im.data,mask=new Uint8Array(w*h),xc=new Uint16Array(w),yc=new Uint16Array(h);
 let blue=0;
 for(let p=0,i=0;p<mask.length;p++,i+=4){if(bluePixel(d[i],d[i+1],d[i+2])){mask[p]=1;blue++;xc[p%w]++;yc[(p/w)|0]++}}
 // Absolutely blank cells should stay zero. This is deliberately conservative.
 const blankFloor=Math.max(7,Math.round(w*h*.0018));
 if(blue<blankFloor)return {x,y,w,h,blue,vertical:0,slash:0,count:0,low:false,mask};
 // Vertical tally strokes create columns with blue pixels through a meaningful part of cell height.
 const colThreshold=Math.max(3,Math.round(h*.11));
 const vf=Array.from(xc,v=>v>=colThreshold);
 let vg=groupsFromArray(vf,1).filter(([a,b])=>{const ww=b-a+1;return ww<=Math.max(10,w*.15)});
 // Merge groups separated only by a one/two-pixel ragged edge, but keep real adjacent strokes distinct.
 const centers=vg.map(([a,b])=>(a+b)/2);
 // Remove pixels near detected vertical strokes. A fifth/slash mark remains as a broad diagonal residue.
 const residual=new Uint8Array(mask.length);let residualCount=0,minx=w,miny=h,maxx=-1,maxy=-1;
 for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
   const p=yy*w+xx;if(!mask[p])continue;
   let near=false;for(const c of centers)if(Math.abs(xx-c)<=Math.max(2,Math.round(w*.025))){near=true;break}
   if(!near){residual[p]=1;residualCount++;minx=Math.min(minx,xx);maxx=Math.max(maxx,xx);miny=Math.min(miny,yy);maxy=Math.max(maxy,yy)}
 }
 let slash=0;
 if(residualCount>=Math.max(7,Math.round(blue*.10))&&maxx>=minx){
   const bw=maxx-minx+1,bh=maxy-miny+1;
   // A cross/fifth mark is broad in x and has meaningful y movement; dots/noise are not.
   if(bw>=w*.20 && bh>=h*.16){
     // Regression correlation distinguishes a diagonal stroke from scattered residue.
     let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
     for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if(residual[yy*w+xx]){n++;sx+=xx;sy+=yy;sxx+=xx*xx;syy+=yy*yy;sxy+=xx*yy}
     const cov=n*sxy-sx*sy,dx=n*sxx-sx*sx,dy=n*syy-sy*sy;
     const corr=(dx>0&&dy>0)?Math.abs(cov/Math.sqrt(dx*dy)):0;
     if(corr>=.28)slash=1;
   }
 }
 let count=centers.length+slash;
 // If colour exists but projection missed a tiny handwritten stroke, treat one compact component as one tally.
 if(count===0&&blue>=blankFloor*1.5)count=1;
 count=clamp(count,0,40);
 const density=blue/(w*h);
 const low=(blue>0&&count===0)||density>.20||count>15|| (slash&&centers.length<3);
 return {x,y,w,h,blue,vertical:centers.length,slash,count,low,mask,density};
}
function analyzeTallies(canvas){
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),rows=settings.roster.slice(0,12).map(p=>({playerId:p.id,values:{p0:0,p1:0,p2:0,p3:0,A:0,K:0,E:0,SA:0,SE:0,B:0},meta:{}}));
 let uncertain=0,blueCells=0;
 for(let r=0;r<rows.length;r++){
  const y0=GRID.ys[1+r],y1=GRID.ys[2+r];
  for(const [key,ci] of GRID.stats){
   const c=blueCellInfo(ctx,GRID.xs[ci],GRID.xs[ci+1],y0,y1);if(c.blue)blueCells++;if(c.low)uncertain++;
   rows[r].values[key]=c.count;rows[r].meta[key]={ink:c.blue,blue:c.blue,vertical:c.vertical,slash:c.slash,auto:c.count,low:c.low,density:c.density||0};
  }
 }
 return {rows,unitUsed:null,uncertain,blueCells,method:'blue-ink-strokes-v2'};
}
function calcRow(v){const rec=v.p0+v.p1+v.p2+v.p3,pass=rec?((v.p1+2*v.p2+3*v.p3)/rec):NaN,hit=v.A?((v.K-v.E)/v.A):NaN;return {rec,pass,hit,kill:v.A?v.K/v.A:NaN,error:v.A?v.E/v.A:NaN}}
function renderVerify(){const body=$('verifyBody');body.innerHTML='';if(!currentAnalysis)return;currentAnalysis.rows.forEach((row,i)=>{const p=settings.roster.find(x=>x.id===row.playerId)||{name:'Player '+(i+1),number:''},c=calcRow(row.values),tr=document.createElement('tr');const input=k=>`<input inputmode="numeric" type="number" min="0" max="99" data-r="${i}" data-k="${k}" value="${row.values[k]}" class="${row.meta[k]?.low?'uncertain':''}">`;tr.innerHTML=`<td>${esc((p.number?'#'+p.number+' ':'')+p.name)}</td><td>${input('p0')}</td><td>${input('p1')}</td><td>${input('p2')}</td><td>${input('p3')}</td><td class="calc" data-calc="pass-${i}">${fmt(c.pass,2)}</td><td>${input('A')}</td><td>${input('K')}</td><td>${input('E')}</td><td class="calc" data-calc="hit-${i}">${Number.isFinite(c.hit)?c.hit.toFixed(3):'—'}</td><td>${input('SA')}</td><td>${input('SE')}</td><td>${input('B')}</td>`;body.appendChild(tr)});body.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',e=>{const r=+e.target.dataset.r,k=e.target.dataset.k;currentAnalysis.rows[r].values[k]=clamp(parseInt(e.target.value||'0',10)||0,0,99);e.target.classList.remove('uncertain');currentAnalysis.rows[r].meta[k].low=false;const c=calcRow(currentAnalysis.rows[r].values);body.querySelector(`[data-calc="pass-${r}"]`).textContent=fmt(c.pass,2);body.querySelector(`[data-calc="hit-${r}"]`).textContent=Number.isFinite(c.hit)?c.hit.toFixed(3):'—'}));body.querySelectorAll('input').forEach(inp=>{inp.addEventListener('focus',()=>showCellInspect(+inp.dataset.r,inp.dataset.k));inp.addEventListener('click',()=>showCellInspect(+inp.dataset.r,inp.dataset.k))})}

function statColIndex(key){const hit=GRID.stats.find(x=>x[0]===key);return hit?hit[1]:null}
function showCellInspect(r,key){if(!currentWarpedCanvas)return;const ci=statColIndex(key);if(ci==null)return;currentInspect={r,key};const y0=GRID.ys[1+r],y1=GRID.ys[2+r],x0=GRID.xs[ci],x1=GRID.xs[ci+1],c=$('inspectCanvas');c.width=360;c.height=150;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.imageSmoothingEnabled=true;ctx.drawImage(currentWarpedCanvas,x0+2,y0+2,x1-x0-4,y1-y0-4,0,0,c.width,c.height);const p=settings.roster[r]||{name:'Player'},v=currentAnalysis.rows[r].values[key];const m=currentAnalysis.rows[r].meta[key]||{};$('inspectLabel').textContent=`${p.number?'#'+p.number+' ':''}${p.name} • ${key==='p0'?'0 pass':key==='p1'?'1 pass':key==='p2'?'2 pass':key==='p3'?'3 pass':key} • detected ${v} (${m.vertical||0} strokes${m.slash?' + slash':''})`;$('cellInspector').classList.remove('hide')}
function adjustInspect(delta){if(!currentInspect||!currentAnalysis)return;const {r,key}=currentInspect,inp=$('verifyBody').querySelector(`input[data-r="${r}"][data-k="${key}"]`);if(!inp)return;const v=clamp((parseInt(inp.value||'0',10)||0)+delta,0,99);inp.value=v;inp.dispatchEvent(new Event('input',{bubbles:true}));showCellInspect(r,key)}
function cropCanvas(src,rect,scale=2){const [x0,y0,x1,y1]=rect,c=document.createElement('canvas');c.width=Math.round((x1-x0)*scale);c.height=Math.round((y1-y0)*scale);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(src,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height);const im=ctx.getImageData(0,0,c.width,c.height),d=im.data;for(let y=0;y<c.height;y++){let dark=0;for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4,g=d[i]*.299+d[i+1]*.587+d[i+2]*.114;if(g<120)dark++}if(dark>c.width*.65){for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;d[i]=d[i+1]=d[i+2]=255}}}ctx.putImageData(im,0,0);return c}
async function getOCRWorker(){if(ocrWorker)return ocrWorker;if(!window.Tesseract)throw Error('OCR engine not loaded.');$('ocrStatus').className='status';$('ocrStatus').textContent='Starting local OCR engine…';const base=new URL('./',location.href);ocrWorker=await Tesseract.createWorker('eng',1,{workerPath:'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/6.0.1/worker.min.js',langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2',logger:m=>{if(m.status&&m.progress!=null)$('ocrStatus').textContent=`OCR: ${m.status} ${Math.round(m.progress*100)}%`}});return ocrWorker}
function prepOCR(src,mode='text',variant=0){
 const scale=mode==='name'?4:(mode==='hand'?3.5:3),c=document.createElement('canvas');c.width=Math.max(8,Math.round(src.width*scale));c.height=Math.max(8,Math.round(src.height*scale));const x=c.getContext('2d',{willReadFrequently:true});x.imageSmoothingEnabled=true;x.drawImage(src,0,0,c.width,c.height);const im=x.getImageData(0,0,c.width,c.height),d=im.data;
 if(mode==='hand'){
  let hits=0;for(let i=0;i<d.length;i+=4)if(bluePixel(d[i],d[i+1],d[i+2]))hits++;
  if(hits>Math.max(10,(d.length/4)*.001)){
   for(let i=0;i<d.length;i+=4){const on=bluePixel(d[i],d[i+1],d[i+2]);const v=on?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}x.putImageData(im,0,0);return c;
  }
 }
 const vals=[];for(let i=0;i<d.length;i+=36)vals.push(d[i]*.299+d[i+1]*.587+d[i+2]*.114);const bg=median(vals),thr=clamp(bg-(variant===2?35:52),95,218);
 for(let i=0;i<d.length;i+=4){const g=d[i]*.299+d[i+1]*.587+d[i+2]*.114;let v;if(variant===0)v=clamp((g-(bg-105))*2.15,0,255);else if(variant===2)v=g<thr?0:255;else v=g<clamp(thr+18,110,225)?0:255;d[i]=d[i+1]=d[i+2]=v;d[i+3]=255}x.putImageData(im,0,0);return c
}
function ocrQuality(text,mode){let q=String(text||'').trim();if(!q)return 0;let score=Math.min(35,q.length*2);if(mode==='name'){score+=(q.match(/[A-Za-z]{3,}/g)||[]).length*12;score-=(q.match(/[^A-Za-z0-9# .'-]/g)||[]).length*5}else if(mode==='hand'){score+=(q.match(/\d+/g)||[]).length*7}return score}
async function ocrOne(worker,canvas,whitelist='',mode='text'){
 const psms=mode==='name'?['7','6','13']:['7','6','13'],variants=[0,1,2];let best={text:'',confidence:0,score:-1};for(const variant of variants){const img=prepOCR(canvas,mode,variant);for(const psm of psms){await worker.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:'1',user_defined_dpi:'300',...(whitelist?{tessedit_char_whitelist:whitelist}:{tessedit_char_whitelist:''})});const r=await worker.recognize(img),text=(r.data.text||'').replace(/\s+/g,' ').trim(),confidence=num(r.data.confidence),score=confidence+ocrQuality(text,mode);if(score>best.score)best={text,confidence,score,variant,psm}}}return best
}
function cropRosterPart(warped,r,kind){const y0=GRID.ys[1+r]+2,y1=GRID.ys[2+r]-2,x0=GRID.xs[0]+3,x1=GRID.xs[1]-3,w=x1-x0;if(kind==='number')return cropCanvas(warped,[x0,y0,x0+w*.24,y1],3);if(kind==='name')return cropCanvas(warped,[x0+w*.18,y0,x1,y1],2.8);return cropCanvas(warped,[x0,y0,x1,y1],2.5)}
async function readRosterRow(worker,warped,r){
 const full=await ocrOne(worker,cropRosterPart(warped,r,'full'),'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789# .-','name');
 const jersey=await ocrOne(worker,cropRosterPart(warped,r,'number'),'0123456789#','name');
 const nameRead=await ocrOne(worker,cropRosterPart(warped,r,'name'),"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-",'name');
 const n=(jersey.text.match(/\d{1,2}/)||[])[0]||'';
 const nm=cleanOCR(nameRead.text);
 const combined=((n?'#'+n+' ':'')+(nm||full.text)).trim();
 return {row:r,text:combined,number:n,name:nm,confidence:Math.max(full.confidence,jersey.confidence,nameRead.confidence),raw:{full:full.text,number:jersey.text,name:nameRead.text}};
}
function normalizeName(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function nameSimilarity(a,b){
 a=normalizeName(a);b=normalizeName(b);if(!a||!b)return 0;if(a.includes(b)||b.includes(a))return .94;
 const d=levenshtein(a,b),base=1-d/Math.max(a.length,b.length),aw=a.split(' '),bw=b.split(' ');let token=0;
 for(const x of aw)for(const y of bw)token=Math.max(token,1-levenshtein(x,y)/Math.max(x.length,y.length));
 return Math.max(base,token*.82);
}
async function detectTeamFromRoster(warped){
 migrateTeams();
 const worker=await getOCRWorker();
 $('ocrStatus').className='status';
 $('ocrStatus').textContent='Reading printed roster names and jersey numbers…';
 const reads=[];
 for(let r=0;r<12;r++){
  try{const z=await readRosterRow(worker,warped,r);if(z.text)reads.push(z)}catch(e){console.warn('Roster row OCR failed',r,e)}
 }
 let bestTeam=activeTeam(),bestScore=-1,bestHits=0;
 for(const t of settings.teams){
  let total=0,hits=0;
  for(const rd of reads){
   let best=0;
   const same=(t.roster||[])[rd.row];
   if(same){
    const label=((same.number?'#'+same.number+' ':'')+(same.name||'')).trim();
    best=Math.max(best,nameSimilarity(rd.text,label)*1.18,nameSimilarity(rd.name,same.name||'')*1.15);
    if(rd.number&&same.number&&String(rd.number)===String(same.number))best=Math.max(best,1.15);
   }
   for(const player of t.roster||[]){
    const label=((player.number?'#'+player.number+' ':'')+(player.name||'')).trim();
    best=Math.max(best,nameSimilarity(rd.text,label)*.92,nameSimilarity(rd.name,player.name||'')*.9);
    if(rd.number&&player.number&&String(rd.number)===String(player.number))best=Math.max(best,.82);
   }
   if(best>=.52){total+=best;hits++}
  }
  const score=hits?total+hits*.42:0;
  if(score>bestScore){bestScore=score;bestHits=hits;bestTeam=t}
 }
 currentRosterOCR={reads,bestTeamId:bestTeam.id,bestHits,bestScore};
 console.log('Roster OCR',currentRosterOCR);
 if(bestHits>=2){
  activateTeam(bestTeam.id,true);$('sheetTeam').value=bestTeam.id;
  $('ocrStatus').textContent=`Roster matched ${bestTeam.name} (${bestHits} row matches). Reading header…`;
  return {team:bestTeam,hits:bestHits,reads};
 }
 $('sheetTeam').value=activeTeam().id;
 $('ocrStatus').textContent='Roster OCR was uncertain. Choose the team manually; the raw OCR result was saved for debugging.';
 return {team:null,hits:bestHits,reads};
}
async function runHeaderOCR(warped){const worker=await getOCRWorker();$('ocrStatus').textContent='Reading handwritten date…';const d=await ocrOne(worker,cropCanvas(warped,GRID.headers.date),'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz/- .','hand');$('ocrStatus').textContent='Reading opponent…';const t=await ocrOne(worker,cropCanvas(warped,GRID.headers.opponent),'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .-&','hand');$('ocrStatus').textContent='Reading set and score…';const ss=await ocrOne(worker,cropCanvas(warped,GRID.headers.setScore),'0123456789-–— ','hand');const parsed=parseDateOCR(d.text);if(parsed)$('sheetDate').value=parsed;const opp=bestOpponent(cleanOCR(t.text));if(opp)$('sheetOpponent').value=opp;const parsedSS=parseSetScoreOCR(ss.text);if(parsedSS.set!=null)$('sheetSet').value=parsedSS.set;if(parsedSS.our!=null)$('ourScore').value=parsedSS.our;if(parsedSS.opp!=null)$('oppScore').value=parsedSS.opp;const low=[d,t,ss].filter(x=>x.confidence<45).length;$('ocrStatus').className='status '+(low?'warn':'good');$('ocrStatus').textContent=low?`Header OCR finished, but ${low} field${low===1?'':'s'} looked uncertain. Verify date, opponent, set, and score.`:'Header OCR finished. Verify date, opponent, set, and score.'}
function parseSetScoreOCR(text){let q=String(text||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/[—–]/g,'-').replace(/\s+/g,' ').trim();let m=q.match(/(?:^|\D)([1-5])\D+(\d{1,2})\s*-\s*(\d{1,2})(?:\D|$)/);if(m)return{set:Number(m[1]),our:Number(m[2]),opp:Number(m[3])};m=q.match(/(?:^|\D)([1-5])\D+(\d{1,2})\D+(\d{1,2})(?:\D|$)/);if(m)return{set:Number(m[1]),our:Number(m[2]),opp:Number(m[3])};const nums=(q.match(/\d{1,2}/g)||[]).map(Number);return{set:nums.length&&nums[0]>=1&&nums[0]<=5?nums[0]:null,our:nums.length>=3?nums[1]:null,opp:nums.length>=3?nums[2]:null}}
function cleanOCR(s){return String(s||'').replace(/[|_]+/g,' ').replace(/\s+/g,' ').replace(/^[\W\d]+|[\W]+$/g,'').trim()}
function parseDateOCR(s){let q=String(s||'').replace(/[Oo]/g,'0').replace(/[Il]/g,'1').replace(/[,]/g,' ').replace(/\s+/g,' ').trim();let m=q.match(/(20\d{2})\D+(\d{1,2})\D+(\d{1,2})/);if(m)return safeISO(+m[1],+m[2],+m[3]);m=q.match(/(\d{1,2})\D+(\d{1,2})\D+(20\d{2}|\d{2})/);if(m){let y=m[3].length===2?2000+Number(m[3]):Number(m[3]);let a=+m[1],b=+m[2];if(a>12&&b<=12)return safeISO(y,b,a);return safeISO(y,a,b)}const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};m=q.toLowerCase().match(/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\W*(\d{1,2})(?:\D+(20\d{2}|\d{2}))?/);if(m){const mon=months[m[1]],day=+m[2],yr=m[3]?(m[3].length===2?2000+Number(m[3]):Number(m[3])):new Date().getFullYear();return safeISO(yr,mon,day)}m=q.toLowerCase().match(/(\d{1,2})\W*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\D+(20\d{2}|\d{2}))?/);if(m){const mon=months[m[2]],day=+m[1],yr=m[3]?(m[3].length===2?2000+Number(m[3]):Number(m[3])):new Date().getFullYear();return safeISO(yr,mon,day)}return null}function safeISO(y,m,d){const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function levenshtein(a,b){a=a.toLowerCase();b=b.toLowerCase();const d=Array(b.length+1).fill(0).map((_,i)=>i);for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const old=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old}}return d[b.length]}
function bestOpponent(raw){if(!raw)return'';const known=[...new Set(teamSheets().map(s=>s.opponent).filter(Boolean))];if(!known.length)return raw;let best=raw,score=1;for(const k of known){const r=levenshtein(raw,k)/Math.max(raw.length,k.length);if(r<score){score=r;best=k}}return score<=.28?best:raw}

async function saveCurrentSheet(){if(!currentAnalysis)return;const date=$('sheetDate').value,opponent=$('sheetOpponent').value.trim(),setNumber=$('sheetSet').value.trim();if(!date||!opponent||!setNumber){alert('Please confirm date, opponent, and set number before saving.');return}const vals=currentAnalysis.rows.map(r=>({playerId:r.playerId,values:{...r.values},meta:r.meta}));const event=$('sheetEvent').value.trim();const record={id:editingId||uid(),teamId:activeTeam().id,teamName:activeTeam().name,date,opponent,event,setNumber,ourScore:$('ourScore').value===''?null:num($('ourScore').value),oppScore:$('oppScore').value===''?null:num($('oppScore').value),stats:vals,sourcePhoto:currentSourceBlob,processedPhoto:currentProcessedBlob,createdAt:Date.now(),updatedAt:Date.now()};await putSheet(record);sheets=await allSheets();sheets.sort(sortSheets);await learnCalibration(record);resetCapture();renderAll();showView('home');flash('Set saved locally.','good')}
async function learnCalibration(sheet){settings.tallyProfile='blue-ink-strokes-v2';if(db)await kvSet('settings',settings);renderCalibration()}
function resetCapture(){currentFile=currentSourceBlob=currentProcessedBlob=currentImage=currentAnalysis=currentWarpedCanvas=currentGrid=null;currentCorners=[];currentInspect=null;editingId=null;$('captureWork').classList.add('hide');$('cameraInput').value='';$('photoInput').value='';$('verifyBody').innerHTML='';$('verifyWrap').classList.add('hide');$('verifyEmpty').classList.remove('hide');$('saveSheetBtn').disabled=true;$('cornerDots').innerHTML='';updateOpponents()}

function teamAgg(list=teamSheets()){ const a={sets:list.length,p0:0,p1:0,p2:0,p3:0,A:0,K:0,E:0,SA:0,SE:0,B:0};for(const s of list)for(const r of s.stats||[])for(const k of ['p0','p1','p2','p3','A','K','E','SA','SE','B'])a[k]+=num(r.values[k]);return {...a,...calcRow(a)}}
function playerAgg(pid,list=teamSheets()){ const a={sets:0,p0:0,p1:0,p2:0,p3:0,A:0,K:0,E:0,SA:0,SE:0,B:0};for(const s of list){const r=(s.stats||[]).find(x=>x.playerId===pid);if(!r)continue;const played=Object.values(r.values).some(v=>num(v)>0);if(played)a.sets++;for(const k of ['p0','p1','p2','p3','A','K','E','SA','SE','B'])a[k]+=num(r.values[k])}return {...a,...calcRow(a)}}
function setTeamMetrics(s){const a=teamAgg([s]);return {pass:a.pass,hit:a.hit,SA:a.SA,SE:a.SE,B:a.B}}

function renderAll(){$('heroSeason').textContent=settings.seasonName||'Volleyball Season';$('seasonSub').textContent=(activeTeam().name?activeTeam().name+' • ':'')+'Private • offline';renderHome();renderPlayerOptions();renderExploreOptions();renderExplore();renderCalibration();updateOpponents();updateEvents()}
function renderHome(){const a=teamAgg(),m=$('homeMetrics');m.innerHTML=`<div class="metric"><span class="muted tiny">SETS SAVED</span><b>${a.sets}</b></div><div class="metric"><span class="muted tiny">TEAM PASS AVG</span><b>${fmt(a.pass,2)}</b></div><div class="metric"><span class="muted tiny">TEAM HIT %</span><b>${Number.isFinite(a.hit)?a.hit.toFixed(3):'—'}</b></div>`;drawTeamChart();const recent=$('recentSets');recent.innerHTML='';teamSheets().slice().reverse().slice(0,5).forEach(s=>recent.appendChild(setListRow(s)));if(!teamSheets().length)recent.innerHTML='<p class="muted">No sets saved yet. Photograph your first stat sheet.</p>'}
function drawTeamChart(){const data=teamSheets().map((s,i)=>({x:i,...setTeamMetrics(s),label:`${s.opponent} S${s.setNumber}`}));drawDualChart($('teamChart'),data,'pass','hit','Pass avg','Hit %')}
function drawDualChart(svg,data,k1,k2,l1,l2){svg.innerHTML='';const W=720,H=210,p={l:36,r:18,t:24,b:34};if(!data.length){svg.innerHTML='<text x="20" y="105">No saved data yet.</text>';return}const vals1=data.map(d=>d[k1]).filter(Number.isFinite),vals2=data.map(d=>d[k2]).filter(Number.isFinite);let min1=Math.min(...vals1,0),max1=Math.max(...vals1,3),min2=Math.min(...vals2,-.2),max2=Math.max(...vals2,.5);if(max1===min1)max1=min1+1;if(max2===min2)max2=min2+1;const x=i=>p.l+(data.length===1?(W-p.l-p.r)/2:i/(data.length-1)*(W-p.l-p.r)),y1=v=>p.t+(max1-v)/(max1-min1)*(H-p.t-p.b),y2=v=>p.t+(max2-v)/(max2-min2)*(H-p.t-p.b);svg.insertAdjacentHTML('beforeend',`<line class="axis" x1="${p.l}" y1="${H-p.b}" x2="${W-p.r}" y2="${H-p.b}"/><text x="${p.l}" y="14">${esc(l1)}</text><text x="${W-90}" y="14">${esc(l2)}</text>`);function path(k,y,cls){const pts=data.map((d,i)=>Number.isFinite(d[k])?`${x(i)},${y(d[k])}`:null).filter(Boolean);if(pts.length)svg.insertAdjacentHTML('beforeend',`<polyline class="${cls}" points="${pts.join(' ')}"/>`)}path(k1,y1,'line');path(k2,y2,'line2');data.forEach((d,i)=>{if(Number.isFinite(d[k1]))svg.insertAdjacentHTML('beforeend',`<circle class="dot" cx="${x(i)}" cy="${y1(d[k1])}" r="4"/>`);if(i===0||i===data.length-1||data.length<=5)svg.insertAdjacentHTML('beforeend',`<text x="${x(i)}" y="${H-12}" text-anchor="middle">${i+1}</text>`)});svg.insertAdjacentHTML('beforeend',`<text x="${p.l}" y="${H-2}">Set sequence →</text>`)}

function setListRow(s){const row=document.createElement('div');row.className='listrow';let url='';if(s.processedPhoto)url=URL.createObjectURL(s.processedPhoto);const tm=setTeamMetrics(s),score=s.ourScore!=null&&s.oppScore!=null?` • ${s.ourScore}-${s.oppScore}`:'';row.innerHTML=`${url?`<img class="sheet-thumb" src="${url}" alt="Stat sheet">`:''}<div class="main" style="flex:1"><b>${esc(s.date)} — ${esc(s.opponent)} — Set ${esc(s.setNumber)}${score}</b><small>Pass ${fmt(tm.pass,2)} • Hit ${Number.isFinite(tm.hit)?tm.hit.toFixed(3):'—'} • SA ${tm.SA} • SE ${tm.SE} • B ${tm.B}</small></div><button class="secondary" data-open>View</button>`;row.querySelector('[data-open]').onclick=()=>openSheet(s.id);return row}
function renderSets(){const box=$('setsList');if(!box)return;box.innerHTML='';sheets.slice().reverse().forEach(s=>box.appendChild(setListRow(s)));if(!sheets.length)box.innerHTML='<p class="muted">No saved sets yet.</p>'}
function openSheet(id){const s=sheets.find(x=>x.id===id);if(!s)return;const rows=(s.stats||[]).map(r=>{const p=settings.roster.find(x=>x.id===r.playerId)||{name:'Player',number:''},c=calcRow(r.values);return `<tr><td>${esc((p.number?'#'+p.number+' ':'')+p.name)}</td><td>${r.values.p0}</td><td>${r.values.p1}</td><td>${r.values.p2}</td><td>${r.values.p3}</td><td>${fmt(c.pass,2)}</td><td>${r.values.A}</td><td>${r.values.K}</td><td>${r.values.E}</td><td>${Number.isFinite(c.hit)?c.hit.toFixed(3):'—'}</td><td>${r.values.SA}</td><td>${r.values.SE}</td><td>${r.values.B}</td></tr>`}).join('');let img='';if(s.processedPhoto)img=URL.createObjectURL(s.processedPhoto);$('modalContent').innerHTML=`<p><b>${esc(s.date)} • ${esc(s.opponent)}${s.event?' • '+esc(s.event):''} • Set ${esc(s.setNumber)}</b>${s.ourScore!=null&&s.oppScore!=null?` • ${s.ourScore}-${s.oppScore}`:''}</p>${img?`<img class="source-photo" src="${img}" alt="Saved processed stat sheet">`:''}<div class="stats-scroll"><table class="stat-table"><thead><tr><th>Player</th><th>0</th><th>1</th><th>2</th><th>3</th><th>Pass</th><th>A</th><th>K</th><th>E</th><th>Hit</th><th>SA</th><th>SE</th><th>B</th></tr></thead><tbody>${rows}</tbody></table></div><div class="actions" style="margin-top:12px"><button id="deleteThis" class="danger">Delete set</button></div>`;$('deleteThis').onclick=async()=>{if(confirm('Delete this saved set and its stored photos?')){await deleteSheet(s.id);sheets=await allSheets();sheets.sort(sortSheets);$('sheetModal').classList.remove('open');renderAll()}};$('sheetModal').classList.add('open')}

function renderPlayerOptions(){const sel=$('playerSelect');if(!sel)return;const old=sel.value;sel.innerHTML=settings.roster.map(p=>`<option value="${esc(p.id)}">${esc((p.number?'#'+p.number+' ':'')+p.name)}</option>`).join('');if([...sel.options].some(o=>o.value===old))sel.value=old;renderPlayerView()}
function renderPlayerView(){const sel=$('playerSelect');if(!sel||!sel.value)return;const pid=sel.value,a=playerAgg(pid),box=$('playerMetrics');box.innerHTML=`<div class="metric"><span class="muted tiny">PASS AVG</span><b>${fmt(a.pass,2)}</b><small>${a.rec} receptions</small></div><div class="metric"><span class="muted tiny">HIT %</span><b>${Number.isFinite(a.hit)?a.hit.toFixed(3):'—'}</b><small>${a.K} K / ${a.A} A</small></div><div class="metric"><span class="muted tiny">ACES / SET</span><b>${a.sets?fmt(a.SA/a.sets,2):'—'}</b><small>${a.B} blocks total</small></div>`;const hist=[];for(const s of sheets){const r=(s.stats||[]).find(x=>x.playerId===pid);if(!r)continue;const c=calcRow(r.values);if(!Object.values(r.values).some(v=>num(v)>0))continue;hist.push({s,r,c,pass:c.pass,hit:c.hit})}drawDualChart($('playerChart'),hist,'pass','hit','Pass avg','Hit %');$('playerHistory').innerHTML=hist.length?`<table class="stat-table" style="min-width:650px"><thead><tr><th>Set</th><th>Pass</th><th>3-pass%</th><th>Hit</th><th>K/A</th><th>SA</th><th>SE</th><th>B</th></tr></thead><tbody>${hist.map(x=>`<tr><td>${esc(x.s.date)} ${esc(x.s.opponent)}${x.s.event?' • '+esc(x.s.event):''} S${esc(x.s.setNumber)}</td><td>${fmt(x.c.pass,2)}</td><td>${x.c.rec?pct(x.r.values.p3/x.c.rec):'—'}</td><td>${Number.isFinite(x.c.hit)?x.c.hit.toFixed(3):'—'}</td><td>${x.r.values.K}/${x.r.values.A}</td><td>${x.r.values.SA}</td><td>${x.r.values.SE}</td><td>${x.r.values.B}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">No set stats recorded for this player.</p>'}

function updateOpponents(){const dl=$('opponentsList');if(!dl)return;dl.innerHTML=[...new Set(teamSheets().map(s=>s.opponent).filter(Boolean))].sort().map(x=>`<option value="${esc(x)}"></option>`).join('')}
function updateEvents(){const dl=$('eventsList');if(!dl)return;dl.innerHTML=[...new Set(teamSheets().map(s=>s.event).filter(Boolean))].sort().map(x=>`<option value="${esc(x)}"></option>`).join('')}
function renderExploreOptions(){const p=$('explorePlayer'),o=$('exploreOpponent'),e=$('exploreEvent');if(!p||!o||!e)return;const pv=p.value,ov=o.value,ev=e.value;p.innerHTML=settings.roster.map(x=>`<option value="${esc(x.id)}">${esc((x.number?'#'+x.number+' ':'')+x.name)}</option>`).join('');if([...p.options].some(x=>x.value===pv))p.value=pv;o.innerHTML='<option value="">All opponents</option>'+[...new Set(sheets.map(x=>x.opponent).filter(Boolean))].sort().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');if([...o.options].some(x=>x.value===ov))o.value=ov;e.innerHTML='<option value="">All events</option>'+[...new Set(sheets.map(x=>x.event).filter(Boolean))].sort().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');if([...e.options].some(x=>x.value===ev))e.value=ev;const scope=$('exploreScope');p.disabled=scope.value!=='player'}
function filteredSheets(){const base=teamSheets();const opp=$('exploreOpponent')?.value||'',ev=$('exploreEvent')?.value||'',from=$('exploreFrom')?.value||'',to=$('exploreTo')?.value||'';return base.filter(s=>(!opp||s.opponent===opp)&&(!ev||(s.event||'')===ev)&&(!from||s.date>=from)&&(!to||s.date<=to))}
function clearExploreFilters(){$('exploreScope').value='team';$('exploreOpponent').value='';$('exploreEvent').value='';$('exploreFrom').value='';$('exploreTo').value='';renderExplore()}
function teamAggFor(list){return teamAgg(list)}
function renderExplore(){if(!$('exploreMetrics'))return;renderExploreOptions();const scope=$('exploreScope').value,list=filteredSheets(),pid=$('explorePlayer').value;$('explorePlayer').disabled=scope!=='player';let a,label;if(scope==='player'){a=playerAgg(pid,list);const p=settings.roster.find(x=>x.id===pid);label=p?((p.number?'#'+p.number+' ':'')+p.name):'Player'}else{a=teamAggFor(list);label='Team'}const metrics=$('exploreMetrics');metrics.innerHTML=`<div class="metric"><span class="muted tiny">SETS</span><b>${scope==='player'?a.sets:list.length}</b><small>${esc(label)}</small></div><div class="metric"><span class="muted tiny">PASS AVG</span><b>${fmt(a.pass,2)}</b><small>${a.rec||0} receptions</small></div><div class="metric"><span class="muted tiny">HIT %</span><b>${Number.isFinite(a.hit)?a.hit.toFixed(3):'—'}</b><small>${a.K||0} K / ${a.A||0} A</small></div><div class="metric"><span class="muted tiny">ACES</span><b>${a.SA||0}</b><small>${a.SE||0} serve errors</small></div><div class="metric"><span class="muted tiny">BLOCKS</span><b>${a.B||0}</b></div><div class="metric"><span class="muted tiny">RECORD</span><b>${setRecord(list)}</b><small>sets W–L</small></div>`;const filters=[];if($('exploreOpponent').value)filters.push($('exploreOpponent').value);if($('exploreEvent').value)filters.push($('exploreEvent').value);if($('exploreFrom').value||$('exploreTo').value)filters.push(($('exploreFrom').value||'start')+' → '+($('exploreTo').value||'latest'));$('exploreSummary').textContent=(filters.length?filters.join(' • '):'Entire season')+` • ${list.length} matching saved set${list.length===1?'':'s'}.`;const trend=[];for(const s of list){if(scope==='player'){const r=(s.stats||[]).find(x=>x.playerId===pid);if(!r)continue;const c=calcRow(r.values);trend.push({pass:c.pass,hit:c.hit})}else{const c=setTeamMetrics(s);trend.push({pass:c.pass,hit:c.hit})}}drawDualChart($('exploreChart'),trend,'pass','hit','Pass avg','Hit %');renderExploreMatches(list);const box=$('setsList');box.innerHTML='';list.slice().reverse().forEach(s=>box.appendChild(setListRow(s)));if(!list.length)box.innerHTML='<p class="muted">No sets match these filters.</p>'}
function setRecord(list){let w=0,l=0;for(const s of list){if(s.ourScore==null||s.oppScore==null||s.ourScore===s.oppScore)continue;if(s.ourScore>s.oppScore)w++;else l++}return `${w}–${l}`}
function renderExploreMatches(list){const box=$('exploreMatches');if(!box)return;const groups=new Map();for(const s of list){const k=[s.date,s.opponent,s.event||''].join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s)}box.innerHTML='';[...groups.values()].sort((a,b)=>(b[0].date||'').localeCompare(a[0].date||'')).forEach(g=>{const s=g[0],r=setRecord(g),row=document.createElement('div');row.className='listrow';row.innerHTML=`<div class="main"><b>${esc(s.date)} — ${esc(s.opponent)}</b><small>${s.event?esc(s.event)+' • ':''}${g.length} set${g.length===1?'':'s'} • ${r} set record</small></div>`;box.appendChild(row)});if(!groups.size)box.innerHTML='<p class="muted">No matches in this view.</p>'}

function csvRows(){const rows=[['Date','Opponent','Tournament / Event','Set','Our Score','Opponent Score','Player','Jersey','0 Pass','1 Pass','2 Pass','3 Pass','Pass Avg','Receptions','A','K','E','Hit Pct','Kill Pct','Error Pct','SA','SE','B']];for(const s of sheets)for(const r of s.stats||[]){const p=settings.roster.find(x=>x.id===r.playerId)||{},c=calcRow(r.values);rows.push([s.date,s.opponent,s.event||'',s.setNumber,s.ourScore??'',s.oppScore??'',p.name||'',p.number||'',r.values.p0,r.values.p1,r.values.p2,r.values.p3,Number.isFinite(c.pass)?c.pass:'',c.rec,r.values.A,r.values.K,r.values.E,Number.isFinite(c.hit)?c.hit:'',Number.isFinite(c.kill)?c.kill:'',Number.isFinite(c.error)?c.error:'',r.values.SA,r.values.SE,r.values.B])}return rows}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function exportCSV(){const text=csvRows().map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');downloadBlob(new Blob([text],{type:'text/csv'}),'Volleyball_Stats_'+safeName(settings.seasonName)+'.csv')}
function safeName(s){return String(s||'season').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||'season'}
function exportExcel(){if(!window.XLSX){alert('Excel library did not load. Use CSV export instead.');return}const wb=XLSX.utils.book_new(),rows=csvRows(),ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'Set Stats');const summary=[['Player','Jersey','Sets','Pass Avg','Receptions','3-pass %','2+ pass %','A','K','E','Hit %','Kill %','Error %','SA','SE','B']];for(const p of settings.roster){const a=playerAgg(p.id);summary.push([p.name,p.number,a.sets,Number.isFinite(a.pass)?a.pass:'',a.rec,a.rec?a.p3/a.rec:'',a.rec?(a.p2+a.p3)/a.rec:'',a.A,a.K,a.E,Number.isFinite(a.hit)?a.hit:'',Number.isFinite(a.kill)?a.kill:'',Number.isFinite(a.error)?a.error:'',a.SA,a.SE,a.B])}XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summary),'Player Summary');XLSX.writeFile(wb,'Volleyball_Stats_'+safeName(settings.seasonName)+'.xlsx')}

async function exportArchive(){if(!window.JSZip){alert('Archive library did not load.');return}const z=new JSZip(),meta={version:2,exportedAt:new Date().toISOString(),settings:{...settings},sheets:[]};for(const s of sheets){const clean={...s,sourcePhoto:null,processedPhoto:null};if(s.sourcePhoto){const n=`photos/${s.id}_source.jpg`;z.file(n,s.sourcePhoto);clean.sourceFile=n}if(s.processedPhoto){const n=`photos/${s.id}_aligned.jpg`;z.file(n,s.processedPhoto);clean.processedFile=n}meta.sheets.push(clean)}z.file('season.json',JSON.stringify(meta,null,2));const blob=await z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});downloadBlob(blob,'Volley_Season_'+safeName(settings.seasonName)+'.zip')}
async function importArchive(file){if(!file||!window.JSZip)return;try{const z=await JSZip.loadAsync(file),entry=z.file('season.json');if(!entry)throw Error('No season.json found in archive.');const meta=JSON.parse(await entry.async('text'));if(!meta.settings||!Array.isArray(meta.sheets))throw Error('Invalid season archive.');if(!confirm(`Import ${meta.sheets.length} saved sets from “${meta.settings.seasonName||'season'}”? This will replace the current local season.`))return;const tx=db.transaction('sheets','readwrite'),store=tx.objectStore('sheets');store.clear();for(const s of meta.sheets){if(s.sourceFile&&z.file(s.sourceFile))s.sourcePhoto=await z.file(s.sourceFile).async('blob');if(s.processedFile&&z.file(s.processedFile))s.processedPhoto=await z.file(s.processedFile).async('blob');delete s.sourceFile;delete s.processedFile;delete s.lineup;if(!('event' in s))s.event='';store.put(s)}await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});settings=meta.settings;migrateTeams();await kvSet('settings',settings);sheets=await allSheets();sheets.sort(sortSheets);fillSetup();renderAll();showView('home');flash('Season archive restored.','good')}catch(e){alert('Could not import archive: '+(e.message||e))}finally{$('importArchive').value=''}}

window.addEventListener('beforeunload',()=>{try{if(ocrWorker)ocrWorker.terminate()}catch(e){}});
init().catch(e=>{console.error(e);document.body.innerHTML='<div style="padding:24px;font-family:system-ui"><h2>Volley Stats could not start</h2><p>'+esc(e.message||String(e))+'</p></div>'});
