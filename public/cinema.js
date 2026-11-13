/* Scroll-linked presentation only. The application/account handlers remain intact. */
(() => {
  'use strict';
  const journey = document.querySelector('.eye-journey');
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
    const scaleProgress = Math.min(1,progress / 0.78);
    journey.style.setProperty('--eye-progress', scaleProgress.toFixed(4));
    journey.style.setProperty('--eye-scale', (1 + 13 * scaleProgress ** 2.2).toFixed(4));
    journey.style.setProperty('--copy-opacity', String(Math.max(0,1-progress/0.23)));
    journey.style.setProperty('--aperture', `${Math.max(0,(progress-0.36)/0.5)*150}vmax`);
    journey.style.setProperty('--eye-x', `${innerWidth / 2 + .19 * innerHeight * (1-scaleProgress)}px`);
    journey.style.setProperty('--eye-y', `${innerHeight * (.52-.02*scaleProgress)}px`);
    journey.querySelector('.eye-copy').inert = progress > .23;
    const scrollHint = journey.querySelector('.eye-scroll');
    scrollHint.inert = progress > .15;
    scrollHint.hidden = progress > .23;
    journey.classList.toggle('film-visible', progress > 0.36);
    document.body.classList.toggle('cinema-paper', rect.bottom <= innerHeight + 30);
    const hero = document.getElementById('heroGameplay');
    if (hero && progress > 0.34 && rect.bottom > 0) play(hero);
    else hero?.pause();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(render); }
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
  document.querySelectorAll('.portal-section-heading,.portal-process-strip,.cinema-community').forEach(el=>reveals.observe(el));
  render();
})();
