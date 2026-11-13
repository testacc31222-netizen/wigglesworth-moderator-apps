/* Presentation controller; account, application and staff data stay in existing handlers. */
(() => {
  'use strict';
  const tabs = [...document.querySelectorAll('[data-support-panel]')];
  function selectPanel(id, moveFocus = false) {
    if (!tabs.length) return;
    tabs.forEach(tab => {
      const selected = tab.dataset.supportPanel === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.dataset.supportPanel).hidden = !selected;
      if (selected && moveFocus) tab.focus();
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectPanel(tab.dataset.supportPanel));
    tab.addEventListener('keydown', event => {
      let target;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      if (target !== undefined) { event.preventDefault(); selectPanel(tabs[target].dataset.supportPanel, true); }
    });
  });
  function revealDestination(hash) {
    if (hash === '#report') selectPanel('report');
    if (hash === '#contact') selectPanel('contact');
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href="#contact"],a[href="#report"]');
    if (link) revealDestination(link.hash);
  }, true);
  window.addEventListener('hashchange', () => revealDestination(location.hash));
  revealDestination(location.hash);
  if (new URLSearchParams(location.search).has('ticket')) selectPanel('contact');
  const evidence = document.getElementById('evdrop');
  evidence?.addEventListener('keydown', event => {
    if (event.target === evidence && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); document.getElementById('r_files').click();
    }
  });
  // Give the existing sign-in tabs the expected keyboard interaction.
  const authTabs = [...document.querySelectorAll('#tabEmail,#tabId')];
  authTabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? authTabs[0] : event.key === 'End' ? authTabs[1] : authTabs[1 - index];
    window.setMode(target.id === 'tabId' ? 'id' : 'email', false);
    target.focus();
  }));
  // One delegated listener and one frame at a time, only while a mouse is over a role.
  // Native cursor, keyboard focus and touch interactions remain unchanged.
  const hoverMotion = matchMedia('(hover:hover) and (pointer:fine) and (prefers-reduced-motion:no-preference)');
  let hoverTarget = null, hoverFrame = 0, pointerX = 0, pointerY = 0;
  function clearHover() {
    cancelAnimationFrame(hoverFrame); hoverFrame = 0;
    if (hoverTarget) {
      hoverTarget.style.removeProperty('--pointer-x');
      hoverTarget.style.removeProperty('--pointer-y');
    }
    hoverTarget = null;
  }
  document.addEventListener('pointermove', event => {
    if (!hoverMotion.matches || event.pointerType !== 'mouse') return;
    const target = event.target.closest('.role-row.is-open');
    if (target !== hoverTarget) { clearHover(); hoverTarget = target; }
    if (!target) return;
    pointerX = event.clientX; pointerY = event.clientY;
    if (hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      if (!hoverTarget) return;
      const rect = hoverTarget.getBoundingClientRect();
      hoverTarget.style.setProperty('--pointer-x', `${Math.round(pointerX - rect.left)}px`);
      hoverTarget.style.setProperty('--pointer-y', `${Math.round(pointerY - rect.top)}px`);
    });
  }, {passive:true});
  document.documentElement.addEventListener('pointerleave', clearHover);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearHover(); });
  hoverMotion.addEventListener('change', clearHover);
})();
