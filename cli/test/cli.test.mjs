import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { configPathFor, extractGlobalOptions, formatTable, readConfigSafe, runCli, saveConfig, summarizeCapabilities } from '../lib/cli.mjs';

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
