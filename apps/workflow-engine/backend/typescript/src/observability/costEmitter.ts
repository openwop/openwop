/**
 * Cost emitter. Records per-node + per-run cost attributes onto the
 * active OTel span under the `openwop.cost.*` namespace.
 *
 * Sample-grade: stores totals in-process (no metering integration).
 * Real deployers wire to their billing pipeline (Stripe usage records,
 * BigQuery, etc.).
 */

import { trace } from '@opentelemetry/api';

interface CostRecord {
  promptTokens?: number;
  completionTokens?: number;
  usdCost?: number;
  provider?: string;
  model?: string;
}

export function emitCost(record: CostRecord): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  if (record.promptTokens != null) {
    span.setAttribute('openwop.cost.prompt_tokens', record.promptTokens);
  }
  if (record.completionTokens != null) {
    span.setAttribute('openwop.cost.completion_tokens', record.completionTokens);
  }
  if (record.usdCost != null) {
    span.setAttribute('openwop.cost.usd', record.usdCost);
  }
  if (record.provider) span.setAttribute('openwop.ai.provider', record.provider);
  if (record.model) span.setAttribute('openwop.ai.model', record.model);
}
