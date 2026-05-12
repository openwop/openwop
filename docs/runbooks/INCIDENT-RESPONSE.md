# Incident Response Runbook

> **Status: v1 (2026-05-12).** Procedures for the four most-likely registry-side incident classes: vulnerability disclosure, pack compromise, key compromise, registry downtime. Pairs with `docs/runbooks/PACK-LIFECYCLE.md` (yank/deprecate mechanics) + `SECURITY.md` (disclosure policy).

This runbook is for openwop project maintainers + vendor registered-publisher accounts. Triggers are described per-incident; each incident has explicit owner + action + verification steps.

---

## Severity classification

Before responding to any incident, classify severity:

| Severity | Meaning | Response time | Public disclosure |
|---|---|---|---|
| **S0 — Critical** | Key compromise (private key in unauthorized hands), supply-chain attack (malicious code in a published tarball), registry compromised | <1h to mitigation, public statement within 24h | YES — coordinated disclosure required |
| **S1 — High** | Pack vulnerability with active exploitability (CVE-rated 7.0+), registry serving wrong content | <4h to mitigation, public statement within 7 days | YES — within the 90-day default window |
| **S2 — Medium** | Pack vulnerability with theoretical impact (CVE 4.0–6.9), pack causing data loss in edge cases | <24h to mitigation, public statement at next scheduled release | Patch first, disclose with release notes |
| **S3 — Low** | Cosmetic issues, performance regressions, docs errors | Triaged in normal sprint cadence | No coordinated disclosure |

---

## Incident class 1: Pack vulnerability (CVE)

### Trigger

A security researcher (internal or external) reports a vulnerability in a published pack. Reports come via:

- Email to the address in `SECURITY.md`
- GitHub Security Advisory on `openwop/openwop`
- Direct DM to a maintainer
- Public disclosure (worst case — go to S0 immediately)

### Step-by-step (S1/S2)

1. **Acknowledge within 24h** (S1) / 72h (S2). Email the reporter confirming receipt + estimated remediation timeline.

2. **Open a private GitHub Security Advisory** on `openwop/openwop`. Use the advisory's private fork mechanism for the patch.

3. **Triage severity**:
   - CVSS 4.0 to assign a numeric severity score
   - Identify the impact radius: which consumers have installed the vulnerable pack? (Query `packs.openwop.dev` download metrics if instrumented; otherwise broadcast to all consumers as a precaution)

4. **Reserve a CVE ID** via Mitre or your CNA (`cve.mitre.org/cgi-bin/CVERequest.cgi`). Use the placeholder `CVE-YYYY-XXXX` in patch artifacts until the real ID is assigned.

5. **Patch the pack**:
   - Author the fix in a private fork
   - Bump SemVer (patch for security backport; minor if behavior changes)
   - Build + sign + open the publish PR in the private advisory

6. **Yank the vulnerable version(s)** AT THE SAME TIME as publishing the patch:
   - Follow `docs/runbooks/PACK-LIFECYCLE.md` §"Yank"
   - `yankedReason`: cite the CVE ID + one-line description
   - `advisoryUrl`: point to the GitHub Security Advisory

7. **Coordinated disclosure**:
   - Notify the reporter the patch is live
   - Publish the GitHub Security Advisory (makes it public)
   - Update `CHANGELOG.md` with a security entry
   - Post to openwop announcement channels

### Verification

```bash
# Yanked version returns 404 (or 410) on the tarball
curl -sI https://packs.openwop.dev/v1/packs/<name>/-/<vulnerable-version>.tgz
# Version manifest shows yanked: true
curl -s https://packs.openwop.dev/v1/packs/<name>/-/<vulnerable-version>.json | jq .yanked
# New patched version installable
curl -s https://packs.openwop.dev/v1/packs/<name>/-/<patched-version>.json | jq .integrity
```

---

## Incident class 2: Pack compromise (malicious code shipped)

### Trigger

A pack tarball at `packs.openwop.dev` is found to contain malicious code (e.g., backdoor, data exfiltration). This is S0 by default.

Detection paths:

- Security audit of published tarball
- Consumer report of unexpected behavior
- Vendor's CI finds untrusted bytes in their own tarball after publish

### Step-by-step (S0)

1. **Immediate yank — within 1 hour**:
   - Yank ALL versions of the compromised pack (not just the one with confirmed bad code)
   - Follow `docs/runbooks/PACK-LIFECYCLE.md` §"Yank" but **also delete the tarball files** in the same PR (Firebase Hosting doesn't auto-purge):
     ```bash
     rm registry/v1/packs/<name>/-/*.tgz
     rm registry/v1/packs/<name>/-/*.sig
     ```
   - Title PR `[YANK-COMPROMISE] <pack-name>` for visibility

2. **Suspend the publisher key** (if the compromise reached the publisher's signing infrastructure):
   - Edit `.well-known/openwop-registry.json` `signingKeys[]` for the affected key:
     ```json
     { "keyId": "<org>-internal-1", "status": "suspended", ... }
     ```
   - Hosts running `verified` mode MUST refuse to install ANY pack signed by a suspended key

3. **Forensics**:
   - Determine the attack vector: was the tarball tampered with after vendor sign-off? Was the vendor's signing key compromised?
   - Audit other packs signed by the same key in the same window
   - Preserve forensic evidence: log retention, build-pipeline audit trails, key access logs

4. **Public statement within 24h**:
   - GitHub Security Advisory
   - Banner on `packs.openwop.dev` (Firebase Hosting allows custom 503 / banner content)
   - Direct notification to all known consumers (via vendor lists + GitHub issue notifications)

5. **Recovery**:
   - If key compromise: follow §"Incident class 3" below for key rotation
   - If supply-chain (build pipeline) compromise: vendor MUST rebuild from clean source + re-sign all valid packs with a NEW key
   - Old versions remain yanked permanently (immutable — no un-yank for compromise events)

---

## Incident class 3: Key compromise

### Trigger

A publisher's private signing key is suspected to be in unauthorized hands. Triggers:

- Vendor reports key loss (laptop stolen, HSM access logs anomaly)
- Forensic evidence from a pack-compromise incident
- Key holder ceases employment without proper offboarding

### Step-by-step (S0)

1. **Within 1 hour: mark the key suspended** in `.well-known/openwop-registry.json`:
   ```json
   {
     "keyId": "<org>-internal-1",
     "status": "suspended",
     "suspendedAt": "<timestamp>",
     "suspendedReason": "<one-line>",
     ...
   }
   ```

2. **Yank-all-pack-versions signed by the suspended key**:
   - Iterate every pack version manifest in the affected namespace
   - If `signing.keyId === <suspended-key-id>`, mark `yanked: true`
   - Bulk via:
     ```bash
     for f in registry/v1/packs/vendor.<org>.*/-/*.json; do
       if grep -q "\"keyId\": \"<org>-internal-1\"" "$f"; then
         # Edit f to set yanked: true
       fi
     done
     ```
   - Run `node registry/scripts/build-index.mjs` to update indices

3. **Generate a NEW key on uncompromised infrastructure**:
   - Vendor follows `docs/runbooks/VENDOR-ONBOARDING.md` to register `<org>-internal-2`
   - The new key gets the same `permittedNamespaces` as the compromised one

4. **Re-sign + re-publish each yanked pack with the new key**:
   - For each yanked version: rebuild the tarball with `build-pack-tarball.mjs --signed --key <new-key> --key-id <org>-internal-2`
   - **Bump the SemVer** (patch) so the re-signed version has a different version number from the yanked one. This prevents consumer-cache confusion.
   - Open a single batched PR with all re-signed packs

5. **After all packs re-published**: open a final PR removing the suspended key entry entirely from `signingKeys[]` + deleting the `.pub` file from `registry/keys/`.

6. **Public statement**: same coordination as Incident class 1+2. Include a clear migration guide for consumers ("uninstall `<name>@<old-version>`, install `<name>@<new-version>`").

---

## Incident class 4: Registry downtime

### Trigger

`packs.openwop.dev` becomes unreachable or serves wrong content. Detected via:

- Cloud Monitoring uptime check failure on the `packs-openwop-dev-uptime-failure` alert policy (set up via `scripts/setup-uptime-check.sh`)
- Maintainer-side `curl -I https://packs.openwop.dev/` failing
- Consumer reports of install failures

### Step-by-step

1. **Verify scope** of the outage:
   ```bash
   curl -I https://packs.openwop.dev/
   curl -I https://packs.openwop.dev/v1/index.json
   curl -I https://packs.openwop.dev/keys/openwop-registry-root.pub
   ```
   - All 200: registry up, problem is elsewhere
   - Some 5xx: Firebase Hosting issue, check Firebase status page
   - All DNS-fail: Fastly CDN or DNS issue

2. **Identify the layer**:
   - Firebase Hosting: check `https://status.firebase.google.com/`
   - Fastly CDN: check `https://status.fastly.com/`
   - GitHub Actions (auto-deploy not running): check `https://www.githubstatus.com/`
   - DNS: check the domain registrar's panel

3. **Mitigation options** by layer:
   - Firebase Hosting outage: nothing to do, wait for upstream. Communicate ETA to consumers.
   - Stale content (CDN cache poisoning): `firebase hosting:clone --site packs-openwop-dev` to force-redeploy
   - Auto-deploy failure (WIF auth, IAM perms): manually deploy from operator workstation per `openwop/openwop#5–#8` runbook
   - DNS: contact registrar; consumer fallback is hardcoded IPs (won't work because Fastly POPs)

4. **Status page update**:
   - Open a GitHub issue with the `incident` label
   - Update `INTEROP-MATRIX.md` if persistent
   - Post to announcement channels with current status + ETA

5. **Post-mortem**:
   - Within 5 business days of resolution
   - Write up the incident in `docs/incidents/YYYY-MM-DD-<short-name>.md`
   - Update this runbook if a new failure mode was discovered

---

## Tabletop drill recommendation

Maintainers SHOULD run a tabletop exercise of one incident class per quarter to keep this runbook accurate. The drill:

1. Pick an incident class
2. Open a dry-run PR titled `[DRILL] <class>` against a private fork
3. Walk through every step in the runbook
4. Record where the runbook was unclear or out-of-date
5. Open a PR fixing the runbook gaps

---

## Contact escalation

Incident reporter MUST be acknowledged within the severity-class response time. If the on-call maintainer is unreachable, escalate to the secondary contact in `MAINTAINERS.md`.

Out-of-band channels (for cases where GitHub / email is unavailable):

- openwop project Signal channel (invite-only, see `MAINTAINERS.md`)
- Maintainer mobile phone tree (see `MAINTAINERS.md`)

---

## See also

- [`SECURITY.md`](../../SECURITY.md) — vulnerability disclosure policy
- [`docs/runbooks/PACK-LIFECYCLE.md`](./PACK-LIFECYCLE.md) — yank/deprecate mechanics
- [`docs/runbooks/VENDOR-ONBOARDING.md`](./VENDOR-ONBOARDING.md) — key registration (used during recovery)
- [`spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) §"Key rotation"
- [`MAINTAINERS.md`](../../MAINTAINERS.md) — escalation contacts + on-call rotation
