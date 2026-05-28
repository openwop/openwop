/**
 * vendor.myndhyve.launch-studio — Launch Studio backbone (2 nodes).
 *
 * Routes through two host adapters:
 *   - host.launchStudio  (studio + project-context + linked-artifacts)
 *   - host.kanban        (getReadyTasks + moveTask, shared with vendor.myndhyve.kanban)
 *
 * Both nodes mirror the legacy executors verbatim — same behavior,
 * pack-shaped surface.
 */

function missing(capability) {
  const err = new Error('host capability missing: ' + capability);
  err.code = 'host_capability_missing';
  err.capability = capability;
  return err;
}

/**
 * launch-studio.linkStep
 *
 * Mandatory inputs: studioId, stepId, projectId, canvasTypeId.
 * Returns success=false with error string on missing inputs (mirrors legacy).
 *
 * Behavior:
 *   1. Look up studio via ctx.launchStudio.getStudio.
 *   2. Build project context, propagate inherited artifact ids (brandId,
 *      designSystemId, prdId) onto run variables. Non-fatal on failure.
 *   3. Always set `${stepId}_projectId` — canonical step-state variable.
 */
export const linkStep = async (ctx) => {
  const { studioId, stepId, projectId, canvasTypeId } = ctx.inputs ?? {};

  if (!studioId || !stepId || !projectId || !canvasTypeId) {
    return {
      outputs: {
        studioId: studioId ?? '',
        stepId: stepId ?? '',
        projectId: projectId ?? '',
        canvasTypeId: canvasTypeId ?? '',
        success: false,
        error: 'studioId, stepId, projectId, and canvasTypeId are all required',
      },
    };
  }

  if (!ctx.launchStudio) throw missing('host.launchStudio');
  if (!ctx.variables) throw missing('ctx.variables');

  try {
    const studio = await ctx.launchStudio.getStudio(studioId);
    if (studio) {
      try {
        const projectContext = await ctx.launchStudio.buildProjectContext({
          studio,
          userId: ctx.userId,
          canvasTypeId,
        });
        ctx.variables.set(`${stepId}_projectContext`, projectContext);
        if (studio.brandId) ctx.variables.set('brandId', studio.brandId);
        if (studio.designSystemId) ctx.variables.set('designSystemId', studio.designSystemId);
        if (studio.prdId) ctx.variables.set('prdId', studio.prdId);
      } catch (err) {
        ctx.log?.('warn', 'launch-studio.linkStep: failed to build project context', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Canonical step-state variable — always set even if studio lookup
    // returned null (M3.1 view-model contract).
    ctx.variables.set(`${stepId}_projectId`, projectId);

    return {
      outputs: { studioId, stepId, projectId, canvasTypeId, success: true },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      outputs: { studioId, stepId, projectId, canvasTypeId, success: false, error: message },
    };
  }
};

/**
 * launch-studio.dispatchStackItems
 *
 * Mandatory inputs: boardId, canvasTypeId.
 *
 * Behavior:
 *   1. Read ready stack items via ctx.kanban.getReadyTasks(boardId).
 *   2. If studioId supplied, resolve cross-step linked-project artifacts
 *      via ctx.launchStudio.resolveLinkedArtifacts (non-fatal).
 *   3. Transition each item `todo → doing` via ctx.kanban.moveTask.
 *      Returns immediately — execution is async via TaskExecutor.
 */
export const dispatchStackItems = async (ctx) => {
  const { boardId, canvasTypeId, projectId, studioId } = ctx.inputs ?? {};

  if (!boardId || !canvasTypeId) {
    return {
      outputs: {
        executedCount: 0,
        results: [],
        canvasTypeId: canvasTypeId ?? '',
        projectId: projectId ?? '',
        error: 'boardId and canvasTypeId are required',
      },
    };
  }

  if (!ctx.kanban) throw missing('host.kanban');

  try {
    const readyTasks = await ctx.kanban.getReadyTasks(boardId);

    if (!readyTasks || readyTasks.length === 0) {
      return {
        outputs: {
          executedCount: 0,
          results: [],
          canvasTypeId,
          projectId: projectId ?? '',
        },
      };
    }

    if (studioId && ctx.launchStudio) {
      try {
        const studio = await ctx.launchStudio.getStudio(studioId);
        if (studio && ctx.userId && ctx.variables) {
          const artifacts = await ctx.launchStudio.resolveLinkedArtifacts({
            studio,
            userId: ctx.userId,
            sourceCanvasTypeId: canvasTypeId,
          });
          ctx.variables.set(`${canvasTypeId}_resolvedArtifacts`, artifacts);
        }
      } catch (err) {
        ctx.log?.('warn', 'launch-studio.dispatchStackItems: linked-artifact resolve failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const results = await Promise.all(
      readyTasks.map(async (task) => {
        await ctx.kanban.moveTask(task.id, 'doing');
        return { taskId: task.id, success: true, artifactIds: [] };
      }),
    );

    return {
      outputs: {
        executedCount: results.length,
        results,
        canvasTypeId,
        projectId: projectId ?? '',
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      outputs: {
        executedCount: 0,
        results: [],
        canvasTypeId,
        projectId: projectId ?? '',
        error: message,
      },
    };
  }
};

export const nodes = {
  'launch-studio.linkStep': linkStep,
  'launch-studio.dispatchStackItems': dispatchStackItems,
};
