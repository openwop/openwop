# MCP Tool

Demonstrates the discovery + observation pattern for an OpenWOP workflow that calls MCP tools. OpenWOP runs the workflow; MCP exposes tools to the LLM nodes inside it.

| Profile required | Vendor-extension probe (looks for `mcp.*` advertisement under any vendor prefix) |
| Host target      | Any host advertising MCP under a vendor prefix in `/.well-known/openwop` |
| Run modes        | Discovery-only (default) / full lifecycle (with `OPENWOP_WORKFLOW_ID`) |

## Why "vendor-extension probe" rather than a profile

Per `spec/v1/host-extensions.md`, host-implementation-specific advertisements (`openwop.mcp`, `vendor.acme.mcp`, etc.) live under vendor-prefixed namespaces in `/.well-known/openwop`. There's no `openwop-mcp` profile in the closed catalog at `spec/v1/profiles.md` because (a) the OpenWOP+MCP integration pattern is host-deployment-specific and (b) the closed catalog is RFC-gated.

When the maintainer set decides MCP support warrants a profile, this example will gate on `openwop-mcp` instead of probing.

## Run

### Discovery probe (default)

```bash
OPENWOP_BASE_URL=https://your-host.example \
OPENWOP_API_KEY=$YOUR_KEY \
  npm start
```

Prints the host's MCP advertisement (if any) and exits. Safe to run anywhere — the probe doesn't create runs.

### Full lifecycle

Set `OPENWOP_WORKFLOW_ID` to a workflow that uses an MCP tool:

```bash
OPENWOP_BASE_URL=https://... \
OPENWOP_API_KEY=$YOUR_KEY \
OPENWOP_WORKFLOW_ID=your-mcp-using-workflow \
  npm start
```

The example creates a run, polls the event stream for tool-call events, and reports observability.

## What this teaches

- **Discovery-first probe pattern.** Read `/.well-known/openwop`; look for vendor-prefixed MCP advertisement; exit gracefully if absent.
- **Host-extension namespace conventions.** `mcp` MAY live at the top level OR under a vendor prefix (`openwop.mcp`, `vendor.acme.mcp`). The example checks both.
- **Tool-call event observability.** openwop's event stream emits tool-call lifecycle events; the example heuristically detects them by event-type substring matching.

## Why this example doesn't bundle a live MCP server

Real MCP integration requires:
- A registered MCP server with stable transport (stdio or HTTP)
- The host's MCP client wiring (server discovery, tool catalog, invocation routing)
- Workspace-level approval for which MCP servers can be invoked

All three are host-deployment specifics. An example that depends on a specific MCP server in a specific deployment can't demonstrate the protocol composition pattern to readers with different stacks. The example shows what's portable: the discovery + observation flow.

To exercise full MCP composition, point the example at a host that has MCP wired AND has a workflow that uses an MCP tool.

## Trust-boundary discipline

Per `SECURITY/threat-model-prompt-injection.md`:

- `prompt-injection-mcp-marker` — MCP tool responses MUST be wrapped in `<UNTRUSTED tool="...">` markers in the next LLM turn.
- `prompt-injection-mcp-no-approval` — MCP tool responses MUST NOT advance HITL approval gates.
- `prompt-injection-tool-allowlist` — LLM-emitted tool-call envelopes MUST be validated against the workflow's declared tools allowlist.

These invariants are host-side; this example doesn't exercise them directly. The conformance suite's `interrupt-approval.test.ts` covers the no-approval invariant; `redactionAdversarial.test.ts` covers the marker discipline tangentially.

## See also

- [`../../spec/v1/mcp-integration.md`](../../spec/v1/mcp-integration.md) — full OpenWOP+MCP composition pattern
- [`../../spec/v1/host-extensions.md`](../../spec/v1/host-extensions.md) — vendor-extension namespace conventions
- [`../../SECURITY/threat-model-prompt-injection.md`](../../SECURITY/threat-model-prompt-injection.md) — MCP-specific invariants
- [Model Context Protocol](https://modelcontextprotocol.io) — canonical MCP spec
