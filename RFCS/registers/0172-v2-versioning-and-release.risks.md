# RFC 0172 — Risk register

| ID | Risk | Likelihood | Impact | Score | Mitigation | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | A v1 client with a `/v1/v1` workaround (RFC 0147 R6) composes an unversioned v2 path and hits a v2 operation by accident | L | H | Medium | A `/v1/`-shaped request never reaches an unversioned key; a request with no header on an unversioned path is served as `preferredVersion` and carries `OpenWOP-Version` in the response, so the mismatch is loud | Reference-host maintainer | `mitigated` |
| R2 | Two majors on one origin double the host's routing surface and the SDK path manifests diverge | M | M | Medium | One generated path manifest with a `major` column; `check-path-parity.mjs`; the v1 rows are frozen | Spec Architect | `open` |
| R3 | The `engineVersion` codemod rewrites a string that was never the integer rendering | L | M | Low | The transform refuses anything outside `^(0\|[1-9][0-9]*)$`; refusal fixture committed | Conformance Architect | `mitigated` |
| R4 | Generated `info.version` makes a stale corpus tag look current | L | M | Low | The identity check compares the packed tree to the published tarball per file; a generated number cannot lie about content | Steward | `mitigated` |
