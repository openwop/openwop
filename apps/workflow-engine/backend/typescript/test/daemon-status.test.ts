import { describe, expect, it } from 'vitest';
import { buildDaemonStatus } from '../src/routes/daemonStatus.js';

const config = {
  port: 18199,
  storageDsn: 'memory://',
  serviceName: 'daemon-status-test',
  serviceVersion: '0.0.1',
  enableConsoleTracer: false,
};

describe('daemon status route', () => {
  it('reports pid / startTime / uptimeSeconds / lastHeartbeat', () => {
    const now = Date.UTC(2026, 4, 26, 12, 0, 0);
    const startTimeMs = now - 5000;
    const body = buildDaemonStatus({ config, startTimeMs }, now) as {
      app: { name: string; serviceName: string; serviceVersion: string };
      pid: number;
      startTime: string;
      uptimeSeconds: number;
      lastHeartbeat: string;
    };
    expect(body.app.name).toBe('workflow-engine');
    expect(body.app.serviceName).toBe('daemon-status-test');
    expect(body.app.serviceVersion).toBe('0.0.1');
    expect(body.pid).toBe(process.pid);
    expect(body.startTime).toBe(new Date(startTimeMs).toISOString());
    expect(body.lastHeartbeat).toBe(new Date(now).toISOString());
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('derives startTime from process.uptime() when not supplied', () => {
    const now = Date.now();
    const body = buildDaemonStatus({ config }, now) as { startTime: string; uptimeSeconds: number };
    // startTime should be approximately now - uptime; allow a small window.
    const startMs = Date.parse(body.startTime);
    expect(now - startMs).toBeGreaterThanOrEqual(body.uptimeSeconds * 1000 - 1000);
    expect(now - startMs).toBeLessThanOrEqual(body.uptimeSeconds * 1000 + 1000);
  });
});
