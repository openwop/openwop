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

- [ ] Prose spec (which file: ...)
- [ ] JSON Schema
- [ ] OpenAPI / AsyncAPI
- [ ] SDK (`@openwop/openwop` / `openwop-client` / `openwopclient`)
- [ ] `@openwop/openwop-conformance` suite
- [ ] Examples
- [ ] Governance / contribution / release tooling
- [ ] CHANGELOG only

## CI gates

- [ ] Full local gate passes (`npm run openwop:check`)
- [ ] OpenAPI lints clean
- [ ] AsyncAPI lints clean
- [ ] SDK typechecks
- [ ] Conformance offline scenarios pass
- [ ] Examples validate against schemas
- [ ] Link check passes

## Conformance impact

- [ ] No new testable behavior (no suite update needed)
- [ ] New scenarios added to `@openwop/openwop-conformance` (list below)
- [ ] Existing scenarios modified (list below + justify why this isn't a breaking change)

<!-- List affected scenario files. -->

## CHANGELOG

- [ ] Added an entry to `CHANGELOG.md`

## RFC reference (if applicable)

<!-- For normative additions and breaking changes. Link the RFC issue. -->
