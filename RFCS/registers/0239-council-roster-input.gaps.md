# RFC 0239 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §F | No host advertises `multiPartyConversation` together with the §E fixture, so none of the §F rows has a witness. | Reference Implementation Architect | `closed` 2026-10-07 — openwop-examples #158 implements the roster seat on the v2 reference host (`maxParticipants` 8); its certified 2.45.23 cut (build `commit:1492562f`) records all three `openwop.requirement.0239.*` ids `executed-pass`. | `Accepted` |
| G2 | §C, Decisions 4 | A host whose `maxParticipants` is 64 or more cannot be shown an oversized roster: there is no schema ceiling and no v2 workflow registration. | Conformance Architect | `externally-gated:v2-workflow-registration` A v2 workflow-registration operation would let the suite size the roster to the host. | Nothing in this RFC. |
