# OpenWOP, Serverless Workflow and BPMN

> Informative positioning note. OpenWOP v2 defines no mapping to or from CNCF Serverless Workflow or OMG BPMN 2.0, no exporter, no importer and no conformance scenario for either. Nothing here is evidence that any host converts between them.

## How they differ

[Serverless Workflow](https://serverlessworkflow.io/) and [BPMN 2.0](https://www.omg.org/spec/BPMN/2.0/) are workflow **definition** languages: they describe a process so an engine can run it. OpenWOP is a **runtime wire contract**: how a client starts, observes, pauses, resolves, replays and forks runs on a host, and how the host advertises what it supports ([`spec/v2/core/overview.md`](../../spec/v2/core/overview.md)).

The definition layers overlap. A `WorkflowDefinition` ([`schemas/v2/workflow-definition.schema.json`](../../schemas/v2/workflow-definition.schema.json)) is a declarative graph of nodes and edges, as a Serverless Workflow document or a BPMN `<process>` is, and the simple shapes line up (a task, a transition, a timer, a sub-workflow call, a human approval).

What has no counterpart in either standard is most of what OpenWOP exists for:

- the run, event and interrupt wire ([`runs.md`](../../spec/v2/core/runs.md), [`events.md`](../../spec/v2/core/events.md), [`interrupt.md`](../../spec/v2/core/interrupt.md));
- replay and fork with a byte-equivalent prefix ([`replay.md`](../../spec/v2/core/replay.md));
- agent, prompt and AI-provider semantics, including BYOK policy ([`execution.md`](../../spec/v2/core/execution.md), [`host-services.md`](../../spec/v2/core/host-services.md));
- the signed audit log and the other security defaults ([`security-defaults.md`](../../spec/v2/core/security-defaults.md));
- capability discovery ([`capabilities.md`](../../spec/v2/core/capabilities.md)).

Any conversion between an OpenWOP definition and either standard is therefore lossy in at least one direction. A host that offers one should say what it drops, and should refuse a construct it cannot represent rather than approximate it.

## Using them together

- **Already on Serverless Workflow or BPMN?** Keep that engine for the workflows it runs well, and run an OpenWOP host alongside it for AI and human-in-the-loop work. Bridge them over HTTP: the existing engine calls the OpenWOP REST API ([`api/v2/openapi.yaml`](../../api/v2/openapi.yaml)), or an OpenWOP node calls the existing engine.
- **Need a diagram for stakeholders?** Exporting a definition to BPMN for display is reasonable, as long as nobody expects the exported model to reproduce OpenWOP run semantics on another engine.

A normative mapping would need an RFC ([`RFCS/README.md`](../../RFCS/README.md)) backed by a host that ships an exporter, an importer and a round-trip fixture.

## See also

- [`durable-runtimes.md`](./durable-runtimes.md): running an OpenWOP host on Temporal, Restate, DBOS or Inngest.
- [`mcp.md`](./mcp.md): OpenWOP and the Model Context Protocol.
