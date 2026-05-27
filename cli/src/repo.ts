import type { Ctx } from './context.js';
/** Repo-root discovery + demo project paths (run-from-checkout commands). */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { CliError } from './errors.js';

export function findRepoRoot(startDir: any) {
  let dir = resolvePath(startDir);
  while (true) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8'));
        if (
          parsed.name === 'openwop-spec-corpus' &&
          existsSync(join(dir, 'apps/workflow-engine')) &&
          existsSync(join(dir, 'conformance'))
        ) {
          return dir;
        }
      } catch {
        // Keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireRepoRoot(ctx: Ctx) {
  if (ctx.repoRoot) return ctx.repoRoot;
  throw new CliError('This command needs to run from inside the OpenWOP repository checkout.');
}

export function demoProjects(root: any) {
  if (!root) return [];
  return [
    project(root, 'backend', 'apps/workflow-engine/backend/typescript'),
    project(root, 'frontend', 'apps/workflow-engine/frontend/react'),
  ];
}

export function project(root: any, name: any, relativeDir: any) {
  const dir = join(root, relativeDir);
  return {
    name,
    relativeDir,
    dir,
    packageJson: join(dir, 'package.json'),
    nodeModules: join(dir, 'node_modules'),
  };
}

