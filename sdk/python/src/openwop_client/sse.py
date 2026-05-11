"""
Generator-based SSE consumer for `GET /v1/runs/{runId}/events`. Pure
stdlib — `urllib.request` for HTTP, manual line parsing for SSE.

Synchronous generator: callers iterate with `for event in stream_events(...)`.
Connection is auto-closed when the server closes the stream OR when the
caller breaks out of the loop. Bounded by an absolute timeout so CI
never hangs.

For async usage, callers can wrap this with `asyncio.to_thread(...)`.
An optional `httpx`-based async client may land in a future v1.x release.
"""

from __future__ import annotations

import json
from typing import Any, Iterator, Sequence
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .types import RunEventDoc, StreamMode


def stream_events(
    base_url: str,
    api_key: str,
    run_id: str,
    *,
    stream_mode: StreamMode | Sequence[StreamMode] | None = None,
    last_event_id: str | None = None,
    timeout_seconds: float = 30.0,
    buffer_ms: int | None = None,
) -> Iterator[RunEventDoc]:
    """Subscribe to a run's SSE event stream and yield decoded events.

    Args:
        base_url:         openwop server base URL (e.g., `https://api.example.com`).
        api_key:          Bearer-style API key.
        run_id:           Run to subscribe to.
        stream_mode:      Single mode (e.g., 'updates') OR an iterable of modes
                          for S4 mixed-mode (e.g., ('updates', 'messages')).
                          Iterables serialize to the canonical comma-separated
                          query (`?streamMode=updates,messages`).
        last_event_id:    Optional `Last-Event-ID` request header for resumption.
        timeout_seconds:  Hard upper bound on the read. Server SHOULD close on
                          terminal events; this catches misbehavior.
        buffer_ms:        S3 batching hint (0..5000). When set, the server
                          batches events for up to N ms; the SDK transparently
                          flattens batched arrays back into per-event yields,
                          so consumers see the same shape as unbuffered streams.

    Yields:
        RunEventDoc for each parseable event. Non-JSON `data:` payloads
        (keep-alive, vendor extensions) are silently skipped. Batched
        events (S3 `event: batch`) are flattened transparently.

    Raises:
        urllib.error.HTTPError: on non-2xx status.
        urllib.error.URLError:  on connection failure.
    """
    base_url = base_url.rstrip("/")
    params: dict[str, str] = {}
    if stream_mode:
        if isinstance(stream_mode, str):
            params["streamMode"] = stream_mode
        else:
            params["streamMode"] = ",".join(stream_mode)
    if buffer_ms is not None:
        params["bufferMs"] = str(buffer_ms)
    qs = "?" + urlencode(params) if params else ""
    url = f"{base_url}/v1/runs/{run_id}/events{qs}"

    headers = {
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {api_key}",
        "Cache-Control": "no-cache",
    }
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id

    req = Request(url, headers=headers, method="GET")
    with urlopen(req, timeout=timeout_seconds) as resp:
        # urlopen raises on non-2xx, so resp.status is always 2xx here.
        pending_event = "message"
        pending_data: list[str] = []
        pending_id: str | None = None

        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")

            if line == "":
                # Event boundary — flush. Returns a list because S3 batched
                # `event: batch` events fan out into multiple RunEventDocs.
                events = _flush_event(pending_event, pending_data, pending_id)
                pending_event = "message"
                pending_data = []
                pending_id = None
                for ev in events:
                    yield ev
                continue

            if line.startswith(":"):
                # SSE comment / keep-alive — skip.
                continue

            colon = line.find(":")
            if colon == -1:
                field = line
                value = ""
            else:
                field = line[:colon]
                value = line[colon + 1 :]
                if value.startswith(" "):
                    value = value[1:]

            if field == "event":
                pending_event = value
            elif field == "data":
                pending_data.append(value)
            elif field == "id":
                pending_id = value
            # Unknown fields ignored per RFC 8895.

        # Flush any final unterminated event.
        for ev in _flush_event(pending_event, pending_data, pending_id):
            yield ev


def _flush_event(
    event: str, data_lines: list[str], event_id: str | None
) -> list[RunEventDoc]:
    """Decode a buffered SSE event into RunEventDocs.

    Returns:
        - empty list when buffer is empty / non-JSON / malformed (skip).
        - 1-element list for normal `event: <type>` payloads.
        - N-element list when the server batched per S3 — `event: batch`
          with `data:` as a JSON array of RunEventDoc.
    """
    _ = event_id
    if not data_lines:
        return []
    raw = "\n".join(data_lines)
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError:
        return []

    # S3 batched envelope — `event: batch` carries an array of events.
    if event == "batch" and isinstance(parsed, list):
        out: list[RunEventDoc] = []
        for item in parsed:
            decoded = _decode_event_doc(item)
            if decoded is not None:
                out.append(decoded)
        return out

    if not isinstance(parsed, dict):
        return []
    decoded = _decode_event_doc(parsed)
    return [decoded] if decoded is not None else []


def _decode_event_doc(parsed: Any) -> RunEventDoc | None:
    """Defensive RunEventDoc construction — returns None on missing/
    misshapen required fields. Forward-compat readers tolerate extras.
    """
    if not isinstance(parsed, dict):
        return None
    try:
        return RunEventDoc(
            eventId=str(parsed["eventId"]),
            runId=str(parsed["runId"]),
            type=str(parsed["type"]),
            payload=parsed.get("payload"),
            timestamp=str(parsed["timestamp"]),
            sequence=int(parsed["sequence"]),
            nodeId=parsed.get("nodeId"),
            schemaVersion=parsed.get("schemaVersion"),
            engineVersion=parsed.get("engineVersion"),
            causationId=parsed.get("causationId"),
        )
    except (KeyError, ValueError, TypeError):
        return None
