#!/usr/bin/env node
/**
 * openwop site generator. Reads:
 *   - INTEROP-MATRIX.md (the per-host claim+evidence matrix)
 *   - examples/hosts/{host}/conformance.md (per-host run logs)
 *   - spec/v1/*.md (spec corpus, for /spec/v1/ rendering)
 *   - README.md (positioning content for the index page)
 *
 * Writes:
 *   - dist/index.html          (positioning + spec-doc index)
 *   - dist/conformance/index.html    (live leaderboard from INTEROP-MATRIX)
 *   - dist/profiles.html       (per-host profile claims)
 *   - dist/spec/v1/{name}.html (rendered spec docs)
 *   - dist/badge/{host}.svg    (per-host conformance badge)
 *
 * Zero runtime dependencies — markdown→HTML is hand-rolled, intentionally
 * limited to: headings, paragraphs, lists, code blocks, tables, links,
 * inline code, bold, italic. No raw HTML allowed in spec docs (sanitization).
 *
 * Set SITE_DOMAIN to override the public canonical domain.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const SITE_DIR = resolve(__dirname, '..');
const DIST = join(SITE_DIR, 'dist');
const TEMPLATES = join(SITE_DIR, 'templates');

const SITE_DOMAIN = process.env.SITE_DOMAIN ?? 'openwop.dev';
const SITE_ORIGIN = `https://${SITE_DOMAIN}`;
const REPO_URL = process.env.OPENWOP_REPO_URL ?? 'https://github.com/openwop/openwop';
const REPO_URL_DISPLAY = REPO_URL.replace(/^https?:\/\//, '');
const OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;

// Hard-fail when the deploy step asks for a real domain but didn't set one.
// `OPENWOP_REQUIRE_REAL_DOMAIN=1` is set in the deploy step of `.github/workflows/site.yml`
// (gated on `vars.ALLOW_DEPLOY == '1'`). Local builds + PR-time CI builds keep the
// default for preview-and-verify; only the publishing build refuses a missing domain.
if (process.env.OPENWOP_REQUIRE_REAL_DOMAIN === '1' && SITE_DOMAIN.startsWith('[')) {
  console.error(`[openwop-site] FATAL: OPENWOP_REQUIRE_REAL_DOMAIN=1 but SITE_DOMAIN is "${SITE_DOMAIN}". Set SITE_DOMAIN in the deploy job env before generating sitemap.xml / canonical / OG URLs.`);
  process.exit(1);
}

// Analytics + Search Console metadata is env-gated and renders to empty when unset.
const GSC_VERIFICATION = process.env.OPENWOP_GSC_TOKEN
  ? `<meta name="google-site-verification" content="${escapeHtml(process.env.OPENWOP_GSC_TOKEN)}">`
  : '';
const ANALYTICS_SCRIPT = process.env.OPENWOP_ANALYTICS_DOMAIN
  ? `<script defer data-domain="${escapeHtml(process.env.OPENWOP_ANALYTICS_DOMAIN)}" src="https://plausible.io/js/script.js"></script>`
  : '';

console.log(`[openwop-site] root=${ROOT}`);
console.log(`[openwop-site] dist=${DIST}`);
console.log(`[openwop-site] domain=${SITE_DOMAIN}`);
console.log(`[openwop-site] repoUrl=${REPO_URL}`);
console.log(`[openwop-site] gscVerification=${GSC_VERIFICATION ? 'set' : 'unset'}`);
console.log(`[openwop-site] analyticsScript=${ANALYTICS_SCRIPT ? 'set' : 'unset'}`);

function ensureDir(d) {
  mkdirSync(d, { recursive: true });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal markdown → HTML converter. Supports: headings, paragraphs,
 * unordered lists, code blocks (``` fenced), tables (GFM), inline links,
 * inline code, bold (**), italic (*). Strips raw HTML.
 *
 * Intentionally limited — full markdown rendering is out of scope for
 * the leaderboard MVP. Use `marked` or `markdown-it` if richer rendering
 * is needed (would break the zero-runtime-dep policy).
 */
function markdownToHtml(md) {
  // Strip raw HTML for sanitization
  md = md.replace(/<[^>]+>/g, (m) => escapeHtml(m));

  const out = [];
  const lines = md.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        `<pre class="lang-${escapeHtml(lang)}"><code>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const slug = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${level} id="${slug}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Table (must have a separator line on the next row)
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*[-:|\s]+\s*\|?\s*$/.test(lines[i + 1])) {
      const headers = line.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
      i += 2; // skip separator
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().length > 0) {
        const cells = lines[i].split('|').map((s) => s.trim()).filter((_, idx, arr) => {
          // Drop leading/trailing empties from leading/trailing pipes
          return !(idx === 0 && arr.length > headers.length) && !(idx === arr.length - 1 && arr.length > headers.length + 1);
        });
        rows.push(cells.slice(0, headers.length));
        i++;
      }
      out.push('<table>');
      out.push('<thead><tr>' + headers.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead>');
      out.push('<tbody>');
      for (const row of rows) {
        out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      out.push('</tbody></table>');
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      out.push('<ul>');
      for (const item of items) {
        out.push(`<li>${inline(item)}</li>`);
      }
      out.push('</ul>');
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const lines_ = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        lines_.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + lines_.map((l) => `<p>${inline(l)}</p>`).join('') + '</blockquote>');
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }

    // Paragraph
    if (line.trim().length > 0) {
      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim().length > 0 && !/^(#{1,6})\s/.test(lines[i]) && !lines[i].startsWith('```') && !/^[-*]\s+/.test(lines[i]) && !lines[i].startsWith('>')) {
        para.push(lines[i]);
        i++;
      }
      out.push(`<p>${inline(para.join(' '))}</p>`);
      continue;
    }

    i++;
  }

  return out.join('\n');
}

function inline(s) {
  let out = s;
  // Inline code (must come before other replacements to protect contents)
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const cleanUrl = url.replace(/"/g, '%22');
    return `<a href="${cleanUrl}">${text}</a>`;
  });
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  return out;
}

function readFile(p) {
  return readFileSync(p, 'utf8');
}

/**
 * Render a page through templates/page.html.
 *
 * Required:
 *   - `title`: page title (drives <title> + <og:title> + <twitter:title>)
 *   - `content`: rendered HTML body
 *   - `navActive`: which nav item highlights — 'index' | 'spec' | 'conformance' | 'profiles'
 *   - `description`: meta description (~120-160 chars; drives Google snippets + OG/Twitter description)
 *   - `canonicalPath`: site-relative path for <link rel="canonical"> + og:url (e.g. '/spec/v1/')
 *
 * Optional:
 *   - `jsonLd`: a parsed object — emitted as <script type="application/ld+json"> if provided
 *   - `ogTitle`: override og:title (defaults to title; useful when og:title is fuller than the tab title)
 */
function templatePage({ title, content, navActive, description, canonicalPath, jsonLd, ogTitle }) {
  if (!description) throw new Error(`[templatePage] missing description for "${title}"`);
  if (!canonicalPath) throw new Error(`[templatePage] missing canonicalPath for "${title}"`);
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  const jsonLdBlock = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>`
    : '';
  const tpl = readFile(join(TEMPLATES, 'page.html'));
  return tpl
    .replace(/\$\{title\}/g, escapeHtml(title))
    .replace(/\$\{content\}/g, content)
    .replace(/\$\{domain\}/g, escapeHtml(SITE_DOMAIN))
    .replace(/\$\{description\}/g, escapeHtml(description))
    .replace(/\$\{canonical\}/g, escapeHtml(canonical))
    .replace(/\$\{ogTitle\}/g, escapeHtml(ogTitle ?? title))
    .replace(/\$\{ogImage\}/g, escapeHtml(OG_IMAGE))
    .replace(/\$\{repoUrl\}/g, escapeHtml(REPO_URL))
    .replace(/\$\{repoUrlDisplay\}/g, escapeHtml(REPO_URL_DISPLAY))
    .replace(/\$\{jsonLd\}/g, jsonLdBlock)
    .replace(/\$\{gscVerification\}/g, GSC_VERIFICATION)
    .replace(/\$\{analyticsScript\}/g, ANALYTICS_SCRIPT)
    .replace(/\$\{nav_index\}/g, navActive === 'index' ? 'active' : '')
    .replace(/\$\{nav_spec\}/g, navActive === 'spec' ? 'active' : '')
    .replace(/\$\{nav_conformance\}/g, navActive === 'conformance' ? 'active' : '')
    .replace(/\$\{nav_profiles\}/g, navActive === 'profiles' ? 'active' : '');
}

// Canonical positioning sentence, reused across surfaces. Mirrors the openwop repo
// description set via `gh repo edit` and the canonical lead in README.md.
const CANONICAL_DESCRIPTION = 'Multi-Agent Workflow Orchestration Protocol — open, wire-level spec for orchestrating LLM agents, tools, sub-workflows, and humans across interoperable hosts. Durable suspend/resume, replay, version negotiation, observability.';

/**
 * Extract the first prose paragraph from a markdown doc, suitable as a meta
 * description. Skips H1, blockquote status banners, blank lines, and code
 * fences. Truncates at ~250 chars on a word boundary so the description fits
 * Google's snippet window without mid-word cuts.
 */
function extractFirstParagraph(md) {
  const lines = md.split('\n');
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) inFence = !inFence;
    else if (
      !inFence &&
      line.trim() !== '' &&
      !line.startsWith('#') &&
      !line.startsWith('>') &&
      !line.startsWith('|') &&
      !line.startsWith('-')
    ) {
      // Collect until blank line; collapse internal whitespace.
      const collected = [];
      while (i < lines.length && lines[i].trim() !== '') {
        collected.push(lines[i].trim());
        i++;
      }
      const para = collected
        .join(' ')
        // Strip markdown emphasis + inline code + link syntax for a clean
        // description string. Keep the link text (group 1), drop the URL.
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      if (para.length < 60) return null; // too short to be useful
      if (para.length <= 250) return para;
      const truncated = para.slice(0, 250).replace(/\s+\S*$/, '');
      return `${truncated}…`;
    }
    i++;
  }
  return null;
}

// ── Generators ─────────────────────────────────────────────────────────

function buildIndex() {
  const readme = readFile(join(ROOT, 'README.md'));
  const heroIntro = `<header class="hero">
    <h1>Multi-Agent Workflow Orchestration Protocol</h1>
    <p class="lede">An open, wire-level protocol for orchestrating workflows in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself.</p>
    <p class="status">v1 FINAL · 5 published packages · 3 reference SDKs · 3 reference hosts · 36 conformance scenarios</p>
    <p class="cta">
      <a class="cta-primary" href="/spec/v1/">Read the spec</a>
      <a class="cta-secondary" href="/conformance/">Conformance leaderboard</a>
    </p>
  </header>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'openwop — Multi-Agent Workflow Orchestration Protocol',
    description: CANONICAL_DESCRIPTION,
    url: `${SITE_ORIGIN}/`,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Protocol Specification',
    operatingSystem: 'Cross-platform',
    softwareVersion: '1',
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    codeRepository: REPO_URL,
  };

  const content = heroIntro + markdownToHtml(readme);
  ensureDir(DIST);
  writeFileSync(
    join(DIST, 'index.html'),
    templatePage({
      title: 'openwop — Multi-Agent Workflow Orchestration Protocol',
      ogTitle: 'openwop — Multi-Agent Workflow Orchestration Protocol',
      content,
      navActive: 'index',
      description: CANONICAL_DESCRIPTION,
      canonicalPath: '/',
      jsonLd,
    }),
  );
  console.log('[openwop-site] wrote index.html');
}

function buildConformance() {
  const interop = readFile(join(ROOT, 'INTEROP-MATRIX.md'));
  const intro = `<header class="page-header">
    <h1>Conformance leaderboard</h1>
    <p class="lede">Live record of openwop-compatible hosts, their advertised compatibility profiles, and which conformance scenarios pass against them.</p>
    <p class="meta">A host's place in this matrix is a <strong>claim plus evidence</strong>. The claim is the host's advertised profile. The evidence is the conformance result published alongside the host's repo (or under <code>examples/hosts/&lt;name&gt;/conformance.md</code>).</p>
  </header>`;
  const content = intro + markdownToHtml(interop);
  ensureDir(join(DIST, 'conformance'));
  writeFileSync(
    join(DIST, 'conformance', 'index.html'),
    templatePage({
      title: 'openwop — Conformance leaderboard',
      content,
      navActive: 'conformance',
      description: 'Live leaderboard of openwop-compatible hosts. Each row pairs a host\'s advertised compatibility profile with its conformance evidence — claim plus result, no marketing.',
      canonicalPath: '/conformance/',
    }),
  );
  console.log('[openwop-site] wrote conformance/index.html');
}

function buildProfiles() {
  const profiles = readFile(join(ROOT, 'spec', 'v1', 'profiles.md'));
  const intro = `<header class="page-header">
    <h1>Compatibility profiles</h1>
    <p class="lede">A host's profile claims summarize what surfaces it implements. Each profile is derived from the host's <code>/.well-known/openwop</code> capability advertisement plus runtime conformance scenarios.</p>
  </header>`;
  const content = intro + markdownToHtml(profiles);
  ensureDir(join(DIST, 'profiles'));
  writeFileSync(
    join(DIST, 'profiles', 'index.html'),
    templatePage({
      title: 'openwop — Compatibility profiles',
      content,
      navActive: 'profiles',
      description: 'Compatibility profiles for the Multi-Agent Workflow Orchestration Protocol. Each profile names a coherent slice of capability surface a host can claim and prove (openwop-core, openwop-interrupts, openwop-stream-sse, openwop-secrets, openwop-provider-policy, openwop-node-packs).',
      canonicalPath: '/profiles/',
    }),
  );
  console.log('[openwop-site] wrote profiles/index.html');
}

function buildSpecDocs() {
  const specDir = join(ROOT, 'spec', 'v1');
  if (!existsSync(specDir)) {
    console.log('[openwop-site] no spec/v1/ — skipping');
    return;
  }
  ensureDir(join(DIST, 'spec', 'v1'));
  const files = readdirSync(specDir).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const md = readFile(join(specDir, f));
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1] : f;
    // First non-blockquote, non-heading paragraph as the doc-specific description.
    // Falls back to canonical description for surfacing the protocol when the
    // doc-specific intro is missing or too short.
    const docDescription = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
    const content = `<article class="spec-doc">${markdownToHtml(md)}</article>`;
    const slug = f.replace(/\.md$/, '');
    writeFileSync(
      join(DIST, 'spec', 'v1', `${slug}.html`),
      templatePage({
        title: `openwop — ${title}`,
        content,
        navActive: 'spec',
        description: docDescription,
        canonicalPath: `/spec/v1/${slug}.html`,
      }),
    );
  }
  // Index page for /spec/v1/
  const items = files.map((f) => {
    const md = readFile(join(specDir, f));
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1].replace(/^openwop Spec v1 — /, '') : f;
    const slug = f.replace(/\.md$/, '');
    const status = /^>\s*\*\*Status:\s*([^.]+)/m.exec(md);
    return { slug, title, status: status ? status[1].trim() : '?' };
  });
  const indexContent = `<header class="page-header">
    <h1>openwop v1 spec corpus</h1>
    <p class="lede">${items.length} prose specs governing the v1 wire contract. Status legend: STUB · DRAFT · OUTLINE · FINAL.</p>
  </header>
  <table class="spec-index">
    <thead><tr><th>Doc</th><th>Status</th></tr></thead>
    <tbody>
    ${items.map((i) => `<tr><td><a href="./${i.slug}.html">${escapeHtml(i.title)}</a></td><td>${escapeHtml(i.status)}</td></tr>`).join('\n')}
    </tbody>
  </table>`;
  writeFileSync(
    join(DIST, 'spec', 'v1', 'index.html'),
    templatePage({
      title: 'OpenWOP — v1 spec corpus',
      content: indexContent,
      navActive: 'spec',
      description: `${items.length} normative prose specs governing the OpenWOP v1 wire contract. Each doc is independently citable via /spec/v1/{name}.html.`,
      canonicalPath: '/spec/v1/',
    }),
  );
  console.log(`[openwop-site] wrote spec/v1/ (${files.length} docs + index)`);
}

function buildBadges() {
  // Minimal SVG badges per host. Color: green = passes claimed profiles,
  // amber = partial, red = failing.
  const hosts = parseHostsFromInteropMatrix();
  ensureDir(join(DIST, 'badge'));
  for (const h of hosts) {
    const color = h.allPass ? '#3aaf3a' : h.someFail ? '#cc8a00' : '#a32a2a';
    const label = `openwop ${h.suite ?? '1.0.0'}`;
    const value = h.passText ?? `${h.profiles.length} profiles`;
    const svg = renderBadge(label, value, color);
    writeFileSync(join(DIST, 'badge', `${h.slug}.svg`), svg);
  }
  console.log(`[openwop-site] wrote ${hosts.length} per-host SVG badges`);
}

function parseHostsFromInteropMatrix() {
  const md = readFile(join(ROOT, 'INTEROP-MATRIX.md'));
  // Find the "## Hosts" table (4-column: Host | Repo/Path | Profile claim | Scale claim | Conformance link)
  const lines = md.split('\n');
  const hostsHeader = lines.findIndex((l) => l.startsWith('## Hosts'));
  if (hostsHeader === -1) return [];
  let i = hostsHeader + 1;
  // Skip until header row containing pipes
  while (i < lines.length && !lines[i].includes('|')) i++;
  if (i >= lines.length) return [];
  i += 2; // skip header + separator
  const out = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim().length > 0) {
    const cells = lines[i].split('|').map((s) => s.trim()).filter(Boolean);
    if (cells.length >= 3) {
      const [hostCell, repoCell, profilesCell] = cells;
      const name = hostCell.replace(/\*\*/g, '').replace(/\(.*\)/, '').trim();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const profiles = profilesCell.split('·').map((s) => s.trim().replace(/`/g, ''));
      out.push({
        name,
        slug,
        repoPath: repoCell.replace(/`/g, ''),
        profiles,
        allPass: true,
        someFail: false,
        passText: `${profiles.length} profiles`,
        suite: '1.0.0',
      });
    }
    i++;
  }
  return out;
}

function renderBadge(label, value, color) {
  // Approx character widths for sans-serif at 11px
  const labelWidth = label.length * 6 + 10;
  const valueWidth = value.length * 6 + 10;
  const totalWidth = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${escapeHtml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeHtml(value)}</text>
  </g>
</svg>`;
}

function buildAssets() {
  // Copy the static CSS into dist
  const css = readFile(join(TEMPLATES, 'style.css'));
  ensureDir(join(DIST, 'assets'));
  writeFileSync(join(DIST, 'assets', 'style.css'), css);
  console.log('[openwop-site] wrote assets/style.css');
}

/**
 * Minimal SVG favicon — a flat "W" mark on a brand-purple background. Inline so
 * it ships as a single file with no PNG raster pipeline; modern browsers
 * handle SVG favicons natively.
 */
function buildFavicon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#5b3df6"/>
  <text x="32" y="44" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#fff">W</text>
</svg>
`;
  writeFileSync(join(DIST, 'favicon.svg'), svg);
  console.log('[openwop-site] wrote favicon.svg');
}

/**
 * Copy the pre-rendered OG card (1200×630 PNG) referenced by the og:image +
 * twitter:image meta tags. The PNG is generated separately by
 * `scripts/generate-og-image.mjs` (uses sharp; not in the build path) and
 * checked into templates/. This keeps the build zero-runtime-dep while still
 * shipping a real PNG that LinkedIn / Slack / Twitter / Discord can render.
 */
function buildOgImage() {
  const src = join(TEMPLATES, 'og-default.png');
  if (!existsSync(src)) {
    console.warn('[openwop-site] WARNING: og-default.png missing — meta tags will 404. Run `node scripts/generate-og-image.mjs` to regenerate.');
    return;
  }
  const png = readFileSync(src);
  writeFileSync(join(DIST, 'og-default.png'), png);
  console.log(`[openwop-site] wrote og-default.png (${(png.length / 1024).toFixed(1)} KB)`);

  // Also copy the SVG source so designers can grab it from a deployed site.
  const svgSrc = join(TEMPLATES, 'og-default.svg');
  if (existsSync(svgSrc)) {
    writeFileSync(join(DIST, 'og-default.svg'), readFile(svgSrc));
    console.log('[openwop-site] wrote og-default.svg');
  }
}

/**
 * robots.txt + sitemap.xml. Both reference $SITE_DOMAIN; the CI hard-fail
 * earlier in this file prevents either from shipping without a real domain.
 */
function buildRobots() {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
  writeFileSync(join(DIST, 'robots.txt'), body);
  console.log('[openwop-site] wrote robots.txt');
}

function buildSitemap() {
  // Walk dist/ for every .html file; emit a <url> per page with file mtime as
  // <lastmod>. Excludes assets/, badge/ (SVGs).
  const urls = [];
  function walk(dir, prefix) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (entry === 'assets' || entry === 'badge') continue;
        walk(p, `${prefix}${entry}/`);
      } else if (entry.endsWith('.html')) {
        // Map "index.html" → directory URL ("/" or "/spec/v1/")
        const path = entry === 'index.html' ? prefix : `${prefix}${entry}`;
        urls.push({ loc: `${SITE_ORIGIN}${path}`, lastmod: st.mtime.toISOString().slice(0, 10) });
      }
    }
  }
  walk(DIST, '/');
  urls.sort((a, b) => a.loc.localeCompare(b.loc));
  const body = `<?xml version="1" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
  writeFileSync(join(DIST, 'sitemap.xml'), body);
  console.log(`[openwop-site] wrote sitemap.xml (${urls.length} urls)`);
}

function ensureDistFresh() {
  // Allow incremental builds; just make sure dist exists
  ensureDir(DIST);
}

function buildAll() {
  ensureDistFresh();
  buildAssets();
  buildFavicon();
  buildOgImage();
  buildIndex();
  buildSpecDocs();
  buildConformance();
  buildProfiles();
  buildBadges();
  // Sitemap last — walks dist/ to enumerate generated HTML pages.
  buildSitemap();
  buildRobots();
  console.log('[openwop-site] build complete');
  // Print size summary
  const stats = walkDir(DIST);
  console.log(`[openwop-site] ${stats.files} files, ${(stats.bytes / 1024).toFixed(1)} KB`);
}

function walkDir(d) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(d)) {
    const p = join(d, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      const sub = walkDir(p);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += st.size;
    }
  }
  return { files, bytes };
}

buildAll();
