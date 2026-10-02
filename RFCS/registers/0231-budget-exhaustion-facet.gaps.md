# RFC 0231 — Gap register

| ID | Section | Question / Missing Input | Owner | Resolution Path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | §B.2 | What an absent facet means: "both, as today" (proposed, additive) or "`fail` only" (matches every host measured, and is a correction). | Compatibility Architect | `carried:openwop.gap.0231.1` Decision before `Active`, from comments in the window (Unresolved question 1). | `Active` |
| G2 | §B.1, §F | The `interrupt` path has no witness in either major. `runs.md` says the approval's `resumeValue` "adds budget" and gives no shape (RFC 0084, Unresolved question 5), so a suite cannot drive the resume. | Spec Architect | `carried:openwop.gap.0231.2` A follow-up RFC pins the resume shape; until then the served path stays unwitnessed and no host is asked to prove it. | Nothing in this RFC. |
| G3 | §F | No host advertises the facet, so the refusal row has no witness. The v2 reference host already refuses as §C requires. | Reference Implementation Architect | `externally-gated:host-advertises-exhaustion-facet` The v2 reference host adds `onExhaustion: ["fail"]` and cuts a certified bundle. | `Accepted` |
| G4 | §C.1 | Whether the refusal should carry `details.supported`. `capability_not_provided` has no registered details schema. | Schema Architect | `carried:openwop.gap.0231.4` Decide with Unresolved question 2. Leaving it out changes nothing in this RFC. | Nothing in this RFC. |
| G5 | §D | Whether v1 takes the facet. The seed schema is v1's, so by default both majors get it. | Compatibility Architect | `carried:openwop.gap.0231.5` Decision before `Active` (Unresolved question 4). | `Active` |
| G6 | Motivation | MyndHyve's `interrupt` behaviour is reported from source by its session and was not measured. | Conformance Architect | `externally-gated:myndhyve-host-cut` Measure on its next certified cut: send `onExhaustion: "interrupt"` and record the answer. | Nothing in this RFC. |
