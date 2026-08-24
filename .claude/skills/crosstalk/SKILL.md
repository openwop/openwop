---
name: crosstalk
description: Message channel + lightweight work-delegation bus between Claude Code sessions on one machine (different projects, or multiple sessions in the same project). A shared /tmp markdown file is an append-at-top queue with handshake, reply threading, auto-armed 2-minute polling, and auto-replies to questions. Each session gets a distinct `<project>-<n>` identity. The session that creates a queue is its ORCHESTRATOR and can break a large task into phases and delegate them to worker sessions as they join; workers claim, execute (in a git worktree for same-project code work), and report back. Invoke `/crosstalk [queue]` to join/poll/auto-reply, `/crosstalk [queue] [message]` to send, or `/crosstalk` (no args) to start a fresh randomly-named queue.
---

# crosstalk — cross-session message queue + delegation bus

Two (or more) Claude Code sessions on the same computer talk through a shared markdown
file in `/tmp`. The file is a queue: newest message on top; each message carries an id, a
sender, a timestamp, an optional reply-to, and optional `type`/`to` fields. The skill is
**project-agnostic** — sessions may be in different projects or several in one project.

**The core is peer messaging.** Roles and delegation (Step 6) are an additive layer on
top — they never replace plain chat, which remains the default.

Automatic behaviors:
- **Auto-loop.** First join of a queue arms a 2-minute watch loop (`/loop 120s /crosstalk <queue>`) (Step 5).
- **Auto-reply, architect-gated.** When another session asks a question, the skill first runs it through the local **`architect`** review, presents the question + the architect's decision to the user, and posts an architect-grounded answer — **without asking permission** to respond (Step 3a).
- **Silent ticks.** A poll that finds nothing new and takes no action produces **no output at all** — stay completely quiet. Only speak when there is something to surface or you acted (Step 3).
- **Roles.** The queue's creator is the **orchestrator**; later joiners are **workers** (Step 6).

## Arguments: `$ARGUMENTS`

Parse `$ARGUMENTS` into:
- **First token** → `QUEUE` (shared queue name; all participants use the same one).
- **Remainder** → `MESSAGE` (free text to send / an instruction to the orchestrator). May be empty.

| Invocation | Mode |
|---|---|
| `/crosstalk` (no args) | **Bootstrap** — offer a randomly-named new queue (Step 0) |
| `/crosstalk <queue>` | **Join + poll + auto-reply** — attach, handshake, surface new messages, auto-answer, run role duties (Step 6), arm the loop on first join |
| `/crosstalk <queue> <message>` | **Post** — send a specific message; if the local session is the orchestrator and `<message>` is a project to break down, treat it as a delegation request (Step 6) |

---

## Step 0 — No queue name given (bootstrap)

If `QUEUE` is empty, **do not invent a queue silently.** Generate a random word (avoid
`$0`/positional awk fields — the slash-command preprocessor rewrites them; use `$RANDOM` + `sed`):

```bash
WORDS=$(grep -E '^[a-z]{4,8}$' /usr/share/dict/words)
COUNT=$(printf '%s\n' "$WORDS" | wc -l | tr -d ' ')
PICK=$(( (RANDOM % COUNT) + 1 ))
RANDWORD=$(printf '%s\n' "$WORDS" | sed -n "${PICK}p")
echo "Suggested queue name: $RANDWORD"
```

Then use **AskUserQuestion**: "No queue name given. Start a new message queue named
**`<RANDWORD>`**?" with options *Yes, use `<RANDWORD>`* / *Pick a different name* (free text).
On accept, set `QUEUE=<RANDWORD>` and continue. Tell the user the chosen name and that the
*other* session must run `/crosstalk <QUEUE>` to connect.

---

## Step 1 — Resolve queue paths and identity

The queue lives in `/tmp` (not `$TMPDIR`) so all sessions share it.

```bash
QUEUE="<queue-name>"                      # from $ARGUMENTS / Step 0
BASE="${CROSSTALK_IDENTITY:-$(basename "$PWD")}"       # project name, e.g. "openwop"
SKEY=$(printf '%s' "${CLAUDE_CODE_SESSION_ID:-$PPID}" | cksum | cut -d' ' -f1)  # stable per session

# Identity = BASE-<n>. Same-project sessions get distinct numbers so they can talk too.
IDFILE="/tmp/crosstalk-${QUEUE}.${BASE}.session-${SKEY}.id"
COUNTER="/tmp/crosstalk-${QUEUE}.${BASE}.counter"
CLOCK="/tmp/crosstalk-${QUEUE}.${BASE}.counter.lock"
case "$BASE" in
  *-[0-9]*) IDENTITY="$BASE" ;;                        # explicit numbered identity
  *)
    if [ -f "$IDFILE" ]; then IDENTITY=$(cat "$IDFILE")
    else
      for i in $(seq 1 50); do mkdir "$CLOCK" 2>/dev/null && break; sleep 0.05; done
      n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 )); printf '%s\n' "$n" > "$COUNTER"
      rmdir "$CLOCK" 2>/dev/null
      IDENTITY="${BASE}-${n}"; printf '%s\n' "$IDENTITY" > "$IDFILE"
    fi ;;
esac

QFILE="/tmp/crosstalk-${QUEUE}.md"        # the shared message queue
SEEN="/tmp/crosstalk-${QUEUE}.${IDENTITY}.seen"        # this session's last-seen msg id
LOCK="/tmp/crosstalk-${QUEUE}.lock"       # write lock (mkdir-based)
LOOPMARK="/tmp/crosstalk-${QUEUE}.${IDENTITY}.loop"    # set once a watch loop is armed
ROLEFILE="/tmp/crosstalk-${QUEUE}.orchestrator"        # holds the orchestrator's identity
BOARD="/tmp/crosstalk-${QUEUE}.board.md"               # orchestrator's task ledger
echo "queue=$QUEUE identity=$IDENTITY exists=$([ -f "$QFILE" ] && echo yes || echo no) looparmed=$([ -f "$LOOPMARK" ] && echo yes || echo no) orchestrator=$(cat "$ROLEFILE" 2>/dev/null || echo none)"
```

Identity is `<project>-<n>` (override the base with `CROSSTALK_IDENTITY`; a value ending
in `-<number>` pins an exact identity). The number is claimed once per session under a
lock and pinned to `CLAUDE_CODE_SESSION_ID`, so it survives loop ticks.

---

## Step 2 — Create + handshake + claim role

If `$QFILE` does not exist, this session is first. Atomically claim the orchestrator role
(noclobber → first writer wins, race-safe), then create the queue with a handshake:

```bash
( set -o noclobber; printf '%s\n' "$IDENTITY" > "$ROLEFILE" ) 2>/dev/null   # claim orchestrator
ROLE=$([ "$(cat "$ROLEFILE" 2>/dev/null)" = "$IDENTITY" ] && echo orchestrator || echo worker)
echo "role=$ROLE"
```

Post the handshake (Step 4) with body
`crosstalk handshake — <IDENTITY> joined as <ROLE>. <orchestrator: ready to delegate / worker: ready for work>`.

If `$QFILE` **exists**, read it (Step 3). Compute `ROLE` the same way (you'll be a worker
unless you already hold the role file). If there is a handshake from another identity and
you haven't introduced yourself, post a handshake reply first. The protocol is symmetric:
first session bootstraps and orchestrates; the rest are workers.

---

## Step 3 — Poll for new messages

Messages are newest-first; each block:

```
<!-- crosstalk id=20260528T103000Z-a1b2 sender=openwop-1 reply-to=… type=task to=openwop-2 -->
### openwop-1 · 2026-05-28T10:30:00Z · id `a1b2` · type `task` → `openwop-2`
> ↪ in reply to `c3d4`

<body, may span multiple lines>

---
```

The HTML-comment line is the machine-readable truth; `type` defaults to `chat` and `to`
to `all` when absent (back-compat with older messages). Poll:

```bash
[ -f "$QFILE" ] || { exit 0; }                         # nothing yet → silent
LAST=$(cat "$SEEN" 2>/dev/null || echo "")
grep -oE '<!-- crosstalk [^>]*-->' "$QFILE"            # full metadata (id/sender/reply-to/type/to)
```

Reading top-down, collect messages whose `sender != $IDENTITY` and whose `id` is newer
than `$LAST` (stop at `$LAST`). Then advance the marker:

```bash
NEWEST_ID=$(grep -oE 'id=[0-9TZ]+-[0-9a-f]+' "$QFILE" | head -1 | cut -d= -f2)
[ -n "$NEWEST_ID" ] && printf '%s\n' "$NEWEST_ID" > "$SEEN"
```

**Advance the marker at READ time and nowhere else.** The newest id you *observed*
is the only correct value; a later write cannot know what arrived in between. Step 4
deliberately does not touch `$SEEN` — see the comment there for the failure it caused.
```

**Silent on empty.** If there are no new messages and you take no action, output **nothing
at all** — no "no new messages", no status, no commentary. Just stop. Only produce output
when you surface a new message, send something, or act on a task. Otherwise present the new
messages (oldest-first), then handle them per Step 3a (chat) and Step 6 (delegation).

---

## Step 3a — Handle inbound chat (architect-gated questions, no permission prompt)

For each new `type=chat` (or untyped) inbound message:

- **If it poses a question or asks for a decision** (a question, status ask, request, or
  anything that expects this session to answer): **run it through the architect FIRST,
  before presenting anything to the user.**
  1. Invoke the local **`architect`** skill via the Skill tool, passing the other party's
     question as `args` (e.g. `Skill(skill: "architect", args: "<the inbound question>")`).
     This grounds the answer in a real protocol-architecture review of *this* repo instead
     of an ad-hoc reply. If this project has no `architect` skill, fall back to grounding the
     answer directly in the repo (read files / run checks) as before.
  2. **Then present to the user** the inbound question *together with* the architect's
     findings / decision — the user should never see the raw question without the architect
     pass attached.
  3. Draft the reply from the architect's decision, set `REPLYTO` to the inbound id, and
     post it (Step 4). Auto-reply stays autonomous — **do NOT ask the user whether to
     respond** — it is simply architect-grounded now. Report what you sent.
- **If it is informational** (no question/request) or a pure acknowledgement: surface it to
  the user and stop. Do **not** invoke the architect and do **not** manufacture a reply.

**Never fabricate** — if the architect (or the repo) can't determine something, say so plainly.
**Avoid runaway ping-pong:** never auto-reply to your own messages or to anything already
answered (`.seen` guards it).

For `/crosstalk <queue> <message>`, the user's `MESSAGE` is the content to send (Step 4);
run Step 3 first so you can thread it as a reply when it answers something.

---

## Step 4 — Post a message (chat, replies, handshakes, or delegation types)

Prepend a block under the lock. Optional `TYPE` (default `chat`) and `TO` (default `all`):

```bash
BODYFILE="/tmp/crosstalk-${QUEUE}.${IDENTITY}.draft"   # write the body here with the Write tool
REPLYTO=""                # an id if replying, else empty
TYPE="chat"               # chat | task | claim | progress | done | blocked
TO="all"                  # all | <identity> | any
TS=$(date -u +%Y%m%dT%H%M%SZ)
RID=$(openssl rand -hex 2 2>/dev/null || printf '%04x' "$RANDOM"); ID="${TS}-${RID}"

for i in $(seq 1 50); do mkdir "$LOCK" 2>/dev/null && break; sleep 0.1; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
{
  printf '<!-- crosstalk id=%s sender=%s reply-to=%s type=%s to=%s -->\n' "$ID" "$IDENTITY" "$REPLYTO" "$TYPE" "$TO"
  HDR="### ${IDENTITY} · ${TS} · id \`${RID}\` · type \`${TYPE}\`"
  [ "$TO" != "all" ] && HDR="${HDR} → \`${TO}\`"
  echo "$HDR"
  [ -n "$REPLYTO" ] && echo "> ↪ in reply to \`${REPLYTO##*-}\`"
  echo; cat "$BODYFILE"; echo; echo "---"; echo
  [ -f "$QFILE" ] && cat "$QFILE"
  true                            # group must exit 0 even when $QFILE is absent
} > "${QFILE}.tmp"
# Keep mv on its own line — `} > tmp && mv` would skip the mv when $QFILE is absent
# (the `[ -f ] && cat` exits non-zero), silently dropping the first message.
mv "${QFILE}.tmp" "$QFILE"
rmdir "$LOCK" 2>/dev/null; trap - EXIT
# Do NOT write your own post id here. Anything that arrived between your READ
# and this WRITE would be skipped permanently: the next poll scans down, hits
# your own id, and stops ABOVE messages it never showed you. Your own post is
# already excluded by the `sender != $IDENTITY` filter in Step 3, so the marker
# does not need to cover it.
#
# Measured 2026-08-24 by a peer: two real messages landed while it was composing
# a reply, were marked seen by that write, and were NEVER DISPLAYED. It only
# recovered them by re-reading the metadata block instead of trusting the marker.
#
# The marker belongs to READ time, and Step 3 already advances it there.
#
# What makes this one nasty is the interaction with "silent on empty": a poll
# that skipped real messages prints exactly what a quiet queue prints — nothing.
# There is no signal to notice, which is why it survived.
echo "posted id=$ID type=$TYPE to=$TO"
```

After posting, run a quick poll (Step 3).

---

## Step 5 — Auto-arm the 2-minute watch loop

Arm a 2-minute loop the **first** time this session joins a queue, exactly once:

- If `$LOOPMARK` does **not** exist: `touch "$LOOPMARK"`, then invoke the **`loop`** skill
  via the Skill tool with `args` = `120s /crosstalk <QUEUE>`.
- If `$LOOPMARK` exists: a loop is already running (this is a loop tick) — do **not** arm
  another; just finish the cycle.

Stop watching with CronDelete + `rm "$LOOPMARK"`. Manual `/crosstalk <queue>` still polls
immediately regardless of the loop.

---

## Step 6 — Orchestrator / worker delegation (additive layer)

This layer lets the orchestrator break a large assignment into phases and farm tasks out
to workers as they join. It is optional and never overrides plain chat.

**Message types** (the `type=` field):
`task` (orchestrator→worker assignment), `claim` (worker→orchestrator, "I'll take it"),
`progress` (worker update), `done` (worker result, link a branch/PR), `blocked`
(worker needs a decision/help). Addressing via `to=`: a specific `<identity>`, `any`
(claimable by the first free worker), or `all`.

### If this session is the ORCHESTRATOR

**Sole arbiter of assignment** — workers propose (`claim`), the orchestrator disposes.
Maintain `$BOARD` as the source of truth (phases → tasks → assignee → status).

On a delegation request (`/crosstalk <queue> <large task>`, or the user tells this session
to break something down):
1. **Decompose** the assignment into phases and concrete tasks. For same-project code work,
   mark each task `worktree: yes`; for cross-project work, set `to=<other-project>-N`.
2. **BONUS — plan gate (only when a plan is produced):** if the decomposition is a real
   multi-step plan, present it to the user (EnterPlanMode / a written plan) and get approval
   **before** fanning out. If the request is a single small task with no plan, skip the gate
   and delegate directly. (Core delegation works without the gate; the gate is the bonus.)
3. Write/refresh `$BOARD`, then post one `type=task` message per task in the current phase
   (`to=<identity>` to direct, or `to=any` to let a free worker claim it). Include in each
   task body: a title, acceptance criteria, whether a worktree is required, the target repo,
   and any dependencies.
4. **Arbitrate claims:** when two workers `claim` the same `to=any` task, confirm the first
   (post a `task` update `to=<winner>`); tell the loser it's taken. Update `$BOARD`.
5. **Track:** on `done`, mark the task complete on `$BOARD`; when a phase's tasks are all
   done, release the next phase's tasks. On `blocked`, surface to the user / unblock.
6. Report board state to the user when it changes; stay silent on empty ticks.

### If this session is a WORKER

On each poll, after chat handling, look for `type=task` messages where `to == $IDENTITY`,
or `to=any` that no one has claimed yet:
1. For `to=any`, post a `type=claim` (`to=<orchestrator>`) and wait for confirmation before
   executing (avoids two workers doing the same task). For `to=<me>` directed tasks, proceed.
2. **Worktree coupling (same-project code work).** Per the repo's CLAUDE.md, never mutate the
   shared checkout from a parallel session. If the task is code work in *this* project, work
   in an isolated worktree:
   ```bash
   git fetch -q origin
   git worktree add "../${BASE}-${QUEUE}-${RID}" origin/main   # RID = the task's short id
   ```
   Do the work there, commit to a branch, push, open a PR; clean up the worktree when done.
   Cross-project tasks run in the worker's own project normally.
3. Post `type=progress` for meaningful milestones, `type=blocked` if you need a decision, and
   `type=done` (threaded to the task id) with the branch/PR/result when finished.
4. Honor the autonomy level the user set: by default a worker executes confirmed/directed
   tasks autonomously; if the user asked for claim-gating, surface each claim for approval first.

**Not yet handled (be honest, don't fake it):** worker liveness/heartbeats and reclaiming a
task whose worker session died — if a claimed task stalls, the orchestrator should re-delegate
manually and say so. Orchestrator hand-off if the creator session exits is also out of scope
for now (the role file persists; a new session can take over by writing it).

---

## Notes & invariants

- **Core first.** Plain chat is the default; delegation is additive and never blocks messaging.
- **Identity is `<project>-<n>`;** same-project sessions get distinct numbers, pinned to `CLAUDE_CODE_SESSION_ID` so they survive loop ticks.
- **Orchestrator = queue creator** (race-safe noclobber claim of `$ROLEFILE`); it is the sole arbiter of task assignment.
- **Silent on empty ticks.** No new messages + no action ⇒ no output whatsoever.
- **Auto-loop once** (`$LOOPMARK`); **auto-reply** to questions but never to acknowledgements / already-answered.
- **Inbound questions are architect-gated.** A question from the other party is run through the local `architect` review *before* it is presented to the user; the reply is grounded in that decision.
- **Same-project code delegation uses git worktrees** per CLAUDE.md — never the shared checkout.
- **Newest on top; never react to your own messages** (`sender != $IDENTITY`); `.seen` makes polling idempotent.
- **Parse on the `<!-- crosstalk id=… -->` line, NEVER on `---`.** Message bodies routinely
  contain markdown horizontal rules, so a reader that splits on `---` stops at the first one
  inside a body and shows only the lead paragraph. A peer did exactly this on 2026-08-24,
  measured two 90-line messages as 430 and 531 bytes, and was one step from reporting a
  second bus defect — *"my instrument was wrong and its output was indistinguishable from the
  defect I was about to report"*, complete with a plausible mechanism and a measurement.
  What caught it was checking whether the text was **present in the file** rather than
  trusting its own parse of where a message ended. The HTML comment is the machine-readable
  truth; the trailing `---` is decoration.
- **`.seen` is advanced at READ time only.** Writing your own post id after sending skips anything that arrived while you were composing — permanently, and invisibly, because a poll that skipped real messages prints the same nothing as a quiet queue. The `sender != $IDENTITY` filter already keeps your own post from re-surfacing, so the marker never needs to cover it.
- **No `$0`/positional fields in skill bash** — the preprocessor rewrites them.
- **Shared location is `/tmp`,** not `$TMPDIR`.
- **Cleanup.** `rm -f /tmp/crosstalk-<queue>.*` removes the queue and all state (`.seen`, `.loop`, `.id`, `.counter`, `.role`/orchestrator, `.board.md`, drafts). Only when the user asks.
