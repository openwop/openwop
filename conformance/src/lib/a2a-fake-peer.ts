/**
 * Track 6: in-process synthetic A2A peer for state-projection conformance.
 *
 * The A2A protocol (https://a2a-protocol.org/) defines an `AgentCard` for
 * discovery plus a Task lifecycle whose `TaskState` enum drives most of
 * the conformance burden. We expose just enough of the HTTP+JSON
 * transport to let conformance scenarios drive the host through the
 * four documented drift points from `spec/v1/a2a-integration.md`
 * §"State projection".
 *
 * Endpoints (minimal):
 *   GET  /agent.json                 — AgentCard
 *   POST /tasks                      — create a task; returns { taskId, state: 'SUBMITTED' }
 *   GET  /tasks/{taskId}             — poll task state + last message
 *   POST /tasks/{taskId}/messages    — append a message (used by host to resume an INPUT_REQUIRED task)
 *
 * Test fixtures set the *next* state transition via `setNextState(...)`
 * so a single scenario can walk the peer through SUBMITTED → WORKING →
 * INPUT_REQUIRED → COMPLETED (or AUTH_REQUIRED, or REJECTED) without
 * implementing a real agent.
 *
 * @see spec/v1/a2a-integration.md §"State projection"
 * @see https://a2a-protocol.org/latest/specification/
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

interface A2ATask {
  taskId: string;
  state: A2ATaskState;
  messages: Array<{ role: 'user' | 'agent'; content: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface A2APeerInvocation {
  readonly method: string;
  readonly path: string;
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
      const server = createServer((req, res) => this._handle(req, res));
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

    this._invocations.push({
      method: req.method ?? 'GET',
      path: url,
      body,
      timestamp: Date.now(),
    });

    // GET /agent.json
    if (req.method === 'GET' && url.startsWith('/agent.json')) {
      const card = {
        protocolVersion: '0.3.0',
        name: 'openwop-conformance-fake-a2a',
        description: 'Synthetic A2A peer for openwop conformance suite',
        url: this.endpoint(),
        version: '1.0.0',
        capabilities: { streaming: false },
        skills: [
          {
            id: 'echo',
            name: 'echo',
            description: 'Returns input verbatim',
          },
        ],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(card));
      return;
    }

    // POST /tasks — create task
    if (req.method === 'POST' && url === '/tasks') {
      const taskId = `task-${++this._taskIdCounter}`;
      const initial: A2ATaskState = this._nextStateOverride ?? 'SUBMITTED';
      this._nextStateOverride = null;
      const task: A2ATask = {
        taskId,
        state: initial,
        messages: body && typeof body === 'object' ? [{ role: 'user', content: body }] : [],
      };
      this._tasks.set(taskId, task);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId, state: task.state }));
      return;
    }

    // GET /tasks/{taskId}
    const getMatch = url.match(/^\/tasks\/([^/?]+)$/);
    if (req.method === 'GET' && getMatch) {
      const task = this._tasks.get(decodeURIComponent(getMatch[1]));
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
      return;
    }

    // POST /tasks/{taskId}/messages — host resumes an INPUT_REQUIRED task
    const msgMatch = url.match(/^\/tasks\/([^/?]+)\/messages$/);
    if (req.method === 'POST' && msgMatch) {
      const task = this._tasks.get(decodeURIComponent(msgMatch[1]));
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      task.messages.push({ role: 'user', content: body });
      // Move from INPUT_REQUIRED back to WORKING then to COMPLETED for the
      // simple roundtrip. Tests that need a different next-state set it
      // via setNextState() before posting the message.
      task.state = this._nextStateOverride ?? 'COMPLETED';
      this._nextStateOverride = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ taskId: task.taskId, state: task.state }));
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
