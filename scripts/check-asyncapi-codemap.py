#!/usr/bin/env python3
"""check-asyncapi-codemap — api/v2/asyncapi.yaml names v2 events, never v1 spellings.

events.md §"SSE frames": the SSE `event:` label is the v2 `type`, and the v2 names are
the `v2` column of spec/v2/event-codemap.json. api/v2/asyncapi.yaml is GENERATED from the
v1 document by scripts/derive-v2-api.py, which copies v1 components; this gate refuses a
v1 spelling that survives the copy (2.36.2, D5 — ten such names shipped through 2.36.1
with no gate noticing). It checks:

  1. every `components.messages[*].name` is a codemap v2 name, unless the message is
     exempt below; a name that is a v1 spelling of a renamed row is reported as such;
  2. every message a channel references resolves, and every message of the `runEvents`
     channel obeys rule 1 with no exemption except the frame names;
  3. the document contains no `/v1/` path;
  4. `ApiKeyAuth` has the same type and scheme as api/v2/openapi.yaml's (RFC 0200 §F).

Exemptions, each with its source:
  - messages of the `hostEvents` channel: host events are not run events and are not in
    the codemap (events.md §"Host events", RFC 0060 — `heartbeat.stateChanged` is its
    shipped name, and renaming it would be a reshape under RFC 0197 §A.1);
  - frame names that are not types (events.md §"SSE frames"): state.snapshot,
    ai.message.chunk, batch;
  - catch-alls: `any` (debug), `runEvent` (the generic RunEvent message);
  - run.annotated: a live-only notification that never enters the log (RFC 0056).

  --asyncapi <path>   check another document (the sabotage legs use it).
Exit 0 on success, 1 on any failure.
"""
import json
import sys
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:
    sys.exit('check-asyncapi-codemap: PyYAML is required (python3 -m pip install pyyaml)')

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[1:]
path = Path(args[args.index('--asyncapi') + 1]).resolve() if '--asyncapi' in args else ROOT / 'api' / 'v2' / 'asyncapi.yaml'
doc = yaml.safe_load(path.read_text())
oas = yaml.safe_load((ROOT / 'api' / 'v2' / 'openapi.yaml').read_text())
codemap = json.loads((ROOT / 'spec' / 'v2' / 'event-codemap.json').read_text())
v2_names = {r['v2'] for r in codemap['rows']}
v1_renamed = {r['v1']: r['v2'] for r in codemap['rows'] if r['v1'] != r['v2']}

FRAME_NAMES = {'state.snapshot', 'ai.message.chunk', 'batch'}
CATCH_ALLS = {'any', 'runEvent'}
LIVE_ONLY = {'run.annotated'}
EXEMPT_CHANNELS = {'hostEvents'}

failures = []
messages = (doc.get('components') or {}).get('messages') or {}

def ref_target(ref):
    prefix = '#/components/messages/'
    return ref[len(prefix):] if isinstance(ref, str) and ref.startswith(prefix) else None

exempt_keys = set()
run_event_keys = set()
for cname, ch in (doc.get('channels') or {}).items():
    for mkey, m in ((ch or {}).get('messages') or {}).items():
        target = ref_target((m or {}).get('$ref'))
        if target is None or target not in messages:
            failures.append(f'channel {cname}: message {mkey} does not resolve to a components.messages entry ({(m or {}).get("$ref")})')
            continue
        if cname in EXEMPT_CHANNELS:
            exempt_keys.add(target)
        if cname == 'runEvents':
            run_event_keys.add(target)

checked = 0
for key, msg in messages.items():
    name = (msg or {}).get('name')
    if not isinstance(name, str):
        failures.append(f'components.messages.{key}: no `name`')
        continue
    if key in exempt_keys and key not in run_event_keys:
        continue
    allowed = FRAME_NAMES | CATCH_ALLS | (set() if key in run_event_keys else LIVE_ONLY)
    if name in allowed:
        continue
    checked += 1
    if name in v1_renamed:
        failures.append(f'components.messages.{key}: `{name}` is a v1 spelling; the v2 type is `{v1_renamed[name]}` (spec/v2/event-codemap.json)')
    elif name not in v2_names:
        failures.append(f'components.messages.{key}: `{name}` is not a v2 event type in spec/v2/event-codemap.json and is not exempt')

text = path.read_text()
for i, line in enumerate(text.splitlines(), 1):
    if '/v1/' in line:
        failures.append(f'line {i}: a `/v1/` path in the v2 document: {line.strip()[:120]}')

a_scheme = ((doc.get('components') or {}).get('securitySchemes') or {}).get('ApiKeyAuth')
o_scheme = ((oas.get('components') or {}).get('securitySchemes') or {}).get('ApiKeyAuth')
if a_scheme is not None and o_scheme is not None:
    for k in ('type', 'scheme'):
        if a_scheme.get(k) != o_scheme.get(k):
            failures.append(f'securitySchemes.ApiKeyAuth.{k}: asyncapi `{a_scheme.get(k)}` ≠ openapi `{o_scheme.get(k)}` (RFC 0200 §F: one scheme)')

if checked == 0:
    failures.append('no message name was checked — the gate would be vacuous')

label = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
if failures:
    print(f'=== check-asyncapi-codemap FAILED — {len(failures)} problem(s) in {label} ===', file=sys.stderr)
    for f in failures:
        print(f'  {f}', file=sys.stderr)
    sys.exit(1)
print(f'=== check-asyncapi-codemap OK — {label}: {checked} message name(s) are v2 types; {len(exempt_keys)} host-event message(s) exempt; no /v1/ path; ApiKeyAuth agrees with OpenAPI ===')
