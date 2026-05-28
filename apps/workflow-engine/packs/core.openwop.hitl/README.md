# core.openwop.hitl

Human-in-the-loop primitives. Each node suspends the workflow via the existing interrupt mechanism (`spec/v1/interrupt.md`, `spec/v1/interrupt-profiles.md`) and resumes when the human provides input.

| typeId | role | interrupt kind | purpose |
|---|---|---|---|
| `core.hitl.form-request` | side-effect | `clarification` | Suspend on a typed JSON-Schema form. Mirrors the flat-schema constraint MCP elicitation uses. |
| `core.hitl.approval-request` | side-effect | `approval` | Suspend on an approve / reject choice with optional comment. |
| `core.hitl.ask-user` | side-effect | `clarification` | Suspend on a free-text chat-question. Useful inside chat-driven workflows. |

All three honor the run's existing approver-list / quorum semantics if the host advertises `auth.profiles.openwop-quorum`.
