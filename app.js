const APP_VERSION='3.0';
const KEY='volleyStatsAI_v3';
const SCAN_FIELDS=['p0','p1','p2','p3','A','K','E','S','SA','SE','D','B'];

const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);
const clampInt=v=>Math.max(0,Math.min(999,Number.parseInt(v||0,10)||0));
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;

let state=loadState();
let currentImageData='';
let currentResult=null;

function defaultState(){return{
  seasonName:'2026 Volleyball',
  scannerUrl:'',scannerToken:'',
  teams:[{id:'team-1',name:'Team 1',roster:[]},{id:'team-2',name:'Team 2',roster:[]}],
  sets:[]
}}
function loadState(){try{const s=JSON.parse(localStorage.getItem(KEY));return {...defaultState(),...s,teams:s?.teams?.length?s.teams:defaultState().teams,sets:s?.sets||[]}}catch{return defaultState()}}
function saveState(){localStorage.setItem(KEY,JSON.stringify(state))}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function teamById(id){return state.teams.find(t=>t.id===id)||state.teams[0]}
function activeTeamId(){return $('teamFilter')?.value||state.teams[0]?.id}
function playerKey(p){return `${p.jersey||''}|${(p.name||'').trim().toLowerCase()}`}
function passAvg(v){const n=v.p0+v.p1+v.p2+v.p3;return n?((v.p1+2*v.p2+3*v.p3)/n):null}
function hitPct(v){return v.A?((v.K-v.E)/v.A):null}
function pct(v){return Number.isFinite(v)?v.toFixed(3):'—'}

function init(){
  $('scanDate').value=today();
  bindNav();bindFiles();bindActions();renderAll();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js?v=3.0',{updateViaCache:'none'}).catch(()=>{});
}
function bindNav(){document.querySelectorAll('.bottomnav button').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)))}
function showView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.bottomnav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));window.scrollTo({top:0,behavior:'instant'});if(id==='players')renderPlayers();if(id==='sets')renderSets()}
function bindFiles(){
  $('cameraInput').addEventListener('change',e=>loadPhoto(e.target.files?.[0]));
  $('photoInput').addEventListener('change',e=>loadPhoto(e.target.files?.[0]));
  $('replacePhoto').addEventListener('click',()=>$('photoInput').click());
  $('importJson').addEventListener('change',importBackup);
}
function bindActions(){
  $('teamFilter').addEventListener('change',renderHome);
  $('setsTeam').addEventListener('change',renderSets);
  $('playerTeam').addEventListener('change',()=>{fillPlayerSelect();renderPlayers()});
  $('playerSelect').addEventListener('change',renderPlayers);
  $('teamSlot').addEventListener('change',loadTeamEditor);
  $('saveSeason').addEventListener('click',()=>{state.seasonName=$('seasonName').value.trim()||'Volleyball Season';saveState();renderAll();flash('Season saved.')});
  $('saveScanner').addEventListener('click',saveScanner);
  $('testScanner').addEventListener('click',testScanner);
  $('saveTeam').addEventListener('click',saveTeam);
  $('sendScan').addEventListener('click',scanImage);
  $('rescanBtn').addEventListener('click',scanImage);
  $('saveSet').addEventListener('click',saveVerifiedSet);
  $('cancelScan').addEventListener('click',resetScan);
  $('exportJson').addEventListener('click',exportBackup);
  $('exportCsv').addEventListener('click',exportCSV);
}

function fillTeamSelects(){
  const opts=state.teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name||'Unnamed team')}</option>`).join('');
  ['teamFilter','scanTeam','setsTeam','playerTeam'].forEach(id=>{const old=$(id).value;$(id).innerHTML=opts;if(state.teams.some(t=>t.id===old))$(id).value=old});
  fillPlayerSelect();
}
function fillPlayerSelect(){
  const t=teamById($('playerTeam').value);const old=$('playerSelect').value;
  $('playerSelect').innerHTML=(t.roster||[]).map(p=>`<option value="${esc(playerKey(p))}">#${esc(p.jersey)} ${esc(p.name)}</option>`).join('')||'<option value="">No roster yet</option>';
  if([...$('playerSelect').options].some(o=>o.value===old))$('playerSelect').value=old;
}
function renderAll(){
  $('seasonName').value=state.seasonName;$('seasonTitle').textContent=state.seasonName;
  $('scannerUrl').value=state.scannerUrl||'';$('scannerToken').value=state.scannerToken||'';
  fillTeamSelects();loadTeamEditor();renderHome();renderSets();renderPlayers();renderConnection();
}
function renderConnection(){
  const ok=!!(state.scannerUrl&&state.scannerToken);const el=$('connectionBanner');
  el.className='notice '+(ok?'good':'warn');el.textContent=ok?'AI scanner is configured.':'Scanner service not configured yet. Open Setup.';
}

function aggregateSets(sets, playerMatch=null){
  const a={sets:sets.length,p0:0,p1:0,p2:0,p3:0,A:0,K:0,E:0,S:0,SA:0,SE:0,D:0,B:0};
  sets.forEach(s=>(s.players||[]).forEach(p=>{if(playerMatch&&playerKey(p)!==playerMatch)return;SCAN_FIELDS.forEach(k=>a[k]+=clampInt(p[k]))}));
  a.pass=passAvg(a);a.hit=hitPct(a);return a;
}
function metric(label,value){return `<div class="metric"><span>${esc(label)}</span><b>${esc(value)}</b></div>`}
function renderHome(){
  const tid=activeTeamId();const sets=state.sets.filter(s=>s.teamId===tid);const a=aggregateSets(sets);
  $('homeMetrics').innerHTML=[metric('Sets',a.sets),metric('Pass avg',a.pass===null?'—':a.pass.toFixed(2)),metric('Hit %',pct(a.hit)),metric('Aces',a.SA),metric('Digs',a.D),metric('Blocks',a.B)].join('');
  $('recentSets').innerHTML=sets.slice().sort((a,b)=>(b.date+b.createdAt).localeCompare(a.date+a.createdAt)).slice(0,8).map(setCard).join('')||'<p class="muted">No sets saved yet.</p>';
}
function setCard(s){
  const a=aggregateSets([s]);const score=(s.scoreUs!==''&&s.scoreThem!=='')?`${s.scoreUs}–${s.scoreThem}`:'';
  return `<div class="list-item"><div class="row"><b>${esc(s.opponent||'Opponent')} • Set ${esc(s.setNo||'?')}</b><b>${esc(score)}</b></div><small>${esc(s.date||'')} ${s.event?'• '+esc(s.event):''} • Pass ${a.pass===null?'—':a.pass.toFixed(2)} • Hit ${pct(a.hit)} • SA ${a.SA} • D ${a.D}</small></div>`
}
function renderSets(){
  const tid=$('setsTeam').value||state.teams[0]?.id;const sets=state.sets.filter(s=>s.teamId===tid).slice().sort((a,b)=>(b.date+b.createdAt).localeCompare(a.date+a.createdAt));
  $('setsList').innerHTML=sets.map(s=>`${setCard(s)}<div class="actions" style="margin:-4px 0 8px"><button class="secondary small" onclick="deleteSet('${s.id}')">Delete</button></div>`).join('')||'<p class="muted">No sets saved.</p>';
}
window.deleteSet=id=>{if(!confirm('Delete this saved set?'))return;state.sets=state.sets.filter(s=>s.id!==id);saveState();renderAll()};
function renderPlayers(){
  const tid=$('playerTeam').value||state.teams[0]?.id;const pk=$('playerSelect').value;const sets=state.sets.filter(s=>s.teamId===tid);const a=aggregateSets(sets,pk);
  $('playerMetrics').innerHTML=[metric('Sets',sets.filter(s=>(s.players||[]).some(p=>playerKey(p)===pk)).length),metric('Pass avg',a.pass===null?'—':a.pass.toFixed(2)),metric('Hit %',pct(a.hit)),metric('Kills',a.K),metric('Aces',a.SA),metric('Digs',a.D)].join('');
  const rows=sets.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(s=>{const p=(s.players||[]).find(x=>playerKey(x)===pk);if(!p)return'';return `<tr><td>${esc(s.date)}</td><td>${esc(s.opponent)}</td><td>${esc(s.setNo)}</td><td>${passAvg(p)?.toFixed(2)??'—'}</td><td>${p.A}</td><td>${p.K}</td><td>${p.E}</td><td>${pct(hitPct(p))}</td><td>${p.SA}</td><td>${p.D}</td><td>${p.B}</td></tr>`}).join('');
  $('playerHistory').innerHTML=rows?`<table class="stat-table" style="min-width:700px"><thead><tr><th>Date</th><th>Opponent</th><th>Set</th><th>Pass</th><th>A</th><th>K</th><th>E</th><th>Hit</th><th>SA</th><th>D</th><th>B</th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="muted">No data for this player yet.</p>';
}

function loadTeamEditor(){
  const i=Number($('teamSlot').value||0);const t=state.teams[i]||state.teams[0];$('teamName').value=t.name||'';$('rosterText').value=(t.roster||[]).map(p=>`#${p.jersey} ${p.name}`).join('\n');
}
function parseRoster(text){return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,i)=>{const m=line.match(/^#?\s*([\w-]+)\s+(.+)$/);return m?{jersey:m[1],name:m[2].trim()}:{jersey:String(i+1),name:line}})}
function saveTeam(){const i=Number($('teamSlot').value||0);const old=state.teams[i]||{id:`team-${i+1}`};state.teams[i]={id:old.id,name:$('teamName').value.trim()||`Team ${i+1}`,roster:parseRoster($('rosterText').value)};saveState();renderAll();flash('Team saved.')}
function saveScanner(){state.scannerUrl=$('scannerUrl').value.trim().replace(/\/$/,'');state.scannerToken=$('scannerToken').value.trim();saveState();renderConnection();flash('Scanner settings saved.')}
async function testScanner(){saveScanner();const el=$('scannerTest');el.className='status';el.textContent='Testing…';try{const r=await fetch(state.scannerUrl+'/health',{headers:{'X-App-Token':state.scannerToken}});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);el.className='status good';el.textContent=`Connected. ${j.model?'Model: '+j.model:''}`}catch(e){el.className='status bad';el.textContent='Could not connect: '+e.message}}

async function loadPhoto(file){if(!file)return;showView('scan');$('scanWork').classList.remove('hide');$('verifyCard').classList.add('hide');currentResult=null;$('imageStatus').className='status';$('imageStatus').textContent='Preparing photo…';try{currentImageData=await resizeImage(file,1800,.88);$('preview').src=currentImageData;$('imageStatus').className='status good';$('imageStatus').textContent='Photo ready to scan.';suggestMatchDetails()}catch(e){$('imageStatus').className='status bad';$('imageStatus').textContent='Could not read photo: '+e.message}}
function resizeImage(file,maxDim=1800,quality=.88){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{let w=img.naturalWidth,h=img.naturalHeight;const scale=Math.min(1,maxDim/Math.max(w,h));w=Math.round(w*scale);h=Math.round(h*scale);const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);resolve(c.toDataURL('image/jpeg',quality));URL.revokeObjectURL(img.src)};img.onerror=()=>reject(new Error('Image load failed'));img.src=URL.createObjectURL(file)})}
function suggestMatchDetails(){const tid=$('scanTeam').value;const date=$('scanDate').value||today();const recent=state.sets.filter(s=>s.teamId===tid&&s.date===date).sort((a,b)=>Number(b.setNo)-Number(a.setNo))[0];if(recent){if(!$('scanOpponent').value)$('scanOpponent').value=recent.opponent||'';if(!$('scanEvent').value)$('scanEvent').value=recent.event||'';if(!$('scanSet').value)$('scanSet').value=String((Number(recent.setNo)||0)+1)}else if(!$('scanSet').value)$('scanSet').value='1'}

async function scanImage(){
  if(!currentImageData)return alert('Choose a photo first.');
  if(!state.scannerUrl||!state.scannerToken){showView('setup');return alert('Set up the AI scanner connection first.');}
  const team=teamById($('scanTeam').value);const btn=$('sendScan');btn.disabled=true;$('rescanBtn').disabled=true;$('imageStatus').className='status';$('imageStatus').textContent='AI is reading the sheet… this may take 10–30 seconds.';
  try{
    const payload={image:currentImageData,template_version:'3.4',team:{name:team.name,roster:team.roster},metadata:{date:$('scanDate').value,opponent:$('scanOpponent').value,set:$('scanSet').value,event:$('scanEvent').value}};
    const r=await fetch(state.scannerUrl+'/scan',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.scannerToken},body:JSON.stringify(payload)});
    const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);
    currentResult=j.result;renderVerification(currentResult);$('imageStatus').className='status good';$('imageStatus').textContent=`Scan complete${j.model?' • '+j.model:''}. Verify before saving.`;$('verifyCard').classList.remove('hide');$('verifyCard').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){$('imageStatus').className='status bad';$('imageStatus').textContent='Scan failed: '+e.message}
  finally{btn.disabled=false;$('rescanBtn').disabled=false}
}
function normalizeResult(result){
  const team=teamById($('scanTeam').value);const found=result.players||[];
  const byJersey=new Map(found.map(p=>[String(p.jersey).trim(),p]));
  const roster=(team.roster||[]).length?team.roster:found.map(p=>({jersey:p.jersey,name:p.name}));
  const players=roster.map((rp,i)=>{const src=byJersey.get(String(rp.jersey).trim())||found.find(p=>(p.name||'').toLowerCase()===(rp.name||'').toLowerCase())||{};const o={jersey:String(rp.jersey||src.jersey||''),name:rp.name||src.name||`Player ${i+1}`,confidence:Number(src.confidence||0)};SCAN_FIELDS.forEach(k=>o[k]=clampInt(src[k]));return o});
  return {...result,players};
}
function renderVerification(raw){currentResult=normalizeResult(raw);const uncertain=new Set((currentResult.uncertain_fields||[]).map(String));$('verifyBody').innerHTML=currentResult.players.map((p,i)=>{const rowUncertain=p.confidence<75||[...uncertain].some(x=>x.startsWith(String(p.jersey)+'.')||x.startsWith(`row${i+1}.`));const inputs=SCAN_FIELDS.reduce((a,k)=>(a[k]=`<input data-row="${i}" data-stat="${k}" type="number" min="0" inputmode="numeric" value="${p[k]}">`,a),{});return `<tr class="${rowUncertain?'uncertain':''}"><td><b>#${esc(p.jersey)} ${esc(p.name)}</b><br><small>${Math.round(p.confidence||0)}% confidence</small></td><td>${inputs.p0}</td><td>${inputs.p1}</td><td>${inputs.p2}</td><td>${inputs.p3}</td><td class="calc passcalc">${passAvg(p)?.toFixed(2)??'—'}</td><td>${inputs.A}</td><td>${inputs.K}</td><td>${inputs.E}</td><td class="calc hitcalc">${pct(hitPct(p))}</td><td>${inputs.S}</td><td>${inputs.SA}</td><td>${inputs.SE}</td><td>${inputs.D}</td><td>${inputs.B}</td></tr>`}).join('');
  $('verifyBody').querySelectorAll('input').forEach(inp=>inp.addEventListener('input',onVerifyInput));
  const er=currentResult.team_errors||{};$('errOpponent').value=clampInt(er.opponent_errors);$('errUnforced').value=clampInt(er.our_unforced_errors);$('errTransition').value=clampInt(er.freeball_transition_errors);$('errOther').value=clampInt(er.net_rotation_other_errors);
  const notes=[currentResult.sheet_notes,(currentResult.uncertain_fields||[]).length?`Double-check: ${(currentResult.uncertain_fields||[]).join(', ')}`:''].filter(Boolean).join(' ');$('scanNotes').className='notice '+((currentResult.uncertain_fields||[]).length?'warn':'good');$('scanNotes').textContent=notes||'No specific uncertainties reported.';
}
function onVerifyInput(e){const i=Number(e.target.dataset.row),k=e.target.dataset.stat;currentResult.players[i][k]=clampInt(e.target.value);const tr=e.target.closest('tr');tr.querySelector('.passcalc').textContent=passAvg(currentResult.players[i])?.toFixed(2)??'—';tr.querySelector('.hitcalc').textContent=pct(hitPct(currentResult.players[i]))}
function saveVerifiedSet(){
  if(!currentResult)return;document.querySelectorAll('#verifyBody input').forEach(inp=>{currentResult.players[Number(inp.dataset.row)][inp.dataset.stat]=clampInt(inp.value)});
  const errors={opponent_errors:clampInt($('errOpponent').value),our_unforced_errors:clampInt($('errUnforced').value),freeball_transition_errors:clampInt($('errTransition').value),net_rotation_other_errors:clampInt($('errOther').value)};
  const set={id:uid(),createdAt:new Date().toISOString(),teamId:$('scanTeam').value,date:$('scanDate').value||today(),opponent:$('scanOpponent').value.trim(),event:$('scanEvent').value.trim(),setNo:String($('scanSet').value||''),scoreUs:$('scoreUs').value,scoreThem:$('scoreThem').value,players:currentResult.players,team_errors:errors,scan_notes:currentResult.sheet_notes||''};
  state.sets.push(set);saveState();resetScan();renderAll();showView('home');flash('Set saved.')
}
function resetScan(){currentImageData='';currentResult=null;$('preview').removeAttribute('src');$('scanWork').classList.add('hide');$('verifyCard').classList.add('hide');$('cameraInput').value='';$('photoInput').value=''}

function exportBackup(){downloadBlob(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),`volley-stats-backup-${today()}.json`)}
async function importBackup(e){const f=e.target.files?.[0];if(!f)return;try{const j=JSON.parse(await f.text());if(!j.teams||!Array.isArray(j.sets))throw new Error('Not a Volley Stats backup');state={...defaultState(),...j};saveState();renderAll();flash('Backup imported.')}catch(err){alert('Import failed: '+err.message)}finally{e.target.value=''}}
function exportCSV(){const rows=[['Team','Date','Opponent','Event','Set','Us','Them','Jersey','Player','0','1','2','3','Pass Avg','A','K','E','Hit %','S','SA','SE','D','B','Opponent Errors','Our Unforced Errors','Transition Errors','Net/Rotation/Other']];state.sets.forEach(s=>{const t=teamById(s.teamId);(s.players||[]).forEach(p=>rows.push([t.name,s.date,s.opponent,s.event,s.setNo,s.scoreUs,s.scoreThem,p.jersey,p.name,p.p0,p.p1,p.p2,p.p3,passAvg(p)?.toFixed(3)??'',p.A,p.K,p.E,Number.isFinite(hitPct(p))?hitPct(p).toFixed(3):'',p.S,p.SA,p.SE,p.D,p.B,s.team_errors?.opponent_errors||0,s.team_errors?.our_unforced_errors||0,s.team_errors?.freeball_transition_errors||0,s.team_errors?.net_rotation_other_errors||0]))});const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');downloadBlob(new Blob([csv],{type:'text/csv'}),`volley-stats-${today()}.csv`)}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
function flash(msg){const el=document.createElement('div');el.textContent=msg;Object.assign(el.style,{position:'fixed',top:'70px',left:'50%',transform:'translateX(-50%)',zIndex:1000,background:'#172033',color:'#fff',padding:'10px 14px',borderRadius:'10px',boxShadow:'0 4px 18px rgba(0,0,0,.2)'});document.body.appendChild(el);setTimeout(()=>el.remove(),1800)}

init();
