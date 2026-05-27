import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runCli } from '../dist/cli.js';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (s) => { stdout += s; } }, stderr: { write: (s) => { stderr += s; } } },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function opts(fetchImpl, cap) {
  return { io: cap.io, fetchImpl, cwd: process.cwd(), repoRoot: process.cwd(), env: { OPENWOP_API_KEY: 'k' } };
}

describe('notifications command', () => {
  it('lists inbox entries as a table', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/v1\/host\/sample\/notifications$/);
      return jsonResponse({ notifications: [{ notificationId: 'n1', status: 'unread', priority: 'high', title: 'Run failed', createdAt: '2026-05-27' }] });
    };
    const code = await runCli(['notifications', 'list'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /n1\s+unread\s+high\s+Run failed/);
  });

  it('marks a notification read via POST', async () => {
    const cap = capture();
    const fetchImpl = async (url, init) => {
      assert.equal(init.method, 'POST');
      assert.match(new URL(url).pathname, /\/notifications\/n1\/read$/);
      return jsonResponse({ notificationId: 'n1', status: 'read' });
    };
    const code = await runCli(['notifications', 'read', 'n1'], opts(fetchImpl, cap));
    assert.equal(code, 0);
    assert.match(cap.stdout, /✓ n1 → read/);
  });

  it('mark-all-read hits the collection action', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(String(url), /notifications:mark-all-read$/);
      return jsonResponse({ updated: 3 });
    };
    const code = await runCli(['notifications', 'mark-all-read'], opts(fetchImpl, cap));
    assert.equal(code, 0);
    assert.match(cap.stdout, /Marked 3 notification/);
  });
});

describe('interrupts command', () => {
  it('lists open interrupts for a run', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/runs\/r1\/interrupts$/);
      return jsonResponse({ runId: 'r1', interrupts: [{ nodeId: 'approve', kind: 'approval', token: 'tok123', createdAt: '2026-05-27' }] });
    };
    const code = await runCli(['interrupts', 'list', 'r1'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /approve\s+approval\s+tok123/);
  });

  it('resolves an interrupt by token with a JSON payload', async () => {
    const cap = capture();
    const fetchImpl = async (url, init) => {
      assert.equal(init.method, 'POST');
      assert.match(new URL(url).pathname, /\/v1\/interrupts\/tok123$/);
      assert.deepEqual(JSON.parse(init.body), { approved: true });
      return jsonResponse({ runId: 'r1', nodeId: 'approve', status: 'running' });
    };
    const code = await runCli(['interrupts', 'resolve', 'tok123', '--data-json', '{"approved":true}'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /Resolved interrupt — run r1 node approve/);
  });
});

describe('prompts command', () => {
  it('lists templates and renders a ref', async () => {
    const listCap = capture();
    const listFetch = async (url) => {
      assert.match(new URL(url).pathname, /\/v1\/prompts$/);
      return jsonResponse({ items: [{ templateId: 'greet', kind: 'system', modelClass: 'general', source: 'pack' }] });
    };
    let code = await runCli(['prompts', 'list'], opts(listFetch, listCap));
    assert.equal(code, 0, listCap.stderr);
    assert.match(listCap.stdout, /greet\s+system\s+general\s+pack/);

    const renderCap = capture();
    const renderFetch = async (url, init) => {
      assert.match(String(url), /\/v1\/prompts:render$/);
      assert.deepEqual(JSON.parse(init.body), { ref: 'greet', variables: { name: 'Ada' } });
      return jsonResponse({ messages: [{ role: 'system', content: 'Hello Ada' }] });
    };
    code = await runCli(['--json', 'prompts', 'render', 'greet', '--variables-json', '{"name":"Ada"}'], opts(renderFetch, renderCap));
    assert.equal(code, 0, renderCap.stderr);
    assert.match(renderCap.stdout, /Hello Ada/);
  });
});
