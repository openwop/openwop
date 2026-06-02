/**
 * Rate limiting + run-quota enforcement (P0.4 of the app.openwop.dev
 * deploy hardening). In-memory, per-process; Cloud Run with min=0
 * means every cold start gets a fresh counter, which is fine for the
 * demo (rate-limit dodging via cold-start coercion is theoretically
 * possible but the user-facing rate is bounded by Cloud Run's own
 * scale-up policy).
 *
 * Three buckets, ordered from outermost to innermost:
 *
 *   1. Per-IP token bucket on EVERY request (default 60/min).
 *      Catches cookieless abuse + scrapers. Lower bound for noise.
 *
 *   2. Per-session run quota on POST /v1/runs:
 *      - 10 runs/minute  (sliding window)
 *      - 50 runs/day     (UTC midnight reset)
 *      - 5 concurrent runs (in-flight count, released when the run
 *        terminates — currently approximated by a 60s TTL on the
 *        in-flight set; real production would hook into run.completed
 *        events for exact tracking).
 *
 *   3. Per-IP run quota fallback when a request has no session cookie
 *      (Bearer-authed conformance harness bypasses cookies):
 *      - 60 runs/day per IP
 *
 * Tunables via env (defaults shown):
 *   OPENWOP_RATELIMIT_DISABLED=true               disables all checks
 *   OPENWOP_RATELIMIT_IP_REQS_PER_MIN=60
 *   OPENWOP_RATELIMIT_SESSION_RUNS_PER_MIN=10
 *   OPENWOP_RATELIMIT_SESSION_RUNS_PER_DAY=50
 *   OPENWOP_RATELIMIT_SESSION_CONCURRENT=5
 *   OPENWOP_RATELIMIT_IP_RUNS_PER_DAY=60
 *   OPENWOP_FORCE_RATE_LIMIT=true   conformance affordance — forces a tiny
 *                                   per-IP budget (3/min) so the harness can
 *                                   deterministically induce a canonical 429
 *
 * Returns 429 + canonical `rate_limited` envelope per
 * spec/v1/capabilities.md §3 + a `Retry-After` header.
 */

import type { Request, RequestHandler } from 'express';
import { createLogger } from '../observability/logger.js';
import { onRunTerminal } from '../executor/runLifecycle.js';

const log = createLogger('middleware.rateLimit');

interface Limits {
  ipReqsPerMin: number;
  sessionRunsPerMin: number;
  sessionRunsPerDay: number;
  sessionConcurrent: number;
  ipRunsPerDay: number;
}

/** Which specific limiter fired — carried in `details.reason` and mapped to the
 *  canonical `details.scope` closed enum via `RATE_LIMIT_SCOPE`. */
type RateLimitReason =
  | 'ip_request_rate'
  | 'session_runs_per_min'
  | 'session_runs_per_day'
  | 'session_concurrent'
  | 'ip_runs_per_day';

function loadLimits(): Limits {
  const n = (k: string, dflt: number) => {
    const raw = process.env[k];
    if (!raw) return dflt;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : dflt;
  };
  // Conformance affordance: OPENWOP_FORCE_RATE_LIMIT=true forces a tiny per-IP
  // request budget so the conformance harness can DETERMINISTICALLY induce a 429
  // (rate-limit-envelope.test.ts) without depending on real load timing. The
  // canonical `rate_limited` envelope is identical to a production 429.
  const forced = process.env.OPENWOP_FORCE_RATE_LIMIT === 'true';
  return {
    ipReqsPerMin: forced ? 3 : n('OPENWOP_RATELIMIT_IP_REQS_PER_MIN', 60),
    sessionRunsPerMin: n('OPENWOP_RATELIMIT_SESSION_RUNS_PER_MIN', 10),
    sessionRunsPerDay: n('OPENWOP_RATELIMIT_SESSION_RUNS_PER_DAY', 50),
    sessionConcurrent: n('OPENWOP_RATELIMIT_SESSION_CONCURRENT', 5),
    ipRunsPerDay: n('OPENWOP_RATELIMIT_IP_RUNS_PER_DAY', 60),
  };
}

/**
 * Map each internal limiter reason to the canonical `details.scope` closed enum
 * required by `rest-endpoints.md §"429 Too Many Requests envelope"`
 * (`"tenant" | "route" | "global" | "key"`). Per-IP buckets are keyed on the
 * source IP → `"key"`; per-session/tenant buckets → `"tenant"`. The specific
 * limiter that fired is preserved in `details.reason` for observability.
 */
const RATE_LIMIT_SCOPE: Record<RateLimitReason, 'tenant' | 'route' | 'global' | 'key'> = {
  ip_request_rate: 'key',
  ip_runs_per_day: 'key',
  session_runs_per_min: 'tenant',
  session_runs_per_day: 'tenant',
  session_concurrent: 'tenant',
};

// ── State (all maps reset per process / cold start) ──

/** Sliding-window per-key request timestamps (ms). */
const ipReqTimes = new Map<string, number[]>();
const sessionRunTimesMin = new Map<string, number[]>();
const sessionRunCountsDay = new Map<string, { day: number; count: number }>();
const ipRunCountsDay = new Map<string, { day: number; count: number }>();
/** In-flight run set per session, keyed for the per-session concurrency cap.
 *  Slots are bound to the real runId and auto-released on the run's terminal
 *  event by `reserveConcurrentSlot` (via `onRunTerminal`); the 60s entry TTL
 *  is only a backstop for a route that forgets to reserve. */
const sessionInflightRuns = new Map<string, { startedAtMs: number; runId: string }[]>();

function dayBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function pruneWindow(times: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < times.length && times[i]! < cutoff) i++;
  return i === 0 ? times : times.slice(i);
}

/**
 * True only for a genuine direct loopback connection (no proxy hop). Requires
 * the absence of X-Forwarded-For — behind a trusted L7 proxy real traffic
 * always carries XFF, so this can't be reached by spoofing the header. Used to
 * exempt the messaging bridge's self-fetches from the per-IP limiter.
 */
function isLoopbackSelf(req: Request): boolean {
  if (req.header('x-forwarded-for')) return false;
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function clientIp(req: Request): string {
  // Honor X-Forwarded-For when running behind Cloud Run's HTTP load
  // balancer; first hop in the chain is the client. Fall back to
  // socket.remoteAddress for direct/test runs. NEVER trust this
  // header on a network where clients can spoof it; behind a single
  // trusted L7 proxy it's the canonical source.
  const xff = req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0] ?? xff;
    return first.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function sessionKey(req: Request): string {
  // Falls back to IP if no session cookie (e.g., bearer-authed). This
  // lets us still enforce per-IP run quotas on the bearer path.
  if (req.tenantId) return `s:${req.tenantId}`;
  return `ip:${clientIp(req)}`;
}

function rejectRateLimited(
  res: import('express').Response,
  reason: RateLimitReason,
  retryAfterSeconds: number,
): void {
  res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({
    error: 'rate_limited',
    message: 'Request denied by rate limit. Try again later.',
    details: {
      // Canonical closed enum per rest-endpoints.md §429.
      scope: RATE_LIMIT_SCOPE[reason],
      // Host detail: which specific limiter fired (non-normative).
      reason,
      retryAfterMs: Math.max(1000, Math.ceil(retryAfterSeconds * 1000)),
    },
  });
}

// ── Public middleware ──

/** Global per-IP request bucket. Mount before route handlers. */
export function ipRateLimitMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.OPENWOP_RATELIMIT_DISABLED === 'true') { next(); return; }
    // Exempt genuine loopback self-traffic (the messaging bridge self-fetches
    // /v1/runs over 127.0.0.1) so all messaging-driven runs don't share one IP
    // bucket. Keyed on the SOCKET address with NO X-Forwarded-For: behind a L7
    // proxy (Cloud Run) real traffic always carries XFF, so a spoofed
    // `X-Forwarded-For: 127.0.0.1` can't bypass — only a direct loopback
    // connection qualifies. Opt out with OPENWOP_RATELIMIT_TRUST_LOOPBACK=false.
    if (process.env.OPENWOP_RATELIMIT_TRUST_LOOPBACK !== 'false' && isLoopbackSelf(req)) {
      next();
      return;
    }
    const limits = loadLimits();
    if (limits.ipReqsPerMin === 0) { next(); return; }
    const ip = clientIp(req);
    const now = Date.now();
    const times = pruneWindow(ipReqTimes.get(ip) ?? [], 60_000, now);
    if (times.length >= limits.ipReqsPerMin) {
      const oldest = times[0]!;
      const retryIn = (oldest + 60_000 - now) / 1000;
      log.warn('ip rate limit hit', { ip, recentReqs: times.length, limit: limits.ipReqsPerMin });
      rejectRateLimited(res, 'ip_request_rate', retryIn);
      return;
    }
    times.push(now);
    ipReqTimes.set(ip, times);
    next();
  };
}

/** Per-session run-quota middleware. Mount on POST /v1/runs only.
 *  Enforces: 10 runs/min sliding window, 50 runs/day, 5 concurrent. */
export function runQuotaMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (process.env.OPENWOP_RATELIMIT_DISABLED === 'true') { next(); return; }
    const limits = loadLimits();
    const now = Date.now();
    const today = dayBucket();
    const key = sessionKey(req);
    const isSession = key.startsWith('s:');

    // Sliding-window minute check
    if (isSession && limits.sessionRunsPerMin > 0) {
      const times = pruneWindow(sessionRunTimesMin.get(key) ?? [], 60_000, now);
      if (times.length >= limits.sessionRunsPerMin) {
        const retryIn = (times[0]! + 60_000 - now) / 1000;
        rejectRateLimited(res, 'session_runs_per_min', retryIn);
        return;
      }
    }

    // Daily total check (session OR IP path)
    if (isSession && limits.sessionRunsPerDay > 0) {
      const bucket = sessionRunCountsDay.get(key);
      const count = bucket && bucket.day === today ? bucket.count : 0;
      if (count >= limits.sessionRunsPerDay) {
        const retryIn = ((today + 1) * 86_400 - Math.floor(now / 1000));
        rejectRateLimited(res, 'session_runs_per_day', retryIn);
        return;
      }
    } else if (!isSession && limits.ipRunsPerDay > 0) {
      const bucket = ipRunCountsDay.get(key);
      const count = bucket && bucket.day === today ? bucket.count : 0;
      if (count >= limits.ipRunsPerDay) {
        const retryIn = ((today + 1) * 86_400 - Math.floor(now / 1000));
        rejectRateLimited(res, 'ip_runs_per_day', retryIn);
        return;
      }
    }

    // Concurrent check (session only)
    if (isSession && limits.sessionConcurrent > 0) {
      const inflight = (sessionInflightRuns.get(key) ?? []).filter((r) => now - r.startedAtMs < 60_000);
      if (inflight.length >= limits.sessionConcurrent) {
        rejectRateLimited(res, 'session_concurrent', 10);
        return;
      }
      sessionInflightRuns.set(key, inflight);
    }

    // ─── Reserve counters (commit on response 2xx; release on error)
    // Express patches: spy on res.statusCode at response time.
    res.once('finish', () => {
      if (res.statusCode >= 400) return; // refused — don't charge
      // Commit minute window
      if (isSession && limits.sessionRunsPerMin > 0) {
        const times = pruneWindow(sessionRunTimesMin.get(key) ?? [], 60_000, Date.now());
        times.push(Date.now());
        sessionRunTimesMin.set(key, times);
      }
      // Commit daily counter
      if (isSession && limits.sessionRunsPerDay > 0) {
        const bucket = sessionRunCountsDay.get(key);
        if (bucket && bucket.day === today) bucket.count++;
        else sessionRunCountsDay.set(key, { day: today, count: 1 });
      } else if (!isSession && limits.ipRunsPerDay > 0) {
        const bucket = ipRunCountsDay.get(key);
        if (bucket && bucket.day === today) bucket.count++;
        else ipRunCountsDay.set(key, { day: today, count: 1 });
      }
      // Inflight tracking is wired explicitly via reserveConcurrentSlot
      // in the runs route — it ties to the actual runId AND auto-
      // releases on the run's terminal event via runLifecycle. The
      // middleware no longer pushes a 'pending' placeholder here; the
      // 60s TTL safety-net stays only as a backstop in case a route
      // forgets to reserve.
    });
    // Stash the session key on the request so the route handler can
    // call reserveConcurrentSlot with the real runId once it's created.
    (req as Request & { _sessionKey?: string })._sessionKey = key;
    next();
  };
}

/**
 * Bind a session's concurrent-runs slot to the actual runId, and
 * register an auto-release on the run's terminal event. Called from
 * the runs route after the run record is created.
 *
 * Returns a manual release function for paths that need to release
 * before the executor reaches a terminal state (e.g., a creation-
 * time failure that doesn't go through the run.* lifecycle).
 */
export function reserveConcurrentSlot(req: Request, runId: string): () => void {
  const key = (req as Request & { _sessionKey?: string })._sessionKey;
  if (!key) return () => undefined; // no-op for routes outside the runQuotaMiddleware
  const list = sessionInflightRuns.get(key) ?? [];
  list.push({ startedAtMs: Date.now(), runId });
  sessionInflightRuns.set(key, list);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const cur = sessionInflightRuns.get(key);
    if (!cur) return;
    const next = cur.filter((r) => r.runId !== runId);
    if (next.length === 0) sessionInflightRuns.delete(key);
    else sessionInflightRuns.set(key, next);
  };
  // Auto-release when the executor emits a terminal event for this run.
  // The runLifecycle bus fires once per runId and clears listeners.
  onRunTerminal(runId, release);
  return release;
}

// ── Test affordances ──

export function _resetRateLimitState(): void {
  ipReqTimes.clear();
  sessionRunTimesMin.clear();
  sessionRunCountsDay.clear();
  ipRunCountsDay.clear();
  sessionInflightRuns.clear();
}
