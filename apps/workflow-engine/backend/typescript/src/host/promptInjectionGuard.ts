/**
 * Prompt-injection guard — host-side helper that wraps untrusted
 * content in `<UNTRUSTED ...>` markers before it reaches an LLM
 * prompt context. Per `SECURITY/threat-model-prompt-injection.md`:
 *
 *   `prompt-injection-input-marker`     — workflow inputs
 *   `prompt-injection-kb-marker`        — KB / RAG retrieved content
 *   `prompt-injection-artifact-marker`  — prior-artifact content
 *   `prompt-injection-mcp-marker`       — MCP tool responses
 *
 * And per `spec/v1/ai-envelope.md §"Trust boundary"`:
 *
 *   "Downstream LLM nodes that re-consume these events MUST treat the
 *    content as untrusted input per the prompt-injection-mitigation
 *    rules in SECURITY/threat-model-prompt-injection.md."
 *
 * The helper is the canonical wrap site for the workflow-engine
 * sample. LLM-node implementations consume `wrapForLLMPrompt(...)`
 * before composing their prompt; the seam at
 * `POST /v1/host/sample/test/llm-prompt-wrap` exposes it directly
 * so conformance can assert the wrap contract without driving a
 * full LLM-node execution.
 *
 * The wrap is intentionally simple — string surround with a typed
 * opening tag — so the threat model is auditable. The marker
 * convention matches threat-model line 95 (`<UNTRUSTED tool="...">`)
 * and the broader `<UNTRUSTED>...</UNTRUSTED>` envelope used
 * throughout the threat model. Attribute order is stable; payloads
 * are JSON-stringified with 2-space indent so a human auditor can
 * see exactly what reached the prompt.
 */

/** Input to the wrap helper. Mirrors the relevant fields of a
 *  RunEventDoc that a downstream LLM node would consume. */
export interface PromptWrapInput {
  /** From `RunEventDoc.contentTrust` (per RFC 0021 §"Trust boundary").
   *  `'untrusted'` triggers the wrap; `'trusted'` (or absent) passes
   *  payload through unwrapped. */
  contentTrust?: 'trusted' | 'untrusted';
  /** The payload to interpolate into the prompt. Stringified as JSON
   *  if not already a string. */
  payload: unknown;
  /** Optional event-type for the `type="..."` attribute on the
   *  opening tag (e.g., `"clarification.request"`). Defaults to
   *  `"unknown"` so the tag is always shape-correct. */
  eventType?: string;
  /** Optional source attribution (e.g., `"run-event"`, `"mcp-tool"`,
   *  `"kb-retrieval"`). Defaults to `"run-event"` since the canonical
   *  consumer is a downstream LLM node re-reading a RunEventDoc. */
  source?: string;
  /** Optional extra attributes for the opening tag (e.g.,
   *  `{tool: "search"}` for MCP responses). Values are JSON-stringified
   *  if non-string; never HTML-escaped (the wrap is for prompt context,
   *  not HTML rendering). */
  attributes?: Record<string, string | number | boolean>;
}

/** Returns the prompt-ready string. For untrusted input, wraps the
 *  payload in `<UNTRUSTED source="..." type="..." ...>...</UNTRUSTED>`.
 *  For trusted input, returns the stringified payload unchanged.
 *
 *  Idempotent in spirit — calling again on output won't double-wrap
 *  *the same* outer payload because trusted output passes through;
 *  but callers SHOULD wrap once at the trust boundary. The helper
 *  doesn't try to detect already-wrapped content (would be fragile).
 */
export function wrapForLLMPrompt(input: PromptWrapInput): string {
  const payloadText =
    typeof input.payload === 'string'
      ? input.payload
      : JSON.stringify(input.payload, null, 2);

  if (input.contentTrust !== 'untrusted') {
    return payloadText;
  }

  const source = input.source ?? 'run-event';
  const eventType = input.eventType ?? 'unknown';
  const attrs: string[] = [`source="${escapeAttr(source)}"`, `type="${escapeAttr(eventType)}"`];
  if (input.attributes) {
    // Stable attribute ordering for determinism (helps the conformance
    // assertion match exact strings).
    for (const key of Object.keys(input.attributes).sort()) {
      const v = input.attributes[key];
      attrs.push(`${key}="${escapeAttr(String(v))}"`);
    }
  }
  return `<UNTRUSTED ${attrs.join(' ')}>\n${payloadText}\n</UNTRUSTED>`;
}

/** Minimal attribute escape — only the closing-quote and the `<`
 *  character. The wrap is for prompt context, not HTML; full HTML
 *  escaping would over-encode. */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
