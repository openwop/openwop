# OpenWOP in 10 Minutes

> **Status: v2.** Every call below uses unversioned paths (`/runs`) and sends an `OpenWOP-Version: 2` header. The responses come from the v2 reference host, abbreviated. That host ran on port 3990 for the capture; yours will show `3838`.

This is the fastest path from "what is OpenWOP?" to "I have a v2 workflow running on my laptop". You need Node 20+ and a clone of [`openwop/openwop-examples`](https://github.com/openwop/openwop-examples), which holds the reference hosts and runnable samples. You don't need a vendor SDK, a managed service, or a framework.

1. **Minute 0–2:** start the v2 reference host.
2. **Minute 2–5:** run a workflow with curl.
3. **Minute 5–8:** run the same workflow with the TypeScript SDK.
4. **Minute 8–10:** stream events live over SSE, resume a stream, and cancel a run.

[`QUICKSTART.md`](./QUICKSTART.md) covers more (webhooks, fork and replay, `configurable`, node packs, conformance) and works against any v2 host. This guide assumes you have nothing yet.

---

## Prerequisites

```bash
node --version  # must be >= 20
git --version
```

That's all. You don't need Docker, a cloud account, or provider API keys.

---

## Minute 0–2: start the v2 reference host

```bash
git clone https://github.com/openwop/openwop-examples.git
cd openwop-examples/examples/hosts/v2-reference
npm install --legacy-peer-deps
npm start
```

You should see a line like this one (captured with `OPENWOP_PORT=3990`; yours names port 3838 and `db data/v2-reference.sqlite`):

```text
openwop-host-v2-reference listening on http://127.0.0.1:3990 (protocolVersions 1.11, 2.0; preferredVersion 1.11; db …; fixtures 16; seams mounted; spec-artifacts 2.42.2)
```

Leave it running. `--legacy-peer-deps` is required: the host's README explains the exact-pinned conformance peers it works around. The host stores runs in one SQLite file (`data/v2-reference.sqlite`). Set `OPENWOP_DB_PATH=:memory:` if you want nothing written to disk.

The boot line says `protocolVersions 1.11, 2.0; preferredVersion 1.11`. The host serves both majors, and until v1 end-of-support a request **without** `OpenWOP-Version` gets the v1 contract ([`spec/v2/core/versioning.md`](./spec/v2/core/versioning.md) §1.1, §1.3). That's why every call below sends `OpenWOP-Version: 2`.

In a separate terminal:

```bash
export OPENWOP_URL=http://127.0.0.1:3838
export TOKEN=openwop-v2-dev-key   # the host's default dev key (OPENWOP_API_KEY overrides it)
```

---

## Minute 2–5: run a workflow with curl

### Discover

```bash
curl -s -H 'OpenWOP-Version: 2' $OPENWOP_URL/.well-known/openwop \
  | jq '{protocolVersions, preferredVersion, implementation, replay}'
```

```json
{
  "protocolVersions": ["1.11", "2.0"],
  "preferredVersion": "1.11",
  "implementation": {
    "name": "openwop-host-v2-reference",
    "version": "2.0.0-rc.1",
    "vendor": "openwop (reference example)"
  },
  "replay": {
    "status": "experimental",
    "since": "2.0",
    "until": "2.1",
    "witness": "witnessable-gated",
    "modes": ["replay", "branch"],
    "retention": { "days": 30 },
    "effectSeamsManifest": "/host/effect-seams"
  }
}
```

This is the closed v2 discovery root. Each family (`replay` here) is a record with `status`, `since`, `witness`, and its facets. A family that is present is supported. v2 has no `supported: true` flags. `jq '.fixtures'` lists the 16 test workflows the host can run.

### Create a run

```bash
curl -s -X POST $OPENWOP_URL/runs \
  -H 'OpenWOP-Version: 2' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"workflowId":"conformance-multi-node"}'
```

```json
{
  "runId": "openwop-reference-tenant/9fasFA1XO6OIVVrEDg6S_Msv",
  "status": "pending",
  "eventsUrl": "http://127.0.0.1:3990/runs/openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv/events",
  "statusUrl": "http://127.0.0.1:3990/runs/openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv"
}
```

A v2 `runId` is tenant-bound (`<tenant>/<opaque>`). In a URL, the `/` travels as `~2F`. Use the last path segment of `statusUrl` as your run reference:

```bash
RUN=openwop-reference-tenant~2F9fasFA1XO6OIVVrEDg6S_Msv   # paste yours
```

### Get the snapshot

```bash
curl -s -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  $OPENWOP_URL/runs/$RUN | jq '{status, owner, eventLogSchemaVersion}'
```

```json
{
  "status": "completed",
  "owner": {
    "tenant": "openwop-reference-tenant",
    "subject": {
      "issuer": "urn:openwop-host-v2-reference:api-key",
      "subjectId": "default",
      "tenant": "openwop-reference-tenant",
      "lane": "api-key",
      "kind": "user"
    }
  },
  "eventLogSchemaVersion": 3
}
```

You just ran an OpenWOP v2 workflow with three HTTP calls and no client library. `owner.subject` is who the host decided you are, and the host derives it from your credential, never from the request body.

---

## Minute 5–8: run the same workflow with the TypeScript SDK

The 2.x line of `@openwop/openwop` sends `OpenWOP-Version` on every request.

```bash
mkdir -p /tmp/openwop-quickstart && cd /tmp/openwop-quickstart
npm init -y > /dev/null
npm pkg set type=module
npm install @openwop/openwop@2

cat > quickstart.mjs <<'EOF'
import { OpenwopClient } from '@openwop/openwop';

const client = new OpenwopClient({
  baseUrl: 'http://127.0.0.1:3838',
  apiKey: 'openwop-v2-dev-key',
});

const caps = await client.discovery.capabilities();
console.log('Server:', caps.implementation?.name, caps.protocolVersions);

const { runId } = await client.runs.create(
  { workflowId: 'conformance-multi-node' },
  { idempotencyKey: crypto.randomUUID() },
);
console.log('Created:', runId);

for await (const event of client.runs.events(runId)) {
  console.log(`  [${event.sequence}] ${event.type}`);
}

const snap = await client.runs.get(runId);
console.log('Final:', snap.status);
EOF

node quickstart.mjs
```

Output (with `@openwop/openwop` 2.3.0):

```text
Server: openwop-host-v2-reference [ '1.11', '2.0' ]
Created: openwop-reference-tenant/G_N8_vAoLjSAzDK7a2rLAB-n
  [0] run.started
  [1] node.started
  [2] node.completed
  [3] node.started
  [4] node.completed
  [5] node.started
  [6] node.completed
  [7] run.completed
Final: completed
```

`client.runs.events` consumes the SSE stream. It ends after the terminal event, so you don't need a polling loop. The Python (`openwop-client>=2`) and Go (`github.com/openwop/openwop-sdks/go/v2`) clients have the same shape. All three live in [`openwop/openwop-sdks`](https://github.com/openwop/openwop-sdks).

> **Note:** to test an unpublished SDK checkout instead, clone `openwop-sdks`, run `npm install && npm run build && npm link` in `sdk/typescript-v2/`, and replace the install step with `npm link @openwop/openwop`.

---

## Minute 8–10: stream events live over SSE

Start a long-running workflow. `conformance-cancellable` waits `delayMs` before it completes.

```bash
curl -s -X POST $OPENWOP_URL/runs \
  -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"workflowId":"conformance-cancellable","inputs":{"delayMs":30000}}'
RUN=...   # the last path segment of the statusUrl it returns
```

Attach to its event stream:

```bash
curl -s -N -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  "$OPENWOP_URL/runs/$RUN/events"
```

While it waits, cancel it from a third terminal:

```bash
curl -s -X POST -H 'OpenWOP-Version: 2' -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"reason":"quickstart demo"}' \
  "$OPENWOP_URL/runs/$RUN/cancel"
```

```json
{"runId":"openwop-reference-tenant/1xe1dnUaKrvDQjragfK7I05a","status":"cancelling"}
```

The stream shows the whole life of the run and then closes:

```text
id: 0
event: run.started
data: {"eventId":"nujxvYrr4atcpEqbUTS0Dls6","runId":"openwop-reference-tenant/1xe1dnUaKrvDQjragfK7I05a","type":"run.started",…}

id: 1
event: node.started
data: {…,"type":"node.started","payload":{"nodeId":"wait","typeId":"core.delay",…}}

id: 2
event: node.cancelled
data: {…,"type":"node.cancelled",…}

id: 3
event: run.cancelled
data: {…,"type":"run.cancelled","payload":{"reason":"quickstart demo",…}}
```

Three details are worth knowing:

- **`id:` is the event's `sequence`.** If your connection drops, reconnect with `-H 'Last-Event-ID: 1'` and the host sends only events with a higher sequence.
- **The host replays the backlog on connect.** Attaching after a run has finished still shows every event, and the stream closes after the terminal event.
- **A second cancel is refused.** The run is already terminal, so you get `409 run_terminal` with `details.runStatus: "cancelled"`.

---

## What you just learned

| Concept | Where to read |
| --- | --- |
| The v2 wire contract | [`spec/v2/core/overview.md`](./spec/v2/core/overview.md) (reading order), [`api/v2/openapi.yaml`](./api/v2/openapi.yaml) |
| Version negotiation, `OpenWOP-Version` | [`spec/v2/core/versioning.md`](./spec/v2/core/versioning.md) §1 |
| Discovery records | [`spec/v2/core/capabilities.md`](./spec/v2/core/capabilities.md) |
| Run lifecycle, snapshot, cancel | [`spec/v2/core/runs.md`](./spec/v2/core/runs.md) |
| Events, SSE, poll | [`spec/v2/core/events.md`](./spec/v2/core/events.md) |
| Tenant-bound ids, Subjects | [`spec/v2/core/identity.md`](./spec/v2/core/identity.md) |
| Idempotency | [`spec/v2/core/idempotency.md`](./spec/v2/core/idempotency.md) |
| Profiles | [`spec/v2/profiles.json`](./spec/v2/profiles.json), [`capabilities.md`](./spec/v2/core/capabilities.md) §7 |
| Build your own host | [`examples/hosts/v2-reference/`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference), the host you just ran. It is implemented from `spec/v2/core/`, and its `src/` layout is in its README |
| Conformance | [`QUICKSTART.md`](./QUICKSTART.md) §8: `npx openwop-conformance --base-url $OPENWOP_URL --api-key $TOKEN --target-major 2` |

---

## Where to go next

- **[`QUICKSTART.md`](./QUICKSTART.md)** covers webhooks, fork and replay, `configurable`, node packs, conformance, and SDKs against any v2 host.
- **[`INTEROP-MATRIX.md`](./INTEROP-MATRIX.md)** shows which hosts have a v2 certification bundle, including this one.
- **[`docs/migration/v1-to-v2.md`](./docs/migration/v1-to-v2.md)** is for readers who have v1 client code.
- **Build a node pack:** [`docs/PACK-AUTHOR-QUICKSTART.md`](./docs/PACK-AUTHOR-QUICKSTART.md).

The in-memory host and the `tiny-workflow` / `streaming-client` samples in `openwop-examples` still speak the older wire (`/v1/…`, port 3737). Use the v2 reference host for this walkthrough.

---

## Troubleshooting

| Issue | Fix |
| --- | --- |
| `EADDRINUSE` on port 3838 | Run `OPENWOP_PORT=3990 npm start` and change `OPENWOP_URL` to match. |
| `npm install` fails resolving peers | Use `npm install --legacy-peer-deps`. If npm 10.9 crashes (`edgesOut`), use a current npm: `npx -y npm@latest install --legacy-peer-deps`. |
| `401 unauthenticated` | Include `Authorization: Bearer openwop-v2-dev-key`, or whatever you set `OPENWOP_API_KEY` to. |
| `400 idempotency_key_invalid` | `Idempotency-Key` must match `^[A-Za-z0-9._~-]{22,128}$`. Use a UUID (`uuidgen`). |
| `400 validation_error` naming an unknown key | The `POST /runs` body is closed. Fields it does not define, such as a free-form `configurable` map, are refused. See [`runs.md`](./spec/v2/core/runs.md) §Create. |
| `403` mentioning `tenantId` | Leave `tenantId` out. The tenant comes from your credential. |
| `400 protocol_version_mismatch` | You sent `OpenWOP-Version: 2` to a `/v1/…` path. Drop the `/v1` prefix. |
| Discovery returns the v1 document (`OpenWOP-Version: 1.11` on the response) | You forgot the `OpenWOP-Version: 2` request header. |

If something else doesn't work, file an issue at <https://github.com/openwop/openwop/issues>. The v2 reference host is supposed to "just work" for this guide.
