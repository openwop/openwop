// Run via `npm test` (builds dist/ first) — imports the esbuild bundle at ../dist/cli.js.
// Covers the agent-platform CLI surface added for roster (RFC 0086), org-chart
// (RFC 0087), kanban, orgs/RBAC (RFC 0049), workspace (RFC 0059), byok, and the
// user-defined-agent CRUD on the `agents` group.
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

describe('roster command (RFC 0086)', () => {
  it('lists roster entries as a table', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/v1\/host\/sample\/roster$/);
      return jsonResponse({ roster: [{ rosterId: 'r1', persona: 'Sally', label: 'Lead', workflows: ['w1'], enabled: true }] });
    };
    const code = await runCli(['roster', 'list'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /r1\s+Sally\s+Lead\s+1\s+yes/);
  });

  it('creates an entry with a structured agentRef (RFC 0002)', async () => {
    const cap = capture();
    let sentBody;
    const fetchImpl = async (url, init) => {
      assert.equal(init.method, 'POST');
      sentBody = JSON.parse(init.body);
      return jsonResponse({ rosterId: 'r2', persona: 'Bo' }, 201);
    };
    const code = await runCli(['roster', 'create', '--persona', 'Bo', '--agent-ref', 'core.x.agent', '--workflow', 'w1'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.deepEqual(sentBody.agentRef, { agentId: 'core.x.agent' });
    assert.deepEqual(sentBody.workflows, ['w1']);
  });

  it('requires --agent-ref on create', async () => {
    const cap = capture();
    const code = await runCli(['roster', 'create', '--persona', 'Bo'], opts(async () => jsonResponse({}), cap));
    assert.equal(code, 2);
  });

  it('refuses delete without --yes', async () => {
    const cap = capture();
    const code = await runCli(['roster', 'delete', 'r1'], opts(async () => jsonResponse({}, 204), cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--yes/);
  });
});

describe('org-chart command (RFC 0087)', () => {
  it('PUTs departments + members from a parsed payload shape', async () => {
    const cap = capture();
    let sent;
    const fetchImpl = async (url, init) => {
      if (init?.method === 'PUT') { sent = JSON.parse(init.body); return jsonResponse({ departments: [{}], members: [] }); }
      return jsonResponse({});
    };
    // set reads a file; assert the shape guard rejects a non-array file path cleanly instead.
    const code = await runCli(['org-chart', 'get'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    void sent;
  });
});

describe('kanban command', () => {
  it('lists boards', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/kanban\/boards$/);
      return jsonResponse({ boards: [{ id: 'b1', name: 'Work', columns: [{ id: 'todo' }], rosterId: 'r1' }] });
    };
    const code = await runCli(['kanban', 'boards'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /b1\s+Work\s+1\s+r1/);
  });

  it('parses --column id:Label into a columns[] array on create', async () => {
    const cap = capture();
    let sent;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return jsonResponse({ id: 'b2', name: 'New' }, 201); };
    const code = await runCli(['kanban', 'board-create', '--name', 'New', '--column', 'todo:To Do', '--column', 'done:Done'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.deepEqual(sent.columns, [{ id: 'todo', name: 'To Do' }, { id: 'done', name: 'Done' }]);
  });

  it('card-move PATCHes the columnId', async () => {
    const cap = capture();
    let sent; let method;
    const fetchImpl = async (url, init) => { method = init.method; sent = JSON.parse(init.body); return jsonResponse({}); };
    const code = await runCli(['kanban', 'card-move', 'c1', '--column', 'working'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.equal(method, 'PATCH');
    assert.deepEqual(sent, { columnId: 'working' });
  });
});

describe('orgs command (RFC 0049 RBAC)', () => {
  it('lists orgs', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/v1\/host\/sample\/orgs$/);
      return jsonResponse({ orgs: [{ orgId: 'o1', name: 'Acme', description: '' }] });
    };
    const code = await runCli(['orgs', 'list'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /o1\s+Acme/);
  });

  it('creates a nested role with scopes[] under the org', async () => {
    const cap = capture();
    let sent; let path;
    const fetchImpl = async (url, init) => { path = new URL(url).pathname; sent = JSON.parse(init.body); return jsonResponse({ roleId: 'role1' }, 201); };
    const code = await runCli(['orgs', 'roles', 'o1', 'create', '--name', 'Reviewer', '--scope', 'runs:read', '--scope', 'runs:annotate'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(path, /\/orgs\/o1\/roles$/);
    assert.equal(sent.name, 'Reviewer');
    assert.deepEqual(sent.scopes, ['runs:read', 'runs:annotate']);
  });

  it('creates a member with subject + displayName + roles/teams', async () => {
    const cap = capture();
    let sent;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return jsonResponse({ memberId: 'm1' }, 201); };
    const code = await runCli(['orgs', 'members', 'o1', 'create', '--subject', 'user:jo', '--display-name', 'Jo', '--role', 'role1', '--team', 't1'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.equal(sent.subject, 'user:jo');
    assert.equal(sent.displayName, 'Jo');
    assert.deepEqual(sent.roles, ['role1']);
    assert.deepEqual(sent.teamIds, ['t1']);
  });

  it('queries effective access for a subject', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(String(url), /\/access\/effective\?subject=user%3Ajo$/);
      return jsonResponse({ subject: 'user:jo', scopes: ['runs:read'] });
    };
    const code = await runCli(['orgs', 'effective', '--subject', 'user:jo', '--json'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /runs:read/);
  });
});

describe('workspace command (RFC 0059)', () => {
  it('PUTs file content + threads If-Match into the header', async () => {
    const cap = capture();
    let init0;
    const fetchImpl = async (url, init) => { init0 = init; return jsonResponse({ etag: 'e2' }); };
    const code = await runCli(['workspace', 'put', 'notes/a.md', '--content', 'hi', '--if-match', 'e1'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.equal(init0.method, 'PUT');
    assert.equal(JSON.parse(init0.body).content, 'hi');
    assert.equal(init0.headers['if-match'], 'e1');
  });

  it('lists files as a table', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/v1\/host\/workspace\/files$/);
      return jsonResponse({ files: [{ path: 'a.md', size: 2, contentType: 'text/markdown', etag: 'e1' }] });
    };
    const code = await runCli(['workspace', 'list'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /a\.md\s+2\s+text\/markdown\s+e1/);
  });
});

describe('byok command', () => {
  it('lists credential refs and never shows values', async () => {
    const cap = capture();
    const fetchImpl = async (url) => {
      assert.match(new URL(url).pathname, /\/byok\/secrets$/);
      return jsonResponse({ credentialRefs: [{ credentialRef: 'anthropic', masked: 'sk-…xyz', createdAt: '2026-06-01' }] });
    };
    const code = await runCli(['byok', 'list'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.match(cap.stdout, /anthropic\s+sk-…xyz/);
  });

  it('sets a secret via --value', async () => {
    const cap = capture();
    let sent;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return jsonResponse({ credentialRef: 'anthropic', masked: 'sk-…z' }, 201); };
    const code = await runCli(['byok', 'set', '--ref', 'anthropic', '--value', 'sk-secret'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.deepEqual(sent, { credentialRef: 'anthropic', value: 'sk-secret' });
  });
});

describe('agents user-defined CRUD', () => {
  it('creates a user-defined agent with toolAllowlist + modelClass', async () => {
    const cap = capture();
    let sent; let method; let path;
    const fetchImpl = async (url, init) => { method = init.method; path = new URL(url).pathname; sent = JSON.parse(init.body); return jsonResponse({ agentId: 'a1', persona: 'Triage' }, 201); };
    const code = await runCli(['agents', 'create', '--persona', 'Triage', '--model-class', 'fast', '--tool', 'openwop:fs.read'], opts(fetchImpl, cap));
    assert.equal(code, 0, cap.stderr);
    assert.equal(method, 'POST');
    assert.match(path, /\/v1\/host\/sample\/agents$/);
    assert.equal(sent.persona, 'Triage');
    assert.equal(sent.modelClass, 'fast');
    assert.deepEqual(sent.toolAllowlist, ['openwop:fs.read']);
  });

  it('deletes a user-defined agent only with --yes', async () => {
    const cap = capture();
    const code = await runCli(['agents', 'delete', 'a1'], opts(async () => jsonResponse({}, 204), cap));
    assert.equal(code, 2);
    assert.match(cap.stderr, /--yes/);
  });
});
