/**
 * CLI-friendly daemon-status endpoint.
 *
 * Namespace: sample-extension under `/v1/host/sample/*`; this is not
 * part of the normative OpenWOP wire contract. It gives the CLI's
 * `demo {status,stop,restart}` commands and `doctor` a real readiness
 * signal for the running demo backend: process id, when it started, how
 * long it has been up, and the timestamp of the most recent observed
 * activity (used as a lightweight liveness/heartbeat marker).
 */

import type { Express } from 'express';
import type { AppConfig } from '../index.js';

interface Deps {
  config: AppConfig;
  /** Process start time as epoch ms. Defaults to deriving from process.uptime(). */
  startTimeMs?: number;
}

export function registerDaemonStatusRoutes(app: Express, deps: Deps): void {
  app.get('/v1/host/sample/daemon-status', (_req, res) => {
    res.json(buildDaemonStatus(deps));
  });
}

export function buildDaemonStatus(deps: Deps, now: number = Date.now()): Record<string, unknown> {
  const uptimeSeconds = Math.max(0, Math.floor(process.uptime()));
  const startTimeMs = deps.startTimeMs ?? now - uptimeSeconds * 1000;
  return {
    app: {
      name: 'workflow-engine',
      serviceName: deps.config.serviceName,
      serviceVersion: deps.config.serviceVersion,
    },
    pid: process.pid,
    startTime: new Date(startTimeMs).toISOString(),
    uptimeSeconds,
    // The backend has no separate heartbeat loop; "last heartbeat" is the
    // moment this status was observed, which is a truthful liveness marker
    // for a synchronous request handler — if the process were dead the
    // request would not be answered.
    lastHeartbeat: new Date(now).toISOString(),
  };
}
