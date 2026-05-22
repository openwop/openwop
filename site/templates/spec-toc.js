// Sticky-ToC active-section highlighter.
//
// Copied to dist/assets/spec-toc.js by buildAssets() in site/src/build.mjs.
// Every page wrapped via wrapWithToc() includes a `<script src="/assets/spec-toc.js" defer>`
// reference so the same logic runs on spec docs, RFCs, FAQ, audience landings, errors,
// scenarios, changelog/roadmap/versioning/security/contributing/governance, and the
// /spec/v1/, /conformance/, and /profiles/ index pages.
//
// Hand-rolled, no deps. Skips silently on browsers without IntersectionObserver.

(function () {
  var links = document.querySelectorAll('.spec-toc a');
  if (!links.length || !('IntersectionObserver' in window)) return;

  var byId = new Map();
  links.forEach(function (a) { byId.set(a.getAttribute('href').slice(1), a); });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        links.forEach(function (a) { a.classList.remove('is-active'); });
        var link = byId.get(e.target.id);
        if (link) link.classList.add('is-active');
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });

  byId.forEach(function (_, id) {
    var el = document.getElementById(id);
    if (el) observer.observe(el);
  });
})();
