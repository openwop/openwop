# openwop.codemod.subworkflow-parent-link-drop

RFC 0171 row `C4.18`: a v1 `core.subWorkflow` child run carried `parentRunId` and `parentNodeId` on its `RunSnapshot`. In v2, `parentRunId` means "forked from" and `parentNodeId` does not exist. The child's parent is read from `getRunAncestry` (`parent.runId`, `cause: "core.subWorkflow"`, `spec/v2/core/execution.md` §`subWorkflow`).

This codemod drops both fields from a snapshot that carries `parentNodeId`, so a v2 reader does not take the child for a fork. It refuses a `parentNodeId` that is not a string or has no `parentRunId` beside it. Negative control: a snapshot without `parentNodeId`, such as a fork's, is unchanged. Idempotent.
