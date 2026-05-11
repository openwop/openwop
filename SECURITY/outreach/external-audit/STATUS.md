# External Audit — Outreach Status

> **Last updated: 2026-05-11.** Tracker for the outreach round defined in `README.md`. Update each row as replies come in. The authoritative engagement-state-machine lives in `SECURITY/external-audit-engagement.md` §8 — this file is the per-vendor detail that doesn't belong in the master scope doc.

## Per-vendor status

| Vendor | Outreach sent | First reply received | Quote received | Range (USD) | Window | Decision | Final status |
|---|---|---|---|---|---|---|---|
| Trail of Bits | — | — | — | — | — | — | Pending |
| NCC Group | — | — | — | — | — | — | Pending |
| Doyensec | — | — | — | — | — | — | Pending |
| Cure53 | — | — | — | — | — | — | Pending |
| Latacora | — | — | — | — | — | — | Pending |

Decision values: `selected` / `declined-by-us` / `declined-by-vendor` / `no-response`.

## How to update

When you send the outreach round:

```bash
# Set Outreach sent dates to today on all five rows.
```

When a reply comes in: fill in `First reply received`, `Quote received`, `Range`, `Window`. Move `Final status` to `pending-decision` when you have ≥2 viable quotes; `selected` for the winner; `declined-by-us` for the rest you decline; `declined-by-vendor` if they pass.

## Selection workflow

Per `SECURITY/external-audit-engagement.md` §4 selection weighting:
- Track record on protocol-level reviews: 40%
- LLM/workflow/agent-adjacent experience: 25%
- Schedule fit: 15%
- Public-report quality: 10%
- Cost: 10%

When you have ≥2 quotes back, score each on a 1-5 scale per criterion in a separate calc (this tracker stays high-level). Highest weighted score wins, ties broken by schedule fit.

## After selection

1. Move `SECURITY/external-audit-engagement.md` §8 status tracker forward:
   - "Vendor selected" → date + chosen vendor's name
   - "Contract signed" → date when signed
   - "Repository commit pinned" → the commit hash that's the audit subject
   - "Kickoff" → date the review begins
2. Reply to the four non-selected vendors declining with a short courtesy note.
3. This file's last row gets one of `selected` (winner) or `declined-by-us` (the four passed-over) — final state is then archival.
