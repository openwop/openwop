/**
 * vendor.myndhyve.entities — entities + validation + asset-decision +
 * messaging primitives (5 nodes).
 *
 * Host adapters:
 *   host.entities  — createProject, listAssets, getAsset
 *   host.messaging — dispatchEgressEnvelope
 *
 * crossStageCheck is pure (no host); only needs ctx.variables.
 */

function missing(capability) {
  const err = new Error('host capability missing: ' + capability);
  err.code = 'host_capability_missing';
  err.capability = capability;
  return err;
}

// ─── helpers shared by crossStageCheck ────────────────────────────────

function resolvePath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part === 'length' && Array.isArray(current)) return current.length;
    current = current[part];
  }
  return current;
}

function countItems(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

// ─── core.entities.projectCreate ─────────────────────────────────────

export const projectCreate = async (ctx) => {
  const userId = ctx.userId;
  if (!userId) {
    return {
      outputs: {
        projectId: '',
        canvasTypeId: '',
        success: false,
        error: 'projectCreate requires auth context (run.triggeredBy)',
      },
    };
  }

  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};
  const { canvasTypeId, name } = inputs;

  if (!canvasTypeId || !name) {
    return {
      outputs: {
        projectId: '',
        canvasTypeId: canvasTypeId ?? '',
        success: false,
        error: 'canvasTypeId and name are required',
      },
    };
  }

  if (!ctx.entities) throw missing('host.entities');

  const idempotencyKey = `${ctx.runId}:${ctx.nodeId}:project-create:${canvasTypeId}:${name}`;
  const acquire = ctx.sideEffects?.tryAcquire?.({
    effectType: 'artifact_create',
    sourceEnvelopeType: 'project.create',
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    description: `Create project ${name} (canvas ${canvasTypeId})`,
    idempotencyKey,
  });

  if (acquire?.state === 'duplicate') {
    return {
      outputs:
        acquire.previousResult ?? {
          projectId: '',
          canvasTypeId,
          success: false,
          error: 'duplicate without cached result',
        },
    };
  }
  if (acquire?.state === 'in-flight') {
    return {
      outputs: {
        projectId: '',
        canvasTypeId,
        success: false,
        error: 'projectCreate already in flight for this run/node — concurrent dispatch',
      },
    };
  }

  try {
    const project = await ctx.entities.createProject({
      userId,
      name,
      canvasTypeId,
      type: inputs.type ?? config.defaultType ?? 'app',
      status: inputs.status ?? config.defaultStatus ?? 'draft',
      settings: {
        designSystemId: inputs.designSystemId,
        collaborationEnabled: false,
        versionHistoryEnabled: true,
        autoSaveInterval: 30000,
        ...(inputs.extraSettings ?? {}),
      },
      idempotencyKey,
    });

    const result = { projectId: project.id, canvasTypeId, success: true };
    if (acquire?.state === 'acquired') {
      ctx.sideEffects?.markCompleted?.(acquire.effectId, result);
    }
    return { outputs: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (acquire?.state === 'acquired') {
      ctx.sideEffects?.markFailed?.(acquire.effectId, message);
    }
    return {
      outputs: { projectId: '', canvasTypeId, success: false, error: message },
    };
  }
};

// ─── core.validation.crossStageCheck ─────────────────────────────────

export const crossStageCheck = async (ctx) => {
  const { sourceArtifact, targetArtifact } = ctx.inputs ?? {};
  const checks = ctx.config?.checks ?? [];
  const failOnMismatch = ctx.config?.failOnMismatch ?? false;

  const warnings = [];
  let passed = 0;

  if (!sourceArtifact || !targetArtifact) {
    const msg = 'Missing artifact data for validation';
    return {
      outputs: {
        success: !failOnMismatch,
        passed: 0,
        total: checks.length,
        warnings: [msg],
        summary: msg,
      },
    };
  }

  for (const check of checks) {
    const sourceValue = resolvePath(sourceArtifact, check.sourcePath);
    const targetValue = resolvePath(targetArtifact, check.targetPath);

    let checkPassed = false;
    switch (check.compare) {
      case 'equal':
        checkPassed = sourceValue === targetValue;
        break;
      case 'gte':
        checkPassed = Number(targetValue) >= Number(sourceValue);
        break;
      case 'lte':
        checkPassed = Number(targetValue) <= Number(sourceValue);
        break;
      case 'exists':
        checkPassed = targetValue !== undefined && targetValue !== null;
        break;
      case 'count-match': {
        const sourceCount = countItems(sourceValue);
        const targetCount = countItems(targetValue);
        checkPassed = targetCount >= sourceCount;
        if (!checkPassed) {
          warnings.push(
            `${check.name}: expected at least ${sourceCount} items, found ${targetCount}`,
          );
        }
        break;
      }
    }

    if (checkPassed) passed++;
    else if (check.compare !== 'count-match') {
      warnings.push(
        `${check.name}: source=${JSON.stringify(sourceValue)}, target=${JSON.stringify(targetValue)}`,
      );
    }
  }

  const allPassed = warnings.length === 0;
  const summary = allPassed
    ? `All ${checks.length} validation checks passed`
    : `${passed}/${checks.length} checks passed. ${warnings.length} warnings.`;

  ctx.variables?.set?.('_lastValidation', { passed, total: checks.length, warnings });

  return {
    outputs: {
      success: allPassed || !failOnMismatch,
      passed,
      total: checks.length,
      warnings,
      summary,
    },
  };
};

// ─── core.workflow.assetDecisionGate ─────────────────────────────────

export const assetDecisionGate = async (ctx) => {
  const config = ctx.config ?? {};
  const {
    assetType,
    label,
    description,
    allowSkip = false,
    allowCreate = true,
    autoResolveVariable,
  } = config;

  if (!ctx.entities) throw missing('host.entities');

  const mergedFilterConfig = {
    ...(config.filterConfig ?? {}),
    ...(ctx.inputs?.brandId ? { brandId: ctx.inputs.brandId } : {}),
  };

  // Auto-resolve shortcut: if the inheritance variable is already set,
  // skip the HITL pause entirely.
  if (autoResolveVariable && ctx.variables) {
    const preSelectedId = ctx.variables.get(autoResolveVariable);
    if (typeof preSelectedId === 'string' && preSelectedId.length > 0) {
      const assetData = await ctx.entities.getAsset({ assetType, assetId: preSelectedId });
      return {
        outputs: {
          decision: 'use-existing',
          assetId: preSelectedId,
          assetData: assetData ?? {},
          autoResolved: true,
        },
      };
    }
  }

  const availableAssets = await ctx.entities.listAssets({
    assetType,
    filterConfig: mergedFilterConfig,
  });

  const actions = [];
  if (availableAssets && availableAssets.length > 0) actions.push('use-existing');
  if (allowCreate) actions.push('create-new');
  if (allowSkip) actions.push('skip');

  if (actions.length === 0) {
    return {
      outputs: { decision: 'skip', autoResolved: false, skipped: true },
    };
  }

  if (!ctx.suspend) throw missing('ctx.suspend');

  const approvalResult = await ctx.suspend({
    reason: 'approval',
    prompt: {
      title: label || `Select ${assetType}`,
      body: description || `Choose an existing ${assetType} or create a new one.`,
    },
    availableAssets,
    actionIds: actions,
  });

  if (approvalResult?.decision === 'approved' || approvalResult?.approved) {
    const selectedAssetId = approvalResult.feedback;
    if (selectedAssetId) {
      const assetData = await ctx.entities.getAsset({
        assetType,
        assetId: selectedAssetId,
      });
      return {
        outputs: {
          decision: 'use-existing',
          assetId: selectedAssetId,
          assetData: assetData ?? {},
          autoResolved: false,
        },
      };
    }
    return { outputs: { decision: 'create-new', autoResolved: false } };
  }

  if (approvalResult?.decision === 'rejected' && allowSkip) {
    return { outputs: { decision: 'skip', autoResolved: false, skipped: true } };
  }

  // Default fallback — matches legacy semantics: any non-skip
  // non-existing-pick resolves to create-new.
  return { outputs: { decision: 'create-new', autoResolved: false } };
};

// ─── messaging shared egress dispatch ────────────────────────────────

async function dispatchEgress(ctx, envelope) {
  if (!ctx.messaging) throw missing('host.messaging');
  try {
    const result = await ctx.messaging.dispatchEgressEnvelope({
      envelope,
      connectorInstanceId: envelope.accountId,
      nodeId: ctx.nodeId,
    });
    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── messaging.chatSend ──────────────────────────────────────────────

export const chatSend = async (ctx) => {
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};
  const connectorInstanceId = inputs.connectorInstanceId ?? config.connectorInstanceId;
  const channel = inputs.channel ?? config.channel;
  const conversationId = inputs.conversationId ?? config.conversationId;
  const threadId = inputs.threadId ?? config.threadId;
  const text = typeof inputs.text === 'string' ? inputs.text : '';
  const media = Array.isArray(inputs.media) ? inputs.media : undefined;

  if (!connectorInstanceId) {
    return { outputs: { success: false, error: 'connectorInstanceId is required' } };
  }
  if (!channel) return { outputs: { success: false, error: 'channel is required' } };
  if (!conversationId) {
    return { outputs: { success: false, error: 'conversationId is required' } };
  }
  if (!text && (!media || media.length === 0)) {
    return { outputs: { success: false, error: 'text or media is required' } };
  }

  const envelope = {
    type: 'chat.egress',
    version: '1.0',
    channel,
    accountId: connectorInstanceId,
    delivery: { conversationId, threadId },
    content: {
      text,
      media: media?.map((m) => ({
        kind: m.type === 'file' ? 'document' : m.type,
        ref: m.url,
      })),
    },
    idempotencyKey: `send-${ctx.runId}-${ctx.nodeId}-${Date.now()}`,
    mode: { typing: false, draftStreaming: false },
  };

  const result = await dispatchEgress(ctx, envelope);
  return { outputs: result };
};

// ─── messaging.chatReply ─────────────────────────────────────────────

export const chatReply = async (ctx) => {
  const inputs = ctx.inputs ?? {};
  const config = ctx.config ?? {};
  const text = typeof inputs.text === 'string' ? inputs.text : '';
  const media = Array.isArray(inputs.media) ? inputs.media : undefined;

  if (!text && (!media || media.length === 0)) {
    return { outputs: { success: false, error: 'Reply text or media is required' } };
  }

  const ingressEnvelope = ctx.variables?.get?.('_ingressEnvelope');
  if (!ingressEnvelope) {
    return {
      outputs: {
        success: false,
        error: 'No originating message found — this node requires a chat-message trigger',
      },
    };
  }

  const connectorInstanceId = config.connectorInstanceId;
  if (!connectorInstanceId) {
    return {
      outputs: { success: false, error: 'connectorInstanceId is required in config' },
    };
  }

  // Build reply envelope mirroring the original chatReply.node.ts contract.
  const envelope = {
    type: 'chat.egress',
    version: '1.0',
    channel: ingressEnvelope.channel,
    accountId: connectorInstanceId,
    delivery: {
      conversationId: ingressEnvelope.delivery?.conversationId,
      threadId: ingressEnvelope.delivery?.threadId,
      inReplyTo: ingressEnvelope.messageId,
    },
    content: {
      text,
      media: media?.map((m) => ({
        kind: m.type === 'file' ? 'document' : m.type,
        ref: m.url,
      })),
    },
    idempotencyKey: `reply-${ctx.runId}-${ctx.nodeId}-${Date.now()}`,
    mode: { typing: false, draftStreaming: false },
  };

  const result = await dispatchEgress(ctx, envelope);
  return { outputs: result };
};

export const nodes = {
  'core.entities.projectCreate': projectCreate,
  'core.validation.crossStageCheck': crossStageCheck,
  'core.workflow.assetDecisionGate': assetDecisionGate,
  'messaging.chatSend': chatSend,
  'messaging.chatReply': chatReply,
};
