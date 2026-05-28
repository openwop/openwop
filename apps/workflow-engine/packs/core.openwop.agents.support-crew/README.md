# `core.openwop.agents.support-crew`

Support 3-agent crew. Triage → Resolver → Escalator. Single atomic dispatch handles the full ticket lifecycle.

| Pack name | `core.openwop.agents.support-crew` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 3 (triage / resolver / escalator) |
| Required host capabilities | `aiProviders`, `host.agentRuntime`, `openwop.agents.memoryBackends ≥ longTerm` |
| License | Apache-2.0 |

## Lifecycle

1. **Triage** classifies the incoming ticket → emits queue + severity + priority.
2. **Resolver** attempts a KB-grounded answer. Returns either `{answer, citations}` or `{escalation}`.
3. **Escalator** (only invoked when Resolver returned escalation) builds the escalation packet for a human.

## Difference from the standalone Triage/Resolver packs

The standalone `core.openwop.agents.support-triage` and `support-resolver` packs let callers compose their own workflow. This crew bundles all three roles for callers who want a single dispatch covering the whole ticket lifecycle — useful for low-code workflow builders or simple chat front-ends.

The agent contracts inside this crew are equivalent (intentionally) to the standalone packs so a workflow can swap them per scaling needs.
