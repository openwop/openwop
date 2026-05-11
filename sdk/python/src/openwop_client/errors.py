"""
WopError — typed exception thrown on non-2xx responses. Carries the
parsed error envelope plus W3C `traceparent` per
`observability.md` §Trace context propagation.
"""

from __future__ import annotations

import re

from .types import ErrorEnvelope

_TRACEPARENT_RE = re.compile(r"^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$", re.IGNORECASE)


def _extract_trace_id(traceparent: str | None) -> str | None:
    """Pull the 32-hex trace ID out of a W3C traceparent header.

    Returns None for None/malformed inputs. Never raises — errors during
    error construction are particularly miserable to debug.
    """
    if not traceparent:
        return None
    m = _TRACEPARENT_RE.match(traceparent)
    return m.group(1) if m else None


class WopError(Exception):
    """Raised when the openwop server returns a non-2xx response.

    Attributes:
        status:       HTTP status code.
        envelope:     Parsed `{error, message, details?}` body, or None.
        raw_text:     Raw response body (useful when JSON decode failed).
        traceparent:  W3C traceparent header from the response, if any.
        trace_id:     32-hex trace ID extracted from traceparent, or None.

    Per observability.md: "Clients SHOULD display the trace ID in error
    messages so operators can search backend traces." `str(e)` includes
    `(trace=<id>)` suffix when traceparent was present.
    """

    def __init__(
        self,
        status: int,
        raw_text: str,
        envelope: ErrorEnvelope | None,
        traceparent: str | None = None,
    ) -> None:
        self.status = status
        self.envelope = envelope
        self.raw_text = raw_text
        self.traceparent = traceparent
        self.trace_id = _extract_trace_id(traceparent)

        base_message = (
            envelope.message if envelope is not None else f"openwop request failed: HTTP {status}"
        )
        message = (
            f"{base_message} (trace={self.trace_id})" if self.trace_id else base_message
        )
        super().__init__(message)
