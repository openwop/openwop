/**
 * The `capabilities.multiAgent.executionModel.version` ceiling, read from
 * `capabilities.schema.json` so a scenario never restates it. Two scenarios
 * carried a literal `<= 5` past RFC 0090 (version 6, Accepted 2026-06-08) and
 * failed the very host that witnessed version 6 (S31, 2026-08-17).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from './paths.js';

let cached: number | undefined;

export function executionModelVersionMax(): number {
  if (cached !== undefined) return cached;
  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as {
    properties?: { multiAgent?: { properties?: { executionModel?: { properties?: { version?: { maximum?: number } } } } } };
  };
  const max = schema.properties?.multiAgent?.properties?.executionModel?.properties?.version?.maximum;
  if (typeof max !== 'number') throw new Error('capabilities.schema.json §multiAgent.executionModel.version has no `maximum`');
  cached = max;
  return max;
}
