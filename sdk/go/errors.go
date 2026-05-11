package openwopclient

import (
	"fmt"
	"regexp"
)

// WopError wraps a non-2xx response. Implements the error interface.
//
// Per observability.md §Trace context propagation:
// "Clients SHOULD display the trace ID in error messages so operators
// can search backend traces." Error() includes a (trace=<id>) suffix
// when traceparent was present on the response.
type WopError struct {
	Status      int
	Envelope    *ErrorEnvelope
	RawText     string
	Traceparent string
	TraceID     string // 32-hex extracted from Traceparent, if parseable.
}

// Error implements the error interface.
func (e *WopError) Error() string {
	base := fmt.Sprintf("openwop request failed: HTTP %d", e.Status)
	if e.Envelope != nil && e.Envelope.Message != "" {
		base = e.Envelope.Message
	}
	if e.TraceID != "" {
		return fmt.Sprintf("%s (trace=%s)", base, e.TraceID)
	}
	return base
}

var traceparentRegex = regexp.MustCompile(`^[0-9a-fA-F]{2}-([0-9a-fA-F]{32})-[0-9a-fA-F]{16}-[0-9a-fA-F]{2}$`)

// extractTraceID pulls the 32-hex trace ID out of a W3C traceparent
// header. Returns "" for empty/malformed inputs — never panics.
func extractTraceID(traceparent string) string {
	if traceparent == "" {
		return ""
	}
	m := traceparentRegex.FindStringSubmatch(traceparent)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

// newWopError constructs a WopError, parsing the trace ID from the
// optional traceparent header.
func newWopError(status int, raw string, env *ErrorEnvelope, traceparent string) *WopError {
	return &WopError{
		Status:      status,
		Envelope:    env,
		RawText:     raw,
		Traceparent: traceparent,
		TraceID:     extractTraceID(traceparent),
	}
}
