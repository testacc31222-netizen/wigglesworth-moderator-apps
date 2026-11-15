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
      if (p.photo) { const img = node('img', '', 'team-avatar'); img.src = p.photo; img.alt = ''; img.loading = 'lazy'; img.width = 92; img.height = 92; card.append(img); }
      else card.append(node('span', p.name.slice(0, 1).toUpperCase(), 'team-avatar'));
      card.append(node('h3', p.name), node('p', p.role, 'team-role'));
      if (p.bio) card.append(node('p', p.bio, 'team-bio'));
      const badges = node('div', '', 'team-badges');
      (p.badges || []).forEach(b => { const badge = node('span', '', 'team-badge'); if (b.image) { const img = node('img'); img.src = b.image; img.alt = ''; img.loading = 'lazy'; badge.append(img); } badge.append(document.createTextNode(b.label)); badges.append(badge); });
      card.append(badges);
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
    (config.staffProfiles || []).forEach(p => {
      const row = node('div', '', 'team-editor-row'); row.append(node('span', p.name + (p.visible === false ? ' · Hidden' : '')));
      const edit = node('button', 'Edit', 'btn-small'); edit.type = 'button'; edit.onclick = () => editProfile(p); row.append(edit); list.append(row);
    });
    if (!list.children.length) list.append(node('p', 'No staff cards yet. Add your first profile below.', 'hint'));
  }
  let editing = 'new';
  function editProfile(p = {}) {
    editing = p.id || 'new'; const form = byId('teamEditForm'); form.hidden = false;
    for (const key of ['name','role','bio','photo']) byId('team_'+key).value = p[key] || '';
    byId('team_visible').checked = p.visible !== false;
    byId('team_badges').value = (p.badges || []).map(b => b.label + (b.image ? ' | ' + b.image : '')).join('\n');
    byId('team_socials').value = (p.socials || []).map(s => s.label + ' | ' + s.url).join('\n');
    byId('teamDelete').hidden = !p.id; byId('teamMessage').textContent = ''; byId('team_name').focus();
  }
  function lines(id, keys) { return byId(id).value.split('\n').filter(s => s.trim()).map(line => { const parts = line.split('|'); return { [keys[0]]: parts.shift().trim(), [keys[1]]: parts.join('|').trim() }; }); }
  async function save(event) {
    event.preventDefault(); const message = byId('teamMessage'), button = byId('teamSave'); button.disabled = true;
    try {
      const p = { visible: byId('team_visible').checked, badges: lines('team_badges',['label','image']), socials: lines('team_socials',['label','url']) };
      for (const key of ['name','role','bio','photo']) p[key] = byId('team_'+key).value.trim();
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
  async function upload(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10000000) throw Error('Choose a PNG, JPEG or WebP smaller than 10 MB.');
      const bitmap = await createImageBitmap(file); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 240;
      const side = Math.min(bitmap.width,bitmap.height); canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,240,240); bitmap.close();
      byId('team_photo').value = canvas.toDataURL('image/webp',.78);
    } catch(e) { byId('teamMessage').textContent = e.message; } finally { event.target.value = ''; }
  }
  return { render, editor, editProfile, save, remove, upload };
})();
