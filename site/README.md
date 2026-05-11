# `site/` — Public docs + conformance leaderboard

Static-site generator for the OpenWOP public-facing site. Reads from the spec corpus, the per-host conformance evidence under `examples/hosts/*/conformance.md`, and the `INTEROP-MATRIX.md` claim+evidence table; emits dependency-free HTML + per-host SVG badges.

## What it builds

| URL | Source | Purpose |
|---|---|---|
| `/` | `README.md` | Positioning + spec-doc index |
| `/spec/v1/` | `spec/v1/*.md` | Rendered spec corpus, per-doc + index page |
| `/spec/v1/{name}.html` | `spec/v1/{name}.md` | Each spec doc rendered to HTML |
| `/conformance/` | `INTEROP-MATRIX.md` | Live leaderboard of openwop-compatible hosts |
| `/profiles/` | `spec/v1/profiles.md` | Compatibility-profile catalog |
| `/badge/{host}.svg` | derived from `INTEROP-MATRIX.md` | Per-host conformance SVG badge |

## Run locally

```bash
cd site
npm run build      # writes to site/dist/
npm run serve      # tiny static server on http://localhost:8989
```

`build` is pure Node 20 stdlib — no `npm install` needed unless you want vitest later. Build is incremental-safe (re-run as docs change).

## Markdown rendering

Hand-rolled in `src/build.mjs`. Intentionally limited to: headings, paragraphs, unordered lists, code blocks (``` fenced), tables (GFM), inline links, inline code, bold (**), italic (*), blockquotes, horizontal rules. Raw HTML is sanitized.

If you need richer rendering, swap `markdownToHtml()` for `marked` or `markdown-it`. Doing so breaks the zero-runtime-dep policy and adds an audit surface, so weigh accordingly.

## OG image regeneration

The Open Graph card (1200×630) shipped at `/og-default.png` is rendered from `templates/og-default.svg`. The PNG is checked into the repo so the build stays zero-runtime-dep.

To redesign the card:

1. Edit `templates/og-default.svg` in any vector editor.
2. Re-run `node scripts/generate-og-image.mjs`. Requires `sharp` (use a directory where it resolves, or `npx --package=sharp -- node scripts/generate-og-image.mjs`).
3. Commit `og-default.svg` and `og-default.png` together.

The build copies both into `dist/`. SVG is shipped alongside the PNG for designers who want to grab the source from a deployed site.

## Domain

The site defaults to `openwop.dev`. Override at build time via:

```bash
SITE_DOMAIN=example.org node src/build.mjs
```

(Used by the deploy job for preview domains or future domain migrations.)

## Deploy

GitHub Actions workflow at `.github/workflows/site.yml` builds on every push to `main` (when site-relevant paths change). The deploy step is **gated** behind `vars.ALLOW_DEPLOY == '1'` until the v1.0 production-release checklist is complete and DNS is ready.

When the gate closes:

1. Set the `ALLOW_DEPLOY=1` repo variable.
2. Update the `if:` condition in `site.yml` deploy job to `if: github.ref == 'refs/heads/main'`.
3. Configure the GitHub Pages source to "GitHub Actions" in repo Settings.
4. Add a CNAME pointing to the chosen domain.

## Security model

- Sanitized markdown rendering (no raw HTML in spec docs).
- Path-traversal guard in `src/serve.mjs`.
- No client-side JavaScript shipped — pure HTML + CSS. Reduces XSS surface to zero.
- All asset URLs are relative (no third-party CDN dependencies).
- No telemetry, analytics, or tracking pixels.

## Adding to the leaderboard

Third-party hosts add a row by submitting a PR that:

1. Adds a row to `INTEROP-MATRIX.md`.
2. Creates `examples/hosts/{name}/conformance.md` with the suite output.
3. The build job auto-rebuilds; the `/conformance/` page reflects the new row on next push.

No admin gate beyond standard PR review.
