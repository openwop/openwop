"""
openwop-client — Python reference SDK for OpenWOP-compliant servers.

Public surface:
    OpenwopClient          — sync HTTP client
    WopError           — typed exception (carries traceparent + traceId)
    RunStatus, StreamMode  — string-typed enums
    All request/response dataclasses

See README.md for usage.
"""

from .client import OpenwopClient
from .errors import WopError
from .sse import stream_events
from .types import (
    Capabilities,
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    ErrorEnvelope,
    ForkRunRequest,
    ForkRunResponse,
    HTTP_ERROR_CODES,
    InterruptByTokenInspection,
    PollEventsResponse,
    ResolveInterruptRequest,
    ResolveInterruptResponse,
    RunConfigurable,
    RunEventDoc,
    RunSnapshot,
    RunStatus,
    StreamMode,
    is_http_error_code,
)

__version__ = "1.0.0"

__all__ = [
    "OpenwopClient",
    "WopError",
    "stream_events",
    # Types
    "Capabilities",
    "CancelRunRequest",
    "CancelRunResponse",
    "CreateRunRequest",
    "CreateRunResponse",
    "ErrorEnvelope",
    "ForkRunRequest",
    "ForkRunResponse",
    "HTTP_ERROR_CODES",
    "InterruptByTokenInspection",
    "PollEventsResponse",
    "ResolveInterruptRequest",
    "ResolveInterruptResponse",
    "RunConfigurable",
    "RunEventDoc",
    "RunSnapshot",
    "RunStatus",
    "StreamMode",
    "is_http_error_code",
    "__version__",
]
