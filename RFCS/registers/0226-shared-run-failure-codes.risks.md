# RFC 0226 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A host maps a transport failure to `mcp_error`, so clients treat an unreachable peer as a peer-side error and never retry. | M | L | Low | The `meaning` names a JSON-RPC error answered by the peer; an unreachable peer is out of scope (Unresolved 1, G8). | Spec Architect | `accepted` — the meaning is explicit. |
