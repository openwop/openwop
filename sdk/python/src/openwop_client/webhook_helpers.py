"""Webhook delivery-verification helpers per ``spec/v1/webhooks.md``.

Receivers MUST verify both the HMAC AND the timestamp freshness before
accepting a delivery — verifying HMAC alone leaves the receiver open to
replay attacks.

The canonical signing recipe::

    hmac = HMAC-SHA256(secret, f"{timestamp}.{rawBody}")
    header openwop-Webhook-Signature: v1=<hmac-hex>
    header openwop-Webhook-Timestamp: <unix-seconds>

Verification:

    1. Parse the ``v1=<hex>`` value from the signature header.
    2. Recompute ``expected = HMAC-SHA256(secret, f"{timestamp}.{rawBody}")``.
    3. Compare using **constant-time** equality (``hmac.compare_digest``).
    4. Reject when ``|now - timestamp|`` exceeds the freshness window
       (default 5 minutes per ``webhooks.md`` §"Replay attack resistance").

The HMAC is computed over UTF-8 bytes of the raw body; receivers MUST
pass the exact bytes the host POSTed, NOT a re-serialized parsed
representation.
"""

from __future__ import annotations

import hmac
import re
import time
from dataclasses import dataclass
from typing import Literal, Union

DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300

VerifyReason = Literal[
    "signature_mismatch",
    "timestamp_expired",
    "timestamp_too_far_in_future",
    "malformed_signature_header",
    "malformed_timestamp_header",
]


@dataclass(frozen=True)
class VerifyValid:
    valid: Literal[True] = True


@dataclass(frozen=True)
class VerifyInvalid:
    reason: VerifyReason
    valid: Literal[False] = False


VerifyWebhookOutcome = Union[VerifyValid, VerifyInvalid]


_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")


def verify_webhook_signature(
    secret: str,
    signature_header: str,
    timestamp_header: str,
    raw_body: bytes | str,
    *,
    freshness_window_seconds: int = DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS,
    now_seconds: int | None = None,
) -> VerifyWebhookOutcome:
    """Verify a webhook delivery.

    Returns :class:`VerifyValid` on success, :class:`VerifyInvalid`
    otherwise with a ``reason`` field for diagnostics.
    """

    if not signature_header.startswith("v1="):
        return VerifyInvalid(reason="malformed_signature_header")
    provided_hex = signature_header[3:]
    if not _HEX_RE.fullmatch(provided_hex):
        return VerifyInvalid(reason="malformed_signature_header")

    try:
        timestamp = int(timestamp_header)
    except (ValueError, TypeError):
        return VerifyInvalid(reason="malformed_timestamp_header")
    if timestamp <= 0:
        return VerifyInvalid(reason="malformed_timestamp_header")

    if freshness_window_seconds > 0:
        now = now_seconds if now_seconds is not None else int(time.time())
        delta = now - timestamp
        if delta > freshness_window_seconds:
            return VerifyInvalid(reason="timestamp_expired")
        if delta < -freshness_window_seconds:
            return VerifyInvalid(reason="timestamp_too_far_in_future")

    body_bytes = raw_body if isinstance(raw_body, bytes) else raw_body.encode("utf-8")
    signed = f"{timestamp}.".encode("utf-8") + body_bytes
    expected_hex = hmac.new(secret.encode("utf-8"), signed, "sha256").hexdigest()

    if not hmac.compare_digest(provided_hex.lower(), expected_hex.lower()):
        return VerifyInvalid(reason="signature_mismatch")
    return VerifyValid()


def sign_webhook_delivery(
    secret: str,
    timestamp: int,
    raw_body: bytes | str,
) -> tuple[str, str]:
    """Compute the canonical webhook signature for a payload.

    Returns ``(signature_header, timestamp_header)``. Useful when
    implementing a host or generating test fixtures.
    """

    body_bytes = raw_body if isinstance(raw_body, bytes) else raw_body.encode("utf-8")
    signed = f"{timestamp}.".encode("utf-8") + body_bytes
    hex_digest = hmac.new(secret.encode("utf-8"), signed, "sha256").hexdigest()
    return f"v1={hex_digest}", str(timestamp)
