# vendor.myndhyve.campaign-sequence-integration

> Three side-effectful campaign-sequence step executors: `email`, `sms`, `webhook`. Companion pack to [`vendor.myndhyve.campaign-sequence`](../vendor.myndhyve.campaign-sequence/) (pure-control nodes).

## Nodes

| typeId | Host capability required | Behavior |
|---|---|---|
| `campaign.sequence.email` | `ctx.campaignMessaging.sendEmail` | Validates `step.subject`; delegates to the host adapter; surfaces `{success, error?, nextStepId?, messageId?}`. |
| `campaign.sequence.sms` | `ctx.campaignMessaging.sendSms` | Validates `step.smsBody`; delegates to the host adapter. |
| `campaign.sequence.webhook` | none (Node 20 runtime only) | SSRF-defended HMAC-SHA256-signed POST/PUT/PATCH/DELETE to `step.webhookUrl`. |

## Host capability surface

The pack declares `peerDependencies: { "host.campaignMessaging": "supported" }`. Hosts that don't advertise this surface get refused at pack-register time. The expected adapter shape mirrors MyndHyve's internal `EmailSMSAdapterService`:

```typescript
ctx.campaignMessaging = {
  isReady?: () => boolean;
  sendEmail: (step, enrollment, sequence) => Promise<{
    success: boolean;
    error?: string;
    nextStepId?: string;
    messageId?: string;
  }>;
  sendSms: (step, enrollment, sequence) => Promise<{
    success: boolean;
    error?: string;
    nextStepId?: string;
    messageId?: string;
  }>;
};
```

`isReady()` is optional — when absent, the executor assumes the adapter is ready and skips the pre-check.

## Webhook executor

Self-contained — uses Node 20's built-in `fetch` + `node:crypto`'s `createHmac`. No host capability required.

**SSRF defense**: rejects localhost, `127.0.0.1`, `::1`, `169.254.169.254` (cloud metadata), `10.0.0.0/8`, `192.168.0.0/16`. Mirrors the MyndHyve source's deny list.

**Signature**: `X-MyndHyve-Signature: hex(hmac-sha256(step.webhookSecret, body))`. Empty secret yields an empty-key HMAC (still computed; verification on the receiver side will fail unless they expect the empty-key value).

**Body envelope**:
```json
{
  "event": "sequence.step.webhook",
  "enrollmentId": "<enrollment.id>",
  "sequenceId": "<sequence.id>",
  "stepId": "<step.id>",
  "leadId": "<enrollment.leadId>",
  "stepData": "<step.webhookBody, verbatim>",
  "timestamp": "<ISO 8601>"
}
```

**Timeout**: configurable via `ctx.config.timeoutMs` (default 30000, range 1000–60000). Aborts via `AbortController` — the executor never blocks beyond the budget.

## Why a separate pack from `vendor.myndhyve.campaign-sequence`

The pure-control pack (`wait`/`tag`/`condition`) has zero host coupling and is universally installable. This pack declares `host.campaignMessaging` peer-dep so hosts without an email/sms adapter can refuse the integration nodes while still installing the pure-control trio. Separating the packs keeps the peer-dep precise.

## Authoring source

Lifted from MyndHyve's [`src/canvas-types/campaign-studio/sequences/sequenceStepModules.ts`](https://github.com/myndhyve) (the email/sms/webhook branch — 263 LOC source, ~150 LOC carried into this pack after host-capability reshape).

Differences vs. MyndHyve source:
- `getEmailSMSAdapter` lazy-import → `ctx.campaignMessaging` host capability
- `fetchWithRetry` from `@/core/utils/fetchWithRetry` → Node 20 `fetch` + abort-on-timeout
- `generateWebhookSignature` from `@/features/webhook/WebhookSignature` → inline `node:crypto.createHmac`

## License

Apache-2.0 — see [LICENSE](./LICENSE).
