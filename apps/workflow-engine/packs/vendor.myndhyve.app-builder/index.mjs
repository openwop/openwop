/**
 * vendor.myndhyve.app-builder
 *
 * Two typeIds against host.chat + host.aiEnvelope (both v1-specced):
 *
 *   - `app-builder.per-screen`   — single-task screen generation.
 *                                   Sends a per-screen prompt via
 *                                   ctx.chat.sendMessage, waits for the
 *                                   typed envelope via ctx.aiEnvelope.await.
 *                                   Bounded retry on timeout.
 *   - `app-builder.iterate-tasks` — multi-task loop. Extracts feature tasks
 *                                   from a plan artifact (robust to 4
 *                                   observed AI shapes), runs per-screen
 *                                   N times serially, aggregates results.
 *                                   Task-level failure isolation.
 *
 * Source map:
 *   - src/canvas-types/app-builder/nodes/perScreenExecutor.ts (~80 LOC)
 *   - src/canvas-types/app-builder/nodes/perScreenPrompt.ts   (113 LOC)
 *   - src/canvas-types/app-builder/nodes/iterateTasksExecutor.ts
 *     (multi-task loop + plan-shape parsing, ~250 LOC of relevant logic)
 *
 * Pure-JS, Node-20 stdlib only.
 *
 * Out of pack scope (host concerns, NOT ported):
 *   - Progress card rendering / updates
 *   - Per-task completion-card emission
 *   - WOP App Builder Pilot materializer (WopStackItem minting)
 *   - WorkflowEngine-internal envelope routing accounting
 *     (_currentAIStepNode / _injectedEnvelopeResult variables —
 *     handled by host.aiEnvelope.await per spec)
 *   - Telemetry recordAutoPlayTask/Failure (host MAY emit telemetry from
 *     return values; pack returns categorized failure reasons)
 *   - Screen artifact-sync registration check (host concern)
 */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

function ensureChat(ctx) {
  if (!ctx.chat || typeof ctx.chat.sendMessage !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.chat.sendMessage — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'host.chat' },
    );
  }
}

function ensureAiEnvelope(ctx) {
  if (!ctx.aiEnvelope || typeof ctx.aiEnvelope.await !== 'function') {
    throw Object.assign(
      new Error('host does not expose ctx.aiEnvelope.await — workflow-register should have refused this pack at peerDependency resolution time'),
      { code: 'host_capability_missing', capability: 'host.aiEnvelope.await' },
    );
  }
}

/* ─── prompt builder (lifted verbatim from perScreenPrompt.ts) ─── */

function buildPerScreenPrompt(task, prd, theme, taskIndex, totalTasks) {
  const lines = [];
  lines.push(`Generate the "${task.title}" screen (task ${taskIndex + 1} of ${totalTasks}).`);
  lines.push('');
  if (task.description) {
    lines.push('## Task Description');
    lines.push(task.description);
    lines.push('');
  }
  if (task.acceptance) {
    lines.push('## Acceptance Criteria');
    lines.push(task.acceptance);
    lines.push('');
  }
  if (prd?.title || prd?.summary) {
    lines.push('## Product Context');
    if (prd.title) lines.push(`**Title:** ${prd.title}`);
    if (prd.summary) lines.push(`**Summary:** ${prd.summary}`);
    if (prd.goals && Array.isArray(prd.goals) && prd.goals.length > 0) {
      lines.push(`**Goals:** ${prd.goals.slice(0, 3).join('; ')}`);
    }
    lines.push('');
  }
  if (theme?.name) {
    const primary = theme.color?.primary;
    const bodyFont = theme.typography?.body?.font;
    lines.push('## Design System');
    lines.push(`**Theme:** ${theme.name}`);
    if (primary) lines.push(`**Primary color:** ${primary}`);
    if (bodyFont) lines.push(`**Body font:** ${bodyFont}`);
    lines.push('');
  }
  lines.push('## Available Components');
  lines.push('Request schemas for any of these IDs via `schema.request`:');
  lines.push('');
  lines.push('**Layout:** container, column, row, card, sizedBox, spacer, scrollView');
  lines.push('**Display:** text, icon, image, divider, avatar, badge, chip, progressBar, starRating');
  lines.push('**Input:** textField, checkbox, toggle, dropdown, radioGroup, slider, searchBar');
  lines.push('**Navigation:** appBar, bottomNavigation, drawer, tabs, fab, iconButton');
  lines.push('**Lists:** list, listTile, timeline');
  lines.push('**Cards:** statCard, productCard, priceTag, notificationItem');
  lines.push('**Interactive:** button, socialLoginButton, otpInput, quantitySelector, countdownTimer');
  lines.push('');
  lines.push('## Protocol');
  lines.push('1. **Request schemas first.** Emit a `schema.request` envelope for the component types you need (e.g., `{ "type": "schema.request", "payload": { "schemaType": "component", "ids": ["text", "button", "container", "image"] } }`).');
  lines.push('2. **Compose the screen.** After receiving the schemas, emit ONE `screen.emit` envelope with `mode: "create"`. The payload should contain exactly ONE screen for this task, with a nested `components` tree. Use only prop names from the returned schemas.');
  lines.push('3. **No connections yet.** This is a per-screen iteration — screen-to-screen navigation will be added in a later pass. Leave `connections` empty.');
  lines.push('4. **Use design system tokens.** Colors, typography, and spacing should reference the theme.');
  lines.push('');
  lines.push('Respond with a single `screen.emit` JSON envelope. Do not use tool calls.');
  return lines.join('\n');
}

/* ─── failure categorization (lifted from perScreenPrompt.ts) ─── */

function categorizePerScreenFailure(technical) {
  const s = String(technical ?? '');
  if (/Workflow cancelled/i.test(s)) return 'cancelled';
  if (/Timed out waiting for|timeout/i.test(s)) return 'timeout';
  if (/No valid envelopes found|EnvelopeParser|invalid JSON|could not parse|envelope malformed/i.test(s)) return 'envelope-malformed';
  if (/empty response|no content|zero chunks/i.test(s)) return 'ai-no-response';
  if (/injection failed|could not inject|run no longer active/i.test(s)) return 'route-failed';
  return 'other';
}

function userMessageFor(taskTitle, taskTimeoutMs, technical) {
  const reason = categorizePerScreenFailure(technical);
  switch (reason) {
    case 'cancelled': return `Generation cancelled for "${taskTitle}".`;
    case 'timeout': {
      const seconds = Math.round(taskTimeoutMs / 1000);
      return `The AI didn't respond for "${taskTitle}" within ${seconds}s. The model may be slow or your API key may be invalid.`;
    }
    case 'envelope-malformed': return `The AI response for "${taskTitle}" was malformed. Click the card to retry.`;
    case 'ai-no-response': return `The AI returned nothing for "${taskTitle}". Check your API key or quota.`;
    case 'route-failed': return `The AI response for "${taskTitle}" was received but couldn't be attached. Retry or restart the workflow.`;
    default: return `Failed to generate "${taskTitle}". Click the card to retry.`;
  }
}

/* ─── plan task extraction (robust to 4 observed AI shapes) ─── */
/*
 * Lifted from iterateTasksExecutor.ts:extractFeatureTasks.
 * Handles:
 *   1. Canonical PlanModel — { steps: [...] }
 *   2. AI-default — { tasks: [...] }
 *   3. AI-confused envelope — { "tasks.create": [...] }
 *   4. AI-nested envelope — { "tasks.create": { phases: [{ tasks: [...] }] } }
 */

function extractFeatureTasks(plan) {
  if (!plan) return [];
  const TASK_KEYS = ['steps', 'tasks', 'items'];

  const flattenPhases = (phases) => {
    if (!Array.isArray(phases) || phases.length === 0) return null;
    const flat = [];
    for (const ph of phases) {
      if (!ph || typeof ph !== 'object') continue;
      const inner = ph.tasks;
      if (Array.isArray(inner)) flat.push(...inner);
    }
    return flat.length > 0 ? flat : null;
  };

  const seen = new WeakSet();
  const findArray = (v, depth = 0) => {
    if (depth > 4 || v == null) return null;
    if (Array.isArray(v)) {
      if (v.length > 0 && typeof v[0] === 'object') return v;
      return null;
    }
    if (typeof v !== 'object') return null;
    if (seen.has(v)) return null;
    seen.add(v);

    const flat = flattenPhases(v.phases);
    if (flat) return flat;

    for (const key of TASK_KEYS) {
      const sub = v[key];
      if (Array.isArray(sub) && sub.length > 0 && typeof sub[0] === 'object') return sub;
    }
    for (const key of ['payload', 'data', 'result', 'value']) {
      const found = findArray(v[key], depth + 1);
      if (found) return found;
    }
    for (const val of Object.values(v)) {
      const found = findArray(val, depth + 1);
      if (found) return found;
    }
    return null;
  };

  const candidates = [plan.steps, plan.tasks, plan['tasks.create'], plan['plan.create'], plan.items, plan.payload];
  let rawSteps = null;
  for (const c of candidates) {
    rawSteps = findArray(c);
    if (rawSteps) break;
  }
  if (!rawSteps) rawSteps = findArray(plan) ?? [];
  if (rawSteps.length === 0) return [];

  // Filtering priority: explicit isFeatureTask flag → canonical kind → AI fallback.
  const featureTasks = rawSteps.filter((s) => s?.isFeatureTask === true);
  if (featureTasks.length > 0) return featureTasks;

  const canonical = rawSteps.filter((s) => {
    const kind = s?.kind;
    return kind === 'design' || kind === 'action' || kind === 'feature';
  });
  if (canonical.length > 0) return canonical;

  // AI fallback — include everything except explicit 'planning'.
  return rawSteps.filter((s) => {
    const phase = String(s?.phase ?? '');
    const kind = String(s?.kind ?? '');
    return !/^planning$/i.test(phase) && !/^planning$/i.test(kind);
  });
}

/* ─── 1. app-builder.per-screen ─── */

export async function perScreen(ctx) {
  ensureChat(ctx);
  ensureAiEnvelope(ctx);
  const log = makeLog(ctx);

  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const task = inputs.task;
  if (!task || typeof task !== 'object' || typeof task.title !== 'string' || task.title.length === 0) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'inputs.task is required and must have a non-empty title', retryable: false },
    };
  }

  const expectedEnvelopeType = config.expectedEnvelopeType ?? 'screen.emit';
  const taskTimeoutMs = config.taskTimeoutMs ?? 180000;
  const taskRetryCount = Math.max(0, config.taskRetryCount ?? 0);
  const prd = inputs.prd;
  const theme = inputs.theme;
  const taskIndex = typeof inputs.taskIndex === 'number' ? inputs.taskIndex : 0;
  const totalTasks = typeof inputs.totalTasks === 'number' ? inputs.totalTasks : 1;

  const prompt = buildPerScreenPrompt(task, prd, theme, taskIndex, totalTasks);
  const maxAttempts = 1 + taskRetryCount;

  log.debug('Generating screen', {
    taskTitle: task.title,
    taskIndex,
    totalTasks,
    taskTimeoutMs,
    maxAttempts,
    expectedEnvelopeType,
  });

  let envelopePayload = null;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Fire-and-forget chat message — chat.sendMessage shape per
      // spec/v1/host-capabilities.md §host.chat. We don't await its
      // resolution; the envelope-await below is the authoritative signal.
      ctx.chat.sendMessage({
        role: 'user',
        content: prompt,
        idempotencyKey: `app-builder.per-screen:${ctx.runId ?? 'unknown'}:${task.id ?? task.title}:${attempt}`,
      }).catch((err) => {
        log.warn('chat.sendMessage errored mid-flight (waiting for envelope anyway)', {
          taskTitle: task.title,
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      const envResult = await ctx.aiEnvelope.await({
        envelopeType: expectedEnvelopeType,
        timeoutMs: taskTimeoutMs,
      });

      if (envResult.timedOut) {
        throw new Error(`Timed out waiting for ${expectedEnvelopeType} envelope after ${taskTimeoutMs}ms`);
      }

      envelopePayload = envResult.payload ?? {};
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const reason = categorizePerScreenFailure(msg);
      const isRetriable = reason === 'timeout';
      if (!isRetriable || attempt >= maxAttempts) {
        const userMessage = userMessageFor(task.title, taskTimeoutMs, msg);
        log.error('Per-screen generation failed', {
          taskTitle: task.title,
          attempt,
          maxAttempts,
          reason,
          technical: msg,
        });
        return {
          status: 'error',
          error: {
            code: 'PER_SCREEN_FAILED',
            message: userMessage,
            retryable: reason === 'timeout' || reason === 'ai-no-response',
            details: { failureReason: reason, technical: msg, taskTitle: task.title, attempt },
          },
        };
      }
      log.warn('Per-screen task timed out — retrying', {
        taskTitle: task.title,
        attempt,
        maxAttempts,
      });
    }
  }

  const screenId = (envelopePayload && typeof envelopePayload === 'object')
    ? (envelopePayload.artifactId ?? envelopePayload.screenId ?? envelopePayload.id ?? null)
    : null;

  log.info('Per-screen task completed', {
    taskTitle: task.title,
    screenId,
  });

  return {
    status: 'success',
    outputs: {
      success: true,
      screenId,
      taskTitle: task.title,
      envelopePayload,
    },
  };
}

/* ─── 2. app-builder.iterate-tasks ─── */

export async function iterateTasks(ctx) {
  ensureChat(ctx);
  ensureAiEnvelope(ctx);
  const log = makeLog(ctx);

  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};

  const expectedEnvelopeType = config.expectedEnvelopeType ?? 'screen.emit';
  const taskTimeoutMs = config.taskTimeoutMs ?? 180000;
  const taskRetryCount = Math.max(0, config.taskRetryCount ?? 0);
  const failOnAnyTaskError = config.failOnAnyTaskError === true;

  const plan = inputs.planArtifact;
  const prd = inputs.prdArtifact;
  const theme = inputs.themeArtifact;

  const tasks = extractFeatureTasks(plan);
  if (tasks.length === 0) {
    log.warn('No feature tasks found in plan — nothing to iterate', {
      planId: plan?.id,
      candidatesProbed: plan ? Object.keys(plan).length : 0,
    });
    return {
      status: 'success',
      outputs: {
        success: true,
        tasksProcessed: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        taskResults: [],
        errors: [],
        failuresByReason: { timeout: 0, cancelled: 0, 'envelope-malformed': 0, 'ai-no-response': 0, 'route-failed': 0, other: 0 },
      },
    };
  }

  log.info('Starting per-task screen generation', {
    taskCount: tasks.length,
    taskTimeoutMs,
    taskRetryCount,
  });

  const taskResults = [];
  const errors = [];
  const failuresByReason = { timeout: 0, cancelled: 0, 'envelope-malformed': 0, 'ai-no-response': 0, 'route-failed': 0, other: 0 };
  let tasksSucceeded = 0;
  let tasksFailed = 0;

  // Serial iteration. Concurrency is possible with envelope correlation
  // IDs but out of scope here (matches source-side `concurrency: 1`).
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];

    // Honor abort signal between tasks.
    if (ctx.signal?.aborted) {
      log.info('Iteration aborted', { completedTasks: i, totalTasks: tasks.length });
      const remaining = tasks.length - i;
      for (let j = 0; j < remaining; j++) {
        taskResults.push({
          taskId: tasks[i + j]?.id ?? null,
          taskTitle: tasks[i + j]?.title ?? '',
          success: false,
          skipped: true,
          failureReason: 'cancelled',
        });
        failuresByReason.cancelled++;
      }
      tasksFailed += remaining;
      break;
    }

    // Delegate to perScreen for the per-task work. Note we call the
    // function directly (within-pack composition) — the engine sees
    // a single iterate-tasks invocation.
    const subCtx = {
      ...ctx,
      inputs: {
        task,
        prd,
        theme,
        taskIndex: i,
        totalTasks: tasks.length,
      },
      config: {
        expectedEnvelopeType,
        taskTimeoutMs,
        taskRetryCount,
      },
    };

    let result;
    try {
      result = await perScreen(subCtx);
    } catch (err) {
      // perScreen throws only on host_capability_missing, which we've
      // already guarded. Any other throw indicates a genuine bug.
      log.error('perScreen threw unexpectedly', {
        taskTitle: task.title,
        error: err instanceof Error ? err.message : String(err),
      });
      result = { status: 'error', error: { code: 'PER_SCREEN_THREW', message: String(err?.message ?? err), retryable: false } };
    }

    if (result.status === 'success' && result.outputs?.success) {
      tasksSucceeded++;
      taskResults.push({
        taskId: task.id ?? null,
        taskTitle: task.title,
        success: true,
        screenId: result.outputs.screenId ?? null,
      });
    } else {
      tasksFailed++;
      const reason = result.error?.details?.failureReason ?? 'other';
      failuresByReason[reason] = (failuresByReason[reason] ?? 0) + 1;
      errors.push({
        taskId: task.id ?? null,
        taskTitle: task.title,
        error: result.error?.message ?? 'unknown error',
        failureReason: reason,
      });
      taskResults.push({
        taskId: task.id ?? null,
        taskTitle: task.title,
        success: false,
        failureReason: reason,
        error: result.error?.message ?? 'unknown error',
      });

      if (failOnAnyTaskError) {
        log.error('failOnAnyTaskError=true — aborting after first failure', {
          taskTitle: task.title,
          tasksProcessed: i + 1,
          totalTasks: tasks.length,
        });
        // Mark remaining tasks as skipped.
        for (let j = i + 1; j < tasks.length; j++) {
          taskResults.push({
            taskId: tasks[j]?.id ?? null,
            taskTitle: tasks[j]?.title ?? '',
            success: false,
            skipped: true,
            failureReason: 'cancelled',
          });
          failuresByReason.cancelled++;
          tasksFailed++;
        }
        break;
      }
    }
  }

  const tasksProcessed = taskResults.filter((r) => !r.skipped).length;
  const overallSuccess = tasksFailed === 0 || (!failOnAnyTaskError && tasksSucceeded > 0);

  log.info('Iterate-tasks completed', {
    tasksProcessed,
    tasksSucceeded,
    tasksFailed,
    overallSuccess,
  });

  return {
    status: 'success',
    outputs: {
      success: overallSuccess,
      tasksProcessed,
      tasksSucceeded,
      tasksFailed,
      taskResults,
      errors,
      failuresByReason,
    },
  };
}

const nodes = {
  'app-builder.per-screen': perScreen,
  'app-builder.iterate-tasks': iterateTasks,
};

export default nodes;
