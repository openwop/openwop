# External Security Audit — Vendor Outreach

> **Status: drafts ready, not yet sent (2026-05-11).** Send all five in parallel; first to respond with fitting quote + window gets the engagement.

This directory contains one ready-to-send outreach email per vendor on the shortlist defined in `SECURITY/external-audit-engagement.md` §4. Each file is structured so you can copy the body verbatim, paste into a fresh thread with the vendor's contact channel (their generic intake email or their security@), and send.

## Vendor shortlist + selection weights

Per `SECURITY/external-audit-engagement.md` §4:

| Vendor | Track record / fit | Public-report quality | Weight |
|---|---|---|---:|
| Trail of Bits | Strong on protocol-level + supply-chain; OAuth-adjacent | Reports are public + thorough | High |
| NCC Group | Broad enterprise track record | Reports public | High |
| Doyensec | Strong on web + workflow systems | Reports public | Medium |
| Cure53 | LLM-adjacent + crypto-protocol heritage | Reports public | Medium |
| Latacora | Smaller engagements; fast turnaround | Reports public | Medium |

Weighting per the engagement doc: protocol track record 40%, LLM/workflow experience 25%, schedule fit 15%, public-report quality 10%, cost 10%.

## Email files

- `trail-of-bits.md` — primary outreach
- `ncc-group.md` — primary outreach
- `doyensec.md` — primary outreach
- `cure53.md` — primary outreach
- `latacora.md` — primary outreach

Each file has:
- **Subject:** the line you paste into your mail client
- **To:** the vendor's intake email (the public-facing one; replace with a known contact if you have one)
- **Body:** the message verbatim
- **Notes:** anything specific to this vendor (e.g., a public report they wrote that's particularly relevant)

## Send checklist

1. Run a final pass over `SECURITY/external-audit-engagement.md` to confirm scope is current (✓ as of 2026-05-11).
2. Pick a single source email address; ideally the project's `security@openwop.dev` or your own.
3. Send all five within the same day (parallel quotes, not serial).
4. Update `SECURITY/external-audit-engagement.md` §8 status tracker:
   - "Vendor outreach" status → date sent
   - Add per-vendor row to the local tracker in `SECURITY/outreach/external-audit/STATUS.md` as replies come in
5. First-to-respond with viable quote + 60-day window: send a follow-up to schedule a 30-minute scoping call.
6. Once a vendor is selected: reply to the other four declining with a brief note (preserves the relationship for future engagements).

## After-engagement

Once a vendor accepts:
- Move `SECURITY/external-audit-engagement.md` §8 forward through the rest of the status rows.
- Pin the repository commit hash per §5 preconditions.
- The vendor's NDA gets signed before any non-public-finding access (which is narrow — most of the project is already public).

## See also

- `SECURITY/external-audit-engagement.md` — the authoritative scope doc the outreach references
- `docs/PROTOCOL-GAP-CLOSURE-PLAN.md` §"Track 9: Governance And Interop Evidence" — where this lands in the plan
