/**
 * RFC 0028 §A — `/v1/prompts*` REST surface.
 *
 * Six operations backed by the in-memory PromptStore. Reads are gated
 * on `capabilities.prompts.endpointsSupported: true`; writes are
 * additionally gated on `capabilities.prompts.mutableLibrary: true`.
 * Render reuses the host's `composePromptTemplate()` pipeline (the
 * deterministic-hash invariant per RFC 0028 §A guarantees the same
 * inputs produce the same hash whether emitted as `prompt.composed`
 * at dispatch time or returned from `:render` at preview time).
 */

import type { Express } from 'express';
import {
  createUserTemplate,
  deleteUserTemplate,
  getTemplate,
  listTemplates,
  updateUserTemplate,
  type ListFilter,
  type PromptKind,
  type PromptTemplate,
} from '../host/promptStore.js';
import { composePromptTemplate } from '../host/promptCompose.js';

function sendError(res: import('express').Response, status: number, code: string, message: string): void {
  // Canonical ErrorEnvelope shape per schemas/error-envelope.schema.json:
  // FLAT `{ error: <code-string>, message: <human-readable>, details?: object }`.
  // (NOT nested `{ error: { code, message } }` — that's a common
  // off-the-shelf REST mistake the openwop spec specifically rules out
  // via `additionalProperties: false` on the envelope.)
  res.status(status).json({ error: code, message });
}

/** Parse a stringy PromptRef `prompt:templateId[@version]` into its
 *  components. Returns null on malformed input. */
function parseStringyRef(ref: string): { templateId: string; version?: string } | null {
  if (!ref.startsWith('prompt:')) return null;
  const body = ref.slice('prompt:'.length);
  const at = body.indexOf('@');
  if (at < 0) return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(body) ? { templateId: body } : null;
  const templateId = body.slice(0, at);
  const version = body.slice(at + 1);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(templateId)) return null;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) return null;
  return { templateId, version };
}

function isPromptKind(s: unknown): s is PromptKind {
  return s === 'system' || s === 'user' || s === 'few-shot' || s === 'schema-hint';
}

interface PromptsCapabilityFlags {
  endpointsSupported: boolean;
  mutableLibrary: boolean;
}

export function registerPromptRoutes(app: Express, deps: { capability: PromptsCapabilityFlags }): void {
  const { capability } = deps;

  // ── GET /v1/prompts ───────────────────────────────────────────
  app.get('/v1/prompts', (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    const q = req.query;
    const filter: ListFilter = {};
    if (typeof q.kind === 'string' && isPromptKind(q.kind)) filter.kind = q.kind;
    if (typeof q.tag === 'string') filter.tag = q.tag;
    if (typeof q.modelClass === 'string') filter.modelClass = q.modelClass;
    if (typeof q.source === 'string' && (q.source === 'host' || q.source === 'pack' || q.source === 'user')) {
      filter.source = q.source;
    }
    // limit + cursor — naive pagination over the current snapshot
    // (the in-memory store doesn't grow large enough to need real
    // cursors; we surface the shape for spec compliance).
    let items = listTemplates(filter);
    const limit = typeof q.limit === 'string' ? Math.min(200, Math.max(1, Number(q.limit) || 50)) : 50;
    const cursorOffset = typeof q.cursor === 'string' ? Math.max(0, Number(q.cursor) || 0) : 0;
    const slice = items.slice(cursorOffset, cursorOffset + limit);
    const nextCursor = cursorOffset + limit < items.length ? String(cursorOffset + limit) : undefined;
    res.status(200).json({ items: slice, ...(nextCursor !== undefined ? { nextCursor } : {}) });
  });

  // ── POST /v1/prompts ──────────────────────────────────────────
  app.post('/v1/prompts', (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    if (!capability.mutableLibrary) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.mutableLibrary is false');
      return;
    }
    const body = (req.body ?? {}) as PromptTemplate;
    if (typeof body.templateId !== 'string' || typeof body.version !== 'string' || !isPromptKind(body.kind) || typeof body.text !== 'string') {
      sendError(res, 400, 'validation_error', 'PromptTemplate body must include templateId, version, kind, text');
      return;
    }
    const result = createUserTemplate(body);
    if (!result.ok) {
      const status = result.code === 'conflict' ? 409 : result.code === 'forbidden' ? 403 : 400;
      sendError(res, status, `prompt_create_${result.code}`, result.message);
      return;
    }
    res.setHeader('Location', `/v1/prompts/${encodeURIComponent(body.templateId)}?version=${encodeURIComponent(result.locationVersion)}`);
    res.setHeader('ETag', `"${result.etag.slice(0, 16)}"`);
    res.status(201).end();
  });

  // ── GET /v1/prompts/{templateId} ──────────────────────────────
  app.get('/v1/prompts/:templateId', (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    const templateId = req.params.templateId;
    const version = typeof req.query.version === 'string' ? req.query.version : undefined;
    const libraryId = typeof req.query.libraryId === 'string' ? req.query.libraryId : undefined;
    const opts: { version?: string; libraryId?: string } = {};
    if (version !== undefined) opts.version = version;
    if (libraryId !== undefined) opts.libraryId = libraryId;
    const found = getTemplate(templateId, opts);
    if (found === 'ambiguous') {
      sendError(res, 400, 'prompt_ref_ambiguous', `multiple installed packs ship '${templateId}'; supply ?libraryId to disambiguate`);
      return;
    }
    if (!found) {
      sendError(res, 404, 'prompt_template_not_found', `no template '${templateId}'`);
      return;
    }
    const tag = `"${found.etag.slice(0, 16)}"`;
    const ifNoneMatch = req.header('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === tag) {
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', tag);
    // Pinned-version requests get immutable caching; latest-version
    // requests get short max-age.
    if (version) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
    res.status(200).json(found.template);
  });

  // ── PUT /v1/prompts/{templateId} ──────────────────────────────
  app.put('/v1/prompts/:templateId', (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    if (!capability.mutableLibrary) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.mutableLibrary is false');
      return;
    }
    const body = (req.body ?? {}) as PromptTemplate;
    const result = updateUserTemplate(req.params.templateId, body);
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : result.code === 'conflict' ? 409 : 400;
      sendError(res, status, `prompt_update_${result.code}`, result.message);
      return;
    }
    res.setHeader('ETag', `"${result.etag.slice(0, 16)}"`);
    res.status(200).json(result.template);
  });

  // ── DELETE /v1/prompts/{templateId} ───────────────────────────
  app.delete('/v1/prompts/:templateId', (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    if (!capability.mutableLibrary) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.mutableLibrary is false');
      return;
    }
    const result = deleteUserTemplate(req.params.templateId);
    if (!result.ok) {
      const status = result.code === 'forbidden' ? 403 : 404;
      sendError(res, status, `prompt_delete_${result.code}`, result.message);
      return;
    }
    res.status(204).end();
  });

  // ── POST /v1/prompts:render ───────────────────────────────────
  // Note: Express collapses `:` into a path parameter in some
  // configurations; we register the literal path explicitly.
  app.post('/v1/prompts:render', async (req, res) => {
    if (!capability.endpointsSupported) {
      sendError(res, 501, 'capability_not_provided', 'capabilities.prompts.endpointsSupported is false');
      return;
    }
    const body = (req.body ?? {}) as {
      ref?: unknown;
      variables?: Record<string, unknown>;
      contentTrust?: 'trusted' | 'untrusted';
    };
    if (body.ref === undefined || body.variables === undefined) {
      sendError(res, 400, 'validation_error', 'render body MUST include `ref` and `variables`');
      return;
    }
    // Parse ref into (templateId, version?). The PromptRef oneOf
    // schema accepts either stringy or object form; both project to
    // the same (templateId, version) lookup here.
    let templateId: string | undefined;
    let version: string | undefined;
    if (typeof body.ref === 'string') {
      const parsed = parseStringyRef(body.ref);
      if (!parsed) {
        sendError(res, 400, 'prompt_ref_invalid', `malformed PromptRef '${body.ref}'`);
        return;
      }
      templateId = parsed.templateId;
      version = parsed.version;
    } else if (body.ref && typeof body.ref === 'object') {
      const r = body.ref as { templateId?: unknown; version?: unknown };
      if (typeof r.templateId !== 'string') {
        sendError(res, 400, 'prompt_ref_invalid', 'object PromptRef MUST carry templateId');
        return;
      }
      templateId = r.templateId;
      if (typeof r.version === 'string') version = r.version;
    } else {
      sendError(res, 400, 'prompt_ref_invalid', 'ref MUST be stringy or object form');
      return;
    }
    const opts: { version?: string } = {};
    if (version !== undefined) opts.version = version;
    const found = getTemplate(templateId, opts);
    if (found === 'ambiguous') {
      sendError(res, 400, 'prompt_ref_ambiguous', `multiple installed packs ship '${templateId}'; use object-form ref with libraryId`);
      return;
    }
    if (!found) {
      sendError(res, 404, 'prompt_template_not_found', `no template '${templateId}'`);
      return;
    }
    // Delegate to the composition pipeline. The :render endpoint
    // returns a slightly different shape than `prompt.composed`
    // events — composed body + hash + variableHashes — but the
    // underlying composition is the same so the hash invariant
    // matches the dispatch-time emission per RFC 0028 §A.
    try {
      const composed = await composePromptTemplate({
        templateId,
        bindings: body.variables,
        bindingTrust: undefined,
        observability: 'full',
      });
      // Read the generic `composed` body field — populated for all
      // four PromptKind values under `observability: 'full'` per
      // promptCompose.ts. The kind-specific systemPrompt/userPrompt
      // fields stay around for prompt.composed event-payload
      // classification; the :render response surfaces the substituted
      // text via the generic field so few-shot + schema-hint
      // templates aren't silently empty (per RFC 0028 §A — `composed`
      // carries the full composed body under observability: full).
      const response: {
        composed?: string;
        hash: string;
        refs: string[];
        variableHashes: Record<string, string>;
        contentTrust?: 'trusted' | 'untrusted';
      } = {
        hash: composed.hash,
        refs: composed.refs,
        variableHashes: composed.variableHashes ?? {},
      };
      if (composed.composed !== undefined) response.composed = composed.composed;
      if (composed.contentTrust !== undefined) response.contentTrust = composed.contentTrust;
      // contentTrust echo: caller-supplied untrusted always surfaces.
      if (body.contentTrust === 'untrusted' && response.contentTrust !== 'untrusted') {
        response.contentTrust = 'untrusted';
      }
      res.status(200).json(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message.split(':')[0]?.trim() || 'internal_error';
      const status = code === 'template_not_found' ? 404 : 400;
      sendError(res, status, code, message);
    }
  });
}

