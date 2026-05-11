# Outreach Follow-Up Cadence

> **Status: cadence + templates ready (2026-05-11).** Applies to all three outreach tracks: external security audit (`SECURITY/outreach/external-audit/`), external host recruitment (`external-host.md`), external pack author recruitment (`external-pack-author.md`).

The bottleneck after Phase 3 is reply latency, not artifact readiness. This doc is the per-track follow-up schedule that converts no-reply into reply over a defined window, and converts "not now" into a future-dated re-contact rather than a dead lead.

## Why follow-ups matter

Public industry numbers: cold outreach reply rate without follow-ups is ~5–10%. With three well-timed follow-ups it's ~25–30%. The lift comes from:

1. **Inbox surface area** — first email may have been buried by 200 others on a busy Tuesday.
2. **Implicit signaling** — a follow-up tells the recipient "this isn't a one-shot promotional blast; the sender will keep showing up." That alone shifts replies from the "ignore" bucket to the "I should at least say no" bucket.
3. **Lower-cost reply path** — each follow-up should make replying *cheaper* than not replying (specific time windows, lower-effort "no" options, single ask per email).

The cadence below maximizes 1–3 without becoming nagging. **Hard stop at follow-up #3.** Past that, the lead is cold — note in the tracker + revisit in 90 days.

## The cadence (per recipient)

| Day | Action | Subject angle | Cost-to-reply lever |
|---:|---|---|---|
| 0 | Initial outreach | The artifact you wrote in the per-track template | Specific ask + Calendly fallback |
| +5 | Nudge #1 | "Re: [original subject]" — top-of-inbox bump | Lower the ask: "even a one-line 'no fit' helps me" |
| +12 | Nudge #2 | New angle ("did this get buried?" / share an artifact) | Attach or link a concrete artifact (conformance summary, public report, demo recording) |
| +28 | Nudge #3 (final) | "Closing the loop" | Frame as last touch; offer future-dated re-contact |
| +90 | Re-contact (optional) | Significant project update | Only if there's a real reason to retry (new release, new endorsement, new evidence) |

**Don't shorten the gaps.** Day +5 / +12 / +28 are calibrated; shorter intervals (+2, +5, +10) read as desperate and lower the reply rate on the *original* email retroactively. Recipients see the cadence in their inbox.

## Per-track timing

### External security audit (5 vendors)

- Send all 5 on Day 0 (Tuesday or Wednesday, 9–11am recipient-local time wherever possible).
- Reply-rate expectation: 3–4 of 5 reply by Day +28 (security-audit vendors are good responders — quote requests are revenue).
- Decision target: ≥2 viable quotes back by Day +14 → start scoring per `SECURITY/external-audit-engagement.md` §4 weights. If only 0–1 by Day +14, the cadence above (nudges #2 + #3) recovers the rest.
- **Special case — vendor proposes a window we can't meet:** reply within 24 hours with three concrete alternative windows. Do NOT counter with "let me check and get back to you" — that's a 5-day silent-decay risk.

### External host recruitment (4 candidates)

- Send all 4 on Day 0 of recruitment week.
- Reply-rate expectation: 1–2 of 4 reply by Day +28 (lower than audit vendors because there's no immediate revenue motive). A reply rate of 25% with a positive engagement is a successful round; a 50% reply rate with all-declines is a sharpening signal for the next-tier shortlist.
- Decision target: any positive reply → immediate 30-minute scoping call. Don't queue the call behind administrative work.
- **Special case — "we'll watch but not own this":** keep them on the Day +90 re-contact list with a specific trigger ("when we have a second non-steward host or the registry crosses N packs").

### External pack author recruitment (5 Tier-1 candidates)

- Pick 3 candidates from the MAINTAINERS.md Tier-1 shortlist for the first send wave (highest-fit by API shape). Send all 3 on Day 0.
- Send the remaining 2 only if no positive reply by Day +14 (concurrent dilutes signal).
- Reply-rate expectation: 1–2 of 3 reply by Day +28.
- Decision target: any positive reply → 30-minute walk-through session scheduled within 7 days. The publish flow is the entire pitch; let them experience it.

## Follow-up templates

Copy / adapt per track. Each template is ≤ 80 words and asks for one thing.

### Audit-vendor follow-ups

**Nudge #1 (Day +5):**

> Subject: Re: External security review — OpenWOP protocol (fixed-bid quote request)
>
> Hi [name],
>
> Bumping this in case it got buried. No urgency — just wanted to surface it once before assuming it's not a fit.
>
> If the scope (5 threat models, ~6,250 LOC across hosts and SDKs, RFCs 0002–0008) isn't a fit for [Vendor] this quarter, a one-line "not now" reply is genuinely useful — it sharpens the shortlist.
>
> Otherwise, happy to walk it on a call.
>
> Thanks,
> David

**Nudge #2 (Day +12):**

> Subject: OpenWOP audit — quick artifact + status update
>
> Hi [name],
>
> Two updates in case they shift the picture:
>
> 1. The conformance suite now exercises 87% of capability-gated profiles end-to-end (audit-log integrity, all four interrupt profiles, OTLP/protobuf, debug-bundle truncation). Public report: <link to conformance-full.md>.
> 2. The Postgres-host audit module is the next port; engagement-doc §5 preconditions remain stable for the next 60 days.
>
> Still happy to walk it on a call. **Three open slots: <window 1>, <window 2>, <window 3>.**
>
> Thanks,
> David

**Nudge #3 (Day +28, final):**

> Subject: Closing the loop — OpenWOP audit
>
> Hi [name],
>
> Closing the loop on the external-audit outreach. If [Vendor] is engaged or not interested either way, that's the answer I need to move on — no offence taken.
>
> If you'd like a future-dated re-contact (e.g., when we have the third-party host implementation landed and the engagement scope shifts), reply with a quarter and I'll respect it.
>
> Otherwise this is my last touch on this thread.
>
> Thanks,
> David

### Host-recruitment follow-ups

**Nudge #1 (Day +5):**

> Subject: Re: [original subject]
>
> Hi [team],
>
> Bumping in case this got buried. One-line "watch but not own" reply is more useful than silence — it tells me whether to invest in a steward-owned adapter or wait for community demand.
>
> Thanks,
> David

**Nudge #2 (Day +12):**

> Subject: OpenWOP host on [Vendor] — quick artifact update
>
> Hi [team],
>
> One update in case it sharpens the picture: the Postgres reference host now has audit-log integrity end-to-end; the SQLite host passes 576 of 661 conformance scenarios (87%). The adapter-LOC estimate in the original email is calibrated against this baseline.
>
> Still happy to write the first cut as a draft PR. **Three open slots: <window 1>, <window 2>, <window 3>.**
>
> Thanks,
> David

**Nudge #3 (Day +28, final):**

> Subject: Closing the loop — OpenWOP × [Vendor] adapter
>
> Hi [team],
>
> Closing the loop. If a [Vendor]-backed OpenWOP host isn't a fit this quarter, that's a useful signal — I'll route the recruitment energy elsewhere.
>
> If there's a future trigger that would change the answer (e.g., we publish the production-profile claim, we hit N external packs, etc.), reply with the trigger and I'll re-contact then.
>
> Otherwise this is my last touch.
>
> Thanks,
> David

### Pack-author follow-ups

**Nudge #1 (Day +5):**

> Subject: Re: First external OpenWOP node pack — would [tool] fit?
>
> Hi [name],
>
> Bumping this once. The first-external-pack pitch is small — one node, one typed envelope, ~30-minute working session — and a "not interested" reply is more useful than silence.
>
> Thanks,
> David

**Nudge #2 (Day +12):**

> Subject: Quick demo of the OpenWOP pack publish flow
>
> Hi [name],
>
> 5-minute screencast of the publish flow end-to-end (build → sign → PR → published on packs.openwop.dev): <link or attachment placeholder>.
>
> If a `vendor.<your-org>.<tool>` pack lands on the registry, you're the first external pack author on `INTEROP-MATRIX.md`. Happy to do the wire-translation work for the first manifest.
>
> Three open slots: <window 1>, <window 2>, <window 3>.
>
> Thanks,
> David

**Nudge #3 (Day +28, final):**

> Subject: Closing the loop — OpenWOP pack collaboration
>
> Hi [name],
>
> Last touch on this thread. If [tool] isn't a fit for an OpenWOP pack right now, that's the answer.
>
> If there's a trigger (e.g., your team starts shipping public APIs around `<X>`, or you want to revisit when OpenWOP has more external packs as social proof), reply with the trigger and I'll re-contact.
>
> Thanks,
> David

## Reply-tracking template

Each track has a per-vendor status row in `MAINTAINERS.md` §"Recruitment log" or `SECURITY/outreach/external-audit/STATUS.md`. Update in the same git commit that handles the reply (see `STATUS.md` maintenance convention).

Status values:
- `pending-outreach` — initial email not yet sent
- `outreach-sent` — Day 0 happened, no reply yet
- `nudge-1-sent` — Day +5 happened, no reply yet
- `nudge-2-sent` — Day +12 happened, no reply yet
- `nudge-3-sent` — Day +28 happened, no reply yet (lead is cold)
- `in-discussion` — reply received, conversation active
- `declined` — explicit no
- `future-recontact:Qn-YYYY` — explicit "ask me later", with quarter
- `committed` — engagement / adapter PR / pack PR in progress

If a row sits at `outreach-sent` past Day +5, that's a process bug (nudge skipped). The cadence above is mechanical — set a reminder or a calendar entry on Day 0 for the +5 / +12 / +28 dates per recipient.

## What not to do

- **Don't send Nudge #1 < 4 days after Day 0.** Reads as desperate, lowers reply rate on the original.
- **Don't increase nudge length past the original.** Each follow-up should be shorter than the last; the recipient already has the long version.
- **Don't change the ask between nudges.** Same ask, different angle. Changing the ask reads as scope creep.
- **Don't follow up past Nudge #3 without a real trigger.** Adds noise, lowers reply rate on the next round.
- **Don't BCC anyone.** Each recipient should feel like the email is to them specifically.
- **Don't apologize for following up.** "Sorry to bug you again" lowers the sender's status in the implied transaction; it does not increase reply rate.

## See also

- `SECURITY/outreach/external-audit/README.md` — audit vendor outreach drafts
- `SECURITY/outreach/external-audit/STATUS.md` — per-vendor audit-outreach tracker
- `docs/recruitment/external-host.md` — host recruitment outreach drafts
- `docs/recruitment/external-pack-author.md` — pack-author recruitment outreach drafts
- `MAINTAINERS.md` §"Recruitment log" — per-target reply tracking for host + pack tracks
