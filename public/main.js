// Subtle reveal-on-scroll
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }
}, { rootMargin: '0px 0px -10% 0px' });

document.querySelectorAll('.block, .pillar, .compare-card, .ana-list li, .spec .row, .terminal').forEach(el => {
  el.classList.add('reveal');
  io.observe(el);
});