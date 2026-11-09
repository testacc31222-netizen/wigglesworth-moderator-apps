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
})();
