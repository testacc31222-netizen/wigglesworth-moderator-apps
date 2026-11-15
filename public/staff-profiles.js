/* Public team cards and the existing authenticated workspace editor. */
window.StaffProfiles = (() => {
  const byId = id => document.getElementById(id);
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  function render() {
    const section = byId('team'), grid = byId('teamGrid');
    if (!section || !config) return;
    const members = (config.staffProfiles || []).filter(p => p.visible !== false);
    section.hidden = !members.length; grid.replaceChildren();
    members.forEach(p => {
      const card = node('article', '', 'team-card');
      if(p.featured) { card.classList.add('team-featured'); card.style.setProperty('--team-glow', /^#[0-9a-f]{6}$/i.test(p.glowColor || '') ? p.glowColor : '#99d8f5'); }
      if (p.photo) { const img = node('img', '', 'team-avatar'); img.src = p.photo; img.alt = ''; img.loading = 'lazy'; img.width = 92; img.height = 92; card.append(img); }
      else card.append(node('span', p.name.slice(0, 1).toUpperCase(), 'team-avatar'));
      card.append(node('h3', p.name), node('p', p.role, 'team-role'));
      if (p.bio) card.append(node('p', p.bio, 'team-bio'));
      const badges = node('div', '', 'team-badges');
      (p.badges || []).forEach(b => { const badge = node('span', '', 'team-badge'); if (b.image) { const img = node('img'); img.src = b.image; img.alt = ''; img.loading = 'lazy'; badge.append(img); } badge.append(document.createTextNode(b.label)); badges.append(badge); });
      card.append(badges);
      const more=node('button','View profile ↗','team-more'); more.type='button'; more.setAttribute('aria-label','View '+p.name+' profile'); more.onclick=()=>details(p,more); card.append(more);
      card.addEventListener('click',e=>{if(!e.target.closest('a,button')) details(p,more);});
      if (p.socials?.length) { const links = node('nav', '', 'team-socials'); links.setAttribute('aria-label', p.name + ' social links'); p.socials.forEach(s => { const a = node('a', s.label + ' ↗'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', p.name + ' on ' + s.label + ' (opens in new tab)'); links.append(a); }); card.append(links); }
      let frame = 0;
      card.addEventListener('pointermove', event => {
        if (!matchMedia('(hover:hover) and (pointer:fine)').matches || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
        const r = card.getBoundingClientRect(); cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { card.style.setProperty('--rx', (-(event.clientY-r.top-r.height/2)/r.height*8)+'deg'); card.style.setProperty('--ry', ((event.clientX-r.left-r.width/2)/r.width*8)+'deg'); });
      });
      card.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); card.style.setProperty('--rx','0deg'); card.style.setProperty('--ry','0deg'); });
      grid.append(card);
    });
  }
  function editor() {
    const list = byId('teamEditorList'); if (!list || !config) return;
    list.replaceChildren();
    (config.staffProfiles || []).forEach((p,i) => {
      const row = node('div', '', 'team-editor-row'); row.append(node('span', p.name + (p.visible === false ? ' · Hidden' : '')));
      const edit = node('button', 'Edit', 'btn-small'); edit.type = 'button'; edit.onclick = () => editProfile(p); row.append(edit); list.append(row);
      for(const [label,delta] of [['Move up',-1],['Move down',1]]) { const b=node('button',delta<0?'↑':'↓','btn-small'); b.type='button';b.setAttribute('aria-label',label+' '+p.name); b.disabled=i+delta<0 || i+delta>=config.staffProfiles.length; b.onclick=()=>move(p.id,delta); row.append(b); }
    });
    if (!list.children.length) list.append(node('p', 'No staff cards yet. Add your first profile below.', 'hint'));
  }
  let editing = 'new';
  async function move(id,delta) {
    const ids=config.staffProfiles.map(p=>p.id), i=ids.indexOf(id); [ids[i],ids[i+delta]]=[ids[i+delta],ids[i]];
    try { const r=await fetch('/api/admin/staff-profile-order',{method:'POST',headers:headers(),body:JSON.stringify({ids})});const j=await r.json();if(!r.ok)throw Error(j.error);config.staffProfiles=j.profiles;render();editor();byId('teamMessage').textContent='Profile order saved.'; } catch(e){byId('teamMessage').textContent=e.message;}
  }
  function details(p,trigger) {
    const dialog=node('dialog','','team-detail');dialog.setAttribute('aria-label',p.name+' profile');
    const close=node('button','Close ×','team-more');close.type='button';close.onclick=()=>dialog.close();dialog.append(close);
    if(p.photo){const img=node('img','','team-avatar');img.src=p.photo;img.alt='';dialog.append(img);}
    dialog.append(node('h2',p.name),node('p',p.role,'team-role'),node('p',p.details || p.bio || 'More about this team member is coming soon.','team-detail-copy'));
    const badges=node('div','','team-badges');(p.badges||[]).forEach(b=>{const el=node('span',b.label,'team-badge');if(b.image){const img=node('img');img.src=b.image;img.alt='';el.prepend(img);}badges.append(el);});dialog.append(badges);
    (p.socials||[]).forEach(s=>{const a=node('a',s.label+' ↗','team-more');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';dialog.append(a);});
    dialog.addEventListener('close',()=>{dialog.remove();if(trigger.isConnected)trigger.focus();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    document.body.append(dialog);dialog.showModal();close.focus();
  }
  let badgeDraft = [];
  function badgeEditor() {
    const list = byId('teamBadgeList'); list.replaceChildren();
    badgeDraft.forEach((badge, i) => {
      const row = node('div', '', 'team-badge-edit');
      if (badge.image) { const preview = node('img'); preview.src = badge.image; preview.alt = 'Badge preview'; row.append(preview); }
      const label = node('input'); label.value = badge.label; label.maxLength = 40; label.placeholder = 'Badge name'; label.setAttribute('aria-label','Badge '+(i+1)+' name'); label.oninput = () => badge.label = label.value;
      const file = node('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.setAttribute('aria-label','Choose image for badge '+(i+1));
      file.onchange = async () => { if (!file.files[0]) return; try { badge.image = await imageData(file.files[0], 96, false); badgeEditor(); } catch(e) { byId('teamMessage').textContent = e.message; } };
      const remove = node('button','Remove','btn-small'); remove.type = 'button'; remove.onclick = () => { badgeDraft.splice(i,1); badgeEditor(); };
      row.append(label,file,remove); list.append(row);
    });
    byId('teamAddBadge').disabled = badgeDraft.length >= 8;
  }
  function addBadge() { if (badgeDraft.length < 8) { badgeDraft.push({label:'',image:''}); badgeEditor(); } }
  function editProfile(p = {}) {
    editing = p.id || 'new'; const form = byId('teamEditForm'); form.hidden = false;
    for (const key of ['name','role','bio','photo','details']) byId('team_'+key).value = p[key] || '';
    byId('team_featured').checked=!!p.featured;byId('team_glowColor').value=p.glowColor || '#99d8f5';
    byId('team_visible').checked = p.visible !== false;
    badgeDraft = (p.badges || []).map(b => ({...b})); badgeEditor();
    byId('team_socials').value = (p.socials || []).map(s => s.label + ' | ' + s.url).join('\n');
    byId('teamDelete').hidden = !p.id; byId('teamMessage').textContent = ''; byId('team_name').focus();
  }
  function socials() {
    return byId('team_socials').value.split('\n').filter(s=>s.trim()).map(line=>{
      const parts=line.split('|'); let label=parts.length>1?parts.shift().trim():''; const url=parts.join('|').trim();
      if(!label) { try { const host=new URL(url).hostname.replace(/^www\./,''); label=host==='youtu.be'||host==='youtube.com'?'YouTube':host==='tiktok.com'?'TikTok':host==='instagram.com'?'Instagram':host==='discord.gg'||host==='discord.com'?'Discord':host==='x.com'||host==='twitter.com'?'X':host; } catch { label='Website'; } }
      return {label,url};
    });
  }
  async function save(event) {
    event.preventDefault(); const message = byId('teamMessage'), button = byId('teamSave'); button.disabled = true;
    try {
      if (badgeDraft.some(b=>!b.label.trim())) throw Error('Give each badge a name, or remove the empty badge.');
      const p = { visible: byId('team_visible').checked, badges: badgeDraft.map(b=>({...b})), socials: socials() };
      for (const key of ['name','role','bio','photo','details']) p[key] = byId('team_'+key).value.trim();
      p.featured=byId('team_featured').checked;p.glowColor=byId('team_glowColor').value;
      if (new Blob([JSON.stringify(p)]).size > 190000) throw Error('These images are too large together. Use smaller badge images or HTTPS image links.');
      const r = await fetch('/api/admin/staff-profiles/'+encodeURIComponent(editing), {method:'PUT',headers:headers(),body:JSON.stringify(p)});
      const j = await r.json(); if (!r.ok) throw Error(j.error || 'Could not save.');
      config.staffProfiles = j.profiles; render(); editor(); byId('teamEditForm').hidden = true; message.textContent = 'Saved. Everyone viewing the site will see this profile after reloading.';
    } catch(e) { message.textContent = e.message; } finally { button.disabled = false; }
  }
  async function remove() {
    if (!confirm('Remove this staff profile from the site?')) return;
    try { const r = await fetch('/api/admin/staff-profiles/'+encodeURIComponent(editing),{method:'DELETE',headers:headers()}); const j = await r.json(); if(!r.ok) throw Error(j.error); config.staffProfiles = j.profiles; render(); editor(); byId('teamEditForm').hidden = true; }
    catch(e) { byId('teamMessage').textContent = e.message || 'Could not remove profile.'; }
  }
  async function imageData(file, size, crop) {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10000000) throw Error('Choose a PNG, JPEG or WebP smaller than 10 MB.');
      const bitmap = await createImageBitmap(file); const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx=canvas.getContext('2d');
      if(crop) { const side=Math.min(bitmap.width,bitmap.height); ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size); }
      else { const ratio=Math.min(size/bitmap.width,size/bitmap.height); const w=bitmap.width*ratio,h=bitmap.height*ratio; ctx.drawImage(bitmap,(size-w)/2,(size-h)/2,w,h); }
      bitmap.close(); return canvas.toDataURL('image/webp',.78);
  }
  async function upload(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      byId('team_photo').value = await imageData(file,240,true);
    } catch(e) { byId('teamMessage').textContent = e.message; } finally { event.target.value = ''; }
  }
  return { render, editor, editProfile, save, remove, upload, addBadge };
})();
