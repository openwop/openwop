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

**SSRF defense** (hardened in 1.0.1):

- Rejects loopback (`127.0.0.0/8`, `::1`, `0.0.0.0/8`)
- Rejects IPv4 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Rejects link-local + cloud metadata: `169.254.0.0/16`, `169.254.169.254`
- Rejects IPv6 ULA (`fc00::/7`) + link-local (`fe80::/10`)
- **DNS-rebinding defense**: for hostname URLs, the executor pre-resolves via `dns.lookup` and rejects when the resolved IP is in any blocked range. Defends against an attacker-controlled DNS record pointing a public name at an internal IP.

The 1.0.0 release missed `172.16.0.0/12`, IPv6 private ranges, and lacked DNS-resolution validation. Operators with sequence definitions that legitimately target `172.16.0.0/12` (uncommon for outbound webhooks) must update those addresses; otherwise upgrade is transparent.

**Signature**: `X-MyndHyve-Signature: hex(hmac-sha256(step.webhookSecret, body))`. In 1.0.1, `step.webhookSecret` is REQUIRED for non-localhost targets — the executor returns `success: false, error: 'webhookSecret is required for non-localhost delivery'` if the secret is absent or empty. (An empty-key HMAC is computable by any third party and therefore unsigned in practice; surfacing the error explicitly is safer than silent forgery exposure.) Localhost targets (development) still allow empty secrets.

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
