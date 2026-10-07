# Incident Response Runbook

How maintainers respond to a security incident in the OpenWOP corpus or the pack registry. [`SECURITY.md`](../../SECURITY.md) is the disclosure policy: reporting channels, response SLA and the 90-day embargo. This runbook is the procedure that sits behind it.

Registry operations (hosting, deploys, uptime monitoring, index builds, signing-key files) live in [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry). This runbook covers what the protocol requires of a response; that repository covers how its tooling carries it out.

The rules a response must respect are in [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) §"Signing" and §"Version manifests", and [RFC 0222](../../RFCS/0222-v2-registry-operations.md).

---

## Severity classification

Classify every incident before responding. The `severity` field of a registry security advisory ([`schemas/v2/security-advisory.schema.json`](../../schemas/v2/security-advisory.schema.json)) maps onto this rubric: `critical` = S0, `high` = S1, `medium` = S2, `low` = S3.

| Severity          | Meaning                                                                                                     | Response time                                              | Public disclosure                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| **S0 — Critical** | Signing key in unauthorized hands, malicious code in a published tarball, registry compromised              | Under 1h to mitigation, public statement within 24h        | Yes — coordinated disclosure required   |
| **S1 — High**     | Exploitable vulnerability (CVSS 7.0+) in a pack, the corpus or the conformance suite; registry serving wrong content | Under 4h to mitigation, public statement within 7 days | Yes — within the 90-day default window |
| **S2 — Medium**   | Vulnerability with theoretical impact (CVSS 4.0–6.9); data loss in edge cases                               | Under 24h to mitigation, disclosed at the next release     | Patch first, disclose in release notes  |
| **S3 — Low**      | Cosmetic issues, performance regressions, documentation errors                                              | Normal triage                                              | No coordinated disclosure               |

---

## Incident class 1: vulnerability report

A vulnerability in a published pack, a schema, the conformance suite or the spec itself. Reports arrive through the channels in `SECURITY.md` §2. A public disclosure with no prior report is S0.

1. **Acknowledge** within the `SECURITY.md` §3 SLA and tell the reporter the expected timeline.
2. **Open a private GitHub Security Advisory** on the affected repository and use its private fork for the fix.
3. **Score it** with CVSS 4.0 and work out who is affected. If the registry has no download data, notify every known consumer.
4. **Request a CVE** through the advisory (GitHub is a CNA for projects it hosts). Use `CVE-YYYY-XXXX` as a placeholder until the ID is assigned.
5. **Fix it.**
   - For a pack: bump the version (patch for a security backport, minor if behavior changes), sign it with an `active` key, and publish the fixed version.
   - For the corpus or suite: ship a patch release. A fix that breaks the wire follows the safety-fix path in [`COMPATIBILITY.md`](../../COMPATIBILITY.md) §3.
6. **Yank the vulnerable pack versions** at the same moment the fix publishes. Add a registry advisory whose `affected[]` range names them; `packs.md` requires every advisory-listed version to be yanked. Set `yankedReason` to the CVE ID and a one-line description. Mechanics: [`PACK-LIFECYCLE.md`](./PACK-LIFECYCLE.md).
7. **Disclose.** Tell the reporter the fix is live, publish the advisory, add a security entry to `CHANGELOG.md`, and announce it.

A yanked version stays served: its manifest, tarball and signature still return, a version range skips it, and the pack index does not name it `latest` while an unyanked version exists. Verify the yank by checking the version manifest shows `yanked: true` and the index's `latest` moved.

---

## Incident class 2: malicious code in a published pack

S0 by default. Found by an audit of a tarball, a consumer report, or the publisher's own CI.

1. **Yank every version of the pack within one hour**, not only the one with confirmed bad code, and add an advisory covering them.
2. **Remove the bytes if they are harmful to serve.** The yank rule keeps a yanked tarball served, which is right for a vulnerable pack and wrong for malware. Taking a malicious tarball down is an operator decision outside the protocol; record it in the advisory.
3. **Handle the key.** If the signing key may be compromised, follow incident class 3.
4. **Investigate.** Was the tarball changed after the publisher signed it, or was the key used by someone else? Audit every pack signed by the same key in the same window. Preserve logs, build records and key-access records.
5. **Make a public statement within 24 hours**: the advisory, a notice on the registry, and direct notice to known consumers.
6. **Recover.** The publisher rebuilds from clean source and signs with a new key. Compromised versions stay yanked for good.

---

## Incident class 3: signing-key compromise

A publisher's private key may be in someone else's hands: lost hardware, anomalous key-access logs, evidence from class 2, or a key holder who left without offboarding.

1. **Within one hour, stop the key signing anything new.** Change its `status` in the registry's `.well-known/openwop-registry.json` `signingKeys[]` to any value other than `active` (for example `suspended`). Only an `active` key may sign a new publication.
2. **Keep the key listed.** `packs.md` requires a key to stay listed while any served version names it, and a verifier does not refuse a version because its key is not `active`. Removing the key does not protect consumers; yanking does.
3. **Yank every version the key signed** whose provenance you cannot confirm, and add an advisory covering them.
4. **Register a new key** on clean infrastructure, with the same `permittedNamespaces` ([`VENDOR-ONBOARDING.md`](./VENDOR-ONBOARDING.md)).
5. **Republish under the new key.** Re-sign each affected pack and give it a new patch version. A published version cannot be republished, and a new number avoids cache confusion.
6. **Publish a statement** with a migration note for consumers: which versions to replace and with what.

Planned rotation, as opposed to compromise, is in [`KEY-ROTATION.md`](./KEY-ROTATION.md).

---

## Incident class 4: registry outage or wrong content

The registry is unreachable, or serves content that does not match what was published. Monitoring, hosting and deploy procedures for the registry are in [`openwop/openwop-registry`](https://github.com/openwop/openwop-registry); follow them there.

From the protocol side:

1. **Check scope**: the registry root, the pack index, `.well-known/openwop-registry.json`, and a known version manifest.
2. **Wrong content is S1.** A served `integrity` or signature that no longer matches its tarball means a consumer verifying correctly will refuse the pack (`pack_integrity_failure`, `pack_signature_invalid`). Treat a mismatch as possible tampering until shown otherwise.
3. **Communicate**: open an issue with the `incident` label and post the status and expected recovery time.

---

## After any incident

- Write a post-mortem within five business days of resolution.
- Update this runbook if the incident exposed a step that was missing or wrong.

Maintainers SHOULD run a tabletop exercise of one incident class each quarter: walk every step against a private fork and fix what was unclear.

## Escalation

The reporter MUST be acknowledged within the severity's response time. If the on-call maintainer is unreachable, escalate to the next contact in [`MAINTAINERS.md`](../../MAINTAINERS.md).

## See also

- [`SECURITY.md`](../../SECURITY.md) — disclosure policy
- [`PACK-LIFECYCLE.md`](./PACK-LIFECYCLE.md) — deprecate and yank
- [`KEY-ROTATION.md`](./KEY-ROTATION.md) — planned key rotation
- [`VENDOR-ONBOARDING.md`](./VENDOR-ONBOARDING.md) — registering a publisher key
- [`spec/v2/core/packs.md`](../../spec/v2/core/packs.md) — signing, version manifests, registry errors
- [RFC 0222](../../RFCS/0222-v2-registry-operations.md) — v2 registry operations
