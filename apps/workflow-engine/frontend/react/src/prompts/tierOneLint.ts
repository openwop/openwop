/**
 * tierOneLint — RFC 0030 §B static lint over schema-hint prompt text.
 *
 * The Tier-1 subset (`spec/v1/structured-output-subset.md`) documents
 * which JSON-Schema features survive across OpenAI strict mode ∩
 * Anthropic strict tool use ∩ Google Gemini `responseSchema`. The
 * highest-impact violation is `oneOf` — Gemini silently drops it, which
 * is a *silent correctness bug*, not a loud error.
 *
 * This linter is intentionally a coarse text-grep over the prompt's
 * `text` field, not a full JSON-Schema walker. It catches the obvious
 * footguns without needing a schema parser. False-positives are
 * tolerable (the message links to the spec doc; users can ignore).
 *
 * Trigger contract:
 *   - Runs against prompts of `kind: 'schema-hint'` only.
 *   - Triggers SHOULD when the host advertises
 *     `capabilities.envelopes.tierOneSubsetCompliance: 'strict'`.
 *   - Returns the (possibly-empty) list of finding labels.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §B
 * @see spec/v1/structured-output-subset.md
 */

import type { PromptTemplate } from './types.js';

export interface TierOneFinding {
  rule: string;
  label: string;
}

export function lintPromptForTierOne(p: PromptTemplate): TierOneFinding[] {
  if (p.kind !== 'schema-hint') return [];
  const text = p.text ?? '';
  const findings: TierOneFinding[] = [];

  // `oneOf` — UNSUPPORTED in Gemini `responseSchema` (silent drop).
  // Recommendation: use `anyOf` or restructure into a discriminator union.
  if (/(^|[\s"'\[,{])oneOf(\s|"|'|\:)/.test(text)) {
    findings.push({
      rule: 'no-oneOf',
      label: '`oneOf` — Gemini silently drops; prefer `anyOf` or discriminator union',
    });
  }

  // Lack of `additionalProperties: false` on an object schema is a Tier-1
  // violation (OpenAI strict requires it). Detect when text mentions
  // `"type": "object"` without a sibling `additionalProperties: false`.
  const hasObjectType = /"type"\s*:\s*"object"/.test(text);
  const hasAdditionalPropertiesFalse = /"additionalProperties"\s*:\s*false/.test(text);
  if (hasObjectType && !hasAdditionalPropertiesFalse) {
    findings.push({
      rule: 'object-needs-additionalProperties-false',
      label: 'object schema missing `additionalProperties: false` — required for OpenAI strict',
    });
  }

  // Optional fields under OpenAI strict need the emulation pattern
  // (a `null` union or sentinel). Crude check: any `"required"` array
  // present and the property list (best-effort regex) is shorter than
  // the required count is OK; we can't really tell without parsing.
  // Skip for now — false-positives outweigh the value.

  return findings;
}

/** Convenience aggregate — count findings across a prompt corpus. */
export function tierOneFindingsCount(prompts: readonly PromptTemplate[]): number {
  return prompts.reduce((acc, p) => acc + (lintPromptForTierOne(p).length > 0 ? 1 : 0), 0);
}
