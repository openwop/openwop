"""Webhook subscriptions + signed delivery (stdlib-only port).

Mirrors `examples/hosts/sqlite/src/webhooks.ts`. Implements the webhook
surface from `spec/v1/webhooks.md`:

    - POST   /v1/webhooks          register
    - DELETE /v1/webhooks/{id}     unregister
    - Best-effort HTTP POST delivery on every run event
    - HMAC-SHA256 signing over `{timestamp}.{rawBody}` with headers
        X-openwop-Signature
        X-openwop-Signature-Timestamp
        X-openwop-Signature-Algorithm: v1
        X-openwop-Subscription-Id

Reference-only properties:

    - In-process delivery (no queue); errors swallowed.
    - No retry / backoff / circuit breaker.
    - Per-subscription secret generated when caller omits one; returned
      exactly once on register.
    - SSRF guard rejects loopback / RFC1918 / link-local / unique-local
      / `*.local|*.internal|*.cluster|localhost`. Bypass with
      `OPENWOP_WEBHOOK_ALLOW_PRIVATE=true` for local-receiver tests.

All stdlib: `hmac`, `hashlib`, `secrets`, `ipaddress`, `urllib.request`,
`threading`.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse


class WebhookUrlRejected(Exception):
    """SSRF-guard rejection of a webhook URL."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _url_allowed(raw_url: str) -> tuple[bool, str]:
    if os.environ.get("OPENWOP_WEBHOOK_ALLOW_PRIVATE") == "true":
        return True, ""
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return False, "webhook url is not a parseable URL"
    if parsed.scheme not in ("http", "https"):
        return False, f'webhook url protocol "{parsed.scheme}" is not http(s)'
    host = (parsed.hostname or "").lower()
    if not host:
        return False, "webhook url is missing a hostname"
    if host == "localhost" or host.endswith(".localhost"):
        return False, "webhook url points at localhost (SSRF guard)"
    if host.endswith(".local") or host.endswith(".internal") or host.endswith(".cluster"):
        return False, f'webhook url hostname "{host}" looks internal (SSRF guard)'

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # Not an IP literal — we do NOT resolve DNS here (documented
        # limitation; mirrors the TS reference host).
        return True, ""

    if ip.is_loopback:
        return False, "loopback address (SSRF guard)"
    if ip.is_private:
        return False, "RFC1918 / unique-local address (SSRF guard)"
    if ip.is_link_local:
        return False, "link-local address (AWS metadata range) (SSRF guard)"
    if ip.is_unspecified:
        return False, "0.0.0.0/:: (SSRF guard)"
    return True, ""


@dataclass
class WebhookSubscription:
    subscription_id: str
    url: str
    secret: str
    event_types: list[str]  # empty = subscribe to all events
    created_at: str

    def to_public_dict(self) -> dict[str, Any]:
        """Shape returned on POST /v1/webhooks (secret included exactly once)."""
        return {
            "subscriptionId": self.subscription_id,
            "url": self.url,
            "secret": self.secret,
            "eventTypes": list(self.event_types),
            "createdAt": self.created_at,
        }


@dataclass
class WebhookRegistry:
    """Thread-safe in-memory webhook-subscription store."""

    _lock: threading.Lock = field(default_factory=threading.Lock)
    _subs: dict[str, WebhookSubscription] = field(default_factory=dict)

    def register(
        self,
        url: str,
        *,
        secret: str | None = None,
        event_types: list[str] | None = None,
    ) -> WebhookSubscription:
        ok, reason = _url_allowed(url)
        if not ok:
            raise WebhookUrlRejected(reason)
        sub = WebhookSubscription(
            subscription_id=f"wh-{uuid.uuid4()}",
            url=url,
            secret=secret or secrets.token_urlsafe(32),
            event_types=list(event_types or []),
            created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        )
        with self._lock:
            self._subs[sub.subscription_id] = sub
        return sub

    def unregister(self, subscription_id: str) -> bool:
        with self._lock:
            return self._subs.pop(subscription_id, None) is not None

    def matches(self, event_type: str) -> list[WebhookSubscription]:
        with self._lock:
            snapshot = list(self._subs.values())
        return [s for s in snapshot if not s.event_types or event_type in s.event_types]


def sign_payload(secret: str, timestamp: str, raw_body: str) -> str:
    """HMAC-SHA256 hex digest of `{timestamp}.{rawBody}` per webhooks.md.

    The same recipe the TypeScript host emits and the conformance suite
    verifies — making cross-host signature parity mechanical.
    """
    mac = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{raw_body}".encode("utf-8"),
        hashlib.sha256,
    )
    return mac.hexdigest()


def _redact_for_fan_out(event: dict[str, Any]) -> dict[str, Any]:
    """Strip the open-ended `data` field per debug-bundle.md redaction policy.

    Receivers get the *envelope* (type, runId, seq, timestamp, nodeId)
    but NOT the open-ended `data` field which may carry interrupt
    configs, approval payloads, or BYOK credentialRefs. To fetch the
    full payload, receivers MUST use an authenticated GET /v1/runs/{id}
    or the debug-bundle endpoint.
    """
    return {k: v for k, v in event.items() if k != "data"}


def deliver(sub: WebhookSubscription, payload: dict[str, Any], *, timeout_s: float = 5.0) -> None:
    """Fire-and-forget HTTP POST. Errors are swallowed."""
    body = json.dumps(payload)
    timestamp = str(int(time.time()))
    signature = sign_payload(sub.secret, timestamp, body)
    request = urllib.request.Request(
        sub.url,
        data=body.encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-openwop-Signature": signature,
            "X-openwop-Signature-Timestamp": timestamp,
            "X-openwop-Signature-Algorithm": "v1",
            "X-openwop-Subscription-Id": sub.subscription_id,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as resp:
            resp.read()  # drain
    except (urllib.error.URLError, TimeoutError, OSError):
        # Reference-host MVP: swallow delivery failures.
        return


def fan_out_event(registry: WebhookRegistry, event: dict[str, Any]) -> None:
    """Fan out a single event to every matching subscriber in background threads."""
    subs = registry.matches(event.get("type", ""))
    if not subs:
        return
    safe = _redact_for_fan_out(event)
    for sub in subs:
        # Daemon thread so process shutdown doesn't block on outstanding
        # delivery attempts.
        t = threading.Thread(
            target=deliver,
            args=(sub, safe),
            daemon=True,
            name=f"webhook-deliver-{sub.subscription_id}",
        )
        t.start()
