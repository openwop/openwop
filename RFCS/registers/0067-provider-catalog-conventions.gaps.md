# RFC 0067 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
|---|---|---|---|---|---|
| G1 | Proposal §A | Should auth-mode advertisement carry a richer per-provider object (displayName, endpoint hint) rather than a bare mode array? | Spec Architect | Decision at `Active`; kept minimal for `Draft` | Whether a `providers` block supersedes `authModes` |
| G2 | Unresolved #1 | Model-catalog advertisement (which models a provider exposes) | Spec Architect | Follow-up RFC if an implementer wants a model picker without a second call | `Accepted` |
| G3 | Unresolved #2 | Aggregator (`openrouter`/`litellm`) auth semantics — one gateway key vs nested upstream auth | Compatibility Architect | Confirm with an implementer | `Active` |
| G4 | Unresolved #3 | Whether a `none` local provider's endpoint URL should surface in discovery | Security Architect | Proposed host-config-only; confirm | `Active` |
| G5 | Conformance | No reference host advertises `authModes` yet | Conformance Architect | Reference-host advertisement deferred; shape + always-on validation ship now | `Accepted` |
