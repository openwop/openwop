/**
 * vendor.myndhyve.agent-orchestration — RFC 0007/0008/0011-based coordination.
 *
 * Six nodes route through ctx.agentRuntime.*:
 *   spawn, delegate-smart, consensus-vote, message-send, skill-invoke,
 *   swarm-execute.
 *
 * Inherits RFC 0007 §F suspend mechanics for low-confidence escalation
 * (delegate.smart). Uses RFC 0007 B2.3 messaging reducer semantics for
 * message-send. Schema-aligned with RFC 0008 AgentManifest toolAllowlist
 * (skill-invoke verifies via host).
 *
 * Host contract:
 *   ctx.agentRuntime.spawn(req) → Promise<{ agentInstanceId, agentId, spawnedAt }>
 *   ctx.agentRuntime.route(req) → Promise<{ selectedAgentInstanceId, confidence, rationale?, alternatives? }>
 *   ctx.agentRuntime.vote(req)  → Promise<{ votes: [...] }>  (caller aggregates)
 *   ctx.agentRuntime.message(req) → Promise<{ messageId, sentAt, deliveredTo }>
 *   ctx.agentRuntime.skill(req) → Promise<{ result, isError, durationMs }>
 *   ctx.agentRuntime.swarm(req) → Promise<{ results?, reduced?, winner?, succeeded, failed }>
 *
 * @see docs/plans/MYNDHYVE-TO-OPENWOP-PACK-MIGRATION.md
 */

import { createHash } from 'node:crypto';

function ensureAgentRuntime(ctx) {
  if (!ctx.agentRuntime || typeof ctx.agentRuntime.spawn !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.agentRuntime'),
      { code: 'host_capability_missing' }
    );
  }
}

function deriveIdempotencyKey(parts) {
  const h = createHash('sha256');
  for (const p of parts) {
    if (p === undefined || p === null) h.update('\0');
    else if (typeof p === 'string') h.update(p, 'utf8');
    else h.update(JSON.stringify(p), 'utf8');
    h.update('\x1e');
  }
  return 'openwop-' + h.digest('hex').slice(0, 16);
}

/* ─── agent.spawn ────────────────────────────────────────── */

export async function spawn(ctx) {
  ensureAgentRuntime(ctx);
  const { agentRef, session } = ctx.config;
  const { overrides } = ctx.inputs ?? {};
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId), agentRef, session ?? '', overrides ?? null,
  ]);
  const result = await ctx.agentRuntime.spawn({
    agentRef,
    ...(session !== undefined ? { session } : {}),
    ...(overrides !== undefined ? { overrides } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      agentInstanceId: result?.agentInstanceId ?? '',
      agentId: result?.agentId ?? agentRef.agentId,
      spawnedAt: result?.spawnedAt ?? new Date().toISOString(),
    },
  };
}

/* ─── agent.delegate.smart ───────────────────────────────── */

export async function delegate(ctx) {
  ensureAgentRuntime(ctx);
  if (typeof ctx.agentRuntime.route !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.agentRuntime.route'), { code: 'host_capability_missing' });
  }
  const { candidates, escalationThreshold } = ctx.config;
  const { task, taskData } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    candidates.map((c) => c.agentInstanceId).sort().join(','),
    task, taskData ?? null,
  ]);

  const routerResult = await ctx.agentRuntime.route({
    candidates,
    task,
    ...(taskData !== undefined ? { taskData } : {}),
    idempotencyKey,
  });

  const confidence = typeof routerResult?.confidence === 'number' ? routerResult.confidence : 0;
  const threshold = escalationThreshold ?? 0.7;
  let escalated = false;

  // RFC 0011 §F conservative-path: low confidence → suspend for human approval.
  if (confidence < threshold && typeof ctx.suspend === 'function') {
    const approval = await ctx.suspend({
      reason: 'low-confidence',
      resumeKey: `delegate-${ctx.nodeId}`,
      proposed: routerResult,
      threshold,
    });
    // On resume: { approvedAgentInstanceId, approved: true } or { approved: false, rejectedReason }
    if (approval?.approved === false) {
      throw Object.assign(
        new Error(`delegate rejected by reviewer: ${approval?.rejectedReason ?? 'no reason'}`),
        { code: 'delegate_rejected' }
      );
    }
    escalated = true;
    return {
      status: 'success',
      outputs: {
        selectedAgentInstanceId: approval?.approvedAgentInstanceId ?? routerResult.selectedAgentInstanceId,
        confidence,
        ...(routerResult?.rationale ? { rationale: routerResult.rationale } : {}),
        escalated,
        ...(routerResult?.alternatives ? { alternatives: routerResult.alternatives } : {}),
      },
    };
  }

  return {
    status: 'success',
    outputs: {
      selectedAgentInstanceId: routerResult?.selectedAgentInstanceId ?? '',
      confidence,
      ...(routerResult?.rationale ? { rationale: routerResult.rationale } : {}),
      ...(routerResult?.alternatives ? { alternatives: routerResult.alternatives } : {}),
    },
  };
}

/* ─── agent.consensus.vote ───────────────────────────────── */

export async function consensus(ctx) {
  ensureAgentRuntime(ctx);
  if (typeof ctx.agentRuntime.vote !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.agentRuntime.vote'), { code: 'host_capability_missing' });
  }
  const { voters, options, tieBreaker = 'unresolved' } = ctx.config;
  const { question, context } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    voters.slice().sort().join(','), options.join('|'), question,
  ]);

  const result = await ctx.agentRuntime.vote({
    voters, options, question,
    ...(context !== undefined ? { context } : {}),
    idempotencyKey,
  });

  const votes = Array.isArray(result?.votes) ? result.votes : [];
  const tally = {};
  for (const opt of options) tally[opt] = 0;
  for (const v of votes) {
    if (typeof v?.option === 'string' && tally[v.option] !== undefined) tally[v.option]++;
  }
  const sortedByCount = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const topCount = sortedByCount[0]?.[1] ?? 0;
  const topOptions = sortedByCount.filter(([, c]) => c === topCount).map(([o]) => o);
  const isTie = topOptions.length > 1;
  let winningOption = null;
  if (!isTie) winningOption = topOptions[0];
  else if (tieBreaker === 'first') winningOption = options.find((o) => topOptions.includes(o)) ?? null;

  return {
    status: 'success',
    outputs: {
      winningOption,
      votes,
      tally,
      totalVotes: votes.length,
      isTie,
    },
  };
}

/* ─── agent.message.send ─────────────────────────────────── */

export async function messageSend(ctx) {
  ensureAgentRuntime(ctx);
  if (typeof ctx.agentRuntime.message !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.agentRuntime.message'), { code: 'host_capability_missing' });
  }
  const { toAgentInstanceId, groupId } = ctx.config;
  const { content, fromAgentInstanceId, metadata } = ctx.inputs;
  // RFC 0007 B2.3 messaging reducer requires stable messageId for idempotent fold.
  const messageId = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    toAgentInstanceId, groupId ?? '', content,
    fromAgentInstanceId ?? '',
  ]);
  const result = await ctx.agentRuntime.message({
    ...(toAgentInstanceId !== undefined ? { toAgentInstanceId } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
    content,
    ...(fromAgentInstanceId !== undefined ? { fromAgentInstanceId } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    messageId,
  });
  return {
    status: 'success',
    outputs: {
      messageId: result?.messageId ?? messageId,
      sentAt: result?.sentAt ?? new Date().toISOString(),
      ...(Array.isArray(result?.deliveredTo) ? { deliveredTo: result.deliveredTo } : { deliveredTo: toAgentInstanceId ? [toAgentInstanceId] : [] }),
    },
  };
}

/* ─── agent.skill.invoke ─────────────────────────────────── */

export async function skillInvoke(ctx) {
  ensureAgentRuntime(ctx);
  if (typeof ctx.agentRuntime.skill !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.agentRuntime.skill'), { code: 'host_capability_missing' });
  }
  const { agentInstanceId, skillId, timeoutMs } = ctx.config;
  const { args } = ctx.inputs ?? {};
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    agentInstanceId, skillId, args ?? null,
  ]);
  const start = Date.now();
  const result = await ctx.agentRuntime.skill({
    agentInstanceId, skillId,
    ...(args !== undefined ? { args } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      result: result?.result ?? null,
      isError: result?.isError === true,
      durationMs: typeof result?.durationMs === 'number' ? result.durationMs : (Date.now() - start),
    },
  };
}

/* ─── agent.swarm.execute ────────────────────────────────── */

export async function swarmExecute(ctx) {
  ensureAgentRuntime(ctx);
  if (typeof ctx.agentRuntime.swarm !== 'function') {
    throw Object.assign(new Error('host does not expose ctx.agentRuntime.swarm'), { code: 'host_capability_missing' });
  }
  const { agents, strategy, reducer, perTaskTimeoutMs } = ctx.config;
  const { task, taskData, perAgentTask } = ctx.inputs;
  const idempotencyKey = deriveIdempotencyKey([
    String(ctx.runId), String(ctx.nodeId),
    agents.slice().sort().join(','), strategy, reducer ?? '',
    task, taskData ?? null, perAgentTask ?? null,
  ]);
  const start = Date.now();
  const result = await ctx.agentRuntime.swarm({
    agents, strategy,
    ...(reducer !== undefined ? { reducer } : {}),
    ...(perTaskTimeoutMs !== undefined ? { perTaskTimeoutMs } : {}),
    task,
    ...(taskData !== undefined ? { taskData } : {}),
    ...(perAgentTask !== undefined ? { perAgentTask } : {}),
    idempotencyKey,
  });
  return {
    status: 'success',
    outputs: {
      strategy,
      ...(Array.isArray(result?.results) ? { results: result.results } : {}),
      ...(result?.reduced !== undefined ? { reduced: result.reduced } : {}),
      ...(result?.winner ? { winner: result.winner } : {}),
      succeeded: typeof result?.succeeded === 'number' ? result.succeeded : 0,
      failed: typeof result?.failed === 'number' ? result.failed : 0,
      durationMs: typeof result?.durationMs === 'number' ? result.durationMs : (Date.now() - start),
    },
  };
}

/* ─── host.coordination primitives ──────────────────────────── */

function ensureCoordination(ctx) {
  if (!ctx.coordination || typeof ctx.coordination !== 'object') {
    throw Object.assign(new Error('host does not expose ctx.coordination'), {
      code: 'host_capability_missing',
      capability: 'host.coordination',
    });
  }
}

function ensureCoordinationMethod(ctx, method) {
  ensureCoordination(ctx);
  if (typeof ctx.coordination[method] !== 'function') {
    throw Object.assign(
      new Error(`host does not expose ctx.coordination.${method}`),
      { code: 'host_capability_missing', capability: `host.coordination.${method}` },
    );
  }
}

export async function coordinationVote(ctx) {
  ensureCoordinationMethod(ctx, 'vote');
  const { defaultStrategy = 'majority', defaultQuorum = 0.5, timeout } = ctx.config ?? {};
  const { question, options, participantIds, strategy, quorum, timeout: tInput } = ctx.inputs ?? {};
  const result = await ctx.coordination.vote({
    question, options, participantIds,
    strategy: strategy ?? defaultStrategy,
    quorum: quorum ?? defaultQuorum,
    timeoutMs: tInput ?? timeout ?? 60000,
  });
  return {
    status: 'success',
    outputs: {
      winningOptionId: result?.winningOptionId ?? '',
      winningValue: result?.winningValue,
      voteCounts: result?.voteCounts ?? {},
      quorumMet: result?.quorumMet === true,
      margin: typeof result?.margin === 'number' ? result.margin : 0,
      voteCount: typeof result?.voteCount === 'number' ? result.voteCount : 0,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export async function coordinationConsensus(ctx) {
  ensureCoordinationMethod(ctx, 'consensus');
  const result = await ctx.coordination.consensus({ ...(ctx.config ?? {}), ...(ctx.inputs ?? {}) });
  return {
    status: 'success',
    outputs: {
      agreement: result?.agreement,
      converged: result?.converged === true,
      rounds: typeof result?.rounds === 'number' ? result.rounds : 0,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export async function coordinationCompete(ctx) {
  ensureCoordinationMethod(ctx, 'compete');
  const result = await ctx.coordination.compete({ ...(ctx.config ?? {}), ...(ctx.inputs ?? {}) });
  return {
    status: 'success',
    outputs: {
      winnerId: result?.winnerId ?? '',
      winnerResult: result?.winnerResult,
      durationMs: typeof result?.durationMs === 'number' ? result.durationMs : 0,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export async function coordinationMapReduce(ctx) {
  ensureCoordinationMethod(ctx, 'mapReduce');
  const result = await ctx.coordination.mapReduce({ ...(ctx.config ?? {}), ...(ctx.inputs ?? {}) });
  return {
    status: 'success',
    outputs: {
      results: Array.isArray(result?.results) ? result.results : [],
      reduced: result?.reduced,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export async function coordinationDelegate(ctx) {
  ensureCoordinationMethod(ctx, 'delegate');
  const result = await ctx.coordination.delegate({ ...(ctx.config ?? {}), ...(ctx.inputs ?? {}) });
  return {
    status: 'success',
    outputs: {
      assigneeId: result?.assigneeId ?? '',
      matchScore: typeof result?.matchScore === 'number' ? result.matchScore : 0,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export async function coordinationRoundRobin(ctx) {
  ensureCoordinationMethod(ctx, 'roundRobin');
  const cursorKey = `_roundRobinCursor:${ctx.nodeId}`;
  const cursor = ctx.variables?.get?.(cursorKey) ?? 0;
  const result = await ctx.coordination.roundRobin({
    ...(ctx.config ?? {}),
    ...(ctx.inputs ?? {}),
    cursor,
  });
  if (ctx.variables && typeof result?.nextCursor === 'number') {
    ctx.variables.set(cursorKey, result.nextCursor);
  }
  return {
    status: 'success',
    outputs: {
      assigneeId: result?.assigneeId ?? '',
      cursor: typeof result?.cursor === 'number' ? result.cursor : cursor,
      nextCursor: typeof result?.nextCursor === 'number' ? result.nextCursor : cursor + 1,
      success: result?.success !== false,
      ...(result?.error ? { error: result.error } : {}),
    },
  };
}

export const nodes = {
  'agent.spawn': spawn,
  'agent.delegate.smart': delegate,
  'agent.consensus.vote': consensus,
  'agent.message.send': messageSend,
  'agent.skill.invoke': skillInvoke,
  'agent.swarm.execute': swarmExecute,
  'coordination.vote': coordinationVote,
  'coordination.consensus': coordinationConsensus,
  'coordination.compete': coordinationCompete,
  'coordination.map-reduce': coordinationMapReduce,
  'coordination.delegate': coordinationDelegate,
  'coordination.round-robin': coordinationRoundRobin,
};

export default nodes;
