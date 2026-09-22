/**
 * Reference manifest-semantics check for the `remote` runtime's MCP registry
 * record (RFC 0203 §A.3).
 *
 * JSON Schema cannot compare two values in one document, so the rule "when
 * `runtime.mcpServer` is present, `runtime.entry` MUST equal
 * `runtime.mcpServer.remotes[0].url`" is stated in prose
 * (`spec/v2/core/node-pack-runtimes.md` §"The MCP registry record") and
 * enforced by a validator. This is the suite's reference form of that
 * validator; the registry publish validator (openwop-registry) applies the
 * same equality.
 *
 * Returns `null` when the manifest satisfies the rule (including every
 * manifest that carries no `mcpServer`), or the refusal a validator emits.
 *
 * @see RFCS/0203-remote-runtime-mcp-registry-record.md §A.3
 */

export interface RemoteEntryRefusal {
  readonly code: 'pack_validation_failed';
  readonly message: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function remoteEntryBinding(manifest: unknown): RemoteEntryRefusal | null {
  const runtime = asRecord(asRecord(manifest)?.['runtime']);
  if (runtime === null) return null;
  const record = asRecord(runtime['mcpServer']);
  if (record === null) return null;
  const remotes = record['remotes'];
  const first = Array.isArray(remotes) ? asRecord(remotes[0]) : null;
  const url = first?.['url'];
  if (typeof url === 'string' && runtime['entry'] === url) return null;
  return {
    code: 'pack_validation_failed',
    message: `runtime.entry (${JSON.stringify(runtime['entry'])}) MUST equal runtime.mcpServer.remotes[0].url (${JSON.stringify(url)})`,
  };
}
