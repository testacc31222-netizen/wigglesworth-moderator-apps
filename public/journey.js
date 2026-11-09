/* Presentation only: application and account behavior stays in the existing scripts. */
(() => {
  'use strict';
  const links = [...document.querySelectorAll('[data-journey-link]')];
  const drawerLinks = [...document.querySelectorAll('#navLinks a[href^="#"]')];
  const header = document.getElementById('topnav');
  const toggle = document.querySelector('.nav-toggle');
  function select(hash) {
    const target = hash || '#apply';
    links.forEach(link => {
      if (link.getAttribute('href') === target) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function closeMenu() {
    header.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  [...new Set([...links, ...drawerLinks])].forEach(link => link.addEventListener('click', () => {
    if (link.hash === '#roleMenu' && document.getElementById('roleMenu').style.display === 'none') {
      window.resetForm();
    }
    const fromDrawer = header.classList.contains('nav-open') && link.closest('#navLinks');
    closeMenu();
    select(link.hash);
    if (fromDrawer) {
      const target = document.querySelector(link.hash);
      if (target) { target.setAttribute('tabindex', '-1'); target.focus({preventScroll:true}); }
    }
  }));
  header.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !header.classList.contains('nav-open')) return;
    const focusable = [...header.querySelectorAll('a[href],button')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('click', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  window.addEventListener('hashchange', () => select(location.hash));
  const media = matchMedia('(min-width: 761px)');
  media.addEventListener('change', closeMenu);
  document.querySelector('.journey-utilities button').addEventListener('click', closeMenu);
  new MutationObserver(() => {
    toggle.setAttribute('aria-label', toggle.getAttribute('aria-expanded') === 'true' ? 'Close navigation' : 'Open navigation');
  }).observe(toggle, {attributes:true, attributeFilter:['aria-expanded']});
  if ('IntersectionObserver' in window) {
    const sections = ['apply', 'roleMenu', 'apply-form', 'process', 'faq'].map(id => document.getElementById(id)).filter(Boolean);
    const positions = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => positions.set(entry.target.id, entry.isIntersecting));
      const visible = sections.find(section => positions.get(section.id));
      if (visible) select('#' + visible.id);
    }, {rootMargin:'-15% 0px -55% 0px', threshold:0});
    sections.forEach(section => observer.observe(section));
  }
  select(location.hash);
})();
