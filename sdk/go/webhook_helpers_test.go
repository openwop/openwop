package openwopclient

import (
	"testing"
	"time"
)

func TestWebhookSignatureRoundtrip(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1","event":"run.completed"}`)

	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature(secret, sig, tsHeader, body, VerifyWebhookOptions{})
	if !out.Valid {
		t.Fatalf("expected valid, got reason=%s", out.Reason)
	}
}

func TestWebhookSignatureWrongSecretRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature("wrong-secret", sig, tsHeader, body, VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid with wrong secret")
	}
	if out.Reason != VerifyReasonSignatureMismatch {
		t.Fatalf("expected signature_mismatch, got %s", out.Reason)
	}
}

func TestWebhookSignatureStaleTimestampRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix() - 10000
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature(secret, sig, tsHeader, body, VerifyWebhookOptions{
		NowSeconds: time.Now().Unix(),
	})
	if out.Valid {
		t.Fatal("expected invalid with stale timestamp")
	}
	if out.Reason != VerifyReasonTimestampExpired {
		t.Fatalf("expected timestamp_expired, got %s", out.Reason)
	}
}

func TestWebhookMalformedSignatureRejected(t *testing.T) {
	out := VerifyWebhookSignature("test-secret", "not-a-v1-header", "1700000000", []byte("{}"), VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid for malformed sig")
	}
	if out.Reason != VerifyReasonMalformedSigHeader {
		t.Fatalf("expected malformed_signature_header, got %s", out.Reason)
	}
}

func TestWebhookTamperedBodyRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	// Caller tampers with the body but reuses the signature.
	tampered := []byte(`{"runId":"r2"}`)
	out := VerifyWebhookSignature(secret, sig, tsHeader, tampered, VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid for tampered body")
	}
	if out.Reason != VerifyReasonSignatureMismatch {
		t.Fatalf("expected signature_mismatch, got %s", out.Reason)
	}
}
