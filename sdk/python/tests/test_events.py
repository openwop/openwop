"""Typed agent.* event helper tests (RFC 0002 + RFC 0024).

Parallel to `sdk/typescript/src/__tests__/event-helpers.test.ts`:
predicate true/positive matrix, typed extractor returns `None` on
miss, schema-mirror sanity check that the TypedDict required fields
match the canonical JSON schema $defs.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from openwop_client import (
    RunEventDoc,
    agent_decided_payload,
    agent_handoff_payload,
    agent_reasoned_payload,
    agent_reasoning_delta_payload,
    agent_tool_called_payload,
    is_agent_decided,
    is_agent_handoff,
    is_agent_reasoned,
    is_agent_reasoning_delta,
    is_agent_tool_called,
    is_agent_tool_returned,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "schemas"
    / "run-event-payloads.schema.json"
)


def _ev(event_type: str, payload: object) -> RunEventDoc:
    return RunEventDoc(
        eventId="evt-x",
        runId="run-x",
        type=event_type,
        payload=payload,
        timestamp="2026-05-19T00:00:00Z",
        sequence=0,
    )


class AgentEventTypeGuardsTrue(unittest.TestCase):
    def test_is_agent_reasoned_matches_well_formed(self) -> None:
        ev = _ev("agent.reasoned", {"agentId": "asst-1", "reasoning": "thinking…", "verbosity": "full"})
        self.assertTrue(is_agent_reasoned(ev))
        payload = agent_reasoned_payload(ev)
        assert payload is not None
        self.assertEqual(payload["reasoning"], "thinking…")
        self.assertEqual(payload["verbosity"], "full")

    def test_is_agent_reasoning_delta_matches_well_formed(self) -> None:
        ev = _ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "step 1", "sequence": 0})
        self.assertTrue(is_agent_reasoning_delta(ev))
        payload = agent_reasoning_delta_payload(ev)
        assert payload is not None
        self.assertEqual(payload["delta"], "step 1")
        self.assertEqual(payload["sequence"], 0)

    def test_is_agent_tool_called_matches_well_formed(self) -> None:
        ev = _ev("agent.toolCalled", {"agentId": "asst-1", "toolName": "echo", "callId": "c-1", "inputs": {"x": 1}})
        self.assertTrue(is_agent_tool_called(ev))

    def test_is_agent_tool_returned_matches_well_formed(self) -> None:
        ev = _ev("agent.toolReturned", {"agentId": "asst-1", "toolName": "echo", "callId": "c-1", "outcome": {"x": 1}})
        self.assertTrue(is_agent_tool_returned(ev))

    def test_is_agent_handoff_matches_distinct_field_names(self) -> None:
        # Note: agent.handoff uses fromAgentId / toAgentId, NOT a single agentId.
        ev = _ev("agent.handoff", {"fromAgentId": "asst-1", "toAgentId": "researcher", "reason": "specialist"})
        self.assertTrue(is_agent_handoff(ev))
        payload = agent_handoff_payload(ev)
        assert payload is not None
        self.assertEqual(payload["fromAgentId"], "asst-1")
        self.assertEqual(payload["toAgentId"], "researcher")

    def test_is_agent_decided_matches_well_formed(self) -> None:
        ev = _ev("agent.decided", {"agentId": "asst-1", "decision": {"next": "done"}, "confidence": 0.95})
        self.assertTrue(is_agent_decided(ev))


class AgentEventTypeGuardsFalse(unittest.TestCase):
    def test_wrong_type_discriminator_rejected(self) -> None:
        ev = _ev("node.message", {"agentId": "asst-1", "reasoning": "x"})
        self.assertFalse(is_agent_reasoned(ev))
        self.assertFalse(is_agent_reasoning_delta(ev))

    def test_missing_required_fields_rejected(self) -> None:
        # agent.reasoned without `reasoning`
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", {"agentId": "asst-1"})))
        # agent.reasoning.delta without `delta`
        self.assertFalse(is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "sequence": 0})))
        # agent.reasoning.delta with negative sequence
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": -1}))
        )
        # agent.reasoning.delta with float sequence (must be int)
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": 1.5}))
        )
        # agent.reasoning.delta with bool sequence (bool subclasses int in Python — must reject)
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": True}))
        )
        # agent.handoff with wrong field names (single agentId)
        self.assertFalse(is_agent_handoff(_ev("agent.handoff", {"agentId": "asst-1", "toAgentId": "x"})))
        # agent.toolReturned without callId
        self.assertFalse(is_agent_tool_returned(_ev("agent.toolReturned", {"agentId": "asst-1", "toolName": "t"})))

    def test_non_dict_payload_rejected(self) -> None:
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", None)))
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", "string-payload")))
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", 42)))

    def test_unknown_event_type_returns_false_not_exception(self) -> None:
        # Forward-compat per COMPATIBILITY.md §2.1 — unknown types must
        # be tolerated, not crash the consumer.
        ev = _ev("vendor.future.event", {"stuff": "x"})
        self.assertFalse(is_agent_reasoned(ev))
        self.assertFalse(is_agent_reasoning_delta(ev))
        self.assertFalse(is_agent_tool_called(ev))
        self.assertFalse(is_agent_tool_returned(ev))
        self.assertFalse(is_agent_handoff(ev))
        self.assertFalse(is_agent_decided(ev))


class AgentEventExtractorsReturnNone(unittest.TestCase):
    def test_extractor_returns_none_on_miss(self) -> None:
        ev = _ev("agent.reasoned", {"agentId": "asst-1"})  # missing reasoning
        self.assertIsNone(agent_reasoned_payload(ev))

    def test_extractor_returns_payload_on_match(self) -> None:
        ev = _ev("agent.toolCalled", {
            "agentId": "asst-1",
            "toolName": "echo",
            "callId": "c-1",
        })
        payload = agent_tool_called_payload(ev)
        assert payload is not None
        self.assertEqual(payload["toolName"], "echo")

    def test_decided_extractor_works(self) -> None:
        ev = _ev("agent.decided", {"agentId": "asst-1", "decision": "x"})
        payload = agent_decided_payload(ev)
        assert payload is not None
        self.assertEqual(payload["decision"], "x")


class AgentEventSchemaMirrorSanity(unittest.TestCase):
    """Catch drift between TypedDict declarations and the canonical
    schema $defs. If either side adds a required field without the
    other, this test fails."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def _check(self, def_name: str, expected_required: list[str]) -> None:
        defs = self.schema["$defs"]
        self.assertIn(def_name, defs, f"$def.{def_name} present")
        self.assertEqual(sorted(defs[def_name].get("required", [])), sorted(expected_required))

    def test_agent_reasoned_required_matches(self) -> None:
        self._check("agentReasoned", ["agentId", "reasoning"])

    def test_agent_reasoning_delta_required_matches(self) -> None:
        self._check("agentReasoningDelta", ["agentId", "delta", "sequence"])

    def test_agent_tool_called_required_matches(self) -> None:
        self._check("agentToolCalled", ["agentId", "toolName", "callId"])

    def test_agent_tool_returned_required_matches(self) -> None:
        self._check("agentToolReturned", ["agentId", "toolName", "callId"])

    def test_agent_handoff_required_matches(self) -> None:
        self._check("agentHandoff", ["fromAgentId", "toAgentId"])

    def test_agent_decided_required_matches(self) -> None:
        self._check("agentDecided", ["agentId", "decision"])


if __name__ == "__main__":
    unittest.main()
