let config = null;
let currentTypeId = null;
let unlocked = sessionStorage.getItem('mod_edit_code') ? true : false;
let editCode = sessionStorage.getItem('mod_edit_code') || '';
let selectedDecor = null;
let dragState = null;
let inlineDataUrl = '';
let adminCache = [];

const $ = id => document.getElementById(id);
function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function rich(t){ if(!t) return ''; return t.replace(/\n/g,'<br>'); }
function headers(){ return { 'Content-Type':'application/json', 'x-edit-code': editCode }; }
function curType(){ return (config.applicationTypes||[]).find(t=>t.id===currentTypeId) || config.applicationTypes[0]; }
function typeName(id){ const t=(config.applicationTypes||[]).find(x=>x.id===id); return t?t.name:id; }

async function fetchConfig(){
  const r = await fetch('/api/config');
  config = await r.json();
  if(!Array.isArray(config.decor)) config.decor = [];
  if(!Array.isArray(config.applicationTypes) || !config.applicationTypes.length) location.reload();
  if(!currentTypeId || !config.applicationTypes.some(t=>t.id===currentTypeId)) currentTypeId = config.applicationTypes[0].id;
  applyConfig();
}
function applyConfig(){
  $('appTitle').textContent = config.title;
  document.title = config.title;
  $('appSubtitle').textContent = config.subtitle || '';
  $('appRules').textContent = config.rules || '';
  $('appRules').style.display = config.rules ? 'block' : 'none';
  $('bottomText').innerHTML = rich(config.bottomText);
  const ab = $('announceBar');
  if(config.announcement){ ab.style.display='block'; ab.textContent = config.announcement; } else ab.style.display='none';
  const bi = $('bannerImg');
  if(config.bannerImage){ bi.src = config.bannerImage; bi.style.display='block'; } else bi.style.display='none';
  const li = $('logoImg');
  if(config.logoImage){ li.src = config.logoImage; li.style.display='block'; } else li.style.display='none';
  $('topText').innerHTML = rich(config.topText);
  renderTypeCards(); renderApprovedPublic(); renderDecor();
  if (curType() && $('applyCard').style.display === 'block') fillRoleHeader(curType());
  if(unlocked) showEditor(false);
}
function renderTypeCards(){
  const w = $('roleCards'); w.innerHTML = '';
  config.applicationTypes.forEach(t=>{
    const b = document.createElement('button');
    b.className = 'role-card'; b.onclick = ()=>pickType(t.id);
    b.innerHTML = `<span class="tick">${esc(t.prefix||'APP')}</span><span><h4>${esc(t.name)} Applications</h4><p>${esc(t.blurb||'')}</p></span><span class="go">→</span>`;
    w.appendChild(b);
  });
}
function toggleApplyMenu(){
  const m = $('roleMenu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
  if (m.style.display === 'block') renderTypeCards();
}
function pickType(id){
  currentTypeId = id;
  const t = curType();
  $('roleMenu').style.display = 'none';
  $('applyCard').style.display = 'block';
  fillRoleHeader(t); renderForm();
  $('applyCard').scrollIntoView({ behavior:'smooth', block:'start' });
}
function fillRoleHeader(t){
  $('roleKicker').textContent = (t.name || 'Application').toUpperCase() + ' APPLICATION';
  $('roleName').textContent = t.name + ' Application';
  $('roleIntro').textContent = t.intro || '';
  $('successMsg').textContent = t.successMessage || '';
}
function renderForm(){
  const t = curType();
  const f = $('modForm'); f.innerHTML=''; f.style.display='block';
  $('success').style.display='none';
  t.questions.forEach(q=>{
    const lab = document.createElement('label');
    lab.innerHTML = esc(q.label) + (q.required ? ' <span class="req">*</span>' : '');
    f.appendChild(lab);
    let el;
    if(q.type==='textarea'){ el = document.createElement('textarea'); }
    else if(q.type==='select'){
      el = document.createElement('select');
      (q.options||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(o=>{
        const op=document.createElement('option'); op.value=o; op.textContent=o; el.appendChild(op);
      });
    } else { el=document.createElement('input'); el.type=q.type||'text'; }
    el.id='f_'+q.id; el.placeholder=q.placeholder||''; el.required=!!q.required;
    f.appendChild(el);
  });
  const b=document.createElement('button');
  b.className='btn-primary'; b.type='submit'; b.textContent='Submit '+t.name+' Application';
  f.appendChild(b);
}
async function submitApp(e){
  e.preventDefault();
  const t = curType();
  const answers = {};
  for(const q of t.questions){
    const el = $('f_'+q.id);
    const v = (el.value||'').trim();
    if(q.required && !v){ alert('Please fill: '+q.label); el.focus(); return false; }
    if((q.id==='why'||q.id==='scenario'||q.id==='bugscenario') && v.length<20){ alert(q.label+' is too short. Give more detail.'); el.focus(); return false; }
    answers[q.id]=v;
  }
  try{
    const r = await fetch('/api/applications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:t.id,answers})});
    const j = await r.json();
    if(!r.ok) throw new Error(j.error||'Submit failed');
    $('modForm').style.display='none';
    $('success').style.display='block';
    $('successMsg').textContent = t.successMessage || '';
    $('newAppId').textContent = j.appId;
    renderApprovedPublic();
  }catch(err){ alert(err.message); }
  return false;
}
function resetForm(){
  $('applyCard').style.display='none';
  $('roleMenu').style.display='block'; renderTypeCards();
  document.getElementById('apply').scrollIntoView({ behavior:'smooth' });
}
function copyAppId(){ const t=$('newAppId').textContent; navigator.clipboard?.writeText(t); alert('Copied: '+t); }

async function checkStatus(){
  const id = $('statusInput').value.trim().toUpperCase();
  const box = $('statusResult'); box.innerHTML='';
  if(!id){ box.innerHTML='<p class="hint">Enter your ID.</p>'; return; }
  try{
    const r = await fetch('/api/status/'+encodeURIComponent(id));
    if(!r.ok) throw 0;
    const s = await r.json();
    const cls = s.status||'pending';
    const word = cls==='approved'?'Accepted':cls==='denied'?'Not accepted':'Under review';
    box.innerHTML = `<div class="status-box ${cls}"><b>${esc(s.appId)}</b> · ${esc(s.typeName||'')}<br><span class="status ${cls}">${word}</span><br><span class="hint">Submitted: ${esc(s.date||'')}</span>${s.adminNote?'<br><br><b>Note from staff:</b><br>'+esc(s.adminNote):''}</div>`;
  }catch{
    box.innerHTML = '<div class="status-box pending">No application found for <b>'+esc(id)+'</b></div>';
  }
}
async function renderApprovedPublic(){
  const wrap=$('accepted'), list=$('approvedList');
  const sel=$('acceptedFilter');
  const keep = sel.value;
  sel.innerHTML='<option value="">All roles</option>';
  config.applicationTypes.forEach(t=>{ if(t.showApproved){ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o); } });
  sel.value = keep;
  $('acceptedTitle').textContent = config.approvedTitle || 'New team members';
  try{
    const r = await fetch('/api/approved');
    let arr = await r.json();
    if(sel.value) arr = arr.filter(s=>s.type===sel.value);
    if(!config.showApproved || !arr.length){ wrap.style.display='none'; return; }
    wrap.style.display='block'; list.innerHTML='';
    let lastType = null;
    arr.forEach(s=>{
      if(s.type!==lastType){ lastType=s.type; const h=document.createElement('div'); h.className='hint'; h.style.margin='8px 0 2px'; h.textContent=typeName(s.type); list.appendChild(h); }
      const d=document.createElement('div'); d.textContent=s.username+' · '+s.appId; list.appendChild(d);
    });
  }catch{ wrap.style.display='none'; }
}

// ---- editor auth ----
function openCodeModal(){
  if(unlocked){ showEditor(); return; }
  $('codeModal').style.display='flex'; $('codeError').textContent=''; $('codeInput').value='';
  setTimeout(()=>$('codeInput').focus(),50);
}
function closeCodeModal(){ $('codeModal').style.display='none'; }
async function checkCode(){
  const v = $('codeInput').value.trim();
  if(!v){ $('codeError').textContent='Enter the code.'; return; }
  try{
    const r = await fetch('/api/admin/applications',{headers:{'x-edit-code':v}});
    if(!r.ok) throw 0;
    editCode = v; sessionStorage.setItem('mod_edit_code', v);
    unlocked = true; closeCodeModal(); showEditor();
  }catch{ $('codeError').textContent='Wrong code.'; }
}
function switchTab(name,btn){
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('active'));
  $('tab-'+name).classList.add('active');
}
function toggleCode(){ const i=$('e_code'); i.type=i.type==='password'?'text':'password'; }
function fileToDataUrl(file,cb){ const r=new FileReader(); r.onload=()=>cb(r.result); r.readAsDataURL(file); }
function clearImg(k){ config[k]=''; syncImgPreviews(); }
function syncImgPreviews(){
  const map={bannerImage:'p_banner',logoImage:'p_logo',backgroundImage:'p_bg'};
  for(const k in map){ const img=$(map[k]); if(!img) continue; if(config[k]){ img.src=config[k]; img.style.display='block'; } else img.style.display='none'; }
}
function showEditor(refetch=true){
  $('editor').style.display='block';
  $('e_title').value=config.title;
  $('e_subtitle').value=config.subtitle||'';
  $('e_announce').value=config.announcement||'';
  $('e_code').value=editCode;
  $('e_showApproved').checked=config.showApproved!==false;
  $('e_approvedTitle').value=config.approvedTitle||'';
  $('e_accent').value=config.accent||'#6cb8f0';
  $('e_bg').value=config.bg||'#080a12';
  $('e_bannerUrl').value=config.bannerImage?.startsWith('data:')?'':(config.bannerImage||'');
  $('e_logoUrl').value=config.logoImage?.startsWith('data:')?'':(config.logoImage||'');
  $('e_bgUrl').value=config.backgroundImage?.startsWith('data:')?'':(config.backgroundImage||'');
  $('e_rules').value=config.rules||'';
  $('e_top').value=config.topText||'';
  $('e_bottom').value=config.bottomText||'';
  syncImgPreviews(); renderTypeEditor(); syncQType(); renderQEditor(); renderDecor(); renderDecorList();
  syncAppTypeFilter();
  if(refetch) renderSubs();
}
function lockEditor(){ unlocked=false; editCode=''; sessionStorage.removeItem('mod_edit_code'); selectedDecor=null; $('editor').style.display='none'; renderDecor(); }
function edType(i){ return config.applicationTypes[i]; }
function renderTypeEditor(){
  const w=$('typeEditor'); w.innerHTML='';
  config.applicationTypes.forEach((t,i)=>{
    const d=document.createElement('div'); d.className='type-item';
    d.innerHTML=`<b>${esc(t.name)}</b> <span class="hint">id: ${esc(t.id)} · prefix: ${esc(t.prefix)}</span>
      <label>Role name</label><input value="${esc(t.name)}" oninput="edType(${i}).name=this.value">
      <label>Dropdown blurb</label><input value="${esc(t.blurb||'')}" oninput="edType(${i}).blurb=this.value">
      <div class="row"><span style="flex:1"><label>ID prefix (on application IDs)</label><input value="${esc(t.prefix||'')}" oninput="edType(${i}).prefix=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4)"></span></div>
      <label>Intro (above the form)</label><textarea rows="2" oninput="edType(${i}).intro=this.value">${esc(t.intro||'')}</textarea>
      <label>Success message</label><textarea rows="2" oninput="edType(${i}).successMessage=this.value">${esc(t.successMessage||'')}</textarea>
      <label style="font-size:13px"><input type="checkbox" ${t.showApproved!==false?'checked':''} style="width:auto" onchange="edType(${i}).showApproved=this.checked"> Show in public Accepted list</label>`;
    w.appendChild(d);
  });
}
function syncQType(){
  const s=$('e_qtype'); const keep=s.value;
  s.innerHTML='';
  config.applicationTypes.forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; s.appendChild(o); });
  s.value = config.applicationTypes.some(t=>t.id===keep) ? keep : config.applicationTypes[0].id;
}
function qType(){ return config.applicationTypes.find(t=>t.id===$('e_qtype').value) || config.applicationTypes[0]; }
function renderQEditor(){
  const t=qType();
  const w=$('qEditor'); w.innerHTML='';
  t.questions.forEach((q,i)=>{
    const d=document.createElement('div'); d.className='q-item';
    const ti=config.applicationTypes.indexOf(t);
    d.innerHTML=`<strong>Q${i+1}</strong>
      <div class="row"><button class="btn-small" onclick="moveQ(${i},-1)">↑</button><button class="btn-small" onclick="moveQ(${i},1)">↓</button><button class="btn-small" onclick="delQ(${i})">Delete</button></div>
      <label>Question text</label><input value="${esc(q.label)}" oninput="config.applicationTypes[${ti}].questions[${i}].label=this.value">
      <div class="row"><select onchange="config.applicationTypes[${ti}].questions[${i}].type=this.value">${['text','number','textarea','select'].map(x=>`<option ${q.type===x?'selected':''} value="${x}">${x}</option>`).join('')}</select>
      <input placeholder="Placeholder help text" value="${esc(q.placeholder||'')}" oninput="config.applicationTypes[${ti}].questions[${i}].placeholder=this.value"></div>
      <label>Options (for dropdown only, comma separated)</label><input value="${esc(q.options||'')}" oninput="config.applicationTypes[${ti}].questions[${i}].options=this.value">
      <label style="font-size:13px"><input type="checkbox" ${q.required?'checked':''} style="width:auto" onchange="config.applicationTypes[${ti}].questions[${i}].required=this.checked"> Required</label>`;
    w.appendChild(d);
  });
}
function addQuestion(){ qType().questions.push({id:'q'+Date.now(),label:'New Question',type:'text',placeholder:'',required:true,options:''}); renderQEditor(); }
function delQ(i){ if(!confirm('Delete this question?')) return; qType().questions.splice(i,1); renderQEditor(); }
function moveQ(i,dir){ const qs=qType().questions; const j=i+dir; if(j<0||j>=qs.length) return; const t2=qs[i]; qs[i]=qs[j]; qs[j]=t2; renderQEditor(); }
function insertInline(where){
  if(!inlineDataUrl){ alert('Upload a picture first.'); return; }
  const tag=`<br><img src="${inlineDataUrl}" style="max-width:100%;border-radius:12px;"><br>`;
  $(where==='top'?'e_top':'e_bottom').value+=tag;
  inlineDataUrl=''; $('p_inline').style.display='none';
  alert('Inserted! Hit Save All Changes to publish.');
}
async function saveConfig(){
  config.title=$('e_title').value||'Wigglesworth — Join the Team';
  config.subtitle=$('e_subtitle').value;
  config.announcement=$('e_announce').value;
  config.showApproved=$('e_showApproved').checked;
  config.approvedTitle=$('e_approvedTitle').value;
  config.accent=$('e_accent').value;
  config.bg=$('e_bg').value;
  const bu=$('e_bannerUrl').value.trim(); if(bu) config.bannerImage=bu;
  const lu=$('e_logoUrl').value.trim(); if(lu) config.logoImage=lu;
  const gu=$('e_bgUrl').value.trim(); if(gu) config.backgroundImage=gu;
  config.rules=$('e_rules').value;
  config.topText=$('e_top').value;
  config.bottomText=$('e_bottom').value;
  const nc=$('e_code').value.trim();
  if(!nc){ alert('Edit code cannot be empty'); return; }
  config.editCode=nc;
  const r = await fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config)});
  if(r.status===401){ alert('Edit code changed or wrong — unlock again.'); lockEditor(); return; }
  if(!r.ok){ alert('Save failed.'); return; }
  editCode = nc; sessionStorage.setItem('mod_edit_code', nc);
  applyConfig(); alert('Saved! Visible on phone + computer instantly.');
}
async function resetConfig(){
  if(!confirm('Reset to default?')) return;
  await fetch('/api/admin/reset',{method:'POST',headers:headers()});
  await fetchConfig();
}
function syncAppTypeFilter(){
  const s=$('appTypeFilter'); const keep=s.value;
  s.innerHTML='<option value="">All roles</option>';
  config.applicationTypes.forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; s.appendChild(o); });
  s.value=keep;
}
async function renderSubs(){
  const q=($('appSearch').value||'').toLowerCase();
  const f=$('appFilter').value, tf=$('appTypeFilter').value;
  const r = await fetch('/api/admin/applications',{headers:{'x-edit-code':editCode}});
  if(r.status===401){ $('subs').innerHTML='<p class="hint">Wrong code — lock and unlock again.</p>'; return; }
  let subs = await r.json();
  adminCache = subs;
  $('subCount').textContent=subs.length;
  const w=$('subs'); w.innerHTML = subs.length?'':'<p class="hint">No submissions yet.</p>';
  const qmap = {};
  config.applicationTypes.forEach(t=>t.questions.forEach(x=>{ qmap[t.id+':'+x.id]=x.label; }));
  subs.filter(s=>{
    if(f && s.status!==f) return false;
    if(tf && s.type!==tf) return false;
    if(q && !JSON.stringify(s).toLowerCase().includes(q)) return false;
    return true;
  }).forEach(s=>{
    const d=document.createElement('div'); d.className='submission';
    let html=`<b>${esc(s.appId||'')}</b> <span class="hint">${esc(typeName(s.type))}</span> <span class="status ${s.status}">${(s.status||'pending').toUpperCase()}</span><br><span class="hint">${esc(s.date||'')}</span><br><br>`;
    Object.keys(s).forEach(k=>{
      if(['appId','type','date','status','adminNote'].includes(k)) return;
      html+=`<b>${esc(qmap[s.type+':'+k]||k)}:</b> ${esc(s[k]||'-')}<br>`;
    });
    html+=`<label>Staff note (seen by applicant):</label><input value="${esc(s.adminNote||'')}" id="note_${esc(s.appId)}" placeholder="e.g. Great app, welcome!">`;
    d.innerHTML=html;
    const bar=document.createElement('div'); bar.className='row';
    const mk=(t3,cls,fn)=>{ const b=document.createElement('button'); b.className=cls; b.textContent=t3; b.onclick=fn; return b; };
    bar.append(
      mk('Approve','btn-approve',()=>setStatus(s.appId,'approved')),
      mk('Deny','btn-deny',()=>setStatus(s.appId,'denied')),
      mk('Pending','btn-pending',()=>setStatus(s.appId,'pending')),
      mk('Save note','btn-small',async()=>{
        const note=document.getElementById('note_'+s.appId).value;
        await fetch('/api/admin/applications/'+s.appId+'/status',{method:'POST',headers:headers(),body:JSON.stringify({adminNote:note})});
        renderSubs();
      }),
      mk('Delete','btn-small',()=>delSub(s.appId))
    );
    d.appendChild(bar); w.appendChild(d);
  });
}
async function setStatus(appId,st){
  const noteEl = document.getElementById('note_'+appId);
  await fetch('/api/admin/applications/'+appId+'/status',{method:'POST',headers:headers(),body:JSON.stringify({status:st, adminNote: noteEl?noteEl.value:undefined})});
  renderSubs(); renderApprovedPublic();
}
async function delSub(appId){
  if(!confirm('Delete '+appId+'?')) return;
  await fetch('/api/admin/applications/'+appId,{method:'DELETE',headers:{'x-edit-code':editCode}});
  renderSubs(); renderApprovedPublic();
}
async function clearSubs(){
  if(!confirm('Delete ALL submissions?')) return;
  await fetch('/api/admin/applications',{method:'DELETE',headers:{'x-edit-code':editCode}});
  renderSubs(); renderApprovedPublic();
}
function exportCSV(){
  if(!adminCache.length){ alert('No submissions (unlock editor first)'); return; }
  const keySet=['appId','type','date','status','adminNote'];
  adminCache.forEach(s=>Object.keys(s).forEach(k=>{ if(!keySet.includes(k)) keySet.push(k); }));
  const rows=[keySet.join(',')].concat(adminCache.map(s=>keySet.map(h=>`"${(s[h]||'').toString().replace(/"/g,'""')}"`).join(',')));
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([rows.join('\n')],{type:'text/csv'}));
  a.download='wigglesworth-applications.csv'; a.click();
}

// ---- floating decor ----
function renderDecor(){
  const layer=$('stickerLayer'); layer.innerHTML='';
  (config.decor||[]).forEach(d=>{
    const el=document.createElement('div');
    el.className='sticker'+(unlocked?' editable':'')+(selectedDecor===d.id?' selected':'');
    el.dataset.id=d.id;
    el.style.left=(d.x??80)+'%'; el.style.top=(d.y??20)+'%';
    el.style.width=(d.w||160)+'px';
    el.style.transform=`rotate(${d.r||0}deg)`;
    el.style.zIndex=d.z||5; el.style.opacity=d.o??1;
    if(d.kind==='text'){
      const t=document.createElement('div'); t.className='txt';
      t.textContent=d.text||'Hello!'; t.style.color=d.color||'#fff'; t.style.fontSize=(d.fontSize||28)+'px';
      el.appendChild(t);
    } else {
      const im=document.createElement('img'); im.src=d.src; im.draggable=false; el.appendChild(im);
    }
    if(unlocked){
      el.addEventListener('pointerdown',e=>startDrag(e,d.id));
      el.addEventListener('click',e=>{ e.stopPropagation(); selectedDecor=d.id; renderDecor(); renderDecorList(); });
    }
    layer.appendChild(el);
  });
  renderDecorList();
}
function startDrag(e,id){
  e.preventDefault(); e.stopPropagation();
  selectedDecor=id;
  const d=config.decor.find(x=>x.id===id); if(!d) return;
  renderDecorList();
  document.querySelectorAll('.sticker').forEach(s=>s.classList.toggle('selected',s.dataset.id==String(id)));
  dragState={id,sx:e.clientX,sy:e.clientY,ox:d.x,oy:d.y};
  window.addEventListener('pointermove',onDragMove);
  window.addEventListener('pointerup',onDragEnd,{once:true});
}
function onDragMove(e){
  if(!dragState) return;
  const d=config.decor.find(x=>x.id===dragState.id); if(!d) return;
  d.x=Math.min(95,Math.max(-5,dragState.ox+(e.clientX-dragState.sx)/window.innerWidth*100));
  d.y=Math.min(98,Math.max(0,dragState.oy+(e.clientY-dragState.sy)/window.innerHeight*100));
  const el=document.querySelector(`.sticker[data-id="${CSS.escape(String(d.id))}"]`);
  if(el){ el.style.left=d.x+'%'; el.style.top=d.y+'%'; }
}
async function onDragEnd(){
  window.removeEventListener('pointermove',onDragMove);
  dragState=null;
  await saveDecorQuiet();
}
async function saveDecorQuiet(){
  await fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config)});
}
function addUrlSticker(){
  const v=$('e_decorUrl').value.trim();
  if(!v){ alert('Paste an image link first'); return; }
  config.decor.push({id:Date.now(),kind:'img',src:v,x:70,y:20,w:180,r:0,o:1,z:5});
  $('e_decorUrl').value='';
  renderDecor();
}
function addTextSticker(){
  const t=prompt('Text for floating sticker:','Wigglesworth!')||'Hello!';
  config.decor.push({id:Date.now(),kind:'text',text:t,color:'#ffffff',fontSize:32,x:70,y:30,w:220,r:-8,o:1,z:5});
  renderDecor();
}
function delDecor(id){ if(!confirm('Remove this decor?')) return; config.decor=config.decor.filter(d=>d.id!==id); if(selectedDecor===id) selectedDecor=null; renderDecor(); }
function renderDecorList(){
  const w=$('decorList'); if(!w) return;
  if(!config.decor.length){ w.innerHTML='<p class="hint">No floating items yet.</p>'; return; }
  w.innerHTML='';
  config.decor.forEach(d=>{
    const div=document.createElement('div'); div.className='decor-item';
    const title=d.kind==='text'?(d.text||'text').slice(0,24):'Picture';
    div.innerHTML=`<b>${esc(title)}</b> ${selectedDecor===d.id?'(selected — drag it on page)':''}<br>
      <span class="hint">Size</span><input type="range" min="30" max="600" value="${d.w||160}" oninput="decorSet(${d.id},'w',+this.value)">
      <span class="hint">Rotate: <span id="rv_${d.id}">${d.r||0}</span>°</span><input type="range" min="-180" max="180" value="${d.r||0}" oninput="decorSet(${d.id},'r',+this.value);document.getElementById('rv_${d.id}').textContent=this.value">
      <span class="hint">Opacity</span><input type="range" min="20" max="100" value="${Math.round((d.o??1)*100)}" oninput="decorSet(${d.id},'o',this.value/100)">`+
      (d.kind==='text'?`<input value="${esc(d.text||'')}" oninput="decorText(${d.id},this.value)" placeholder="Sticker text"><div class="row"><input type="color" value="${d.color||'#ffffff'}" onchange="decorSet(${d.id},'color',this.value)" style="flex:1"><input type="number" min="12" max="120" value="${d.fontSize||28}" onchange="decorSet(${d.id},'fontSize',+this.value)" style="flex:1"></div>`:'')+
      `<div class="row"><button class="btn-small" onclick="decorFront(${d.id})">Bring forward</button><button class="btn-small" onclick="delDecor(${d.id})">Delete</button></div>`;
    w.appendChild(div);
  });
}
function decorSet(id,k,v){ const d=config.decor.find(x=>x.id===id); if(!d) return; d[k]=v; renderDecor(); clearTimeout(window.__dt); window.__dt=setTimeout(saveDecorQuiet,600); }
function decorText(id,v){ const d=config.decor.find(x=>x.id===id); if(!d) return; d.text=v; renderDecor(); clearTimeout(window.__dt); window.__dt=setTimeout(saveDecorQuiet,600); }
function decorFront(id){ const d=config.decor.find(x=>x.id===id); if(!d) return; const m=Math.max(5,...config.decor.map(x=>x.z||5)); d.z=m+1; renderDecor(); }

window.addEventListener('DOMContentLoaded', ()=>{
  fetchConfig();
  $('codeInput').addEventListener('keydown',e=>{ if(e.key==='Enter') checkCode(); });
  $('statusInput').addEventListener('keydown',e=>{ if(e.key==='Enter') checkStatus(); });
  ['e_bannerFile','e_logoFile','e_bgFile','e_inlineFile'].forEach(id=>{
    $(id)?.addEventListener('change',e=>{
      const f=e.target.files[0]; if(!f) return;
      fileToDataUrl(f,url=>{
        if(id==='e_bannerFile') config.bannerImage=url;
        else if(id==='e_logoFile') config.logoImage=url;
        else if(id==='e_bgFile') config.backgroundImage=url;
        else { inlineDataUrl=url; $('p_inline').src=url; $('p_inline').style.display='block'; return; }
        syncImgPreviews();
      });
    });
  });
  $('e_decorFile')?.addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    fileToDataUrl(f,url=>{ config.decor.push({id:Date.now(),kind:'img',src:url,x:65,y:25,w:200,r:0,o:1,z:5}); e.target.value=''; renderDecor(); alert('Added! Now drag it anywhere.'); });
  });
  ['e_bannerUrl','e_logoUrl','e_bgUrl'].forEach(id=>{
    $(id)?.addEventListener('input',e=>{
      const v=e.target.value.trim(); if(!v) return;
      if(id==='e_bannerUrl') config.bannerImage=v;
      if(id==='e_logoUrl') config.logoImage=v;
      if(id==='e_bgUrl') config.backgroundImage=v;
      syncImgPreviews();
    });
  });
});
