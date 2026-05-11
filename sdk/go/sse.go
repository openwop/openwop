package openwopclient

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// StreamEventsOptions controls a single SSE subscription.
type StreamEventsOptions struct {
	// StreamMode forwards as the `?streamMode=` query param. Empty =
	// server default ("updates"). For S4 mixed-mode, set StreamModes
	// instead — when both are non-empty StreamModes wins.
	StreamMode StreamMode
	// StreamModes forwards as a comma-separated `?streamMode=A,B` query
	// per S4 mixed-mode. Use for combinations like
	// []StreamMode{StreamModeUpdates, StreamModeMessages}.
	StreamModes []StreamMode
	// LastEventID forwards as the `Last-Event-ID` header for resumption.
	LastEventID string
	// BufferMs is the S3 batching hint (0..5000). When set, the server
	// batches events for up to N ms; the SDK transparently flattens
	// batched arrays back into per-channel sends so consumers see the
	// same shape as unbuffered streams. Zero = no buffering.
	BufferMs int
}

// StreamEvents opens an SSE subscription and returns a receive-only
// channel that yields each parsed RunEventDoc until the server closes
// the stream OR ctx is cancelled.
//
// The returned cleanup func MUST be called when the caller is done
// consuming events (typically `defer cleanup()`). Cancelling ctx is
// equivalent — both tear down the underlying HTTP connection. Calling
// the cleanup func twice is safe.
//
// Errors returned synchronously from this function are connection-
// open failures (4xx/5xx, DNS, etc.). Per-event decode errors are
// silently swallowed (forward-compat: skip non-JSON keep-alives and
// vendor extensions rather than blowing up the consumer).
func (c *OpenwopClient) StreamEvents(
	ctx context.Context,
	runID string,
	opts StreamEventsOptions,
) (<-chan RunEventDoc, func(), error) {
	q := url.Values{}
	if len(opts.StreamModes) > 0 {
		modes := make([]string, len(opts.StreamModes))
		for i, m := range opts.StreamModes {
			modes[i] = string(m)
		}
		q.Set("streamMode", strings.Join(modes, ","))
	} else if opts.StreamMode != "" {
		q.Set("streamMode", string(opts.StreamMode))
	}
	if opts.BufferMs > 0 {
		q.Set("bufferMs", strconv.Itoa(opts.BufferMs))
	}
	qs := ""
	if encoded := q.Encode(); encoded != "" {
		qs = "?" + encoded
	}
	endpoint := fmt.Sprintf("%s/v1/runs/%s/events%s", c.BaseURL, url.PathEscape(runID), qs)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, func() {}, err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	if opts.LastEventID != "" {
		req.Header.Set("Last-Event-ID", opts.LastEventID)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, func() {}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return nil, func() {}, newWopError(
			resp.StatusCode,
			string(body),
			parseEnvelope(body),
			resp.Header.Get("Traceparent"),
		)
	}

	out := make(chan RunEventDoc, 16)
	closed := false
	cleanup := func() {
		if closed {
			return
		}
		closed = true
		_ = resp.Body.Close()
	}

	go func() {
		defer close(out)
		defer cleanup()

		scanner := bufio.NewScanner(resp.Body)
		// SSE events can carry chunks larger than the default 64KB scanner
		// buffer. Bump to 1MB to handle realistic payloads.
		buf := make([]byte, 0, 1024*1024)
		scanner.Buffer(buf, 1024*1024)

		var (
			pendingData  []string
			pendingEvent = "message"
		)

		// sendOne forwards one decoded RunEventDoc to the consumer channel
		// (with a context-cancel select). Skips malformed payloads.
		sendOne := func(raw []byte) {
			var ev RunEventDoc
			if err := json.Unmarshal(raw, &ev); err != nil {
				return
			}
			if ev.EventID == "" || ev.Type == "" {
				return
			}
			select {
			case out <- ev:
			case <-ctx.Done():
			}
		}

		flush := func() {
			if len(pendingData) == 0 {
				pendingEvent = "message"
				return
			}
			raw := strings.Join(pendingData, "\n")
			eventType := pendingEvent
			pendingData = pendingData[:0]
			pendingEvent = "message"

			// S3 batched envelope — `event: batch` carries an array of events.
			if eventType == "batch" {
				var batch []json.RawMessage
				if err := json.Unmarshal([]byte(raw), &batch); err == nil {
					for _, item := range batch {
						sendOne(item)
					}
					return
				}
				// Fall through if it parsed as something other than an array —
				// treat as a normal event for forward-compat.
			}
			sendOne([]byte(raw))
		}

		for scanner.Scan() {
			line := strings.TrimRight(scanner.Text(), "\r")
			if line == "" {
				flush()
				continue
			}
			if strings.HasPrefix(line, ":") {
				continue // SSE comment / keep-alive
			}
			colon := strings.IndexByte(line, ':')
			var field, value string
			if colon == -1 {
				field, value = line, ""
			} else {
				field = line[:colon]
				value = line[colon+1:]
				if strings.HasPrefix(value, " ") {
					value = value[1:]
				}
			}
			switch field {
			case "data":
				pendingData = append(pendingData, value)
			case "event":
				pendingEvent = value
			}
			// "id" remains unused.
		}
		// Flush any final unterminated event.
		flush()
	}()

	return out, cleanup, nil
}
