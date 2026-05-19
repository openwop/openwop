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
