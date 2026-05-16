/**
 * Cost helpers — reads pricing from providers.json and computes per-turn
 * USD from the message's usage metadata.
 *
 * Pricing in providers.json is per 1K tokens (e.g., 0.003 = $3/1M).
 * A message with `inputTokens: 200, outputTokens: 80` on a model with
 * `cost: { input: 0.003, output: 0.015 }` costs:
 *   (200 * 0.003 + 80 * 0.015) / 1000 = $0.0018
 */

import { getProvider } from '../../byok/lib/providers.js';
import type { ChatMessage, ChatSession } from '../hooks/useChatSession.js';

export function turnCostUsd(meta: ChatMessage['meta']): number | null {
  if (!meta?.provider || !meta?.model) return null;
  if (meta.inputTokens == null && meta.outputTokens == null) return null;
  try {
    const provider = getProvider(meta.provider);
    const model = provider.models.find((m) => m.id === meta.model);
    if (!model?.cost) return null;
    const inT = meta.inputTokens ?? 0;
    const outT = meta.outputTokens ?? 0;
    return (inT * model.cost.input + outT * model.cost.output) / 1000;
  } catch {
    return null;
  }
}

export function sessionCostUsd(session: ChatSession): number {
  let total = 0;
  for (const m of session.messages) {
    const c = turnCostUsd(m.meta);
    if (c) total += c;
  }
  return total;
}

/** Display formatter — small numbers get more decimals, large ones get rounded. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
