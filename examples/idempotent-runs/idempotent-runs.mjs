// Idempotent-runs example — demonstrates Layer-1 idempotency per
// spec/v1/idempotency.md.
//
// Sends POST /v1/runs three times with the same Idempotency-Key and
// the same body. Per the spec, the first call creates a run; the
// second and third calls return the cached response with
// `openwop-Idempotent-Replay: true`. All three responses share the same
// runId.
//
// Then attempts a fourth call with the same key but a different body.
// Per the spec, this returns 409 idempotency_key_conflict.
//
// Configuration via env vars:
//   OPENWOP_BASE_URL  default http://127.0.0.1:3737
//   OPENWOP_API_KEY   default openwop-inmem-dev-key
//
// Zero external dependencies — Node 20+ fetch.

import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.OPENWOP_BASE_URL ?? 'http://127.0.0.1:3737';
const API_KEY = process.env.OPENWOP_API_KEY ?? 'openwop-inmem-dev-key';

async function postRun(idempotencyKey, body) {
  const res = await fetch(`${BASE_URL}/v1/runs`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    replay: res.headers.get('openwop-idempotent-replay'),
    body: await res.json().catch(() => null),
  };
}

async function main() {
  const key = `idempotent-example-${randomUUID()}`;
  const body = {
    workflowId: 'conformance-idempotent',
    inputs: { nonce: 'first-attempt' },
  };

  console.log(`Idempotency-Key: ${key}`);
  console.log(``);

  console.log(`→ Call 1 (fresh)`);
  const a = await postRun(key, body);
  console.log(`  status:  ${a.status}`);
  console.log(`  runId:   ${a.body?.runId}`);
  console.log(`  replay:  ${a.replay}`);

  console.log(`→ Call 2 (same key, same body — expect cached replay)`);
  const b = await postRun(key, body);
  console.log(`  status:  ${b.status}`);
  console.log(`  runId:   ${b.body?.runId}`);
  console.log(`  replay:  ${b.replay}`);

  console.log(`→ Call 3 (same key, same body — expect cached replay)`);
  const c = await postRun(key, body);
  console.log(`  status:  ${c.status}`);
  console.log(`  runId:   ${c.body?.runId}`);
  console.log(`  replay:  ${c.replay}`);

  console.log(``);
  if (a.body?.runId !== b.body?.runId || a.body?.runId !== c.body?.runId) {
    console.error(`✗ runIds differ across replays`);
    process.exit(1);
  }
  console.log(`✓ All three responses share runId ${a.body?.runId}`);

  console.log(``);
  console.log(`→ Call 4 (same key, DIFFERENT body — expect 409 conflict)`);
  const conflict = await postRun(key, {
    workflowId: 'conformance-idempotent',
    inputs: { nonce: 'DIFFERENT-attempt' },
  });
  console.log(`  status: ${conflict.status}`);
  console.log(`  error:  ${conflict.body?.error}`);

  if (conflict.status !== 409) {
    console.error(`✗ Expected 409 idempotency_key_conflict`);
    process.exit(1);
  }
  console.log(`✓ Body conflict correctly rejected`);
}

main().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
