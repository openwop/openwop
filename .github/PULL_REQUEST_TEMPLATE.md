## Summary

<!-- One paragraph: what changed and why. -->

## Change category

- [ ] Editorial (typo / wording / non-normative clarification)
- [ ] Non-normative addition (example / reference-impl note / optional capability profile)
- [ ] Normative addition (backward-compatible — new optional field, SHOULD recommendation, additive event type)
- [ ] Breaking change (requires major version bump)
- [ ] Tooling / CI / infrastructure

See `GOVERNANCE.md` §"Spec change process" for the rules per category.

## Surface touched

- [ ] Prose spec under `spec/v2/` (which file: ...)
- [ ] JSON Schema
- [ ] OpenAPI / AsyncAPI
- [ ] `@openwop/openwop-conformance` suite
- [ ] Governance / contribution / release tooling
- [ ] CHANGELOG only

## CI gates

- [ ] Full local gate passes (`npm run openwop:check`, after the regen chain)
- [ ] OpenAPI lints clean
- [ ] AsyncAPI lints clean
- [ ] Conformance offline scenarios pass

## Conformance impact

- [ ] No new testable behavior (no suite update needed)
- [ ] New scenarios added to `@openwop/openwop-conformance` (list below)
- [ ] Existing scenarios modified (list below + justify why this isn't a breaking change)

<!-- List affected scenario files. -->

## CHANGELOG

- [ ] Added an entry to `CHANGELOG.md`

## RFC reference (if applicable)

<!-- For normative additions and breaking changes, link the RFC under `RFCS/`. SDK, example-host and site changes belong in openwop-sdks, openwop-examples and openwop-site. -->
