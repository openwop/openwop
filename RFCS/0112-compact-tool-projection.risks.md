# RFC 0112 — Risk Register

Score = Likelihood × Impact (H/M/L).

| ID  | Risk                                                                                                  | Likelihood | Impact | Score | Mitigation                                                                                 | Owner                 | Status |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | ------ | ----- | ------------------------------------------------------------------------------------------ | --------------------- | ------ |
| R1  | Compact view drops a field a model needs (e.g., an enum constraint expressible in Tier-1) → worse tool-calls | M    | M      | Med   | Tier-1 retains property types/enums/required; only structural sugar (`oneOf`/`$ref`) is barred | Spec Architect        | Open   |
| R2  | Host emits a compact catalog with a *different* tool set than standard → silent capability divergence | L          | M      | Low   | Scenario asserts identical `toolId` set across views                                       | Conformance Architect | Open   |
| R3  | A tool's real inputSchema can't be losslessly reduced to Tier-1 → host omits `inputSchema` entirely, model loses args | M | M  | Med   | Allow `inputSchema` omission but require a non-normative note; track in Unresolved Q1/Q3   | Spec Architect        | Open   |
