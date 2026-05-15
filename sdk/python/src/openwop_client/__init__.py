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
    AuditVerifyAnomaly,
    AuditVerifyCheckpoint,
    AuditVerifyResult,
    BulkCancelRunResult,
    BulkCancelRunsRequest,
    BulkCancelRunsResponse,
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
    PauseRunRequest,
    PauseRunResponse,
    PollEventsResponse,
    RegisterWebhookRequest,
    RegisterWebhookResponse,
    ResolveInterruptRequest,
    ResolveInterruptResponse,
    ResumeRunRequest,
    ResumeRunResponse,
    RunConfigurable,
    RunEventDoc,
    RunSnapshot,
    RunStatus,
    StreamMode,
    is_http_error_code,
)

__version__ = "1.1.1"

__all__ = [
    "OpenwopClient",
    "WopError",
    "stream_events",
    # Types
    "AuditVerifyAnomaly",
    "AuditVerifyCheckpoint",
    "AuditVerifyResult",
    "BulkCancelRunResult",
    "BulkCancelRunsRequest",
    "BulkCancelRunsResponse",
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
    "PauseRunRequest",
    "PauseRunResponse",
    "PollEventsResponse",
    "RegisterWebhookRequest",
    "RegisterWebhookResponse",
    "ResolveInterruptRequest",
    "ResolveInterruptResponse",
    "ResumeRunRequest",
    "ResumeRunResponse",
    "RunConfigurable",
    "RunEventDoc",
    "RunSnapshot",
    "RunStatus",
    "StreamMode",
    "is_http_error_code",
    # Webhook helpers (SDK-3, 2026-05-15)
    "verify_webhook_signature",
    "sign_webhook_delivery",
    "VerifyValid",
    "VerifyInvalid",
    "DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS",
    "__version__",
]

from .webhook_helpers import (
    DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS,
    VerifyInvalid,
    VerifyValid,
    sign_webhook_delivery,
    verify_webhook_signature,
)
