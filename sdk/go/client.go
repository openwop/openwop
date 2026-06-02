package openwopclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// OpenwopClient is a synchronous HTTP client for any OpenWOP-compliant server.
//
// Construct with NewClient(baseURL, apiKey). The zero value is NOT
// usable — apiKey is required.
//
// Threadsafe — methods are safe to call concurrently from multiple
// goroutines (net/http.Client is itself threadsafe and that's all
// the client wraps).
type OpenwopClient struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client // optional; nil = default with 30s timeout
}

// NewClient constructs a OpenwopClient with the canonical defaults.
// Returns an error if baseURL or apiKey is empty.
func NewClient(baseURL, apiKey string) (*OpenwopClient, error) {
	if baseURL == "" {
		return nil, errors.New("openwopclient: baseURL is required")
	}
	if apiKey == "" {
		return nil, errors.New("openwopclient: apiKey is required")
	}
	return &OpenwopClient{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		APIKey:     apiKey,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *OpenwopClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// MutationOptions controls per-mutation headers (Idempotency-Key,
// X-Dedup). Pass via the helper methods like CreateRunOpts(...).
type MutationOptions struct {
	IdempotencyKey string
	Dedup          bool
}

func (m MutationOptions) headers() map[string]string {
	h := map[string]string{}
	if m.IdempotencyKey != "" {
		h["Idempotency-Key"] = m.IdempotencyKey
	}
	if m.Dedup {
		h["X-Dedup"] = "enforce"
	}
	return h
}

// ── Discovery ──────────────────────────────────────────────────────────

// GetCapabilities calls GET /.well-known/openwop. Unauthenticated.
func (c *OpenwopClient) GetCapabilities(ctx context.Context) (*Capabilities, error) {
	var out Capabilities
	if err := c.requestJSON(ctx, http.MethodGet, "/.well-known/openwop", nil, nil, false, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetOpenAPI calls GET /v1/openapi.json. Unauthenticated. Returns the
// raw OpenAPI document as a generic map (the SDK doesn't model the
// OpenAPI spec itself — leave that to the caller's tooling).
func (c *OpenwopClient) GetOpenAPI(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(ctx, http.MethodGet, "/v1/openapi.json", nil, nil, false, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Workflows ──────────────────────────────────────────────────────────

// GetWorkflow calls GET /v1/workflows/{workflowID}.
func (c *OpenwopClient) GetWorkflow(ctx context.Context, workflowID string) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/workflows/"+url.PathEscape(workflowID),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Runs ───────────────────────────────────────────────────────────────

// CreateRun calls POST /v1/runs.
func (c *OpenwopClient) CreateRun(
	ctx context.Context,
	body CreateRunRequest,
	opts MutationOptions,
) (*CreateRunResponse, error) {
	var out CreateRunResponse
	if err := c.requestJSON(ctx, http.MethodPost, "/v1/runs", body, opts.headers(), true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRun calls GET /v1/runs/{runID}.
func (c *OpenwopClient) GetRun(ctx context.Context, runID string) (*RunSnapshot, error) {
	var out RunSnapshot
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetDebugBundle calls GET /v1/runs/{runID}/debug-bundle per
// spec/v1/debug-bundle.md. Returns (nil, nil) when the host doesn't
// advertise capabilities.debugBundle.supported: true (endpoint returns
// 404 per the spec); callers can branch on capability discovery
// without parsing the error envelope. The bundle's RedactionMode
// reflects the host's advertised capabilities.compliance.defaultMode.
func (c *OpenwopClient) GetDebugBundle(
	ctx context.Context,
	runID string,
	opts DebugBundleOptions,
) (*DebugBundle, error) {
	path := "/v1/runs/" + url.PathEscape(runID) + "/debug-bundle"
	if opts.MaxEvents > 0 {
		path += "?maxEvents=" + url.QueryEscape(strconv.Itoa(opts.MaxEvents))
	}
	var out DebugBundle
	err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out)
	if err != nil {
		// Surface 404 as (nil, nil) so callers can branch on
		// capability discovery without unwrapping the error type.
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// CancelRun calls POST /v1/runs/{runID}/cancel.
func (c *OpenwopClient) CancelRun(
	ctx context.Context,
	runID string,
	body CancelRunRequest,
	opts MutationOptions,
) (*CancelRunResponse, error) {
	var out CancelRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+"/cancel",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// PauseRun calls POST /v1/runs/{runID}:pause.
func (c *OpenwopClient) PauseRun(
	ctx context.Context,
	runID string,
	body PauseRunRequest,
	opts MutationOptions,
) (*PauseRunResponse, error) {
	var out PauseRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+":pause",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResumeRun calls POST /v1/runs/{runID}:resume.
func (c *OpenwopClient) ResumeRun(
	ctx context.Context,
	runID string,
	body ResumeRunRequest,
	opts MutationOptions,
) (*ResumeRunResponse, error) {
	var out ResumeRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+":resume",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// BulkCancelRuns calls POST /v1/runs:bulk-cancel.
//
// Per rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1). The
// top-level call returns 200 + per-id results whenever the request
// reaches the host; partial failures surface inside the array (each
// entry carries OK + optional Error). Host-defined cap on RunIDs
// length (RECOMMENDED 100); over-cap returns 400 validation_error.
func (c *OpenwopClient) BulkCancelRuns(
	ctx context.Context,
	body BulkCancelRunsRequest,
	opts MutationOptions,
) (*BulkCancelRunsResponse, error) {
	var out BulkCancelRunsResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs:bulk-cancel",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// RegisterWebhook calls POST /v1/webhooks per spec/v1/webhooks.md.
// The Secret field on the response is returned ONCE — store it
// server-side for HMAC verification; the host cannot recover it.
func (c *OpenwopClient) RegisterWebhook(
	ctx context.Context,
	body RegisterWebhookRequest,
	opts MutationOptions,
) (*RegisterWebhookResponse, error) {
	var out RegisterWebhookResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/webhooks",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// UnregisterWebhook calls DELETE /v1/webhooks/{subscriptionID}.
// Returns nil on success; an unknown subscription surfaces as a
// WopError with code "subscription_not_found".
func (c *OpenwopClient) UnregisterWebhook(
	ctx context.Context,
	subscriptionID string,
) error {
	return c.requestJSON(
		ctx, http.MethodDelete,
		"/v1/webhooks/"+url.PathEscape(subscriptionID),
		nil, nil, true, nil,
	)
}

// VerifyAuditLog calls GET /v1/audit/verify?fromSeq=&toSeq= per
// auth-profiles.md §"openwop-audit-log-integrity" §4. Requires the
// audit:read scope on the API key. Hosts that do NOT advertise the
// profile return 404 (surfaced as a WopError).
func (c *OpenwopClient) VerifyAuditLog(
	ctx context.Context,
	fromSeq int64,
	toSeq int64,
) (*AuditVerifyResult, error) {
	var out AuditVerifyResult
	q := url.Values{}
	q.Set("fromSeq", strconv.FormatInt(fromSeq, 10))
	q.Set("toSeq", strconv.FormatInt(toSeq, 10))
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/audit/verify?"+q.Encode(),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ForkRun calls POST /v1/runs/{runID}:fork.
func (c *OpenwopClient) ForkRun(
	ctx context.Context,
	runID string,
	body ForkRunRequest,
	opts MutationOptions,
) (*ForkRunResponse, error) {
	var out ForkRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+":fork",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateAnnotation calls POST /v1/runs/{runID}/annotations per RFC 0056 —
// records a non-blocking quality annotation on a run. Returns a *WopError
// with Status 501 when the host doesn't advertise
// capabilities.feedback.supported.
func (c *OpenwopClient) CreateAnnotation(
	ctx context.Context,
	runID string,
	body CreateAnnotationRequest,
	opts MutationOptions,
) (*Annotation, error) {
	var out Annotation
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+"/annotations",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListAnnotations calls GET /v1/runs/{runID}/annotations per RFC 0056.
// Returns (nil, nil) when the host doesn't advertise capabilities.feedback
// (endpoint returns 404 or 501 in that case), so callers can branch on
// capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListAnnotations(
	ctx context.Context,
	runID string,
) ([]Annotation, error) {
	var out ListAnnotationsResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+"/annotations",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return out.Annotations, nil
}

// ListWorkspaceFilesOptions controls GET /v1/host/workspace/files query.
type ListWorkspaceFilesOptions struct {
	// Prefix filters the flat path namespace; empty = no filter.
	Prefix string
}

// ListWorkspaceFiles calls GET /v1/host/workspace/files per RFC 0059 — lists
// workspace file metadata (no bodies) for the caller's {tenant, workspace}.
// Returns (nil, nil) when the host doesn't advertise
// capabilities.workspace.supported (endpoint returns 501), so callers can
// branch on capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListWorkspaceFiles(
	ctx context.Context,
	opts ListWorkspaceFilesOptions,
) ([]WorkspaceFile, error) {
	path := "/v1/host/workspace/files"
	if opts.Prefix != "" {
		q := url.Values{}
		q.Set("prefix", opts.Prefix)
		path += "?" + q.Encode()
	}
	var out ListWorkspaceFilesResponse
	err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 501 {
			return nil, nil
		}
		return nil, err
	}
	return out.Files, nil
}

// GetWorkspaceFileOptions controls GET /v1/host/workspace/files/{path} query.
type GetWorkspaceFileOptions struct {
	// Version requests a historical snapshot when
	// capabilities.workspace.versioned is true. Zero = latest.
	Version int
}

// GetWorkspaceFile calls GET /v1/host/workspace/files/{path} per RFC 0059.
// Returns (nil, nil) when the file is absent (404) or the host doesn't
// advertise capabilities.workspace.supported (501).
func (c *OpenwopClient) GetWorkspaceFile(
	ctx context.Context,
	filePath string,
	opts GetWorkspaceFileOptions,
) (*WorkspaceFile, error) {
	path := "/v1/host/workspace/files/" + url.PathEscape(filePath)
	if opts.Version > 0 {
		q := url.Values{}
		q.Set("version", strconv.Itoa(opts.Version))
		path += "?" + q.Encode()
	}
	var out WorkspaceFile
	err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// PutWorkspaceFileOptions carries mutation headers plus the RFC 0059 If-Match
// optimistic-concurrency token for PutWorkspaceFile.
type PutWorkspaceFileOptions struct {
	MutationOptions
	// IfMatch is the file's current etag; a stale value yields a *WopError
	// with Status 409 (workspace_conflict).
	IfMatch string
}

// PutWorkspaceFile calls PUT /v1/host/workspace/files/{path} per RFC 0059 —
// atomic create/replace. A stale IfMatch yields a *WopError with Status 409
// (workspace_conflict); content beyond capabilities.workspace.maxFileBytes
// yields Status 413 (workspace_too_large).
func (c *OpenwopClient) PutWorkspaceFile(
	ctx context.Context,
	filePath string,
	body PutWorkspaceFileRequest,
	opts PutWorkspaceFileOptions,
) (*WorkspaceFile, error) {
	headers := opts.MutationOptions.headers()
	if opts.IfMatch != "" {
		headers["If-Match"] = opts.IfMatch
	}
	var out WorkspaceFile
	if err := c.requestJSON(
		ctx, http.MethodPut,
		"/v1/host/workspace/files/"+url.PathEscape(filePath),
		body, headers, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteWorkspaceFile calls DELETE /v1/host/workspace/files/{path} per RFC 0059.
// Returns (true, nil) on success (204); (false, nil) when the file is absent
// (404) or the host doesn't advertise capabilities.workspace.supported (501).
func (c *OpenwopClient) DeleteWorkspaceFile(
	ctx context.Context,
	filePath string,
	opts MutationOptions,
) (bool, error) {
	err := c.requestJSON(
		ctx, http.MethodDelete,
		"/v1/host/workspace/files/"+url.PathEscape(filePath),
		nil, opts.headers(), true, nil,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// RunAncestry calls GET /v1/runs/{runID}/ancestry per RFC 0040 §C and
// spec/v1/multi-agent-execution.md §"GET /v1/runs/{runId}/ancestry".
//
// Returns (nil, nil) when the host doesn't advertise
// capabilities.multiAgent.executionModel.crossHostCausation
// .ancestryEndpointSupported: true (endpoint returns 404 in that case);
// callers can branch on capability discovery without unwrapping the
// error envelope. On 200, RunAncestryResponse.Parent is nil for
// top-level runs; when set, Parent.WellKnownURL identifies the parent
// host's discovery URL so callers walk the chain one hop at a time.
func (c *OpenwopClient) RunAncestry(
	ctx context.Context,
	runID string,
) (*RunAncestryResponse, error) {
	var out RunAncestryResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+"/ancestry",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// PollRunEventsOptions controls GET /v1/runs/{runID}/events/poll query.
type PollRunEventsOptions struct {
	LastSequence   *int
	TimeoutSeconds *int
}

// PollRunEvents calls GET /v1/runs/{runID}/events/poll.
func (c *OpenwopClient) PollRunEvents(
	ctx context.Context,
	runID string,
	opts PollRunEventsOptions,
) (*PollEventsResponse, error) {
	q := url.Values{}
	if opts.LastSequence != nil {
		q.Set("lastSequence", strconv.Itoa(*opts.LastSequence))
	}
	if opts.TimeoutSeconds != nil {
		q.Set("timeout", strconv.Itoa(*opts.TimeoutSeconds))
	}
	qs := ""
	if encoded := q.Encode(); encoded != "" {
		qs = "?" + encoded
	}
	var out PollEventsResponse
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+"/events/poll"+qs,
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── HITL interrupts (run-scoped + signed-token) ────────────────────────

// ResolveInterruptByRun calls POST /v1/runs/{runID}/interrupts/{nodeID}.
func (c *OpenwopClient) ResolveInterruptByRun(
	ctx context.Context,
	runID, nodeID string,
	body ResolveInterruptRequest,
	opts MutationOptions,
) (*ResolveInterruptResponse, error) {
	var out ResolveInterruptResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/runs/"+url.PathEscape(runID)+"/interrupts/"+url.PathEscape(nodeID),
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// InspectInterruptByToken calls GET /v1/interrupts/{token}. Unauthenticated
// (the signed token IS the auth).
func (c *OpenwopClient) InspectInterruptByToken(
	ctx context.Context,
	token string,
) (*InterruptByTokenInspection, error) {
	var out InterruptByTokenInspection
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/interrupts/"+url.PathEscape(token),
		nil, nil, false, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResolveInterruptByToken calls POST /v1/interrupts/{token}.
// Unauthenticated.
func (c *OpenwopClient) ResolveInterruptByToken(
	ctx context.Context,
	token string,
	body ResolveInterruptRequest,
	opts MutationOptions,
) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/interrupts/"+url.PathEscape(token),
		body, opts.headers(), false, &out,
	); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Internals ──────────────────────────────────────────────────────────

func (c *OpenwopClient) requestJSON(
	ctx context.Context,
	method, path string,
	body any,
	extraHeaders map[string]string,
	authenticated bool,
	out any,
) error {
	endpoint := c.BaseURL + path

	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("openwopclient: encode body: %w", err)
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	rawBody, _ := io.ReadAll(resp.Body)
	traceparent := resp.Header.Get("Traceparent")

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newWopError(resp.StatusCode, string(rawBody), parseEnvelope(rawBody), traceparent)
	}

	if len(rawBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(rawBody, out); err != nil {
		return newWopError(
			resp.StatusCode,
			string(rawBody),
			&ErrorEnvelope{Error: "invalid_json", Message: "Server returned non-JSON body for a 2xx response"},
			traceparent,
		)
	}
	return nil
}

// parseEnvelope best-effort decodes a non-2xx body into ErrorEnvelope.
// Returns nil for unparseable / non-conforming bodies.
func parseEnvelope(raw []byte) *ErrorEnvelope {
	if len(raw) == 0 {
		return nil
	}
	var env ErrorEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil
	}
	if env.Error == "" || env.Message == "" {
		return nil
	}
	return &env
}

// ListAgents returns the manifest agents this host has installed (RFC 0072 §A).
// Read-only; returns (nil, nil) when the host doesn't advertise
// capabilities.agents.manifestRuntime (the endpoint 404s). Dispatch is not here:
// a manifest agent runs as a CreateRun whose workflow node pins it via
// WorkflowNode.agent (RFC 0072 §B).
func (c *OpenwopClient) ListAgents(ctx context.Context) (*AgentInventoryResponse, error) {
	var out AgentInventoryResponse
	err := c.requestJSON(ctx, http.MethodGet, "/v1/agents", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgent returns one installed manifest agent's inventory entry, or (nil, nil)
// when absent / the capability is unadvertised (404) (RFC 0072 §A).
func (c *OpenwopClient) GetAgent(ctx context.Context, agentID string) (*AgentInventoryEntry, error) {
	var out AgentInventoryEntry
	err := c.requestJSON(ctx, http.MethodGet, "/v1/agents/"+url.PathEscape(agentID), nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0078 — Portable tool catalog (spec/v1/tool-catalog.md) ─────────────

// ListTools calls GET /v1/tools per RFC 0078 §B — lists the portable
// ToolDescriptors visible to the caller. Returns (nil, nil) when the host
// doesn't advertise capabilities.toolCatalog (the endpoint 404s), so callers can
// branch on capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListTools(ctx context.Context) ([]ToolDescriptor, error) {
	var out []ToolDescriptor
	err := c.requestJSON(ctx, http.MethodGet, "/v1/tools", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// GetTool calls GET /v1/tools/{toolID} per RFC 0078 §B — returns one
// ToolDescriptor by its stable toolId. Returns (nil, nil) on 404 (no such tool,
// or the capability is unadvertised).
func (c *OpenwopClient) GetTool(ctx context.Context, toolID string) (*ToolDescriptor, error) {
	var out ToolDescriptor
	err := c.requestJSON(ctx, http.MethodGet, "/v1/tools/"+url.PathEscape(toolID), nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetArtifact calls GET /v1/runs/{runID}/artifacts/{artifactID} — reads a
// run-produced artifact by id. The artifact body is implementation-defined per
// the host, so it's returned as a generic map. Returns (nil, nil) on 404 (no
// such artifact, or the host doesn't store artifacts).
func (c *OpenwopClient) GetArtifact(
	ctx context.Context,
	runID, artifactID string,
) (map[string]any, error) {
	var out map[string]any
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+"/artifacts/"+url.PathEscape(artifactID),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// ── RFC 0082 — Agent deployment lifecycle ──────────────────────────────────

// ListAgentDeployments calls GET /v1/agents/{agentID}/deployments per RFC 0082
// §C/§E — lists a manifest agent's deployment records. Returns (nil, nil) when
// the host doesn't advertise capabilities.agents.deployment (the endpoint 404s).
func (c *OpenwopClient) ListAgentDeployments(
	ctx context.Context,
	agentID string,
) ([]AgentDeployment, error) {
	var out []AgentDeployment
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/agents/"+url.PathEscape(agentID)+"/deployments",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// TransitionAgentDeployment calls POST /v1/agents/{agentID}/deployments per
// RFC 0082 §E — requests a deployment state transition (promote / pause /
// deprecate / rollback / adjust-canary). The host authorizes fail-closed against
// the RFC 0049 deploy:* scope, runs any RFC 0051 approvalGate, and enforces
// RFC 0081 requiredEval before emitting deployment.promoted. Returns the updated
// deployment record; a *WopError with Status 403 (fail-closed / eval_gate_unmet)
// or 400 (no_active_deployment / unsupported state) on failure.
func (c *OpenwopClient) TransitionAgentDeployment(
	ctx context.Context,
	agentID string,
	body AgentDeploymentTransition,
	opts MutationOptions,
) (*AgentDeployment, error) {
	var out AgentDeployment
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/agents/"+url.PathEscape(agentID)+"/deployments",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── RFC 0086 / 0087 — Standing agent roster + org-chart ────────────────────

// ListAgentRoster calls GET /v1/agents/roster per RFC 0086 §B — lists the
// standing agent roster (named instances + their workflow portfolios) visible to
// the caller. Returns (nil, nil) when the host doesn't advertise
// capabilities.agents.roster (the endpoint 404s).
func (c *OpenwopClient) ListAgentRoster(ctx context.Context) (*AgentRosterResponse, error) {
	var out AgentRosterResponse
	err := c.requestJSON(ctx, http.MethodGet, "/v1/agents/roster", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentRosterEntry calls GET /v1/agents/roster/{rosterID} per RFC 0086 §B —
// returns one standing roster entry. Returns (nil, nil) on 404 (no such entry,
// cross-tenant, or the capability is unadvertised).
func (c *OpenwopClient) GetAgentRosterEntry(
	ctx context.Context,
	rosterID string,
) (*AgentRosterEntry, error) {
	var out AgentRosterEntry
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/agents/roster/"+url.PathEscape(rosterID),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentOrgChart calls GET /v1/agents/org-chart per RFC 0087 §C — returns the
// caller's agent org-chart (departments + roles + reportsTo over roster members;
// descriptive — confers no authority). Returns (nil, nil) when the host doesn't
// advertise capabilities.agents.orgChart (the endpoint 404s).
func (c *OpenwopClient) GetAgentOrgChart(ctx context.Context) (*AgentOrgChart, error) {
	var out AgentOrgChart
	err := c.requestJSON(ctx, http.MethodGet, "/v1/agents/org-chart", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentOrgChartDepartmentOptions controls the
// GET /v1/agents/org-chart/{departmentID} query.
type GetAgentOrgChartDepartmentOptions struct {
	// Recursive scopes the responsibility roll-up. Defaults to true (recursive);
	// set NonRecursive to scope the roll-up to direct members only.
	NonRecursive bool
}

// GetAgentOrgChartDepartment calls GET /v1/agents/org-chart/{departmentID} per
// RFC 0087 §D — one department's subtree + responsibility roll-up (the union of
// its members' RFC 0086 portfolios). Pass NonRecursive to scope the roll-up to
// direct members. Returns (nil, nil) on 404 (unknown/cross-tenant department, or
// the capability is unadvertised).
func (c *OpenwopClient) GetAgentOrgChartDepartment(
	ctx context.Context,
	departmentID string,
	opts GetAgentOrgChartDepartmentOptions,
) (*OrgChartResponsibilityView, error) {
	path := "/v1/agents/org-chart/" + url.PathEscape(departmentID)
	if opts.NonRecursive {
		path += "?recursive=false"
	}
	var out OrgChartResponsibilityView
	err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0081 — Eval summary ─────────────────────────────────────────────────

// GetEvalSummary calls GET /v1/runs/{runID}/eval-summary per RFC 0081 §C — the
// EvalSummary scorecard for a terminal eval run (one started via
// CreateRun with mode "eval"): aggregate + per-task scores, cost, latency,
// schema-validity, and redaction-safe safety findings. Returns (nil, nil) when
// the host doesn't advertise capabilities.agents.evalSuite or the run isn't an
// eval run (404). A *WopError with Status 409 surfaces while the run is still in
// progress.
func (c *OpenwopClient) GetEvalSummary(
	ctx context.Context,
	runID string,
) (*EvalSummary, error) {
	var out EvalSummary
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+"/eval-summary",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0054 — Run diff ─────────────────────────────────────────────────────

// DiffRun calls GET /v1/runs/{runID}:diff?against={against} per RFC 0054 — a
// deterministic, replay-aware structured diff of two runs (typically a run and
// its :fork). Requires runs:read on BOTH runID and against. Returns (nil, nil)
// when the host doesn't implement the endpoint (404). DivergedAtSeq is nil +
// EventDiffs empty when the two logs are identical.
func (c *OpenwopClient) DiffRun(
	ctx context.Context,
	runID, against string,
) (*RunDiffResponse, error) {
	q := url.Values{}
	q.Set("against", against)
	var out RunDiffResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/v1/runs/"+url.PathEscape(runID)+":diff?"+q.Encode(),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v1/prompts.md) ──────────────
//
// Read endpoints (list, get, render) gate on
// capabilities.prompts.endpointsSupported: true. Mutating endpoints (create,
// update, delete) additionally require capabilities.prompts.mutableLibrary: true.
// Hosts that don't advertise the relevant capability return 501
// capability_not_provided, surfaced as a *WopError. Callers SHOULD pre-flight via
// GetCapabilities before calling.

// ListPromptTemplates calls GET /v1/prompts per RFC 0028 §A (operationId
// listPromptTemplates). Supports kind / tag / modelClass / source filters +
// opaque cursor pagination.
func (c *OpenwopClient) ListPromptTemplates(
	ctx context.Context,
	opts ListPromptTemplatesOptions,
) (*ListPromptTemplatesResponse, error) {
	q := url.Values{}
	if opts.Kind != "" {
		q.Set("kind", opts.Kind)
	}
	if opts.Tag != "" {
		q.Set("tag", opts.Tag)
	}
	if opts.ModelClass != "" {
		q.Set("modelClass", opts.ModelClass)
	}
	if opts.Source != "" {
		q.Set("source", opts.Source)
	}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	path := "/v1/prompts"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out ListPromptTemplatesResponse
	if err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreatePromptTemplate calls POST /v1/prompts per RFC 0028 §A (operationId
// createPromptTemplate). Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Supports Idempotency-Key via
// MutationOptions. Returns nil on success (201).
func (c *OpenwopClient) CreatePromptTemplate(
	ctx context.Context,
	template PromptTemplate,
	opts MutationOptions,
) error {
	return c.requestJSON(ctx, http.MethodPost, "/v1/prompts", template, opts.headers(), true, nil)
}

// GetPromptTemplate calls GET /v1/prompts/{templateID} per RFC 0028 §A
// (operationId getPromptTemplate). Optionally pin a SemVer Version; supply
// LibraryID to disambiguate when multiple installed packs ship the same
// templateId.
func (c *OpenwopClient) GetPromptTemplate(
	ctx context.Context,
	templateID string,
	opts GetPromptTemplateOptions,
) (*PromptTemplate, error) {
	q := url.Values{}
	if opts.Version != "" {
		q.Set("version", opts.Version)
	}
	if opts.LibraryID != "" {
		q.Set("libraryId", opts.LibraryID)
	}
	path := "/v1/prompts/" + url.PathEscape(templateID)
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out PromptTemplate
	if err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out); err != nil {
		// Return (nil, nil) on 404 (no such template), consistent with the other
		// Get-by-id methods and the TypeScript/Python SDKs; a 400
		// prompt_ref_ambiguous and other errors still surface so callers can
		// distinguish "not found" from "ambiguous reference".
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// UpdatePromptTemplate calls PUT /v1/prompts/{templateID} per RFC 0028 §A
// (operationId updatePromptTemplate). Submitted SemVer MUST be strictly greater
// than stored. Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Pack-sourced and host-built-in
// templates are read-only (host returns 403).
func (c *OpenwopClient) UpdatePromptTemplate(
	ctx context.Context,
	templateID string,
	template PromptTemplate,
	opts MutationOptions,
) (*PromptTemplate, error) {
	var out PromptTemplate
	if err := c.requestJSON(
		ctx, http.MethodPut,
		"/v1/prompts/"+url.PathEscape(templateID),
		template, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeletePromptTemplate calls DELETE /v1/prompts/{templateID} per RFC 0028 §A
// (operationId deletePromptTemplate). Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Pack-sourced and host-built-in
// templates are read-only (host returns 403). Returns nil on success (204).
func (c *OpenwopClient) DeletePromptTemplate(
	ctx context.Context,
	templateID string,
) error {
	return c.requestJSON(
		ctx, http.MethodDelete,
		"/v1/prompts/"+url.PathEscape(templateID),
		nil, nil, true, nil,
	)
}

// RenderPromptTemplate calls POST /v1/prompts:render per RFC 0028 §A (operationId
// renderPromptTemplate). Returns composed body + sha256 hash + per-variable
// hashes. The deterministic-hash invariant requires Hash to match what a matching
// prompt.composed event would carry at dispatch time. Does NOT dispatch an LLM
// call. Secret-source variable values MUST be supplied as
// [REDACTED:<credentialRef>] markers per SR-1.
func (c *OpenwopClient) RenderPromptTemplate(
	ctx context.Context,
	body RenderPromptTemplateRequest,
) (*RenderPromptTemplateResponse, error) {
	var out RenderPromptTemplateResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/v1/prompts:render",
		body, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}
