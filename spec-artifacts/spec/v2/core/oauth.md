# OAuth

> **Status: Stable · RFC 0046, RFC 0047.**
> **Normative home:** `oauth`, `credentials`.

## Why this exists

A connector node needs a token a user granted to a third party. The host obtains it, stores it, refreshes it and hands it to the node's sandbox, so a pack names a provider and scopes and never touches the grant. Here the host is an OAuth client; identity.md covers the host as a protected resource. The client rules, the MCP-reach paragraph and the credential interrupt below are RFC 0199 (`Active`).

## Credentials

A host advertising `credentials` MUST resolve a `{ ref, scope }` reference (`schemas/v2/credential-reference.schema.json`) at node execution and inject the material into the node sandbox only; it MUST NOT appear in inputs, variables, events, the debug bundle or replay state (invariant `credential-payload-redaction`). A failed resolution is `credential_not_found`, `credential_forbidden` (outside the caller's scope; fail closed) or `credential_scope_unsupported` (a scope not in `credentials.scopes`). With `credentials.sharing`, every reference within a scope resolves one stored credential. With `credentials.rotation` `two-key-overlap`, old and new material both resolve during the grace window and the old fails `credential_not_found` after it. `credentials.encryptionAtRest` is a claim about storage; it gates nothing.

## Token lifecycle

A host advertising `oauth` MUST perform only the grants in `oauth.grants` and MUST refuse to register a node whose `auth.provider` or scope is not in `oauth.providers` (`oauth_provider_unsupported`, `oauth_scope_unsupported`). It drives the redirect and callback host-side; the code, redirect URI, `state` and PKCE verifier MUST NOT enter a run-visible surface. Tokens persist as a `credentials` entry at scope `user` or `workspace` and are refreshed host-side. On terminal refresh failure the host MUST emit `connector.auth-expired` and fail the node with `connector_auth_expired`, unless it advertises `oauth.credentialInterrupt`.

## The authorization-code client

On every `authorization_code` grant the host MUST:

1. send PKCE with `S256` and never `plain`, omitting PKCE only for a provider advertised with `pkce: "unsupported"`;
2. send a fresh `state` of at least 128 bits from a CSPRNG, bound host-side to the initiating Subject and the provider, with a lifetime of at most 10 minutes, and refuse a callback whose `state` is absent, unknown, reused or expired, making no token request for it;
3. complete the callback only for the initiating Subject (invariant `oauth-same-user-binding`): store the credential under the Subject bound to `state`, and if the Subject authenticated on the callback request (session or bearer) differs from it, refuse and store nothing;
4. validate `iss` per RFC 9207 §2.4 where the provider's issuer is known (`oauth.providers[].issuer`), and otherwise give the provider a redirect URI no other provider shares (RFC 9700 §4.4.2);
5. use one fixed, registered redirect URI per provider.

Where the provider is reached as an MCP server, the host MUST also send `resource` (RFC 8707), the server's canonical URI, in both requests, and MUST refuse a provider whose authorization-server metadata omits `S256`. It fetches the server's Protected Resource Metadata (RFC 9728) only from URLs derived from the manifest's server URL. Discovery verifies and never selects: a discovered issuer or endpoint that differs from the manifest's, or from the tuple pinned at registration, MUST be refused `connection_auth_metadata_mismatch`, as MUST a grant for such a provider whose manifest declares no `issuer`.

## The credential interrupt

A host advertising `oauth.credentialInterrupt` MUST suspend the node with a `credential` interrupt (interrupt.md) instead of failing it when a node declaring `auth: { type: "oauth2", provider, scopes }` is about to run and no credential resolves for the Subject, provider and scopes (`reason: "missing"`), one resolves with fewer scopes (`"insufficient_scope"`), or refresh failed terminally (`"expired"`). `connectUrl` MUST be host-owned, MUST NOT be pre-authenticated, and MUST complete only for the initiating Subject. The host resolves the interrupt when the grant completes; a resolve of `authorized` MUST be refused `400 validation_error` unless a credential now resolves, and `declined` fails the node with `connector_auth_declined`.
