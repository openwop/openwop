# RFC 0238 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | The dispatch operation lets any authenticated client, not only a sandboxed plugin, call plugin methods, widening who can reach them. | M | M | Med | §C.5: the call runs as the caller and is authorized per method like the equivalent artifact operation, so it grants nothing the credential does not already hold. | Security Architect | `accepted` — authority is the caller's own. |
| R2 | A host serves a correct frame document for the witness but mounts plugins another way (an `srcdoc` with a weaker policy). | L | H | Med | §B.5 makes the frame the only mount; §B.3's `sandbox` directive holds wherever the document is embedded. The embedding itself is not observable (§Falsifiability). | Conformance Architect | `open` — a live hazard the suite cannot observe; reviewed with each host's certification. |
| R3 | Trusting the conformance signing key on a production host lets a fixture-signed pack load there. | L | M | Low | §D.1: trust is an explicit operator act, scoped to the fixture pack, never on by default; the fixture plugin has no `connectSrc` and only `artifact.read`. | Security Architect | `accepted` — operator opt-in, narrow pack. |
