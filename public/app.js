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
  if(!Array.isArray(config.faq)) config.faq = [];
  if(!Array.isArray(config.applicationTypes) || !config.applicationTypes.length) location.reload();
  if(!currentTypeId || !config.applicationTypes.some(t=>t.id===currentTypeId))
    currentTypeId = config.applicationTypes.some(t=>t.id==='moderator') ? 'moderator' : config.applicationTypes[0].id;
  applyConfig();
}
function applyConfig(){
  document.documentElement.style.setProperty('--amber', config.accent || '#6cb8f0');
  document.body.style.backgroundColor = config.bg || '';
  document.body.style.backgroundImage = config.backgroundImage ? `url("${config.backgroundImage}")` : '';
  document.body.style.backgroundSize = config.backgroundImage ? 'cover' : '';
  document.body.style.backgroundAttachment = 'fixed';
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
  renderCountdown(); renderFaq(); renderTypeCards(); renderApprovedPublic(); renderDecor(); applyLayout();
  if (curType() && $('applyCard').style.display === 'block') fillRoleHeader(curType());
  if(unlocked) showEditor(false);
}
function renderFaq(){
  const card = $('faq'), list = $('faqList');
  const items = (config.faq || []).filter(f => f.q || f.a);
  if(!items.length){ card.style.display = 'none'; return; }
  card.style.display = 'block'; list.innerHTML = '';
  items.forEach(f=>{
    const d = document.createElement('div'); d.className = 'faq-item';
    const b = document.createElement('b'); b.textContent = f.q;
    const br = document.createElement('br');
    const s = document.createElement('span'); s.textContent = f.a;
    d.append(b, br, s); list.appendChild(d);
  });
}
function renderFaqEditor(){
  const w = $('faqEditor'); w.innerHTML = '';
  (config.faq || []).forEach((f, i)=>{
    const d = document.createElement('div'); d.className = 'q-item';
    d.innerHTML = `<strong>F${i + 1}</strong>
      <div class="row"><button class="btn-small" onclick="delFaq(${i})">Delete</button></div>
      <label>Question</label><input value="${esc(f.q)}" oninput="config.faq[${i}].q=this.value">
      <label>Answer</label><textarea rows="2" oninput="config.faq[${i}].a=this.value">${esc(f.a)}</textarea>`;
    w.appendChild(d);
  });
}
function addFaq(){ config.faq.push({ q: 'New question?', a: '' }); markDirty(); renderFaqEditor(); }
function delFaq(i){ if(!confirm('Delete this FAQ item?')) return; config.faq.splice(i, 1); markDirty(); renderFaqEditor(); }
let cdTimer = null;
function isoToLocal(iso){
  const d = new Date(iso); if(isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function localToIso(v){ const d = new Date(v); return isNaN(d) ? '' : d.toISOString(); }
function renderCountdown(){
  const c = config.countdown || {};
  const card = $('countCard');
  const t = Date.parse(c.target || '');
  if(!c.show || !t){ card.style.display = 'none'; if(cdTimer){ clearInterval(cdTimer); cdTimer = null; } return; }
  card.style.display = 'block';
  $('cdTitle').textContent = c.title || 'Update drops in';
  const pad = n => String(n).padStart(2, '0');
  const tick = ()=>{
    let ms = t - Date.now();
    if(ms <= 0){
      $('cdD').textContent = $('cdH').textContent = $('cdM').textContent = $('cdS').textContent = '0';
      $('cdNote').textContent = 'The update is live!';
      if(cdTimer){ clearInterval(cdTimer); cdTimer = null; }
      return;
    }
    $('cdD').textContent = Math.floor(ms / 86400000);
    $('cdH').textContent = pad(Math.floor(ms / 3600000) % 24);
    $('cdM').textContent = pad(Math.floor(ms / 60000) % 60);
    $('cdS').textContent = pad(Math.floor(ms / 1000) % 60);
    $('cdNote').textContent = 'Until ' + new Date(t).toLocaleString();
  };
  tick();
  if(cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(tick, 1000);
}
function renderTypeCards(){
  const w = $('roleCards'); w.innerHTML = '';
  config.applicationTypes.forEach(t=>{
    const b = document.createElement('button');
    const closed = t.open === false;
    b.className = 'role-card'; b.onclick = ()=>pickType(t.id);
    b.innerHTML = `<span class="tick">${closed ? 'Closed' : esc(t.prefix||'APP')}</span><span><h4>${esc(t.name)} Applications</h4><p>${closed ? 'Not accepting applications right now.' : esc(t.blurb||'')}</p></span><span class="go">→</span>`;
    if(closed) b.style.opacity = '.55';
    w.appendChild(b);
  });
}
function toggleApplyMenu(){
  const m = $('roleMenu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
  if (m.style.display === 'block') renderTypeCards();
}
function pickType(id, noScroll){
  currentTypeId = id;
  const t = curType();
  if(t.open === false){ alert(t.name + ' applications are currently closed.'); return; }
  $('roleMenu').style.display = 'none';
  $('applyCard').style.display = 'block';
  fillRoleHeader(t); renderForm();
  if(!noScroll) $('applyCard').scrollIntoView({ behavior:'smooth', block:'start' });
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
    $('successMsg').textContent = j.successMessage || t.successMessage || '';
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
      const d=document.createElement('div'); d.textContent=s.username; list.appendChild(d);
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
  $('e_cdShow').checked=!!(config.countdown && config.countdown.show);
  $('e_cdTitle').value=(config.countdown && config.countdown.title)||'';
  $('e_cdTarget').value=isoToLocal(config.countdown && config.countdown.target);
  $('e_cdVideo').value=(config.countdown && config.countdown.endVideo)||'';
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
  syncImgPreviews(); renderTypeEditor(); syncQType(); renderQEditor(); renderFaqEditor(); renderDecor(); renderDecorList();
  syncAppTypeFilter();
  editorDirty = false;
  if(refetch){ renderSubs(); renderTickets(); }
}
async function lockEditor(){
  if(unlocked && editorDirty){
    try{
      collectEditor();
      const r = await fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config)});
      if(!r.ok) throw 0;
      editCode = config.editCode; sessionStorage.setItem('mod_edit_code', config.editCode);
      editorDirty = false;
    }catch{ alert('Auto-save failed — check connection, then lock again.'); return; }
  }
  unlocked=false; editCode=''; sessionStorage.removeItem('mod_edit_code'); selectedDecor=null; designOn=false;
  document.body.classList.remove('design-on');
  $('editor').style.display='none'; renderDecor();
}
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
      <label style="font-size:13px"><input type="checkbox" ${t.showApproved!==false?'checked':''} style="width:auto" onchange="edType(${i}).showApproved=this.checked"> Show in public Accepted list</label>
      <label style="font-size:13px"><input type="checkbox" ${t.open!==false?'checked':''} style="width:auto" onchange="edType(${i}).open=this.checked"> Accepting applications (untick to close this role)</label>`;
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
function addQuestion(){ qType().questions.push({id:'q'+Date.now(),label:'New Question',type:'text',placeholder:'',required:true,options:''}); markDirty(); renderQEditor(); }
function delQ(i){ if(!confirm('Delete this question?')) return; qType().questions.splice(i,1); markDirty(); renderQEditor(); }
function moveQ(i,dir){ const qs=qType().questions; const j=i+dir; if(j<0||j>=qs.length) return; const t2=qs[i]; qs[i]=qs[j]; qs[j]=t2; markDirty(); renderQEditor(); }
function insertInline(where){
  if(!inlineDataUrl){ alert('Upload a picture first.'); return; }
  const tag=`<br><img src="${inlineDataUrl}" style="max-width:100%;border-radius:12px;"><br>`;
  $(where==='top'?'e_top':'e_bottom').value+=tag;
  inlineDataUrl=''; $('p_inline').style.display='none';
  alert('Inserted! Hit Save All Changes to publish.');
}
let editorDirty = false;
function markDirty(){ editorDirty = true; }
function collectEditor(){
  config.title = $('e_title').value || config.title;
  config.subtitle = $('e_subtitle').value;
  config.announcement = $('e_announce').value;
  config.countdown = Object.assign({}, config.countdown, {
    show: $('e_cdShow').checked,
    title: $('e_cdTitle').value,
    target: localToIso($('e_cdTarget').value),
    endVideo: $('e_cdVideo').value.trim(),
  });
  config.showApproved = $('e_showApproved').checked;
  config.approvedTitle = $('e_approvedTitle').value;
  config.accent = $('e_accent').value;
  config.bg = $('e_bg').value;
  const bu = $('e_bannerUrl').value.trim(); if(bu) config.bannerImage = bu;
  const lu = $('e_logoUrl').value.trim(); if(lu) config.logoImage = lu;
  const gu = $('e_bgUrl').value.trim(); if(gu) config.backgroundImage = gu;
  config.rules = $('e_rules').value;
  config.topText = $('e_top').value;
  config.bottomText = $('e_bottom').value;
  const nc = $('e_code').value.trim();
  if(nc) config.editCode = nc;
}
async function saveConfig(){
  collectEditor();
  if(!config.editCode){ alert('Edit code cannot be empty'); return; }
  const r = await fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config)});
  if(r.status===401){ alert('Edit code changed or wrong — unlock again.'); lockEditor(); return; }
  if(!r.ok){ alert('Save failed.'); return; }
  editCode = config.editCode; sessionStorage.setItem('mod_edit_code', config.editCode);
  editorDirty = false;
  await fetchConfig();
  const check = config.applicationTypes.map(t=>t.id+':'+(t.open!==false?'open':'closed')).join(', ');
  alert('Saved and verified live! (' + check + ')');
}
async function resetConfig(){
  if(!confirm('Reset to default?')) return;
  await fetch('/api/admin/reset',{method:'POST',headers:headers()});
  editorDirty = false;
  await fetchConfig();
}
function syncAppTypeFilter(){
  const s=$('appTypeFilter'); const keep=s.value;
  s.innerHTML='<option value="">All roles</option>';
  config.applicationTypes.forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; s.appendChild(o); });
  s.value=keep;
}
async function renderAudit(){
  try{
    const r = await fetch('/api/admin/audit',{headers:{'x-edit-code':editCode}});
    if(!r.ok) return;
    const log = await r.json();
    const w = $('auditLog');
    if(!log.length){ w.innerHTML=''; return; }
    w.innerHTML = '<div class="hint" style="margin-bottom:4px">Security log — latest staff actions:</div>' +
      log.slice(0,8).map(e=>`<div class="hint">· ${esc(e.t||'').slice(0,16).replace('T',' ')} — ${esc(e.act)}${e.id?' '+esc(e.id):''}</div>`).join('');
  }catch{}
}
async function renderSubs(){
  const q=($('appSearch').value||'').toLowerCase();
  const f=$('appFilter').value, tf=$('appTypeFilter').value;
  const r = await fetch('/api/admin/applications',{headers:{'x-edit-code':editCode}});
  if(r.status===401){ $('subs').innerHTML='<p class="hint">Wrong code — lock and unlock again.</p>'; return; }
  let subs = await r.json();
  adminCache = subs;
  renderAudit();
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
async function backupAll(){
  const r = await fetch('/api/admin/backup',{headers:{'x-edit-code':editCode}});
  if(!r.ok){ alert('Backup failed — unlock again.'); return; }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([await r.text()],{type:'application/json'}));
  a.download='wigglesworth-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  alert('Backup downloaded. Keep it — one click restores everything if the free host ever wipes.');
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

// ---- private tickets ----
let currentTicket = null;
let selectedTicketId = null;
let ticketAdminCache = [];
function threadHTML(t, staffMode){
  let h = `<div class="thread">`;
  (t.replies || []).forEach(m=>{
    h += `<div class="msg msg-${m.by==='staff'?'staff':'user'}"><span class="who">${esc(m.by==='staff'?'STAFF':(m.name||'YOU'))} · ${esc((m.at||'').slice(0,16).replace('T',' '))}</span>${esc(m.text)}</div>`;
  });
  return h + `</div>`;
}
async function submitTicket(e){
  e.preventDefault();
  const body = { name: $('t_name').value.trim(), subject: $('t_subject').value.trim(), message: $('t_message').value.trim() };
  if(!body.name || !body.subject || body.message.length < 10){ alert('Fill name, subject, and a message (10+ characters).'); return false; }
  const btn = e.target.querySelector('button[type=submit]');
  if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  try{
    const r = await fetch('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j = await r.json();
    if(!r.ok) throw new Error(j.error||'Failed');
    $('ticketForm').style.display='none';
    $('ticketCreated').style.display='block';
    $('newTicketId').textContent = j.id;
  }catch(err){ alert(err.message); }
  finally{ if(btn){ btn.disabled = false; btn.textContent = 'Open ticket'; } }
  return false;
}
function resetTicketForm(){ $('ticketForm').reset(); $('ticketForm').style.display='block'; $('ticketCreated').style.display='none'; }
function copyTicketId(){ const t=$('newTicketId').textContent; navigator.clipboard?.writeText(t); alert('Copied: '+t); }
async function checkTicket(){
  const id = $('ticketInput').value.trim().toUpperCase();
  const box = $('ticketResult'); box.innerHTML='';
  if(!id) return;
  try{
    const r = await fetch('/api/tickets/'+encodeURIComponent(id));
    if(!r.ok) throw 0;
    currentTicket = await r.json();
    renderUserThread();
  }catch{ box.innerHTML='<div class="status-box pending">No ticket found for <b>'+esc(id)+'</b></div>'; }
}
function renderUserThread(){
  const box = $('ticketResult');
  const t = currentTicket;
  const closed = t.status !== 'open';
  box.innerHTML = `<div class="status-box ${closed?'denied':'pending'}" style="margin-top:12px"><b>${esc(t.id)}</b> · ${esc(t.subject)} — <span class="status ${closed?'denied':'pending'}">${closed?'CLOSED':'OPEN'}</span></div>`
    + threadHTML(t,false)
    + (closed ? '<p class="hint">This ticket is closed. Open a new one if you need more help.</p>'
      : `<label>Reply</label><textarea id="t_reply" rows="3" placeholder="Write back…"></textarea><div class="row"><button class="btn-confirm" onclick="userReply()">Send reply</button></div>`);
}
async function userReply(){
  const text = $('t_reply').value.trim();
  if(!text) return;
  const r = await fetch('/api/tickets/'+currentTicket.id+'/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
  const j = await r.json();
  if(!r.ok){ alert(j.error||'Failed'); return; }
  const t2 = await (await fetch('/api/tickets/'+currentTicket.id)).json();
  currentTicket = t2; renderUserThread();
}
async function renderTickets(){
  const q=($('ticketSearch').value||'').toLowerCase();
  const f=$('ticketFilter').value;
  const r = await fetch('/api/admin/tickets',{headers:{'x-edit-code':editCode}});
  if(r.status===401){ $('ticketList').innerHTML='<p class="hint">Wrong code — lock and unlock again.</p>'; return; }
  ticketAdminCache = await r.json();
  const unread = ticketAdminCache.filter(t=>t.unread && t.status==='open').length;
  $('ticketBadge').textContent = unread || '';
  $('ticketCount').textContent = ticketAdminCache.length;
  const w = $('ticketList'); w.innerHTML = ticketAdminCache.length?'':'<p class="hint">No tickets yet.</p>';
  ticketAdminCache.filter(t=>{
    if(f==='open' && t.status!=='open') return false;
    if(f==='closed' && t.status!=='closed') return false;
    if(f==='unread' && !(t.unread && t.status==='open')) return false;
    if(q && !JSON.stringify(t).toLowerCase().includes(q)) return false;
    return true;
  }).forEach(t=>{
    const b=document.createElement('button'); b.className='ticket-row';
    b.innerHTML=`<b>${esc(t.id)}</b>${t.unread&&t.status==='open'?' <span class="status pending">NEW</span>':''}<span style="flex:1"><b>${esc(t.subject)}</b><br><span class="hint">${esc(t.name)} · ${esc((t.updatedAt||'').slice(0,16).replace('T',' '))} · ${t.replies.length} msg</span></span><span class="status ${t.status==='open'?'pending':'denied'}">${t.status.toUpperCase()}</span>`;
    b.onclick=()=>{ selectedTicketId=t.id; renderTicketThread(); };
    w.appendChild(b);
  });
  if(selectedTicketId) renderTicketThread();
}
function renderTicketThread(){
  const box = $('ticketThread');
  const t = ticketAdminCache.find(x=>x.id===selectedTicketId);
  if(!t){ box.innerHTML=''; return; }
  const closed = t.status!=='open';
  box.innerHTML = `<div class="submission"><b>${esc(t.id)}</b> — ${esc(t.subject)} <span class="hint">from ${esc(t.name)} · ${esc(t.createdAt||'')}</span> <span class="status ${closed?'denied':'pending'}">${t.status.toUpperCase()}</span></div>`
    + threadHTML(t,true)
    + `<label>Reply as staff${closed?' (reopens the ticket)':''}</label><textarea id="t_staffReply" rows="3"></textarea>
    <div class="row"><button class="btn-confirm" onclick="staffReply()">Send</button>
    ${closed?`<button class="btn-small" onclick="setTicketStatus('${t.id}','open')">Reopen</button>`:`<button class="btn-small" onclick="setTicketStatus('${t.id}','closed')">Close</button>`}
    <button class="btn-small" onclick="delTicket('${t.id}')">Delete</button></div>`;
}
async function staffReply(){
  const text = $('t_staffReply').value.trim();
  if(!text) return;
  const t = ticketAdminCache.find(x=>x.id===selectedTicketId);
  await fetch('/api/tickets/'+t.id+'/reply',{method:'POST',headers:headers(),body:JSON.stringify({text, staff:true})});
  if(t.status!=='open') await fetch('/api/admin/tickets/'+t.id+'/status',{method:'POST',headers:headers(),body:JSON.stringify({status:'open'})});
  await renderTickets();
}
async function setTicketStatus(id,st){
  await fetch('/api/admin/tickets/'+id+'/status',{method:'POST',headers:headers(),body:JSON.stringify({status:st})});
  renderTickets();
}
async function delTicket(id){
  if(!confirm('Delete '+id+' and its whole thread?')) return;
  await fetch('/api/admin/tickets/'+id,{method:'DELETE',headers:{'x-edit-code':editCode}});
  if(selectedTicketId===id) selectedTicketId=null;
  renderTickets();
}

// ---- canva-lite visual editor ----
const DREG = {
  heroEyebrow:{label:'Hero eyebrow',text:true},
  appTitle:{label:'Main title',config:'title'},
  appSubtitle:{label:'Subtitle',config:'subtitle'},
  handNote:{label:'Handwritten note'},
  applyBtn:{label:'Apply button',text:true},
  heroHint:{label:'Hero hint',text:true},
  stat0:{label:'Stat chip 1',text:true},
  stat1:{label:'Stat chip 2',text:true},
  stat2:{label:'Stat chip 3',text:true},
  statusEyebrow:{label:'Decision eyebrow',text:true},
  statusTitle:{label:'Decision heading',text:true},
  acceptedEyebrow:{label:'Accepted eyebrow',text:true},
  acceptedTitle:{label:'Accepted heading',tab:'general',field:'e_approvedTitle'},
  contactEyebrow:{label:'Tickets eyebrow',text:true},
  contactTitle:{label:'Tickets heading',text:true},
  faqEyebrow:{label:'FAQ eyebrow',text:true},
  faqTitle:{label:'FAQ heading',text:true},
  foot:{label:'Footer'},
  topText:{label:'Top text',tab:'texts',field:'e_top'},
  bottomText:{label:'Bottom text',tab:'texts',field:'e_bottom'},
  appRules:{label:'Rules box',tab:'texts',field:'e_rules'},
  announceBar:{label:'Announcement',tab:'general',field:'e_announce'},
};
let designOn=false, selectedKey=null, dragInfo=null, editingEl=false;
function dEl(key){ try{ return document.querySelector('[data-dkey="'+CSS.escape(key)+'"]'); }catch{ return null; } }
function layoutOf(key){ return (config.layout && config.layout[key]) || {}; }
async function persistConfigQuiet(){
  await fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config)});
}
function toggleDesign(){
  if(!unlocked) return;
  designOn=!designOn;
  document.body.classList.toggle('design-on',designOn);
  $('designToggle').textContent='Select & move on page: '+(designOn?'ON':'OFF');
  if(!designOn) dSelect(null);
}
document.addEventListener('pointerdown', e=>{
  if(!designOn || !unlocked || editingEl) return;
  if(e.target.closest('#dtoolbar') || e.target.closest('#editor') || e.target.closest('.modal')) return;
  const t = e.target.closest('[data-dkey]');
  if(!t || !DREG[t.getAttribute('data-dkey')]) return;
  e.preventDefault();
  dSelect(t.getAttribute('data-dkey'));
  dragInfo = { key: t.getAttribute('data-dkey'), sx: e.clientX, sy: e.clientY, moved: false, orig: layoutOf(t.getAttribute('data-dkey')) };
  window.addEventListener('pointermove', dDragMove);
  window.addEventListener('pointerup', dDragEnd, { once: true });
}, true);
function dTransform(L, dx, dy){
  const t = [];
  if(dx || dy) t.push('translate(' + (dx || 0) + 'px,' + (dy || 0) + 'px)');
  if(L.rot) t.push('rotate(' + L.rot + 'deg)');
  const sx = L.sx || 1, sy = L.sy || 1;
  if(sx !== 1 || sy !== 1) t.push('scale(' + sx + ',' + sy + ')');
  return t.join(' ');
}
function dDragMove(e){
  if(!dragInfo) return;
  const dx = e.clientX - dragInfo.sx, dy = e.clientY - dragInfo.sy;
  if(Math.abs(dx) + Math.abs(dy) > 4) dragInfo.moved = true;
  if(!dragInfo.moved) return;
  const el = dEl(dragInfo.key); if(!el) return;
  const o = Object.assign({ dx: 0, dy: 0 }, dragInfo.orig);
  el.style.transform = dTransform(dragInfo.orig, o.dx + dx, o.dy + dy);
  dragInfo.nx = o.dx + dx; dragInfo.ny = o.dy + dy;
}
function dDragEnd(){
  window.removeEventListener('pointermove', dDragMove);
  if(dragInfo && dragInfo.moved) setLayout(dragInfo.key, { dx: Math.round(dragInfo.nx), dy: Math.round(dragInfo.ny) });
  dragInfo = null;
}
function setLayout(key, patch){
  config.layout = config.layout || {};
  config.layout[key] = Object.assign({}, config.layout[key] || {}, patch);
  persistConfigQuiet(); renderLayoutList();
}
function applyLayout(){
  renderLayoutList();
  if(!config.layout) return;
  for(const key in config.layout){
    const el = dEl(key); if(!el || !DREG[key]) continue;
    const L = config.layout[key];
    if(L.hide){ el.style.display = 'none'; continue; }
    el.style.transform = dTransform(L, L.dx || 0, L.dy || 0);
    if(L.fs) el.style.fontSize = L.fs + 'px';
    if(L.text != null && el.children.length === 0) el.textContent = L.text;
  }
}
function dSelect(key){
  document.querySelectorAll('.dselected').forEach(s=>s.classList.remove('dselected'));
  selectedKey = key;
  const bar = $('dtoolbar');
  if(!key || !DREG[key]){ bar.style.display = 'none'; return; }
  const el = dEl(key);
  if(el) el.classList.add('dselected');
  $('dtName').textContent = DREG[key].label;
  $('dtEdit').style.display = (DREG[key].text || DREG[key].config) ? '' : 'none';
  $('dtTab').style.display = DREG[key].tab ? '' : 'none';
  const hidden = el && el.style.display === 'none';
  $('dtHide').textContent = hidden ? 'Unhide' : 'Hide';
  bar.style.display = 'flex';
}
function dEditText(){
  const def = DREG[selectedKey]; if(!def) return;
  if(def.tab){ dGotoTab(); return; }
  const el = dEl(selectedKey); if(!el) return;
  editingEl = true;
  el.contentEditable = 'true'; el.focus();
  try{ document.execCommand('selectAll', false, null); }catch{}
  el.onblur = ()=>{
    el.contentEditable = 'false'; el.onblur = null; editingEl = false;
    const v = el.textContent.trim();
    if(def.config){ config[def.config] = v; persistConfigQuiet(); }
    else {
      const cur = layoutOf(selectedKey);
      const patch = { text: v };
      if(cur.orig === undefined && cur.text === undefined) patch.orig = el.getAttribute('data-orig') || '';
      setLayout(selectedKey, patch);
    }
  };
  el.onkeydown = (e)=>{ if(e.key === 'Escape'){ el.contentEditable = 'false'; editingEl = false; applyLayout(); } };
}
function dSize(d){
  const el = dEl(selectedKey); if(!el) return;
  const cur = Math.round(parseFloat(getComputedStyle(el).fontSize) || 16);
  const fs = Math.min(96, Math.max(10, cur + d));
  el.style.fontSize = fs + 'px';
  setLayout(selectedKey, { fs });
}
function dRotate(d){
  const el = dEl(selectedKey); if(!el) return;
  const cur = layoutOf(selectedKey);
  let rot = ((cur.rot || 0) + d) % 360;
  el.style.transform = dTransform(Object.assign({}, cur, { rot }), cur.dx || 0, cur.dy || 0);
  setLayout(selectedKey, { rot });
}
function dScale(f){
  const el = dEl(selectedKey); if(!el) return;
  const cur = layoutOf(selectedKey);
  const cl = v => Math.min(3, Math.max(0.3, Math.round(v * 100) / 100));
  const patch = { sx: cl((cur.sx || 1) * f), sy: cl((cur.sy || 1) * f) };
  el.style.transform = dTransform(Object.assign({}, cur, patch), cur.dx || 0, cur.dy || 0);
  setLayout(selectedKey, patch);
}
function dStretch(axis, d){
  const el = dEl(selectedKey); if(!el) return;
  const cur = layoutOf(selectedKey);
  const k = axis === 'x' ? 'sx' : 'sy';
  const v = Math.min(4, Math.max(0.2, Math.round(((cur[k] || 1) + d) * 100) / 100));
  const patch = {}; patch[k] = v;
  el.style.transform = dTransform(Object.assign({}, cur, patch), cur.dx || 0, cur.dy || 0);
  setLayout(selectedKey, patch);
}
function dToggleHide(){
  const el = dEl(selectedKey); if(!el) return;
  config.layout = config.layout || {};
  if(el.style.display === 'none'){
    const cur = config.layout[selectedKey] || {};
    delete cur.hide;
    if(Object.keys(cur).length) config.layout[selectedKey] = cur;
    else delete config.layout[selectedKey];
    persistConfigQuiet(); renderLayoutList();
    el.style.display = '';
    applyLayout();
  } else {
    el.style.display = 'none';
    setLayout(selectedKey, { hide: true });
  }
  dSelect(null);
}
function dResetEl(){
  const key = selectedKey; if(!key) return;
  const el = dEl(key);
  const L = layoutOf(key);
  if(el){
    el.style.transform = ''; el.style.fontSize = ''; el.style.display = '';
    if(L.text != null && L.orig != null && el.children.length === 0) el.textContent = L.orig;
  }
  if(config.layout){ delete config.layout[key]; persistConfigQuiet(); renderLayoutList(); }
  dSelect(null);
}
function dGotoTab(){
  const def = DREG[selectedKey]; if(!def || !def.tab) return;
  const btn = document.querySelector('.tabs button[data-tab="' + def.tab + '"]');
  if(btn) switchTab(def.tab, btn);
  const f = $(def.field);
  if(f){ f.focus(); f.classList.add('dflash'); setTimeout(()=>f.classList.remove('dflash'), 1600); }
}
async function resetLayout(){
  if(!confirm('Reset every moved, resized and hidden item?')) return;
  config.layout = {};
  await persistConfigQuiet();
  location.reload();
}
function renderLayoutList(){
  const w = $('layoutList'); if(!w) return;
  const keys = config.layout ? Object.keys(config.layout) : [];
  if(!keys.length){ w.innerHTML = '<p class="hint">Nothing moved yet. Turn on design mode above and drag things.</p>'; return; }
  w.innerHTML = '';
  keys.forEach(k=>{
    const L = config.layout[k];
    const div = document.createElement('div'); div.className = 'decor-item';
    const parts = [];
    if(L.hide) parts.push('hidden');
    if(L.dx || L.dy) parts.push('moved');
    if(L.fs) parts.push(L.fs + 'px');
    if(L.rot) parts.push('rot ' + L.rot + '°');
    if((L.sx && L.sx !== 1) || (L.sy && L.sy !== 1)) parts.push('scale ' + (L.sx || 1) + '×' + (L.sy || 1));
    if(L.text != null) parts.push('reworded');
    div.innerHTML = '<b>' + esc((DREG[k] && DREG[k].label) || k) + '</b> <span class="hint">' + parts.join(' · ') + '</span>';
    const row = document.createElement('div'); row.className = 'row';
    const b1 = document.createElement('button'); b1.className = 'btn-small'; b1.textContent = 'Select';
    b1.onclick = ()=>{ dSelect(k); const el = dEl(k); if(el) el.scrollIntoView({ block: 'center' }); };
    const b2 = document.createElement('button'); b2.className = 'btn-small'; b2.textContent = 'Reset';
    b2.onclick = ()=>{ dSelect(k); dResetEl(); };
    row.append(b1, b2); div.appendChild(row); w.appendChild(div);
  });
}
// stash originals once so Reset can restore reworded text
document.addEventListener('pointerdown', e=>{
  if(!designOn || !unlocked) return;
  const t = e.target.closest && e.target.closest('[data-dkey]');
  if(!t) return;
  const k = t.getAttribute('data-dkey');
  if(!t.getAttribute('data-orig') && t.children.length === 0) t.setAttribute('data-orig', t.textContent);
}, true);

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

let pageReady = false, minTime = false;
function maybeOpenLoader(){ if(pageReady && minTime) openLoader(); }
function openLoader(){
  const l = document.getElementById('loader');
  if(!l || l.classList.contains('open')) return;
  l.classList.add('open');
  document.body.style.overflow = '';
  setTimeout(()=>{ l.style.display = 'none'; }, 1600);
}
setTimeout(()=>{ minTime = true; maybeOpenLoader(); }, 1700);
setTimeout(openLoader, 8000);
window.addEventListener('DOMContentLoaded', ()=>{
  document.body.style.overflow = 'hidden';
  $('editor').addEventListener('input', markDirty);
  $('editor').addEventListener('change', markDirty);
  window.addEventListener('beforeunload', e=>{
    if(unlocked && editorDirty){
      try{
        collectEditor();
        fetch('/api/admin/config',{method:'POST',headers:headers(),body:JSON.stringify(config),keepalive:true}).catch(()=>{});
      }catch{}
      e.preventDefault();
    }
  });
  fetchConfig().then(()=>{ pageReady = true; maybeOpenLoader(); })
    .catch(()=>{ pageReady = true; maybeOpenLoader(); });
  $('codeInput').addEventListener('keydown',e=>{ if(e.key==='Enter') checkCode(); });
  $('statusInput').addEventListener('keydown',e=>{ if(e.key==='Enter') checkStatus(); });
  $('ticketInput').addEventListener('keydown',e=>{ if(e.key==='Enter') checkTicket(); });
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
  $('restoreFile')?.addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=async ()=>{
      try{
        const r=await fetch('/api/admin/restore',{method:'POST',headers:headers(),body:rd.result});
        const j=await r.json();
        if(!r.ok) throw new Error(j.error||'Restore failed');
        e.target.value='';
        await fetchConfig();
        alert('Restored! '+j.submissions+' applications back.');
      }catch(err){ alert(err.message); }
    };
    rd.readAsText(f);
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
