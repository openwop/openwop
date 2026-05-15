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
