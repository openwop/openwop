#!/usr/bin/env python3
"""v2 charter Phase 3, P3-C — derive api/v2/openapi.yaml, api/v2/asyncapi.yaml,
api/seams-v2.yaml and spec/v2/path-manifest.json from the v1 API documents and
the children's decisions (RFC 0171 §C/§E, RFC 0172 §A/§C, RFC 0168 §C, RFC 0173 §C).

Python + PyYAML because the corpus has no Node YAML parser and the v1 documents
are YAML; the outputs are committed and `--check` compares a regeneration to
the committed bytes, so a CI without PyYAML fails loudly, never silently.

What the derivation does (every rule cites its RFC):
  - path keys lose their /v1 prefix (RFC 0172 §A.2: bare origin, unversioned
    v2 keys); /v1/openapi.json → /openapi.json;
  - the nine seam/test-mode operations (/v1/host/sample/*,
    /v1/host/workspace/files*, /v1/packs-test/*) leave the canonical document
    for api/seams-v2.yaml under /conformance/seams/… (RFC 0168 §C.1–§C.2);
  - every operation takes the OpenWOP-Version request header and every
    response declares it (RFC 0172 §A.3–§A.4);
  - X-Dedup → OpenWOP-Dedup, X-Force-Engine-Version → OpenWOP-Force-Engine-Version,
    X-Pack-Sha256 → OpenWOP-Pack-Sha256, X-Pack-Signing-Method →
    OpenWOP-Pack-Signing-Method; Capabilities-Etag → ETag (RFC 0171 §C.1);
  - the poll cursor is afterSequence, omission = from the first event; the
    response is {runId, events, lastSequence, status, isTerminal} (RFC 0171 §E.2);
  - $refs point into schemas/v2/ (../../schemas/v2/…); the two one-member enum
    components become $refs to the generated error envelope (RFC 0171 §B.1);
  - the interrupt token path parameter gains the ow2.<alg>.<kid>.<payload>.<mac>
    grammar, accepting the v1 two-segment form through the overlap (RFC 0170 §E.1);
  - three RFC 0173 read surfaces are added on unversioned keys:
    GET /host/effect-seams, GET /runs/{runId}/compensation, GET /runs/{runId}/effects;
    GET /host/events is the documented default hostEvents address (RFC 0171 §E.1);
  - AsyncAPI: server pathname '' and one runEvents channel whose address IS the
    OpenAPI key, with streamMode as a pattern over the closed set and its
    comma-separated combinations; hostEvents at /host/events (RFC 0171 §E.1);
  - info.version reads spec/v2/release.json (RFC 0172 §B axis 14).
  - reader-facing prose: description/summary/title strings inherited from the v1
    documents are replaced from scripts/derive-v2-api-prose.yaml (was -> now); the
    strings this file writes carry no RFC citations, tracker tags or v1 history.

  --write   regenerate the four outputs        --check  compare to the committed files
"""
import json, re, sys, copy, io
from pathlib import Path
try:
    import yaml
except ModuleNotFoundError:
    sys.exit('derive-v2-api: PyYAML is required (python3 -m pip install pyyaml) — the check refuses to pass without it')

ROOT = Path(__file__).resolve().parent.parent
V1 = yaml.safe_load((ROOT / 'api' / 'openapi.yaml').read_text())
A1 = yaml.safe_load((ROOT / 'api' / 'asyncapi.yaml').read_text())
REL = json.loads((ROOT / 'spec' / 'v2' / 'release.json').read_text())
SEAM = re.compile(r'^/v1/(host/sample/|host/workspace/files|packs-test/)')
HEADER_RENAME = {'openwop-Idempotent-Replay': 'OpenWOP-Idempotent-Replay', 'X-Idempotent-Replay': 'OpenWOP-Idempotent-Replay', 'X-Dedup': 'OpenWOP-Dedup', 'X-Force-Engine-Version': 'OpenWOP-Force-Engine-Version', 'X-Pack-Sha256': 'OpenWOP-Pack-Sha256', 'X-Pack-Signing-Method': 'OpenWOP-Pack-Signing-Method', 'Capabilities-Etag': 'ETag'}
V2_SCHEMAS = {p.relative_to(ROOT / 'schemas' / 'v2').as_posix() for p in (ROOT / 'schemas' / 'v2').rglob('*.schema.json')}

def rewrite(node, depth_prefix='../../schemas/v2/'):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == '$ref' and isinstance(v, str) and '../schemas/' in v and 'schemas/v2/' not in v:
                rel = v.split('../schemas/')[1]
                file = rel.split('#')[0]
                if file not in V2_SCHEMAS:
                    raise SystemExit(f'derive-v2-api: {v} names a schema the v2 tree does not carry ({file})')
                out[k] = depth_prefix + rel
            elif k in HEADER_RENAME and isinstance(v, dict):
                # A rename onto a header the same map already declares (v1 `Capabilities-Etag`
                # beside the standard `ETag`) is a removal, never an overwrite: the retired
                # header's description must not replace the surviving one (D2, 2.36.2).
                if HEADER_RENAME[k] in node:
                    continue
                out[HEADER_RENAME[k]] = rewrite(v, depth_prefix)
            else:
                out[k] = rewrite(v, depth_prefix)
        if isinstance(out.get('name'), str) and out.get('name') in HEADER_RENAME and out.get('in') == 'header':
            out['name'] = HEADER_RENAME[out['name']]
        return out
    if isinstance(node, list):
        return [rewrite(x, depth_prefix) for x in node]
    return node

def v2_openapi_and_seams():
    doc = copy.deepcopy(V1)
    doc['info']['version'] = REL['version']
    doc['info']['title'] = 'OpenWOP v2 API'
    # Reader-facing prose carries no RFC citations; the sources are RFC 0172 §A, RFC 0168 §C.2, RFC 0171 §B.2/§C.1.
    doc['info']['description'] = ('The OpenWOP v2 REST API. Paths are unversioned and served at the bare origin; a client selects a version with the '
        '`OpenWOP-Version` header from the host\'s `protocolVersions[]`. Conformance seams and test-mode operations are not in this '
        'document: they are in `api/seams-v2.yaml`. Every non-standard header is named `OpenWOP-<Name>`. Retry timing is carried '
        'only in `Retry-After`.\n\nGenerated from `api/openapi.yaml` by `scripts/derive-v2-api.py`; do not edit.')
    seams = {'openapi': doc['openapi'], 'info': {'title': 'OpenWOP conformance seams profile (openwop-conformance-seams-v2)', 'version': REL['version'],
             'description': ('The OpenWOP conformance seams profile (`openwop-conformance-seams-v2`): test-only operations in their own '
                             'path space, `/conformance/seams/…`. The profile is versioned and validated against the canonical v2 '
                             'schemas with no tolerance path. It is not a capability: a host advertises the profile, never a '
                             '`testSeams` flag.\n\nGenerated from `api/openapi.yaml` by `scripts/derive-v2-api.py`; do not edit.')},
             'servers': copy.deepcopy(doc.get('servers', [])), 'paths': {}, 'components': copy.deepcopy(doc.get('components', {}))}
    paths = {}
    for key, item in doc['paths'].items():
        if SEAM.match(key):
            nk = re.sub(r'^/v1/host/sample/', '/conformance/seams/sample/', key)
            nk = re.sub(r'^/v1/host/workspace/files', '/conformance/seams/workspace/files', nk)
            nk = re.sub(r'^/v1/packs-test/', '/conformance/seams/packs-test/', nk)
            seams['paths'][nk] = item
            continue
        nk = key
        if key.startswith('/v1/'):
            nk = key[3:]
        paths[nk] = item
    # P3-E3 seams (RFC 0176 §A–§D witnesses): the era-2 event-log seed and the inbound webhook receiver.
    # Seam-only shapes, so they are inline (the canonical v2 schemas describe wire objects, not test fixtures).
    seams['paths']['/conformance/seams/sample/event-log/seed'] = {'post': {'tags': ['Seams'], 'operationId': 'seedEra2EventLog',
        'summary': 'Persist a run whose event log uses v1 vocabulary (era 2)',
        'description': ('Seeds a run whose stored event log is in v1 vocabulary. The host MUST persist the rows verbatim: v1 '
                        '`type` strings, the given `sequence` space, and no era stamp, so the run reads as era `2` by the '
                        'absent-⇒-`2` rule of persistence.md. The host MUST NOT translate at write time. The scenarios '
                        '`v2-v1-events-translated`, `v2-unmapped-type-refused`, `v2-fork-a-v1-run` and `v2-pinned-run-disposition` '
                        'witness the read projection. `status` is the snapshot status the seeded run holds.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['eventLogSchemaVersion', 'status', 'events'],
            'properties': {'eventLogSchemaVersion': {'const': 2}, 'status': {'type': 'string', 'enum': ['running', 'completed', 'failed', 'cancelled']},
                'events': {'type': 'array', 'minItems': 1, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['type', 'sequence', 'payload'],
                    'properties': {'type': {'type': 'string'}, 'sequence': {'type': 'integer', 'minimum': 0}, 'payload': {'type': 'object'}, 'timestamp': {'type': 'string', 'format': 'date-time'}, 'causationId': {'type': 'string'}}}}}}}}},
        'responses': {'201': {'description': 'The seeded run.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId'], 'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    # RFC 0176 §A writer-rule witness (host-sample-test-seams.md §27): appends ONE v2-named event to a seeded era-2 run through the host's production writer.
    seams['paths']['/conformance/seams/sample/event-log/append'] = {'post': {'tags': ['Seams'], 'operationId': 'appendEra2Event',
        'summary': "Append a v2-named event to a seeded era-2 run through the host's production writer",
        'description': ('The host MUST append the event through the same writer its own code uses for that run (the storage '
                        'boundary that applies the writer rule, persistence.md §The writer rule) and MUST NOT branch on the seam. '
                        "An era-2 run stores the event under its v1 spelling (the codemap's v1 side), so the production read "
                        'returns the v2 `type` given here.\n\nThe seam MUST refuse a `runId` that `seedEra2EventLog` did not create '
                        'with `404`, exactly as for an unknown run, so it cannot inject into a real run. A terminal run answers '
                        '`409 run_terminal`; a `type` that is not a v2 registry name answers `400`. Used by '
                        '`v2-era-2-append-vocabulary`.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId', 'type', 'payload'],
            'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}, 'type': {'type': 'string', 'description': 'A v2 event type name (schemas/v2/run-event.schema.json `type` enum).'}, 'payload': {'type': 'object'}}}}}},
        'responses': {'202': {'description': 'The event was appended.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId', 'sequence'],
            'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}, 'sequence': {'type': 'integer', 'minimum': 0}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'},
            '409': {'description': 'The run is terminal (`run_terminal`).'}}}}
    # RFC 0033 §C per-attempt budget witness (host-sample-test-seams.md §28): every mock-provider call's output budget for one node, in call order.
    seams['paths']['/conformance/seams/sample/test/mock-ai/dispatch-budgets'] = {'get': {'tags': ['Seams'], 'operationId': 'getMockDispatchBudgets',
        'summary': "Per-attempt output budgets the conformance mock provider received for one node — RFC 0033 §C witness",
        'description': "One entry per call the host's conformance mock provider received for `nodeId` since its program was last seeded (seeding clears the history), in call order; `maxTokens` is the output budget THAT call carried to the provider, or `null` when it carried none. Each entry is per attempt: it MUST NOT be accumulated across attempts, the node or the run, and MUST record what reached the provider, not what the retry router intended. An unseeded `nodeId` answers an empty `attempts`. OPTIONAL; consumed by `envelope-completion-distinguishes-truncation` (RFC 0033 §C: a schema-violation retry SHALL NOT carry an increased budget). An unserved seam leaves that leg a partial witness, never `blocked`.",
        'parameters': [{'name': 'nodeId', 'in': 'query', 'required': True, 'schema': {'type': 'string', 'minLength': 1}}],
        'responses': {'200': {'description': 'The per-attempt budgets.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['nodeId', 'attempts'],
            'properties': {'nodeId': {'type': 'string'}, 'attempts': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['maxTokens'],
                'properties': {'maxTokens': {'type': ['integer', 'null'], 'minimum': 0}}}}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    seams['paths']['/conformance/seams/sample/effect-seams/fire'] = {'post': {'tags': ['Seams'], 'operationId': 'fireEffectSeam',
        'summary': 'Fire one named effect seam inside a run',
        'description': ('The host runs a workflow that drives the named seam once. The scenario then forks the run in `replay` '
                        'mode and reads `GET /runs/{runId}/effects` on the fork. A guarded seam MUST NOT produce a new effect '
                        'attempt there: replay suppression is unconditional (`replay.md` §Suppression rule 1) and does not depend '
                        'on `branchReFires`, which states only what a `branch` re-fires by design (§Branch: a host "MUST NOT '
                        'report that as replay suppression"). The witness is the host\'s own Layer-2 ledger, so the leg needs no '
                        'externally reachable receiver.\n\nThe scenario fires the first `GET /host/effect-seams` row with `guarded: '
                        'true`, not every row. When no row is guarded it records `inapplicable` without calling this operation.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['seam'],
            'properties': {'seam': {'type': 'string', 'minLength': 1, 'description': 'The `seam` value of a row in `GET /host/effect-seams`.'}, 'receiverUrl': {'type': 'string', 'format': 'uri', 'description': ('Optional destination, for seams whose kind needs one. Omitted, the host uses its own unreachable fixture '
                                                                                                                                                                                                                 'destination; the witness is the effect ledger, not delivery.')}}}}}},
        'responses': {'201': {'description': 'The run that fired the seam.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId'], 'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    seams['paths']['/conformance/seams/sample/test/idempotency/effect-retry'] = {'post': {'tags': ['Seams'], 'operationId': 'forceEffectTransportRetry',
        'summary': "Drive one effect through the suite's fixture provider with a forced transport retry",
        'description': ('The host issues one outbound effect to `providerUrl` and retries it at the transport layer. The fixture '
                        'provider records the idempotency key of each attempt. A Layer-2 host MUST present the same '
                        'business-identity key on both attempts; a provider that sees a changed key fails the leg.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['providerUrl'],
            'properties': {'providerUrl': {'type': 'string', 'format': 'uri', 'description': "The suite's fixture provider; it records each attempt's idempotency key."}}}}}},
        'responses': {'201': {'description': 'The run and effect that were retried.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId', 'effectId'], 'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}, 'effectId': {'type': 'string', 'minLength': 1}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    # RFC 0213 §B witness (host-sample-test-seams.md §26): arms a single-use hold on the caller's next real create.
    seams['paths']['/conformance/seams/sample/test/idempotency/hold'] = {'post': {'tags': ['Seams'], 'operationId': 'armIdempotencyHold',
        'summary': "Hold the caller's next same-key create in flight",
        'description': ("Arms a single-use hold: the caller tenant's next real `POST /runs` carrying `key` as its Idempotency-Key "
                        'keeps its Layer-1 claim in flight for `holdMs` after claiming, then completes normally. The seam MUST NOT '
                        'answer a create or emit a 409: the refusal a concurrent same-key create receives while the claim is held '
                        "comes from the host's production in-flight branch (idempotency.md §Concurrency). Keyed by (tenant, key); "
                        'an unarmed key is never delayed.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['key', 'holdMs'],
            'properties': {'key': {'type': 'string', 'pattern': '^[A-Za-z0-9._~-]{22,128}$'}, 'holdMs': {'type': 'integer', 'minimum': 1, 'maximum': 10000}}}}}},
        'responses': {'201': {'description': 'The hold is armed.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['key', 'holdMs'],
            'properties': {'key': {'type': 'string'}, 'holdMs': {'type': 'integer'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    # RFC 0201 §E.20 post-overlap witness (host-sample-test-seams.md §29): shortens the rotation overlap in progress on ONE subscription.
    seams['paths']['/conformance/seams/sample/webhooks/rotation-overlap'] = {'post': {'tags': ['Seams'], 'operationId': 'shortenRotationOverlap',
        'summary': "Shorten the rotation overlap in progress on one subscription — RFC 0201 §E.20 witness",
        'description': ("Sets the subscription's `previousSecretExpiresAt` to the time the request was received plus `overlapSeconds`, "
                        'and reports the stored value. The seam MUST write the same stored expiry `rotateWebhookSecret` wrote and the '
                        "production signer reads; the signer MUST NOT branch on the seam, so which secret signs after the new expiry is "
                        "production's decision. It changes only the overlap in progress and MUST NOT lengthen it: an expiry at or after "
                        'the current one, no overlap in progress, or a subscription that did not opt into `standard-webhooks-1` answers '
                        '`400 validation_error`. Tenant checks are those of `rotateWebhookSecret` (`403 id_tenant_mismatch` before the '
                        'lookup; `404` when unknown). OPTIONAL, and never served outside the seams profile; consumed by '
                        '`v2-webhook-secret-rotation` when the advertised overlap outlasts the wait cap. An unserved seam leaves that leg '
                        'a partial witness, never `blocked`.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['webhookId', 'overlapSeconds'],
            'properties': {'webhookId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/subscriptionId'}, 'overlapSeconds': {'type': 'integer', 'minimum': 1, 'maximum': 60}}}}}},
        'responses': {'200': {'description': 'The overlap is shortened.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['webhookId', 'previousSecretExpiresAt'],
            'properties': {'webhookId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/subscriptionId'}, 'previousSecretExpiresAt': {'type': 'string', 'format': 'date-time'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '403': {'$ref': '#/components/responses/Forbidden'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    seams['paths']['/conformance/seams/sample/webhooks/receive'] = {'post': {'tags': ['Seams'], 'operationId': 'receiveWebhookDelivery',
        'summary': "Run a webhook delivery through the host's inbound receiver",
        'description': ('Exercises the host as a webhook subscriber. The host verifies `headers` and `body` with its production '
                        'verifier, using `secret` as the subscription secret, and reports the verdict. A scheme-`v1` delivery '
                        'carrying only `X-openwop-*` headers, signed over `{timestamp}.{rawBody}`, MUST be accepted '
                        '(`v2-v1-signed-webhook-accepted`); a tampered signature MUST be refused.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['secret', 'headers', 'body'],
            'properties': {'secret': {'type': 'string', 'minLength': 1}, 'headers': {'type': 'object', 'additionalProperties': {'type': 'string'}}, 'body': {'type': 'string'}}}}}},
        'responses': {'200': {'description': 'The verifier verdict.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['accepted'], 'properties': {'accepted': {'type': 'boolean'}, 'reason': {'type': 'string'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    # RFC 0209 §A–§C witness: the v2 emit-surface seam (v1 host-sample-test-seams.md §15, re-cut for schema version 2).
    seams['paths']['/conformance/seams/sample/a2ui/emit-surface'] = {'post': {'tags': ['Seams'], 'operationId': 'emitA2uiSurface',
        'summary': 'Admit one `ui.a2ui-surface` envelope into a run through the production admission path',
        'description': ('Supplies one `ui.a2ui-surface` envelope for the host to admit. A real one is emitted by a model inside a '
                        'node turn, so the suite cannot choose one from the canonical wire; this seam supplies the envelope '
                        'only.\n\nThe host MUST admit it through its production envelope-admission path and MUST record it exactly '
                        'as production would. That path covers the envelope-kind catalog (`supportedEnvelopes`, `schemaVersions`, '
                        '`envelopeStrictness`; events.md §"The envelope-kind catalog"), validation against the one per-kind branch '
                        'the schema version selects (never the `anyOf` union), the cross-field rules (every message `surfaceId` '
                        'equals the payload `surfaceId`; a `createSurface.catalogId` equals the payload `catalogId`), the '
                        'surface-fold guard (spec/v2/ext/a2uiSurface/README.md §"The fold"), trust propagation, and SR-1 '
                        'redaction. It MUST NOT be a mock that records without those rules. `envelope.nodeId`, when present, binds '
                        'the surface to that node, so a surface emitted at a node suspended on an `approval` interrupt is the '
                        'surface whose `resume` action would resolve it (§"Trust": a tainted fold blocks that '
                        'interrupt).\n\nRefusals use the canonical error envelope: `422 unknown_schema_version` above the floor, or '
                        'below it under `strict`; `422 envelope_invalid` for a payload that fails its branch, a cross-field rule, '
                        'or the fold guard; `422 unknown_envelope_kind` when the host does not list the kind. `details` SHOULD '
                        'name the rule. A host that has not wired the seam answers `404`/`405`, and the scenario records '
                        '`inapplicable`.'),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId', 'envelope'],
            'properties': {'runId': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}, 'envelope': {'$ref': '../schemas/v2/ai-envelope.schema.json', 'description': 'A complete AI envelope whose `type` is `ui.a2ui-surface`; `schemaVersion` selects the payload branch.'}}}}}},
        'responses': {'201': {'description': 'Admitted and recorded; `sequence` is the run event that records the envelope.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['sequence'], 'properties': {'sequence': {'type': 'integer', 'minimum': 0}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'},
            '422': {'description': 'Refused by envelope admission (`unknown_schema_version`, `envelope_invalid`, `unknown_envelope_kind`).', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/Error'}}}}}}}
    # RFC 0199 §A–§C witnesses: the OAuth-client seams. The seam supplies the provider's endpoints (the suite's
    # authorization-server double) and nothing else; the URL, the callback and the refresh are production paths.
    seams['paths']['/conformance/seams/sample/oauth/authorize-start'] = {'post': {'tags': ['Seams'], 'operationId': 'startOAuthAuthorization',
        'summary': 'Begin an authorization-code grant through the production authorization-URL builder',
        'description': (("Points `provider` at the given endpoints (the suite's authorization-server double), then begins an "
                         "authorization-code grant for the authenticated caller by calling the host's production authorization-URL "
                         'builder, and returns the URL a user agent would be redirected to. The provider is a test-only provider '
                         "definition or, with `connection`, the connection pack's provider registered through the host's production "
                         'registration path, which runs discovery and pins its tuple.\n\nThe builder MUST be the one production uses: '
                         "PKCE S256, a fresh `state` bound to the caller's Subject and the provider, the provider's fixed redirect "
                         'URI, `iss` expectations, and `resource` for an MCP reach. A seam that assembles its own URL measures a '
                         "stub, and a bundle citing it MUST say which. The grant completes on the host's production callback route, "
                         'which the suite calls as the user agent. `redirectUri` is a probe: the host MUST ignore it (the redirect '
                         'URI is fixed per provider, oauth.md rule 5).\n\nA refused grant (an MCP-reach provider with no `issuer`, '
                         '`pkce: "unsupported"`, or discovered metadata that disagrees with the manifest or the pinned tuple) is '
                         '`422 connection_auth_metadata_mismatch`, and no authorization URL is issued. A host that has not wired '
                         'the seam answers `404`, and the scenarios record `blocked`.')),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['provider'],
            'properties': {'provider': {'type': 'string', 'minLength': 1, 'description': 'An advertised `oauth.providers[].id`, or the `provider.id` of `connection`.'},
                'authUrl': {'type': 'string', 'format': 'uri'}, 'tokenUrl': {'type': 'string', 'format': 'uri'},
                'issuer': {'type': 'string', 'format': 'uri', 'description': 'The provider\'s issuer identifier; absent ⇒ an issuer-less provider (provider-unique redirect URI).'},
                'pkce': {'type': 'string', 'enum': ['S256', 'unsupported']},
                'scopes': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}},
                'connection': {'$ref': '../schemas/v2/connection-pack-manifest.schema.json', 'description': 'A connection pack whose provider is reached as an MCP server; registered through the production path.'},
                'redirectUri': {'type': 'string', 'description': 'A probe the host MUST ignore.'}}}}}},
        'responses': {'201': {'description': 'The authorization URL the user agent would be sent to.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['authorizationUrl'], 'properties': {'authorizationUrl': {'type': 'string', 'format': 'uri'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'},
            '422': {'description': 'The grant is refused (`connection_auth_metadata_mismatch`, `oauth_provider_unsupported`); no authorization URL is issued.', 'content': {'application/json': {'schema': {'$ref': '#/components/schemas/Error'}}}}}}}
    seams['paths']['/conformance/seams/sample/oauth/expire-refresh'] = {'post': {'tags': ['Seams'], 'operationId': 'expireOAuthAccessToken',
        'summary': "Expire the caller's stored access token for a provider so its next use refreshes",
        'description': (("Marks the access token of the caller's stored credential for `provider` expired, and nothing else. The "
                         "next node that uses it refreshes through the host's production refresh path against the provider's token "
                         "endpoint (the suite's double, which decides whether the refresh token is still good). A terminal refresh "
                         'failure then follows oauth.md §Token lifecycle: `connector.auth-expired`, and either the node fails '
                         '`connector_auth_expired` or, under `oauth.credentialInterrupt`, it suspends on a `credential` interrupt '
                         'with `reason: "expired"`. `404` when the caller holds no credential for the provider.')),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['provider'],
            'properties': {'provider': {'type': 'string', 'minLength': 1}}}}}},
        'responses': {'204': {'description': 'The access token is expired.'}, '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    # RFC 0170 §B.3 witness: the per-lane credential mint/revoke pair `v2-revocation-honored` drives. Named by the RFC and
    # served by the v2 reference host since 2.x, but absent from this contract until 2.39.5 — so a host advertising the
    # seams profile could not know it owed them, and under --require-behavior their absence was a hard fail. The shape is
    # the one the reference host already serves (examples v2-reference src/seams.ts), not a new one.
    seams['paths']['/conformance/seams/sample/auth/credential/mint'] = {'post': {'tags': ['Seams'], 'operationId': 'mintLaneCredential',
        'summary': "Mint a fresh credential on an advertised lane for the caller's tenant",
        'description': (('Issues a new credential on `lane` (an advertised `auth.lanes[].lane` whose `revocation` is '
                         "`next-request`; absent ⇒ `api-key`) for the authenticated caller's tenant, through the host's production "
                         'issuance path, so the credential it returns authenticates on the canonical API exactly as an ordinary one '
                         'does. The suite uses it only to hold a credential it can then revoke: the revocation, and the refusal on '
                         'the next request (`401 credential_revoked`), are production behaviour the seam does not simulate. A host '
                         'that has not wired the seam answers `404`, and the scenario records the requirement unobserved.')),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False,
            'properties': {'lane': {'type': 'string', 'minLength': 1, 'description': 'An advertised `auth.lanes[].lane`; absent ⇒ `api-key`.'}}}}}},
        'responses': {'201': {'description': 'The minted credential.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['lane', 'credential'],
                'properties': {'lane': {'type': 'string'}, 'credential': {'type': 'string', 'minLength': 1, 'description': 'The credential. Presented as `Authorization: Bearer <credential>` unless `presentation` says otherwise.'},
                    'presentation': {'type': 'object', 'additionalProperties': False, 'required': ['kind'],
                        'description': ('How the suite presents `credential` on the canonical API. Absent ⇒ bearer. A lane whose production '
                                        'credential is cookie-borne (a `session` lane) answers `{ kind: "cookie", name }`, and the suite sends '
                                        '`Cookie: <name>=<credential>`.'),
                        'properties': {'kind': {'type': 'string', 'enum': ['bearer', 'cookie']}, 'name': {'type': 'string', 'pattern': '^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$', 'description': 'The cookie name (an RFC 6265 token). Required when `kind` is `cookie`.'}},
                        'if': {'properties': {'kind': {'const': 'cookie'}}}, 'then': {'required': ['kind', 'name']}},
                    'subjectId': {'type': 'string', 'description': 'The Subject the credential authenticates as, when the host names one.'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    seams['paths']['/conformance/seams/sample/auth/credential/revoke'] = {'post': {'tags': ['Seams'], 'operationId': 'revokeLaneCredential',
        'summary': 'Revoke a credential the mint seam issued',
        'description': (("Revokes `credential` through the host's production revocation path. On a `next-request` lane the very "
                         'next request presenting it MUST be refused `401 credential_revoked` (identity.md §2.2); the suite '
                         'observes that on the canonical API, not through this seam. `404` when no active credential matches.')),
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['credential'],
            'properties': {'lane': {'type': 'string', 'minLength': 1}, 'credential': {'type': 'string', 'minLength': 1}}}}}},
        'responses': {'200': {'description': 'The credential is revoked.', 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['revoked'],
                'properties': {'revoked': {'type': 'boolean', 'const': True}, 'lane': {'type': 'string'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    # RFC 0111 (host-sample-test-seams.md §14; corrected 2026-09-26, suite 2.41.0): the transcript-window accounting seam,
    # additive at major 2. `entries[]` is the text the host fed; REQUIRED for tokenCounter `chars`, the only recountable unit.
    seams['paths']['/conformance/seams/sample/agent/transcript-window'] = {'get': {'tags': ['Seams'], 'operationId': 'getTranscriptWindow',
        'summary': "Read the host's accounting of what it fed the model on one orchestrator turn",
        'description': ('Returns what the host fed the model on turn `iteration` of `runId`. The orchestrator transcript a host '
                        "assembles each iteration is host-internal and never crosses the wire, so this seam reports the host's own "
                        'accounting:\n\n- `tokenCount`, in the advertised `contextBudget.tokenCounter` unit. MUST be ≤ '
                        '`transcriptTokenBudget`.\n- `eventIds`: the verbatim recent tail, in event-log order.\n- '
                        '`summarizedRanges`.\n- `entries[] { eventId, rendered }`: the exact text fed per item. REQUIRED when '
                        '`tokenCounter` is `chars`, so the suite can sum the rendered Unicode code points and require the sum to '
                        "equal `tokenCount`. A summary substitution's entry names its `context.summarized` event and renders the "
                        'summary text.\n\nServed in test mode only; `rendered` MUST NOT carry secret material (SR-1). The ceiling is '
                        'advertise-and-attest: the seam proves the declared accounting is consistent and bounded, not that nothing '
                        "else reached the model. A turn past the run's last answers `400`/`422`; an unwired seam answers "
                        '`404`/`405`.'),
        'parameters': [
            {'name': 'runId', 'in': 'query', 'required': True, 'schema': {'$ref': '../schemas/v2/ids.schema.json#/$defs/runId'}},
            {'name': 'iteration', 'in': 'query', 'required': True, 'description': 'The 1-based `runOrchestrator.decided.iteration` of the turn.', 'schema': {'type': 'integer', 'minimum': 1}}],
        'responses': {'200': {'description': "The host's accounting for that turn.", 'content': {'application/json': {'schema': {'type': 'object', 'additionalProperties': False,
            'required': ['tokenCounter', 'tokenCount', 'eventIds', 'summarizedRanges'],
            'properties': {
                'tokenCounter': {'type': 'string', 'enum': ['o200k_base', 'cl100k_base', 'chars', 'host-defined']},
                'tokenCount': {'type': 'integer', 'minimum': 0},
                'eventIds': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}},
                'summarizedRanges': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['summaryRef', 'replacedTurns'],
                    'properties': {'summaryRef': {'type': 'string', 'minLength': 1}, 'replacedTurns': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}}}}},
                'entries': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['eventId', 'rendered'],
                    'properties': {'eventId': {'type': 'string', 'minLength': 1}, 'rendered': {'type': 'string'}}}}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    # RFC 0173 read surfaces + hostEvents default address
    paths['/host/effect-seams'] = {'get': {'tags': ['host'], 'operationId': 'getEffectSeamManifest', 'summary': "Read the host's effect-seam manifest", 'description': ('Lists every outbound effect seam that replay suppression covers. A seam omitted here is invisible to the '
                                                                                                                                                                                        "conformance suite; an audit of the host's seams is the control."), 'responses': {'200': {'description': 'The manifest.', 'content': {'application/json': {'schema': {'$ref': '../../schemas/v2/effect-seam-manifest.schema.json'}}}}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    paths['/runs/{runId}/compensation'] = {'parameters': [{'$ref': '#/components/parameters/RunId'}], 'get': {'tags': ['runs'], 'operationId': 'getRunCompensation', 'summary': "Read a run's compensation plan and attempts", 'description': "The run's compensation plan and every attempt, as a read projection.", 'responses': {'200': {'description': 'The projection.', 'content': {'application/json': {'schema': {'$ref': '../../schemas/v2/compensation-projection.schema.json'}}}}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    paths['/runs/{runId}/effects'] = {'parameters': [{'$ref': '#/components/parameters/RunId'}], 'get': {'tags': ['runs'], 'operationId': 'getRunEffects', 'summary': "Read a run's Layer-2 effect ledger", 'description': 'Effect records keyed by business identity; the witness for the Layer-2 effect-identity obligation.', 'responses': {'200': {'description': 'The ledger projection.', 'content': {'application/json': {'schema': {'$ref': '../../schemas/v2/effect-ledger-projection.schema.json'}}}}, '404': {'$ref': '#/components/responses/NotFound'}}}}
    # RFC 0182 — the portable run list (gated on the runList family); shares the /runs path item with createRun
    paths.setdefault('/runs', {})['get'] = {'tags': ['runs'], 'operationId': 'listRuns', 'summary': "List the caller's runs, newest first", 'description': ("Lists only runs whose tenant segment is the caller's; every `runId` is tenant-bound (identity.md §5). The "
                                                                                                                                                                                     'list is cursor-paginated. Gated on the `runList` family: a host that does not advertise it answers `404 '
                                                                                                                                                                                     'not_found`.\n\n`limit` is honoured up to `runList.maxPageSize`. `cursor` is opaque; a cursor the host did '
                                                                                                                                                                                     'not mint is `400 validation_error`. `workflowId` and `status` are exact-match filters when '
                                                                                                                                                                                     '`runList.filters` names them; an unadvertised filter is ignored.'),
        'parameters': [
            {'name': 'limit', 'in': 'query', 'required': False, 'schema': {'type': 'integer', 'minimum': 1}, 'description': 'Page size; clamped to `runList.maxPageSize`.'},
            {'name': 'cursor', 'in': 'query', 'required': False, 'schema': {'type': 'string', 'minLength': 1, 'maxLength': 2048}, 'description': "Opaque cursor from a previous page's `nextCursor`."},
            {'name': 'workflowId', 'in': 'query', 'required': False, 'schema': {'$ref': '../../schemas/v2/ids.schema.json#/$defs/workflowId'}, 'description': 'Exact-match filter, when advertised in `runList.filters`.'},
            {'name': 'status', 'in': 'query', 'required': False, 'schema': {'type': 'string', 'enum': ['pending', 'running', 'paused', 'waiting-approval', 'waiting-input', 'waiting-external', 'completed', 'failed', 'cancelling', 'cancelled']}, 'description': 'Exact-match filter, when advertised in `runList.filters`.'}],
        'responses': {'200': {'description': 'One page of the caller\'s runs.', 'content': {'application/json': {'schema': {'$ref': '../../schemas/v2/run-list-response.schema.json'}}}}, '400': {'$ref': '#/components/responses/ValidationError'}, '401': {'$ref': '#/components/responses/Unauthenticated'}, '404': {'$ref': '#/components/responses/NotFound'}}}
    # RFC 0188 — the webhook DELIVERY dead-letter read (gated on the webhooks.deadLetter facet).
    # `webhooks.md` §Durability has always said an exhausted delivery is routed to a sink
    # "inspectable for retentionDays", and the corpus served no endpoint that could see it — so
    # every host bundle recorded "exhaustion was observed, routing to the sink was not", and the
    # `deliveryId` KIND had no v2 surface to appear on at all. This is that read.
    paths['/webhooks/{webhookId}/dead-letters'] = {'get': {
        'tags': ['webhooks'],
        'operationId': 'listWebhookDeadLetters',
        'summary': "List a subscription's dead-lettered deliveries",
        'description': (('Lists deliveries that were dead-lettered, making `webhooks.md` §Durability observable. A delivery whose '
                         'retries are exhausted, or a `payload_unprojectable` delivery dead-lettered on its first attempt, appears '
                         'here until `retentionDays` elapse. Gated on the `webhooks.deadLetter` facet: a host that does not '
                         'advertise it answers `404 not_found`.\n\nThe record is content-free: it names a delivery and never carries '
                         'the delivered bytes, the request headers, or the subscription secret.')),
        'parameters': [
            {'name': 'webhookId', 'in': 'path', 'required': True,
             'schema': {'$ref': '../../schemas/v2/ids.schema.json#/$defs/subscriptionId'},
             'description': ('The subscription, tenant-bound (`identity.md` §5) and carried as one path segment: `~`-projected or '
                             'percent-encoded.')},
            {'name': 'limit', 'in': 'query', 'required': False, 'schema': {'type': 'integer', 'minimum': 1},
             'description': 'Page size; clamped to `webhooks.deadLetter.maxPageSize`.'},
            {'name': 'cursor', 'in': 'query', 'required': False, 'schema': {'type': 'string', 'minLength': 1, 'maxLength': 2048},
             'description': "Opaque cursor from a previous page's `nextCursor`. A cursor minted for another subscription MUST be refused `400 validation_error`."}],
        'responses': {
            '200': {'description': 'One page of dead-lettered deliveries, newest first.',
                    'content': {'application/json': {'schema': {'$ref': '../../schemas/v2/webhook-dead-letter-page.schema.json'}}}},
            '400': {'$ref': '#/components/responses/ValidationError'},
            '401': {'$ref': '#/components/responses/Unauthenticated'},
            '403': {'$ref': '#/components/responses/Forbidden'},
            '404': {'$ref': '#/components/responses/NotFound'}}}}
    # RFC 0205 §A — getArtifact MAY answer the A2A Artifact shape, negotiated by Accept. The
    # v1 operation keeps its single application/json response (RFC 0205 §A.4); the second
    # media type is v2-only, so it is added here rather than in api/openapi.yaml.
    ga = paths['/runs/{runId}/artifacts/{artifactId}']['get']
    ga['responses']['200']['content']['application/a2a+json'] = {'schema': {'$ref': '../../schemas/v2/artifact.schema.json'}}
    ga['responses']['200']['description'] = ('Artifact payload. Under `application/json` the shape is implementation-defined. '
        'Under `application/a2a+json` (negotiated by `Accept`; a host SHOULD offer it) it is an A2A `Artifact` '
        'whose `artifactId` equals the path segment, and a `url` Part in it MUST NOT resolve beyond the caller\'s `artifacts:read` authorization.')
    # RFC 0202 — the v2 inventory entry carries the optional `a2aTenant` (v2-only; the v1
    # operations are unchanged, G2), so the sentence is added here rather than in api/openapi.yaml.
    for p, desc in (('/agents', 'Installed manifest agents, sorted by `agentId`.'), ('/agents/{agentId}', "The agent's inventory entry.")):
        paths[p]['get']['responses']['200']['description'] = (desc + ' When the host advertises `a2a.agentCards`, an entry '
            'the host routes a workflow to carries `a2aTenant`, the opaque A2A `tenant` value of that agent\'s card (interop.md §Per-agent cards).')
    paths['/host/events'] = {'get': {'tags': ['host'], 'operationId': 'streamHostEvents', 'summary': 'Stream host-scoped events (`heartbeat.*`) as SSE', 'description': ('The default `hostEvents` address; a host MAY declare another under `heartbeat.deliveryChannel`. Carries '
                                                                                                                                                                                'no run data.'), 'responses': {'200': {'description': '`text/event-stream` of `hostEvents` messages.', 'content': {'text/event-stream': {'schema': {'type': 'string'}}}}, '401': {'$ref': '#/components/responses/Unauthenticated'}}}}
    doc['paths'] = paths
    comps = doc.setdefault('components', {})
    comps.setdefault('parameters', {})['OpenWOPVersion'] = {'name': 'OpenWOP-Version', 'in': 'header', 'required': False, 'schema': {'type': 'string', 'pattern': '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'}, 'description': ("Selects one of the host's listed major.minor versions. Absent, `/.well-known/openwop` uses `preferredVersion` and every other unversioned path is v2; an "
                                                                                                                                                                                                                          'unlisted value is 406 protocol_version_unsupported.')}
    # RFC 0219: the client announces the protocol version it implements (versioning.md §1.5).
    comps['parameters']['OpenWOPClientVersion'] = {'name': 'OpenWOP-Client-Version', 'in': 'header', 'required': False, 'schema': {'type': 'string'},
                                                   'description': ('The protocol version the client implements (versioning.md §1.5). Compared with `minClientVersion` on major.minor. '
                                                                   'A malformed value is treated as absent and MUST NOT produce a 400. Never selects a contract.')}
    comps.setdefault('headers', {})['OpenWOPVersion'] = {'schema': {'type': 'string'}, 'description': 'The contract that produced this response. It MUST equal the one used.', 'required': True}
    # Re-bind every id path parameter to its v2 KIND.
    #
    # This document is derived from api/openapi.yaml, so it inherits v1's
    # parameter typing — including for identifiers whose GRAMMAR CHANGED at the
    # major boundary. v1's `RunId` is `{type: string, maxLength: 128}`, correct
    # for a bare v1 id and carried into v2 verbatim, where a runId is
    # tenant-bound `<tenantId>/<opaque>` and reaches 128 + 1 + 128 = 257
    # characters. The derived v2 parameter could not express a conforming v2
    # runId: a host with a long tenant segment was forbidden by the spec's own
    # path parameter from naming its own runs.
    #
    # identity.md §5 already required the binding — "every id field in every v2
    # schema and every api/v2/openapi.yaml parameter and response body MUST
    # `$ref` its kind" — and nothing checked it, which is how an inherited v1
    # constraint sat in the v2 contract unnoticed. Inheritance is the default
    # here, so anything the majors DISAGREE about has to be overridden by name.
    for pname, kind in (('RunId', 'runId'), ('WorkflowId', 'workflowId')):
        p = comps.setdefault('parameters', {}).get(pname)
        if p is not None:
            p['schema'] = {'$ref': f'../../schemas/v2/ids.schema.json#/$defs/{kind}'}
            if kind == 'runId':
                p['description'] = ('Tenant-bound `<tenantId>/<opaque>` (`identity.md` §5). The `/` is part of the '
                                    'identifier and MUST be percent-encoded as `%2F` in the path segment.')
    # The same inheritance, one surface over: `POST /runs:bulk-cancel` takes
    # `runIds[]` in the BODY, typed by v1 as `{type: string, minLength: 1}`. A
    # v2 client is handed tenant-bound ids by every create and read, sends them
    # to the one bulk surface it has, and — measured on a tier-1 host — every id
    # it owns answers `not_found`, per id, silently. The projection covered the
    # way out and not the way in. Bind the items to the kind so the inbound
    # contract states what the outbound one already does.
    # RFC 0187 §A.1 — the MINT surface carries the kind. `identity.md` §5 binds
    # `subscriptionId`, `id-field-bindings.json` binds the property, and the one
    # place the thing is created (`POST /webhooks -> { webhookId }`) inherited
    # v1's bare `type: string`: the kind had no HTTP surface and the HTTP
    # surface had no kind, so the §5 `403 id_tenant_mismatch` check had nothing
    # to read. Bind the path parameter and the response property.
    wh = paths.get('/webhooks/{webhookId}', {})
    for op in wh.values():
        if not isinstance(op, dict):
            continue
        # v1 names the tenant in a REQUIRED `tenantId` query parameter because
        # the route is not path-nested (webhooks.md §Unregister); v2 carries it
        # IN the tenant-bound id, so the v1 query parameter is dropped — as
        # rotateWebhookSecret's v2 twin below never had it.
        op['parameters'] = [p for p in op.get('parameters', []) or []
                            if not (isinstance(p, dict) and p.get('in') == 'query' and p.get('name') == 'tenantId')]
        for p in op.get('parameters', []) or []:
            if isinstance(p, dict) and p.get('name') == 'webhookId' and p.get('in') == 'path':
                p['schema'] = {'$ref': '../../schemas/v2/ids.schema.json#/$defs/subscriptionId'}
                p['description'] = ('Tenant-bound `<tenantId>/<opaque>` (`identity.md` §5), carried as one path segment: '
                                    '`~`-projected or percent-encoded.')
    # RFC 0201 — the Standard Webhooks opt-in. The v1 document is the source, so the v2 difference
    # is applied by name: the item vocabulary is the facet enum (v1 keeps free strings).
    try:
        reg_body = paths['/webhooks']['post']['requestBody']['content']['application/json']['schema']['properties']
        reg_body['signatureAlgorithms']['items'] = {'type': 'string', 'enum': ['v1', 'standard-webhooks-1']}
    except (KeyError, TypeError):
        pass
    # RFC 0201 §E — rotateWebhookSecret, a v2 operation (like RFC 0188's dead-letter read). Its v1
    # route (`POST /v1/webhooks/{webhookId}/rotate-secret?tenantId=`) is defined in v1 webhooks.md
    # prose and is NOT added to api/openapi.yaml: a new canonical v1 operation obliges the
    # openwop-sdks parity manifest, which vendors a published corpus tag.
    paths['/webhooks/{webhookId}/rotate-secret'] = {'post': {
        'tags': ['webhooks'],
        'operationId': 'rotateWebhookSecret',
        'summary': "Rotate a Standard Webhooks subscription's secret with an overlap",
        'description': (('Rotates the secret of a subscription that opted into `standard-webhooks-1`. Gated on '
                         '`webhooks.secretRotation`: a host that does not advertise it MUST answer `404 not_found`. Any other '
                         'subscription gets `400 validation_error`, because its single `v1` signature cannot overlap. Tenant checks '
                         "are those of `unregisterWebhook`: `403 id_tenant_mismatch` when the id's tenant segment is not the "
                         "caller's, checked before the lookup (`identity.md` §5); `404` when unknown.\n\nFor `overlapSeconds` after "
                         '`rotatedAt`, `webhook-signature` carries one entry under the new secret and one under the previous one, '
                         'and `OpenWOP-Signature` stays on the previous secret. At `previousSecretExpiresAt` only the new secret '
                         'signs. A second rotation inside an overlap retires the oldest secret immediately. Rotation does not '
                         're-verify the endpoint. The response carries no secret.')),
        'parameters': [
            {'name': 'webhookId', 'in': 'path', 'required': True,
             'schema': {'$ref': '../../schemas/v2/ids.schema.json#/$defs/subscriptionId'},
             'description': ('Tenant-bound `<tenantId>/<opaque>` (`identity.md` §5), carried as one path segment: `~`-projected or '
                             'percent-encoded.')},
            {'$ref': '#/components/parameters/IdempotencyKey'}],
        'requestBody': {'required': True, 'content': {'application/json': {'schema': {
            'type': 'object', 'required': ['secret'], 'additionalProperties': False,
            'properties': {'secret': {'type': 'string', 'pattern': '^whsec_[A-Za-z0-9+/]+={0,2}$',
                'description': 'The new secret: `whsec_<base64>`, decoding to 24–64 bytes.'}}}}}},
        'responses': {
            '200': {'description': 'Rotated. No secret is returned.', 'content': {'application/json': {'schema': {
                'type': 'object', 'required': ['rotatedAt', 'previousSecretExpiresAt'], 'additionalProperties': False,
                'properties': {'rotatedAt': {'type': 'string', 'format': 'date-time'},
                    'previousSecretExpiresAt': {'type': 'string', 'format': 'date-time', 'description': '`rotatedAt + overlapSeconds`.'}}}}}},
            '400': {'$ref': '#/components/responses/ValidationError'},
            '401': {'$ref': '#/components/responses/Unauthenticated'},
            '403': {'$ref': '#/components/responses/Forbidden'},
            '404': {'$ref': '#/components/responses/NotFound'}}}}
    try:
        reg = paths['/webhooks']['post']['responses']['201']['content']['application/json']['schema']['properties']['webhookId']
        reg.clear()
        reg['$ref'] = '../../schemas/v2/ids.schema.json#/$defs/subscriptionId'
        # RFC 0221: a secret the host generated (the request omitted `secret`) is returned
        # here, once. A supplied secret is never echoed (RFC 0201 §B.6).
        paths['/webhooks']['post']['responses']['201']['content']['application/json']['schema']['properties']['secret'] = {
            'type': 'string', 'minLength': 1,
            'description': 'Present only when the request omitted `secret`: the secret the host generated, returned this once. '
                           'A supplied secret is never echoed.'}
    except (KeyError, TypeError):
        pass
    bc = paths.get('/runs:bulk-cancel', {}).get('post', {})
    try:
        items = bc['requestBody']['content']['application/json']['schema']['properties']['runIds']['items']
        items.clear()
        items['$ref'] = '../../schemas/v2/ids.schema.json#/$defs/runId'
    except (KeyError, TypeError):
        pass
    # poll cursor + interrupt token grammar + per-operation header + one-member enums
    for key, item in doc['paths'].items():
        for method, op in list(item.items()):
            if method not in ('get', 'post', 'put', 'delete', 'patch'):
                continue
            params = op.setdefault('parameters', [])
            if not any(isinstance(p, dict) and p.get('$ref') == '#/components/parameters/OpenWOPVersion' for p in params):
                params.append({'$ref': '#/components/parameters/OpenWOPVersion'})
            if not any(isinstance(p, dict) and p.get('$ref') == '#/components/parameters/OpenWOPClientVersion' for p in params):
                params.append({'$ref': '#/components/parameters/OpenWOPClientVersion'})
            for p in params:
                if isinstance(p, dict) and p.get('name') == 'lastSequence':
                    p.update({'name': 'afterSequence', 'schema': {'type': 'integer', 'minimum': 0}, 'description': 'Return events with `sequence > afterSequence`. Omitted, the poll starts from the first event (sequence 0).'})
                if isinstance(p, dict) and p.get('name') == 'If-None-Match' and p.get('in') == 'header':
                    # v1 scoped the note to the discovery document; runs.md §Snapshot applies the
                    # same conditional GET to the run snapshot (rc.49, finding 5). The 304 MUST binds only
                    # where the host sent an ETag, which is a SHOULD on the snapshot.
                    p['description'] = ('Conditional request on the discovery document (capabilities.md §1) and the run snapshot (runs.md §Snapshot). '
                                        'A value matching the `ETag` the host sent MUST yield `304 Not Modified` with no body. '
                                        'The 304 carries `OpenWOP-Version` like every response (versioning.md §1.4).')
                if isinstance(p, dict) and p.get('name') == 'token' and p.get('in') == 'path':
                    p['schema'] = {'type': 'string', 'pattern': '^(ow2\\.hs256\\.[A-Za-z0-9._~-]{1,128}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)$'}
                    p['description'] = '`ow2.<alg>.<kid>.<payload>.<mac>`. The v1 two-segment form is accepted under kid legacy until its expiresAt.'
            for p in params:
                if isinstance(p, dict) and p.get('name') == 'streamMode' and p.get('in') == 'query':
                    p['schema'] = {'type': 'string', 'pattern': '^(values|(updates|messages|debug)(,(updates|messages|debug))*)$', 'default': 'updates'}
                    p['description'] = 'A stream mode from the closed set, or a comma-separated combination of them. `values` never combines.'
            op['parameters'] = [p for p in params if not (isinstance(p, dict) and p.get('name') == 'since')]
            # RFC 0228 §H (errors.md §Unadvertised operations): an operation gated on a family or facet
            # the host does not advertise answers `404 not_found`, never v1's `501`, which carries no
            # registered code. Only the "Host does not advertise" 501s move; any other 501 stays.
            resps = op.get('responses', {})
            for code in [c for c in resps if str(c) == '501']:
                r501 = resps[code]
                if isinstance(r501, dict) and 'does not advertise' in str(r501.get('description', '')):
                    del resps[code]
                    resps.setdefault('404', {'$ref': '#/components/responses/NotFound'})
            # RFC 0228 §C/§G: `eval_gate_unmet` is registered at 422 (it is missing evidence, not a missing
            # role), so the deployment transition documents it there instead of under its 403.
            if op.get('operationId') == 'transitionAgentDeployment' and '422' not in resps:
                resps['422'] = {'description': '`eval_gate_unmet`: a `requiredEval` gate\'s referenced eval run is not terminal and passed.',
                                'content': {'application/json': {'schema': {'$ref': '#/components/schemas/Error'}}}}
            for code, resp in op.get('responses', {}).items():
                if isinstance(resp, dict) and '$ref' not in resp:
                    resp.setdefault('headers', {})['OpenWOP-Version'] = {'$ref': '#/components/headers/OpenWOPVersion'}
                    etag = (resp.get('headers') or {}).get('ETag')
                    if op.get('operationId') == 'getCapabilities' and code == '200' and isinstance(etag, dict):
                        # capabilities.md §1 is a MUST in v2; the v1 text said SHOULD and named the
                        # retired `Capabilities-Etag` (D2, 2.36.2). The obligation is per operation.
                        etag['description'] = ('Strong validator for the discovery document (capabilities.md §1). A v2 host MUST send it '
                                               'and MUST honor `If-None-Match` with `304`. A host that changes semantics without changing '
                                               'the bytes is non-conformant.')
            if op.get('operationId') == 'pollRunEvents':
                ok = op['responses'].get('200', {})
                ok['content'] = {'application/json': {'schema': {'type': 'object', 'additionalProperties': False, 'required': ['runId', 'events', 'lastSequence', 'status', 'isTerminal'], 'properties': {'runId': {'$ref': '../../schemas/v2/ids.schema.json#/$defs/runId'}, 'events': {'type': 'array', 'items': {'$ref': '../../schemas/v2/run-event.schema.json'}}, 'lastSequence': {'type': 'integer', 'minimum': -1, 'description': 'The highest sequence in the log at the time of the response; -1 when the log is empty.'}, 'status': {'type': 'string'}, 'isTerminal': {'type': 'boolean'}}}}}
    for name in ('RunClaimConflict', 'UnsupportedStreamMode'):
        if name in comps.get('schemas', {}):
            comps['schemas'][name] = {'$ref': '../../schemas/v2/error-envelope.schema.json', 'description': f'`{name}` is the canonical error envelope; `error` carries the code.'}
    for resp in comps.get('responses', {}).values():
        if isinstance(resp, dict) and 'headers' in resp:
            resp['headers'].pop('Capabilities-Etag', None)
    # RFC 0200 §F.3 — the v2-only operations have no v1 ancestor to inherit a scope
    # declaration from, so their scopes are named here. `scripts/check-openapi-security.mjs`
    # fails when an operation in either document lacks `security`, so a new v2-only
    # operation added above without a row here reds the gate rather than silently
    # inheriting the global default.
    V2_ONLY_SCOPES = {
        'getEffectSeamManifest': ['runs:read'],
        'getRunCompensation': ['runs:read'],
        'getRunEffects': ['runs:read'],
        'listRuns': ['runs:read'],
        'listWebhookDeadLetters': ['webhooks:manage'],
        'rotateWebhookSecret': ['webhooks:manage'],
        'streamHostEvents': ['runs:read'],
    }
    for key, item in doc['paths'].items():
        for method, op in item.items():
            if method not in ('get', 'post', 'put', 'delete', 'patch'):
                continue
            if 'security' in op:
                continue
            oid = op.get('operationId')
            scopes = V2_ONLY_SCOPES.get(oid)
            if scopes is None:
                raise SystemExit(f'derive-v2-api: operation {oid} ({method.upper()} {key}) declares no security and has no V2_ONLY_SCOPES row (RFC 0200 §F.3)')
            op['security'] = [{'ApiKeyAuth': list(scopes)}, {'OAuth2': list(scopes)}, {'OpenIdConnect': list(scopes)}]
    doc = rewrite(doc)
    seams['security'] = copy.deepcopy(doc.get('security', []))
    seams = rewrite(seams, '../schemas/v2/')  # api/seams-v2.yaml lives one level up from api/v2/
    return doc, seams

CODEMAP = json.loads((ROOT / 'spec' / 'v2' / 'event-codemap.json').read_text())
V1_TO_V2_EVENT = {r['v1']: r['v2'] for r in CODEMAP['rows']}

def v2_asyncapi():
    comps = rewrite(copy.deepcopy(A1.get('components', {})))
    # Run-event message names are the v2 `type` (events.md §SSE frames: `event:` is the v2
    # type), so a v1 spelling copied from api/asyncapi.yaml is translated through the
    # codemap. Host events (heartbeat.*) are not run events and are not in the codemap;
    # they keep their names (events.md §Host events, RFC 0060). D5, 2.36.2.
    for msg in comps.get('messages', {}).values():
        if isinstance(msg, dict) and msg.get('name') in V1_TO_V2_EVENT:
            msg['name'] = V1_TO_V2_EVENT[msg['name']]
        for field in ('description', 'summary'):
            if isinstance(msg, dict) and isinstance(msg.get(field), str):
                msg[field] = msg[field].replace('/v1/runs/', '/runs/')
    # One authentication scheme across the two documents: the v2 OpenAPI ApiKeyAuth is an
    # HTTP bearer (RFC 0200 §F); v1's AsyncAPI declared an httpApiKey in `Authorization`.
    if 'ApiKeyAuth' in comps.get('securitySchemes', {}):
        comps['securitySchemes']['ApiKeyAuth'] = {'type': 'http', 'scheme': 'bearer', 'bearerFormat': 'API key',
                                                  'description': ('Bearer API key; the same scheme as `ApiKeyAuth` in `api/v2/openapi.yaml`. Subscribing requires the '
                                                                  '`runs:read` scope.')}
    comps.setdefault('messages', {})['RunEvent'] = {'name': 'runEvent', 'title': 'Run event', 'contentType': 'text/event-stream', 'payload': {'$ref': '../../schemas/v2/run-event.schema.json'}, 'description': 'One SSE frame per run event: `event:` is the v2 type and `id:` is the sequence.'}
    return {
        'asyncapi': A1['asyncapi'],
        'info': {'title': 'OpenWOP v2 event streams', 'version': REL['version'], 'description': ("OpenWOP v2 event streams over SSE. The run-events channel's address is the OpenAPI path key, and the "
                                                                                                 'server pathname is empty (bare origin). `streamMode` is a stream mode from the closed set, or a '
                                                                                                 'comma-separated combination of them; `values` never combines. `hostEvents` has a default address, '
                                                                                                 '`/host/events`; a host MAY declare another under `heartbeat.deliveryChannel`.\n\nGenerated from '
                                                                                                 '`api/asyncapi.yaml` by `scripts/derive-v2-api.py`; do not edit.')},
        'defaultContentType': 'text/event-stream',
        'servers': {'production': {'host': '{host}', 'pathname': '', 'protocol': 'https', 'variables': {'host': {'default': 'api.example.com'}}}},
        'channels': {
            'runEvents': {'address': '/runs/{runId}/events', 'title': 'Run event stream (SSE)', 'parameters': {'runId': {'description': 'The run to subscribe to (`ids.schema.json#/$defs/runId`).'}},
                          'messages': {'runEvent': {'$ref': '#/components/messages/RunEvent'}}},
            'hostEvents': {'address': '/host/events', 'title': 'Host-scoped events (`heartbeat.*`)', 'messages': {'heartbeatEvaluated': {'$ref': '#/components/messages/HeartbeatEvaluated'}, 'heartbeatStateChanged': {'$ref': '#/components/messages/HeartbeatStateChanged'}}},
        },
        'operations': {
            'subscribeRunEvents': {'action': 'receive', 'channel': {'$ref': '#/channels/runEvents'}, 'title': 'Subscribe to a run\'s events',
                                   'description': ('A long-lived SSE subscription that closes after a terminal run event. `Last-Event-ID` resumes from the '
                                                   'sequence after the supplied one. A mixed mode is the union of its filters, and each event carries its own '
                                                   '`event:` label (`stream-modes.md`).'),
                                   'bindings': {'http': {'method': 'GET', 'query': {'type': 'object', 'additionalProperties': False, 'properties': {'streamMode': {'type': 'string', 'pattern': '^(values|(updates|messages|debug)(,(updates|messages|debug))*)$', 'default': 'updates'}}}}}},
            'subscribeHostEvents': {'action': 'receive', 'channel': {'$ref': '#/channels/hostEvents'}, 'title': 'Subscribe to host events', 'bindings': {'http': {'method': 'GET'}}},
        },
        'components': comps,
    }

def manifest(doc, adoc):
    ops = []
    for key, item in doc['paths'].items():
        for method, op in item.items():
            if method in ('get', 'post', 'put', 'delete', 'patch'):
                ops.append({'method': method.upper(), 'path': key, 'operationId': op.get('operationId')})
    ops.sort(key=lambda o: (o['path'], o['method']))
    chans = [{'name': n, 'address': c['address']} for n, c in adoc['channels'].items()]
    return {'$comment': 'GENERATED by scripts/derive-v2-api.py (RFC 0172 §C.2 / RFC 0168 §C.2): the canonical v2 operations and channels; no seam or test-mode operation; every path unversioned. check-path-parity.mjs compares this to both API documents.', 'generatedFrom': ['api/v2/openapi.yaml', 'api/v2/asyncapi.yaml'], 'serverUrl': 'https://{host}', 'operations': ops, 'channels': chans, 'counts': {'operations': len(ops), 'channels': len(chans)}}

def prune_unused(doc):
    """Drop components no operation in THIS document references (a seam-only
    parameter has no business in the canonical document and vice versa)."""
    text = json.dumps({k: v for k, v in doc.items() if k != 'components'})
    comps = doc.get('components', {})
    for group in ('parameters', 'responses', 'schemas', 'headers', 'requestBodies'):
        if group not in comps:
            continue
        changed = True
        while changed:
            changed = False
            alltext = text + json.dumps({g: v for g, v in comps.items()})
            for name in list(comps[group]):
                if f'#/components/{group}/{name}"' not in alltext.replace(f'"{group}": {{"{name}"', ''):
                    # referenced nowhere except by its own definition
                    refs = alltext.count(f'#/components/{group}/{name}"')
                    if refs == 0:
                        del comps[group][name]; changed = True
        if not comps[group]:
            del comps[group]
    # A top-level tag no operation carries is dangling metadata. The v2 doc
    # inherits `tags` wholesale from v1, so every tag whose operations were
    # moved out (the seams) or deleted at the cut survived as an orphan
    # describing a path space v2 does not define -- `packs-test` was one,
    # still citing RFC 0025 as `Draft` (Accepted 2026-05-29) and a
    # `capabilities.packs.testMode.supported` gate whose field v2 dropped.
    used = set()
    for path_item in doc.get('paths', {}).values():
        for op in path_item.values():
            if isinstance(op, dict):
                used.update(op.get('tags', []) or [])
    if 'tags' in doc:
        doc['tags'] = [t for t in doc['tags'] if t.get('name') in used]
        if not doc['tags']:
            del doc['tags']
    return doc

def first_para(text):
    """The first paragraph of an OpenAPI description, joined onto one line (a
    description wrapped across lines was cut mid-sentence by a first-line split)."""
    return ' '.join(text.strip().split('\n\n')[0].split())

def cell(text):
    """A headers.md table cell: drop a leading openwop RFC citation ("RFC 0172 §A.3 —",
    "RFC 0165 §C.2;", "RFC 0115.") — the doc's Sources line carries provenance."""
    text = re.sub(r'^RFC 0\d{3}(?: §[A-Z0-9][\w.–-]*)?\s*(?:—|;|\.)\s*', '', text)
    text = re.sub(r'\s*Closes F\d+\.$', '', text)  # internal gap-tracker tag
    text = re.sub(r'^[a-z-]+\.md §\w+\.\s*', '', text)  # a bare cross-ref lead-in; the cell restates it
    return text[:1].upper() + text[1:]

def headers_doc(doc):
    """spec/v2/core/headers.md — GENERATED (RFC 0171 §C.1): every non-standard
    header is declared in OpenAPI, so the table that enumerates headers enumerates
    all of them."""
    req, resp = {}, {}
    comps = doc.get('components', {})
    def param_of(p):
        if '$ref' in p:
            return comps.get('parameters', {}).get(p['$ref'].split('/')[-1], {})
        return p
    for key, item in doc['paths'].items():
        for method, op in item.items():
            if method not in ('get', 'post', 'put', 'delete', 'patch'):
                continue
            for p in op.get('parameters', []) + item.get('parameters', []):
                pp = param_of(p)
                if pp.get('in') == 'header':
                    req.setdefault(pp['name'], {'desc': first_para(pp.get('description', '')), 'ops': set()})['ops'].add(op.get('operationId'))
            for code, r in op.get('responses', {}).items():
                rr = comps.get('responses', {}).get(r['$ref'].split('/')[-1], {}) if '$ref' in r else r
                for hn, h in (rr.get('headers') or {}).items():
                    hh = comps.get('headers', {}).get(h['$ref'].split('/')[-1], {}) if '$ref' in h else h
                    resp.setdefault(hn, {'desc': first_para(hh.get('description') or ''), 'ops': set()})['ops'].add(op.get('operationId'))
    lines = ['# Headers', '', '> **Status: Stable.** Generated from `api/v2/openapi.yaml` by `scripts/derive-v2-api.py`; do not edit.', '',
             '## Why this exists', '', 'Every non-standard header is named `OpenWOP-<Name>`, and every header is declared in OpenAPI. These tables are generated from that declaration, so they list all of them: a header not listed here is not part of the protocol.', '',
             'Standard headers keep their standard names: `Idempotency-Key`, `ETag`, `If-None-Match`, `Last-Event-ID`, `Retry-After`, `Authorization`.', '',
             '## Request headers', '', '| Header | Operations | Meaning |', '| --- | --- | --- |']
    for n in sorted(req):
        lines.append(f"| `{n}` | {len(req[n]['ops'])} | {cell(req[n]['desc'])} |")
    lines += ['', '## Response headers', '', '| Header | Operations | Meaning |', '| --- | --- | --- |']
    # A standard header shared by operations with different obligations gets one neutral
    # row; the MUST/SHOULD lives on each operation (D2, 2.36.2).
    shared = {'Cache-Control': 'Standard HTTP caching directive (RFC 9111), set per operation: public content-page delivery, and prompt templates (immutable semantics when the version was pinned); see each operation.',
              'ETag': 'Standard HTTP validator (RFC 9110 §8.8.3). The obligation is per operation: MUST on the discovery document (capabilities.md §1), SHOULD on the run snapshot (runs.md §Snapshot), a content hash on a prompt template (getPromptTemplate); see each operation.'}
    for n in sorted(resp):
        lines.append(f"| `{n}` | {len(resp[n]['ops'])} | {cell(shared.get(n, resp[n]['desc']))} |")
    lines += ['', '## Webhook delivery headers', '', 'Declared in `webhooks.md`, not in OpenAPI, because the host is the client:', '',
              '- `OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`, `OpenWOP-Timestamp`, `OpenWOP-Signature`, `OpenWOP-Signature-Algorithm`.',
              "- On a subscription that opted into Standard Webhooks (webhooks.md): that standard's `webhook-id`, `webhook-timestamp` and `webhook-signature`, under their standard names.",
              '- During the v1 overlap only: the `X-openwop-*` family, emitted beside them and removed at v1 end-of-support.', '',
              '## Removed in v2', '', 'These header names are not part of v2: `Capabilities-Etag` (use the standard `ETag`/`If-None-Match` pair), `X-Dedup`, `X-Force-Engine-Version`, `X-Pack-Sha256`, `X-Pack-Signing-Method`, `X-openwop-*` (webhooks), `openwop-Webhook-Signature`.', '',
              '*Sources: RFC 0165, RFC 0171, RFC 0172, RFC 0201.*', '']
    return '\n'.join(lines)

PROSE_RENAMES = (('openwop-Idempotent-Replay', 'OpenWOP-Idempotent-Replay'), ('X-Idempotent-Replay', 'OpenWOP-Idempotent-Replay'))

def dump(obj):
    text = yaml.safe_dump(obj, sort_keys=False, allow_unicode=True, width=120)
    # prose mentions of renamed headers inside descriptions (RFC 0171 §C.1)
    for old_name, new_name in PROSE_RENAMES:
        text = text.replace(old_name, new_name)
    return text

# Readable prose for strings inherited from the frozen v1 documents. The table lives in
# scripts/derive-v2-api-prose.yaml (was -> now); strings written in this file are edited
# here instead. Only `description`, `summary` and `title` string values are touched.
PROSE = yaml.safe_load((ROOT / 'scripts' / 'derive-v2-api-prose.yaml').read_text()) or []
PROSE_BY_WAS = {row['was']: row for row in PROSE}
PROSE_USED = set()

def apply_prose(node):
    if isinstance(node, dict):
        for key in ('description', 'summary', 'title'):
            val = node.get(key)
            if not isinstance(val, str):
                continue
            seen = val
            for old_name, new_name in PROSE_RENAMES:  # compare as the string reads in the generated file
                seen = seen.replace(old_name, new_name)
            row = PROSE_BY_WAS.get(seen)
            if row is None:
                continue
            PROSE_USED.add(seen)
            node[key] = row['now']
            if 'description' in row:
                if key != 'summary' or 'description' in node:
                    raise SystemExit(f'derive-v2-api: prose row for {seen[:60]!r} moves text into a description, but it matched a {key} whose parent already has one')
                items = list(node.items())
                at = [k for k, _ in items].index('summary') + 1
                node.clear()
                node.update(items[:at] + [('description', row['description'])] + items[at:])
        for v in node.values():
            apply_prose(v)
    elif isinstance(node, list):
        for v in node:
            apply_prose(v)

doc, seams = v2_openapi_and_seams(); doc = prune_unused(doc); seams = prune_unused(seams); adoc = v2_asyncapi()
for d in (doc, seams, adoc):
    apply_prose(d)
stale_prose = [w for w in PROSE_BY_WAS if w not in PROSE_USED]
if stale_prose:
    sys.exit('derive-v2-api: scripts/derive-v2-api-prose.yaml rows match no inherited string (stale): ' + '; '.join(repr(w[:60]) for w in stale_prose))
man = manifest(doc, adoc)
outputs = {ROOT / 'spec' / 'v2' / 'core' / 'headers.md': headers_doc(doc), ROOT / 'api' / 'v2' / 'openapi.yaml': dump(doc), ROOT / 'api' / 'v2' / 'asyncapi.yaml': dump(adoc), ROOT / 'api' / 'seams-v2.yaml': dump(seams), ROOT / 'spec' / 'v2' / 'path-manifest.json': json.dumps(man, indent=2, ensure_ascii=False) + '\n'}
if '--write' in sys.argv:
    for p, s in outputs.items():
        p.parent.mkdir(parents=True, exist_ok=True); p.write_text(s); print(f'wrote {p.relative_to(ROOT)}')
    print(f"derive-v2-api: {man['counts']['operations']} operations, {man['counts']['channels']} channels, {len(seams['paths'])} seam paths")
else:
    stale = [str(p.relative_to(ROOT)) for p, s in outputs.items() if not p.exists() or p.read_text() != s]
    if stale:
        print('derive-v2-api: stale — ' + ', '.join(stale) + '. Run: python3 scripts/derive-v2-api.py --write', file=sys.stderr); sys.exit(1)
    print(f"=== derive-v2-api OK — {man['counts']['operations']} operations / {man['counts']['channels']} channels in parity with the committed outputs ===")
