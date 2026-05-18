# `core.openwop.agents.expense-categorizer`

Classifies expenses against a policy-defined chart of accounts. Flags policy violations.

| Pack name | `core.openwop.agents.expense-categorizer` |
| Version | `1.0.0` |
| Engine | OpenWOP `>=1.1.0 <2.0.0` |
| Agents | 1 |
| Required host capabilities | `aiProviders` |
| License | Apache-2.0 |

## Policy violation codes

- `out_of_policy_category` — expense doesn't fit any allowed category
- `over_amount_limit` — exceeds per-category amount cap
- `missing_receipt_required` — caller-supplied receipt flag is false but category requires one
- `mileage_rate_mismatch` — mileage expense computed against incorrect rate
- `prohibited_vendor` — vendor on caller's prohibited list

## Handoff schemas

- `schemas/expense-categorizer.task.schema.json` — `{ expense: {description, amount, vendor, date, ...}, chartOfAccounts, policy }`
- `schemas/expense-categorizer.return.schema.json` — `{ categoryId, confidence, rationale, violations }`
