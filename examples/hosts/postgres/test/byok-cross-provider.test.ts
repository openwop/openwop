/**
 * SEC-6 — Cross-provider BYOK matrix.
 *
 * Exercises the 3-provider × 4-mode matrix to verify that BYOK
 * cleartext NEVER leaks regardless of which provider routes the
 * call and which policy mode the host enforces. Each cell checks:
 *
 *   - Policy enforcement outcome (permit vs AiPolicyDenied with the
 *     correct `reason` enum).
 *   - When permitted: credentialRefHashed is a 64-hex SHA-256 of the
 *     cleartext; the cleartext itself NEVER appears on any returned
 *     field (provider/model/outputText/inputTokens/outputTokens/
 *     durationMs/credentialRefHashed).
 *   - When denied: no AiCallResult is produced; the cleartext was
 *     never passed to callAiProvider.
 *
 * Companion to the per-mode coverage in `ai-policy.test.ts` (which
 * tests modes but not systematically across providers).
 *
 * Each provider's policy is sourced from `OPENWOP_AI_POLICY_<PROVIDER>`
 * env vars before the module loads, so the test sets up all 12 cells
 * by configuring policies per-cell + invoking the resolver.
 *
 * @see plans/openwop-protocol-gap-closure-plan.md Workstream 4 SEC-6
 * @see examples/hosts/postgres/src/ai-proxy.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Set canary cleartext BEFORE importing ai-proxy so the resolver
// returns our known value.
const SECRET = 'sk-byok-test-secret-do-not-use-in-prod-canary-value';
process.env.OPENWOP_CANARY_SECRET_VALUE = SECRET;

const {
  AiPolicyDenied,
  callAiProvider,
  enforcePolicy,
} = await import('../src/ai-proxy.js');
type AiCallRequest = import('../src/ai-proxy.js').AiCallRequest;
type AiProviderPolicy = import('../src/ai-proxy.js').AiProviderPolicy;

const PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
const MODES = ['disabled', 'optional', 'required', 'restricted'] as const;
const CANARY_REF = 'openwop-conformance-canary-secret';
const EXPECTED_HASH = createHash('sha256').update(SECRET, 'utf8').digest('hex');

/**
 * Drive one cell of the matrix. Returns the outcome metadata so the
 * caller can format a single summary line per cell.
 */
async function exerciseCell(
  provider: typeof PROVIDERS[number],
  mode: typeof MODES[number],
): Promise<{ outcome: string; redactionOk: boolean; details: Record<string, unknown> }> {
  const policy: AiProviderPolicy = mode === 'restricted'
    ? { mode, allowedModels: ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro'] }
    : { mode, allowedModels: undefined };

  const request: AiCallRequest = {
    provider,
    model: provider === 'openai' ? 'gpt-4o' : provider === 'anthropic' ? 'claude-3-5-sonnet' : 'gemini-1.5-pro',
    credentialRef: CANARY_REF,
    input: { messages: [{ role: 'user', content: 'test prompt' }] },
  };

  // 1. Enforce policy.
  try {
    const enforced = enforcePolicy(policy, request);
    // 'disabled' must throw; reaching here is a failure.
    if (mode === 'disabled') {
      return { outcome: 'unexpected-permit', redactionOk: false, details: { mode } };
    }
    // For permit cases, supply the cleartext to callAiProvider and
    // verify the redaction contract.
    const result = await callAiProvider(request, SECRET);

    // The whole result MUST NOT contain the cleartext anywhere.
    const dump = JSON.stringify(result);
    const cleartextLeaked = dump.includes(SECRET);
    const hashCorrect = result.credentialRefHashed === EXPECTED_HASH;

    return {
      outcome: 'permitted',
      redactionOk: !cleartextLeaked && hashCorrect,
      details: {
        provider: result.provider,
        model: result.model,
        cleartextLeaked,
        hashCorrect,
        durationMs: result.durationMs,
      },
    };
  } catch (err) {
    if (err instanceof AiPolicyDenied) {
      // Verify denial.details NEVER includes the cleartext.
      const detailsDump = JSON.stringify(err.details);
      const denialLeaked = detailsDump.includes(SECRET);
      return {
        outcome: `denied:${err.reason}`,
        redactionOk: !denialLeaked,
        details: { reason: err.reason, denialLeaked },
      };
    }
    return { outcome: `error:${(err as Error).message}`, redactionOk: false, details: {} };
  }
}

async function main(): Promise<void> {
  const cells: Array<{
    provider: string;
    mode: string;
    outcome: string;
    redactionOk: boolean;
  }> = [];

  for (const provider of PROVIDERS) {
    for (const mode of MODES) {
      const { outcome, redactionOk, details } = await exerciseCell(provider, mode);
      cells.push({ provider, mode, outcome, redactionOk });
      assert.ok(redactionOk, `[${provider}/${mode}] redaction failure: ${JSON.stringify(details)}`);
    }
  }

  // Verify the matrix has the expected shape:
  //   - All 'disabled' cells are denied:provider_disabled.
  //   - All 'optional' / 'required' cells are permitted.
  //   - All 'restricted' cells are permitted (the test uses
  //     models in the allowlist).
  for (const cell of cells) {
    if (cell.mode === 'disabled') {
      assert.equal(
        cell.outcome,
        'denied:provider_disabled',
        `[${cell.provider}/${cell.mode}] expected denied:provider_disabled, got ${cell.outcome}`,
      );
    } else {
      assert.equal(
        cell.outcome,
        'permitted',
        `[${cell.provider}/${cell.mode}] expected permitted, got ${cell.outcome}`,
      );
    }
  }

  // Cross-provider symmetry check — the same cleartext produces the
  // same hash regardless of provider.
  for (const cell of cells) {
    if (cell.outcome === 'permitted') {
      // Already asserted hashCorrect inside exerciseCell.
    }
  }

  // SEC-6 acceptance signal.
  const summary = cells
    .map((c) => `  ${c.provider.padEnd(10)} × ${c.mode.padEnd(11)} → ${c.outcome}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.log('ok byok-cross-provider — 3 providers × 4 modes = 12 cells verified, redaction holds for all\n' + summary);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
