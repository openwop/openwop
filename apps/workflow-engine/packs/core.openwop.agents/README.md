# core.openwop.agents

Agent composition primitives. Mirrors n8n's root+sub-node design — `agent.run` is the root, the rest are sub-nodes wired into typed input slots. Composes via RFC 0013 workflow-chain expansion; consumes existing `host.aiProviders` for model calls and `host.agentRuntime` for orchestration.

| typeId | role | purpose |
|---|---|---|
| `core.agents.run` | side-effect (root) | Top-level agent loop. Consumes sub-nodes (tool, memory, model, output-parser). |
| `core.agents.tool-function` | declaration | Declares a tool with JSON-Schema args + a handler reference. |
| `core.agents.tool-workflow` | declaration | Wraps another workflow as a tool. |
| `core.agents.tool-mcp` | declaration | Wraps an MCP tool from a connected server. |
| `core.agents.tool-http` | declaration | Wraps an OpenAPI / HTTP op as a tool. |
| `core.agents.memory-window` | side-effect (sub) | Recent-N-message buffer. |
| `core.agents.memory-summary` | side-effect (sub) | LLM-rollup summary memory. |
| `core.agents.memory-kv-store` | side-effect (sub) | Long-lived KV-backed memory via `core.openwop.storage`. |
| `core.agents.output-parser-structured` | pure (sub) | JSON-Schema-typed output validator. |
| `core.agents.output-parser-list` | pure (sub) | Newline-delimited list parser. |
| `core.agents.output-parser-auto-fix` | side-effect (sub) | Retries with parser feedback on validation failure. |
| `core.agents.model-selector` | pure (sub) | Dynamic model routing based on input characteristics. |
