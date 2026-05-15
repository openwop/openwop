// Webhook delivery-verification helpers per spec/v1/webhooks.md
// §"Signature recipe". Receivers MUST verify both the HMAC AND the
// timestamp freshness before accepting a delivery — verifying HMAC
// alone leaves the receiver open to replay attacks.
//
// The canonical signing recipe:
//
//	hmac = HMAC-SHA256(secret, fmt.Sprintf("%d.%s", timestamp, rawBody))
//	header openwop-Webhook-Signature: v1=<hmac-hex>
//	header openwop-Webhook-Timestamp: <unix-seconds>
//
// Verification:
//
//  1. Parse the v1=<hex> value from the signature header.
//  2. Recompute expected = HMAC-SHA256(secret, fmt.Sprintf("%d.%s", ts, body)).
//  3. Compare using constant-time hmac.Equal.
//  4. Reject when |now - timestamp| exceeds the freshness window
//     (default 5 minutes per webhooks.md).

package openwopclient

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// DefaultWebhookFreshnessWindowSeconds is the default replay-attack
// freshness window per spec/v1/webhooks.md.
const DefaultWebhookFreshnessWindowSeconds = 300

// VerifyWebhookOutcome is the result of VerifyWebhookSignature.
// Valid is true on success; Reason carries the failure mode otherwise.
type VerifyWebhookOutcome struct {
	Valid  bool
	Reason VerifyWebhookReason
}

// VerifyWebhookReason names the specific failure mode when Valid is false.
type VerifyWebhookReason string

const (
	VerifyReasonSignatureMismatch       VerifyWebhookReason = "signature_mismatch"
	VerifyReasonTimestampExpired        VerifyWebhookReason = "timestamp_expired"
	VerifyReasonTimestampTooFarInFuture VerifyWebhookReason = "timestamp_too_far_in_future"
	VerifyReasonMalformedSigHeader      VerifyWebhookReason = "malformed_signature_header"
	VerifyReasonMalformedTSHeader       VerifyWebhookReason = "malformed_timestamp_header"
)

// VerifyWebhookOptions overrides the freshness window or the wall
// clock for testing. Zero-valued fields use the defaults.
type VerifyWebhookOptions struct {
	// FreshnessWindowSeconds caps the age of accepted deliveries.
	// Zero means "use default" (300 seconds); -1 disables the
	// timestamp check (NOT recommended).
	FreshnessWindowSeconds int
	// NowSeconds overrides time.Now().Unix() for testing.
	NowSeconds int64
}

// VerifyWebhookSignature verifies a webhook delivery per
// spec/v1/webhooks.md. Returns Valid=true on success; otherwise
// Valid=false with Reason set so callers can log + alert.
//
// Callers MUST pass the raw body bytes — re-serialized parsed JSON
// will fail verification because the host signs exact bytes.
func VerifyWebhookSignature(
	secret string,
	signatureHeader string,
	timestampHeader string,
	rawBody []byte,
	opts VerifyWebhookOptions,
) VerifyWebhookOutcome {
	if !strings.HasPrefix(signatureHeader, "v1=") {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedSigHeader}
	}
	providedHex := signatureHeader[3:]
	providedBytes, err := hex.DecodeString(providedHex)
	if err != nil || len(providedBytes) == 0 {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedSigHeader}
	}

	timestamp, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil || timestamp <= 0 {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedTSHeader}
	}

	window := opts.FreshnessWindowSeconds
	if window == 0 {
		window = DefaultWebhookFreshnessWindowSeconds
	}
	if window > 0 {
		now := opts.NowSeconds
		if now == 0 {
			now = time.Now().Unix()
		}
		delta := now - timestamp
		if delta > int64(window) {
			return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonTimestampExpired}
		}
		if delta < -int64(window) {
			return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonTimestampTooFarInFuture}
		}
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", timestamp)))
	mac.Write(rawBody)
	expected := mac.Sum(nil)

	if !hmac.Equal(providedBytes, expected) {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonSignatureMismatch}
	}
	return VerifyWebhookOutcome{Valid: true}
}

// SignWebhookDelivery computes the canonical webhook signature for a
// payload — useful when implementing a host or generating test
// fixtures. Returns (signatureHeader, timestampHeader).
func SignWebhookDelivery(secret string, timestamp int64, rawBody []byte) (string, string) {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", timestamp)))
	mac.Write(rawBody)
	return "v1=" + hex.EncodeToString(mac.Sum(nil)), strconv.FormatInt(timestamp, 10)
}
