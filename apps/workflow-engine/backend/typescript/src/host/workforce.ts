/**
 * Workforce — a governed bundle of {workflows + agents + approvals + evals +
 * telemetry + policy + autonomy} for one business function (EP0 §1).
 *
 * VENDOR-NEUTRAL: no external operating-model framework brand appears here or
 * in any field name. An adopter maps their own vocabulary onto these neutral
 * shapes. Host-extension entity — NOT a wire-protocol type; it lives under the
 * non-normative `/v1/host/sample/workforces` namespace.
 */

export type AutonomyLevel = 'review' | 'guided' | 'auto';
export type WorkforceStatus = 'shadow' | 'piloting' | 'production';

/** The seven-field agent spec (EP0 §4). */
export interface AgentSpec {
  agentRef: string;
  role: 'supervisor' | 'worker' | 'governance';
  autonomyLevel: AutonomyLevel;
  dataBoundary: string;
  decisionBoundary: string;
  memoryBoundary: string;
  performanceTarget: string;
  recoveryBehavior: string;
}

export interface WorkforcePurpose {
  statement: string;
  policyTags: string[];
  refusalBoundaries: string[];
}

export interface Workforce {
  workforceId: string;
  name: string;
  businessFunction: string;
  status: WorkforceStatus;
  purpose: WorkforcePurpose;
  autonomyLevel: AutonomyLevel;
  /** Reserved; the Data Manifest is authored in a later slice (MG-3). */
  dataManifestId: string;
  successMetrics: string[];
  workflowCatalog: string[];
  agents: AgentSpec[];
  /** Per-node auto-safe vs human-review (MG-4). */
  decisionBoundaries: { auto: string[]; review: string[] };
  /** Demo seeding: how many synthetic history runs to generate for this
   *  workforce on the explicit "Load demo data" action. Omit / 0 → ship as a
   *  stand-up TEMPLATE with no history (the gallery still lists it). Keeps the
   *  heavy generator scoped to the instrumented examples, not all 5 templates. */
  historyRunCount?: number;
}
