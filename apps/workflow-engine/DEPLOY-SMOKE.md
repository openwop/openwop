# Live-deploy smoke test — app.openwop.dev

**Last run:** 2026-05-17 ~16:55 UTC, against the live deploy.

Repeat this whenever the backend redeploys to confirm the full
cookie-auth + cookie-scoped-state + admin-cleanup loop works
end-to-end.

```bash
BASE="https://app.openwop.dev/api"
CJAR=/tmp/smoke-cookies.txt
rm -f $CJAR

# 1. Well-known capabilities (no auth)
curl -s "$BASE/.well-known/openwop" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('protocol:', d['protocolVersion']); print('surfaces:', len(d['capabilities']['hostSurfaces'])); print('aiProviders:', d['capabilities']['aiProviders']['supported'])"

# 2. Catalog (mints openwop.session cookie)
curl -s -c $CJAR -i "$BASE/v1/host/sample/node-catalog" | grep -i set-cookie | head -1
curl -s -b $CJAR "$BASE/v1/host/sample/node-catalog" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('nodes:', len(d['nodes']), 'runnable:', sum(1 for n in d['nodes'] if not n.get('missingHostSurfaces')))"

# 3. Register a sample workflow under the cookie's tenant
curl -s -b $CJAR -c $CJAR -X POST -H 'content-type: application/json' \
  "$BASE/v1/host/sample/workflows" \
  -d '{"workflowId":"smoke-uppercase","nodes":[{"nodeId":"shout","typeId":"local.sample.demo.uppercase"}]}'

# 4. Create a run — body omits tenantId, cookie provides it
RUNID=$(curl -s -b $CJAR -c $CJAR -X POST -H 'content-type: application/json' \
  "$BASE/v1/runs" -d '{"workflowId":"smoke-uppercase","inputs":{"text":"hello demo"}}' | \
  python3 -c "import json,sys; print(json.load(sys.stdin)['runId'])")
echo "runId: $RUNID"

# 5. Fetch snapshot
sleep 1
curl -s -b $CJAR "$BASE/v1/runs/$RUNID" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print('status:', d['status'])"

# 6. Admin cleanup (Bearer the OPENWOP_ADMIN_TOKEN from Secret Manager)
ADMIN=$(gcloud secrets versions access latest --secret=openwop-admin-token)
curl -s -X POST -H "Authorization: Bearer $ADMIN" \
  "$BASE/v1/host/sample/admin/cleanup" | python3 -m json.tool

# 7. /privacy page reachable
curl -sI https://app.openwop.dev/privacy | head -1
```

## Expected vs. actual (2026-05-17)

| Step | Expected | Actual |
|---|---|---|
| 1 | protocol 1.1, 17 surfaces, 3 providers | ✓ matches |
| 2 | Set-Cookie + nodes ≥ 270 + runnable ≥ 220 | ✓ 279 nodes / 226 runnable |
| 3 | `{"workflowId":"smoke-uppercase","nodeCount":1}` | ✓ |
| 4 | runId UUID returned | ✓ `64eca91c-2be1-...` |
| 5 | `status: completed` (or `running`/`waiting-*` if HITL) | ✓ `completed` |
| 6 | `{ok:true, activeTenants:N, wipedSecrets:M}` | ✓ `ok:true, active:15` |
| 7 | HTTP 200 | ✓ `HTTP/2 200` |

## What this proves

- Firebase Hosting → Cloud Run `/api/**` rewrite working end-to-end.
- Backend `/api` prefix strip correct (`/api/v1/...` → `/v1/...`).
- Session cookie minted with the right attributes (HttpOnly, Secure,
  SameSite=Lax, Max-Age=86400, HS256 signature).
- Cookie-scoped tenant isolation working — body omits `tenantId`,
  cookie's `anon:<sid>` is used.
- 17 published packs install + register cleanly at backend cold start
  (the patched `core.openwop.{http@1.1.1, rag@1.0.1, crypto@1.0.1}`
  are part of the install set).
- Admin cleanup endpoint authorized via the Bearer admin token (NOT
  via the cookie path), runs idempotently.
- `/privacy` page deep-links work under the SPA fallback rewrite.

## What this does NOT prove

- Browser-level UX (SSE event streaming, BYOK panel, builder
  drag/drop) — needs a manual browser session.
- Cert provisioning — currently `CERT_PROPAGATING` with TEMPORARY
  cert; long-lived cert lands automatically.
- Rate-limit thresholds — would need to fire >10 runs/min against
  the same cookie to confirm 429. Easy to add if needed.
