import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as ed25519Sign, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildServiceInstallPlan, configPathFor, consumeSse, daemonLogPath, daemonPidPath, extractAssistantText, extractGlobalOptions, formatTable, processAlive, readConfigSafe, readDaemonRecord, renderEvent, runCli, saveConfig, streamRunEvents, submitTurn, summarizeCapabilities } from '../lib/cli.mjs';
function byteStream(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Minimal ctx for the stream helpers (no real network). */
function streamCtx(fetchImpl, overrides = {}) {
  return { baseUrl: 'http://mock.local', apiKey: 'k', fetchImpl, json: false, ...overrides };
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (s) => { stdout += s; } },
      stderr: { write: (s) => { stderr += s; } },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

describe('CLI argument handling', () => {
  it('extracts global flags without swallowing command help', () => {
    const parsed = extractGlobalOptions([
      '--base-url',
      'http://localhost:9999',
      '--json',
      'demo',
      '--help',
    ]);
    assert.equal(parsed.globals.baseUrl, 'http://localhost:9999');
    assert.equal(parsed.globals.json, true);
    assert.deepEqual(parsed.args, ['demo', '--help']);
  });

  it('renders compact tables', () => {
    const table = formatTable(
      [
        { name: 'alpha', status: 'ok' },
        { name: 'beta', status: 'warn' },
      ],
      ['name', 'status'],
    );
    assert.match(table, /name\s+status/);
    assert.match(table, /alpha\s+ok/);
  });
});

describe('capability summaries', () => {
  it('summarizes a discovery document', () => {
    const text = summarizeCapabilities({
      protocolVersion: '1.1',
      implementation: { name: 'demo', version: '0.1.0' },
      supportedTransports: ['rest', 'sse'],
      stream: { modes: ['values', 'debug'] },
      fixtures: ['one', 'two'],
      capabilities: { interrupts: {}, prompts: {} },
    });
    assert.match(text, /Implementation: demo 0.1.0/);
    assert.match(text, /Fixtures: 2/);
    assert.match(text, /interrupts, prompts/);
  });
});

describe('demo status command', () => {
  it('probes demo endpoints and prints JSON', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      const bodies = {
        '/health': { status: 'ok' },
        '/readiness': { status: 'ready' },
        '/.well-known/openwop': {
          protocolVersion: '1.1',
          implementation: { name: 'demo', version: '0.1.0' },
          capabilities: {},
        },
        '/v1/host/sample/demo-summary': {
          demo: {
            nodeCatalog: { total: 2, runnable: 2 },
            workflows: { registered: 1, fixtures: 3 },
            hostSurfaces: { supported: 4, total: 5 },
          },
        },
      };
      const body = bodies[path] ?? { error: 'not_found' };
      const ok = path in bodies;
      return new Response(JSON.stringify(body), { status: ok ? 200 : 404 });
    };
    const code = await runCli(['--json', '--base-url', 'http://localhost:9999', 'demo', 'status'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.health.body.status, 'ok');
    assert.equal(parsed.demoSummary.demo.nodeCatalog.total, 2);
  });
});

describe('doctor', () => {
  it('emits a JSON checks array that includes node + npm + repo + demo-health', async () => {
    const cap = capture();
    const fetchImpl = async () => { throw new Error('connect refused'); };
    // cwd='/tmp' so findRepoRoot walks to '/' without finding openwop-spec-corpus.
    // (Passing repoRoot: null wouldn't work — runCli's `options.repoRoot ?? findRepoRoot(cwd)`
    // treats null as nullish and falls through to the cwd-relative search.)
    const code = await runCli(['doctor', '--json', '--base-url', 'http://127.0.0.1:0'], {
      io: cap.io,
      fetchImpl,
      cwd: '/tmp',
      env: {},
    });
    const parsed = JSON.parse(cap.stdout);
    assert.ok(Array.isArray(parsed.checks), 'checks is an array');
    const names = new Set(parsed.checks.map((c) => c.name));
    assert.ok(names.has('node'));
    assert.ok(names.has('npm'));
    assert.ok(names.has('repo'));
    assert.ok(names.has('demo health'));
    // No repo root found → repo check is 'fail' → exit non-zero.
    const repoCheck = parsed.checks.find((c) => c.name === 'repo');
    assert.equal(repoCheck.status, 'fail');
    assert.equal(code, 1);
  });
});

describe('demo start --dry-run', () => {
  it('prints backend + frontend spawn commands and exits 0 without launching anything', async () => {
    const cap = capture();
    const code = await runCli(['demo', 'start', '--dry-run'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run in dry-run'); },
      cwd: process.cwd(),
      repoRoot: '/tmp/fake-root',
      env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /backend: cd apps\/workflow-engine\/backend\/typescript/);
    assert.match(cap.stdout, /frontend: cd apps\/workflow-engine\/frontend\/react/);
    assert.match(cap.stdout, /run dev/);
  });

  it('refuses when both --backend-only and --frontend-only are set', async () => {
    const cap = capture();
    const code = await runCli(['demo', 'start', '--backend-only', '--frontend-only'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: '/tmp/fake-root',
      env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /at least one service/i);
  });
});

describe('runs create --wait', () => {
  it('polls until terminal status and exits 0 when the run completes', async () => {
    const cap = capture();
    let getCalls = 0;
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ runId: 'r-1', status: 'running' }), { status: 201 });
      }
      if (path === '/v1/runs/r-1') {
        getCalls++;
        const status = getCalls >= 2 ? 'completed' : 'running';
        return new Response(JSON.stringify({ runId: 'r-1', status, workflowId: 'wf' }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    };
    const code = await runCli(
      ['runs', 'create', 'wf', '--wait', '--timeout-ms', '5000'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 0);
    assert.match(cap.stdout, /Created run r-1/);
    assert.match(cap.stdout, /completed/);
  });

  it('exits 1 when the run terminates as failed', async () => {
    const cap = capture();
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ runId: 'r-2', status: 'running' }), { status: 201 });
      }
      if (path === '/v1/runs/r-2') {
        return new Response(JSON.stringify({ runId: 'r-2', status: 'failed', workflowId: 'wf' }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    };
    const code = await runCli(
      ['runs', 'create', 'wf', '--wait', '--timeout-ms', '5000'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 1);
    assert.match(cap.stdout, /failed/);
  });
});

describe('error paths', () => {
  it('exits 2 on a 4xx response (user-fixable)', async () => {
    const cap = capture();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'no such resource' }), { status: 404 });
    const code = await runCli(['health'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /HTTP 404/);
    assert.match(cap.stderr, /no such resource/);
  });

  it('exits 1 on a 5xx response (server-side)', async () => {
    const cap = capture();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ message: 'internal' }), { status: 500 });
    const code = await runCli(['health'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 1);
    assert.match(cap.stderr, /HTTP 500/);
  });

  it('unknown command produces exit 2 with a usage hint', async () => {
    const cap = capture();
    const code = await runCli(['flibberty'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('unused'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /Unknown command/);
  });
});

describe('base URL precedence', () => {
  it('uses OPENWOP_BASE_URL when --base-url is absent', async () => {
    const cap = capture();
    let observedUrl = '';
    const fetchImpl = async (url) => {
      observedUrl = url.toString();
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    };
    const code = await runCli(['health', '--json'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_BASE_URL: 'http://from-env.example.com:9999' },
    });
    assert.equal(code, 0);
    assert.match(observedUrl, /^http:\/\/from-env\.example\.com:9999\//);
  });

  it('--base-url overrides OPENWOP_BASE_URL', async () => {
    const cap = capture();
    let observedUrl = '';
    const fetchImpl = async (url) => {
      observedUrl = url.toString();
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    };
    const code = await runCli(
      ['health', '--json', '--base-url', 'http://flag-wins.example.com:7777'],
      {
        io: cap.io,
        fetchImpl,
        cwd: process.cwd(),
        repoRoot: process.cwd(),
        env: { OPENWOP_BASE_URL: 'http://from-env.example.com:9999' },
      },
    );
    assert.equal(code, 0);
    assert.match(observedUrl, /^http:\/\/flag-wins\.example\.com:7777\//);
  });

  it('falls back to http://localhost:8080 when nothing is configured', async () => {
    const cap = capture();
    let observedUrl = '';
    const fetchImpl = async (url) => {
      observedUrl = url.toString();
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    };
    const code = await runCli(['health', '--json'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 0);
    assert.match(observedUrl, /^http:\/\/localhost:8080\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding + providers + config tests. Each uses OPENWOP_CONFIG_HOME pointing
// at a fresh temp dir so the suite never reads or writes the user's real
// ~/.openwop/. The backend BYOK endpoints are mocked.
// ─────────────────────────────────────────────────────────────────────────────

function withTempHome() {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'openwop-cli-test-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });
  return () => tmp;
}

describe('onboard --non-interactive', () => {
  const getTmp = withTempHome();

  it('stores credential via BYOK + writes config without prompting', async () => {
    const cap = capture();
    let byokPost = null;
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/host/sample/byok/secrets' && init?.method === 'POST') {
        byokPost = JSON.parse(init.body);
        return new Response('{}', { status: 200 });
      }
      if (path === '/v1/host/sample/byok/secrets') {
        return new Response(JSON.stringify({ secrets: [byokPost?.credentialRef].filter(Boolean) }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${path}`);
    };
    const code = await runCli(
      [
        'onboard',
        '--non-interactive',
        '--base-url', 'http://mock.local',
        '--provider', 'anthropic',
        '--provider-key', 'sk-test-12345',
        '--model', 'claude-sonnet-4-6',
        '--skip-test',
      ],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() } },
    );
    assert.equal(code, 0);
    assert.equal(byokPost.credentialRef, 'anthropic-default');
    assert.equal(byokPost.value, 'sk-test-12345');
    const config = readConfigSafe(configPathFor(undefined, { OPENWOP_CONFIG_HOME: getTmp() }));
    assert.equal(config.defaultProvider, 'anthropic');
    assert.equal(config.defaultModel, 'claude-sonnet-4-6');
    assert.equal(config.host.baseUrl, 'http://mock.local');
    assert.ok(!config.apiKey, 'API key MUST NOT be written to config file');
    assert.ok(!('value' in (config.host ?? {})), 'API key MUST NOT live under config.host');
  });

  it('reads the API key from --api-key-env in non-interactive mode', async () => {
    const cap = capture();
    let byokPost = null;
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/host/sample/byok/secrets' && init?.method === 'POST') {
        byokPost = JSON.parse(init.body);
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected: ${path}`);
    };
    const code = await runCli(
      [
        'onboard', '--non-interactive',
        '--base-url', 'http://mock.local',
        '--provider', 'openai',
        '--api-key-env', 'MY_OPENAI_KEY',
        '--skip-test',
      ],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp(), MY_OPENAI_KEY: 'sk-from-env' } },
    );
    assert.equal(code, 0);
    assert.equal(byokPost.value, 'sk-from-env');
  });

  it('refuses when --provider is missing in non-interactive mode', async () => {
    const cap = capture();
    const code = await runCli(
      ['onboard', '--non-interactive', '--base-url', 'http://mock.local'],
      {
        io: cap.io,
        fetchImpl: async () => { throw new Error('fetch must not run'); },
        cwd: process.cwd(),
        repoRoot: process.cwd(),
        env: { OPENWOP_CONFIG_HOME: getTmp() },
      },
    );
    assert.equal(code, 2);
    assert.match(cap.stderr, /--provider is required/);
  });

  it('rejects unknown providers up front', async () => {
    const cap = capture();
    const code = await runCli(
      ['onboard', '--non-interactive', '--base-url', 'http://mock.local', '--provider', 'fakeprov', '--provider-key', 'x', '--skip-test'],
      {
        io: cap.io,
        fetchImpl: async () => { throw new Error('fetch must not run'); },
        cwd: process.cwd(),
        repoRoot: process.cwd(),
        env: { OPENWOP_CONFIG_HOME: getTmp() },
      },
    );
    assert.equal(code, 2);
    assert.match(cap.stderr, /Unknown provider/);
  });
});

describe('providers subcommand', () => {
  const getTmp = withTempHome();

  it('list shows credential refs returned by the backend', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      if (new URL(url).pathname === '/v1/host/sample/byok/secrets') {
        return new Response(JSON.stringify({ secrets: ['anthropic-default', 'openai-default'] }), { status: 200 });
      }
      throw new Error('unexpected');
    };
    const code = await runCli(['providers', 'list', '--base-url', 'http://mock.local'], {
      io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /anthropic-default/);
    assert.match(cap.stdout, /openai-default/);
  });

  it('add POSTs the credential and updates local config', async () => {
    const cap = capture();
    let posted = null;
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/host/sample/byok/secrets' && init?.method === 'POST') {
        posted = JSON.parse(init.body);
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected: ${path}`);
    };
    const code = await runCli(
      ['providers', 'add', 'google', '--provider-key', 'sk-google', '--base-url', 'http://mock.local'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() } },
    );
    assert.equal(code, 0);
    assert.equal(posted.credentialRef, 'google-default');
    assert.equal(posted.value, 'sk-google');
    const config = readConfigSafe(configPathFor(undefined, { OPENWOP_CONFIG_HOME: getTmp() }));
    assert.equal(config.defaultProvider, 'google');
    assert.equal(config.defaultModel, 'gemini-2.0-flash');
  });

  it('remove DELETEs the configured credential ref', async () => {
    const cap = capture();
    let deleted = null;
    const fetchImpl = async (url, init) => {
      if (init?.method === 'DELETE') {
        deleted = new URL(url).pathname;
        return new Response('{}', { status: 200 });
      }
      throw new Error('unexpected');
    };
    const code = await runCli(
      ['providers', 'remove', 'anthropic', '--base-url', 'http://mock.local'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() } },
    );
    assert.equal(code, 0);
    assert.equal(deleted, '/v1/host/sample/byok/secrets/anthropic-default');
  });

  it('test exits 0 when the credential ref is in the BYOK list', async () => {
    const cap = capture();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ secrets: ['openai-default'] }), { status: 200 });
    const code = await runCli(
      ['providers', 'test', 'openai', '--base-url', 'http://mock.local'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() } },
    );
    assert.equal(code, 0);
    assert.match(cap.stdout, /reachable/);
  });

  it('test exits 1 when the credential ref is missing from the BYOK list', async () => {
    const cap = capture();
    const fetchImpl = async () =>
      new Response(JSON.stringify({ secrets: ['anthropic-default'] }), { status: 200 });
    const code = await runCli(
      ['providers', 'test', 'openai', '--base-url', 'http://mock.local'],
      { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_CONFIG_HOME: getTmp() } },
    );
    assert.equal(code, 1);
    assert.match(cap.stdout, /did not include/);
  });
});

describe('config subcommand', () => {
  const getTmp = withTempHome();

  it('config file prints the resolved path', async () => {
    const cap = capture();
    const code = await runCli(['config', 'file'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('unused'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(code, 0);
    assert.match(cap.stdout.trim(), /\/\.openwop\/config\.json$/);
  });

  it('set + get round-trips a dotted path', async () => {
    const setCap = capture();
    const setCode = await runCli(['config', 'set', 'host.baseUrl', 'http://example.com'], {
      io: setCap.io,
      fetchImpl: async () => { throw new Error('unused'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(setCode, 0);
    const getCap = capture();
    const getCode = await runCli(['config', 'get', 'host.baseUrl'], {
      io: getCap.io,
      fetchImpl: async () => { throw new Error('unused'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(getCode, 0);
    assert.equal(getCap.stdout.trim(), 'http://example.com');
  });

  it('unset removes a previously-set key', async () => {
    const cap = capture();
    saveConfig(configPathFor(undefined, { OPENWOP_CONFIG_HOME: getTmp() }), { defaultModel: 'gpt-4o' });
    const code = await runCli(['config', 'unset', 'defaultModel'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('unused'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(code, 0);
    const config = readConfigSafe(configPathFor(undefined, { OPENWOP_CONFIG_HOME: getTmp() }));
    assert.ok(!('defaultModel' in config));
  });
});

describe('chat — arg parsing', () => {
  it('prints help and exits 0 with --help', async () => {
    const cap = capture();
    const code = await runCli(['chat', '--help'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /Interactive streaming chat REPL/);
  });

  it('exits 2 when no workflowId is given', async () => {
    const cap = capture();
    const code = await runCli(['chat'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
    });
    assert.equal(code, 2);
  });
});

describe('chat — event rendering', () => {
  it('renders assistant text from node.completed output ports', () => {
    const line = renderEvent({ type: 'node.completed', nodeId: 'respond', payload: { outputs: { reply: 'hello there' } } });
    assert.equal(line, 'assistant> hello there');
  });

  it('renders run.completed reply and lifecycle markers', () => {
    assert.equal(renderEvent({ type: 'run.started' }), '· run started');
    assert.equal(renderEvent({ type: 'run.completed', payload: { output: 'final answer' } }), 'assistant> final answer');
    assert.equal(renderEvent({ type: 'node.failed', nodeId: 'respond', payload: { error: { message: 'boom' } } }), '! node.failed respond: boom');
  });

  it('extracts assistant text from a messages array', () => {
    const text = extractAssistantText({
      type: 'run.completed',
      payload: { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hi back' }] },
    });
    assert.equal(text, 'hi back');
  });

  it('returns null for events with no surfaceable text', () => {
    assert.equal(extractAssistantText({ type: 'node.started', payload: {} }), null);
    assert.equal(renderEvent(null), null);
  });
});

describe('chat — SSE parsing', () => {
  it('decodes frames split across chunk boundaries', async () => {
    const frames = [];
    // The `data:` line is split across two byte chunks to exercise buffering.
    await consumeSse(
      byteStream(['id: 1\nevent: run.started\ndata: {"ty', 'pe":"run.started"}\n\n: heartbeat\n\nevent: run.completed\ndata: {"type":"run.completed"}\n\n']),
      (f) => frames.push(f),
    );
    assert.equal(frames.length, 2);
    assert.equal(frames[0].event, 'run.started');
    assert.deepEqual(JSON.parse(frames[0].data), { type: 'run.started' });
    assert.equal(frames[1].event, 'run.completed');
  });
});

describe('chat — streamRunEvents', () => {
  it('consumes an SSE stream and stops at the terminal event', async () => {
    const events = [];
    const sse = [
      'event: run.started\ndata: {"type":"run.started","sequence":0}\n\n',
      'event: node.completed\ndata: {"type":"node.completed","sequence":1,"payload":{"output":"hi"}}\n\n',
      'event: run.completed\ndata: {"type":"run.completed","sequence":2}\n\n',
    ];
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/events$/);
      return new Response(byteStream(sse), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    await streamRunEvents(streamCtx(fetchImpl), 'r-1', { onEvent: (e) => events.push(e) });
    assert.deepEqual(events.map((e) => e.type), ['run.started', 'node.completed', 'run.completed']);
    assert.equal(extractAssistantText(events[1]), 'hi');
  });

  it('falls back to the poll endpoint when SSE returns JSON', async () => {
    const events = [];
    let polls = 0;
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/events')) {
        // SSE not supported — answer with JSON, no event-stream content type.
        return new Response(JSON.stringify({ events: [], isComplete: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path.endsWith('/events/poll')) {
        polls += 1;
        if (polls === 1) {
          return new Response(JSON.stringify({
            events: [{ type: 'run.started', sequence: 0 }, { type: 'node.completed', sequence: 1, payload: { output: 'yo' } }],
            isComplete: false,
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          events: [{ type: 'run.completed', sequence: 2 }],
          isComplete: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected: ${path}`);
    };
    await streamRunEvents(streamCtx(fetchImpl), 'r-2', { onEvent: (e) => events.push(e), timeoutMs: 5000 });
    assert.deepEqual(events.map((e) => e.type), ['run.started', 'node.completed', 'run.completed']);
    assert.equal(polls, 2);
  });
});

describe('chat — submitTurn', () => {
  it('POSTs a run with the messages array and returns the runId', async () => {
    let posted = null;
    const fetchImpl = async (url, init) => {
      assert.equal(new URL(url).pathname, '/v1/runs');
      assert.equal(init.method, 'POST');
      posted = JSON.parse(init.body);
      return new Response(JSON.stringify({ runId: 'run-xyz', status: 'pending' }), { status: 201 });
    };
    const runId = await submitTurn(streamCtx(fetchImpl), {
      workflowId: 'sample.chat.turn',
      inputs: { messages: [{ role: 'user', content: 'hi' }] },
    });
    assert.equal(runId, 'run-xyz');
    assert.equal(posted.workflowId, 'sample.chat.turn');
    assert.deepEqual(posted.inputs.messages, [{ role: 'user', content: 'hi' }]);
  });
});

describe('chat — REPL loop', () => {
  it('runs one turn over SSE then exits gracefully on EOF', async () => {
    const cap = capture();
    const turns = ['hello', null]; // second read is EOF
    let t = 0;
    const readTurn = async () => turns[t++];
    let createdBody = null;
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/runs' && init?.method === 'POST') {
        createdBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ runId: 'r-9', status: 'pending' }), { status: 201 });
      }
      if (path.endsWith('/events')) {
        return new Response(byteStream([
          'event: node.completed\ndata: {"type":"node.completed","sequence":1,"payload":{"output":"hi human"}}\n\n',
          'event: run.completed\ndata: {"type":"run.completed","sequence":2}\n\n',
        ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      throw new Error(`unexpected: ${path}`);
    };
    const code = await runCli(['chat', 'sample.chat.turn'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
      readTurn,
    });
    assert.equal(code, 0);
    assert.deepEqual(createdBody.inputs.messages, [{ role: 'user', content: 'hello' }]);
    assert.match(cap.stdout, /assistant> hi human/);
  });

  it('emits raw JSON events with --json and exits on /exit', async () => {
    const cap = capture();
    const turns = ['ping', '/exit'];
    let t = 0;
    const readTurn = async () => turns[t++];
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/v1/runs' && init?.method === 'POST') {
        return new Response(JSON.stringify({ runId: 'r-j', status: 'pending' }), { status: 201 });
      }
      if (path.endsWith('/events')) {
        return new Response(byteStream([
          'event: run.completed\ndata: {"type":"run.completed","sequence":1,"payload":{"output":"pong"}}\n\n',
        ]), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      throw new Error(`unexpected: ${path}`);
    };
    const code = await runCli(['--json', 'chat', 'sample.chat.turn'], {
      io: cap.io,
      fetchImpl,
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: {},
      readTurn,
    });
    assert.equal(code, 0);
    // --json mode prints the raw event record, not the pretty "assistant>" line.
    assert.match(cap.stdout, /"type": "run.completed"/);
    assert.doesNotMatch(cap.stdout, /assistant>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// packs subcommand (gap 6 / item C-5). Mocks the read-only signed registry —
// /v1/index.json, /v1/packs/{name}/index.json, the version manifest, the
// signed .tgz + detached .sig, and the publisher /keys/{keyId}.pub. The
// install happy-path exercises real Ed25519 verification against a tarball
// signed in-test (method 'manual' = signature over the pack.json bytes).
// ─────────────────────────────────────────────────────────────────────────────

// Minimal RFC 8785-style canonical JSON (matches build-pack-tarball.mjs).
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

// Minimal deterministic USTAR + gzip (mirrors the production writer).
function tarGz(entries) {
  const header = (name, size) => {
    const buf = Buffer.alloc(512, 0);
    const oct = (n, len, off) => buf.write(n.toString(8).padStart(len - 1, '0') + '\0', off, len, 'ascii');
    buf.write(name, 0, 100, 'ascii');
    oct(0o644, 8, 100); oct(0, 8, 108); oct(0, 8, 116); oct(size, 12, 124); oct(0, 12, 136);
    for (let i = 148; i < 156; i++) buf[i] = 0x20;
    buf[156] = 0x30;
    buf.write('ustar\0', 257, 6, 'ascii'); buf.write('00', 263, 2, 'ascii');
    let s = 0; for (let i = 0; i < 512; i++) s += buf[i];
    oct(s, 8, 148);
    return buf;
  };
  const chunks = [];
  for (const { name, content } of entries) {
    chunks.push(header(name, content.length), content);
    const pad = 512 - (content.length % 512);
    if (pad !== 512) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const gz = gzipSync(Buffer.concat(chunks), { level: 9 });
  gz[4] = 0; gz[5] = 0; gz[6] = 0; gz[7] = 0; gz[9] = 0xff;
  return gz;
}

// Build a signed-pack registry fixture: returns {tgz, sig, pubPem, manifest, index, packIndex}.
function buildSignedPackFixture(name = 'community.test.demo', version = '0.2.0', keyId = 'test-key-1') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const baseManifest = {
    name, version,
    description: 'A test pack for CLI install verification.',
    license: 'MIT',
    author: 'Test',
    nodes: [{ typeId: `${name}.echo`, version }],
    signing: { method: 'manual', publicKeyRef: keyId, signatureRef: 'keys/pack.json.sig' },
    publishedAt: '2026-05-26T00:00:00Z',
    deprecated: false,
    yanked: false,
  };
  // method 'manual' signs the canonical pack.json bytes embedded in the tarball.
  const canonicalBytes = Buffer.from(canonical(baseManifest), 'utf8');
  const sig = ed25519Sign(null, canonicalBytes, privateKey);
  const entries = [
    { name: 'keys/pack.json.sig', content: sig },
    { name: 'pack.json', content: canonicalBytes },
  ].sort((a, b) => (a.name < b.name ? -1 : 1));
  const tgz = tarGz(entries);
  const integrity = 'sha256-' + createHash('sha256').update(tgz).digest('base64');
  const manifest = { ...baseManifest, signing: { ...baseManifest.signing, keyId }, integrity };
  return {
    tgz, sig,
    pubPem: publicKey.export({ type: 'spki', format: 'pem' }),
    manifest,
    keyId, name, version, integrity,
    packIndex: {
      name, kind: 'node', latest: version, license: 'MIT', author: 'Test',
      description: baseManifest.description,
      versions: [{ version, signingKeyId: keyId, integrity, yanked: false, deprecated: false }],
    },
    index: {
      registryVersion: '1.0.0', packCount: 1,
      packs: [{ name, kind: 'node', latestVersion: version, description: baseManifest.description, license: 'MIT', tags: ['test'], typeIds: [`${name}.echo`], deprecated: false, yanked: false }],
    },
  };
}

// Registry fetch mock driven by a fixture.
function registryFetch(fx) {
  return async (url) => {
    const u = new URL(url);
    const p = u.pathname;
    const enc = encodeURIComponent(fx.name);
    if (p === '/v1/index.json') return new Response(JSON.stringify(fx.index), { status: 200 });
    if (p === `/v1/packs/${enc}/index.json`) return new Response(JSON.stringify(fx.packIndex), { status: 200 });
    if (p === `/v1/packs/${enc}/-/${fx.version}.json`) return new Response(JSON.stringify(fx.manifest), { status: 200 });
    if (p === `/v1/packs/${enc}/-/${fx.version}.tgz`) return new Response(fx.tgz, { status: 200 });
    if (p === `/v1/packs/${enc}/-/${fx.version}.sig`) return new Response(fx.sig, { status: 200 });
    if (p === `/keys/${fx.keyId}.pub`) return new Response(fx.pubPem, { status: 200 });
    return new Response(JSON.stringify({ message: 'not_found' }), { status: 404 });
  };
}

describe('packs search', () => {
  it('filters the registry index by query and prints a table', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(['packs', 'search', 'test', '--registry-url', 'http://registry.local'], {
      io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /community\.test\.demo/);
    assert.match(cap.stdout, /0\.2\.0/);
  });

  it('emits JSON with a total when --json is set', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(['--json', 'packs', 'search', '--registry-url', 'http://registry.local'], {
      io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.total, 1);
    assert.equal(parsed.packs[0].name, 'community.test.demo');
  });

  it('reports no matches for a query that hits nothing', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(['packs', 'search', 'zzz-nomatch', '--registry-url', 'http://registry.local'], {
      io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /No packs match/);
  });
});

describe('packs info', () => {
  it('prints pack metadata and version table', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(['packs', 'info', 'community.test.demo', '--registry-url', 'http://registry.local'], {
      io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /Name:\s+community\.test\.demo/);
    assert.match(cap.stdout, /test-key-1/);
  });

  it('fetches the version manifest when --version is given (JSON)', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(['--json', 'packs', 'info', 'community.test.demo', '--version', '0.2.0', '--registry-url', 'http://registry.local'], {
      io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.requestedVersion.version, '0.2.0');
    assert.equal(parsed.requestedVersion.signing.keyId, 'test-key-1');
  });

  it('requires a pack name', async () => {
    const cap = capture();
    const code = await runCli(['packs', 'info'], {
      io: cap.io, fetchImpl: async () => { throw new Error('no fetch'); }, cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /requires a pack name/);
  });
});

describe('packs install', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'openwop-packs-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('downloads, integrity-checks, signature-verifies, and writes the tarball', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(
      ['--json', 'packs', 'install', 'community.test.demo@0.2.0', '--dir', tmp, '--registry-url', 'http://registry.local'],
      { io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.name, 'community.test.demo');
    assert.equal(parsed.version, '0.2.0');
    assert.match(parsed.signature, /^verified/);
    assert.equal(parsed.integrity, fx.integrity);
    // Tarball written to <dir>/<name>/<version>/<version>.tgz.
    const written = readFileSync(join(tmp, 'community.test.demo', '0.2.0', '0.2.0.tgz'));
    assert.equal(written.length, fx.tgz.length);
  });

  it('resolves the latest version when none is given', async () => {
    const fx = buildSignedPackFixture();
    const cap = capture();
    const code = await runCli(
      ['--json', 'packs', 'install', 'community.test.demo', '--dir', tmp, '--registry-url', 'http://registry.local'],
      { io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 0);
    assert.equal(JSON.parse(cap.stdout).version, '0.2.0');
  });

  it('fails (exit 1) when the signature does not verify', async () => {
    const fx = buildSignedPackFixture();
    // Corrupt the signature so Ed25519 verification fails.
    fx.sig = Buffer.from(fx.sig); fx.sig[0] ^= 0xff;
    const cap = capture();
    const code = await runCli(
      ['packs', 'install', 'community.test.demo@0.2.0', '--dir', tmp, '--registry-url', 'http://registry.local'],
      { io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 1);
    assert.match(cap.stderr, /Signature verification FAILED/);
  });

  it('fails (exit 1) on an integrity mismatch', async () => {
    const fx = buildSignedPackFixture();
    fx.manifest = { ...fx.manifest, integrity: 'sha256-WRONGWRONGWRONG=' };
    const cap = capture();
    const code = await runCli(
      ['packs', 'install', 'community.test.demo@0.2.0', '--dir', tmp, '--no-verify', '--registry-url', 'http://registry.local'],
      { io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 1);
    assert.match(cap.stderr, /Integrity mismatch/);
  });

  it('refuses to install a yanked version', async () => {
    const fx = buildSignedPackFixture();
    fx.manifest = { ...fx.manifest, yanked: true };
    const cap = capture();
    const code = await runCli(
      ['packs', 'install', 'community.test.demo@0.2.0', '--dir', tmp, '--registry-url', 'http://registry.local'],
      { io: cap.io, fetchImpl: registryFetch(fx), cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 1);
    assert.match(cap.stderr, /yanked/);
  });
});

describe('packs publish', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'openwop-publish-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('packages + signs a local pack dir into a tarball + sig', async () => {
    // Lay down a minimal pack source dir + an Ed25519 PEM private key.
    const packDir = join(tmp, 'pack');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'pack.json'), JSON.stringify({ name: 'community.test.pub', version: '1.0.0', nodes: [] }, null, 2));
    const { privateKey } = generateKeyPairSync('ed25519');
    const keyPath = join(tmp, 'key.pem');
    writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const outDir = join(tmp, 'out');
    const cap = capture();
    const code = await runCli(
      ['--json', 'packs', 'publish', packDir, '--key', keyPath, '--key-id', 'test-key-1', '--out', outDir],
      { io: cap.io, fetchImpl: async () => { throw new Error('publish must not fetch'); }, cwd: process.cwd(), repoRoot: process.cwd(), env: {} },
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.name, 'community.test.pub');
    assert.equal(parsed.keyId, 'test-key-1');
    assert.equal(parsed.writeApi, false);
    // Artifacts exist.
    assert.ok(readFileSync(join(outDir, 'community.test.pub-1.0.0.tgz')).length > 0);
    assert.equal(readFileSync(join(outDir, 'community.test.pub-1.0.0.sig')).length, 64);
  });

  it('requires a pack.json in the target dir', async () => {
    const cap = capture();
    const code = await runCli(['packs', 'publish', tmp], {
      io: cap.io, fetchImpl: async () => { throw new Error('no fetch'); }, cwd: process.cwd(), repoRoot: process.cwd(), env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /No pack\.json/);
  });
});

describe('packs yank', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'openwop-yank-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('flips yanked:true in a local registry-checkout manifest', async () => {
    const manifestDir = join(tmp, 'registry', 'v1', 'packs', 'community.test.demo', '-');
    mkdirSync(manifestDir, { recursive: true });
    const mfPath = join(manifestDir, '0.2.0.json');
    writeFileSync(mfPath, JSON.stringify({ name: 'community.test.demo', version: '0.2.0', yanked: false }, null, 2));
    const cap = capture();
    const code = await runCli(['packs', 'yank', 'community.test.demo@0.2.0'], {
      io: cap.io, fetchImpl: async () => { throw new Error('no fetch'); }, cwd: process.cwd(), repoRoot: tmp, env: {},
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /Yanked community\.test\.demo@0\.2\.0/);
    assert.equal(JSON.parse(readFileSync(mfPath, 'utf8')).yanked, true);
  });

  it('errors when the version manifest is not in the local checkout', async () => {
    const cap = capture();
    const code = await runCli(['packs', 'yank', 'community.test.demo', '--version', '9.9.9'], {
      io: cap.io, fetchImpl: async () => { throw new Error('no fetch'); }, cwd: process.cwd(), repoRoot: tmp, env: {},
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /not found/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Demo lifecycle — stop / logs / install (C-1, C-2). PID + log files live under
// OPENWOP_CONFIG_HOME/.openwop/ so tests never touch the real ~/.openwop/.
// ─────────────────────────────────────────────────────────────────────────────

function writePidRecord(home, record) {
  const path = daemonPidPath({ OPENWOP_CONFIG_HOME: home });
  mkdirSync(join(home, '.openwop'), { recursive: true });
  writeFileSync(path, JSON.stringify(record), 'utf8');
}

describe('demo stop', () => {
  const getTmp = withTempHome();

  it('reports nothing to stop when no PID file exists', async () => {
    const cap = capture();
    const code = await runCli(['demo', 'stop'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /nothing to stop/i);
  });

  it('clears a stale PID file when the process is not alive', async () => {
    const home = getTmp();
    // PID 2^31-1 is effectively guaranteed not to exist.
    writePidRecord(home, { pid: 2147483646, startedAt: new Date().toISOString() });
    const cap = capture();
    const code = await runCli(['demo', 'stop'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: home },
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /stale PID file|not running/i);
    assert.equal(readDaemonRecord({ OPENWOP_CONFIG_HOME: home }), null);
  });
});

describe('processAlive', () => {
  it('returns true for the current process and false for an impossible pid', () => {
    assert.equal(processAlive(process.pid), true);
    assert.equal(processAlive(2147483646), false);
    assert.equal(processAlive(0), false);
    assert.equal(processAlive(-1), false);
  });
});

describe('demo logs', () => {
  const getTmp = withTempHome();

  it('exits 2 with guidance when no log file exists', async () => {
    const cap = capture();
    const code = await runCli(['demo', 'logs'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    assert.equal(code, 2);
    assert.match(cap.stderr, /No log file/);
  });

  it('prints the tail of an existing log file', async () => {
    const home = getTmp();
    mkdirSync(join(home, '.openwop'), { recursive: true });
    const logPath = daemonLogPath({ OPENWOP_CONFIG_HOME: home });
    writeFileSync(logPath, 'line-1\nline-2\nline-3\n', 'utf8');
    const cap = capture();
    const code = await runCli(['demo', 'logs', '--lines', '2'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: process.cwd(),
      env: { OPENWOP_CONFIG_HOME: home },
    });
    assert.equal(code, 0);
    assert.match(cap.stdout, /line-3/);
    assert.match(cap.stdout, /line-2/);
  });
});

describe('demo install (service plan)', () => {
  const root = '/tmp/openwop-fake-root';
  const baseInput = {
    root,
    backendPort: 8080,
    label: 'dev.openwop.demo',
    apiKey: 'sample-token',
    env: { HOME: '/home/tester' },
    uninstall: false,
  };

  it('builds a launchd LaunchAgent plist on macOS', () => {
    const plan = buildServiceInstallPlan({ ...baseInput, platform: 'darwin' });
    assert.equal(plan.manager, 'launchd LaunchAgent');
    assert.match(plan.path, /Library\/LaunchAgents\/dev\.openwop\.demo\.plist$/);
    assert.match(plan.contents, /<key>Label<\/key>/);
    assert.match(plan.contents, /dev\.openwop\.demo/);
    assert.match(plan.contents, /<string>8080<\/string>/);
    assert.match(plan.activate, /launchctl load/);
  });

  it('builds a systemd user unit on Linux', () => {
    const plan = buildServiceInstallPlan({ ...baseInput, platform: 'linux' });
    assert.equal(plan.manager, 'systemd user unit');
    assert.match(plan.path, /\.config\/systemd\/user\/dev\.openwop\.demo\.service$/);
    assert.match(plan.contents, /\[Service\]/);
    assert.match(plan.contents, /Environment=PORT=8080/);
    assert.match(plan.activate, /systemctl --user/);
  });

  it('returns an unsupported plan with a Scheduled-Task recipe on Windows', () => {
    const plan = buildServiceInstallPlan({ ...baseInput, platform: 'win32' });
    assert.equal(plan.unsupported, true);
    assert.match(plan.guidance, /schtasks \/Create/);
    assert.match(plan.guidance, /dev\.openwop\.demo/);
  });

  it('demo install --dry-run prints the plan without writing a file', async () => {
    const cap = capture();
    const code = await runCli(['demo', 'install', '--dry-run', '--json'], {
      io: cap.io,
      fetchImpl: async () => { throw new Error('fetch must not run'); },
      cwd: process.cwd(),
      repoRoot: root,
      env: { HOME: '/home/tester' },
    });
    assert.equal(code, 0);
    const parsed = JSON.parse(cap.stdout);
    assert.equal(parsed.action, 'install');
    assert.ok(parsed.path, 'plan has a target path');
  });
});

describe('doctor — daemon + provider rows', () => {
  const getTmp = withTempHome();

  it('adds a daemon row from /v1/host/sample/daemon-status and provider rows from BYOK', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/health') return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      if (path === '/v1/host/sample/daemon-status') {
        return new Response(JSON.stringify({ pid: 4242, uptimeSeconds: 12, startTime: '2026-05-26T00:00:00.000Z' }), { status: 200 });
      }
      if (path === '/v1/host/sample/byok/secrets') {
        return new Response(JSON.stringify({ secrets: ['anthropic-default', 'openai-default'] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };
    const code = await runCli(['doctor', '--json', '--base-url', 'http://mock.local'], {
      io: cap.io,
      fetchImpl,
      cwd: '/tmp',
      env: { OPENWOP_CONFIG_HOME: getTmp() },
    });
    const parsed = JSON.parse(cap.stdout);
    const byName = new Map(parsed.checks.map((c) => [c.name, c]));
    assert.ok(byName.has('daemon'));
    assert.match(byName.get('daemon').message, /pid 4242/);
    assert.equal(byName.get('daemon').status, 'ok');
    assert.ok(byName.has('provider anthropic-default'));
    assert.ok(byName.has('provider openai-default'));
    // demo health unreachable rows don't fail the run; repo=fail does → exit 1.
    assert.equal(code, 1);
  });

  it('falls back to a stale-PID daemon warning when the route is unreachable', async () => {
    const home = getTmp();
    writePidRecord(home, { pid: 2147483646, startedAt: new Date().toISOString() });
    const cap = capture();
    const fetchImpl = async () => { throw new Error('connect refused'); };
    await runCli(['doctor', '--json', '--base-url', 'http://127.0.0.1:0'], {
      io: cap.io,
      fetchImpl,
      cwd: '/tmp',
      env: { OPENWOP_CONFIG_HOME: home },
    });
    const parsed = JSON.parse(cap.stdout);
    const daemon = parsed.checks.find((c) => c.name === 'daemon');
    assert.ok(daemon);
    assert.equal(daemon.status, 'warn');
    assert.match(daemon.message, /stale PID file/);
  });
});
