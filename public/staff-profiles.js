/* Public team cards and the existing authenticated workspace editor. */
window.StaffProfiles = (() => {
  const byId = id => document.getElementById(id);
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  function render() {
    const section = byId('team'), grid = byId('teamGrid');
    if (!section || !config) return;
    const members = (config.staffProfiles || []).filter(p => p.visible !== false);
    section.hidden = !members.length; grid.replaceChildren();
    let podium=byId('teamPodium');if(!podium){podium=node('div','','team-podium');podium.id='teamPodium';podium.setAttribute('aria-label','Featured leadership');grid.before(podium);}podium.replaceChildren();
    members.forEach(p => {
      const card = node('article', '', 'team-card');
      if(p.banner) { const img=node('img','','team-banner');img.src=p.banner;img.alt='';img.loading='lazy';card.prepend(img);card.classList.add('team-has-banner'); }
      if(p.cardSize === 'large') card.classList.add('team-card-large');
      if(p.featured) { card.classList.add('team-featured'); card.style.setProperty('--team-glow', /^#[0-9a-f]{6}$/i.test(p.glowColor || '') ? p.glowColor : '#99d8f5'); }
      if (p.photo) { const img = node('img', '', 'team-avatar'); img.src = p.photo; img.alt = ''; img.loading = 'lazy'; img.width = 92; img.height = 92; card.append(img); }
      else card.append(node('span', p.name.slice(0, 1).toUpperCase(), 'team-avatar'));
      card.append(node('h3', p.name), node('p', p.role, 'team-role'));
      if (p.bio) card.append(node('p', p.bio, 'team-bio'));
      const badges = node('div', '', 'team-badges');
      (p.badges || []).forEach(b => { const badge = node('span', '', 'team-badge'); if (b.image) { const img = node('img'); img.src = b.image; img.alt = ''; img.loading = 'lazy'; badge.append(img); } badge.append(document.createTextNode(b.label)); badges.append(badge); });
      card.append(badges);
      if(p.clip?.url) {
        const play=node('button','▶ Watch clip','team-more');play.type='button';play.setAttribute('aria-label','Play '+p.name+' clip');play.onclick=()=>playClip(p,play);card.append(play);card.classList.add('team-has-clip');
        card.addEventListener('click',e=>{if(!e.target.closest('a,button'))playClip(p,play);});
      }
      if (p.socials?.length) { const links = node('nav', '', 'team-socials'); links.setAttribute('aria-label', p.name + ' social links'); p.socials.forEach(s => { const a = node('a', s.label + ' ↗'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', p.name + ' on ' + s.label + ' (opens in new tab)'); links.append(a); }); card.append(links); }
      let frame = 0;
      card.addEventListener('pointermove', event => {
        if (!matchMedia('(hover:hover) and (pointer:fine)').matches || matchMedia('(prefers-reduced-motion:reduce)').matches) return;
        const r = card.getBoundingClientRect(); cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { card.style.setProperty('--rx', (-(event.clientY-r.top-r.height/2)/r.height*8)+'deg'); card.style.setProperty('--ry', ((event.clientX-r.left-r.width/2)/r.width*8)+'deg'); });
      });
      card.addEventListener('pointerleave', () => { cancelAnimationFrame(frame); card.style.setProperty('--rx','0deg'); card.style.setProperty('--ry','0deg'); });
      if(['left','center','right'].includes(p.placement)){card.classList.add('team-podium-'+p.placement);podium.append(card);}else grid.append(card);
    });
    podium.hidden=!podium.children.length;grid.hidden=!grid.children.length;
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
  function playClip(p,trigger) {
    const dialog=node('dialog','','team-clip-dialog');dialog.setAttribute('aria-label',p.name+' clip');
    const close=node('button','Close ×','team-more');close.type='button';close.onclick=()=>dialog.close();dialog.append(close,node('h2',p.name+' · a moment in Wigglesworth'));
    if(p.clip.kind==='youtube' && /^[\w-]{11}$/.test(p.clip.youtubeId || '')) {
      const frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+p.clip.youtubeId+'?autoplay=1&rel=0&start='+Math.max(0,Number(p.clip.start)||0);frame.title=p.name+' YouTube clip';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;dialog.append(frame);
      dialog.append(node('p','If this video cannot be embedded, open it on YouTube.','hint'));const a=node('a','Open on YouTube ↗','team-more');a.href=p.clip.url;a.target='_blank';a.rel='noopener noreferrer';dialog.append(a);
    } else {const video=node('video');video.src=p.clip.url;video.controls=true;video.playsInline=true;video.autoplay=true;video.preload='metadata';video.addEventListener('loadedmetadata',()=>{video.currentTime=Math.min(Number(p.clip.start)||0,Number.isFinite(video.duration)?video.duration:86400);});video.addEventListener('error',()=>{notice.textContent='The clip could not load yet. Recently uploaded videos may take a minute to become available.';});const notice=node('p','','hint');dialog.append(video,notice);}
    dialog.addEventListener('close',()=>{dialog.querySelector('video')?.pause();dialog.querySelector('iframe')?.remove();dialog.remove();if(trigger.isConnected)trigger.focus();});
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
    document.body.append(dialog);dialog.showModal();close.focus();
  }
  async function move(id,delta) {
    const ids=config.staffProfiles.map(p=>p.id), i=ids.indexOf(id); [ids[i],ids[i+delta]]=[ids[i+delta],ids[i]];
    try { const r=await fetch('/api/admin/staff-profile-order',{method:'POST',headers:headers(),body:JSON.stringify({ids})});const j=await r.json();if(!r.ok)throw Error(j.error);config.staffProfiles=j.profiles;render();editor();byId('teamMessage').textContent='Profile order saved.'; } catch(e){byId('teamMessage').textContent=e.message;}
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
    for (const key of ['name','role','bio','photo','details','banner']) byId('team_'+key).value = p[key] || '';
    byId('team_placement').value=p.placement || 'team';byId('team_cardSize').value=p.cardSize || 'standard';byId('team_featured').checked=!!p.featured;byId('team_glowColor').value=p.glowColor || '#99d8f5';
    bannerPreview();
    stopPreview();byId('team_clipUrl').value=p.clip?.url || '';byId('team_clipStart').value=p.clip?.start ?? '';
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
      for (const key of ['name','role','bio','photo','details','banner']) p[key] = byId('team_'+key).value.trim();
      p.placement=byId('team_placement').value;p.cardSize=byId('team_cardSize').value;p.featured=byId('team_featured').checked;p.glowColor=byId('team_glowColor').value;
      p.clip=byId('team_clipUrl').value.trim()?{url:byId('team_clipUrl').value.trim(),start:byId('team_clipStart').value}:null;
      if (new Blob([JSON.stringify(p)]).size > 190000) throw Error('These images are too large together. Use smaller badge images or HTTPS image links.');
      const r = await fetch('/api/admin/staff-profiles/'+encodeURIComponent(editing), {method:'PUT',headers:headers(),body:JSON.stringify(p)});
      const j = await r.json(); if (!r.ok) throw Error(j.error || 'Could not save.');
      config.staffProfiles = j.profiles; render(); editor(); stopPreview();byId('teamEditForm').hidden = true; message.textContent = 'Saved. Everyone viewing the site will see this profile after reloading.';
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
  function bannerPreview() {
    const img=byId('teamBannerPreview'),value=byId('team_banner').value.trim();img.hidden=!value;if(value)img.src=value;else img.removeAttribute('src');
  }
  function clearBanner(){byId('team_banner').value='';bannerPreview();}
  async function uploadBanner(event){
    const file=event.target.files[0];if(!file)return;
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10000000)throw Error('Choose a PNG, JPEG or WebP smaller than 10 MB.');
      const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=960;canvas.height=320;
      const ratio=Math.max(960/bitmap.width,320/bitmap.height),w=bitmap.width*ratio,h=bitmap.height*ratio;
      canvas.getContext('2d').drawImage(bitmap,(960-w)/2,(320-h)/2,w,h);bitmap.close();
      let data='';for(const quality of [.8,.65,.5,.35]){data=canvas.toDataURL('image/webp',quality);if(data.length<=70000)break;}
      if(data.length>70000)throw Error('This banner is too detailed. Choose a simpler or smaller image.');
      byId('team_banner').value=data;bannerPreview();
    }catch(e){byId('teamMessage').textContent=e.message;}finally{event.target.value='';}
  }
  let previewPlayer=null,previewVideo=null,previewVersion=0,youtubeReady;
  function stopPreview(){previewVersion++;try{previewPlayer?.destroy();}catch{}previewPlayer=null;previewVideo?.pause();previewVideo=null;byId('teamClipPreview')?.replaceChildren();if(byId('teamUseTime'))byId('teamUseTime').disabled=true;}
  function loadYouTube(){
    if(window.YT?.Player)return Promise.resolve();
    if(!youtubeReady)youtubeReady=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{youtubeReady=null;reject(Error('YouTube did not load. Try again or enter the start time manually.'));},15000);
      const prior=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);if(prior)prior();resolve();};
      const script=node('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timer);youtubeReady=null;reject(Error('Could not load YouTube. Enter the start time manually or try again.'));};document.head.append(script);
    });return youtubeReady;
  }
  async function previewClip(){
    stopPreview();const version=previewVersion,box=byId('teamClipPreview'),message=byId('teamMessage');message.textContent='';
    try{
      const u=new URL(byId('team_clipUrl').value.trim());if(u.protocol!=='https:')throw Error('Paste a complete HTTPS video link first.');
      const host=u.hostname.replace(/^www\./,'');const stamp=u.searchParams.get('t')||u.searchParams.get('start')||'0';const fromLink=/^\d+$/.test(stamp)?Number(stamp):[...stamp.matchAll(/(\d+)(h|m|s)/g)].reduce((sum,m)=>sum+Number(m[1])*({h:3600,m:60,s:1}[m[2]]),0);const start=Math.max(0,byId('team_clipStart').value===''?fromLink:Number(byId('team_clipStart').value)||0);
      if(['youtube.com','m.youtube.com','youtu.be'].includes(host)){
        const id=host==='youtu.be'?u.pathname.split('/')[1]:u.searchParams.get('v') || u.pathname.split('/')[2];if(!/^[\w-]{11}$/.test(id||''))throw Error('Paste a YouTube video or Shorts link.');
        message.textContent='Loading video preview…';await loadYouTube();if(version!==previewVersion)return;
        const frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+id+'?enablejsapi=1&rel=0&start='+start+'&origin='+encodeURIComponent(location.origin);frame.title='Clip timestamp preview';frame.referrerPolicy='strict-origin-when-cross-origin';frame.allow='encrypted-media; fullscreen';frame.allowFullscreen=true;box.append(frame);
        previewPlayer=new YT.Player(frame,{events:{onReady:()=>{if(version===previewVersion){byId('teamUseTime').disabled=false;message.textContent='Scrub through the video, then choose Use current time.';}},onError:()=>{message.textContent='YouTube cannot play this video here. Try another link or enter a start time manually.';}}});
      }else{
        const video=node('video');video.src=u.href;video.controls=true;video.playsInline=true;video.preload='metadata';previewVideo=video;box.append(video);
        video.onloadedmetadata=()=>{video.currentTime=Math.min(start,Number.isFinite(video.duration)?video.duration:start);byId('teamUseTime').disabled=false;};video.onerror=()=>{message.textContent='This video could not be loaded. Check the link or try an MP4/WebM upload.';};
      }
    }catch(e){if(version===previewVersion)message.textContent=e.message;}
  }
  function useCurrentTime(){const value=previewPlayer?.getCurrentTime?.() ?? previewVideo?.currentTime;if(!Number.isFinite(value))return;byId('team_clipStart').value=Math.floor(value);byId('teamMessage').textContent='Start time set to '+Math.floor(value)+' seconds. Save the profile to keep it.';previewPlayer?.pauseVideo?.();previewVideo?.pause();}
  async function uploadClip(event){
    const file=event.target.files[0];if(!file)return;const save=byId('teamSave'),message=byId('teamMessage');save.disabled=true;event.target.disabled=true;
    try{if(!['video/mp4','video/webm'].includes(file.type)||file.size>60000000)throw Error('Choose an MP4 or WebM video smaller than 60 MB.');message.textContent='Uploading clip… keep this page open.';
      const r=await fetch('/api/admin/upload-video',{method:'POST',headers:{...headers(),'Content-Type':file.type},body:file});const j=await r.json();if(!r.ok)throw Error(j.error || 'Upload failed.');stopPreview();byId('team_clipStart').value='';byId('team_clipUrl').value=j.rawUrl || j.url;message.textContent='Clip uploaded. Save this profile to attach it. It may take a minute to become playable.';
    }catch(e){message.textContent=e.message;}finally{save.disabled=false;event.target.disabled=false;event.target.value='';}
  }
  return { render, editor, editProfile, save, remove, upload, addBadge, bannerPreview, clearBanner, uploadBanner, uploadClip, previewClip, stopPreview, useCurrentTime };
})();
