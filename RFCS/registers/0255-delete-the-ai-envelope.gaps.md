# RFC 0255 — Gap register

| ID | Section | Question / missing input | Owner | Resolution path | Blocks |
| --- | --- | --- | --- | --- | --- |
| G1 | Prerequisites | Production census not taken: `envelope_correlations`, fenced text in `invocation_log`, clarification checkpoints, `agent-clarification` toggle | Reference host | `closed` 2026-10-30 — census: 0 correlations, 0 stamped runs, 0 fenced invocation rows; 4 `ui.a2ui-surface` events stay readable | — |
| G2 | §D | The gate changes and the `requirements` tombstone form are unbuilt; the trial measured 20 red gates with 1 at baseline and did not reach green | Compatibility Architect | `transferred:rfc-0255-implementation` — iterate on a branch to green | `Active` |
| G3 | §E | The interrupt-form section and tests do not exist; `interrupt.md` has no A2UI text | Security Architect | `transferred:rfc-0255-implementation` — write before deleting the witnesses | spec PR |
| G4 | Budget | Kernel measured at 37,493 against a 37,000 cap after deletion | Spec Architect | `transferred:rfc-0255-implementation` — trim about 500 words plus §E text | spec PR |
| G5 | §A | Frontend v0.9 renderer: reported unfed, frontend not built in the trial | Reference host | `transferred:openwop-app-adr-1007` — confirm before deleting | host PR |
| G6 | Host | `api.myndhyve.ai` answered discovery with 81 kinds on 2026-10-30 after its recorded retirement | MyndHyve owner | `transferred:myndhyve-owner` — steward confirmed retirement 2026-10-30; the host still answered 200 on discovery that day and blocks nothing here | none |
| G7 | Schema | Dropping `envelope_correlations` is destructive and needs a migration on both backends | Reference host | `transferred:openwop-app-adr-1008` — approved by the steward 2026-10-30; runs in a later release so a rolled-back revision's teardown still works | none |
