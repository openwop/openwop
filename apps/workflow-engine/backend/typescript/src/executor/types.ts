/**
 * Executor-internal types.
 *
 * `NodeModule` is the contract every node-pack entry must satisfy. The
 * shape is intentionally narrow — a single async `execute(ctx)` function
 * returning `success`, `failure`, or `suspended`. Real openwop hosts
 * extend with retry policies, side-effect tracking, etc.; the sample
 * keeps it minimal.
 */

export interface NodeContext {
  runId: string;
  nodeId: string;
  tenantId: string;
  scopeId?: string;
  inputs: unknown;
  config?: Record<string, unknown>;
  /** Run-level configurable overlay from RunOptions.configurable. */
  configurable: Record<string, unknown>;
  /** Per-attempt counter; first attempt = 1. */
  attempt: number;
  /** Resolved BYOK secret values keyed by `credentialRef`. Empty if none required. */
  secrets: Record<string, string>;
  /** Emit a side-effect-free event into the run log. */
  emit(type: string, payload: unknown): Promise<void>;
}

export type NodeOutcome =
  | { status: 'success'; outputs: unknown }
  | { status: 'failure'; error: { code: string; message: string }; retryable?: boolean }
  | {
      status: 'suspended';
      interrupt: {
        kind: 'approval' | 'clarification' | 'refinement' | 'cancellation';
        data: unknown;
        resumeSchema?: Record<string, unknown>;
      };
    };

export interface NodeModule {
  typeId: string;
  version: string;
  /** Capability requirements — checked against runtimeCapabilities at register time. */
  requires?: readonly string[];
  /** Secret requirements — node manifest declares these; resolver fetches at execute time. */
  requiresSecrets?: readonly { id: string; provider: string; scope: string }[];
  execute(ctx: NodeContext): Promise<NodeOutcome>;
}

/** Workflow definition — stored either in the workflows table or in-memory. */
export interface WorkflowDefinition {
  workflowId: string;
  /** Linear node sequence. Sample doesn't model branching DAGs (use core.subWorkflow + interrupt for control flow). */
  nodes: ReadonlyArray<{
    nodeId: string;
    typeId: string;
    config?: Record<string, unknown>;
  }>;
  /** Input schema (informational only in this sample; real hosts validate via Ajv). */
  inputSchema?: Record<string, unknown>;
  configurableSchema?: Record<string, unknown>;
}
