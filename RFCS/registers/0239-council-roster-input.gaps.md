# RFC 0239 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §F | No host advertises `multiPartyConversation` together with the §E fixture, so none of the §F rows has a witness. | Reference Implementation Architect | `externally-gated:multi-party-council-host` A host runs the council fixture and cuts a certified bundle. | `Accepted` |
| G2 | §C, Decisions 4 | A host whose `maxParticipants` is nine or more cannot be shown an oversized roster: there is no schema ceiling and no v2 workflow registration. | Conformance Architect | `externally-gated:v2-workflow-registration` A v2 workflow-registration operation would let the suite size the roster to the host. | Nothing in this RFC. |
