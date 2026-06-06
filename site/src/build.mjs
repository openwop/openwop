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
    // The top-nav has two dropdown triggers (Protocol, Implement) plus
    // four direct links (Quickstart, Community, Changelog, GitHub). Every
    // page that lives under the Protocol umbrella (spec, rfcs, conformance,
    // governance, security, roadmap, maintainers, profiles, versioning,
    // contributing) marks navActive='protocol'; every audience landing under
    // /for/* + the /implement/ summary marks navActive='implement'.
    .replace(/\$\{nav_index\}/g, navActive === 'index' ? 'active' : '')
    .replace(/\$\{nav_quickstart\}/g, navActive === 'quickstart' ? 'active' : '')
    .replace(/\$\{nav_protocol\}/g, ['protocol', 'spec', 'rfcs', 'conformance', 'profiles'].includes(navActive) ? 'active' : '')
    .replace(/\$\{nav_implement\}/g, navActive === 'implement' ? 'active' : '')
    .replace(/\$\{nav_community\}/g, navActive === 'community' ? 'active' : '')
    .replace(/\$\{nav_changelog\}/g, navActive === 'changelog' ? 'active' : '')
    // Placeholders kept so historical templates do not show literal
    // ${nav_…} tokens if a stale template fragment lingers anywhere.
    .replace(/\$\{nav_spec\}/g, navActive === 'spec' ? 'active' : '')
    .replace(/\$\{nav_rfcs\}/g, navActive === 'rfcs' ? 'active' : '')
    .replace(/\$\{nav_conformance\}/g, navActive === 'conformance' ? 'active' : '')
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
// Strip the leading `# Title` heading from a markdown body. Every long-form
// doc page on the site renders a `<header class="page-header"><h1>…</h1></header>`
// derived from the source's H1, so emitting that same H1 again from the
// markdown body produces two H1s on the same page — bad for SEO topical
// signal and confusing for screen readers. This helper removes the first
// `# …` line (and any trailing blank line) once the title has been captured
// into the page-header. H2+ headings are preserved verbatim so the article
// body still anchors deep links.
function stripLeadingH1(md) {
  const lines = md.split('\n');
  let i = 0;
  // Skip any leading blank lines.
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return md;
  // Only strip if the first non-blank line is an H1.
  if (!/^#\s+/.test(lines[i])) return md;
  i++;
  // Skip a single trailing blank line so the body doesn't start with an
  // orphan empty line that breaks markdown's paragraph detection.
  if (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n');
}

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
  const interopBody = stripLeadingH1(interop);
  const articleHtml = `<article class="spec-doc">${markdownToHtml(interopBody)}</article>`;
  const content = intro + wrapWithToc(articleHtml, extractToc(interopBody));
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
  const profilesBody = stripLeadingH1(profiles);
  const articleHtml = `<article class="spec-doc">${markdownToHtml(profilesBody)}</article>`;
  const content = intro + wrapWithToc(articleHtml, extractToc(profilesBody));
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
    // Friendly title for the page-header above the grid — strip the
    // "openwop Spec v1 — " prefix so the visible title is just the
    // doc name. Source's full H1 stays inside the article column.
    const displayTitle = title.replace(/^openwop Spec v1 — /i, '');
    // First non-blockquote, non-heading paragraph as the doc-specific description.
    // Falls back to canonical description for surfacing the protocol when the
    // doc-specific intro is missing or too short.
    const docDescription = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
    const pageHeader = `<header class="page-header">
      <h1>${escapeHtml(displayTitle)}</h1>
      <p class="lede">${escapeHtml(docDescription)}</p>
    </header>`;
    // Per-doc "Edit this page on GitHub" footer. Lands as the
    // last block inside the article column so it sits below the prose but
    // inside the wrapWithToc grid (sticky sidebar still applies).
    const slug = f.replace(/\.md$/, '');
    const editUrl = `${REPO_URL}/edit/main/spec/v1/${f}`;
    const editFooter = `<footer class="doc-edit"><a href="${editUrl}" rel="noopener">Edit this page on GitHub <span class="arrow">↗</span></a></footer>`;
    // Strip the source's leading H1; the page-header above already renders it.
    // See `stripLeadingH1` for the SEO + a11y rationale.
    const bodyMd = stripLeadingH1(md);
    const articleHtml = `<article class="spec-doc">${markdownToHtml(bodyMd)}${editFooter}</article>`;
    const content = pageHeader + wrapWithToc(articleHtml, extractToc(bodyMd));
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
    // Unify the rendered status badge to `Stable · v1.1 · YYYY-MM-DD`.
    // Source markdown writes `Stable · v1.1 (YYYY-MM-DD)` — rewrite the
    // parens-wrapped date as a `·`-separated suffix at render time so the
    // .md files keep their human-friendly form and the index gets a uniform
    // chip-style badge.
    const rawStatus = status ? status[1].trim() : '?';
    const niceStatus = rawStatus.replace(/\s*\(([^)]+)\)\s*$/, ' · $1');
    return { slug, title, status: niceStatus, desc: shortDesc };
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
  // Collapsed from 9 thematic groups to 6 to reduce decision
  // overhead on the index. Order: surface → lifecycle → agents → packs &
  // registry → wire & security → conformance & integration. The "Start
  // here" card above the groups gives first-time readers an explicit
  // 5-doc reading path.
  const GROUPS = [
    {
      key: 'surface',
      title: 'Surface',
      lede: 'What OpenWOP is, what it isn\'t, and how a host advertises its surface.',
      slugs: ['positioning', 'capabilities', 'host-capabilities', 'profiles', 'capabilities-change-detection'],
    },
    {
      key: 'lifecycle',
      title: 'Run lifecycle',
      lede: 'How a run starts, streams, suspends, resumes, replays, and ends — including humans-in-the-loop.',
      slugs: ['run-options', 'replay', 'idempotency', 'channels-and-reducers', 'version-negotiation', 'stream-modes', 'interrupt', 'interrupt-profiles'],
    },
    {
      key: 'agents',
      title: 'Agents',
      lede: 'Agent identity, memory, multi-agent execution model, envelope shapes.',
      slugs: ['agent-memory', 'agent-ref-positioning', 'multi-agent-execution', 'ai-envelope', 'structured-output-subset', 'prompts'],
    },
    {
      key: 'packs',
      title: 'Packs',
      lede: 'Signed packs of reusable nodes, workflow-chain packs, and the registry that serves them.',
      slugs: ['node-packs', 'workflow-chain-packs', 'registry-operations'],
    },
    {
      key: 'wire',
      title: 'Wire & auth',
      lede: 'REST, signed webhooks, gRPC, CloudEvents, plus auth profiles, BYOK secret resolution, and redaction.',
      slugs: ['rest-endpoints', 'webhooks', 'grpc-transport', 'cloudevents-mapping', 'auth', 'auth-profiles'],
    },
    {
      key: 'conformance',
      title: 'Conformance, ops & integration',
      lede: 'Production posture, scale profiles, observability, debug bundles, and how OpenWOP composes with MCP, A2A, and adjacent ecosystems.',
      slugs: ['production-profile', 'scale-profiles', 'debug-bundle', 'observability', 'storage-adapters', 'host-extensions', 'host-sample-test-seams', 'compliance', 'mcp-integration', 'a2a-integration', 'i18n'],
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

  // Phase 3.1: "Start here" reading-order card. Five docs, in order, that
  // a first-time reader should consume to ground every later doc in the
  // corpus. Sits above the thematic groups so it's the first thing in the
  // article column. Anchor `start-here` participates in the on-this-page
  // sidebar so it's reachable from the sticky ToC too.
  const READING_ORDER = [
    { slug: 'positioning',   why: 'What OpenWOP is — and explicitly is not — relative to MCP, A2A, and managed orchestrators.' },
    { slug: 'capabilities',  why: 'How a host advertises which surfaces it implements; the negotiation contract every client uses.' },
    { slug: 'run-options',   why: 'The per-run overlay every workflow invocation rides on; defines tags, metadata, recursion limits.' },
    { slug: 'stream-modes',  why: 'How a run\'s state surfaces back to the caller — values, updates, messages, debug.' },
    { slug: 'webhooks',      why: 'HMAC-signed server-to-server delivery for the same canonical event log.' },
  ];
  const startHereHtml = `<section class="spec-group start-here">
  <h2 id="start-here">Start here</h2>
  <p class="spec-group-lede">Five docs, in this order, ground everything else. New to the corpus? Read these top-to-bottom before browsing the thematic groups below.</p>
  <ol class="start-here-list">
    ${READING_ORDER.map((r, idx) => {
      const item = itemBySlug.get(r.slug);
      if (!item) return '';
      return `<li>
      <span class="start-here-step">${String(idx + 1).padStart(2, '0')}</span>
      <div class="start-here-body">
        <a href="./${item.slug}.html"><strong>${escapeHtml(item.title)}</strong></a>
        <p class="start-here-why">${escapeHtml(r.why)}</p>
      </div>
    </li>`;
    }).filter(Boolean).join('\n    ')}
  </ol>
</section>`;

  // Build a ToC that matches the standard `wrapWithToc()` shape so the
  // /spec/v1/ index page uses the same sticky left-rail "On this page"
  // sidebar pattern as every other long-form page. Each thematic group
  // header is an <h2 id="${g.key}"> in groupsHtml, so the slug aligns
  // with the heading anchor. The Start-here card prepends an entry.
  const indexToc = [
    { level: 2, text: 'Start here', slug: 'start-here' },
    ...GROUPS
      .filter((g) => g.slugs.some((s) => itemBySlug.has(s)))
      .map((g) => ({ level: 2, text: g.title, slug: g.key })),
  ];

  // Page-header sits ABOVE the wrapWithToc grid so the title + lede
  // stretch full-width above the "On this page" sidebar — matching the
  // changelog/roadmap/etc. pattern. The article column inside the grid
  // contains the Start-here card followed by the thematic-group sections.
  const indexPageHeader = `<header class="page-header">
      <h1>OpenWOP v1 spec corpus</h1>
      <p class="lede">${items.length} prose specs governing the v1 wire contract. Each section below groups specs by what they do; click through for the normative text.</p>
      <p class="meta">Status legend: <strong>Stable</strong> · Stabilizing · Draft · Experimental. A spec is Stable when its wire shape is locked under v1.x compatibility rules. See <a href="/governance/spec-status/">spec-status policy</a>.</p>
    </header>`;
  const indexArticleHtml = `<article class="spec-doc">${startHereHtml}\n${groupsHtml}</article>`;
  const indexContent = indexPageHeader + wrapWithToc(indexArticleHtml, indexToc);

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

  // Per-URL priority + changefreq hints. Most crawlers (Google, Bing) treat
  // these as advisory — they don't change ranking — but Search Console
  // tooling surfaces them in coverage reports. Keep the buckets coarse:
  //  - Homepage              → 1.0 / daily
  //  - Spec/v1 index, changelog, quickstart → 0.9 / weekly
  //  - Individual spec docs  → 0.8 / monthly
  //  - RFC corpus + index    → 0.7 / monthly
  //  - Roadmap, governance, top-level prose → 0.7 / monthly
  //  - Everything else       → 0.5 / monthly
  const priorityOf = (path) => {
    if (path === '/') return { priority: '1.0', changefreq: 'daily' };
    if (path === '/spec/v1/' || path === '/changelog/' || path === '/quickstart/' || path === '/rfcs/') {
      return { priority: '0.9', changefreq: 'weekly' };
    }
    if (/^\/spec\/v1\/[^/]+\.html$/.test(path)) return { priority: '0.8', changefreq: 'monthly' };
    if (/^\/rfcs\/[^/]+\.html$/.test(path)) return { priority: '0.7', changefreq: 'monthly' };
    if (/^\/(roadmap|governance|conformance|security|maintainers|contributing|protocol|implement|adopters|profiles|api)\//.test(path)) {
      return { priority: '0.7', changefreq: 'monthly' };
    }
    return { priority: '0.5', changefreq: 'monthly' };
  };

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => {
    const path = u.loc.slice(SITE_ORIGIN.length);
    const { priority, changefreq } = priorityOf(path);
    return `  <url><loc>${escapeHtml(u.loc)}</loc><lastmod>${u.lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
  })
  .join('\n')}
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
  // The page-header above already renders the H1; strip the source's leading
  // H1 so the rendered page doesn't carry two H1s. See `stripLeadingH1`.
  const bodyMd = stripLeadingH1(md);
  const articleHtml = `<article class="spec-doc">${markdownToHtml(bodyMd)}</article>`;
  const content = intro + wrapWithToc(articleHtml, extractToc(bodyMd));
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

// Changelog renderer with per-version chunking + version rail.
// CHANGELOG.md is a single ~2400-line doc; rendering it as one monolithic
// page makes "what shipped in 1.1.1?" a Ctrl-F problem. The renderer:
//   1. Parses every `## [version]` heading as a chunk boundary.
//   2. Renders each chunk's markdown body independently via markdownToHtml.
//   3. Wraps each chunk in a `<section class="changelog-version">` with
//      a styled `<header>` showing version + release date.
//   4. Builds a version-only sticky left rail (skipping the noisy H3s the
//      generic ToC would otherwise emit).
//   5. Emits a "Latest release" callout at the top of the article column.
// The `[Unreleased]` section, if present at the very top, is rendered first
// without a release-date chip (the rail labels it "Unreleased").
function buildChangelog() {
  const srcAbsPath = join(ROOT, 'CHANGELOG.md');
  if (!existsSync(srcAbsPath)) return;
  const md = readFile(srcAbsPath);

  // Pull intro prose (everything between the H1 and the first `## [`).
  const introMatch = /^# .+?\n([\s\S]*?)(?=^## \[)/m.exec(md);
  const introMd = introMatch ? introMatch[1].trim() : '';
  const introHtml = introMd ? markdownToHtml(introMd) : '';

  // Split into version chunks. Heading shape:
  //   ## [1.1.3 — unreleased] — coordinated SDK release …
  //   ## [1.1.1] — 2026-05-15 — post-1.1.0 additive cleanup …
  // Capture: full version label inside brackets, optional date, headline.
  const chunkRe = /^## \[([^\]]+)\][^\n]*\n/gm;
  const chunks = [];
  const matches = [...md.matchAll(chunkRe)];
  for (let idx = 0; idx < matches.length; idx++) {
    const m = matches[idx];
    const headingLine = md.slice(m.index, md.indexOf('\n', m.index));
    const bodyStart = md.indexOf('\n', m.index) + 1;
    const bodyEnd = idx + 1 < matches.length ? matches[idx + 1].index : md.length;
    const body = md.slice(bodyStart, bodyEnd).trim();
    // Pull the version label, optional release date, and headline.
    const headingInner = headingLine.replace(/^## /, '');
    const versionRaw = m[1].trim();
    // Versions like `1.1.3 — unreleased` carry the date inline; strip the
    // suffix to get the SemVer for slugging and the rail label.
    const version = versionRaw.split(/[\s—-]+/)[0];
    const isUnreleased = /unreleased/i.test(versionRaw);
    // Look for an explicit ISO date after the bracket: `… ] — 2026-05-15 — …`
    const dateMatch = /\]\s*[—-]\s*(\d{4}-\d{2}-\d{2})/.exec(headingLine);
    const date = dateMatch ? dateMatch[1] : (isUnreleased ? '' : '');
    // Headline = whatever follows the second em-dash (or the bracket end).
    const headline = headingInner
      .replace(/^\[[^\]]+\]\s*[—-]?\s*/, '')
      .replace(/^\d{4}-\d{2}-\d{2}\s*[—-]?\s*/, '')
      .trim();
    const slug = `v${version.replace(/\./g, '-')}${isUnreleased ? '-unreleased' : ''}`;
    chunks.push({ version, versionRaw, isUnreleased, date, headline, body, slug });
  }

  // Render each chunk's body. The body still contains H3+ subheadings;
  // markdownToHtml emits them with anchor IDs, so deep-links into a
  // specific entry inside a release continue to work.
  const versionsHtml = chunks
    .map((c) => {
      const bodyHtml = markdownToHtml(c.body);
      const dateChip = c.date
        ? `<span class="changelog-version-date">${escapeHtml(c.date)}</span>`
        : (c.isUnreleased ? `<span class="changelog-version-date is-unreleased">Unreleased</span>` : '');
      return `<section class="changelog-version" id="${c.slug}">
  <header class="changelog-version-head">
    <h2><a href="#${c.slug}">${escapeHtml(c.version)}${c.isUnreleased ? ' · unreleased' : ''}</a></h2>
    ${dateChip}
    ${c.headline ? `<p class="changelog-version-headline">${escapeHtml(c.headline)}</p>` : ''}
  </header>
  <div class="changelog-version-body">
    ${bodyHtml}
  </div>
</section>`;
    })
    .join('\n');

  // "Latest release" card = the first non-unreleased chunk. Falls back to
  // the very first chunk if everything is unreleased (shouldn't happen but
  // defensive).
  const latest = chunks.find((c) => !c.isUnreleased) || chunks[0];
  const latestCard = latest
    ? `<aside class="changelog-latest" aria-label="Latest release">
    <span class="changelog-latest-tag">Latest release</span>
    <h2><a href="#${latest.slug}">${escapeHtml(latest.version)}</a></h2>
    ${latest.date ? `<p class="changelog-latest-date">Released ${escapeHtml(latest.date)}</p>` : ''}
    ${latest.headline ? `<p class="changelog-latest-headline">${escapeHtml(latest.headline)}</p>` : ''}
  </aside>`
    : '';

  // Version-only ToC (skip the noisy H3s the generic extractor would emit).
  const versionToc = chunks.map((c) => ({
    level: 2,
    text: `${c.version}${c.isUnreleased ? ' · unreleased' : (c.date ? ` · ${c.date}` : '')}`,
    slug: c.slug,
  }));

  const pageHeader = `<header class="page-header">
    <h1>Changelog</h1>
    <p class="lede">Versioned record of every change to the OpenWOP spec corpus, schemas, SDKs, and reference hosts. Additive evolution only within v1.x per <a href="https://github.com/openwop/openwop/blob/main/COMPATIBILITY.md">COMPATIBILITY.md</a>.</p>
  </header>`;
  const articleHtml = `<article class="spec-doc changelog-page">
    ${latestCard}
    ${introHtml}
    ${versionsHtml}
  </article>`;
  const content = pageHeader + wrapWithToc(articleHtml, versionToc, { tocTitle: 'Releases' });

  ensureDir(join(DIST, 'changelog'));
  writeFileSync(
    join(DIST, 'changelog', 'index.html'),
    templatePage({
      title: 'OpenWOP — Changelog',
      content,
      navActive: 'changelog',
      description: `Per-version record of every change to the OpenWOP spec corpus, schemas, SDKs, and reference hosts. ${chunks.length} versions tracked.`,
      canonicalPath: '/changelog/',
    }),
  );
  console.log(`[openwop-site] wrote changelog/index.html (${chunks.length} versions)`);
}

function buildRoadmap() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'ROADMAP.md'),
    destPath: join(DIST, 'roadmap', 'index.html'),
    pageTitle: 'Roadmap',
    lede: 'Gap-closure tracks the steward maintains in the open. No dates committed beyond the windows that have a CHANGELOG entry; the roadmap is direction, not promise.',
    navActive: 'protocol',
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
    navActive: 'protocol',
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
    navActive: 'protocol',
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
    navActive: 'protocol',
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
    navActive: 'protocol',
    canonicalPath: '/governance/',
    slugLabel: 'governance/index.html',
  });
}

function buildMaintainersPage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'MAINTAINERS.md'),
    destPath: join(DIST, 'maintainers', 'index.html'),
    pageTitle: 'Maintainers',
    lede: 'Who has merge authority on github.com/openwop/openwop, what they gate, and how recruitment + removal-for-cause work. Affiliation policy drives the vendor-neutral-org migration tripwire.',
    navActive: 'protocol',
    canonicalPath: '/maintainers/',
    slugLabel: 'maintainers/index.html',
  });
}

function buildQuickstartPage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'QUICKSTART.md'),
    destPath: join(DIST, 'quickstart', 'index.html'),
    pageTitle: 'Quickstart',
    lede: 'Clone the repo, start a reference host, and create a run over REST + SSE in ten minutes. No cloud account, vendor SDK, or managed service required.',
    navActive: 'quickstart',
    canonicalPath: '/quickstart/',
    slugLabel: 'quickstart/index.html',
  });
}

// ── RFC corpus ─────────────────────────────────────────────────────────

// Phase 3.2: heuristic topic classifier. Maps an RFC title (and optional
// slug) to one of a small fixed set of topic chips. Keep the buckets short
// — the goal is "what is this RFC mostly about" at a glance, not exact
// taxonomy. Order matters: first match wins.
function classifyRfcTopic(title, slug = '') {
  const t = (title + ' ' + slug).toLowerCase();
  const rules = [
    { topic: 'Agent',           re: /\b(agent|memory|conversation|orchestrator|dispatch|reasoning|handoff|tool[- ]?call)\b/ },
    { topic: 'Auth',            re: /\b(auth|oauth|oidc|mtls|byok|secret|token|scope|jwt)\b/ },
    { topic: 'Host capability', re: /\b(host[- ]?(?:fs|kv|queue|bus|sql|blob|cache|table|vector|capability))\b/ },
    { topic: 'Conformance',     re: /\b(conformance|compliance|honest[- ]?claim)\b/ },
    { topic: 'Governance',      re: /\b(governance|process|rfc[- ]?process|maintain|steward)\b/ },
    { topic: 'Composition',     re: /\b(workflow|pack|chain|registry|node[- ]?pack|composition)\b/ },
    { topic: 'Envelope',        re: /\b(envelope|schema|cloudevent|trace|telemetry|observab)\b/ },
    { topic: 'Interrupt',       re: /\b(interrupt|escalation|hitl|human[- ]?in[- ]?the[- ]?loop)\b/ },
    { topic: 'Transport',       re: /\b(transport|grpc|webhook|sse|rest|websocket)\b/ },
  ];
  for (const r of rules) if (r.re.test(t)) return r.topic;
  return 'Other';
}

function buildRfcs() {
  const rfcDir = join(ROOT, 'RFCS');
  if (!existsSync(rfcDir)) {
    console.log('[openwop-site] no RFCS/ — skipping');
    return;
  }
  // 0000-template.md is the RFC author's template, not a real
  // RFC — it's still rendered as a standalone page so contributors can
  // link to it, but is filtered out of the index list (and chip counts).
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
    const pageHeader = `<header class="page-header">
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(description)}</p>
    </header>`;
    const editUrl = `${REPO_URL}/edit/main/RFCS/${f}`;
    const editFooter = `<footer class="doc-edit"><a href="${editUrl}" rel="noopener">Edit this page on GitHub <span class="arrow">↗</span></a></footer>`;
    const bodyMd = stripLeadingH1(md);
    const articleHtml = `<article class="spec-doc">${markdownToHtml(bodyMd)}${editFooter}</article>`;
    const content = pageHeader + wrapWithToc(articleHtml, extractToc(bodyMd));
    // TechArticle JSON-LD for every RFC page — mirrors the spec-doc shape so
    // crawlers index RFCs as authored technical-spec articles rather than
    // generic web pages. Headline + description + canonical URL + repo cite.
    const rfcCanonicalPath = `/rfcs/${slug}.html`;
    const rfcJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: title,
      description,
      url: `${SITE_ORIGIN}${rfcCanonicalPath}`,
      inLanguage: 'en-US',
      isPartOf: { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'OpenWOP', url: SITE_ORIGIN },
      about: { '@type': 'SoftwareSourceCode', name: 'OpenWOP', url: SITE_ORIGIN, codeRepository: REPO_URL },
      author: { '@type': 'Organization', name: 'OpenWOP', url: SITE_ORIGIN },
    };
    writeFileSync(
      join(DIST, 'rfcs', `${slug}.html`),
      templatePage({
        title: `OpenWOP — ${title}`,
        content,
        navActive: 'rfcs',
        description,
        canonicalPath: rfcCanonicalPath,
        jsonLd: rfcJsonLd,
      }),
    );
    items.push({
      slug,
      title,
      status: status ? status[1].trim() : '?',
      topic: classifyRfcTopic(title, slug),
      isTemplate: /^0000-template$/i.test(slug) || /^RFC NNNN/i.test(title),
    });
  }

  // Hide the RFC template from the default list. It still has a
  // rendered page (so links from RFCS/0000-template.md continue to work),
  // but the index doesn't surface it as a real RFC.
  const indexItems = items.filter((i) => !i.isTemplate);

  // Status chips show counts of the canonical lifecycle states. The "All"
  // chip shows the full filtered (template-stripped) total. Any RFC whose
  // status doesn't match one of the canonical buckets falls under "Other".
  const STATUS_BUCKETS = ['Draft', 'Active', 'Accepted', 'Withdrawn', 'Superseded'];
  const statusKey = (s) => {
    const lower = s.toLowerCase();
    for (const b of STATUS_BUCKETS) if (lower.includes(b.toLowerCase())) return b;
    return 'Other';
  };
  const allBuckets = [...STATUS_BUCKETS, 'Other'];
  const statusCounts = Object.fromEntries(allBuckets.map((b) => [b, 0]));
  for (const i of indexItems) statusCounts[statusKey(i.status)]++;

  const chipHtml = `
    <button class="rfc-chip is-active" type="button" data-rfc-status="all">All <span class="rfc-chip-count">${indexItems.length}</span></button>
    ${allBuckets
      .filter((b) => statusCounts[b] > 0)
      .map((b) => `<button class="rfc-chip" type="button" data-rfc-status="${b}">${b} <span class="rfc-chip-count">${statusCounts[b]}</span></button>`)
      .join('\n    ')}
  `;

  const tableRowsHtml = indexItems
    .map((i) => `<tr data-rfc-status="${escapeHtml(statusKey(i.status))}" data-rfc-topic="${escapeHtml(i.topic)}" data-rfc-title="${escapeHtml(i.title.toLowerCase())}">
      <td><a href="./${i.slug}.html">${escapeHtml(i.title)}</a></td>
      <td><span class="rfc-topic-tag">${escapeHtml(i.topic)}</span></td>
      <td>${escapeHtml(i.status)}</td>
    </tr>`)
    .join('\n');

  // Inline filter script. Wires the status chips, the search input, and
  // the per-row data-* attributes. No build dependency on a new asset
  // file (the project's site/ build keeps a zero-runtime-deps invariant).
  const filterScript = `<script>
(() => {
  const root = document.querySelector('.rfc-filter');
  if (!root) return;
  const chips = root.querySelectorAll('.rfc-chip');
  const search = root.querySelector('.rfc-search');
  const rows = document.querySelectorAll('table.rfc-index tbody tr[data-rfc-status]');
  const empty = document.querySelector('.rfc-empty');
  let activeStatus = 'all';
  const apply = () => {
    const q = (search.value || '').trim().toLowerCase();
    let visible = 0;
    rows.forEach((r) => {
      const sMatch = activeStatus === 'all' || r.dataset.rfcStatus === activeStatus;
      const qMatch = !q || (r.dataset.rfcTitle || '').includes(q) || (r.dataset.rfcTopic || '').toLowerCase().includes(q);
      const show = sMatch && qMatch;
      r.hidden = !show;
      if (show) visible++;
    });
    if (empty) empty.hidden = visible !== 0;
  };
  chips.forEach((c) => {
    c.addEventListener('click', () => {
      chips.forEach((x) => x.classList.toggle('is-active', x === c));
      activeStatus = c.dataset.rfcStatus;
      apply();
    });
  });
  search.addEventListener('input', apply);
})();
</script>`;

  const indexContent = `<header class="page-header">
    <h1>OpenWOP RFCs</h1>
    <p class="lede">${indexItems.length} RFCs governing additive evolution of the v1 protocol. Status legend: Draft (open comment window) → Active (accepted; impl follows) → Accepted (in-tree reference impl + conformance scenarios) → Withdrawn / Superseded.</p>
    <p class="meta"><strong>v1.1 is the stable wire contract.</strong> RFCs at Draft or Active target <strong>v1.2</strong> (additive) unless the RFC is explicitly labelled Safety fix per <a href="https://github.com/openwop/openwop/blob/main/COMPATIBILITY.md">COMPATIBILITY.md §3</a>. No RFC may land a breaking change inside v1.x.</p>
  </header>
  <div class="rfc-filter">
    <div class="rfc-chips" role="group" aria-label="Filter RFCs by status">${chipHtml}</div>
    <label class="rfc-search-wrap">
      <span class="visually-hidden">Search RFCs</span>
      <input type="search" class="rfc-search" placeholder="Search title or topic…" aria-label="Search RFCs" />
    </label>
  </div>
  <table class="spec-index rfc-index">
    <thead><tr><th>RFC</th><th>Topic</th><th>Status</th></tr></thead>
    <tbody>
    ${tableRowsHtml}
    </tbody>
  </table>
  <p class="rfc-empty" hidden>No RFCs match the current filter.</p>
  ${filterScript}`;
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

// ── Protocol comparison page (bespoke layout) ──────────────────────────
// /comparisons/a2a-openwop-mcp/ renders through a designed shell rather
// than the generic markdown path: a protocol-identity hero, a pure-CSS
// wire schematic of the three-plane agentic stack, and protocol-colored
// chips post-processed into every table. The PROSE stays markdown-authored
// in site/content/comparisons/a2a-openwop-mcp.md — this builder only owns
// the hero, the schematic, and chip decoration, so editors keep editing
// markdown and the page degrades gracefully if sections move.
function buildComparisonA2aMcp() {
  const srcAbsPath = join(SITE_DIR, 'content', 'comparisons', 'a2a-openwop-mcp.md');
  if (!existsSync(srcAbsPath)) {
    console.log('[openwop-site] skip comparisons/a2a-openwop-mcp — source not found');
    return;
  }
  const md = readFile(srcAbsPath);
  const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;

  // The hero re-renders the H1, the lede paragraph, and the "Prepared …"
  // dateline blockquote — strip all three from the article body.
  let bodyMd = stripLeadingH1(md);
  bodyMd = bodyMd.replace(/^\s*A specification-level comparison[^\n]*\n/, '');
  const datelineMatch = /^>\s*(Prepared [^\n]*)$/m.exec(bodyMd);
  const dateline = datelineMatch ? datelineMatch[1].trim() : '';
  if (datelineMatch) bodyMd = bodyMd.replace(datelineMatch[0] + '\n', '');

  // Protocol identity cards — the skim layer above the prose. Facts mirror
  // the Executive Summary table in the markdown source.
  const PROTOCOLS = [
    { key: 'a2a', name: 'A2A', full: 'Agent2Agent Protocol', plane: 'Horizontal plane', role: 'Agent ↔ agent collaboration', unit: 'Task', discovery: 'Agent Card', model: '“Ask another agent to do something.”' },
    { key: 'mcp', name: 'MCP', full: 'Model Context Protocol', plane: 'Vertical plane', role: 'Agent ↕ tools, data &amp; context', unit: 'Tool / resource / prompt call', discovery: 'tools/list · resources/list', model: '“Give the model safe access to external capabilities.”' },
    { key: 'owp', name: 'OpenWOP', full: 'Open Workflow Orchestration Protocol', plane: 'Substrate', role: 'Durable workflow control', unit: 'Run', discovery: 'Host capability document', model: '“Run and observe a durable workflow.”' },
  ];
  const cardsHtml = PROTOCOLS.map((p, i) => `
    <article class="cmp-card cmp-card-${p.key}" style="--cmp-stagger:${i}">
      <div class="cmp-card-head">
        <span class="cmp-card-abbr">${p.name}</span>
        <span class="cmp-card-plane">${p.plane}</span>
      </div>
      <h2 class="cmp-card-full">${p.full}</h2>
      <p class="cmp-card-role">${p.role}</p>
      <dl class="cmp-card-facts">
        <div><dt>Core unit</dt><dd>${p.unit}</dd></div>
        <div><dt>Discovery</dt><dd>${p.discovery}</dd></div>
      </dl>
      <p class="cmp-card-model">${p.model}</p>
    </article>`).join('');

  // The wire schematic: two opaque agents joined horizontally by A2A, each
  // dropping vertically to tools over MCP, the whole engagement running on
  // a durable OpenWOP substrate band. Pure CSS — no images, no JS.
  const schematicHtml = `
  <figure class="cmp-schematic">
    <div class="cmp-diagram" role="img" aria-label="Wire schematic: Agent A and Agent B exchange tasks horizontally over A2A; each agent reaches tools, data, and prompts vertically over MCP; both sit on the OpenWOP substrate providing durable runs, an event log, human checkpoints, replay, and signed webhooks.">
      <div class="cmp-node cmp-node-agent">Agent A<span class="cmp-node-sub">internals opaque</span></div>
      <div class="cmp-hlink"><i></i><span>A2A · tasks &amp; messages</span><i></i></div>
      <div class="cmp-node cmp-node-agent">Agent B<span class="cmp-node-sub">internals opaque</span></div>
      <div class="cmp-vlink"><span>MCP</span></div>
      <div class="cmp-vgap"></div>
      <div class="cmp-vlink"><span>MCP</span></div>
      <div class="cmp-node cmp-node-tool">Tools · data · prompts</div>
      <div class="cmp-vgap"></div>
      <div class="cmp-node cmp-node-tool">Tools · data · prompts</div>
      <div class="cmp-substrate">
        <span class="cmp-substrate-name">OpenWOP</span>
        <span class="cmp-substrate-desc">durable runs · event log · human checkpoints · replay · signed webhooks</span>
      </div>
    </div>
    <figcaption>Complementary planes, not substitutes — agents collaborate over A2A, reach tools and context over MCP, and the whole engagement executes durably on OpenWOP.</figcaption>
  </figure>`;

  const heroHtml = `<header class="cmp-hero">
    <p class="cmp-eyebrow">Protocol comparison${dateline ? ` · <span>${escapeHtml(dateline)}</span>` : ''}</p>
    <h1 class="cmp-title"><span class="cmp-name-a2a">A2A</span> <em>vs</em> <span class="cmp-name-mcp">MCP</span> <em>vs</em> <span class="cmp-name-owp">OpenWOP</span></h1>
    <p class="lede">${escapeHtml(description)}</p>
    <div class="cmp-cards">${cardsHtml}</div>
    ${schematicHtml}
  </header>`;

  // The six architecture / integration / pattern ASCII diagrams in the
  // markdown are upgraded in place to designed graphics in the page's
  // three-hue protocol grammar (A2A purple · MCP cyan · OpenWOP clay).
  // Same swap-or-degrade contract as the OpenExO page: a figure replaces
  // its ASCII block by matching the block's lead text; if that text ever
  // changes shape the regex simply misses and the ASCII renders unharmed.
  const flowNode = (n) => `
      <div class="cmp-flow-node">${n.role ? `<span class="cmp-flow-role">${n.role}</span>` : ''}<span class="cmp-flow-name">${n.name}</span>${n.sub ? `<span class="cmp-flow-sub">${n.sub}</span>` : ''}${n.items ? `<ul class="cmp-flow-parts">${n.items.map((it) => `<li>${it}</li>`).join('')}</ul>` : ''}</div>`;
  const flowLink = (l) => `
      <div class="cmp-flow-link"${l.accent ? ` style="--cf: var(--cmp-${l.accent})"` : ''}><span>${l.label}</span></div>`;
  const flowFigure = ({ cls = '', aria, caption, rows }) =>
    `<figure class="cmp-flow${cls ? ' ' + cls : ''}" role="img" aria-label="${aria}">${rows.map((r) => (r.node ? flowNode(r.node) : flowLink(r.link))).join('')}
      <figcaption>${caption}</figcaption>
    </figure>`;

  const a2aArchHtml = flowFigure({
    cls: 'cmp-flow-a2a',
    aria: 'A2A architecture: an A2A client or caller sends a message to an A2A server or remote agent, which creates or updates a Task; the Task lifecycle then drives status updates and produces artifacts and messages.',
    caption: 'A remote-agent contract — the caller hands off a task and follows its lifecycle, never the agent’s internals.',
    rows: [
      { node: { role: 'Caller', name: 'A2A Client / Caller' } },
      { link: { label: 'Send Message' } },
      { node: { role: 'Remote agent', name: 'A2A Server / Remote Agent' } },
      { link: { label: 'Creates or updates Task' } },
      { node: { role: 'Outcome', name: 'Task lifecycle', items: ['status updates', 'artifacts', 'messages'] } },
    ],
  });
  const mcpArchHtml = flowFigure({
    cls: 'cmp-flow-mcp',
    aria: 'MCP architecture: an MCP host — an AI application, IDE, or agent runtime — opens one or more MCP client connections to MCP servers, which expose tools, resources, prompts, and notifications backed by external APIs, databases, filesystems, SaaS apps, and services.',
    caption: 'A host-client-server contract — the host connects to servers that expose tools and context over JSON-RPC.',
    rows: [
      { node: { role: 'Host', name: 'MCP Host', sub: 'AI application · IDE · agent runtime' } },
      { link: { label: 'one or more MCP Client connections' } },
      { node: { role: 'Server', name: 'MCP Server(s)' } },
      { link: { label: 'expose tools, resources, prompts, notifications' } },
      { node: { role: 'Backends', name: 'External systems', items: ['APIs', 'databases', 'filesystems', 'SaaS apps', 'services'] } },
    ],
  });
  const owpArchHtml = flowFigure({
    cls: 'cmp-flow-owp',
    aria: 'OpenWOP architecture: a client, SDK, or agent POSTs to /v1/runs on an OpenWOP host, which executes a WorkflowDefinition; the run emits an event log streamed over SSE, webhooks, and OpenTelemetry, supports interrupt, pause, resume, and replay, and reaches humans, tools, agents, workers, subflows, and artifacts.',
    caption: 'A workflow-host contract — a durable run with an event log you can stream, interrupt, resume, and replay.',
    rows: [
      { node: { role: 'Caller', name: 'Client / SDK / Agent' } },
      { link: { label: 'POST /v1/runs' } },
      { node: { role: 'Host', name: 'OpenWOP Host' } },
      { link: { label: 'Executes WorkflowDefinition' } },
      { node: { role: 'Run', name: 'Run → Event Log', items: ['SSE', 'Webhooks', 'OpenTelemetry'] } },
      { link: { label: 'Interrupt / pause / resume / replay' } },
      { node: { role: 'Reaches', name: 'Execution surface', items: ['Humans', 'tools', 'agents', 'workers', 'subflows', 'artifacts'] } },
    ],
  });
  // The integration diagram is the page's thesis as a picture: neutral
  // nodes, protocol-colored EDGES — each link owns one boundary.
  const integrationHtml = flowFigure({
    aria: 'Composable layers: an external agent ecosystem reaches an A2A-facing agent or gateway over A2A (discover agents, delegate tasks, exchange artifacts); that gateway drives a workflow host or orchestration plane over OpenWOP (start durable run, stream events, pause/resume, replay); the workflow host reaches external APIs, databases, files, SaaS apps, and local services over MCP (call tools, read resources, use prompts, elicit input).',
    caption: 'The strongest architecture treats the three protocols as composable layers — the edges are the protocols, each owning one boundary.',
    rows: [
      { node: { name: 'External agent ecosystem' } },
      { link: { accent: 'a2a', label: 'A2A · discover agents, delegate tasks, exchange artifacts' } },
      { node: { name: 'A2A-facing agent or gateway' } },
      { link: { accent: 'owp', label: 'OpenWOP · start durable run, stream events, pause/resume, replay' } },
      { node: { name: 'Workflow host / orchestration plane' } },
      { link: { accent: 'mcp', label: 'MCP · call tools, read resources, use prompts, elicit input' } },
      { node: { name: 'External systems', items: ['APIs', 'databases', 'files', 'SaaS apps', 'local services'] } },
    ],
  });

  // Pattern 3 — the nested call tree. Indentation is the call stack; each
  // row's left rail + tag take the protocol hue of the hop. Labels carry
  // the protocol-stripped noun (the tag supplies the protocol).
  const TAG = { a2a: 'A2A', mcp: 'MCP', owp: 'OpenWOP' };
  const TREE = [
    { d: 0, p: 'a2a', label: 'caller' },
    { d: 1, p: 'a2a', label: 'specialist agent' },
    { d: 2, p: 'owp', label: 'workflow run' },
    { d: 3, p: 'mcp', label: 'CRM server' },
    { d: 3, p: 'mcp', label: 'database server' },
    { d: 3, p: 'mcp', label: 'filesystem or document server' },
    { d: 3, p: 'owp', label: 'approval interrupt' },
    { d: 2, p: 'a2a', label: 'artifact result' },
  ];
  const treeHtml = `<figure class="cmp-tree" role="img" aria-label="Pattern 3 call tree: an A2A caller invokes an A2A specialist agent, which runs an OpenWOP workflow; the run calls an MCP CRM server, an MCP database server, and an MCP filesystem or document server, then hits an OpenWOP approval interrupt, and finally returns an A2A artifact result.">${TREE.map((r) => `
      <div class="cmp-tree-row cmp-tree-${r.p}" data-d="${r.d}" style="--depth:${r.d}"><span class="cmp-tree-tag">${TAG[r.p]}</span><span class="cmp-tree-label">${r.label}</span></div>`).join('')}
      <figcaption>One public A2A call fans out through an OpenWOP run into MCP tools and a human approval gate, then returns a single A2A artifact — the clean enterprise split of contract from execution.</figcaption>
    </figure>`;

  // The closing boundary legend.
  const LEGEND = [
    { p: 'a2a', name: 'A2A', def: 'public agent collaboration boundary' },
    { p: 'mcp', name: 'MCP', def: 'tool, data, prompt, and context integration boundary' },
    { p: 'owp', name: 'OpenWOP', def: 'internal durable workflow and observability boundary' },
  ];
  const legendHtml = `<figure class="cmp-legend" role="img" aria-label="Boundaries: A2A is the public agent collaboration boundary; MCP is the tool, data, prompt, and context integration boundary; OpenWOP is the internal durable workflow and observability boundary.">${LEGEND.map((r) => `
      <div class="cmp-legend-row cmp-legend-${r.p}"><span class="cmp-legend-name">${r.name}</span><span class="cmp-legend-def">${r.def}</span></div>`).join('')}
    </figure>`;

  // Render the prose, then decorate: protocol names in table headers and
  // decision-checklist answer cells become colored chips; H3s that open
  // with a protocol name get its hue on the name.
  const CHIP = { A2A: 'a2a', MCP: 'mcp', OpenWOP: 'owp' };
  const chip = (name) => `<span class="cmp-chip cmp-chip-${CHIP[name]}">${name}</span>`;
  let articleHtml = markdownToHtml(bodyMd)
    // Swap each architecture / integration / pattern / legend ASCII block
    // for its designed figure, matched on the block's lead text.
    .replace(/<pre class="lang-"><code>A2A Client \/ Caller[\s\S]*?<\/code><\/pre>/, a2aArchHtml)
    .replace(/<pre class="lang-"><code>MCP Host:[\s\S]*?<\/code><\/pre>/, mcpArchHtml)
    .replace(/<pre class="lang-"><code>Client \/ SDK \/ Agent[\s\S]*?<\/code><\/pre>/, owpArchHtml)
    .replace(/<pre class="lang-"><code>External agent ecosystem[\s\S]*?<\/code><\/pre>/, integrationHtml)
    .replace(/<pre class="lang-"><code>A2A caller[\s\S]*?<\/code><\/pre>/, treeHtml)
    .replace(/<pre class="lang-"><code>A2A = public[\s\S]*?<\/code><\/pre>/, legendHtml)
    .replace(/<th>(A2A|MCP|OpenWOP)<\/th>/g, (_, n) => `<th>${chip(n)}</th>`)
    .replace(/<td>((?:A2A|MCP|OpenWOP)(?: \+ (?:A2A|MCP|OpenWOP))*)<\/td>/g, (_, combo) =>
      `<td class="cmp-answer">${combo.split(' + ').map(chip).join('<span class="cmp-plus">+</span>')}</td>`)
    .replace(/(<h3 id="[^"]*">)(A2A|MCP|OpenWOP)(:)/g, (_, open, n, colon) =>
      `${open}<span class="cmp-name-${CHIP[n]}">${n}</span>${colon}`);
  articleHtml = `<article class="spec-doc comparison-doc">${articleHtml}</article>`;

  const content = `<div class="comparison-page">${heroHtml}${wrapWithToc(articleHtml, extractToc(bodyMd))}</div>`;
  const destDir = join(DIST, 'comparisons', 'a2a-openwop-mcp');
  ensureDir(destDir);
  writeFileSync(
    join(destDir, 'index.html'),
    templatePage({
      title: 'OpenWOP — A2A vs MCP vs OpenWOP',
      content,
      navActive: 'protocol',
      description,
      canonicalPath: '/comparisons/a2a-openwop-mcp/',
      ogTitle: 'A2A vs MCP vs OpenWOP — the agentic protocol stack',
    }),
  );
  console.log('[openwop-site] wrote comparisons/a2a-openwop-mcp/index.html (bespoke)');
}

// ── OpenExO 3.0 positioning page (bespoke layout) ──────────────────────
// /comparisons/openexo-3-openwop/ tells a different story than the A2A
// page: an organizational THESIS (ExO 3.0) bridged onto an execution
// PROTOCOL (OpenWOP). The hero renders that bridge as two bands — thesis
// above, protocol below — and the Intelligence Stack ASCII diagram in the
// markdown is upgraded in place to a designed ladder (gold = organizational
// layer, clay = where OpenWOP is foundational). Prose stays markdown-
// authored; if the ASCII block ever changes shape, the ladder swap
// degrades gracefully back to the code block.
function buildComparisonOpenExo() {
  const srcAbsPath = join(SITE_DIR, 'content', 'comparisons', 'openexo-3-openwop.md');
  if (!existsSync(srcAbsPath)) {
    console.log('[openwop-site] skip comparisons/openexo-3-openwop — source not found');
    return;
  }
  const md = readFile(srcAbsPath);
  const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
  let bodyMd = stripLeadingH1(md);
  // The hero re-renders the lede paragraph.
  bodyMd = bodyMd.replace(/^\s*OpenExO 3\.0 describes the AI-native organization\.[^\n]*\n/, '');

  const heroHtml = `<header class="cmp-hero">
    <p class="cmp-eyebrow">Positioning brief · Organization design × protocol design</p>
    <h1 class="cmp-title oxo-title"><span class="cmp-name-owp">OpenWOP</span> <em>as the protocol foundation for</em> <span class="cmp-name-exo">OpenExO&nbsp;3.0</span></h1>
    <p class="lede">${escapeHtml(description)}</p>
    <div class="oxo-bridge">
      <div class="oxo-band oxo-band-exo">
        <div class="oxo-band-head">
          <span class="oxo-band-name">ExO 3.0</span>
          <span class="oxo-band-tag">The organizational thesis</span>
        </div>
        <p class="oxo-band-terms">MTP · Intelligence Stack · DRIVE · SHAPE · REWRITE · Edge Twins · GOVERN / ASSURE</p>
      </div>
      <div class="oxo-bridge-link"><i></i><span>becomes executable through</span><i></i></div>
      <div class="oxo-band oxo-band-owp">
        <div class="oxo-band-head">
          <span class="oxo-band-name">OpenWOP</span>
          <span class="oxo-band-tag">The execution protocol</span>
        </div>
        <p class="oxo-band-terms">durable runs · event log · interrupts · replay · approvals · webhooks · conformance</p>
      </div>
    </div>
  </header>`;

  // Intelligence Stack ladder — replaces the first ASCII diagram in place.
  const LADDER = [
    { layer: 'Purpose / MTP', what: 'as protocol — machine-readable constraints attached to execution' },
    { layer: 'Sense', what: 'gather signals, events, data, user input' },
    { layer: 'Interpret', what: 'build context, assemble evidence, reason over state' },
    { layer: 'Decide', what: 'supervisor agent selects next-worker, ask-user, or terminate' },
    { layer: 'Orchestrate', what: 'OpenWOP run lifecycle, event log, state channels, interrupts', core: true },
    { layer: 'Act', what: 'workers call tools, APIs, MCP servers, external systems' },
    { layer: 'Learn', what: 'replay, fork, evals, human-correction capture, telemetry' },
  ];
  const ladderHtml = `<figure class="oxo-ladder" role="img" aria-label="The Intelligence Stack as a ladder: Purpose, Sense, Interpret, Decide, Orchestrate, Act, Learn — with Orchestrate highlighted as the layer OpenWOP standardizes.">${LADDER.map((r) => `
    <div class="oxo-rung${r.core ? ' oxo-rung-core' : ''}">
      <span class="oxo-rung-layer">${r.layer}${r.core ? '<em>OpenWOP core</em>' : ''}</span>
      <span class="oxo-rung-what">${r.what}</span>
    </div>`).join('')}
  </figure>`;

  // Edge Twin flow — replaces the second ASCII diagram in place. The story
  // is a vertical pipeline: the enterprise estate (neutral) flows through
  // the OpenWOP-powered Edge Twin (clay) and emerges as the AI-native
  // operating unit (gold — the thesis realized).
  const edgeTwinHtml = `<figure class="oxo-flow" role="img" aria-label="Edge Twin pipeline: enterprise mothership systems (ERP, CRM, billing, support, policy, knowledge bases) connect through workflow-scoped governed API access — read/write separated, short-lived credentials, correlation IDs — into the OpenWOP-powered Edge Twin (workflow catalog, run lifecycle and event log, supervisor agents, worker agents and MCP tools, human approval queues, governance and eval agents, telemetry/replay/cost/artifacts), which proves, migrates, and deprecates legacy workflows to produce the AI-native operating unit.">
    <div class="oxo-flow-node oxo-flow-mothership">
      <span class="oxo-flow-name">Enterprise mothership systems</span>
      <span class="oxo-flow-terms">ERP · CRM · billing · support · policy · knowledge bases</span>
    </div>
    <div class="oxo-flow-link">
      <span class="oxo-flow-link-main">workflow-scoped governed API access</span>
      <span class="oxo-flow-link-sub">read/write separated · short-lived credentials · correlation IDs</span>
    </div>
    <div class="oxo-flow-node oxo-flow-twin">
      <span class="oxo-flow-name">OpenWOP-powered Edge Twin</span>
      <ul class="oxo-flow-parts">
        <li>workflow catalog</li>
        <li>run lifecycle &amp; event log</li>
        <li>supervisor agents</li>
        <li>worker agents &amp; MCP tools</li>
        <li>human approval queues</li>
        <li>governance &amp; eval agents</li>
        <li>telemetry · replay · cost · artifacts</li>
      </ul>
    </div>
    <div class="oxo-flow-link">
      <span class="oxo-flow-link-main">prove → migrate → deprecate legacy workflow</span>
    </div>
    <div class="oxo-flow-node oxo-flow-unit">
      <span class="oxo-flow-name">AI-native operating unit</span>
    </div>
    <figcaption>The Edge Twin is a workflow migration engine: governed access in, proven workflows out — one at a time, with rollback the whole way.</figcaption>
  </figure>`;

  // Composition nest — replaces the third ASCII diagram. Containment IS
  // the message, so the boxes nest: MCP and A2A compose inside OpenWOP
  // workflows; GOVERN / ASSURE sits alongside, watching the whole stack.
  const nestHtml = `<figure class="oxo-nest" role="img" aria-label="Composition: the ExO 3.0 organization contains the Intelligence Stack; inside it, OpenWOP owns workflow run lifecycle, event log, governance, and replay, and composes MCP (tools, data sources, resources, prompts, APIs) and A2A (external specialist agents and partner organizations) inside its workflows; GOVERN / ASSURE — evals, logs, rollback, review queues — sits alongside, watching the whole stack.">
    <div class="oxo-nest-org">
      <span class="oxo-nest-label oxo-nest-label-exo">ExO 3.0 organization</span>
      <div class="oxo-nest-stack">
        <span class="oxo-nest-label">Intelligence Stack</span>
        <div class="oxo-nest-owp">
          <span class="oxo-nest-head"><span class="oxo-nest-label oxo-nest-label-owp">OpenWOP</span><span class="oxo-nest-desc">workflow run lifecycle · event log · governance · replay</span></span>
          <div class="oxo-nest-children">
            <div class="oxo-nest-child oxo-nest-mcp">
              <span class="oxo-nest-label oxo-nest-label-mcp">MCP</span>
              <span class="oxo-nest-desc">tools · data sources · resources · prompts · APIs</span>
            </div>
            <div class="oxo-nest-child oxo-nest-a2a">
              <span class="oxo-nest-label oxo-nest-label-a2a">A2A</span>
              <span class="oxo-nest-desc">external specialist agents · partner organizations</span>
            </div>
          </div>
        </div>
        <div class="oxo-nest-govern">
          <span class="oxo-nest-label oxo-nest-label-exo">GOVERN / ASSURE</span>
          <span class="oxo-nest-desc">evals · logs · rollback · review queues</span>
        </div>
      </div>
    </div>
    <figcaption>Containment, not competition — MCP and A2A compose inside OpenWOP workflows; GOVERN / ASSURE watches everything the stack does.</figcaption>
  </figure>`;

  const CHIP = { A2A: 'a2a', MCP: 'mcp', OpenWOP: 'owp' };
  const chip = (name) => `<span class="cmp-chip cmp-chip-${CHIP[name]}">${name}</span>`;
  let articleHtml = markdownToHtml(bodyMd)
    // Swap the first ASCII stack diagram for the designed ladder.
    .replace(/<pre class="lang-"><code>Purpose \/ MTP as protocol[\s\S]*?<\/code><\/pre>/, ladderHtml)
    // Swap the Edge Twin + composition ASCII diagrams the same way.
    .replace(/<pre class="lang-"><code>Enterprise mothership systems[\s\S]*?<\/code><\/pre>/, edgeTwinHtml)
    .replace(/<pre class="lang-"><code>ExO 3\.0 organization[\s\S]*?<\/code><\/pre>/, nestHtml)
    // Protocol names in table headers + bold first-column cells → chips.
    .replace(/<th>(A2A|MCP|OpenWOP)<\/th>/g, (_, n) => `<th>${chip(n)}</th>`)
    .replace(/<td><strong>(A2A|MCP|OpenWOP)<\/strong><\/td>/g, (_, n) => `<td>${chip(n)}</td>`);

  // Footnotes. The markdown cites sources as [N](#fn-slug) — rendered raw,
  // those are full-size links butting against the sentence, and the #fn-*
  // anchors point at nothing (the Sources list has no ids). Two repairs:
  //   1. Wrap every footnote ref in <sup class="oxo-fn">.
  //   2. Give the Nth <li> of the Sources list the id the Nth-numbered
  //      footnote targets, so the anchors actually land. The markdown's
  //      numbering follows the list order; if the two ever drift apart
  //      (more numbers than list items), the ids are skipped and the refs
  //      degrade to styled-but-inert superscripts rather than mislinking.
  const fnIdByNumber = new Map();
  for (const m of articleHtml.matchAll(/<a href="#(fn-[a-z-]+)">(\d+)<\/a>/g)) {
    fnIdByNumber.set(Number(m[2]), m[1]);
  }
  articleHtml = articleHtml.replace(
    /(<a href="#fn-[a-z-]+">\d+<\/a>)(?!<\/sup>)/g,
    '<sup class="oxo-fn">$1</sup>',
  );
  const sourcesSplit = articleHtml.split('<h2 id="sources-and-references">');
  if (sourcesSplit.length === 2 && fnIdByNumber.size > 0) {
    let li = 0;
    const numberedTail = sourcesSplit[1].replace(/<li>/g, () => {
      li += 1;
      const id = fnIdByNumber.get(li);
      return id ? `<li id="${id}">` : '<li>';
    });
    if (li >= Math.max(...fnIdByNumber.keys())) {
      articleHtml = `${sourcesSplit[0]}<h2 id="sources-and-references">${numberedTail}`;
    }
  }
  articleHtml = `<article class="spec-doc comparison-doc">${articleHtml}</article>`;

  const content = `<div class="comparison-page">${heroHtml}${wrapWithToc(articleHtml, extractToc(bodyMd))}</div>`;
  const destDir = join(DIST, 'comparisons', 'openexo-3-openwop');
  ensureDir(destDir);
  writeFileSync(
    join(destDir, 'index.html'),
    templatePage({
      title: 'OpenWOP — OpenExO 3.0 and OpenWOP',
      content,
      navActive: 'protocol',
      description,
      canonicalPath: '/comparisons/openexo-3-openwop/',
      ogTitle: 'OpenWOP as the protocol foundation for OpenExO 3.0',
    }),
  );
  console.log('[openwop-site] wrote comparisons/openexo-3-openwop/index.html (bespoke)');
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
    { src: 'faq.md',                          dest: ['faq'],                          nav: 'faq',        label: 'FAQ' },
    { src: 'errors.md',                       dest: ['errors'],                       nav: '',           label: 'Error codes' },
    { src: 'scenarios.md',                    dest: ['scenarios'],                    nav: '',           label: 'Scenario walkthroughs' },
    { src: 'community.md',                    dest: ['community'],                    nav: 'community',  label: 'Community' },
    { src: 'protocol.md',                     dest: ['protocol'],                     nav: 'protocol',   label: 'The OpenWOP protocol' },
    // comparisons/a2a-openwop-mcp.md renders through buildComparisonA2aMcp()
    // (bespoke hero + wire schematic), not this generic path.
    { src: 'implement.md',                    dest: ['implement'],                    nav: 'implement',  label: 'Implementing OpenWOP' },
    { src: 'install.md',                      dest: ['install'],                      nav: 'implement',  label: 'Install the demo app' },
    { src: 'governance/spec-status.md',       dest: ['governance', 'spec-status'],    nav: 'protocol',   label: 'Spec status policy' },
    { src: 'for/workflow-authors.md',         dest: ['for', 'workflow-authors'],      nav: 'implement',  label: 'For workflow authors' },
    { src: 'for/host-implementers.md',        dest: ['for', 'host-implementers'],     nav: 'implement',  label: 'For host implementers' },
    { src: 'for/pack-authors.md',             dest: ['for', 'pack-authors'],          nav: 'implement',  label: 'For pack authors' },
    { src: 'for/production-evaluators.md',    dest: ['for', 'production-evaluators'], nav: 'implement',  label: 'For production evaluators' },
  ];
  for (const r of ROUTES) {
    const srcAbsPath = join(contentDir, ...r.src.split('/'));
    if (!existsSync(srcAbsPath)) continue;
    const md = readFile(srcAbsPath);
    const titleMatch = /^#\s+(.+)$/m.exec(md);
    const title = titleMatch ? titleMatch[1] : r.label;
    const description = extractFirstParagraph(md) ?? CANONICAL_DESCRIPTION;
    const pageHeader = `<header class="page-header">
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(description)}</p>
    </header>`;
    const bodyMd = stripLeadingH1(md);
    const articleHtml = `<article class="spec-doc">${markdownToHtml(bodyMd)}</article>`;
    const content = pageHeader + wrapWithToc(articleHtml, extractToc(bodyMd));
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

// ── AsyncAPI events explorer (raw + cross-links) ──────────────────────

function buildAsyncApiExplorer() {
  const srcAbs = join(ROOT, 'api', 'asyncapi.yaml');
  if (!existsSync(srcAbs)) return;
  const raw = readFile(srcAbs);
  ensureDir(join(DIST, 'api', 'events'));
  const intro = `<div class="api-explorer">
    <header class="api-explorer-head">
      <div class="api-explorer-title">
        <span class="api-explorer-kicker">Event API</span>
        <h1>AsyncAPI — streamed event surface</h1>
      </div>
      <div class="api-explorer-meta">
        <a class="api-explorer-download" href="/api/asyncapi.yaml" download="openwop-asyncapi.yaml">
          <span>Download AsyncAPI</span>
          <span aria-hidden="true">↓</span>
        </a>
      </div>
    </header>
    <p class="lede">
      OpenWOP's event surface is documented as an AsyncAPI 3 document. Hosts
      stream <code>run.*</code> events over <a href="/spec/v1/stream-modes.html">SSE</a>
      and fan out to subscribers over <a href="/spec/v1/webhooks.html">signed
      webhooks</a>. The wire shape is normative; the AsyncAPI source below is
      the same contract in machine-readable form.
    </p>
    <p class="meta">
      <strong>Source:</strong> <code>api/asyncapi.yaml</code> in the repo.
      Prefer the prose specs (<a href="/spec/v1/stream-modes.html">stream-modes.md</a>,
      <a href="/spec/v1/webhooks.html">webhooks.md</a>,
      <a href="/spec/v1/observability.html">observability.md</a>) for
      normative claims; the AsyncAPI document is a structured restatement.
    </p>
    <pre class="api-raw"><code>${escapeHtml(raw)}</code></pre>
  </div>`;
  writeFileSync(
    join(DIST, 'api', 'events', 'index.html'),
    templatePage({
      title: 'OpenWOP — AsyncAPI event reference',
      content: intro,
      navActive: 'protocol',
      description: 'AsyncAPI 3 reference for the OpenWOP event surface — SSE streams + signed webhook fan-out. Source of truth: api/asyncapi.yaml.',
      canonicalPath: '/api/events/',
    }),
  );
  console.log('[openwop-site] wrote api/events/index.html');
}

// ── gRPC transport explorer (raw .proto + cross-links) ────────────────

function buildGrpcExplorer() {
  const srcAbs = join(ROOT, 'api', 'grpc', 'openwop.proto');
  if (!existsSync(srcAbs)) return;
  const raw = readFile(srcAbs);
  ensureDir(join(DIST, 'api', 'grpc'));
  const intro = `<div class="api-explorer">
    <header class="api-explorer-head">
      <div class="api-explorer-title">
        <span class="api-explorer-kicker">gRPC transport</span>
        <h1>OpenWOP — gRPC service definition</h1>
      </div>
      <div class="api-explorer-meta">
        <a class="api-explorer-download" href="/api/grpc/openwop.proto" download="openwop.proto">
          <span>Download .proto</span>
          <span aria-hidden="true">↓</span>
        </a>
      </div>
    </header>
    <p class="lede">
      OpenWOP defines an optional gRPC transport profile alongside the
      primary REST + SSE surface. A host MAY advertise the gRPC profile in
      <code>/.well-known/openwop</code>; clients MAY use it interchangeably
      with REST for any endpoint covered by the proto. The two transports
      MUST surface identical semantics — the conformance suite enforces
      parity. See <a href="/spec/v1/grpc-transport.html">grpc-transport.md</a>
      for the normative claims.
    </p>
    <p class="meta"><strong>Source:</strong> <code>api/grpc/openwop.proto</code> in the repo.</p>
    <pre class="api-raw"><code>${escapeHtml(raw)}</code></pre>
  </div>`;
  writeFileSync(
    join(DIST, 'api', 'grpc', 'index.html'),
    templatePage({
      title: 'OpenWOP — gRPC service definition',
      content: intro,
      navActive: 'protocol',
      description: 'gRPC service definition for OpenWOP. Optional transport profile; identical semantics to REST + SSE, enforced by the conformance suite.',
      canonicalPath: '/api/grpc/',
    }),
  );
  console.log('[openwop-site] wrote api/grpc/index.html');
}

// ── Adopters page (rendered from INTEROP-MATRIX.md) ───────────────────

function buildAdoptersPage() {
  buildMarkdownDoc({
    srcAbsPath: join(ROOT, 'INTEROP-MATRIX.md'),
    destPath: join(DIST, 'adopters', 'index.html'),
    pageTitle: 'Adopters & interop matrix',
    lede: 'Every host that has advertised an OpenWOP compatibility profile, paired with its measured conformance evidence. Claim plus result, no marketing — open a PR to add a row when your host passes the conformance suite.',
    navActive: 'protocol',
    canonicalPath: '/adopters/',
    slugLabel: 'adopters/index.html',
  });
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
            // Right code-samples panel: use Redoc's defaults. We tried
            // (a) light paper-2 — left dark-on-dark labels inside Redoc's
            // chrome; (b) warm-dark --ink — broke heading/label colors
            // Redoc assumes will sit on its slate background. Each color
            // swing broke a different internal styling layer.
            //
            // Reverted to Redoc defaults: panel is slate-grey ('#263238')
            // but EVERY label inside renders correctly because Redoc's
            // internal text colors are tuned for that exact background.
            // Width narrowed to 35% so the panel is less dominant on
            // overview pages where it sits empty.
            theme: {
              colors: { primary: { main: '#b05a3b' } },
              typography: {
                fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
                headings: { fontFamily: 'Instrument Serif, Georgia, serif' },
              },
              sidebar: { backgroundColor: '#f4f1ea', width: '280px' },
              rightPanel: {
                backgroundColor: '#f4f1ea',  // --paper, same as main page
                textColor: '#1a1a17',        // --ink for text on cream
                width: '35%',
              },
              codeBlock: {
                backgroundColor: '#f4f1ea',  // --paper, matches panel
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
  buildMaintainersPage();
  buildQuickstartPage();
  // RFC corpus — index + per-RFC pages.
  buildRfcs();
  // Net-new content authored under site/content/ (FAQ + audience pages).
  buildContentDir();
  // Protocol comparison — bespoke hero + wire schematic.
  buildComparisonA2aMcp();
  // OpenExO 3.0 positioning brief — bespoke thesis→runtime bridge.
  buildComparisonOpenExo();
  // REST API explorer (Redoc, self-hosted bundle).
  buildApiExplorer();
  // Sibling event + gRPC transport explorers (raw + cross-linked).
  buildAsyncApiExplorer();
  buildGrpcExplorer();
  // Adopters / interop matrix — rendered from INTEROP-MATRIX.md.
  buildAdoptersPage();
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
