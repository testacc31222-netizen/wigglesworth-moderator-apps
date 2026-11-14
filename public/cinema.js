/* Scroll-linked presentation only. The application/account handlers remain intact. */
(() => {
  'use strict';
  const journey = document.querySelector('.eye-journey');
  const homeEntry = journey && (!location.hash || ['#apply','#discover'].includes(location.hash)) && !new URLSearchParams(location.search).has('ticket');
  if (homeEntry) history.scrollRestoration = 'manual';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = navigator.connection?.saveData;
  const videos = [...document.querySelectorAll('[data-silent-video]')];
  const paused = new Set();
  const visible = new Set();
  function controls(video) { return document.querySelector(`[data-video-control="${video.id}"]`); }
  function label(video) {
    const button = controls(video);
    if (button) { button.textContent = video.paused ? 'Play video' : 'Pause video'; button.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} ${video.getAttribute('aria-label')}`); }
  }
  function load(video) { if (!video.getAttribute('src')) video.src = video.dataset.src; video.muted = true; video.defaultMuted = true; }
  function play(video, manual = false) {
    if (!manual && (reduced.matches || saveData || paused.has(video) || document.hidden)) return;
    load(video);
    video.play().catch(() => label(video));
  }
  videos.forEach(video => {
    video.addEventListener('play', () => label(video));
    video.addEventListener('pause', () => label(video));
    video.addEventListener('volumechange', () => { if (!video.muted) video.muted = true; });
    controls(video)?.addEventListener('click', () => {
      if (video.paused) { paused.delete(video); play(video, true); }
      else { paused.add(video); video.pause(); }
    });
    label(video);
  });
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) { visible.add(video); if (video.id !== 'heroGameplay') play(video); }
    else { visible.delete(video); video.pause(); }
  }), {threshold:0.15});
  videos.forEach(v => observer.observe(v));
  let frame = 0;
  function render() {
    frame = 0;
    if (!journey) return;
    const rect = journey.getBoundingClientRect();
    const progress = reduced.matches ? 0 : Math.max(0,Math.min(1,-rect.top / Math.max(1,rect.height-innerHeight)));
    const scaleProgress = Math.min(1,progress / 0.64);
    journey.style.setProperty('--eye-progress', scaleProgress.toFixed(4));
    journey.style.setProperty('--eye-scale', (1 + 11 * scaleProgress ** 2.4).toFixed(4));
    journey.style.setProperty('--copy-opacity', String(Math.max(0,1-progress/0.26)));
    const smooth = (from,to) => { const x=Math.max(0,Math.min(1,(progress-from)/(to-from))); return x*x*(3-2*x); };
    journey.style.setProperty('--darkness', smooth(.42,.62).toFixed(4));
    journey.style.setProperty('--passage', (smooth(.32,.43)*(1-smooth(.49,.6))).toFixed(4));
    journey.style.setProperty('--film-opacity', smooth(.74,.9).toFixed(4));
    const reveal = Math.max(0,Math.min(1,(progress-0.7)/0.2));
    journey.style.setProperty('--aperture', `${reveal*reveal*(3-2*reveal)*150}vmax`);
    const characterOffset = innerWidth > 760 ? .15 * innerWidth : 0;
    journey.style.setProperty('--eye-x', `${innerWidth / 2 + (characterOffset + .19 * innerHeight) * (1-scaleProgress)}px`);
    journey.style.setProperty('--eye-y', `${innerHeight * (.52-.02*scaleProgress)}px`);
    journey.querySelector('.eye-copy').inert = progress > .26;
    const scrollHint = journey.querySelector('.eye-scroll');
    scrollHint.inert = progress > .25;
    scrollHint.hidden = progress > .38;
    journey.classList.toggle('film-visible', progress > 0.7);
    const surface = document.elementFromPoint(innerWidth/2, Math.min(100,innerHeight/3));
    document.body.classList.toggle('cinema-paper', !!surface?.closest('.world-editorial,.community-spread,#apply-form,.portal-support,.portal-answers,.journey-config'));
    const hero = document.getElementById('heroGameplay');
    if (hero && progress > 0.7 && rect.bottom > 0 && !document.body.classList.contains('application-focus')) play(hero);
    else hero?.pause();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
  function resetOpening() {
    window.scrollTo({top:0,left:0,behavior:'instant'});
    render();
    // Cancel a compositor scroll still settling from wheel/anchor navigation.
    requestAnimationFrame(()=>{
      window.scrollTo({top:0,left:0,behavior:'instant'});
      render();
    });
  }
  if (homeEntry) {
    resetOpening();
    addEventListener('pageshow',()=>{
      if (!location.hash || ['#apply','#discover'].includes(location.hash)) resetOpening();
    });
  }
  if (journey) {
    document.addEventListener('click',event=>{
      const home = event.target.closest('a[href="#apply"],a[href="#discover"]');
      if (!home) return;
      event.preventDefault();
      if (document.body.classList.contains('application-focus')) window.resetForm(true);
      history.replaceState(null,'',location.pathname+location.search+home.hash);
      resetOpening();
    },true);
    journey.querySelector('.eye-scroll').addEventListener('click',()=>{
      const top = journey.getBoundingClientRect().top + scrollY;
      const distance = journey.offsetHeight - innerHeight;
      window.scrollTo({top:top + (reduced.matches ? journey.offsetHeight : distance*.48),behavior:reduced.matches?'instant':'smooth'});
    });
  }
  addEventListener('scroll',schedule,{passive:true});
  addEventListener('resize',schedule,{passive:true});
  reduced.addEventListener('change', () => { videos.forEach(v=>v.pause()); schedule(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) videos.forEach(v=>v.pause());
    else { visible.forEach(v=>{ if(v.id!=='heroGameplay')play(v); }); schedule(); }
  });
  // One-shot text reveals. Content is visible by default if JS is unavailable.
  const reveals = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('cinema-entered'); reveals.unobserve(entry.target); }
  }), {threshold:0.08});
  document.querySelectorAll('.portal-section-heading,.portal-process-strip,.world-editorial,.community-title,.community-note,.showcase-film,.campaign-ending>div').forEach(el=>reveals.observe(el));
  render();
})();
