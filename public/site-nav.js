// Shared top-nav behaviour for both the marketing homepage and every
// site-generated subpage. Keeps two surfaces honest:
//   1. Desktop dropdowns — open on hover via CSS, on click/Enter/Space here
//      so keyboard + touch get parity; close on Escape and focus-out.
//   2. Mobile drawer — hamburger toggles a right-side panel, scrim closes,
//      Escape closes, focus is trapped while open, body scroll is locked.
// No framework, no runtime deps. Honours `prefers-reduced-motion: reduce`.

(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Dropdown menus (desktop) ────────────────────────────────────────
  document.querySelectorAll('.nav-dropdown').forEach((root) => {
    const trigger = root.querySelector('.nav-dropdown-trigger');
    const menu = root.querySelector('.nav-dropdown-menu');
    if (!trigger || !menu) return;
    const items = Array.from(menu.querySelectorAll('a[role="menuitem"]'));

    function open(focusFirst = false) {
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      if (focusFirst && items[0]) items[0].focus();
    }
    function close(restoreFocus = false) {
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) trigger.focus();
    }

    trigger.addEventListener('click', (e) => {
      // If the trigger itself is also a link, allow plain click on a non-
      // dropdown trigger area to follow the href. Anchor-targeted triggers
      // carry data-dropdown-anchor="true" and we toggle on the chevron only.
      e.preventDefault();
      if (root.classList.contains('is-open')) close();
      else open();
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(true);
      } else if (e.key === 'Escape') {
        close(true);
      }
    });

    items.forEach((item, idx) => {
      item.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          (items[idx + 1] || items[0]).focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (items[idx - 1] || items[items.length - 1]).focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(true);
        } else if (e.key === 'Tab' && !e.shiftKey && idx === items.length - 1) {
          close();
        }
      });
    });

    // Close on outside click + on focus leaving the dropdown.
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });
    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget)) close();
    });
  });

  // ── Mobile hamburger + drawer ────────────────────────────────────────
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.getElementById('site-menu');
  const scrim = document.querySelector('.nav-scrim');
  if (toggle && drawer) {
    const focusableSelector = 'a[href], button:not([disabled])';
    let lastFocus = null;

    function openDrawer() {
      lastFocus = document.activeElement;
      drawer.classList.add('is-open');
      if (scrim) scrim.classList.add('is-open');
      document.documentElement.style.overflow = 'hidden';
      toggle.setAttribute('aria-expanded', 'true');
      drawer.setAttribute('aria-hidden', 'false');
      // First focusable inside the drawer (the close button).
      const firstFocusable = drawer.querySelector(focusableSelector);
      if (firstFocusable) firstFocusable.focus();
    }
    function closeDrawer() {
      drawer.classList.remove('is-open');
      if (scrim) scrim.classList.remove('is-open');
      document.documentElement.style.overflow = '';
      toggle.setAttribute('aria-expanded', 'false');
      drawer.setAttribute('aria-hidden', 'true');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    toggle.addEventListener('click', () => {
      if (drawer.classList.contains('is-open')) closeDrawer();
      else openDrawer();
    });
    if (scrim) scrim.addEventListener('click', closeDrawer);
    const closeBtn = drawer.querySelector('.nav-drawer-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    drawer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      // Focus trap.
      const focusables = Array.from(drawer.querySelectorAll(focusableSelector));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    // Close drawer when any nav link is activated — feels like a real
    // mobile menu rather than a stuck overlay.
    drawer.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', () => closeDrawer());
    });
  }

  // ── Active-section marker on the dropdown triggers ──────────────────
  // The build pipeline already adds `.active` to the trigger when its
  // section's URL matches; this fallback covers the homepage where the
  // CSS class is missing because the homepage has no server-side template.
  const path = location.pathname.replace(/\/+$/, '/') || '/';
  const protocolMatch = /^\/(spec|conformance|rfcs|profiles|governance|security|roadmap|maintainers|versioning|contributing|protocol)(\/|$)/;
  const implementMatch = /^\/(implement|for)(\/|$)/;
  document.querySelectorAll('[data-nav-section="protocol"]').forEach((el) => {
    if (protocolMatch.test(path)) el.classList.add('active');
  });
  document.querySelectorAll('[data-nav-section="implement"]').forEach((el) => {
    if (implementMatch.test(path)) el.classList.add('active');
  });

  // Reduce motion: disable the drawer's CSS transition when the user opts
  // out. (CSS handles the rule; we just remove the class that triggers it.)
  if (reduceMotion && drawer) drawer.classList.add('no-motion');
})();
