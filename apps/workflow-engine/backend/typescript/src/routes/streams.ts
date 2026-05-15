/**
 * SSE event stream — `GET /v1/runs/{runId}/events`.
 *
 * Implements the four canonical stream modes per spec/v1/stream-modes.md:
 *   - values   — final node outputs only
 *   - updates  — every state transition (default)
 *   - messages — only `*.message` and chat-shaped events
 *   - debug    — full event log, no filtering
 *
 * Last-Event-ID resume: client reconnects with the header set; we
 * replay events with sequence > parsed value, then attach to the live
 * stream.
 *
 * Mode is selected via `?mode=<modes,comma,separated>` (default updates).
 */

import type { Express, Response } from 'express';
import type { StreamMode } from '@openwop/openwop';
import type { Storage } from '../storage/storage.js';
import { OpenwopError, type EventRecord } from '../types.js';
import { getEventLog } from '../executor/eventLog.js';

const VALID_MODES: readonly StreamMode[] = ['values', 'updates', 'messages', 'debug'];

interface Deps {
  storage: Storage;
}

export function registerStreamRoutes(app: Express, deps: Deps): void {
  const { storage } = deps;

  app.get('/v1/runs/:runId/events', (req, res, next) => {
    try {
      const run = storage.getRun(req.params.runId);
      if (!run) throw new OpenwopError('run_not_found', `run ${req.params.runId} not found`, 404);

      const modes = parseModes(req.query.mode as string | undefined);

      // Last-Event-ID resume: SSE clients send the header with the last
      // sequence they saw. Replay anything > that, then attach live.
      // Validate strictly — silently coercing malformed values to 0 would
      // mask broken clients that resume from the start every reconnect.
      const lastEventIdHeader = req.header('last-event-id');
      let fromSeq = 0;
      if (lastEventIdHeader != null) {
        if (!/^\d+$/.test(lastEventIdHeader)) {
          throw new OpenwopError(
            'invalid_request',
            `Last-Event-ID header MUST be a non-negative integer; got "${lastEventIdHeader}"`,
            400,
            { header: 'Last-Event-ID', value: lastEventIdHeader },
          );
        }
        fromSeq = Number(lastEventIdHeader);
      }

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();

      // Replay buffered events.
      const buffered = storage.listEvents(run.runId, { fromSeq, limit: 10_000 });
      for (const ev of buffered) {
        if (passesModeFilter(ev, modes)) {
          writeSseEvent(res, ev);
        }
      }

      // Subscribe to live events for the same run.
      const unsubscribe = getEventLog().subscribe((ev) => {
        if (ev.runId !== run.runId) return;
        if (passesModeFilter(ev, modes)) {
          writeSseEvent(res, ev);
        }
        // Close the stream once we've observed a terminal event.
        if (TERMINAL_EVENT_TYPES.has(ev.type)) {
          unsubscribe();
          res.end();
        }
      });

      // Heartbeat every 15s to keep proxies from dropping the connection.
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // If the run is already terminal, flush + close.
      if (['completed', 'failed', 'cancelled'].includes(run.status)) {
        unsubscribe();
        clearInterval(heartbeat);
        res.end();
      }
    } catch (err) {
      next(err);
    }
  });
}

const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

function parseModes(raw: string | undefined): readonly StreamMode[] {
  if (!raw) return ['updates'];
  const parts = raw.split(',').map((s) => s.trim()) as StreamMode[];
  const valid = parts.filter((m): m is StreamMode => VALID_MODES.includes(m));
  return valid.length > 0 ? valid : ['updates'];
}

function passesModeFilter(ev: EventRecord, modes: readonly StreamMode[]): boolean {
  if (modes.includes('debug')) return true;
  if (modes.includes('values') && (ev.type === 'node.completed' || ev.type === 'run.completed')) {
    return true;
  }
  if (modes.includes('messages') && (ev.type.endsWith('.message') || ev.type.includes('.message.'))) {
    return true;
  }
  if (modes.includes('updates')) {
    // `updates` = every state transition. In this sample, that's every
    // event except node-internal partials (none in the minimal node set).
    return true;
  }
  return false;
}

function writeSseEvent(res: Response, ev: EventRecord): void {
  res.write(`id: ${ev.sequence}\n`);
  res.write(`event: ${ev.type}\n`);
  res.write(`data: ${JSON.stringify(ev)}\n\n`);
}
