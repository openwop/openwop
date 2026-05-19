/**
 * HostAdapterSuite — the 15 host-extension slots in one factory.
 *
 * Mirrors the MyndHyve `HostAdapterSuite` triage from
 * services/workflow-runtime/src/host/index.ts. Every slot has either a
 * real wrap, a minimal wrap, or a throw-on-use stub. Routes consume
 * adapters from this suite, never construct them inline.
 *
 * To replace a stub with a real implementation (e.g., wire OIDC
 * identity), swap the impl here. Route handlers stay unchanged.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import type { Principal } from '../types.js';
import { OpenwopError } from '../types.js';
import type { WorkflowDefinition } from '../executor/types.js';
import { getRegisteredWorkflow } from './workflowsRegistry.js';

/**
 * Load conformance fixtures from the in-tree `conformance/fixtures/`
 * directory so the sample BE can stand in as a black-box conformance
 * target. Only fixtures whose typeIds are registered on this host
 * (chat-responder, demo-uppercase, mock-agent, core.*) are loadable;
 * everything else surfaces as "workflow not found" if a run requests it.
 *
 * Discovery (`routes/discovery.ts`) advertises the loaded fixtures via
 * `capabilities.fixtures` so capability-gated conformance scenarios
 * can detect what this host actually supports.
 */
function findConformanceFixturesDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../../../../conformance/fixtures'),  // tsx dev from src/host
    resolve(here, '../../../../../conformance/fixtures'),     // tsx dev one fewer (just in case)
    resolve(here, '../../../../conformance/fixtures'),        // esbuild bundle lib/
    resolve(here, './conformance/fixtures'),                  // vendored alongside
    resolve(process.cwd(), 'conformance/fixtures'),           // CWD fallback
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

const conformanceFixtures = new Map<string, WorkflowDefinition>();
(function loadConformanceFixtures(): void {
  const dir = findConformanceFixturesDir();
  if (!dir) return;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as WorkflowDefinition & { id?: string; workflowId?: string };
        const id = parsed.workflowId ?? parsed.id;
        if (typeof id === 'string' && id.length > 0) {
          conformanceFixtures.set(id, { ...parsed, workflowId: id });
        }
      } catch {
        /* skip malformed fixture */
      }
    }
  } catch {
    /* directory unreadable — sample BE just doesn't act as a conformance target */
  }
})();

/** Public — list loaded conformance fixture ids for `capabilities.fixtures`. */
export function listLoadedConformanceFixtures(): readonly string[] {
  return Array.from(conformanceFixtures.keys()).sort();
}

const log = createLogger('host');

export interface HostAdapterSuite {
  // Real wraps (8)
  tenantResolver: TenantResolver;
  scopeResolver: ScopeResolver;
  workflowCatalog: WorkflowCatalog;
  principalAuthorizer: PrincipalAuthorizer;
  identityResolver: IdentityResolver;
  observabilitySink: ObservabilitySink;
  auditSink: AuditSink;
  secretResolver: SecretResolver;

  // Minimal wraps (3)
  artifactResolver: ArtifactResolver;
  contextProviderRegistry: ContextProviderRegistry;
  extensionManifestRegistry: ExtensionManifestRegistry;

  // Throw-on-use stubs (4)
  enterprisePolicyResolver: EnterprisePolicyResolver;
  environmentResolver: EnvironmentResolver;
  connectorInvoker: ConnectorInvoker;
  providerPolicyResolver: ProviderPolicyResolver;
}

// ── Slot interfaces ──

export interface TenantResolver {
  resolveTenant(tenantId: string): Promise<{ tenantId: string } | null>;
}

export interface ScopeResolver {
  resolveScope(tenantId: string, scopeId: string): Promise<{ scopeId: string; tenantId: string } | null>;
}

export interface WorkflowCatalog {
  getWorkflow(workflowId: string): Promise<{ workflowId: string; definition: WorkflowDefinition } | null>;
}

export interface PrincipalAuthorizer {
  authorize(principal: Principal, action: string, resource: { tenantId?: string; scopeId?: string }): Promise<boolean>;
}

export interface IdentityResolver {
  resolveFromBearer(token: string): Promise<Principal | null>;
}

export interface ObservabilitySink {
  emitEvent(name: string, attrs: Record<string, unknown>): void;
}

export interface AuditSink {
  record(input: {
    principalId?: string;
    action: string;
    resource?: string;
    outcome?: 'allow' | 'deny' | 'success' | 'failure';
    payload?: Record<string, unknown>;
  }): void;
}

export interface SecretResolver {
  /** Resolves `credentialRef` → raw secret string. Returns null when unknown. */
  resolve(credentialRef: string, scope: { tenantId?: string; principalId?: string; runId?: string }): Promise<string | null>;
}

export interface ArtifactResolver {
  resolve(uri: string): Promise<{ contents: Buffer; mediaType: string } | null>;
}

export interface ContextProviderRegistry {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

export interface ExtensionManifestRegistry {
  list(): Promise<readonly { name: string; version: string }[]>;
}

export interface EnterprisePolicyResolver {
  evaluate(input: unknown): Promise<{ allowed: boolean; reason?: string }>;
}

export interface EnvironmentResolver {
  resolve(name: string): Promise<string | null>;
}

export interface ConnectorInvoker {
  invoke(connectorId: string, args: unknown): Promise<unknown>;
}

/**
 * Four-mode AI provider policy per `spec/v1/capabilities.md:268-275`.
 * `disabled` blocks the provider entirely; `optional` (default) allows
 * any model; `required` mandates a BYOK credentialRef; `restricted`
 * limits the caller to a whitelist of model ids (empty list MUST fail
 * closed per `capabilities.md:285`).
 */
export type AiProviderPolicyMode = 'disabled' | 'optional' | 'required' | 'restricted';

export interface AiProviderPolicy {
  provider: string;
  mode: AiProviderPolicyMode;
  /** Glob list for `restricted`; ignored for other modes. */
  allowedModels?: readonly string[];
}

export interface ProviderPolicyResolver {
  /**
   * Returns one row per *known* provider. Absent provider → caller
   * defaults to `optional`. Per `capabilities.md:284`, resolver
   * outages fail open to `optional` — `aiProvidersHost.ts` enforces
   * the fail-open rule when this throws.
   */
  resolveForRun(input: { tenantId: string; scopeId?: string }): Promise<readonly AiProviderPolicy[]>;
}

// ── Throw-on-use stub helper ──

function throwOnUse<T extends object>(capability: string): T {
  return new Proxy({} as T, {
    get() {
      return () => {
        throw new OpenwopError(
          'host_capability_missing',
          `Host capability ${capability} is not provided by this sample. Implement src/host/index.ts to enable.`,
          501,
          { capability },
        );
      };
    },
  });
}

// ── Factory ──

export function createHostAdapterSuite(deps: { storage: Storage }): HostAdapterSuite {
  const { storage } = deps;
  return {
    // ── tenant / scope (sqlite-backed; sample seeds nothing — every tenantId is implicitly valid)
    tenantResolver: {
      async resolveTenant(tenantId) {
        // Sample policy: every non-empty tenantId is valid. Real hosts
        // check membership in a tenants table.
        return tenantId ? { tenantId } : null;
      },
    },
    scopeResolver: {
      async resolveScope(tenantId, scopeId) {
        return scopeId ? { tenantId, scopeId } : null;
      },
    },

    // ── workflow catalog (sqlite-backed; falls back to a hard-coded sample workflow)
    workflowCatalog: {
      async getWorkflow(workflowId) {
        if (workflowId === 'sample.demo.uppercase') {
          return {
            workflowId,
            definition: {
              workflowId,
              nodes: [
                { nodeId: 'shout', typeId: 'local.sample.demo.uppercase' },
              ],
            },
          };
        }
        if (workflowId === 'sample.demo.approval-gate') {
          return {
            workflowId,
            definition: {
              workflowId,
              nodes: [
                { nodeId: 'gate', typeId: 'core.approvalGate', config: { prompt: 'Approve this sample run?' } },
                { nodeId: 'shout', typeId: 'local.sample.demo.uppercase' },
              ],
            },
          };
        }
        if (workflowId === 'sample.chat.turn') {
          return {
            workflowId,
            definition: {
              workflowId,
              nodes: [
                { nodeId: 'respond', typeId: 'vendor.openwop-sample.chat-responder' },
              ],
            },
          };
        }
        // Builder-registered workflows from the in-memory registry,
        // populated via `POST /v1/host/sample/workflows`. Sample-grade
        // (process-local). Real hosts read from storage's `workflows` table.
        const registered = getRegisteredWorkflow(workflowId);
        if (registered) {
          return { workflowId, definition: registered };
        }
        // Conformance fixtures loaded from in-tree `conformance/fixtures/`
        // at boot. Lets the sample BE answer black-box conformance runs
        // targeted at `/v1/runs` with a fixture workflowId, gated by
        // whichever fixture-specific typeIds this host has registered.
        const fixture = conformanceFixtures.get(workflowId);
        if (fixture) return { workflowId, definition: fixture };
        return null;
      },
    },

    // ── principal authorizer (sample: synthetic principal can act on any tenant it advertises)
    principalAuthorizer: {
      async authorize(principal, _action, resource) {
        if (!resource.tenantId) return true;
        return principal.tenants.includes(resource.tenantId) || principal.tenants.includes('*');
      },
    },

    // ── identity resolver: stub — any non-empty Bearer token resolves to a synthetic principal
    identityResolver: {
      async resolveFromBearer(token) {
        if (!token) return null;
        return {
          principalId: `sample-principal:${token.slice(0, 8)}`,
          tenants: ['*'],
          token,
        };
      },
    },

    // ── observability sink: log to structured logger
    observabilitySink: {
      emitEvent(name, attrs) {
        log.debug(name, attrs);
      },
    },

    // ── audit sink: persists to sqlite's audit_log table AND mirrors
    // to the structured logger. Real impls might also push to a SIEM
    // or to an append-only object store with hash-chain integrity per
    // openwop-audit-log-integrity profile.
    auditSink: {
      record(input) {
        const ts = new Date().toISOString();
        try {
          storage.appendAudit({
            timestamp: ts,
            principalId: input.principalId,
            action: input.action,
            resource: input.resource,
            outcome: input.outcome,
            payload: input.payload,
          });
        } catch (err) {
          log.warn('audit persistence failed', { error: err instanceof Error ? err.message : String(err) });
        }
        log.info('audit', { timestamp: ts, ...input });
      },
    },

    // ── secret resolver: in-memory map (sample only)
    secretResolver: createInMemorySecretResolver(),

    // ── minimal wraps
    artifactResolver: {
      async resolve(uri) {
        if (!uri.startsWith('local-fs:///')) return null;
        // Sample policy: refuses to read arbitrary fs paths. Real impl
        // would namespace under a per-tenant directory and verify
        // path traversal.
        return null;
      },
    },
    contextProviderRegistry: createInMemoryContextProviderRegistry(),
    extensionManifestRegistry: {
      async list() {
        return [];
      },
    },

    // ── throw-on-use stubs
    enterprisePolicyResolver: throwOnUse<EnterprisePolicyResolver>('host.enterprisePolicy'),
    environmentResolver: throwOnUse<EnvironmentResolver>('host.environment'),
    connectorInvoker: throwOnUse<ConnectorInvoker>('host.connectors'),

    // ── provider policy resolver (env-var driven; sample-grade global)
    //   OPENWOP_AI_POLICY_<PROVIDER>=disabled|optional|required|restricted[:model1,model2,...]
    // Real hosts persist per-tenant + per-scope policy in their tenants
    // table; the sample applies one policy set to every (tenantId,
    // scopeId) tuple. The full four-mode predicate from
    // `spec/v1/capabilities.md:246-289` is implemented — only the
    // *scoping* is sample-grade.
    providerPolicyResolver: createEnvVarProviderPolicyResolver(),
  };
}

// ── Provider policy resolver ──

const KNOWN_PROVIDERS: readonly string[] = ['anthropic', 'openai', 'google'];

function createEnvVarProviderPolicyResolver(): ProviderPolicyResolver {
  return {
    async resolveForRun(_input) {
      const out: AiProviderPolicy[] = [];
      for (const provider of KNOWN_PROVIDERS) {
        const raw = process.env[`OPENWOP_AI_POLICY_${provider.toUpperCase()}`];
        if (!raw) {
          out.push({ provider, mode: 'optional' });
          continue;
        }
        const parsed = parseEnvPolicy(provider, raw);
        if (parsed) out.push(parsed);
      }
      return out;
    },
  };
}

function parseEnvPolicy(provider: string, raw: string): AiProviderPolicy | null {
  const trimmed = raw.trim();
  if (!trimmed) return { provider, mode: 'optional' };
  const [modeRaw, modelsRaw] = trimmed.split(':');
  const mode = (modeRaw ?? '').toLowerCase() as AiProviderPolicyMode;
  if (mode !== 'disabled' && mode !== 'optional' && mode !== 'required' && mode !== 'restricted') {
    log.warn('invalid OPENWOP_AI_POLICY mode; treating as optional', { provider, raw });
    return { provider, mode: 'optional' };
  }
  if (mode === 'restricted') {
    const models = (modelsRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return { provider, mode, allowedModels: models };
  }
  return { provider, mode };
}

// ── In-memory secret resolver (sample-only impl) ──

function createInMemorySecretResolver(): SecretResolver {
  // Reads OPENWOP_SAMPLE_SECRETS env var as JSON: {"credRef": "value", ...}
  // and serves matching credentialRef requests. Real deployers swap for KMS.
  let secrets: Record<string, string> = {};
  try {
    if (process.env.OPENWOP_SAMPLE_SECRETS) {
      secrets = JSON.parse(process.env.OPENWOP_SAMPLE_SECRETS);
    }
  } catch (err) {
    log.warn('OPENWOP_SAMPLE_SECRETS parse failed; secrets disabled', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {
    async resolve(credentialRef) {
      return secrets[credentialRef] ?? null;
    },
  };
}

function createInMemoryContextProviderRegistry(): ContextProviderRegistry {
  const map = new Map<string, unknown>();
  return {
    get(name) {
      return map.get(name);
    },
    set(name, value) {
      map.set(name, value);
    },
  };
}
