/**
 * published-tree — read a corpus file as it stood at the last published corpus
 * tag (RFC 0255 §D).
 *
 * A gate that compares the tree against a committed "before" file is only as
 * strong as that file: when the same change can regenerate it, a removal and
 * its baseline land together and the gate sees nothing. The last `v2.*` tag
 * that is an ancestor of HEAD is a before no pull request can rewrite.
 *
 * `fileAtLastTag` throws when git or the tag is unavailable. Callers on the
 * real tree fail closed; fixture callers pass the file through an env seam
 * instead of reaching git.
 */

import { execFileSync } from 'node:child_process';

export function lastPublishedTag(root) {
  return execFileSync('git', ['-C', root, 'describe', '--tags', '--abbrev=0', '--match', 'v2.*', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** { tag, text } for `relPath` at the last published tag; `text` is null when the file did not exist there. */
export function fileAtLastTag(root, relPath) {
  const tag = lastPublishedTag(root);
  try {
    const text = execFileSync('git', ['-C', root, 'show', `${tag}:${relPath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { tag, text };
  } catch {
    return { tag, text: null };
  }
}
