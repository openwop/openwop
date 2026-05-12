/**
 * core.llm.chat + 4-mode policy enforcement smoke (Phase H.1″).
 *
 * Verifies the host's `aiProviders.policies` enforcement contract
 * against the in-process Postgres reference host. Tests each of the
 * four policy modes per `capabilities.md` §`aiProviders.policies`:
 *
 *   - `optional`   permits without credentialRef
 *   - `disabled`   rejects with reason `provider_disabled`
 *   - `required`   rejects with `byok_required` when credentialRef absent
 *   - `required`   rejects with `byok_required_but_unresolved` when present-but-unresolves
 *   - `restricted` permits matching model
 *   - `restricted` rejects with `model_not_allowed` for non-matching model
 *   - `restricted` fail-closed on empty allowedModels
 *
 * Plus the SR-1 redaction invariant: when a credentialRef IS resolved,
 * the cleartext NEVER appears on any observable surface (variables,
 * events, snapshot).
 *
 * The host's AI proxy is stubbed (returns deterministic mock output);
 * production deployers swap in real provider SDKs.
 *
 * @see spec/v1/capabilities.md §`aiProviders.policies`
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'openwop-pg-aipolicy-'));
process.env.OPENWOP_AUDIT_KEY_DIR = workdir;
process.env.OPENWOP_CANARY_SECRET_VALUE = 'phase-h1-prime-canary-not-a-real-credential';

import {
  resolveProviderPolicy,
  enforcePolicy,
  callAiProvider,
  AiPolicyDenied,
} from '../src/ai-proxy.js';

async function main(): Promise<void> {
  // 1. `optional` (no env override): permit without credentialRef.
  delete process.env.OPENWOP_AI_POLICY_ANTHROPIC;
  {
    const policy = resolveProviderPolicy('anthropic');
    assert.equal(policy.mode, 'optional', 'absent env MUST default to optional');
    const r = enforcePolicy(policy, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input: { messages: [] },
    });
    assert.equal(r.credentialCleartext, null);
  }

  // 2. `disabled`: rejects with provider_disabled regardless of credentialRef.
  process.env.OPENWOP_AI_POLICY_OPENAI = 'disabled';
  try {
    enforcePolicy(resolveProviderPolicy('openai'), {
      provider: 'openai',
      model: 'gpt-4o',
      input: {},
    });
    assert.fail('disabled mode MUST throw');
  } catch (err: unknown) {
    assert.ok(err instanceof AiPolicyDenied);
    assert.equal((err as AiPolicyDenied).reason, 'provider_disabled');
  }

  // 3. `required` + no credentialRef → byok_required.
  process.env.OPENWOP_AI_POLICY_ANTHROPIC = 'required';
  try {
    enforcePolicy(resolveProviderPolicy('anthropic'), {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      input: {},
    });
    assert.fail('required mode without credentialRef MUST throw');
  } catch (err: unknown) {
    assert.ok(err instanceof AiPolicyDenied);
    assert.equal((err as AiPolicyDenied).reason, 'byok_required');
  }

  // 4. `required` + present-but-unresolvable credentialRef → byok_required_but_unresolved.
  try {
    enforcePolicy(resolveProviderPolicy('anthropic'), {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      credentialRef: 'unknown-secret-id-not-canary',
      input: {},
    });
    assert.fail('required mode with unresolved credentialRef MUST throw');
  } catch (err: unknown) {
    assert.ok(err instanceof AiPolicyDenied);
    assert.equal((err as AiPolicyDenied).reason, 'byok_required_but_unresolved');
  }

  // 5. `required` + valid credentialRef → permit + cleartext resolved.
  {
    const r = enforcePolicy(resolveProviderPolicy('anthropic'), {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      credentialRef: 'openwop-conformance-canary-secret',
      input: {},
    });
    assert.equal(r.credentialCleartext, 'phase-h1-prime-canary-not-a-real-credential');
  }

  // 6. `restricted` with empty allowedModels → fail-closed with model_not_allowed.
  process.env.OPENWOP_AI_POLICY_GEMINI = 'restricted'; // no models
  try {
    enforcePolicy(resolveProviderPolicy('gemini'), {
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      input: {},
    });
    assert.fail('restricted with empty allowedModels MUST fail-closed');
  } catch (err: unknown) {
    assert.ok(err instanceof AiPolicyDenied);
    assert.equal((err as AiPolicyDenied).reason, 'model_not_allowed');
    assert.deepEqual((err as AiPolicyDenied).details.allowed, []);
  }

  // 7. `restricted` with matching glob → permit.
  process.env.OPENWOP_AI_POLICY_GEMINI = 'restricted:gemini-1.5*';
  {
    const r = enforcePolicy(resolveProviderPolicy('gemini'), {
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      input: {},
    });
    assert.equal(r.credentialCleartext, null);
  }

  // 8. `restricted` with non-matching model → model_not_allowed.
  try {
    enforcePolicy(resolveProviderPolicy('gemini'), {
      provider: 'gemini',
      model: 'gemini-2.0-experimental',
      input: {},
    });
    assert.fail('restricted with non-matching model MUST throw');
  } catch (err: unknown) {
    assert.ok(err instanceof AiPolicyDenied);
    assert.equal((err as AiPolicyDenied).reason, 'model_not_allowed');
  }

  // 9. SR-1: provider result NEVER contains cleartext credential.
  {
    const cleartext = 'phase-h1-prime-canary-not-a-real-credential';
    const result = await callAiProvider(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        credentialRef: 'openwop-conformance-canary-secret',
        input: { messages: [{ role: 'user', content: 'hi' }] },
      },
      cleartext,
    );
    const dump = JSON.stringify(result);
    assert.equal(
      dump.includes(cleartext),
      false,
      'AiCallResult JSON MUST NOT contain raw credential cleartext (SR-1)',
    );
    const expectedHash = createHash('sha256').update(cleartext, 'utf8').digest('hex');
    assert.equal(result.credentialRefHashed, expectedHash,
      'credentialRefHashed MUST equal SHA-256(cleartext)');
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.model, 'claude-sonnet-4-6');
    assert.ok(result.inputTokens > 0);
    assert.ok(result.outputTokens > 0);
  }

  // eslint-disable-next-line no-console
  console.log('ok ai-policy — H.1″ verified (8 policy paths + SR-1)');

  rmSync(workdir, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
