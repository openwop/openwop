/**
 * Host-callback declaration — which scenarios need the HOST to reach the suite.
 *
 * ## The rule
 *
 * A scenario that requires the host to **originate a connection back to the
 * harness** MUST declare it:
 *
 * ```ts
 * export const REQUIRES_HOST_CALLBACK = 'the host exports OTLP to the suite collector';
 * ```
 *
 * ## Why a declaration and not a detector
 *
 * The suite advertises harness-hosted endpoints to the host — a fake A2A peer,
 * an MCP server, an OIDC issuer, an OTLP collector — and in-process that
 * advertisement is free loopback. **It stops being free the moment the host is
 * not the harness process.** From a container, VM, or remote origin,
 * `127.0.0.1` is *that* environment, so the call never lands. The scenario does
 * not fail because the host is non-conformant; it fails because there is no
 * route.
 *
 * That is a networking property, not a measurement, and it holds for any
 * consumer running the suite against anything that is not the harness process.
 *
 * **A detector cannot decide this reliably, and trying taught us why.** A first
 * pass that grepped for URL-shaped identifiers flagged `form-content-packs`
 * (where `webhookUrl` is a field name the scenario *forbids*) and
 * `interrupt-external-event-correlation` (where `callbackUrl` flows host →
 * suite, the opposite direction). It also missed the OTLP collector entirely,
 * because nothing in those scenarios names a URL at all. **Two false positives
 * and a false negative on the first attempt** — a list built that way would be
 * wrong in both directions while looking authoritative.
 *
 * So the author declares, because the author knows which way the connection
 * goes. The gate below enforces the declaration where the signal is
 * unambiguous.
 *
 * ## What the gate is, and is not
 *
 * `host-callback-declaration.test.ts` requires the declaration on every scenario
 * importing a module from {@link HARNESS_DOUBLE_MODULES}. That signal is
 * unambiguous: those modules exist to stand up a server the host must reach.
 *
 * **It is a floor, not an oracle.** A scenario that constructs a
 * harness-reachable URL some other way is callback-shaped and the gate will not
 * notice. Saying so here is the point — a gate whose limits are unstated reads
 * as completeness it does not have, which is the failure this whole program
 * exists to close.
 *
 * ## What the declaration buys
 *
 * A consumer running the suite off-process can enumerate, **before running**,
 * which scenarios cannot be witnessed in their environment:
 *
 * ```sh
 * grep -l REQUIRES_HOST_CALLBACK node_modules/@openwop/openwop-conformance/src/scenarios/*.ts
 * ```
 *
 * That converts a silent unwitnessable set into a list they can plan around —
 * and RFC 0148 §A resolves an unwitnessed requirement to `blocked` rather than
 * to a pass, which a consumer can only honour if they know which ones they are.
 */

/**
 * Modules that stand up a harness-hosted server the host must reach.
 *
 * Derived from the library rather than remembered: these are the modules
 * exposing an `endpoint()` a scenario hands to the host. The first informal
 * account of this class named three (compat provider, OIDC issuer, webhook
 * subscriber) and **missed the OTLP collector, which has the most consumers of
 * any of them** — which is why this list lives next to the gate that reads it
 * instead of in prose someone has to keep true.
 */
export const HARNESS_DOUBLE_MODULES: readonly string[] = [
  'a2a-fake-peer',
  'mcp-fake-server',
  'oidc-issuer',
  'otel-collector',
];

/**
 * The declaration a callback-shaped scenario exports.
 *
 * The value is the REASON — which connection the host must originate — not a
 * bare `true`. A boolean records that somebody ticked a box; a sentence records
 * what a consumer needs to route, and is checkable against the scenario body by
 * anyone reading the diff.
 */
export type HostCallbackDeclaration = string;
