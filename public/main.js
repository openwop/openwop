// Subtle reveal-on-scroll
const initialTarget = location.hash ? document.querySelector(location.hash) : null;
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { rootMargin: '0px 0px -10% 0px' });

document.querySelectorAll('.block, .pillar, .compare-card, .ana-list li, .spec .row, .proof-stats, .proof-card, .terminal, .demo-flow li, .star-cta').forEach(el => {
  el.classList.add('reveal');
  if (initialTarget && (el === initialTarget || el.contains(initialTarget) || initialTarget.contains(el))) {
    el.classList.add('in');
  }
  io.observe(el);
});

// Star-on-GitHub count — progressive enhancement, silent on failure.
// Cached in localStorage for 1h to avoid a third-party request on every page
// load and to stay clear of GitHub's 60 req/hr/IP anonymous rate limit.
(() => {
  const starEl = document.querySelector('[data-star-count]');
  if (!starEl) return;

  const CACHE_KEY = 'openwop:gh-stars';
  const TTL_MS = 60 * 60 * 1000;
  const fmt = (n) => n >= 10000 ? Math.round(n / 1000) + 'k'
                   : n >= 1000  ? (n / 1000).toFixed(1) + 'k'
                                : String(n);
  const paint = (count) => {
    starEl.textContent = fmt(count);
    starEl.classList.remove('is-empty');
    starEl.removeAttribute('aria-hidden');
  };

  let cached = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch { /* storage disabled / quota / parse — fall through */ }

  if (cached && typeof cached.count === 'number') {
    paint(cached.count);
    if (cached.ts && Date.now() - cached.ts < TTL_MS) return; // fresh — done
  }

  fetch('https://api.github.com/repos/openwop/openwop', {
    headers: { 'Accept': 'application/vnd.github+json' }
  })
    .then((r) => r.ok ? r.json() : Promise.reject(new Error('star-fetch:' + r.status)))
    .then((d) => {
      if (typeof d.stargazers_count !== 'number') return;
      paint(d.stargazers_count);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ count: d.stargazers_count, ts: Date.now() }));
      } catch { /* best-effort cache write */ }
    })
    .catch(() => { /* leave the em-dash placeholder; never break the layout */ });
})();

// Anatomy tabs — single-panel-visible with hash deep-linking + keyboard nav.
(() => {
  const tabs = Array.from(document.querySelectorAll('.ana-tab[role="tab"]'));
  if (!tabs.length) return;
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

  function activate(key, opts = {}) {
    const idx = tabs.findIndex((t) => t.dataset.tab === key);
    if (idx < 0) return;
    tabs.forEach((t, i) => {
      const active = i === idx;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.setAttribute('tabindex', active ? '0' : '-1');
      const panel = panels[i];
      if (panel) {
        if (active) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      }
    });
    if (opts.focus) tabs[idx].focus();
    if (opts.updateHash) {
      try {
        history.replaceState(null, '', `#ana-${key}`);
      } catch { /* ignore */ }
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab, { updateHash: true }));
    tab.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        activate(tabs[nextIdx].dataset.tab, { focus: true, updateHash: true });
      }
    });
  });

  // Honor a deep link like /#ana-D on initial load.
  const m = location.hash.match(/^#ana-([A-G])$/);
  if (m) activate(m[1]);

  // Listen for hash changes (e.g. user clicks a #ana-X link elsewhere on the page).
  window.addEventListener('hashchange', () => {
    const mm = location.hash.match(/^#ana-([A-G])$/);
    if (mm) activate(mm[1]);
  });
})();

// Homepage in-page sub-nav active-section highlighter.
// Watches each section linked from .subnav-link[data-target] and toggles
// .is-active on the link whose section is currently in the viewport.
// Also keeps the active link visible by scrolling it into view inside the
// horizontal .subnav-scroll container on narrow screens.
(() => {
  const links = Array.from(document.querySelectorAll('.subnav-link[data-target]'));
  if (!links.length || !('IntersectionObserver' in window)) return;

  const linkByTarget = new Map(links.map((a) => [a.dataset.target, a]));
  const scrollContainer = document.querySelector('.subnav-scroll');

  function setActive(id) {
    let any = false;
    links.forEach((a) => {
      const active = a.dataset.target === id;
      a.classList.toggle('is-active', active);
      // Mirror visual state on the AX tree so screen-reader users get
      // section context. Use `aria-current="location"` rather than
      // `page` because the active section is in-page, not the page
      // itself.
      if (active) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
      if (active) any = true;
    });
    if (any && scrollContainer) {
      const activeLink = linkByTarget.get(id);
      if (activeLink) {
        const linkRect = activeLink.getBoundingClientRect();
        const containerRect = scrollContainer.getBoundingClientRect();
        if (linkRect.left < containerRect.left || linkRect.right > containerRect.right) {
          activeLink.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }

  const observer = new IntersectionObserver((entries) => {
    // Pick the entry whose top is closest to (but past) the sticky chrome.
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) setActive(visible[0].target.id);
  }, { rootMargin: '-116px 0px -55% 0px' });

  for (const id of linkByTarget.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
})();
