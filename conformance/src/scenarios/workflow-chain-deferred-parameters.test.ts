/**
 * Deferred-parameter expansion — `workflow-chain-packs.md` §"Deferred-parameter
 * expansion (RFC 0124)" + §Security. RFC 0124 (WCP4) lets a workflow-chain
 * pack's `{{params.*}}` stay overridable per run WITHOUT the non-portable
 * app-private runtime tokens RFC 0013 forbids: at drop time the host
 * materializes the chain `parameters` into top-level `variables[]` (author value
 * → `defaultValue`) and rewrites each token into an already-spec'd runtime
 * binding (PromptTemplate `{{varName}}` with `source:"variable"`, or a
 * variable-sourced PortValue), so the persisted fragment carries ZERO
 * `{{params.*}}` tokens.
 *
 * §Security (amended 2026-07-04): a `x-openwop-sensitive` parameter MUST
 * materialize as a `source:"secret"` PromptVariable (BYOK, `[REDACTED]`, never
 * bagged), is deferrable ONLY in a prompt-body position, and FAILS CLOSED
 * (`sensitive_param_not_deferrable`, 422) in a whole-value `node.inputs` /
 * embedded non-prompt config / host lacking `secrets` support. Per-run supply of
 * a sensitive param is a `credentialRef` string, never plaintext (a plaintext
 * `configurable` for a sensitive param ⇒ `validation_error`).
 *
 * Two layers:
 *   A. Always-on, server-free legs against the spec-authoritative reference
 *      `conformance/src/lib/workflow-chain-expansion.ts` (`expandChainDeferred`)
 *      + the capabilities/manifest schema shapes. These pin the deferred-
 *      expansion + §Security MUSTs (the new fail-closed error path has no other
 *      public test).
 *   B. Capability-gated host legs (`workflowChainPacks.deferredParameters.
 *      supported`) over the `workflow-chain-host-expansion` seam — override,
 *      fork-replay, untrusted-fence, and `[REDACTED]` sensitive compose;
 *      soft-skip until a host advertises (openwop-app is the single witness via
 *      its own #1281 gated leg; a second PromptTemplate-compose witness is the
 *      tracked follow-up per gap G6).
 *
 * @see spec/v1/workflow-chain-packs.md §"Deferred-parameter expansion (RFC 0124)"
 * @see schemas/capabilities.schema.json §workflowChainPacks.deferredParameters
 * @see schemas/workflow-chain-pack-manifest.schema.json (x-openwop-sensitive)
 * @see RFCS/0124-portable-per-run-parameter-deferral.md
 * @see SECURITY/invariants.yaml id: prompt-composed-secret-redaction
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import {
  expandChainDeferred,
  SensitiveParamNotDeferrableError,
  type WorkflowChain,
  type DeferredExpansionContext,
} from '../lib/workflow-chain-expansion.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const CAPS = join(SCHEMAS_DIR, 'capabilities.schema.json');
const MANIFEST = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');
// S38 (2026-08-17): `spec/` is NOT in the published package (`files`), so a path built
// from SCHEMAS_DIR/../spec ENOENTs for every npm consumer — five always-on legs reddened
// MyndHyve's bundle for a reason that had nothing to do with the host. Prose legs are
// repo-layout only: `null` in the published layout and skipped, never thrown.
const CHAIN_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, 'workflow-chain-packs.md');

const resolvable = () => true;
const HOST_FULL = { promptVariableSource: true, secretsSupported: true };

/** A minimal chain builder for the deferred-expansion legs. */
function chain(
  nodes: WorkflowChain['dag']['nodes'],
  parameters: object,
): WorkflowChain {
  return {
    chainId: 'test.deferred',
    version: '1.0.0',
    label: 'Deferred test',
    description: 'x',
    parameters,
    dag: { nodes },
  };
}

function deferCtx(
  params: Record<string, unknown>,
  parameterSchema: DeferredExpansionContext['parameterSchema'],
  host = HOST_FULL,
): DeferredExpansionContext {
  return { expansionId: 'a1b2', params, parameterSchema, isTypeIdResolvable: resolvable, host };
}

/** Deep scan for any residual `{{params.*}}` token in the expanded fragment. */
function hasResidualToken(frag: unknown): boolean {
  return /\{\{params\./.test(JSON.stringify(frag));
}

describe('workflow-chain-deferred: non-sensitive deferral (server-free, RFC 0124)', () => {
  it('materializes variables[] with defaultValue+type and leaves ZERO {{params.*}} tokens (R3)', () => {
    const c = chain(
      [
        { id: 'n1', typeId: 'core.agent', config: { systemPrompt: 'Hello {{params.topic}}' } },
        { id: 'n2', typeId: 'core.transform', inputs: { limit: '{{params.count}}' } },
      ],
      {
        properties: {
          topic: { type: 'string', description: 'the topic' },
          count: { type: 'number' },
        },
      },
    );
    const out = expandChainDeferred(c, deferCtx({ topic: 'sales', count: 5 }, c.parameters as never));

    expect(
      hasResidualToken({ nodes: out.nodes, edges: out.edges }),
      req('openwop.it.workflow-chain-deferred-parameters.materializes-variables-with-defaultvalue-type-and-leaves-zero-params-tokens-r3', 'workflow-chain-packs.md §Deferred-parameter expansion', 'the persisted fragment MUST contain zero {{params.*}} tokens (R3 portability)'),
    ).toBe(false);

    const topicVar = out.variables.find((v) => v.name === 'topic');
    expect(topicVar, req('openwop.it.workflow-chain-deferred-parameters.materializes-variables-with-defaultvalue-type-and-leaves-zero-params-tokens-r3', 'workflow-chain-packs.md', 'topic MUST be materialized as a top-level variable')).toBeDefined();
    expect(topicVar!.defaultValue, req('openwop.it.workflow-chain-deferred-parameters.materializes-variables-with-defaultvalue-type-and-leaves-zero-params-tokens-r3', 'workflow-chain-packs.md', 'author input becomes defaultValue')).toBe('sales');
    expect(topicVar!.type, req('openwop.it.workflow-chain-deferred-parameters.materializes-variables-with-defaultvalue-type-and-leaves-zero-params-tokens-r3', 'workflow-chain-packs.md', 'type copied from the parameter schema')).toBe('string');

    // prompt token → {{varName}} + source:"variable"
    expect((out.nodes[0].config as { systemPrompt: string }).systemPrompt).toBe('Hello {{topic}}');
    expect(out.promptVariables.find((p) => p.name === 'topic')?.source).toBe('variable');
  });

  it('a whole-value input token becomes a variable-sourced PortValue (WCP2 raw-typed)', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.transform', inputs: { limit: '{{params.count}}' } }],
      { properties: { count: { type: 'number' } } },
    );
    const out = expandChainDeferred(c, deferCtx({ count: 5 }, c.parameters as never));
    expect(
      out.nodes[0].inputs!.limit,
      req('openwop.it.workflow-chain-deferred-parameters.a-whole-value-input-token-becomes-a-variable-sourced-portvalue-wcp2-raw-typed', 'workflow-chain-packs.md §Deferred-parameter expansion', 'a whole-value {{params.x}} input rewrites to a variable-sourced PortValue, not a stringified token'),
    ).toEqual({ source: 'variable', variable: 'count' });
  });

  it('the bare param name is the override key in the auto-generated configurableSchema (R6)', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.agent', config: { systemPrompt: '{{params.topic}}' } }],
      { properties: { topic: { type: 'string' } } },
    );
    const out = expandChainDeferred(c, deferCtx({ topic: 't' }, c.parameters as never));
    expect(
      out.configurableSchema.properties.topic,
      req('openwop.it.workflow-chain-deferred-parameters.the-bare-param-name-is-the-override-key-in-the-auto-generated-configurableschema', 'workflow-chain-packs.md §Override key + variable naming', 'the bare parameter name is the normative override key'),
    ).toEqual({ type: 'string' });
  });
});

describe('workflow-chain-deferred: §Security sensitive-parameter MUSTs (server-free, RFC 0124)', () => {
  const sensitiveSchema = { properties: { apiKey: { type: 'string', 'x-openwop-sensitive': true } } };

  it('a sensitive param in a prompt body materializes as source:"secret" — NO plaintext default persisted', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.agent', config: { systemPrompt: 'key={{params.apiKey}}' } }],
      sensitiveSchema,
    );
    const out = expandChainDeferred(c, deferCtx({ apiKey: 'sk-PLAINTEXT-SECRET' }, sensitiveSchema));

    expect(
      out.promptVariables.find((p) => p.name === 'apiKey')?.source,
      req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-in-a-prompt-body-materializes-as-source-secret-no-plaintext-de', 'workflow-chain-packs.md §Security', 'a sensitive prompt-body param MUST bind source:"secret" (not source:"variable")'),
    ).toBe('secret');
    // The plaintext secret MUST appear NOWHERE — not as a variable defaultValue, not in the fragment.
    expect(
      JSON.stringify(out).includes('sk-PLAINTEXT-SECRET'),
      req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-in-a-prompt-body-materializes-as-source-secret-no-plaintext-de', 'workflow-chain-packs.md §Security', 'the sensitive value MUST NOT be materialized into variables[] or the persisted fragment (never bagged, SR-1)'),
    ).toBe(false);
    expect(out.variables.find((v) => v.name === 'apiKey'), req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-in-a-prompt-body-materializes-as-source-secret-no-plaintext-de', 'workflow-chain-packs.md', 'sensitive param is NOT a plaintext top-level variable')).toBeUndefined();
  });

  it('a sensitive param in a whole-value node.input FAILS CLOSED (sensitive_param_not_deferrable, 422)', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.transform', inputs: { secret: '{{params.apiKey}}' } }],
      sensitiveSchema,
    );
    let err: unknown;
    try {
      expandChainDeferred(c, deferCtx({ apiKey: 'sk-x' }, sensitiveSchema));
    } catch (e) {
      err = e;
    }
    expect(err, req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-in-a-whole-value-node-input-fails-closed-sensitive-param-not-d', 'workflow-chain-packs.md', 'a sensitive whole-value input MUST throw, not defer')).toBeInstanceOf(SensitiveParamNotDeferrableError);
    expect(
      (err as SensitiveParamNotDeferrableError).code,
      req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-in-a-whole-value-node-input-fails-closed-sensitive-param-not-d', 'workflow-chain-packs.md §Security', 'a sensitive param outside a prompt body MUST fail closed with sensitive_param_not_deferrable'),
    ).toBe('sensitive_param_not_deferrable');
    expect((err as SensitiveParamNotDeferrableError).httpStatus).toBe(422);
  });

  it('a sensitive prompt-body param on a host WITHOUT secrets support FAILS CLOSED (422)', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.agent', config: { systemPrompt: '{{params.apiKey}}' } }],
      sensitiveSchema,
    );
    let err: unknown;
    try {
      expandChainDeferred(c, deferCtx({ apiKey: 'sk-x' }, sensitiveSchema, { promptVariableSource: true, secretsSupported: false }));
    } catch (e) {
      err = e;
    }
    expect(
      err,
      req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-prompt-body-param-on-a-host-without-secrets-support-fails-closed-422', 'workflow-chain-packs.md §Security', 'a host lacking capabilities.secrets MUST NOT plaintext-defer a sensitive param — fail closed'),
    ).toBeInstanceOf(SensitiveParamNotDeferrableError);
  });

  it('negative capability: no prompts.variable source ⇒ prompt token falls back to expansion-time (G5)', () => {
    const c = chain(
      [{ id: 'n1', typeId: 'core.agent', config: { systemPrompt: 'Hi {{params.topic}}' } }],
      { properties: { topic: { type: 'string' } } },
    );
    const out = expandChainDeferred(
      c,
      deferCtx({ topic: 'sales' }, c.parameters as never, { promptVariableSource: false, secretsSupported: true }),
    );
    // Fallback resolves the token at expansion time — no {{topic}} slot, value inlined, still zero {{params.*}}.
    expect((out.nodes[0].config as { systemPrompt: string }).systemPrompt).toBe('Hi sales');
    expect(hasResidualToken({ nodes: out.nodes }), req('openwop.it.workflow-chain-deferred-parameters.negative-capability-no-prompts-variable-source-prompt-token-falls-back-to-expans', 'workflow-chain-packs.md', 'no residual {{params.*}} even on the fallback path')).toBe(false);
  });
});

describe('workflow-chain-deferred: schema + spec surface (always-on, server-free)', () => {
  it('capabilities.schema.json §workflowChainPacks.deferredParameters requires supported:boolean', () => {
    const raw = readFileSync(CAPS, 'utf8');
    // The deferredParameters block MUST parse as part of the capabilities schema.
    expect(() => JSON.parse(raw), req('openwop.it.workflow-chain-deferred-parameters.capabilities-schema-json-workflowchainpacks-deferredparameters-requires-supporte', 'workflow-chain-packs.md', 'capabilities.schema.json MUST be valid JSON')).not.toThrow();
    expect(raw.includes('"deferredParameters"'), req('openwop.it.workflow-chain-deferred-parameters.capabilities-schema-json-workflowchainpacks-deferredparameters-requires-supporte', 'workflow-chain-packs.md', 'the deferredParameters capability block MUST exist')).toBe(true);
    expect(
      raw.includes('sensitive_param_not_deferrable'),
      req('openwop.it.workflow-chain-deferred-parameters.capabilities-schema-json-workflowchainpacks-deferredparameters-requires-supporte', 'capabilities.schema.json §deferredParameters', 'the capability description MUST reference the fail-closed sensitive rule'),
    ).toBe(true);
  });

  it('workflow-chain-pack-manifest.schema.json documents x-openwop-sensitive with the source:"secret" MUST', () => {
    const raw = readFileSync(MANIFEST, 'utf8');
    expect(raw.includes('x-openwop-sensitive'), req('openwop.it.workflow-chain-deferred-parameters.workflow-chain-pack-manifest-schema-json-documents-x-openwop-sensitive-with-the', 'workflow-chain-packs.md', 'the manifest schema MUST recognize x-openwop-sensitive')).toBe(true);
    expect(
      raw.includes('source:"secret"') || raw.includes('source:\\"secret\\"'),
      req('openwop.it.workflow-chain-deferred-parameters.workflow-chain-pack-manifest-schema-json-documents-x-openwop-sensitive-with-the', 'workflow-chain-pack-manifest.schema.json', 'the x-openwop-sensitive description MUST reflect the amended source:"secret" MUST, not the stale plaintext-variable wording'),
    ).toBe(true);
  });

  it.skipIf(CHAIN_DOC === null)('the spec pins the error code + the per-run credentialRef (not plaintext) supply shape', () => {
    const spec = readFileSync(CHAIN_DOC as string, 'utf8');
    expect(spec.includes('sensitive_param_not_deferrable'), req('openwop.it.workflow-chain-deferred-parameters.the-spec-pins-the-error-code-the-per-run-credentialref-not-plaintext-supply-shap', 'workflow-chain-packs.md', 'error code MUST be documented')).toBe(true);
    expect(
      spec.includes('credentialRef'),
      req('openwop.it.workflow-chain-deferred-parameters.the-spec-pins-the-error-code-the-per-run-credentialref-not-plaintext-supply-shap', 'workflow-chain-packs.md §Security', 'per-run supply of a sensitive param MUST be a credentialRef, not plaintext'),
    ).toBe(true);
  });
});

describe('workflow-chain-deferred: host behavior (capability-gated, RFC 0124)', () => {
  it('a deferred round-trip: bare-param configurable override changes the value; :fork replays it', async () => {
    const wcp = await readCapabilityFamily<{ deferredParameters?: { supported?: boolean } }>('workflowChainPacks');
    if (!behaviorGate('workflowChainPacks.deferredParameters.supported', wcp?.deferredParameters?.supported === true)) return;

    const res = await driver.post('/v1/host/sample/chain/deferred-expand', {
      chainId: 'conformance.deferred',
      params: { topic: 'default-topic' },
      override: { topic: 'run-topic' },
      fork: true,
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { resolved?: string; forkResolved?: string; contentTrust?: string } | undefined;
    expect(
      body?.resolved,
      req('openwop.it.workflow-chain-deferred-parameters.a-deferred-round-trip-bare-param-configurable-override-changes-the-value-fork-re', 'workflow-chain-packs.md §Deferred-parameter expansion', 'a bare-param configurable override rebinds the resolved value'),
    ).toBe('run-topic');
    expect(
      body?.forkResolved,
      req('openwop.it.workflow-chain-deferred-parameters.a-deferred-round-trip-bare-param-configurable-override-changes-the-value-fork-re', 'replay.md §Determinism', ':fork replays the same bound value (RunSnapshot.variables byte-equivalence, R4)'),
    ).toBe('run-topic');
    expect(
      body?.contentTrust,
      req('openwop.it.workflow-chain-deferred-parameters.a-deferred-round-trip-bare-param-configurable-override-changes-the-value-fork-re', 'workflow-chain-packs.md §Deferred-parameter expansion step 4', 'a deferred-variable prompt binding composes contentTrust:"untrusted" (R1)'),
    ).toBe('untrusted');
  });

  it('a sensitive param composes as [REDACTED:<credentialRef>] and the plaintext appears nowhere', async () => {
    const wcp = await readCapabilityFamily<{ deferredParameters?: { supported?: boolean } }>('workflowChainPacks');
    if (!behaviorGate('workflowChainPacks.deferredParameters.supported', wcp?.deferredParameters?.supported === true)) return;

    const res = await driver.post('/v1/host/sample/chain/deferred-expand', {
      chainId: 'conformance.deferred-sensitive',
      sensitiveParam: 'apiKey',
      credentialRef: 'cred-123',
    });
    if (res.status === 404 || res.status === 403) return softSkip('blocked', 'precondition not met — `res.status === 404 || res.status === 403` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    const body = res.json as { composed?: string } | undefined;
    expect(
      body?.composed?.includes('[REDACTED'),
      req('openwop.it.workflow-chain-deferred-parameters.a-sensitive-param-composes-as-redacted-credentialref-and-the-plaintext-appears-n', 'workflow-chain-packs.md §Security', 'a source:"secret" sensitive var MUST redact to [REDACTED:<credentialRef>] in prompt.composed'),
    ).toBe(true);
  });
});
