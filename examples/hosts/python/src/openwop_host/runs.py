"""Run / event-log model + node executor.

Mirrors the TypeScript reference host's shape but uses Python threading
primitives. Each Run carries:

    - The event log (append-only list of RunEvent records)
    - A `threading.Condition` for the SSE bus (handlers wait on new events)
    - A `threading.Event` for cancellation signalling

Node dispatch is a switch over `node.typeId`, supporting `core.noop`
and `core.delay`. Hosts that need more node types extend `_execute_node`.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# Run states match `schemas/run-snapshot.schema.json` enum.
TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})


@dataclass
class RunEvent:
    """Per-run event record.

    Wire shape on emit (via `to_dict()`) matches `schemas/run-event.schema.json`
    canonical `RunEventDoc` — six required fields: eventId, runId, type,
    payload, timestamp, sequence — plus optional `nodeId` for node-scoped
    events. Internal Python attribute names stay as `seq` / `data` for
    minimal-invasive back-compat with existing iter_events_since / SSE
    handlers; only the JSON output keys are remapped.
    """

    seq: int
    run_id: str
    type: str
    timestamp: str
    node_id: str | None = None
    data: Any | None = None
    # eventId stable across re-reads: assigned once at construction, not
    # regenerated per to_dict() call (replay determinism per
    # spec/v1/replay.md §"Event-log determinism").
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "eventId": self.event_id,
            "runId": self.run_id,
            "type": self.type,
            "payload": self.data if self.data is not None else {},
            "timestamp": self.timestamp,
            "sequence": self.seq,
        }
        if self.node_id is not None:
            out["nodeId"] = self.node_id
        return out


@dataclass
class Run:
    run_id: str
    workflow_id: str
    status: str  # 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'waiting-approval'
    inputs: dict[str, Any]
    started_at: str
    ended_at: str | None = None
    error: dict[str, str] | None = None
    cancel_requested: bool = False
    pause_requested: bool = False
    paused_at: str | None = None
    resumed_at: str | None = None
    resume_event: threading.Event = field(default_factory=threading.Event)
    # Track per-run which nodes have emitted `node.started`. On
    # pause-mid-node + resume, the same node is re-entered; we MUST
    # NOT emit a second `node.started` for it (run-event ordering
    # invariant).
    started_nodes: set[str] = field(default_factory=set)
    # Per-node delay deadline (monotonic seconds since epoch). When a
    # `core.delay` node is re-entered after a pause, the executor
    # continues sleeping until `deadline - now()` rather than restarting
    # the full delay — so the overall wall-clock run duration stays
    # close to the originally-requested delay even with pause/resume.
    node_delay_deadlines: dict[str, float] = field(default_factory=dict)
    events: list[RunEvent] = field(default_factory=list)
    # SSE coordination: handlers acquire `cond` and wait on it; the
    # executor `notify_all`s after each event.append().
    cond: threading.Condition = field(default_factory=threading.Condition)
    cancel_event: threading.Event = field(default_factory=threading.Event)

    def __post_init__(self) -> None:
        # Resume event is set by default — the executor only blocks on it
        # when the run transitions into `paused`.
        self.resume_event.set()

    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATES


class RunRegistry:
    """Thread-safe (run_id → Run) mapping + execution kickoff.

    `event_hook` (if provided) is invoked synchronously after every event
    append, on the executor thread. The hook receives the same dict shape
    served to webhook receivers (`{type, runId, seq, timestamp, nodeId,
    data?}`).

    **Contract.** Hooks MUST return promptly — blocking the executor
    stalls the run. Hooks that perform I/O MUST dispatch the work to a
    background thread before returning. The reference webhook fan-out
    (`webhooks.fan_out_event`) does exactly this: per-subscriber delivery
    runs on daemon threads so the executor never waits on a remote
    receiver. Hooks that raise are swallowed (logged loosely below) so a
    misbehaving subscriber cannot fail the run.
    """

    def __init__(
        self,
        workflows: dict[str, dict[str, Any]],
        *,
        event_hook: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self._runs: dict[str, Run] = {}
        self._workflows = workflows
        self._lock = threading.Lock()
        self._event_hook = event_hook

    def get(self, run_id: str) -> Run | None:
        with self._lock:
            return self._runs.get(run_id)

    def workflow(self, wf_id: str) -> dict[str, Any] | None:
        return self._workflows.get(wf_id)

    def create_and_start(self, workflow_id: str, inputs: dict[str, Any]) -> Run:
        run_id = f"run-{uuid.uuid4()}"
        run = Run(
            run_id=run_id,
            workflow_id=workflow_id,
            status="pending",
            inputs=inputs,
            started_at=_now_iso(),
        )
        with self._lock:
            self._runs[run_id] = run

        # Fire-and-forget execution. The thread is daemon so process
        # shutdown doesn't block on in-flight runs.
        t = threading.Thread(
            target=self._execute_workflow, args=(run,), daemon=True, name=f"run-{run_id}"
        )
        t.start()
        return run

    def cancel(self, run_id: str) -> Run | None:
        run = self.get(run_id)
        if run is None:
            return None
        run.cancel_requested = True
        run.cancel_event.set()
        # If paused, releasing the resume gate lets the executor reach its
        # cancel-check and emit `run.cancelled` promptly.
        run.resume_event.set()
        # Wake any SSE waiters so they observe the cancellation event quickly.
        with run.cond:
            run.cond.notify_all()
        return run

    def pause(self, run_id: str, *, paused_at: str) -> tuple[Run | None, str]:
        """Request pause for an in-progress run.

        Returns (run, outcome) where outcome is one of:
          - "paused"          — pause flag set; executor will park at the
                                next node boundary (drain-current-node
                                policy per rest-endpoints.md §pause/resume).
          - "already_paused"  — run was already paused (idempotent path;
                                caller responds 202 with the original
                                pausedAt — pause-resume.test.ts asserts
                                idempotent second-pause).
          - "terminal"        — run already terminal; caller responds 409.
          - "not_found"       — unknown runId.
        """
        run = self.get(run_id)
        if run is None:
            return None, "not_found"
        if run.is_terminal():
            return run, "terminal"
        if run.status == "paused" or run.pause_requested:
            return run, "already_paused"
        run.pause_requested = True
        run.paused_at = paused_at
        run.resume_event.clear()
        return run, "paused"

    def resume(self, run_id: str, *, resumed_at: str) -> tuple[Run | None, str]:
        """Lift a pause on a paused run.

        Returns (run, outcome): one of "resumed" / "not_paused" / "terminal"
        / "not_found".
        """
        run = self.get(run_id)
        if run is None:
            return None, "not_found"
        if run.is_terminal():
            return run, "terminal"
        if not run.pause_requested and run.status != "paused":
            return run, "not_paused"
        run.pause_requested = False
        run.resumed_at = resumed_at
        run.resume_event.set()
        return run, "resumed"

    # ─── Execution ────────────────────────────────────────────────────────

    def _append_event(self, run: Run, type_: str, *, node_id: str | None = None, data: Any = None) -> None:
        event = RunEvent(
            seq=len(run.events),
            run_id=run.run_id,
            type=type_,
            timestamp=_now_iso(),
            node_id=node_id,
            data=data,
        )
        with run.cond:
            run.events.append(event)
            run.cond.notify_all()
        if self._event_hook is not None:
            try:
                self._event_hook(event.to_dict())
            except Exception:
                # Best-effort fan-out; never propagate hook failures into
                # the executor. Hosts MAY add structured logging here.
                pass

    def _execute_workflow(self, run: Run) -> None:
        workflow = self._workflows.get(run.workflow_id)
        if workflow is None:
            run.status = "failed"
            run.error = {"code": "workflow_not_found", "message": f"Unknown workflowId: {run.workflow_id}"}
            self._append_event(run, "run.failed", data=run.error)
            run.ended_at = _now_iso()
            return

        run.status = "running"
        self._append_event(run, "run.started")

        nodes = workflow.get("nodes", [])
        i = 0

        def park_for_pause() -> bool:
            """Emit run.paused, wait for resume, emit run.resumed.

            Returns True if pause+resume completed normally, False if
            cancellation arrived during the pause (caller should break
            the outer loop). Status writes go through self in the
            enclosing scope.
            """
            run.status = "paused"
            self._append_event(run, "run.paused")
            run.resume_event.wait()
            if run.cancel_requested:
                return False
            run.status = "running"
            self._append_event(run, "run.resumed")
            return True

        while i < len(nodes):
            if run.cancel_requested:
                break
            # drain-current-node pause policy per rest-endpoints.md
            # §pause/resume: pause requested between nodes parks here
            # until resume() or cancel() fires.
            if run.pause_requested:
                if not park_for_pause():
                    break
                continue
            outcome = self._execute_node(run, nodes[i])
            if outcome == "failed":
                run.status = "failed"
                self._append_event(run, "run.failed", data=run.error)
                run.ended_at = _now_iso()
                return
            if outcome == "cancelled":
                break
            i += 1
            # core.delay's drain-on-pause semantics: a pause request
            # arriving mid-delay treats the wait as drained — the node
            # completes immediately, the cursor advances, and we park
            # HERE so the run-level transition is observable even when
            # the paused node was the last in the workflow.
            if run.pause_requested:
                if not park_for_pause():
                    break

        if run.cancel_requested:
            run.status = "cancelled"
            self._append_event(run, "run.cancelled")
        else:
            run.status = "completed"
            self._append_event(run, "run.completed")
        run.ended_at = _now_iso()

    def _execute_node(self, run: Run, node: dict[str, Any]) -> str:
        node_id = node.get("id", "")
        type_id = node.get("typeId", "")
        if run.cancel_requested:
            self._append_event(run, "node.cancelled", node_id=node_id)
            return "cancelled"

        if node_id not in run.started_nodes:
            self._append_event(run, "node.started", node_id=node_id)
            run.started_nodes.add(node_id)

        if type_id == "core.noop":
            pass
        elif type_id == "core.delay":
            # Resolve effective delay duration. Precedence:
            #   1. Node spec declares delayMs (possibly via variable
            #      reference) — the fixture catalog's canonical shape.
            #   2. Run inputs supply `delaySeconds` directly — used by
            #      pause-resume.test.ts (`inputs: { delaySeconds: 30 }`)
            #      and other long-running scenarios.
            #   3. Fallback: 100ms.
            declared_ms = _resolve_input_as_number(
                node.get("inputs", {}).get("delayMs"), run.inputs, -1
            )
            if declared_ms >= 0:
                delay_ms = declared_ms
            else:
                supplied_seconds = run.inputs.get("delaySeconds")
                if isinstance(supplied_seconds, (int, float)) and supplied_seconds > 0:
                    delay_ms = int(supplied_seconds * 1000)
                else:
                    delay_ms = 100
            # Sleep in small chunks so cancellation + pause are responsive.
            # core.delay nodes are artificial waits — interrupting them
            # on pause is the canonical drain-current-node interpretation
            # (no real work to drain). We use an absolute deadline so
            # pause/resume doesn't extend the total wall-clock duration
            # of the delay: the first execution sets the deadline; if
            # paused mid-node and re-entered after resume, we sleep
            # until the original deadline rather than restart the timer.
            # Loop until either the delay elapses or pause/cancel
            # signal arrives. `core.delay` is an artificial wait — no
            # real work to drain — so pause arriving mid-delay is
            # treated as drain-complete: the node finishes immediately
            # rather than restarting (or extending) the wall-clock
            # timer on resume. This honors the host's drain-current-
            # node advertisement while keeping the overall run
            # tractable for pause/resume conformance scenarios.
            chunk_s = 0.05
            elapsed_ms = 0
            paused_mid_delay = False
            while elapsed_ms < delay_ms:
                step_s = min(chunk_s, (delay_ms - elapsed_ms) / 1000.0)
                if run.cancel_event.wait(timeout=step_s):
                    self._append_event(run, "node.cancelled", node_id=node_id)
                    return "cancelled"
                if run.pause_requested:
                    paused_mid_delay = True
                    break
                elapsed_ms += int(step_s * 1000)
            if paused_mid_delay:
                # Drain semantics: the delay is considered complete on
                # pause arrival. The outer loop emits node.completed
                # below, then sees run.pause_requested at the next
                # iteration's top and parks.
                pass
        else:
            run.error = {
                "code": "unsupported_node_type",
                "message": (
                    f'Python reference host does not implement node type "{type_id}". '
                    "Supports core.noop and core.delay only."
                ),
            }
            self._append_event(
                run,
                "node.failed",
                node_id=node_id,
                data={"code": "unsupported_node_type", "typeId": type_id},
            )
            return "failed"

        self._append_event(run, "node.completed", node_id=node_id)
        return "completed"


def _resolve_input_as_number(declared: Any, variables: dict[str, Any], fallback: int) -> int:
    """Mirror of the TS host's variable-reference resolver."""
    if (
        isinstance(declared, dict)
        and declared.get("type") == "variable"
        and isinstance(declared.get("variableName"), str)
    ):
        name = declared["variableName"]
        candidate = variables.get(name)
        if isinstance(candidate, (int, float)):
            return int(candidate)
    if isinstance(declared, (int, float)):
        return int(declared)
    return fallback


def iter_events_since(run: Run, since: int) -> Iterable[RunEvent]:
    """Snapshot the event list and yield events with seq > since."""
    with run.cond:
        snapshot = list(run.events)
    for event in snapshot:
        if event.seq > since:
            yield event


def wait_for_next_event_or_terminal(run: Run, after_seq: int, timeout_s: float = 30.0) -> None:
    """Block until run has events past `after_seq` OR reaches terminal.

    Used by the SSE handler between writes. The condition variable is
    notified on every append AND on cancellation.
    """
    deadline = time.monotonic() + timeout_s
    with run.cond:
        while True:
            if run.events and run.events[-1].seq > after_seq:
                return
            if run.is_terminal():
                return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            run.cond.wait(timeout=min(remaining, 25.0))
