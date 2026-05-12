/**
 * Track 6: in-process synthetic A2A peer for state-projection conformance.
 *
 * The A2A protocol (https://a2a-protocol.org/) defines an `AgentCard` for
 * discovery plus a Task lifecycle whose `TaskState` enum drives most of
 * the conformance burden. We expose just enough of A2A v0.3 JSON-RPC
 * transport to let conformance scenarios drive the host through the
 * four documented drift points from `spec/v1/a2a-integration.md`
 * §"State projection".
 *
 * Endpoints (A2A v0.3 wire shape):
 *   GET  /.well-known/agent-card.json — AgentCard at the spec-mandated
 *                                       well-known path (per
 *                                       @a2a-js/sdk@0.3.13 `AGENT_CARD_PATH`)
 *   POST /a2a/jsonrpc                  — JSON-RPC dispatch:
 *                                          - method `message/send` →
 *                                            creates a Task, returns Task obj
 *                                          - method `tasks/get` → fetches Task
 *
 * Test fixtures set the *next* state transition via `setNextState(...)`
 * so a single scenario can walk the peer through SUBMITTED → WORKING →
 * INPUT_REQUIRED → COMPLETED (or AUTH_REQUIRED, or REJECTED) without
 * implementing a real agent. The internal API uses the UPPERCASE enum
 * from openwop's a2a-integration.md (which references the gRPC enum);
 * wire responses use the v0.3 JSON-RPC lowercase-hyphen form.
 *
 * @see spec/v1/a2a-integration.md §"State projection"
 * @see https://a2a-protocol.org/v0.3.0/specification
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type A2ATaskState =
  | 'UNSPECIFIED'
  | 'SUBMITTED'
  | 'WORKING'
  | 'INPUT_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'REJECTED';

/** Translate internal UPPERCASE state to A2A v0.3 wire form (lowercase + hyphen). */
function wireState(s: A2ATaskState): string {
  switch (s) {
    case 'UNSPECIFIED': return 'unknown';
    case 'SUBMITTED': return 'submitted';
    case 'WORKING': return 'working';
    case 'INPUT_REQUIRED': return 'input-required';
    case 'AUTH_REQUIRED': return 'auth-required';
    case 'COMPLETED': return 'completed';
    case 'FAILED': return 'failed';
    case 'CANCELED': return 'canceled';
    case 'REJECTED': return 'rejected';
  }
}

interface A2ATask {
  id: string;
  contextId: string;
  state: A2ATaskState;
  history: Array<{ role: 'user' | 'agent'; parts: unknown[] }>;
}

export interface A2APeerInvocation {
  readonly method: string;
  readonly path: string;
  readonly rpcMethod: string | null;
  readonly body: unknown;
  readonly timestamp: number;
}

export class A2AFakePeer {
  private _server: Server | null = null;
  private _boundPort = 0;
  private readonly _tasks = new Map<string, A2ATask>();
  private readonly _invocations: A2APeerInvocation[] = [];
  private _nextStateOverride: A2ATaskState | null = null;
  private _taskIdCounter = 0;

  async start(port: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this._handle(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        this._server = server;
        this._boundPort = addr.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._server) return;
    const server = this._server;
    this._server = null;
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  endpoint(): string {
    return `http://127.0.0.1:${this._boundPort}`;
  }

  reset(): void {
    this._tasks.clear();
    this._invocations.length = 0;
    this._nextStateOverride = null;
    this._taskIdCounter = 0;
  }

  invocations(): readonly A2APeerInvocation[] {
    return this._invocations;
  }

  taskCount(): number {
    return this._tasks.size;
  }

  /**
   * Force the next task created to immediately transition to this state.
   * Used by drift-point scenarios to drive AUTH_REQUIRED / REJECTED /
   * INPUT_REQUIRED paths deterministically.
   */
  setNextState(state: A2ATaskState | null): void {
    this._nextStateOverride = state;
  }

  /** Advance an existing task to a new state. Used by host-mediated tests. */
  advanceTask(taskId: string, state: A2ATaskState): boolean {
    const task = this._tasks.get(taskId);
    if (!task) return false;
    task.state = state;
    return true;
  }

  getTask(taskId: string): Readonly<A2ATask> | undefined {
    return this._tasks.get(taskId);
  }

  private _taskToWire(t: A2ATask): Record<string, unknown> {
    return {
      id: t.id,
      kind: 'task',
      contextId: t.contextId,
      status: { state: wireState(t.state) },
      history: t.history.map((m) => ({
        kind: 'message',
        role: m.role,
        parts: m.parts,
        messageId: `msg-${t.id}-${t.history.indexOf(m)}`,
      })),
    };
  }

  private async _handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '/';
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    if (bodyText.length > 0) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }

    const rpcMethod =
      body && typeof body === 'object' && body !== null && 'method' in body
        ? String((body as { method: unknown }).method)
        : null;

    this._invocations.push({
      method: req.method ?? 'GET',
      path: url,
      rpcMethod,
      body,
      timestamp: Date.now(),
    });

    // GET /.well-known/agent-card.json  — A2A v0.3 well-known path
    if (req.method === 'GET' && url.startsWith('/.well-known/agent-card.json')) {
      const card = {
        protocolVersion: '0.3.0',
        name: 'openwop-conformance-fake-a2a',
        description: 'Synthetic A2A peer for openwop conformance suite',
        url: `${this.endpoint()}/a2a/jsonrpc`,
        version: '1.0.0',
        capabilities: { streaming: false, pushNotifications: false },
        skills: [
          {
            id: 'echo',
            name: 'echo',
            description: 'Returns input verbatim',
            tags: ['echo'],
          },
        ],
        defaultInputModes: ['text'],
        defaultOutputModes: ['text'],
        additionalInterfaces: [
          { url: `${this.endpoint()}/a2a/jsonrpc`, transport: 'JSONRPC' },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(card));
      return;
    }

    // POST /a2a/jsonrpc  — A2A v0.3 JSON-RPC transport
    if (req.method === 'POST' && url === '/a2a/jsonrpc') {
      if (
        !body ||
        typeof body !== 'object' ||
        (body as { jsonrpc?: unknown }).jsonrpc !== '2.0'
      ) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid JSON-RPC envelope' },
          }),
        );
        return;
      }
      const rpc = body as { id?: string | number; method?: string; params?: unknown };

      if (rpc.method === 'message/send') {
        const taskId = `task-${++this._taskIdCounter}`;
        const contextId = `ctx-${taskId}`;
        const initial: A2ATaskState = this._nextStateOverride ?? 'SUBMITTED';
        this._nextStateOverride = null;
        const userMessage = (rpc.params as { message?: { parts?: unknown[] } } | undefined)
          ?.message;
        const task: A2ATask = {
          id: taskId,
          contextId,
          state: initial,
          history: userMessage
            ? [{ role: 'user', parts: userMessage.parts ?? [] }]
            : [],
        };
        this._tasks.set(taskId, task);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? null,
            result: this._taskToWire(task),
          }),
        );
        return;
      }

      if (rpc.method === 'tasks/get') {
        const params = (rpc.params ?? {}) as { id?: string };
        const task = params.id ? this._tasks.get(params.id) : undefined;
        if (!task) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id ?? null,
              error: { code: -32001, message: 'Task not found' },
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id ?? null,
            result: this._taskToWire(task),
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          error: { code: -32601, message: `Method not found: ${rpc.method}` },
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }
}

let _instance: A2AFakePeer | null = null;

export function setA2AFakePeer(p: A2AFakePeer | null): void {
  _instance = p;
}

export function getA2AFakePeer(): A2AFakePeer | null {
  return _instance;
}
