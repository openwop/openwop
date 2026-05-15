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

import { createLogger } from '../observability/logger.js';
import type { Storage } from '../storage/storage.js';
import type { Principal } from '../types.js';
import { OpenwopError } from '../types.js';
import type { WorkflowDefinition } from '../executor/types.js';

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

export interface ProviderPolicyResolver {
  resolveForRun(input: { tenantId: string; scopeId?: string }): Promise<{ provider: string; allowedModels: readonly string[] }[]>;
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
        // Future: read from storage's `workflows` table.
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
    providerPolicyResolver: throwOnUse<ProviderPolicyResolver>('host.aiProviders'),
  };
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
