// Package openwopclient implements a Go client for OpenWOP-compliant servers.
//
// Types mirror the OpenAPI 3.1 spec (../../api/openapi.yaml) and JSON
// Schemas (../../schemas/). Hand-authored — see README.md §rationale.
package openwopclient

import "encoding/json"

// RunStatus values per `RunSnapshot.status`.
type RunStatus string

const (
	StatusPending         RunStatus = "pending"
	StatusRunning         RunStatus = "running"
	StatusPaused          RunStatus = "paused"
	StatusWaitingApproval RunStatus = "waiting-approval"
	StatusWaitingInput    RunStatus = "waiting-input"
	StatusCompleted       RunStatus = "completed"
	StatusFailed          RunStatus = "failed"
	StatusCancelled       RunStatus = "cancelled"
)

// StreamMode values per `?streamMode=` on the events SSE endpoint.
type StreamMode string

const (
	StreamModeValues   StreamMode = "values"
	StreamModeUpdates  StreamMode = "updates"
	StreamModeMessages StreamMode = "messages"
	StreamModeDebug    StreamMode = "debug"
)

// CapabilitiesLimits holds the engine-enforced caps.
type CapabilitiesLimits struct {
	ClarificationRounds int  `json:"clarificationRounds"`
	SchemaRounds        int  `json:"schemaRounds"`
	EnvelopesPerTurn    int  `json:"envelopesPerTurn"`
	MaxNodeExecutions   *int `json:"maxNodeExecutions,omitempty"`
	MaxRunDurationMs    *int `json:"maxRunDurationMs,omitempty"`  // RFC 0058
	MaxLoopIterations   *int `json:"maxLoopIterations,omitempty"` // RFC 0058
}

// CapBreachedKind is the `kind` discriminator on a cap.breached event payload
// (run-event-payloads.schema.json#capBreached): the four engine kinds, the
// RFC 0008 §K wasm-* runtime caps, and the RFC 0058 run-scoped bounds.
type CapBreachedKind string

const (
	CapBreachedClarification  CapBreachedKind = "clarification"
	CapBreachedSchema         CapBreachedKind = "schema"
	CapBreachedEnvelopes      CapBreachedKind = "envelopes"
	CapBreachedNodeExecutions CapBreachedKind = "node-executions"
	CapBreachedWasmMemory     CapBreachedKind = "wasm-memory"
	CapBreachedWasmFuel       CapBreachedKind = "wasm-fuel"
	CapBreachedWasmExecTime   CapBreachedKind = "wasm-execution-time"
	CapBreachedRunDuration    CapBreachedKind = "run-duration"
	CapBreachedLoopIterations CapBreachedKind = "loop-iterations"
)

// Capabilities mirrors `schemas/capabilities.schema.json`.
type Capabilities struct {
	ProtocolVersion       string             `json:"protocolVersion"`
	SupportedEnvelopes    []string           `json:"supportedEnvelopes"`
	SchemaVersions        map[string]int     `json:"schemaVersions"`
	Limits                CapabilitiesLimits `json:"limits"`
	Extensions            map[string]any     `json:"extensions,omitempty"`
	Implementation        map[string]any     `json:"implementation,omitempty"`
	EngineVersion         *int               `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int               `json:"eventLogSchemaVersion,omitempty"`
	SupportedTransports   []string           `json:"supportedTransports,omitempty"`
	Configurable          map[string]any     `json:"configurable,omitempty"`
	Observability         map[string]any     `json:"observability,omitempty"`
	MinClientVersion      *string            `json:"minClientVersion,omitempty"`
}

// RunSnapshotError mirrors `RunSnapshot.error`.
type RunSnapshotError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// RunSnapshot mirrors `schemas/run-snapshot.schema.json`.
type RunSnapshot struct {
	RunID                 string            `json:"runId"`
	WorkflowID            string            `json:"workflowId"`
	Status                RunStatus         `json:"status"`
	CurrentNodeID         string            `json:"currentNodeId,omitempty"`
	StartedAt             string            `json:"startedAt,omitempty"`
	CompletedAt           string            `json:"completedAt,omitempty"`
	NodeStates            map[string]any    `json:"nodeStates,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Channels              map[string]any    `json:"channels,omitempty"`
	Error                 *RunSnapshotError `json:"error,omitempty"`
	EngineVersion         string            `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int              `json:"eventLogSchemaVersion,omitempty"`
	Tags                  []string          `json:"tags,omitempty"`
	Metadata              map[string]any    `json:"metadata,omitempty"`
	Configurable          map[string]any    `json:"configurable,omitempty"`
}

// RunConfigurable carries per-run overrides. Reserved keys are typed;
// unknown keys live in `Extras`. See run-options.md.
type RunConfigurable struct {
	RecursionLimit    *int              `json:"recursionLimit,omitempty"`
	RunTimeoutMs      *int              `json:"runTimeoutMs,omitempty"`      // RFC 0058
	MaxLoopIterations *int              `json:"maxLoopIterations,omitempty"` // RFC 0058
	Model             string            `json:"model,omitempty"`
	Temperature       *float64          `json:"temperature,omitempty"`
	MaxTokens         *int              `json:"maxTokens,omitempty"`
	PromptOverrides   map[string]string `json:"promptOverrides,omitempty"`
	Extras            map[string]any    `json:"-"`
}

// MarshalJSON folds Extras into the same JSON object so the wire shape
// matches the spec (a flat map of reserved + unknown keys).
func (c RunConfigurable) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, 5+len(c.Extras))
	if c.RecursionLimit != nil {
		out["recursionLimit"] = *c.RecursionLimit
	}
	if c.RunTimeoutMs != nil {
		out["runTimeoutMs"] = *c.RunTimeoutMs
	}
	if c.MaxLoopIterations != nil {
		out["maxLoopIterations"] = *c.MaxLoopIterations
	}
	if c.Model != "" {
		out["model"] = c.Model
	}
	if c.Temperature != nil {
		out["temperature"] = *c.Temperature
	}
	if c.MaxTokens != nil {
		out["maxTokens"] = *c.MaxTokens
	}
	if c.PromptOverrides != nil {
		out["promptOverrides"] = c.PromptOverrides
	}
	for k, v := range c.Extras {
		out[k] = v
	}
	return json.Marshal(out)
}

// CreateRunRequest mirrors POST /v1/runs body.
type CreateRunRequest struct {
	WorkflowID   string           `json:"workflowId"`
	Inputs       map[string]any   `json:"inputs,omitempty"`
	TenantID     string           `json:"tenantId,omitempty"`
	ScopeID      string           `json:"scopeId,omitempty"`
	CallbackURL  string           `json:"callbackUrl,omitempty"`
	Configurable *RunConfigurable `json:"configurable,omitempty"`
	Tags         []string         `json:"tags,omitempty"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
}

// CreateRunResponse mirrors the 201 payload.
type CreateRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"`
	EventsURL string    `json:"eventsUrl"`
	StatusURL string    `json:"statusUrl,omitempty"`
}

// CancelRunRequest is the optional body for POST /v1/runs/{id}/cancel.
type CancelRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// CancelRunResponse mirrors the cancel response.
type CancelRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"` // "cancelled" | "cancelling"
}

// DebugBundle is the portable JSON diagnostic export per
// spec/v1/debug-bundle.md + schemas/debug-bundle.schema.json.
// Hosts MAY omit non-required fields. Consumers MUST treat
// masked/omitted/hashed values as the spec-canonical content per
// RedactionMode — they are NOT placeholders for missing data.
type DebugBundle struct {
	BundleVersion    string           `json:"bundleVersion"`
	GeneratedAt      string           `json:"generatedAt"`
	Host             map[string]any   `json:"host"`
	Run              map[string]any   `json:"run"`
	Events           []map[string]any `json:"events"`
	RedactionApplied bool             `json:"redactionApplied"`
	// RedactionMode is one of "mask" / "omit" / "hash" / "passthrough".
	RedactionMode   string `json:"redactionMode"`
	Truncated       bool   `json:"truncated,omitempty"`
	TruncatedReason string `json:"truncatedReason,omitempty"`
}

// DebugBundleOptions carries query parameters for GetDebugBundle.
// MaxEvents is a host-extension parameter (the SQLite reference
// convention); zero means "use host default". Spec-canonical hosts
// MAY ignore it. Non-zero values lower the host's size cap for
// testing the truncation path without driving the bundle past 8 MB.
type DebugBundleOptions struct {
	MaxEvents int
}

// PauseRunRequest is the optional body for POST /v1/runs/{id}:pause.
type PauseRunRequest struct {
	Reason      string `json:"reason,omitempty"`
	DrainPolicy string `json:"drainPolicy,omitempty"` // "immediate" | "drain-current-node"
}

// PauseRunResponse mirrors the 202 pause payload.
type PauseRunResponse struct {
	RunID    string    `json:"runId"`
	Status   RunStatus `json:"status"` // "paused"
	PausedAt string    `json:"pausedAt,omitempty"`
}

// ResumeRunRequest is the optional body for POST /v1/runs/{id}:resume.
type ResumeRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// ResumeRunResponse mirrors the 202 resume payload.
type ResumeRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"` // "running"
	ResumedAt string    `json:"resumedAt,omitempty"`
}

// BulkCancelRunsRequest mirrors POST /v1/runs:bulk-cancel body
// per rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
type BulkCancelRunsRequest struct {
	RunIDs []string `json:"runIds"`
	Reason string   `json:"reason,omitempty"`
}

// BulkCancelRunResult is the per-id outcome inside BulkCancelRunsResponse.Results.
type BulkCancelRunResult struct {
	RunID  string         `json:"runId"`
	OK     bool           `json:"ok"`
	Status string         `json:"status,omitempty"`
	Error  *ErrorEnvelope `json:"error,omitempty"`
}

// BulkCancelRunsResponse mirrors the 200 bulk-cancel payload.
type BulkCancelRunsResponse struct {
	Results []BulkCancelRunResult `json:"results"`
}

// RegisterWebhookRequest is the body for POST /v1/webhooks per
// spec/v1/webhooks.md.
type RegisterWebhookRequest struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	// Secret is optional; if omitted the host generates one and
	// returns it in the response.
	Secret string `json:"secret,omitempty"`
	// Tags filters delivery to runs carrying these tags.
	Tags []string `json:"tags,omitempty"`
}

// RegisterWebhookResponse mirrors the 201 register-webhook payload.
// Secret is returned ONCE on registration — store it server-side for
// HMAC verification; the host cannot recover it.
type RegisterWebhookResponse struct {
	SubscriptionID string   `json:"subscriptionId"`
	URL            string   `json:"url"`
	Secret         string   `json:"secret"`
	EventTypes     []string `json:"eventTypes"`
	CreatedAt      string   `json:"createdAt"`
}

// AuditVerifyCheckpoint is one entry in AuditVerifyResult.Checkpoints
// per auth-profiles.md §"openwop-audit-log-integrity" §4.
type AuditVerifyCheckpoint struct {
	Checkpoint string `json:"checkpoint"`
	AtSequence int64  `json:"atSequence"`
	MerkleRoot string `json:"merkleRoot"`
	Signature  string `json:"signature"`
}

// AuditVerifyAnomaly is one entry in AuditVerifyResult.Anomalies.
type AuditVerifyAnomaly struct {
	AtSeq            int64  `json:"atSeq"`
	ExpectedPrevHash string `json:"expectedPrevHash"`
	ActualPrevHash   string `json:"actualPrevHash"`
}

// AuditVerifyResult is the response shape from GET /v1/audit/verify.
type AuditVerifyResult struct {
	FromSeq          int64                   `json:"fromSeq"`
	ToSeq            int64                   `json:"toSeq"`
	ChainValid       bool                    `json:"chainValid"`
	CheckpointsValid *bool                   `json:"checkpointsValid,omitempty"`
	Checkpoints      []AuditVerifyCheckpoint `json:"checkpoints"`
	Anomalies        []AuditVerifyAnomaly    `json:"anomalies"`
}

// ForkRunRequest mirrors POST /v1/runs/{id}:fork body.
type ForkRunRequest struct {
	FromSeq           int            `json:"fromSeq"`
	Mode              string         `json:"mode"` // "replay" | "branch"
	RunOptionsOverlay map[string]any `json:"runOptionsOverlay,omitempty"`
}

// ForkRunResponse mirrors the 201 fork payload.
type ForkRunResponse struct {
	RunID       string    `json:"runId"`
	SourceRunID string    `json:"sourceRunId"`
	Mode        string    `json:"mode"`
	Status      RunStatus `json:"status"`
	EventsURL   string    `json:"eventsUrl"`
	FromSeq     *int      `json:"fromSeq,omitempty"`
}

// Annotation mirrors annotation.schema.json (RFC 0056) — a non-blocking
// quality signal recorded against a run, event, or node. Target and actor
// are flat string maps; signal carries mixed-type fields (kind, rating,
// label, correction) so it is map[string]any.
type Annotation struct {
	AnnotationID string            `json:"annotationId"`
	Target       map[string]string `json:"target"`
	Signal       map[string]any    `json:"signal"`
	Actor        map[string]string `json:"actor"`
	CreatedAt    string            `json:"createdAt"`
	Note         *string           `json:"note,omitempty"`
}

// CreateAnnotationRequest is the POST /v1/runs/{runID}/annotations body per
// annotation-create.schema.json (RFC 0056). The host assigns annotationId,
// createdAt, and actor; target.runId is path-bound and omitted here.
type CreateAnnotationRequest struct {
	Signal map[string]any    `json:"signal"`
	Target map[string]string `json:"target,omitempty"`
	Note   *string           `json:"note,omitempty"`
}

// ListAnnotationsResponse mirrors the 200 listAnnotations payload.
type ListAnnotationsResponse struct {
	Annotations []Annotation `json:"annotations"`
}

// WorkspaceFile mirrors workspace-file.schema.json (RFC 0059) — a versioned,
// tenant·workspace-scoped ground-truth file. The list endpoint returns this
// shape minus Content (metadata only).
type WorkspaceFile struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentType string `json:"contentType,omitempty"`
	Version     int    `json:"version"`
	ETag        string `json:"etag,omitempty"`
	UpdatedAt   string `json:"updatedAt"`
}

// PutWorkspaceFileRequest is the PUT /v1/host/workspace/files/{path} body per
// workspace-file-create.schema.json (RFC 0059). Path is URL-bound; the host
// assigns version/etag/updatedAt. Optimistic concurrency is expressed via the
// If-Match header (PutWorkspaceFileOptions.IfMatch), not a body field.
type PutWorkspaceFileRequest struct {
	Content     string `json:"content"`
	ContentType string `json:"contentType,omitempty"`
}

// ListWorkspaceFilesResponse mirrors the 200 listWorkspaceFiles payload.
type ListWorkspaceFilesResponse struct {
	Files []WorkspaceFile `json:"files"`
}

// RunAncestryParent is the populated branch of RunAncestryResponse.Parent —
// names the run's immediate dispatcher per RFC 0040 §C. WellKnownURL is
// set only when the parent is on a different host (callers walk the
// chain by following it one hop at a time).
type RunAncestryParent struct {
	RunID        string `json:"runId"`
	HostID       string `json:"hostId"`
	Cause        string `json:"cause"` // "mcp-tool-call" | "a2a-message" | "core.subWorkflow" | "core.dispatch"
	WellKnownURL string `json:"wellKnownUrl,omitempty"`
}

// RunAncestryResponse mirrors GET /v1/runs/{id}/ancestry per RFC 0040 §C
// (schemas/run-ancestry-response.schema.json). Parent is nil for
// top-level runs (not dispatched from any other run). Capability-gated
// on capabilities.multiAgent.executionModel.crossHostCausation
// .ancestryEndpointSupported; hosts not advertising return 404 and the
// SDK surfaces that as (nil, nil) via OpenwopClient.RunAncestry.
type RunAncestryResponse struct {
	RunID  string             `json:"runId"`
	HostID string             `json:"hostId"`
	Parent *RunAncestryParent `json:"parent"`
}

// ResolveInterruptRequest mirrors the body for either resolve endpoint.
type ResolveInterruptRequest struct {
	ResumeValue any `json:"resumeValue"`
}

// ResolveInterruptResponse mirrors the run-scoped resolve response.
type ResolveInterruptResponse struct {
	RunID  string    `json:"runId"`
	NodeID string    `json:"nodeId"`
	Status RunStatus `json:"status"`
}

// InterruptByTokenInspection mirrors GET /v1/interrupts/{token} —
// see suspend-request.schema.json (InterruptPayload).
type InterruptByTokenInspection struct {
	Kind         string         `json:"kind"`
	Key          string         `json:"key"`
	Data         any            `json:"data"`
	ResumeSchema map[string]any `json:"resumeSchema,omitempty"`
	TimeoutMs    *int           `json:"timeoutMs,omitempty"`
}

// RunEventDoc mirrors `schemas/run-event.schema.json` — top-level shape.
// Per-event payload schemas live in run-event-payloads.schema.json;
// callers needing strict payload validation should layer that themselves.
type RunEventDoc struct {
	EventID       string `json:"eventId"`
	RunID         string `json:"runId"`
	Type          string `json:"type"`
	Payload       any    `json:"payload"`
	Timestamp     string `json:"timestamp"`
	Sequence      int    `json:"sequence"`
	NodeID        string `json:"nodeId,omitempty"`
	SchemaVersion *int   `json:"schemaVersion,omitempty"`
	EngineVersion string `json:"engineVersion,omitempty"`
	CausationID   string `json:"causationId,omitempty"`
}

// PollEventsResponse mirrors the events/poll response.
type PollEventsResponse struct {
	Events     []RunEventDoc `json:"events"`
	IsComplete bool          `json:"isComplete"`
}

// ErrorEnvelope mirrors `schemas/error-envelope.schema.json`.
type ErrorEnvelope struct {
	Error   string         `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// HTTP error-envelope codes from auth.md, rest-endpoints.md, and adjacent
// v1 specs. ErrorEnvelope.Error remains string-typed for forward
// compatibility; use IsHTTPErrorCode for common branching.
const (
	HTTPErrorUnauthenticated             = "unauthenticated"
	HTTPErrorForbidden                   = "forbidden"
	HTTPErrorKeyExpired                  = "key_expired"
	HTTPErrorKeyRevoked                  = "key_revoked"
	HTTPErrorValidationError             = "validation_error"
	HTTPErrorNotFound                    = "not_found"
	HTTPErrorRateLimited                 = "rate_limited"
	HTTPErrorRunAlreadyActive            = "run_already_active"
	HTTPErrorIdempotencyInFlight         = "idempotency_in_flight"
	HTTPErrorIdempotencyKeyMismatch      = "idempotency_key_mismatch"
	HTTPErrorUnsupportedStreamMode       = "unsupported_stream_mode"
	HTTPErrorForceEngineVersionForbidden = "force_engine_version_forbidden"
	HTTPErrorMockProviderForbidden       = "mock_provider_forbidden"
	HTTPErrorCapabilityNotProvided       = "capability_not_provided"
	HTTPErrorCapabilityRequired          = "capability_required"
	HTTPErrorCredentialRequired          = "credential_required"
	HTTPErrorCredentialForbidden         = "credential_forbidden"
	HTTPErrorCredentialUnavailable       = "credential_unavailable"
	// Node-pack lifecycle (registry + lockfile) per node-packs.md §"Dependency resolution + lockfile".
	HTTPErrorPackIntegrityMismatch     = "pack_integrity_mismatch"
	HTTPErrorPackSignatureInvalid      = "pack_signature_invalid"
	HTTPErrorPackPeerDependencyMissing = "pack_peer_dependency_missing"
	HTTPErrorPackLockfileIncomplete    = "pack_lockfile_incomplete"
	HTTPErrorPackVersionNotFound       = "pack_version_not_found"
	HTTPErrorInterruptNotFound         = "interrupt_not_found"
	HTTPErrorApprovalTokenInvalid      = "approval_token_invalid"
	HTTPErrorApprovalTokenExpired      = "approval_token_expired"
	HTTPErrorApprovalTokenConsumed     = "approval_token_consumed"
	// Phase H.1″ — AI provider policy enforcement per capabilities.md §"aiProviders.policies".
	HTTPErrorProviderPolicyDenied = "provider_policy_denied"
	// Phase H.2 — MCP client.
	HTTPErrorMcpServerNotConfigured = "mcp_server_not_configured"
	HTTPErrorMcpTimeout             = "mcp_timeout"
	HTTPErrorMcpNetworkError        = "mcp_network_error"
	HTTPErrorMcpServerError         = "mcp_server_error"
	HTTPErrorMcpProtocolError       = "mcp_protocol_error"
	HTTPErrorMcpToolError           = "mcp_tool_error"
	// Phase H.3 — HTTP client.
	HTTPErrorHttpUrlRejected      = "http_url_rejected"
	HTTPErrorHttpTimeout          = "http_timeout"
	HTTPErrorHttpNetworkError     = "http_network_error"
	HTTPErrorHttpUnexpectedStatus = "http_unexpected_status"
	// Phase H webhook codes (spec-de-facto per webhook-negative.test.ts).
	HTTPErrorWebhookUrlRejected   = "webhook_url_rejected"
	HTTPErrorSubscriptionNotFound = "subscription_not_found"
	HTTPErrorInternalError        = "internal_error"
)

// HTTPErrorCodes lists canonical ErrorEnvelope.Error codes for common
// branching. Treat it as read-only.
var HTTPErrorCodes = []string{
	HTTPErrorUnauthenticated,
	HTTPErrorForbidden,
	HTTPErrorKeyExpired,
	HTTPErrorKeyRevoked,
	HTTPErrorValidationError,
	HTTPErrorNotFound,
	HTTPErrorRateLimited,
	HTTPErrorRunAlreadyActive,
	HTTPErrorIdempotencyInFlight,
	HTTPErrorIdempotencyKeyMismatch,
	HTTPErrorUnsupportedStreamMode,
	HTTPErrorForceEngineVersionForbidden,
	HTTPErrorMockProviderForbidden,
	HTTPErrorCapabilityNotProvided,
	HTTPErrorCapabilityRequired,
	HTTPErrorCredentialRequired,
	HTTPErrorCredentialForbidden,
	HTTPErrorCredentialUnavailable,
	HTTPErrorPackIntegrityMismatch,
	HTTPErrorPackSignatureInvalid,
	HTTPErrorPackPeerDependencyMissing,
	HTTPErrorPackLockfileIncomplete,
	HTTPErrorPackVersionNotFound,
	HTTPErrorInterruptNotFound,
	HTTPErrorApprovalTokenInvalid,
	HTTPErrorApprovalTokenExpired,
	HTTPErrorApprovalTokenConsumed,
	HTTPErrorProviderPolicyDenied,
	HTTPErrorMcpServerNotConfigured,
	HTTPErrorMcpTimeout,
	HTTPErrorMcpNetworkError,
	HTTPErrorMcpServerError,
	HTTPErrorMcpProtocolError,
	HTTPErrorMcpToolError,
	HTTPErrorHttpUrlRejected,
	HTTPErrorHttpTimeout,
	HTTPErrorHttpNetworkError,
	HTTPErrorHttpUnexpectedStatus,
	HTTPErrorWebhookUrlRejected,
	HTTPErrorSubscriptionNotFound,
	HTTPErrorInternalError,
}

// IsHTTPErrorCode returns true when value is a known canonical HTTP error
// envelope code. It returns false for host extensions and future additions.
func IsHTTPErrorCode(value string) bool {
	for _, code := range HTTPErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}

// ─── Run statuses (forward-compatible) ──────────────────────────────────

// ActiveRunStatuses lists run statuses considered active — the run MAY
// still transition. Hosts MAY emit additional terminal values per the
// schema's forward-compat clause; readers MUST treat unknown statuses as
// terminal-unknown, NOT as still-active. Use IsTerminalRunStatus for
// forward-compatible checks. Mirrors the TypeScript SDK's
// ACTIVE_RUN_STATUSES constant + isTerminalRunStatus predicate.
var ActiveRunStatuses = []string{
	"pending",
	"running",
	"paused",
	"waiting-approval",
	"waiting-input",
}

// TerminalRunStatuses lists the spec-known terminal statuses. Hosts MAY
// emit additional terminal values (e.g., "timed-out", "interrupted"); use
// IsTerminalRunStatus for forward-compat checks instead of literal-set
// membership.
var TerminalRunStatuses = []string{
	"completed",
	"failed",
	"cancelled",
}

// IsTerminalRunStatus returns true when status indicates the run will not
// transition further. Implemented as a negative check against
// ActiveRunStatuses: any value NOT in the spec's known-active set is
// treated as terminal. This implements the schema's forward-compat clause
// — the alternative (positive check against TerminalRunStatuses) would
// loop polling forever on any unknown value.
func IsTerminalRunStatus(status string) bool {
	for _, active := range ActiveRunStatuses {
		if status == active {
			return false
		}
	}
	return true
}

// ─── Run-document error codes ───────────────────────────────────────────

// RunErrorCodes lists canonical RunSnapshot.Error.Code identifiers used
// when a run reaches `failed`. Distinct from HTTPErrorCodes, which describe
// HTTP-level request failures (a request can fail with `unauthenticated`
// before a run exists; a run can fail later with `node_execution_failed`).
// Mirrors the TypeScript SDK's RUN_ERROR_CODES constant.
var RunErrorCodes = []string{
	// Authorization / access
	"auth_required",
	"forbidden",
	"workspace_not_found",

	// Run-state conflicts
	"run_already_active",
	"run_not_found",
	"run_terminal",
	"engine_version_mismatch",

	// Validation
	"invalid_workflow_definition",
	"invalid_trigger_input",
	"node_type_not_found",
	"config_validation_failed",

	// Quota / budget
	"token_budget_exceeded",
	"concurrent_run_limit_reached",
	"rate_limited",

	// Execution
	"node_timeout",
	"global_timeout",
	"node_execution_failed",
	"external_call_failed",
	"recursion_limit_exceeded",
	"run_timeout",
	"loop_limit_exceeded",
	"capability_not_provided",

	// Approval
	"approval_timeout",
	"approval_token_invalid",
	"approval_token_expired",
	"approval_token_consumed",

	// Persistence
	"persistence_failed",
	"doc_budget_exceeded",
}

// IsRunErrorCode returns true when value is a known canonical
// RunSnapshot.Error.Code. Returns false for unknown / malformed values
// rather than panicking — SDK consumers usually want to display a fallback
// for unknown codes.
func IsRunErrorCode(value string) bool {
	for _, code := range RunErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}

// AgentInventoryEntry is one installed manifest agent as projected by
// GET /v1/agents / GET /v1/agents/{agentId} (RFC 0072 §A). Read-only — never
// carries the system-prompt body, resolved handoff schemas, or credentials (SR-1).
type AgentInventoryEntry struct {
	AgentID             string   `json:"agentId"`
	Persona             string   `json:"persona"`
	Label               string   `json:"label"`
	Description         string   `json:"description,omitempty"`
	ModelClass          string   `json:"modelClass"`
	PackName            string   `json:"packName"`
	PackVersion         string   `json:"packVersion"`
	ToolAllowlist       []string `json:"toolAllowlist"`
	HasHandoffSchemas   bool     `json:"hasHandoffSchemas"`
	ConfidenceThreshold *float64 `json:"confidenceThreshold,omitempty"`
	// Degraded lists optional capability tiers this host does not satisfy (RFC 0072 §C).
	Degraded []string `json:"degraded,omitempty"`
}

// AgentInventoryResponse is the GET /v1/agents body (RFC 0072 §A).
type AgentInventoryResponse struct {
	Agents []AgentInventoryEntry `json:"agents"`
	Total  int                   `json:"total"`
}

// ── RFC 0078 — Portable tool catalog (spec/v1/tool-catalog.md) ─────────────

// ToolDescriptor is a portable tool descriptor as projected onto the host's
// GET /v1/tools catalog (RFC 0078 §B). Source-agnostic (node-pack / workflow /
// mcp / connector / host-extension); SafetyTier, Egress, and Approval let a
// caller reason about a tool's blast radius before invoking it.
type ToolDescriptor struct {
	ToolID       string         `json:"toolId"`
	Source       string         `json:"source"`
	Title        string         `json:"title,omitempty"`
	Description  string         `json:"description,omitempty"`
	InputSchema  map[string]any `json:"inputSchema,omitempty"`
	OutputSchema map[string]any `json:"outputSchema,omitempty"`
	Auth         map[string]any `json:"auth,omitempty"`
	Egress       string         `json:"egress,omitempty"`
	Approval     string         `json:"approval,omitempty"`
	ReplayPolicy string         `json:"replayPolicy,omitempty"`
	SafetyTier   string         `json:"safetyTier"`
	CostHint     string         `json:"costHint,omitempty"`
	LatencyHint  string         `json:"latencyHint,omitempty"`
}

// ── RFC 0082 — Agent deployment lifecycle ──────────────────────────────────

// AgentDeployment is a per-(agentId, version) deployment record, returned by
// ListAgentDeployments / TransitionAgentDeployment (RFC 0082 §C). Host-runtime
// state distinct from the immutable manifest and the registry's published tags.
type AgentDeployment struct {
	AgentID         string   `json:"agentId"`
	Version         string   `json:"version"`
	State           string   `json:"state"`
	CanaryPercent   *float64 `json:"canaryPercent,omitempty"`
	RollbackPointer string   `json:"rollbackPointer,omitempty"`
	Channels        []string `json:"channels,omitempty"`
	EvalRunID       string   `json:"evalRunId,omitempty"`
	ApprovalGateID  string   `json:"approvalGateId,omitempty"`
}

// AgentDeploymentTransition is the TransitionAgentDeployment request body
// (RFC 0082 §E). The host authorizes it fail-closed (RFC 0049 deploy:*), runs
// any RFC 0051 approvalGate, and enforces RFC 0081 requiredEval before emitting
// deployment.promoted.
type AgentDeploymentTransition struct {
	Version       string   `json:"version"`
	Transition    string   `json:"transition"`
	ToState       string   `json:"toState,omitempty"`
	Channel       string   `json:"channel,omitempty"`
	CanaryPercent *float64 `json:"canaryPercent,omitempty"`
	EvalRunID     string   `json:"evalRunId,omitempty"`
	Reason        string   `json:"reason,omitempty"`
}

// ── RFC 0086 / 0087 — Standing agent roster + org-chart ────────────────────

// AgentRef references a manifest/deployment from a roster entry (RFC 0086 §A).
type AgentRef struct {
	AgentID string `json:"agentId"`
	Version string `json:"version,omitempty"`
	Channel string `json:"channel,omitempty"`
}

// AgentRosterOwner is the {tenant, workspace} owner of a roster entry / org-chart.
type AgentRosterOwner struct {
	TenantID    string `json:"tenantId"`
	WorkspaceID string `json:"workspaceId,omitempty"`
}

// AgentRosterEntry is a standing agent INSTANCE: a host:<id> AgentRef that
// references a manifest/deployment and owns a workflow portfolio (RFC 0086 §A).
type AgentRosterEntry struct {
	RosterID    string           `json:"rosterId"`
	Persona     string           `json:"persona"`
	AgentRef    AgentRef         `json:"agentRef"`
	Workflows   []string         `json:"workflows,omitempty"`
	Owner       AgentRosterOwner `json:"owner"`
	Enabled     *bool            `json:"enabled,omitempty"`
	Label       string           `json:"label,omitempty"`
	Description string           `json:"description,omitempty"`
}

// AgentRosterResponse is the GET /v1/agents/roster body (RFC 0086 §B).
type AgentRosterResponse struct {
	Roster []AgentRosterEntry `json:"roster"`
	Total  int                `json:"total"`
}

// OrgChartRole is a role within an org-chart department (RFC 0087 §A).
type OrgChartRole struct {
	RoleID string `json:"roleId"`
	Name   string `json:"name"`
}

// OrgChartDepartment is an org-chart department (a tree node via
// ParentDepartmentID) (RFC 0087 §A).
type OrgChartDepartment struct {
	DepartmentID       string         `json:"departmentId"`
	Name               string         `json:"name"`
	ParentDepartmentID *string        `json:"parentDepartmentId"`
	Roles              []OrgChartRole `json:"roles"`
}

// OrgChartMember is a roster instance placed in a department/role (RFC 0087 §A).
type OrgChartMember struct {
	RosterID     string  `json:"rosterId"`
	DepartmentID string  `json:"departmentId"`
	RoleID       string  `json:"roleId"`
	ReportsTo    *string `json:"reportsTo"`
}

// AgentOrgChart is the descriptive org-chart over roster members (RFC 0087 §A).
// Carries no authority-bearing field by design (§B
// org-position-no-authority-escalation).
type AgentOrgChart struct {
	Owner       AgentRosterOwner     `json:"owner"`
	Departments []OrgChartDepartment `json:"departments"`
	Members     []OrgChartMember     `json:"members"`
}

// OrgChartResponsibilityView is the GET /v1/agents/org-chart/{departmentId} body
// (RFC 0087 §D) — the department subtree + the responsibility roll-up (union of
// member portfolios).
type OrgChartResponsibilityView struct {
	Department       OrgChartDepartment `json:"department"`
	Members          []OrgChartMember   `json:"members"`
	Responsibilities []string           `json:"responsibilities"`
}

// ── RFC 0081 — Eval summary (spec/v1/agent-eval-suite.md) ──────────────────

// EvalSafetyFinding is a redaction-safe safety finding ({kind, severity}
// descriptor — never excerpted content).
type EvalSafetyFinding struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
}

// EvalTaskResult is a per-task result on an EvalSummary (content-free: scores +
// scalars + ids).
type EvalTaskResult struct {
	TaskID         string              `json:"taskId"`
	Score          float64             `json:"score"`
	Passed         bool                `json:"passed"`
	CostUsd        *float64            `json:"costUsd,omitempty"`
	LatencyMs      *int                `json:"latencyMs,omitempty"`
	SchemaValid    *bool               `json:"schemaValid,omitempty"`
	SafetyFindings []EvalSafetyFinding `json:"safetyFindings,omitempty"`
}

// EvalRegression is the regression block on an EvalSummary (RFC 0081 §D
// regression mode).
type EvalRegression struct {
	BaselineRunID string  `json:"baselineRunId"`
	ScoreDelta    float64 `json:"scoreDelta"`
	DiffRef       string  `json:"diffRef,omitempty"`
}

// EvalSummary is the terminal scorecard of an eval run, read via GetEvalSummary
// (RFC 0081 §C). Content-free: scores, scalars, ids, and redaction-safe safety
// descriptors only (eval-summary-no-content-leak).
type EvalSummary struct {
	SuiteID             string           `json:"suiteId"`
	SuiteVersion        string           `json:"suiteVersion"`
	EvaluatedModelClass string           `json:"evaluatedModelClass,omitempty"`
	AggregateScore      float64          `json:"aggregateScore"`
	Passed              bool             `json:"passed"`
	TaskCount           int              `json:"taskCount"`
	PassedCount         int              `json:"passedCount"`
	TotalCostUsd        *float64         `json:"totalCostUsd,omitempty"`
	Tasks               []EvalTaskResult `json:"tasks"`
	Regression          *EvalRegression  `json:"regression,omitempty"`
}

// ── RFC 0054 — Run diff (spec/v1/rest-endpoints.md §GET /v1/runs/{runId}:diff) ─

// RunDiffEventDiff is one event-level diff entry on a RunDiffResponse.
type RunDiffEventDiff struct {
	Op       string       `json:"op"`
	Sequence int          `json:"sequence"`
	AEvent   *RunEventDoc `json:"aEvent,omitempty"`
	BEvent   *RunEventDoc `json:"bEvent,omitempty"`
}

// RunDiffResponse is the deterministic, replay-aware structured diff of two runs
// (RFC 0054). DivergedAtSeq is nil + EventDiffs empty when the two logs are
// identical.
type RunDiffResponse struct {
	A             string             `json:"a"`
	B             string             `json:"b"`
	DivergedAtSeq *int               `json:"divergedAtSeq"`
	EventDiffs    []RunDiffEventDiff `json:"eventDiffs"`
	StateDiff     map[string]any     `json:"stateDiff"`
	Truncated     *bool              `json:"truncated,omitempty"`
}

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v1/prompts.md) ──────────────

// PromptVariable is a typed interpolation slot in a PromptTemplate. Bindings are
// validated against this declaration before composition.
type PromptVariable struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Required     bool   `json:"required"`
	Source       string `json:"source,omitempty"`
	ExtractPath  string `json:"extractPath,omitempty"`
	DefaultValue any    `json:"defaultValue,omitempty"`
	Description  string `json:"description,omitempty"`
}

// PromptModelHints carries optional per-template model hints.
type PromptModelHints struct {
	ModelClass   string   `json:"modelClass,omitempty"`
	Temperature  *float64 `json:"temperature,omitempty"`
	MaxTokens    *int     `json:"maxTokens,omitempty"`
	EnvelopeType string   `json:"envelopeType,omitempty"`
}

// PromptMeta carries provenance metadata for a PromptTemplate. PackName +
// PackVersion are required when Source == "pack" (RFC 0028 §C).
type PromptMeta struct {
	Author      string `json:"author,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	Source      string `json:"source,omitempty"`
	PackName    string `json:"packName,omitempty"`
	PackVersion string `json:"packVersion,omitempty"`
}

// PromptTemplate is a named, versioned, variable-bound prompt body (RFC 0028 §A;
// schemas/prompt-template.schema.json).
type PromptTemplate struct {
	TemplateID  string            `json:"templateId"`
	Version     string            `json:"version"`
	Kind        string            `json:"kind"`
	Text        string            `json:"text"`
	Name        string            `json:"name,omitempty"`
	Description string            `json:"description,omitempty"`
	Variables   []PromptVariable  `json:"variables,omitempty"`
	ModelHints  *PromptModelHints `json:"modelHints,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	Meta        *PromptMeta       `json:"meta,omitempty"`
}

// ListPromptTemplatesOptions is the filter set for ListPromptTemplates (RFC 0028 §A).
type ListPromptTemplatesOptions struct {
	Kind       string
	Tag        string
	ModelClass string
	Source     string
	Cursor     string
	// Limit caps entries per page; zero = host default.
	Limit int
}

// ListPromptTemplatesResponse is the GET /v1/prompts body (RFC 0028 §A).
type ListPromptTemplatesResponse struct {
	Items      []PromptTemplate `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

// GetPromptTemplateOptions disambiguates a GetPromptTemplate read (RFC 0028 §A).
type GetPromptTemplateOptions struct {
	// Version pins to a SemVer version; latest when empty.
	Version string
	// LibraryID disambiguates when multiple installed packs ship the same templateId.
	LibraryID string
}

// RenderPromptTemplateRequest is the POST /v1/prompts:render request body
// (RFC 0028 §A). Secret-source bindings carry [REDACTED:<credentialRef>] markers;
// the host resolves the real value internally and never echoes it.
type RenderPromptTemplateRequest struct {
	// Ref is a PromptRef — the stringy prompt:<templateId>[@<version>] form or the
	// structured object form (schemas/prompt-ref.schema.json). Modeled as any to
	// admit both wire shapes.
	Ref          any            `json:"ref"`
	Variables    map[string]any `json:"variables"`
	ContentTrust string         `json:"contentTrust,omitempty"`
}

// RenderPromptTemplateResponse is the POST /v1/prompts:render response (RFC 0028 §A).
// Hash + Refs + VariableHashes are always present; Composed populates only under
// capabilities.prompts.observability: "full".
type RenderPromptTemplateResponse struct {
	Hash           string            `json:"hash"`
	Refs           []string          `json:"refs"`
	VariableHashes map[string]string `json:"variableHashes"`
	Composed       string            `json:"composed,omitempty"`
	ContentTrust   string            `json:"contentTrust,omitempty"`
}
