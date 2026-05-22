#!/usr/bin/env node
/**
 * OpenWOP site generator. Reads:
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
/**
 * Extract a flat ToC from markdown — every H2 and H3 with its slug.
 * Skips H1 (the page title is the H1) and deeper headings (noise in a sidebar).
 * Returns [{level, text, slug}, …] in document order.
 */
function extractToc(md) {
  const lines = md.split('\n');
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = m[2]
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim();
    const slug = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    headings.push({ level: m[1].length, text, slug });
  }
  return headings;
}

/**
 * Render an extracted ToC as a sticky left-rail aside. Wraps the supplied
 * article HTML in a 2-column grid so spec docs and RFCs get a navigable
 * sidebar without the template having to know about it. The active-section
 * highlighter lives in `site/templates/spec-toc.js` (copied to
 * `/assets/spec-toc.js` by `buildAssets()`); each wrapped page emits a
 * single `<script src="…" defer>` reference instead of inlining the
 * observer body per page.
 */
function wrapWithToc(articleHtml, toc, { tocTitle = 'On this page' } = {}) {
  if (!toc || toc.length < 3) {
    // Too few headings to justify the sidebar overhead.
    return articleHtml;
  }
  const items = toc.map((h) => {
    const cls = h.level === 3 ? 'toc-sub' : 'toc-top';
    return `<li class="${cls}"><a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a></li>`;
  }).join('\n      ');
  const tocHtml = `<aside class="spec-toc" aria-label="On this page">
    <h4>${escapeHtml(tocTitle)}</h4>
    <ul>
      ${items}
    </ul>
  </aside>`;
  // ToC first in source order so it lands in the left grid column on
  // desktop; on mobile the grid collapses and `order: 2` on .spec-toc
  // pushes it below the article so the primary content reads first.
  return `<div class="spec-page-grid">${tocHtml}${articleHtml}</div><script src="/assets/spec-toc.js" defer></script>`;
}

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
      // Brand-name normalization: when a heading STARTS with lowercase
      // "openwop " as a brand-prose mention (not an identifier inside
      // backticks or a URL), render it as "OpenWOP". Slug stays lowercase.
      // This is intentionally narrow — only word-boundary `openwop` at the
      // very start of a heading. Identifiers like `core.openwop.*` and
      // profile names like `openwop-core` are not affected.
      const displayText = heading[2].replace(/^openwop\b/, 'OpenWOP');
      const slug = heading[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${level} id="${slug}">${inline(displayText)}</h${level}>`);
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
    .replace(/\$\{nav_rfcs\}/g, navActive === 'rfcs' ? 'active' : '')
    .replace(/\$\{nav_conformance\}/g, navActive === 'conformance' ? 'active' : '')
    .replace(/\$\{nav_changelog\}/g, navActive === 'changelog' ? 'active' : '')
    .replace(/\$\{nav_faq\}/g, navActive === 'faq' ? 'active' : '')
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
  // Stats below are point-in-time as of 2026-05-18. Source counts:
  //   - 35 spec docs:        `ls spec/v1/*.md | wc -l`
  //   - 23 RFCs:             `ls RFCS/*.md` minus README + 0000-template
  //                          (14 Accepted, 8 Active, 2 Draft)
  //   - 82 pack versions:    `find registry/v1/packs -name "*.tgz" | wc -l`
  //                          across 62 unique pack names
  //   - 3 reference SDKs:    sdk/{typescript,python,go}
  //   - 4 reference hosts:   examples/hosts/{in-memory,sqlite,python,postgres}
  //   - 157 conformance scenarios: `ls conformance/src/scenarios/*.test.ts | wc -l`
  // Refresh quarterly or after a major batch lands.
  const heroIntro = `<header class="hero">
    <h1>Multi-Agent Workflow Orchestration Protocol</h1>
    <p class="lede">An open, wire-level protocol for orchestrating workflows in which LLM agents, deterministic tools, sub-workflows, and human reviewers collaborate, with durable suspend / resume, replay, version negotiation, and observability owned by the protocol itself.</p>
    <p class="status">v1.1 · 35 spec docs · 23 RFCs (14 Accepted) · 82 signed pack versions · 3 reference SDKs · 4 reference hosts · 157 conformance scenarios</p>
    <p class="cta">
      <a class="cta-primary" href="/spec/v1/">Read the spec</a>
      <a class="cta-secondary" href="/conformance/">Conformance leaderboard</a>
      <a class="cta-secondary" href="https://app.openwop.dev/">Try the live demo</a>
    </p>
    <section class="hero-recent">
      <h2 class="hero-recent-h">Recent on main</h2>
      <ul>
        <li><strong>RFC 0023 (Active)</strong> — Conformance agent-event emitters (<code>core.conformance.mock-agent</code> reference impl shipped 2026-05-18; live on <code>app.openwop.dev</code>).</li>
        <li><strong>RFC 0022 (Active)</strong> — <code>core.dispatch</code> + <code>core.subWorkflow</code> runtime variable mapping (<code>inputMapping</code> / <code>outputMapping</code> / per-worker variants).</li>
        <li><strong>RFC 0021 (Active)</strong> — AI Envelope primitive promoted DRAFT v1.x → FINAL v1.1; 4 universal kinds (<code>clarification.request</code>, <code>schema.request</code>, <code>schema.response</code>, <code>error</code>) with per-kind schemas + AIEnvelopeAcceptor reference impl.</li>
        <li><strong>RFC 0020 (Active)</strong> — Host-side MCP server composition; reference workflow-engine mounts an MCP server at <code>POST /v1/host/sample/mcp</code>; 6 behavioral conformance scenarios green.</li>
        <li><strong>RFCs 0014-0019 (Active)</strong> — Seven host capability surfaces (<code>host.fs</code>, <code>kvStorage</code>, <code>tableStorage</code>, <code>queueBus</code>, <code>sql</code>, <code>vector</code>, <code>blobStorage</code>, <code>cache</code>) advertised + behaviorally verified via opt-in test seam.</li>
        <li><strong>Phase 3 deploy</strong> — <code>app.openwop.dev</code> signed-in tier live: Firebase Auth (Google / GitHub), Cloud SQL Postgres for persistent runs/workflows, KMS-wrapped BYOK secrets.</li>
      </ul>
    </section>
  </header>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenWOP — Multi-Agent Workflow Orchestration Protocol',
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
      title: 'OpenWOP — Multi-Agent Workflow Orchestration Protocol',
      ogTitle: 'OpenWOP — Multi-Agent Workflow Orchestration Protocol',
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
    <p class="lede">Live record of OpenWOP-compatible hosts, their advertised compatibility profiles, and which conformance scenarios pass against them.</p>
    <p class="meta">A host's place in this matrix is a <strong>claim plus evidence</strong>. The claim is the host's advertised profile. The evidence is the conformance result published alongside the host's repo (or under <code>examples/hosts/&lt;name&gt;/conformance.md</code>).</p>
  </header>`;
  const articleHtml = `<article class="spec-doc">${intro}${markdownToHtml(interop)}</article>`;
  const content = wrapWithToc(articleHtml, extractToc(interop));
  ensureDir(join(DIST, 'conformance'));
  writeFileSync(
    join(DIST, 'conformance', 'index.html'),
    templatePage({
      title: 'OpenWOP — Conformance leaderboard',
      content,
      navActive: 'conformance',
      description: 'Live leaderboard of OpenWOP-compatible hosts. Each row pairs a host\'s advertised compatibility profile with its conformance evidence — claim plus result, no marketing.',
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
  const articleHtml = `<article class="spec-doc">${intro}${markdownToHtml(profiles)}</article>`;
  const content = wrapWithToc(articleHtml, extractToc(profiles));
  ensureDir(join(DIST, 'profiles'));
  writeFileSync(
    join(DIST, 'profiles', 'index.html'),
    templatePage({
      title: 'OpenWOP — Compatibility profiles',
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
    const articleHtml = `<article class="spec-doc">${markdownToHtml(md)}</article>`;
    const content = wrapWithToc(articleHtml, extractToc(md));
    const slug = f.replace(/\.md$/, '');
    const canonicalPath = `/spec/v1/${slug}.html`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description: docDescription,
      url: `${SITE_ORIGIN}${canonicalPath}`,
      inLanguage: 'en-US',
      isPartOf: { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'OpenWOP', url: SITE_ORIGIN },
      about: { '@type': 'SoftwareSourceCode', name: 'OpenWOP', url: SITE_ORIGIN, codeRepository: REPO_URL },
      author: { '@type': 'Organization', name: 'OpenWOP', url: SITE_ORIGIN },
      dependencies: 'JSON Schema 2020-12, REST + SSE + signed webhooks',
    };
    writeFileSync(
      join(DIST, 'spec', 'v1', `${slug}.html`),
      templatePage({
        title: `OpenWOP — ${title}`,
        content,
        navActive: 'spec',
        description: docDescription,
        canonicalPath,
        jsonLd,
      }),
    );
  }
  // Index page for /spec/v1/ — thematically grouped landing, not a flat table.
  // Each doc carries a one-line description extracted from its first paragraph.
  const items = files.map((f) => {
    const md = readFile(join(specDir, f));
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1].replace(/^openwop Spec v1 — /, '') : f;
    const slug = f.replace(/\.md$/, '');
    const status = /^>\s*\*\*Status:\s*([^.]+)/m.exec(md);
    const desc = extractFirstParagraph(md) ?? '';
    const shortDesc = desc.length > 180 ? desc.slice(0, 180).replace(/\s+\S*$/, '') + '…' : desc;
    return { slug, title, status: status ? status[1].trim() : '?', desc: shortDesc };
  });

  // Conceptual grouping. Order is intentional: foundation → runtime → agents →
  // humans → transports → security → ecosystem → operations → integration.
  // Docs not enumerated below fall into an "Other" bucket at the end so
  // nothing is silently dropped when a new doc lands.
  //
  // Convention: GROUPS.title is interpolated as raw HTML into the rendered
  // <h2> (see the `groupsHtml` template below — no escapeHtml on `${g.title}`),
  // so HTML entities like `&amp;` MUST be pre-escaped here. Plain markdown-doc
  // titles emitted via `buildMarkdownDoc({ pageTitle })` go through escapeHtml
  // at render time and must use a bare `&` — do NOT pre-escape those.
  const GROUPS = [
    {
      key: 'foundation',
      title: 'Foundation',
      lede: 'What OpenWOP is, what it isn\'t, and how a host advertises its surface.',
      slugs: ['positioning', 'capabilities', 'host-capabilities', 'profiles', 'capabilities-change-detection'],
    },
    {
      key: 'runtime',
      title: 'Run lifecycle &amp; state',
      lede: 'How a run starts, streams, suspends, resumes, replays, and ends.',
      slugs: ['run-options', 'replay', 'idempotency', 'channels-and-reducers', 'version-negotiation', 'stream-modes'],
    },
    {
      key: 'agents',
      title: 'Agents &amp; multi-agent execution',
      lede: 'Agent identity, memory, multi-agent execution model, envelope shapes.',
      slugs: ['agent-memory', 'agent-ref-positioning', 'multi-agent-execution', 'ai-envelope', 'structured-output-subset', 'prompts'],
    },
    {
      key: 'humans',
      title: 'Humans in the loop',
      lede: 'Interrupt the run for a human; resume when the answer arrives.',
      slugs: ['interrupt', 'interrupt-profiles'],
    },
    {
      key: 'transports',
      title: 'Wire transports',
      lede: 'REST, signed webhooks, gRPC, CloudEvents — the wire shapes carrying the protocol.',
      slugs: ['rest-endpoints', 'webhooks', 'grpc-transport', 'cloudevents-mapping'],
    },
    {
      key: 'security',
      title: 'Auth &amp; security',
      lede: 'API keys, OAuth2, OIDC, mTLS, BYOK secret resolution, redaction.',
      slugs: ['auth', 'auth-profiles'],
    },
    {
      key: 'ecosystem',
      title: 'Node packs &amp; registry',
      lede: 'Signed packs of reusable nodes + the registry that serves them.',
      slugs: ['node-packs', 'workflow-chain-packs', 'registry-operations'],
    },
    {
      key: 'production',
      title: 'Production posture &amp; operations',
      lede: 'The production profile, scale profiles, debug bundles, observability.',
      slugs: ['production-profile', 'scale-profiles', 'debug-bundle', 'observability', 'storage-adapters', 'host-extensions'],
    },
    {
      key: 'integration',
      title: 'Integration with adjacent protocols',
      lede: 'How OpenWOP composes with MCP, A2A, and the surrounding ecosystem.',
      slugs: ['mcp-integration', 'a2a-integration', 'compliance', 'i18n'],
    },
  ];

  const claimedSlugs = new Set(GROUPS.flatMap((g) => g.slugs));
  const ungrouped = items.filter((i) => !claimedSlugs.has(i.slug));
  if (ungrouped.length) {
    GROUPS.push({
      key: 'other',
      title: 'Other reference material',
      lede: 'Specs not grouped elsewhere. New additions land here until categorized.',
      slugs: ungrouped.map((i) => i.slug),
    });
  }

  const itemBySlug = new Map(items.map((i) => [i.slug, i]));

  const groupsHtml = GROUPS.map((g) => {
    const groupItems = g.slugs.map((s) => itemBySlug.get(s)).filter(Boolean);
    if (!groupItems.length) return '';
    return `<section class="spec-group">
  <h2 id="${g.key}">${g.title}</h2>
  <p class="spec-group-lede">${g.lede}</p>
  <ul class="spec-group-list">
    ${groupItems.map((i) => `<li>
      <a href="./${i.slug}.html"><strong>${escapeHtml(i.title)}</strong></a>
      <span class="spec-item-status">${escapeHtml(i.status)}</span>
      ${i.desc ? `<p class="spec-item-desc">${escapeHtml(i.desc)}</p>` : ''}
    </li>`).join('\n    ')}
  </ul>
</section>`;
  }).join('\n');

  // Build a ToC that matches the standard `wrapWithToc()` shape so the
  // /spec/v1/ index page uses the same sticky left-rail "On this page"
  // sidebar pattern as every other long-form page. Each thematic group
  // header is an <h2 id="${g.key}"> in groupsHtml, so the slug aligns
  // with the heading anchor.
  const indexToc = GROUPS
    .filter((g) => g.slugs.some((s) => itemBySlug.has(s)))
    .map((g) => ({ level: 2, text: g.title, slug: g.key }));

  const indexArticleHtml = `<article class="spec-doc">
    <header class="page-header">
      <h1>OpenWOP v1 spec corpus</h1>
      <p class="lede">${items.length} prose specs governing the v1 wire contract. Each section below groups specs by what they do; click through for the normative text.</p>
      <p class="meta">Status legend: <strong>FINAL</strong> · STUB · DRAFT · OUTLINE. A spec is FINAL when its wire shape is locked under v1.x compatibility rules.</p>
    </header>
    ${groupsHtml}
  </article>`;
  const indexContent = wrapWithToc(indexArticleHtml, indexToc);

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
  ensureDir(join(DIST, 'assets'));

  // Subpage stylesheet (page-header, .spec-doc, .spec-page-grid, etc.).
  const css = readFile(join(TEMPLATES, 'style.css'));
  writeFileSync(join(DIST, 'assets', 'style.css'), css);
  console.log('[openwop-site] wrote assets/style.css');

  // Sticky-ToC active-section highlighter — referenced by every page
  // wrapped via wrapWithToc(). Centralized here so a fix lands in ONE
  // place instead of ~80 inline copies. Cacheable across pages.
  const tocJs = readFile(join(TEMPLATES, 'spec-toc.js'));
  writeFileSync(join(DIST, 'assets', 'spec-toc.js'), tocJs);
  console.log('[openwop-site] wrote assets/spec-toc.js');
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

// ── Markdown-surfacing helpers ────────────────────────────────────────
//
// Most repo-root markdown docs (CHANGELOG, ROADMAP, COMPATIBILITY, SECURITY,
// CONTRIBUTING, GOVERNANCE) are well-formed enough to render directly via
// `markdownToHtml` and need only a route + a description + a nav-active key.
// `buildMarkdownDoc` exists so we don't repeat the same template wrapping
// once per generator.
//
// Note: every doc rendered this way must pass through the same sanitizing
// markdown renderer that the spec corpus uses — no raw HTML in source files.

function buildMarkdownDoc({ srcAbsPath, destPath, pageTitle, lede, navActive, canonicalPath, slugLabel }) {
  if (!existsSync(srcAbsPath)) {
    console.log(`[openwop-site] skip ${slugLabel} — ${srcAbsPath} not found`);
    return;
  }
  const md = readFile(srcAbsPath);
  const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
  const intro = `<header class="page-header">
    <h1>${escapeHtml(pageTitle)}</h1>
    <p class="lede">${escapeHtml(lede)}</p>
  </header>`;
  const articleHtml = `<article class="spec-doc">${markdownToHtml(md)}</article>`;
  const content = intro + wrapWithToc(articleHtml, extractToc(md));
  ensureDir(dirname(destPath));
  writeFileSync(
    destPath,
    templatePage({
      title: `OpenWOP — ${pageTitle}`,
      content,
      navActive,
      description,
      canonicalPath,
    }),
  );
  console.log(`[openwop-site] wrote ${slugLabel}`);
}

function buildChangelog() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'CHANGELOG.md'),
    destPath: join(DIST, 'changelog', 'index.html'),
    pageTitle: 'Changelog',
    lede: 'Versioned record of every change to the OpenWOP spec corpus, schemas, SDKs, and reference hosts. Additive evolution only within v1.x per COMPATIBILITY.md.',
    navActive: 'changelog',
    canonicalPath: '/changelog/',
    slugLabel: 'changelog/index.html',
  });
}

function buildRoadmap() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'ROADMAP.md'),
    destPath: join(DIST, 'roadmap', 'index.html'),
    pageTitle: 'Roadmap',
    lede: 'Gap-closure tracks the steward maintains in the open. No dates committed beyond the windows that have a CHANGELOG entry; the roadmap is direction, not promise.',
    navActive: '',
    canonicalPath: '/roadmap/',
    slugLabel: 'roadmap/index.html',
  });
}

function buildVersioning() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'COMPATIBILITY.md'),
    destPath: join(DIST, 'versioning', 'index.html'),
    pageTitle: 'Versioning & compatibility',
    lede: 'How OpenWOP changes between releases. Additive-only within v1.x; safety-fixes follow the 90-day window; breaking changes only land in major versions.',
    navActive: '',
    canonicalPath: '/versioning/',
    slugLabel: 'versioning/index.html',
  });
}

function buildSecurityPage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'SECURITY.md'),
    destPath: join(DIST, 'security', 'index.html'),
    pageTitle: 'Security posture',
    lede: 'Threat model, disclosure policy, and the public invariants every conformance-tested host must satisfy. Embargoed advisories go through the documented private channel before this page reflects them.',
    navActive: '',
    canonicalPath: '/security/',
    slugLabel: 'security/index.html',
  });
}

function buildContributingPage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'CONTRIBUTING.md'),
    destPath: join(DIST, 'contributing', 'index.html'),
    pageTitle: 'Contributing',
    lede: 'Per-artifact change rules for the OpenWOP corpus — what counts as editorial, additive, safety-fix, or breaking; the eight-step pre-merge gate; the DCO requirement.',
    navActive: '',
    canonicalPath: '/contributing/',
    slugLabel: 'contributing/index.html',
  });
}

function buildGovernancePage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'GOVERNANCE.md'),
    destPath: join(DIST, 'governance', 'index.html'),
    pageTitle: 'Governance',
    lede: 'How decisions get made. The bootstrap-phase amendment, maintainer-track expectations, and the cross-vendor working-group charter for v2.',
    navActive: '',
    canonicalPath: '/governance/',
    slugLabel: 'governance/index.html',
  });
}

// ── RFC corpus ─────────────────────────────────────────────────────────

function buildRfcs() {
  const rfcDir = join(ROOT, 'RFCS');
  if (!existsSync(rfcDir)) {
    console.log('[openwop-site] no RFCS/ — skipping');
    return;
  }
  const files = readdirSync(rfcDir).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
  ensureDir(join(DIST, 'rfcs'));

  const items = [];
  for (const f of files) {
    const md = readFile(join(rfcDir, f));
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1] : f.replace(/\.md$/, '');
    // RFCs declare status in one of three formats:
    //   1. Front-matter table row:   `| **Status** | \`Accepted\` |`
    //   2. Bold-prefixed heading:    `**Status:** Accepted` / `**Status:** \`Accepted\``
    //   3. Plain heading:            `Status: Accepted`
    // Try each pattern in order; first match wins.
    const status =
      /\|\s*\*\*Status\*\*\s*\|\s*`?([A-Za-z][A-Za-z0-9 -]*?)`?\s*\|/m.exec(md) ||
      /\*\*Status:\*\*\s*`?([A-Za-z][A-Za-z0-9 -]*?)`?(?:\s|$)/m.exec(md) ||
      /^Status:\s*`?([A-Za-z][A-Za-z0-9 -]*?)`?\s*$/m.exec(md);
    const slug = f.replace(/\.md$/, '');
    const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
    const articleHtml = `<article class="spec-doc">${markdownToHtml(md)}</article>`;
    const content = wrapWithToc(articleHtml, extractToc(md));
    writeFileSync(
      join(DIST, 'rfcs', `${slug}.html`),
      templatePage({
        title: `OpenWOP — ${title}`,
        content,
        navActive: 'rfcs',
        description,
        canonicalPath: `/rfcs/${slug}.html`,
      }),
    );
    items.push({ slug, title, status: status ? status[1].trim() : '?' });
  }

  const indexContent = `<header class="page-header">
    <h1>OpenWOP RFCs</h1>
    <p class="lede">${items.length} RFCs governing additive evolution of the v1 protocol. Status legend: Draft (open comment window) → Active (accepted; impl follows) → Accepted (in-tree reference impl + conformance scenarios) → Withdrawn / Superseded.</p>
  </header>
  <table class="spec-index">
    <thead><tr><th>RFC</th><th>Status</th></tr></thead>
    <tbody>
    ${items.map((i) => `<tr><td><a href="./${i.slug}.html">${escapeHtml(i.title)}</a></td><td>${escapeHtml(i.status)}</td></tr>`).join('\n')}
    </tbody>
  </table>`;
  writeFileSync(
    join(DIST, 'rfcs', 'index.html'),
    templatePage({
      title: 'OpenWOP — RFCs',
      content: indexContent,
      navActive: 'rfcs',
      description: `${items.length} numbered RFCs covering the additive evolution of the OpenWOP v1 protocol. Each RFC documents motivation, proposed wire surface, compatibility classification, conformance plan, and acceptance gate.`,
      canonicalPath: '/rfcs/',
    }),
  );
  console.log(`[openwop-site] wrote rfcs/ (${items.length} RFCs + index)`);
}

// ── Site content (FAQ + audience landing pages) ────────────────────────

function buildContentDir() {
  const contentDir = join(SITE_DIR, 'content');
  if (!existsSync(contentDir)) {
    console.log('[openwop-site] no site/content/ — skipping');
    return;
  }
  // Conventions:
  //   site/content/{slug}.md           → /{slug}/index.html
  //   site/content/for/{role}.md       → /for/{role}/index.html
  // Each file MUST start with an H1 (title) followed by a paragraph (lede).
  const ROUTES = [
    { src: 'faq.md',                          dest: ['faq'],                          nav: 'faq', label: 'FAQ' },
    { src: 'errors.md',                       dest: ['errors'],                       nav: '',    label: 'Error codes' },
    { src: 'scenarios.md',                    dest: ['scenarios'],                    nav: '',    label: 'Scenario walkthroughs' },
    { src: 'for/workflow-authors.md',         dest: ['for', 'workflow-authors'],      nav: '',    label: 'For workflow authors' },
    { src: 'for/host-implementers.md',        dest: ['for', 'host-implementers'],     nav: '',    label: 'For host implementers' },
    { src: 'for/pack-authors.md',             dest: ['for', 'pack-authors'],          nav: '',    label: 'For pack authors' },
    { src: 'for/production-evaluators.md',    dest: ['for', 'production-evaluators'], nav: '',    label: 'For production evaluators' },
  ];
  for (const r of ROUTES) {
    const srcAbsPath = join(contentDir, ...r.src.split('/'));
    if (!existsSync(srcAbsPath)) continue;
    const md = readFile(srcAbsPath);
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1] : r.label;
    const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
    const articleHtml = `<article class="spec-doc">${markdownToHtml(md)}</article>`;
    const content = wrapWithToc(articleHtml, extractToc(md));
    const destDir = join(DIST, ...r.dest);
    ensureDir(destDir);
    const canonicalPath = `/${r.dest.join('/')}/`;
    writeFileSync(
      join(destDir, 'index.html'),
      templatePage({
        title: `OpenWOP — ${title}`,
        content,
        navActive: r.nav,
        description,
        canonicalPath,
      }),
    );
    console.log(`[openwop-site] wrote ${r.dest.join('/')}/index.html`);
  }
}

// ── REST API explorer (Redoc, self-hosted bundle) ─────────────────────

function buildApiExplorer() {
  // Self-hosted Redoc standalone bundle: copied into
  // public/assets/redoc.standalone.js by the build script. We previously
  // tried switching to Scalar to drop Redoc's empty-when-no-endpoint-is-
  // selected right panel; Scalar didn't resolve our cross-file
  // ../schemas/*.json $refs and rendered broken. Reverted.
  //
  // The right-panel UX problem is fixed by HIDING the panel via CSS
  // (theme: rightPanel.width 0%) — keeps Redoc's reliable schema +
  // endpoint rendering while dropping the dead column.
  ensureDir(join(DIST, 'api', 'rest'));
  const intro = `<div class="api-explorer">
    <header class="api-explorer-head">
      <div class="api-explorer-title">
        <span class="api-explorer-kicker">REST API</span>
        <h1>OpenWOP wire reference</h1>
      </div>
      <div class="api-explorer-meta">
        <button class="api-explorer-base" type="button" data-copy="/v1" title="Copy base path">
          <span class="api-explorer-base-label">base</span>
          <code>/v1</code>
          <span class="api-explorer-base-hint" aria-hidden="true">copy</span>
        </button>
        <a class="api-explorer-download" href="/api/openapi.yaml" download="openwop-openapi.yaml">
          <span>Download OpenAPI</span>
          <span aria-hidden="true">↓</span>
        </a>
      </div>
    </header>
    <div id="redoc-container"></div>
    <script src="/assets/redoc.standalone.js"></script>
    <script>
      (function () {
        var copyBtn = document.querySelector('.api-explorer-base');
        if (copyBtn) {
          copyBtn.addEventListener('click', function () {
            var v = copyBtn.getAttribute('data-copy') || '';
            if (navigator.clipboard) navigator.clipboard.writeText(v);
            var hint = copyBtn.querySelector('.api-explorer-base-hint');
            if (hint) { var prev = hint.textContent; hint.textContent = 'copied'; setTimeout(function () { hint.textContent = prev; }, 1400); }
          });
        }
        if (typeof Redoc !== 'undefined' && Redoc.init) {
          Redoc.init('/api/openapi.yaml', {
            scrollYOffset: 56,
            hideDownloadButton: true,
            disableSearch: false,
            // The right code-samples panel stays, but is tuned to the
            // brand: warm paper-2 background (was near-black), narrower
            // 32% width (was 38%), ink text (was light-on-dark). When
            // an endpoint is selected Redoc populates it with the
            // request/response sample; on the overview page it sits
            // empty but blends into the page rather than reading as a
            // separate dark slab.
            theme: {
              colors: { primary: { main: '#b05a3b' } },
              typography: {
                fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
                headings: { fontFamily: 'Instrument Serif, Georgia, serif' },
              },
              sidebar: { backgroundColor: '#f4f1ea', width: '280px' },
              rightPanel: {
                backgroundColor: '#ece8de',  // var(--paper-2)
                textColor: '#1a1a17',        // var(--ink)
                width: '40%',
              },
              codeBlock: {
                backgroundColor: '#1a1a17',  // code blocks stay dark for legibility
              },
            },
          }, document.getElementById('redoc-container'));
        } else {
          document.getElementById('redoc-container').innerHTML =
            '<div style="padding: 48px; text-align: center;">Redoc bundle did not load. Raw spec: <a href="/api/openapi.yaml">/api/openapi.yaml</a>.</div>';
        }
      })();
    </script>
  </div>`;
  writeFileSync(
    join(DIST, 'api', 'rest', 'index.html'),
    templatePage({
      title: 'OpenWOP — REST API reference',
      content: intro,
      navActive: 'spec',
      description: 'Live REST API reference rendered from api/openapi.yaml. Every OpenWOP endpoint with request, response, and error codes — claim is the spec, this is the readable view.',
      canonicalPath: '/api/rest/',
    }),
  );
  console.log('[openwop-site] wrote api/rest/index.html');
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
  // Repo-root markdown surfaced as site pages (one-line credibility wins).
  buildChangelog();
  buildRoadmap();
  buildVersioning();
  buildSecurityPage();
  buildContributingPage();
  buildGovernancePage();
  // RFC corpus — index + per-RFC pages.
  buildRfcs();
  // Net-new content authored under site/content/ (FAQ + audience pages).
  buildContentDir();
  // REST API explorer (Redoc, self-hosted bundle).
  buildApiExplorer();
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
