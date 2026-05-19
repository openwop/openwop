/**
 * Variables runtime — in-process per-run variable bag for the
 * workflow-engine sample.
 *
 * Per `spec/v1/workflow-definition.schema.json §variables` and the
 * `conformance-identity` fixture contract (per
 * `conformance/fixtures.md §conformance-identity`): a workflow
 * declares `variables[]` with optional `defaultValue`. At run-create
 * time, the variable bag is seeded from those defaults, with
 * `POST /v1/runs.inputs` overriding by variable name. Runtime nodes
 * MAY read/mutate variables (full mid-run mutation surface is future
 * scope — see HVMAP-2 in `aiEnvelope.contractRefusal` family).
 *
 * Snapshot surface: `GET /v1/runs/{runId}` returns
 * `RunSnapshot.variables: { [name]: value }` so the conformance
 * suite can assert "what went in comes back out."
 *
 * In-process Map keyed by runId. Survives the process lifetime; does
 * NOT survive restart (the persisted store work for cross-process
 * variable replay is its own RFC-grade build). For the workflow-
 * engine sample's current scope (single-process, conformance target),
 * in-memory is sufficient.
 */

interface VariableDecl {
  readonly name: string;
  readonly defaultValue?: unknown;
}

const runVariables = new Map<string, Map<string, unknown>>();

/**
 * Build the initial variable bag for a new run. `variableDecls` comes
 * from `workflow.variables[]`; `inputs` is `POST /v1/runs.inputs`
 * (typically an object keyed by variable name, but the function
 * tolerates non-object inputs by treating them as "no overrides").
 *
 * Precedence: `inputs[name]` (if present) > `defaultValue` (if
 * declared) > omitted. Variables without an input override AND
 * without a default are not seeded — the read surface returns
 * `undefined` for them, which `JSON.stringify` collapses to "key
 * absent." Callers that need a stricter "MUST seed" contract
 * should validate via the workflow's inputSchema before calling.
 */
export function seedRunVariables(
  runId: string,
  variableDecls: ReadonlyArray<VariableDecl> | undefined,
  inputs: unknown,
): void {
  const bag = new Map<string, unknown>();
  const inputsObj =
    inputs && typeof inputs === 'object' && !Array.isArray(inputs)
      ? (inputs as Record<string, unknown>)
      : undefined;
  for (const decl of variableDecls ?? []) {
    if (!decl || typeof decl.name !== 'string' || decl.name.length === 0) continue;
    if (inputsObj && Object.prototype.hasOwnProperty.call(inputsObj, decl.name)) {
      bag.set(decl.name, inputsObj[decl.name]);
    } else if ('defaultValue' in decl) {
      bag.set(decl.name, decl.defaultValue);
    }
    // else: absent — caller's inputSchema validation decides whether
    // that's an error. The runtime doesn't gate on `required`.
  }
  runVariables.set(runId, bag);
}

/**
 * Snapshot the variable bag for `runId` as a plain object. Returns
 * `null` if no bag exists (the run was never seeded — e.g., the
 * sample's older code path on a fixture without `variables[]`).
 * Snapshot-shape callers should use `undefined` collapse on the
 * `RunSnapshot.variables` field when this returns null.
 */
export function snapshotRunVariables(runId: string): Record<string, unknown> | null {
  const bag = runVariables.get(runId);
  if (!bag) return null;
  return Object.fromEntries(bag.entries());
}

/**
 * Set a single variable. Future scope (HVMAP-2 mid-run mutation seam)
 * will expose this via a `POST /v1/host/sample/test/runs/:runId/
 * variables` endpoint; today only the suite-init seeding path uses
 * it (via `seedRunVariables`).
 */
export function setRunVariable(runId: string, name: string, value: unknown): void {
  let bag = runVariables.get(runId);
  if (!bag) {
    bag = new Map<string, unknown>();
    runVariables.set(runId, bag);
  }
  bag.set(name, value);
}

/** Drop the bag for `runId` — used by tenant-hard-delete cascades
 *  and the test-seam reset. Safe to call on absent runIds. */
export function clearRunVariables(runId: string): void {
  runVariables.delete(runId);
}

/** Test-only: drop EVERY bag. Suite teardown uses this to keep state
 *  from leaking across scenarios. */
export function __resetAllRunVariablesForTests(): void {
  runVariables.clear();
}
