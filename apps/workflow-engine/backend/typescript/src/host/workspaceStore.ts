/**
 * RFC 0059 — agent workspace (durable, tenant/workspace-scoped file layer).
 *
 * A named, versioned file store that sits alongside the transactional memory
 * layer (RFC 0004). Files are owner-scoped to a {tenant, workspace} pair
 * (RFC 0048); writes are atomic with optimistic concurrency (If-Match etag),
 * size-bounded (maxFileBytes), and SR-1-redacted on write (WSR-1).
 *
 * Invariants:
 *   - WCT-1 (cross-tenant isolation): every file is keyed by its owner; no
 *     read/list against {T, W} can ever surface a file owned by
 *     {T2, W2} != {T, W}, regardless of the caller's permissions elsewhere
 *     (SECURITY/invariants.yaml `workspace-cross-tenant-isolation`).
 *   - WSR-1 (secret redaction): content is routed through the SR-1 harness on
 *     write so a stored file never persists secret-shaped plaintext.
 *
 * Process-local (sample-grade); a production host backs this with durable
 * storage. Latest-version only (the host does not advertise `versioned`).
 *
 * @see RFCS/0059-agent-workspace.md (sections C/D/E)
 * @see spec/v1/agent-workspace.md
 */

import { sanitizeFreeText } from '../byok/textRedaction.js';

/** Per-file byte ceiling — mirrors the advertised
 *  `capabilities.workspace.maxFileBytes`. */
export const WORKSPACE_MAX_FILE_BYTES = 64 * 1024;

export interface WorkspaceFile {
  path: string;
  content: string;
  contentType: string;
  version: number;
  etag: string;
  updatedAt: string;
}

/** Metadata view (list) — content omitted per the spec's list endpoint. */
export type WorkspaceFileMeta = Omit<WorkspaceFile, 'content'>;

export type PutOutcome =
  | { ok: true; file: WorkspaceFile }
  | { ok: false; status: 409; error: 'workspace_conflict'; details: { currentVersion: number } }
  | { ok: false; status: 413; error: 'workspace_too_large'; details: { maxBytes: number; providedBytes: number } };

// owner key (JSON-encoded [tenant, workspace] — collision-free) -> (path -> latest file).
const store = new Map<string, Map<string, WorkspaceFile>>();

function ownerKey(tenant: string, workspace: string): string {
  return JSON.stringify([tenant, workspace]);
}

function ownerFiles(tenant: string, workspace: string): Map<string, WorkspaceFile> {
  const key = ownerKey(tenant, workspace);
  let m = store.get(key);
  if (!m) {
    m = new Map();
    store.set(key, m);
  }
  return m;
}

/** Atomic create/replace. Honors If-Match; enforces maxFileBytes; bumps
 *  version + etag; SR-1-redacts content (WSR-1). */
export function putWorkspaceFile(
  tenant: string,
  workspace: string,
  path: string,
  input: { content: string; contentType?: string; ifMatch?: string },
): PutOutcome {
  const providedBytes = Buffer.byteLength(input.content, 'utf8');
  if (providedBytes > WORKSPACE_MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'workspace_too_large',
      details: { maxBytes: WORKSPACE_MAX_FILE_BYTES, providedBytes },
    };
  }
  const files = ownerFiles(tenant, workspace);
  const existing = files.get(path);
  // Optimistic concurrency: a supplied If-Match MUST equal the current etag.
  if (input.ifMatch !== undefined && (existing === undefined || existing.etag !== input.ifMatch)) {
    return {
      ok: false,
      status: 409,
      error: 'workspace_conflict',
      details: { currentVersion: existing?.version ?? 0 },
    };
  }
  const version = (existing?.version ?? 0) + 1;
  const file: WorkspaceFile = {
    path,
    // WSR-1 — redact secret-shaped plaintext before it persists.
    content: sanitizeFreeText(input.content),
    contentType: input.contentType ?? 'text/markdown',
    version,
    etag: `"${version}-${Math.random().toString(36).slice(2, 8)}"`,
    updatedAt: new Date().toISOString(),
  };
  files.set(path, file);
  return { ok: true, file };
}

/** Read one file (latest), or null when absent for THIS owner (WCT-1). */
export function getWorkspaceFile(tenant: string, workspace: string, path: string): WorkspaceFile | null {
  return ownerFiles(tenant, workspace).get(path) ?? null;
}

/** List file metadata (no bodies) for THIS owner, optionally prefix-filtered. */
export function listWorkspaceFiles(tenant: string, workspace: string, prefix?: string): WorkspaceFileMeta[] {
  const files = [...ownerFiles(tenant, workspace).values()];
  const filtered = prefix ? files.filter((f) => f.path.startsWith(prefix)) : files;
  return filtered.map(({ content: _content, ...meta }) => meta);
}

/** Delete a file. Returns true when a file existed (so the route can 404). */
export function deleteWorkspaceFile(tenant: string, workspace: string, path: string): boolean {
  return ownerFiles(tenant, workspace).delete(path);
}

/** Reset all workspace state (test teardown). */
export function resetWorkspace(): void {
  store.clear();
}
