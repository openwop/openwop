/**
 * `ctx.knowledge` host surface (`host.knowledge`, `spec/v1/host-capabilities.md`
 * §host.knowledge) — the `vendor.myndhyve.knowledge-tools` pack's RAG retrieval.
 *
 * The demo backs retrieval with a LEXICAL index (token-frequency relevance over
 * a seeded demo corpus) — the same scoring family as `host.db.search`. This is
 * genuinely functional retrieval-with-citations; it's lexical rather than
 * semantic only because the sample host ships no embedding model (a production
 * host would back `retrieve` with vector search). The wire shape is identical
 * either way, so the pack's `knowledge.retrieve` / `knowledge.augment-prompt`
 * nodes run and return real ranked chunks + de-duplicated sources.
 */

import { createLogger } from '../observability/logger.js';
import type { BundleScope } from './inMemorySurfaces.js';

const log = createLogger('host.knowledge');

interface KnowledgeChunk {
  chunkId: string;
  content: string;
  headingPath: string[];
  pageNumber: number | null;
  documentTitle: string;
  assetId: string;
  collectionId: string;
}

/** Seeded demo corpus. A handful of chunks across two collections so the
 *  retrieve path returns real, differentiated results. */
const CORPUS: KnowledgeChunk[] = [
  { chunkId: 'c1', assetId: 'doc-onboarding', collectionId: 'handbook', documentTitle: 'Employee Handbook', headingPath: ['Onboarding', 'First Week'], pageNumber: 3, content: 'New hires complete onboarding in the first week: account setup, security training, and a buddy assignment. Expense reimbursement is filed through the finance portal.' },
  { chunkId: 'c2', assetId: 'doc-pto', collectionId: 'handbook', documentTitle: 'Employee Handbook', headingPath: ['Time Off', 'Vacation Policy'], pageNumber: 7, content: 'Paid time off accrues monthly. Vacation requests should be submitted two weeks in advance through the time-off system and approved by a manager.' },
  { chunkId: 'c3', assetId: 'doc-security', collectionId: 'handbook', documentTitle: 'Employee Handbook', headingPath: ['Security', 'Credentials'], pageNumber: 12, content: 'Never share credentials. Rotate API keys quarterly. Report any suspected secret leakage to the security team immediately and revoke the affected key.' },
  { chunkId: 'c4', assetId: 'doc-arch', collectionId: 'engineering', documentTitle: 'Architecture Guide', headingPath: ['Runtime', 'Workflows'], pageNumber: 1, content: 'The workflow engine executes a DAG of nodes. Each node delegates to a host surface. Runs are durable and replayable from the event log.' },
  { chunkId: 'c5', assetId: 'doc-arch', collectionId: 'engineering', documentTitle: 'Architecture Guide', headingPath: ['Runtime', 'Triggers'], pageNumber: 2, content: 'Workflows start from triggers: webhooks, schedules, and queue messages. Trigger payloads are captured at run start and surfaced as trigger data.' },
  { chunkId: 'c6', assetId: 'doc-deploy', collectionId: 'engineering', documentTitle: 'Deployment Runbook', headingPath: ['Release', 'Rollout'], pageNumber: 4, content: 'Deploy the backend before the frontend. Verify the new revision serves traffic, then ship the static site. Roll back by routing traffic to the prior revision.' },
];

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'is', 'are', 'be', 'for', 'on', 'by', 'how', 'do', 'i', 'my', 'with']);
function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 1 && !STOP.has(t)) ?? [];
}

export interface KnowledgeSurface {
  retrieve(args: {
    query: string;
    workspaceId?: string;
    collectionIds?: string[];
    category?: string;
    candidateLimit?: number;
    resultLimit?: number;
    scoreThreshold?: number;
  }): Promise<unknown>;
}

const QUERY_MAX = 4000;

export function createKnowledgeSurface(_scope: BundleScope): KnowledgeSurface {
  return {
    async retrieve({ query, collectionIds, candidateLimit = 20, resultLimit = 8, scoreThreshold = 0 }) {
      const started = Date.now();
      if (typeof query !== 'string' || query.length === 0) {
        throw Object.assign(new Error('knowledge query is required'), { code: 'knowledge_query_too_long' });
      }
      if (query.length > QUERY_MAX) {
        throw Object.assign(new Error('knowledge query too long'), { code: 'knowledge_query_too_long' });
      }
      const qTokens = tokenize(query);
      const pool = CORPUS.filter((c) => !collectionIds || collectionIds.length === 0 || collectionIds.includes(c.collectionId));

      // Token-frequency score per chunk, then normalize to 0..1 by the best hit.
      const scored = pool.map((c) => {
        const docTokens = tokenize(c.content + ' ' + c.headingPath.join(' ') + ' ' + c.documentTitle);
        let raw = 0;
        for (const qt of qTokens) {
          const tf = docTokens.filter((t) => t === qt).length;
          if (tf > 0) raw += 1 + Math.log(1 + tf);
        }
        return { c, raw };
      }).filter((x) => x.raw > 0);

      scored.sort((a, b) => b.raw - a.raw);
      const top = scored.slice(0, Math.max(1, candidateLimit));
      const maxRaw = top.length ? top[0]!.raw : 1;

      const chunks = top
        .map(({ c, raw }) => ({
          chunkId: c.chunkId,
          content: c.content,
          headingPath: c.headingPath,
          pageNumber: c.pageNumber,
          documentTitle: c.documentTitle,
          assetId: c.assetId,
          collectionId: c.collectionId,
          relevanceScore: Math.min(1, raw / maxRaw),
        }))
        .filter((c) => c.relevanceScore >= scoreThreshold)
        .slice(0, Math.max(1, resultLimit));

      // De-duplicate sources by assetId (RFC §host.knowledge — citation set).
      const sources: Array<{ sourceId: string; assetId: string; title: string; headingPath: string[]; pageNumber: number | null }> = [];
      const seen = new Set<string>();
      for (const c of chunks) {
        if (seen.has(c.assetId)) continue;
        seen.add(c.assetId);
        sources.push({ sourceId: c.assetId, assetId: c.assetId, title: c.documentTitle, headingPath: c.headingPath, pageNumber: c.pageNumber });
      }

      log.info('knowledge retrieve (lexical)', { chunks: chunks.length, sources: sources.length });
      return { chunks, sources, latencyMs: Date.now() - started, hasResults: chunks.length > 0 };
    },
  };
}
