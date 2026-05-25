"""Typed helpers for the `agent.*` event family (RFC 0002 §B + RFC 0024).

The Python SDK keeps `RunEventDoc.payload` as `Any` for forward-compat
per `COMPATIBILITY.md §2.1`. This module adds two layers on top:

  1. **TypedDict payload classes** — structural shape descriptions for
     each `agent.*` event payload (mirrors
     `schemas/run-event-payloads.schema.json` $defs). TypedDict is
     a static-only construct (the runtime sees a plain dict), so
     pair these with the predicate functions below for runtime checks.

  2. **Predicate functions** — `is_agent_reasoning_delta(ev)` etc.
     Return `True` when the event's `type` matches AND its payload
     carries the required wire-contract keys with the right primitive
     types. Use the predicate before treating an event as typed.

  3. **Typed extractors** — `agent_reasoning_delta_payload(ev)` returns
     the payload cast to the TypedDict on a match, or `None` on a miss.
     Convenience over the bare predicate + manual extraction.

Stdlib-only. No third-party deps.

See:
  - schemas/run-event-payloads.schema.json
  - RFCS/0002-agent-identity-and-reasoning-events.md
  - RFCS/0024-agent-reasoning-streaming.md
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from .types import ErrorEnvelope, RunEventDoc

ReasoningVerbosity = Literal["off", "summary", "full"]
"""Per-event verbosity mirror of `capabilities.md` §`agents.reasoning`."""


# ── TypedDict payload shapes (one per agent.* $def) ─────────────────────


class AgentReasonedPayload(TypedDict, total=False):
    """`agent.reasoned` payload (RFC 0002 §B). Required: `agentId`,
    `reasoning`. Optional: `verbosity`. Per the schema's
    `additionalProperties: true` (Phase-1 multi-agent-shift carve-out),
    additional keys are tolerated — this TypedDict declares the typed
    fields without forbidding others.
    """

    agentId: str
    reasoning: str
    verbosity: ReasoningVerbosity


class AgentReasoningDeltaPayload(TypedDict, total=False):
    """`agent.reasoning.delta` payload (RFC 0024). Required: `agentId`,
    `delta`, `sequence`. Optional: `verbosity`."""

    agentId: str
    delta: str
    sequence: int
    verbosity: ReasoningVerbosity


class AgentToolCalledPayload(TypedDict, total=False):
    """`agent.toolCalled` payload (RFC 0002 §B). Required: `agentId`,
    `toolName`, `callId`. Optional: `inputs` (host-specific shape)."""

    agentId: str
    toolName: str
    callId: str
    inputs: Any


class AgentToolReturnedPayload(TypedDict, total=False):
    """`agent.toolReturned` payload (RFC 0002 §B). Required: `agentId`,
    `toolName`, `callId`. Mutually-exclusive optionals: `outcome` (on
    success) OR `error` (on failure)."""

    agentId: str
    toolName: str
    callId: str
    outcome: Any
    error: ErrorEnvelope


class AgentHandoffPayload(TypedDict, total=False):
    """`agent.handoff` payload (RFC 0002 §B). Required: `fromAgentId`,
    `toAgentId`. Note distinct field names — NOT a single `agentId`."""

    fromAgentId: str
    toAgentId: str
    reason: str


class AgentDecidedPayload(TypedDict, total=False):
    """`agent.decided` payload (RFC 0002 §B). Required: `agentId`,
    `decision` (host-specific shape). Optional: `confidence` in [0, 1]
    — values below the resolved threshold drive the low-confidence
    escalation contract."""

    agentId: str
    decision: Any
    confidence: float


class MemoryWrittenPayload(TypedDict, total=False):
    """`memory.written` payload (RFC 0057). Required: `memoryRef`,
    `memoryId`. Optional: `nodeId`, `agentId`, `tags`. Content-free —
    identifiers + non-secret tags only; never the entry content."""

    memoryRef: str
    memoryId: str
    nodeId: str
    agentId: str
    tags: list[str]


# ── Predicates ──────────────────────────────────────────────────────────


def _payload_has_str(payload: Any, field: str) -> bool:
    """Internal: payload is a dict-like with `field` set to a string."""
    return isinstance(payload, dict) and isinstance(payload.get(field), str)


def is_agent_reasoned(ev: RunEventDoc) -> bool:
    """`agent.reasoned` discriminator + required-field check."""
    return (
        ev.type == "agent.reasoned"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "reasoning")
    )


def is_agent_reasoning_delta(ev: RunEventDoc) -> bool:
    """`agent.reasoning.delta` discriminator + required-field check
    (RFC 0024). Verifies `sequence` is a non-negative integer."""
    if ev.type != "agent.reasoning.delta":
        return False
    if not _payload_has_str(ev.payload, "agentId"):
        return False
    if not _payload_has_str(ev.payload, "delta"):
        return False
    seq = ev.payload.get("sequence") if isinstance(ev.payload, dict) else None
    return isinstance(seq, int) and not isinstance(seq, bool) and seq >= 0


def is_agent_tool_called(ev: RunEventDoc) -> bool:
    """`agent.toolCalled` discriminator + required-field check."""
    return (
        ev.type == "agent.toolCalled"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "toolName")
        and _payload_has_str(ev.payload, "callId")
    )


def is_agent_tool_returned(ev: RunEventDoc) -> bool:
    """`agent.toolReturned` discriminator + required-field check."""
    return (
        ev.type == "agent.toolReturned"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "toolName")
        and _payload_has_str(ev.payload, "callId")
    )


def is_agent_handoff(ev: RunEventDoc) -> bool:
    """`agent.handoff` discriminator + required-field check. Note the
    distinct field names — `fromAgentId` / `toAgentId`."""
    return (
        ev.type == "agent.handoff"
        and _payload_has_str(ev.payload, "fromAgentId")
        and _payload_has_str(ev.payload, "toAgentId")
    )


def is_agent_decided(ev: RunEventDoc) -> bool:
    """`agent.decided` discriminator + required-field check. `decision`
    is `Any` per the schema; the predicate only confirms its presence."""
    if ev.type != "agent.decided":
        return False
    if not _payload_has_str(ev.payload, "agentId"):
        return False
    return isinstance(ev.payload, dict) and "decision" in ev.payload


def is_memory_written(ev: RunEventDoc) -> bool:
    """`memory.written` discriminator + required-identifier check (RFC 0057)."""
    return (
        ev.type == "memory.written"
        and _payload_has_str(ev.payload, "memoryRef")
        and _payload_has_str(ev.payload, "memoryId")
    )


# ── Typed extractors ────────────────────────────────────────────────────


def agent_reasoned_payload(ev: RunEventDoc) -> AgentReasonedPayload | None:
    """Return the payload as `AgentReasonedPayload` if the event matches,
    else `None`. Use this when you want a single line:
    `if (p := agent_reasoned_payload(ev)) is not None: ...`."""
    return ev.payload if is_agent_reasoned(ev) else None


def agent_reasoning_delta_payload(ev: RunEventDoc) -> AgentReasoningDeltaPayload | None:
    """Return the payload as `AgentReasoningDeltaPayload` if the event
    matches, else `None`."""
    return ev.payload if is_agent_reasoning_delta(ev) else None


def agent_tool_called_payload(ev: RunEventDoc) -> AgentToolCalledPayload | None:
    """Return the payload as `AgentToolCalledPayload` if matched, else `None`."""
    return ev.payload if is_agent_tool_called(ev) else None


def agent_tool_returned_payload(ev: RunEventDoc) -> AgentToolReturnedPayload | None:
    """Return the payload as `AgentToolReturnedPayload` if matched, else `None`."""
    return ev.payload if is_agent_tool_returned(ev) else None


def agent_handoff_payload(ev: RunEventDoc) -> AgentHandoffPayload | None:
    """Return the payload as `AgentHandoffPayload` if matched, else `None`."""
    return ev.payload if is_agent_handoff(ev) else None


def agent_decided_payload(ev: RunEventDoc) -> AgentDecidedPayload | None:
    """Return the payload as `AgentDecidedPayload` if matched, else `None`."""
    return ev.payload if is_agent_decided(ev) else None


def memory_written_payload(ev: RunEventDoc) -> MemoryWrittenPayload | None:
    """Return the payload as `MemoryWrittenPayload` if matched, else `None`."""
    return ev.payload if is_memory_written(ev) else None


__all__ = [
    "ReasoningVerbosity",
    "AgentReasonedPayload",
    "AgentReasoningDeltaPayload",
    "AgentToolCalledPayload",
    "AgentToolReturnedPayload",
    "AgentHandoffPayload",
    "AgentDecidedPayload",
    "MemoryWrittenPayload",
    "is_agent_reasoned",
    "is_agent_reasoning_delta",
    "is_agent_tool_called",
    "is_agent_tool_returned",
    "is_agent_handoff",
    "is_agent_decided",
    "is_memory_written",
    "memory_written_payload",
    "agent_reasoned_payload",
    "agent_reasoning_delta_payload",
    "agent_tool_called_payload",
    "agent_tool_returned_payload",
    "agent_handoff_payload",
    "agent_decided_payload",
]
