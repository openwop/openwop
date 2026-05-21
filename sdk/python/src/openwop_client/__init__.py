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
from .events import (
    AgentDecidedPayload,
    AgentHandoffPayload,
    AgentReasonedPayload,
    AgentReasoningDeltaPayload,
    AgentToolCalledPayload,
    AgentToolReturnedPayload,
    ReasoningVerbosity,
    agent_decided_payload,
    agent_handoff_payload,
    agent_reasoned_payload,
    agent_reasoning_delta_payload,
    agent_tool_called_payload,
    agent_tool_returned_payload,
    is_agent_decided,
    is_agent_handoff,
    is_agent_reasoned,
    is_agent_reasoning_delta,
    is_agent_tool_called,
    is_agent_tool_returned,
)
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

__version__ = "1.1.3"

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
    # Typed agent.* event helpers (RFC 0002 + RFC 0024)
    "ReasoningVerbosity",
    "AgentReasonedPayload",
    "AgentReasoningDeltaPayload",
    "AgentToolCalledPayload",
    "AgentToolReturnedPayload",
    "AgentHandoffPayload",
    "AgentDecidedPayload",
    "is_agent_reasoned",
    "is_agent_reasoning_delta",
    "is_agent_tool_called",
    "is_agent_tool_returned",
    "is_agent_handoff",
    "is_agent_decided",
    "agent_reasoned_payload",
    "agent_reasoning_delta_payload",
    "agent_tool_called_payload",
    "agent_tool_returned_payload",
    "agent_handoff_payload",
    "agent_decided_payload",
    # Webhook helpers (SDK-3, 2026-05-15)
    "verify_webhook_signature",
    "sign_webhook_delivery",
    "VerifyValid",
    "VerifyInvalid",
    "DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS",
    # Registry-read helpers (SDK-5, 2026-05-15)
    "RegistryClient",
    "RegistryDiscovery",
    "RegistryIndex",
    "RegistryIndexEntry",
    "RegistryPackMetadata",
    "RegistryVersionManifest",
    "__version__",
]

from .webhook_helpers import (
    DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS,
    VerifyInvalid,
    VerifyValid,
    sign_webhook_delivery,
    verify_webhook_signature,
)

from .registry_helpers import (
    RegistryClient,
    RegistryDiscovery,
    RegistryIndex,
    RegistryIndexEntry,
    RegistryPackMetadata,
    RegistryVersionManifest,
)
