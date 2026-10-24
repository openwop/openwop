/**
 * RFC 0249 — pure judges for `v2-proposal-lifecycle.test.ts`. The scenario
 * drives one client-submitted `prompt-template` proposal through submit →
 * revise → apply and records every response; these functions decide each leg
 * from those records, so the self-tests can fail every wrong host answer
 * without a host.
 *
 * The rules are the `agents.proposals` facet description
 * (`spec/v2/facets/agents.schema.json`), `proposal.schema.json`, the proposal
 * operations in `api/v2/openapi.yaml` and `spec/v2/errors.json`. They make
 * RFC 0096's `proposal-inert-until-applied` and `proposal-no-resynthesis`
 * observable for the one kind with a v2 read-back.
 *
 * @see RFCS/0249-proposal-operations-and-install-readback.md
 */

import { createHash } from 'node:crypto';
import { canonicalJSON } from './jcs.js';
import { readErrorCode } from './error-envelope.js';

export interface ProposalFinding { readonly ok: boolean; readonly message: string }

type Rec = Record<string, unknown>;
/** One recorded HTTP exchange. `null` means the request never got an answer. */
export type Exchange = { readonly status: number; readonly json: unknown } | null;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const f = (ok: boolean, message: string): ProposalFinding => ({ ok, message });
// The v2 envelope is flat: `{ error: "<code>", message, details? }`
// (`error-envelope.schema.json`). `readErrorCode` reads it (and tolerates the
// legacy nested form); `details` sits at the root.
const code = (x: Exchange): string | undefined => readErrorCode(x?.json);
const details = (x: Exchange): Rec => {
  const body = isRec(x?.json) ? x.json : {};
  if (isRec(body['details'])) return body['details'];
  const nested = body['error'];
  return isRec(nested) && isRec(nested['details']) ? nested['details'] : {};
};
const shown = (x: Exchange): string => (x === null ? 'no answer' : `${x.status}${code(x) ? ` ${code(x)}` : ''}`);

/** `sha256:` + lowercase hex SHA-256 of the RFC 8785 (JCS) serialization. */
export function artifactDigest(artifact: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJSON(artifact), 'utf8').digest('hex')}`;
}

/** The kind's host-owned fields removed (for `prompt-template`, `meta`). */
export function withoutHostOwned(body: unknown): unknown {
  if (!isRec(body)) return body;
  const { meta: _meta, ...rest } = body;
  return rest;
}

/** JCS equality after removing host-owned fields from both sides. */
export function byteMatches(served: unknown, artifact: unknown): boolean {
  return canonicalJSON(withoutHostOwned(served)) === canonicalJSON(withoutHostOwned(artifact));
}

/** A fresh, author-minted template id the host has never seen. */
export function freshTemplate(nonce: string, text: string): Rec {
  return { templateId: `conformance.proposal.${nonce}`, version: '1.0.0', kind: 'system', text };
}

/** A submitted kind outside `artifactKinds` is `400 validation_error` naming `kind`. */
export function judgeSubmitKindRefused(x: Exchange): ProposalFinding[] {
  return [
    f(x?.status === 400 && code(x) === 'validation_error', `a kind outside artifactKinds MUST be refused 400 validation_error (got ${shown(x)})`),
    f(details(x)['field'] === 'kind', `the refusal MUST name details.field "kind" (got ${JSON.stringify(details(x)['field'])})`),
  ];
}

/** The draft's template is not served, listed or renderable while unapplied. */
export function judgeInert(get: Exchange, list: Exchange, render: Exchange, templateId: string, when: string): ProposalFinding[] {
  const items = isRec(list?.json) && Array.isArray(list.json['items']) ? (list.json['items'] as unknown[]).filter(isRec) : null;
  return [
    f(get?.status === 404, `${when}: getPromptTemplate MUST NOT serve the unapplied draft's template (got ${shown(get)})`),
    f(list?.status === 200 && items !== null, `${when}: listPromptTemplates MUST answer 200 with items (got ${shown(list)})`),
    f(items !== null && !items.some((t) => t['templateId'] === templateId), `${when}: listPromptTemplates MUST NOT list the unapplied draft's template`),
    f(render !== null && render.status >= 400, `${when}: :render naming the unapplied draft's template MUST fail as for an unknown template (got ${shown(render)})`),
  ];
}

/** An apply the caller is not scoped for installs nothing and changes no state. */
export function judgeApplyUnscoped(apply: Exchange, after: Exchange, prompt: Exchange, wwwAuthenticate: string | null): ProposalFinding[] {
  const state = isRec(after?.json) ? after.json['state'] : undefined;
  return [
    f(apply?.status === 403, `an apply without proposals:apply MUST be refused 403 (got ${shown(apply)})`),
    f(typeof wwwAuthenticate === 'string' && /error="insufficient_scope"/.test(wwwAuthenticate), `the 403 MUST carry error="insufficient_scope" (got ${wwwAuthenticate ?? 'no WWW-Authenticate'})`),
    f(state === 'revised', `a refused apply MUST leave state unchanged (got ${JSON.stringify(state)})`),
    f(prompt?.status === 404, `a refused apply MUST install nothing (getPromptTemplate ${shown(prompt)})`),
  ];
}

/** An apply bound to bytes the reviewer no longer holds is `409 proposal_stale`. */
export function judgeApplyStale(apply: Exchange, after: Exchange, prompt: Exchange): ProposalFinding[] {
  const state = isRec(after?.json) ? after.json['state'] : undefined;
  return [
    f(apply?.status === 409 && code(apply) === 'proposal_stale', `an apply whose artifactDigest is not the persisted artifact's MUST be refused 409 proposal_stale (got ${shown(apply)})`),
    f(state === 'revised', `a stale apply MUST leave state unchanged (got ${JSON.stringify(state)})`),
    f(prompt?.status === 404, `a stale apply MUST install nothing (getPromptTemplate ${shown(prompt)})`),
  ];
}

/** The revision is persisted, and the served digest is the revised artifact's. */
export function judgeRevised(revise: Exchange, revised: Rec): ProposalFinding[] {
  const p = isRec(revise?.json) ? revise.json : {};
  return [
    f(revise?.status === 200 && p['state'] === 'revised', `a revise MUST answer 200 with state revised (got ${shown(revise)}, state ${JSON.stringify(p['state'])})`),
    f(p['artifactDigest'] === artifactDigest(revised), `artifactDigest MUST be sha256 over the JCS of the revised artifact (got ${JSON.stringify(p['artifactDigest'])})`),
  ];
}

/** A successful apply names the read that serves the installed artifact. */
export function judgeApplied(apply: Exchange, templateId: string): ProposalFinding[] {
  const p = isRec(apply?.json) ? apply.json : {};
  const act = isRec(p['activation']) ? p['activation'] : {};
  const ia = isRec(act['installedArtifact']) ? act['installedArtifact'] : {};
  return [
    f(apply?.status === 200 && p['state'] === 'applied', `an authorized, current apply MUST answer 200 with state applied (got ${shown(apply)}, state ${JSON.stringify(p['state'])})`),
    f(ia['kind'] === 'prompt-template' && ia['operationId'] === 'getPromptTemplate', `activation.installedArtifact MUST name kind prompt-template and operationId getPromptTemplate (got ${JSON.stringify(ia)})`),
    f(ia['id'] === templateId, `installedArtifact.id MUST be the artifact's templateId, never a minted one (got ${JSON.stringify(ia['id'])})`),
  ];
}

/** The installed bytes are the revised artifact's, not the original's. */
export function judgeReadback(served: Exchange, revised: Rec, original: Rec): ProposalFinding[] {
  const body = served?.json;
  return [
    f(served?.status === 200, `getPromptTemplate MUST serve the installed template after apply (got ${shown(served)})`),
    f(served?.status === 200 && byteMatches(body, revised), 'the read-back minus meta MUST be JCS-equal to the last-persisted (revised) artifact minus meta'),
    f(served?.status === 200 && !byteMatches(body, original), 'the read-back MUST NOT be the pre-revision artifact: that is a silent re-synthesis'),
  ];
}

/** Revise and apply on an applied (terminal) proposal are `409 proposal_state_conflict`. */
export function judgeTerminal(revise: Exchange, apply: Exchange): ProposalFinding[] {
  return [revise, apply].flatMap((x, i) => {
    const action = i === 0 ? 'revise' : 'apply';
    return [
      f(x?.status === 409 && code(x) === 'proposal_state_conflict', `${action} on an applied proposal MUST be refused 409 proposal_state_conflict (got ${shown(x)})`),
      f(details(x)['state'] === 'applied', `the ${action} refusal MUST name details.state "applied" (got ${JSON.stringify(details(x)['state'])})`),
    ];
  });
}

/** Another tenant sees the proposal and the installed template as ids that do not exist. */
export function judgeForeign(pairs: ReadonlyArray<{ what: string; foreign: Exchange; unknown: Exchange }>): ProposalFinding[] {
  return pairs.flatMap(({ what, foreign, unknown }) => [
    f(foreign?.status === 404, `${what} as another tenant MUST answer 404 (got ${shown(foreign)})`),
    f(foreign?.status === unknown?.status && code(foreign) === code(unknown), `${what} as another tenant MUST answer exactly as an unknown id (foreign ${shown(foreign)}, unknown ${shown(unknown)}) — otherwise it is an existence oracle`),
  ]);
}
