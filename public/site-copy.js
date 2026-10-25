/* Shared static-copy support for the staff editor and public pages. */
(function () {
  'use strict';
  const hash = s => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  };
  function prepare(roots, namespace) {
    const result = [];
    const occurrences = new Map();
    const ignored = 'SCRIPT,STYLE,NOSCRIPT,TEMPLATE,TEXTAREA';
    const add = (el, source, kind) => {
      const normalized = String(source || '').replace(/\s+/g, ' ').trim();
      if (!normalized) return;
      const base = hash(normalized);
      const n = occurrences.get(base) || 0;
      occurrences.set(base, n + 1);
      const key = (kind === 'placeholder' ? 'p-' : 't-') + namespace + '-' + base + '-' + n;
      el.dataset.copyKey = key;
      el.dataset.copyKind = kind || 'text';
      el.dataset.copyDefault = source;
      el.dataset.copyLabel = normalized.slice(0, 160);
      result.push({ key, label: el.dataset.copyLabel, value: source, kind: kind || 'text', el });
    };
    (Array.isArray(roots) ? roots : [roots]).filter(Boolean).forEach(root => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.closest(ignored) || parent.closest('#editor') || parent.closest('#why') || parent.closest('.account-crest') || parent.closest('[data-dkey]')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('[data-generated-copy-ignore]')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(node => {
        const parent = node.parentElement;
        if (parent.tagName === 'OPTION') { add(parent, node.nodeValue, 'text'); return; }
        if (parent.tagName === 'SPAN' && parent.children.length === 0) { if (!parent.dataset.copyKey) add(parent, parent.textContent, 'text'); return; }
        const span = document.createElement('span');
        span.className = 'site-copy';
        node.parentNode.insertBefore(span, node);
        span.appendChild(node);
        add(span, node.nodeValue, 'text');
      });
      root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(el => add(el, el.getAttribute('placeholder'), 'placeholder'));
    });
    return result;
  }
  function apply(targets, values) {
    values = values && typeof values === 'object' ? values : {};
    targets.forEach(t => {
      if (!t.el) return;
      if (!Object.prototype.hasOwnProperty.call(values, t.key) || typeof values[t.key] !== 'string') return;
      if (t.kind === 'placeholder') t.el.setAttribute('placeholder', values[t.key]);
      else t.el.textContent = values[t.key];
    });
    applyDynamic(values);
  }
  // These labels are generated after the initial page scan. Keep account values,
  // application answers, IDs and staff notes outside the editable copy catalog.
  const dynamicLabels = [
    'Stay in touch', 'We will send your receipt and decision here.',
    'Share enough detail for us to understand your answer.',
    'Your place in the community', 'Experience & judgment', 'Your contribution',
    'Email me when my application is reviewed', 'Previous', 'Next', 'Submit application',
    'Under review', 'Accepted', 'Not accepted', 'Private support ticket', 'Open ticket',
    'No applications linked yet.', 'Add one below with the Application ID from your confirmation.',
    'No support tickets linked to this account yet.', 'Open the applications site to contact staff.'
  ];
  const dynamicKey = text => 'u-' + hash(text);
  function dynamicCatalog(){
    return dynamicLabels.map(value=>({key:dynamicKey(value), label:'Generated interface · '+value, value, kind:'text'}));
  }
  let dynamicValues = {}, observing = false, scheduled = false;
  function applyDynamic(values){
    dynamicValues = values || dynamicValues;
    const roots = document.querySelectorAll('.form-section-heading,.step-link-name,.form-step-actions,.checkline,#signedIn .empty,#signedIn .pill,#signedIn .role,#signedIn .secondary');
    roots.forEach(root=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode;
        const source=node.__copySource || node.nodeValue.trim();
        if(!dynamicLabels.includes(source)) continue;
        node.__copySource=source;
        const value=dynamicValues[dynamicKey(source)];
        const next=typeof value==='string'?value:source;
        if(node.nodeValue!==next) node.nodeValue=next;
      }
    });
    if(!observing){
      observing=true;
      new MutationObserver(()=>{
        if(scheduled) return;
        scheduled=true;
        queueMicrotask(()=>{scheduled=false;applyDynamic();});
      }).observe(document.body,{childList:true,subtree:true,characterData:true});
    }
  }
  window.SiteCopy = { prepare, apply, dynamicCatalog };
})();
