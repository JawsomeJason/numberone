# numberone architecture

Status: design, awaiting review. Nothing here is implemented yet.

numberone is a Claude Code plugin that runs a routine to its end and calls you only for decisions. The name is the first officer's: it runs the ship's routine and calls the captain to the bridge when a call is the captain's to make. You start a **flow** (`/numberone run pr-to-done 1234`), numberone waits on GitHub, the issue tracker and chat at no model cost, does every step the playbook allows, hands narrow judgment to the smallest model that can make it, and wakes your session only when it needs you.

It grew out of one real run: a library fix released, bumped into a consumer app, stacked with two related PRs, reviewed, QA'd and merged, watched end to end by shell watchers. That run is the evidence behind every core atom below, and its exceptions table is the evidence behind the runner's exception model.

Contents:

1. [Principles](#1-principles)
2. [Data shapes](#2-data-shapes)
3. [Runner](#3-runner)
4. [File layout](#4-file-layout)
5. [Atoms](#5-atoms)
6. [Flows](#6-flows)
7. [Packs](#7-packs)
8. [Commands](#8-commands)
9. [doctor](#9-doctor)
10. [Lints](#10-lints)
11. [Replay judge and release tests](#11-replay-judge-and-release-tests)
12. [Open questions](#12-open-questions)

## 1. Principles

- **Core is shareable.** The plugin names no organization, person, channel, repository or skill. Org specifics live in **packs**. Facts about one user live in **one memory file**. A leak lint keeps core clean.
- **Atoms.** One trigger, one outcome, one folder. An atom never names a skill; it describes the capability it needs in plain words.
- **Flows** chain atoms as a statechart, bind their params, and hold only the exceptions that span atoms.
- **One home per instruction.** Shared prose and code live once in `lib/`. A duplicate lint enforces it.
- **Waiting is free.** Watchers are code. A model runs only when an atom exits `needs-model`, and then the smallest one that fits.
- **Andon.** Only a `needs-jason` exit wakes the main session; everything else is appended quietly. (The exit's name in a shared plugin is Q17; the config calls the person `captain`.)
- **Durable.** Every run is an append-only event log. Stages are idempotent. Resume is replay.
- **Grants, never inference.** Anything beyond the playbook needs an explicit grant the captain approves in clear words. A grant is never widened; a wider need asks for a new one.
- **Cheapest reliable layer.** `code`, then `jev` (typed judgment), then `haiku`, then `llm`. The layer is declared and linted.

Borrowed ideas, named so reviewers can check the fit: aviation normal vs non-normal checklists (happy path vs exceptions), Temporal durable execution (timers, signals, idempotent activities, replay), statecharts and XState (guards, parallel regions, model checking), SRE toil budgets (a token budget per atom), and the Toyota andon cord (stop the line on `needs-jason`).

## 2. Data shapes

Every shape has a JSON Schema in `schemas/` with a version in its `$id`. TypeScript types in `engine/types.ts` are generated from those schemas, never written by hand.

### 2.1 Install config (`numberone/v1`)

One plugin-named memory file in the harness's user-level memory holds everything about the user. The file is Markdown so the harness and the user can both read it; the machine part is one fenced YAML block that starts with `schema: numberone/v1`. Prose outside the block is free notes and is never parsed. `setup` writes the file; `doctor` validates and repairs it. In Claude Code it lives at `~/.claude/rules/numberone.md`, a user-level rules file that loads in every project (see Q1).

```yaml
schema: numberone/v1
captain:                       # the person numberone works for
  name: Ada Example
  chat: { id: U000ADA, self_dm: D000SELF }
  forge: { login: ada-example, auth: "secret:gh-work" }
forge:
  kind: github
  accounts:                    # which login reads which owner
    - { owner: "*", login: ada-example }
tracker:
  kind: jira
  transport: cli               # cli | rest | mcp
  site: example.atlassian.net
  status_map:                  # flow stage -> tracker status; order is forward-only
    order: [ready, in_progress, review, qa, done]
    side: [blocked]            # side states: may enter and leave, never count as backward
    names: { ready: "Next Up", in_progress: "In Progress", review: "In Review",
             qa: "In QA", done: "Done", blocked: "Blocked" }
chat:
  kind: slack
  workspace: T000EXAMPLE
  read: token                  # token | haiku-mcp   (see Q2)
  drafts_canvas: F000CANVAS
channels:                      # roles, not names; flows refer to roles
  review: { id: C000REVIEW, label: "#team-review" }
people:
  qa-lead:
    chat: { id: U000QA }
    roles: [qa]
    prefs: { dm: allow }
  some-peer:
    chat: { id: U000PEER }
    prefs: { dm: avoid }       # asked not to get automated DMs
qa_contact: qa-lead            # key into people
dm_allowlist: [qa-lead]        # automated DMs go only here; everyone else gets a draft
send_rules:                    # first match wins; anything unmatched goes to the canvas
  - { where: "channel:review", kinds: [review-ping, pr-update, thread-reply], mode: direct }
  - { where: "dm:qa_contact", when: [captain-absent, checked-fact], mode: direct }
  - { kinds: [decides-for-captain, speaks-for-captain], mode: canvas }
  - { default: canvas }
secrets:                       # references only, never values
  gh-work: "cmd:gh auth token --user ada-example"
  slack-user: "op://Private/slack-user-token/credential"
judge:
  backend: jev                 # jev | haiku
  model: jev-latest
capabilities:
  guidance:                    # explicit user guidance, highest precedence
    resolve-review-threads: "skill:acme:pr-fix"
  cache:                       # written by resolution, re-validated by doctor
    open-pull-request:
      resolved: "skill:git-tools:pr"
      by: jev                  # guidance | jev | haiku | fallback
      confidence: 0.93
      at: 2026-10-22T18:00:00Z
      skill_hash: 9f2c…        # hash of the skill description it matched
budgets:
  daily_usd: 2.00
packs:
  - "plugin:acme-numberone-pack"
```

Rules:

- **Secrets are references** (`env:NAME`, `cmd:<argv>`, `op://…`, `keychain:<item>`). The config validator rejects anything that looks like a token value.
- **Roles over names.** Flows say `channels.review` and `qa_contact`, never a channel or a person. That is what keeps flows shareable.
- **People prefs are honored by the policy layer**, not by each atom. `prefs.dm: avoid` turns any DM to that person into a canvas draft.
- **Migrations.** A future `numberone/v2` ships a pure `migrate(v1) -> v2` in `engine/config/migrate.ts`; `doctor --fix` runs it and keeps the old block as a comment until the next clean doctor.

### 2.2 Atom frontmatter (`numberone-atom/v1`)

`atoms/<id>/ATOM.md` starts with YAML frontmatter. The body is the brief the runner hands to a model on `needs-model`; code-only atoms may leave it empty.

```yaml
---
atom: pr-mergeable
schema: numberone-atom/v1
summary: Waits until a PR is approved, green and has no unresolved threads.
trigger: "the PR is approved, every required check passes, and no review thread is open"
outcome: "the flow learns the PR can merge"
layer: code                     # code | jev | haiku | llm
status: proven                  # proven | unexercised | experimental
params:                         # JSON Schema; defaults may read config with $config
  type: object
  required: [pr]
  properties:
    pr:   { $ref: "numberone:pr-ref" }
    poll: { type: string, default: "60s" }
exits:
  done:
    outputs:
      type: object
      properties: { head_sha: { type: string }, approvers: { type: array, items: { type: string } } }
  needs-model:
    agent: { model: haiku, effort: low }   # smallest agent that can handle it
    reason: "a thread's state cannot be read from the API"
  needs-jason:
    reason: "the PR has a blocking review from a human"
  timeout: {}
budget:
  per_call: { tokens: 0, usd: 0 }
  per_run:  { tokens: 20000, usd: 0.10 }
  wall: 72h
capabilities: []                # see 2.2.1
needs_grants: []                # action verbs beyond the playbook, see 2.5
uses: [lib/sh/forge.sh, lib/prose/review-etiquette.md]
---
```

Required: `atom`, `schema`, `summary`, exactly one `trigger`, exactly one `outcome`, `layer`, `status`, `params`, `exits`, `budget`. Every atom has a `done` exit. `needs-model` and `needs-jason` exits must give a `reason`.

#### 2.2.1 Capabilities

An atom that needs a skill describes the skill, never names it:

```yaml
capabilities:
  - id: resolve-review-threads
    need: "resolves pull request review threads and fixes failing checks, then pushes"
    fallback: lib/prose/fallback-resolve-review.md   # built-in instructions if nothing matches
```

Resolution, first hit wins, and the result is cached in `capabilities.cache`:

1. **Explicit guidance**, from this session (a `guidance` event in the run log), then from the config's `capabilities.guidance`.
2. **An installed skill whose description matches.** The judge adapter asks one Choice question: the capability's `need` is the state, the options are every installed skill's description plus `none`. The top option wins when its probability clears the threshold tuned for this question (start at 0.8; tune on real cases).
3. **The atom's fallback**, a `lib/` fragment of plain instructions.

The cache entry stores the matched skill's description hash. `doctor` re-resolves any entry whose skill is gone or whose description changed.

### 2.3 Atom scripts

| File | Contract |
| --- | --- |
| `wait.sh` | **One probe**, not a loop. Reads params JSON on stdin and the atom's watch state from `$NUMBERONE_STATE`. Prints one JSON line. Exit 0 = trigger met (the line is the exit record), 1 = pending (the line may carry a new baseline), any other = error. The runner owns the schedule. |
| `act.sh` | Performs the outcome. Reads params JSON on stdin. Must be idempotent: it checks the world before acting (merging an already-merged PR is `done`). Prints one exit record. |
| `judge.json` | Optional. The typed questions a `jev` or `haiku` layer atom asks, so the question text lives in data, not in code. |

Exit record, printed by both scripts:

```json
{ "exit": "done", "outputs": { "head_sha": "abc123" }, "baseline": null, "note": "approved by 1, 4/4 checks green" }
```

Putting the loop in the runner gives one place for schedules, dedupe, watermarks and transient-state suppression, and lets the in-process host call the same probe on its clock tick.

### 2.4 Flow format (`numberone-flow/v1`)

`flows/<id>.flow.yaml`. A flow is a statechart: states run an atom or a nested flow, `on` maps exits to targets, `standing` lists parallel regions that run while the state is active, and `exceptions` holds only what spans atoms.

```yaml
flow: pr-to-done
schema: numberone-flow/v1
summary: One PR from ready to merged, with its ticket moved along.
params:
  type: object
  required: [pr]
  properties:
    pr:     { $ref: "numberone:pr-ref" }
    ticket: { type: string }
allows:                          # the playbook: verbs this flow may use without a grant
  - forge.react
  - forge.reply
  - forge.resolve-thread
  - forge.push-own
  - tracker.transition-forward
  - chat.post: { where: "channel:review" }
initial: ready
states:
  ready:
    atom: pr-ready
    with: { pr: $args.pr }
    entry: [{ atom: transition-ticket, with: { ticket: $args.ticket, to: review } }]
    on: { done: review }
  review:
    standing: [review-loop]      # nested flow running as a parallel region
    atom: pr-mergeable
    with: { pr: $args.pr }
    on: { done: merge }
  merge:
    atom: merge-pr
    with: { pr: $args.pr, head_sha: $out.review.head_sha }
    on: { done: done }
  done:
    type: final
    entry: [{ atom: transition-done, with: { ticket: $args.ticket, prs: [$args.pr] } }]
exceptions:
  - id: approval-dismissed
    when: { event: forge.review_decision, from: APPROVED, to: REVIEW_REQUIRED }
    do: { atom: re-request-review, with: { pr: $args.pr } }
    resume: same                 # same | <state id> | history
  - id: stall
    when: { idle: 24h }
    do: { atom: stall-report }
    resume: same
```

Bindings are a closed grammar, not code: `$args.<path>`, `$config.<path>`, `$out.<state>.<field>`, `$run.<field>`, and literals. The loader type-checks every binding against the target param schema and the source exit's output schema, at load and again at run time.

### 2.5 Grant record

```yaml
id: g-7f3a                       # stable, short
schema: numberone-grant/v1
title: "Grant: post review pings and merge the 3-PR stack for ticket ABC-50"
wording: >                       # the exact sentence the captain approved, verbatim
  Until ABC-50 is Done, numberone may post review pings in #team-review and reply
  in their threads, and merge the stack as one once every layer is approved and green.
covers: { runs: [r-20261022-1614], prs: ["acme/app#101", "acme/app#102"], people: [], tickets: [ABC-50] }
actions:
  - { verb: chat.post, where: "channel:review" }
  - { verb: forge.merge-stack, prs: ["acme/app#101", "acme/app#102"],
      when: "every layer approved, green, mergeable" }
expires: { on: "tracker:ABC-50 status=done" }   # or { at: <iso> } or { on: run-end } (default)
status: pending                  # pending | approved | denied | revoked | expired
asked_at: 2026-10-22T18:10:00Z
decided: { by: captain, at: 2026-10-22T18:20:00Z, via: chat }
supersedes: null                 # a new, wider grant may supersede; nothing edits an approved one
```

Grant events are appended to the run log; the current set of grants is a fold over those events, not a mutable file. The policy check (`engine/policy.ts`) allows an action when the flow's `allows` covers it or an approved, unexpired grant covers it exactly. Anything else becomes a canvas draft or a `needs-jason` exit. An approved grant's `actions` and `covers` never change: to widen, numberone asks for a new grant with `supersedes`.

### 2.6 Canvas draft record

```yaml
id: d-1c9e
schema: numberone-draft/v1
to: { kind: dm | channel | thread, ref: "D000QA" | "C000REVIEW" | "C000REVIEW/1792690039.879519", label: "QA lead · DM" }
body: |                          # rich text; becomes ONE callout on the canvas
  Both PRs are approved. Merge order: #101, then #102 …
meta: { why: "speaks for the captain", added: 2026-10-22T18:30:00Z, flow: pr-to-done, run: r-…, stage: qa }
send_box: false                  # "send it for me"; only a checked box authorizes the send
state: drafted                   # drafted | sending | sent | removed
section_id: "temp:C:…"           # canvas section of the callout, for one-edit replace/delete
```

Canvas layout per draft: a `##` heading (recipient · place), the "send it for me" checkbox, the whole draft in **one callout** (mentions, lists, links and code all fit, and one section means one edit to replace or delete), then the meta in a blockquote under it. Never put the draft itself in a blockquote; it breaks copy and paste.

Send path: the watcher sees a checked box, re-reads the canvas, takes the callout's current text (the captain's edits included), searches the target for the captain's own matching message (already sent by hand: just remove), otherwise posts to exactly that target, deletes the section and logs `draft.send`. A replaced draft starts unchecked. The canvas keeps no history; the run log does. Native chat drafts are never used.

### 2.7 Event log record

`runs/<run-id>/timeline.jsonl`, one JSON object per line, append-only, fsynced per write.

```ts
type Event = {
  v: 1
  seq: number                  // dense, per run, starts at 0
  at: string                   // ISO 8601
  run: RunId
  kind: EventKind
  state?: StatePath            // "review" or "release/review" for nested flows
  atom?: AtomId
  key?: string                 // idempotency key for act.* events
  data: Record<string, unknown>
  cost?: { layer: Layer; input_tokens: number; output_tokens: number; usd: number }
}

type EventKind =
  | 'run.start' | 'run.end'
  | 'state.enter' | 'state.exit'
  | 'watch.start' | 'watch.observe' | 'watch.heartbeat' | 'watermark'
  | 'exit'                     // an atom's exit record
  | 'act.start' | 'act.done'
  | 'model.spawn' | 'model.done'
  | 'wake'                     // main session woken (needs-jason)
  | 'answer'                   // the captain's answer to a wake
  | 'guidance'                 // the captain's instruction this session
  | 'exception.enter' | 'exception.resume'
  | 'grant.ask' | 'grant.decide' | 'grant.expire'
  | 'draft.add' | 'draft.replace' | 'draft.send' | 'draft.remove'
  | 'send'                     // a direct send under send_rules
  | 'error'
```

Probes that see nothing new are not logged; a `watch.heartbeat` every 10 minutes proves the watcher is alive. `watch.observe` carries the new signature and the deduped items; `watermark` advances a source's floor. `seen` sets and baselines are folds over these events, so the log alone rebuilds them.

Idempotency key: `sha256(run, state path, atom, canonical(params))`. An `act.start` with no matching `act.done` means the act was interrupted; resume runs `act.sh` again, which is safe because acts check before acting.

### 2.8 Adapter interfaces

Atoms reach the outside world only through `lib/sh/<adapter>.sh` wrappers over these interfaces. The TypeScript side lives in `adapters/`. Each interface has a fake for the replay judge.

```ts
interface Forge {                       // github first
  pr(ref: PrRef): Promise<PrSnapshot>   // state, draft, reviewDecision, mergeState (settled), checks, head
  signature(ref: PrRef): Promise<string> // stable digest: ignores bot comments, transient states
  threads(ref: PrRef): Promise<ReviewThread[]>
  react(target: CommentRef, emoji: string): Promise<void>
  reply(target: CommentRef | PrRef, body: string): Promise<CommentRef>
  resolve(thread: ThreadRef): Promise<void>
  requestReview(ref: PrRef, logins: string[]): Promise<void>
  approveGatedRuns(ref: PrRef): Promise<RunRef[]>
  merge(ref: PrRef, opts: { method: 'squash' | 'rebase' | 'merge'; expectHead: string }): Promise<MergeResult>
  stack: {
    link(base: string, prs: PrRef[]): Promise<void>
    restack(top: PrRef, opts: { leaseFrom: Record<string, string> }): Promise<void>
    merge(top: PrRef): Promise<MergeResult>
  }
  account(owner: string): Promise<Credential>  // picks the login from config.forge.accounts
}

interface Tracker {                     // jira first
  item(key: string): Promise<{ status: string; newestCommentId?: string; assignee?: string }>
  signature(key: string): Promise<string> // status + newest comment id
  transitions(key: string): Promise<{ id: string; to: string }[]> // discovered every time, never cached
  transition(key: string, toStatus: string): Promise<void>       // refuses backward moves per status_map
  comment(key: string, body: string): Promise<string>
}

interface Chat {                        // slack first
  activity(q: { where: ChatRef[]; since: Watermark; mentions?: string[] }): Promise<ChatItem[]>
  reactions(msg: MessageRef): Promise<Reaction[]>
  post(to: ChatTarget, body: RichText): Promise<MessageRef>
  canvas: {
    read(id: string): Promise<CanvasSection[]>
    upsert(id: string, draft: Draft): Promise<string>   // returns section id
    remove(id: string, sectionId: string): Promise<void>
  }
}

interface Judge {                       // jev first, haiku fallback
  choice<T extends string>(state: unknown, question: string, options: T[]): Promise<{ pick: T; p: number }>
  noul(state: unknown, claim: string): Promise<{ p: number }>
  score(state: unknown, rubric: string, levels: string[]): Promise<{ level: string; p: number[] }>
  usage(): { input_tokens: number }
}

interface ConfigStore {                 // the memory file
  read(): Promise<Config>
  write(next: Config): Promise<void>    // preserves prose outside the YAML block
  where(): string
}

interface Host {                        // where the runner lives
  now(): number
  every(ms: number, fn: () => Promise<void>): void
  run(argv: string[], o?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }): Promise<ProcResult>
  note(text: string): Promise<void>     // quiet: appended, no turn
  wake(text: string): Promise<void>     // starts a main-session turn
  spawnAgent(a: { model: string; effort: string; prompt: string; tools?: string[] }): Promise<ExitRecord>
}
```

`ChatItem` always carries the exact message `ts` from the source, so a reply never targets a guessed thread. The chat adapter applies the floor and the `seen` set in code before anything reaches a model.

## 3. Runner

### 3.1 Hosts

The engine (`engine/`) is host-agnostic TypeScript. Two hosts run it:

- **In-process host** (`hosts/mod/`), used when Claude Code mods are available. It registers on `session.start`, ticks with `$.clock.every`, probes through `$.process.run`, records quietly with `$.session.append`, and wakes a turn with `$.prompt.submit` only for `needs-jason` and only when no turn is running; during a turn it appends instead. This is the pattern of an existing PR-feed mod: poll, append quietly, wake only when urgent.
- **Background host** (`hosts/background/`), the fallback. `bin/numberone watch <run>` is a long-lived process the session starts as a background task. It exits, with a short report on stdout, only on `needs-jason`; the session's background-task notification is the wake. A fresh `watch` resumes from the log.

Both hosts spawn `needs-model` agents headless (`claude -p --model <m>`), so model work never needs the main session.

### 3.2 Loop

```
state = replay(timeline)                     # config hash, active states, regions, watermarks,
                                             # seen sets, grants, pending acts, budgets
loop on host tick:
  for region in state.active (main path, standing regions, open exceptions):
    if region.pending_act:                   # act.start without act.done
      run act.sh again                       # idempotent by contract
    elif region.probe_due(now):
      rec = run wait.sh --once               # code: every poll; haiku/jev: their own slower poll
      if rec.exit == pending: update baseline if changed; continue
      append exit
      handle(rec)
  for each exception guard over new observations: enter exception, run its atom, resume per rule
  check stall timers and budgets

handle(rec):
  done        -> statechart.transition(exit) -> enter target -> bind -> validate -> policy -> act
  needs-model -> pick the smallest agent the exit allows within budget
                 -> spawn headless with the atom body, resolved capability and bound params
                 -> its exit record re-enters handle()
                 -> one escalation tier on failure, then needs-jason
  needs-jason -> append wake; host.wake(report); region waits for an `answer` event
  timeout     -> exit edge if the flow maps it, else stall-report
  error       -> retry with backoff (3x), then needs-jason   (andon)
```

### 3.3 Guarantees

- **Waiting costs no model tokens.** `code` probes run shell only. The one exception is a chat source read through a headless Haiku (when no user token exists); it is budgeted, logged with cost, and doctor reports it (Q2).
- **Code-side dedupe.** Every source keeps a `seen` set of item ids (chat `ts` compared on whole seconds) and a time floor. An item older than the floor is dropped; an item whose time cannot be parsed passes through rather than being lost.
- **Transient states are not changes.** The forge signature maps `mergeStateStatus: UNKNOWN` to the last settled value; only the state it settles into counts.
- **Bot noise is not news.** Bot comments do not count toward the comment signature; a green bot report never wakes. Only a failing check or a human comment does.
- **The QA contact always counts.** Every non-banter message from `qa_contact` in a watched conversation is news, whatever ticket it names.
- **The captain's own messages never wake.** Acks (a checkmark, a salute, "lgtm") are recorded as seen, not acted on.
- **Every thread in a watched conversation is watched**, not only threads on messages numberone sent.
- **Stack writes are serialized.** Fixers on one stack run lower layer first; upper layers wait. One writer per branch is a runner invariant, not a convention.

### 3.4 Resume

`/numberone resume <run>` replays `timeline.jsonl` into state, re-validates the flow and config against the hashes in `run.start`, re-reads every source once to rebuild baselines, and continues. A changed flow or config is shown as a diff and needs a `needs-jason` confirmation before the run continues.

### 3.5 Run state on disk

```
$NUMBERONE_HOME/runs/<run-id>/       # default ~/.local/state/numberone (Q11)
  run.json                           # flow id, args, bound params, plugin version (immutable)
  timeline.jsonl                     # the log, the only source of truth
  host.pid  host.json                # which host owns the run, heartbeat
  scratch/                           # atom scratch; safe to delete, rebuilt by replay
```

## 4. File layout

```
numberone/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json            # the repo is its own marketplace
├── README.md  ARCHITECTURE.md  LICENSE
├── skills/numberone/SKILL.md       # /numberone entry: parses the subcommand, calls bin/numberone
├── agents/                         # needs-model workers, smallest first
│   ├── worker-haiku.md
│   └── worker-sonnet.md
├── hooks/
│   ├── hooks.json                  # registers the in-process host module
│   └── register.ts
├── bin/numberone                   # CLI: run, status, resume, doctor, list, setup, watch
├── engine/                         # host-agnostic runner
│   ├── types.ts                    # generated from schemas/
│   ├── runner.ts  statechart.ts  bind.ts  policy.ts  log.ts  replay.ts
│   ├── capabilities.ts             # resolution + cache
│   └── config/ load.ts migrate.ts
├── hosts/
│   ├── mod/host.ts
│   └── background/host.ts
├── adapters/
│   ├── forge/github.ts
│   ├── tracker/jira.ts
│   ├── chat/slack.ts
│   ├── judge/jev.ts  judge/haiku.ts
│   └── config/claude-code.ts
├── schemas/                        # JSON Schema, versioned $id
│   ├── config.v1.json  atom.v1.json  flow.v1.json
│   ├── event.v1.json  grant.v1.json  draft.v1.json  pack.v1.json
├── atoms/<id>/                     # ATOM.md, wait.sh, act.sh, optional judge.json
├── flows/<id>.flow.yaml
├── lib/
│   ├── sh/                         # shared shell: adapters, watermark, seen-set, worktree
│   └── prose/                      # shared instructions, included by atoms
├── doctor/
│   ├── lint/  env/  live/
├── judge/                          # the replay judge
│   ├── harness.ts
│   ├── fakes/                      # fake Forge, Tracker, Chat, Judge, Host
│   └── fixtures/                   # synthetic timelines only; real ones live in packs
├── packs/example/                  # a minimal pack, the template for new packs
└── tests/fresh-install.sh
```

## 5. Atoms

Core atoms. **Proven** means the first real run exercised the behaviour, through watchers and hand steps, though not yet as an atom. The four marked **unexercised** never ran.

### Forge

| Atom | Trigger | Outcome | Layer | Status |
| --- | --- | --- | --- | --- |
| `pr-ready` | PR leaves draft | stage advances | code | proven |
| `pr-mergeable` | approved, required checks green, no open thread | stage advances with head sha | code | proven |
| `review-comment` | a new human review comment or suggestion | eyes reaction, then a fix and push or a reply; thread resolved unless the reviewer must answer | llm (capability: resolve review threads) | proven |
| `failing-check` | a required check fails | fix pushed, or a diagnosis reported | llm (capability: fix failing checks) | proven |
| `approve-gated-runs` | workflow runs await approval on an allowed PR | runs approved | code | proven |
| `re-request-review` | an approval was dismissed by a push | the same reviewer re-requested, and mentioned in the original ping's thread with the reason | code | proven |
| `merge-pr` | stage entered with a mergeable PR | PR merged at the expected head | code | proven |
| `stack-link` | the work spans several dependent PRs | one native stack | code | proven |
| `restack` | a lower layer's head moved | upper layers rebased, force-pushed with lease (own branches only) | code | proven |
| `rebase-onto-trunk` | a stack layer reads conflicting against trunk | whole stack rebased; dismissed approvals re-requested | llm (capability: rebase a stack and resolve conflicts) | proven |
| `lower-layer-draft` | a layer below is still a draft | the captain asked to mark it ready | code, exits needs-jason | proven |
| `merge-stack` | every layer approved, green, mergeable, and the flow's gate passed | the stack merged as one | code | **unexercised** |
| `rebase-dependents` | a merge landed that open PRs depend on | each dependent PR rebased onto trunk | llm (capability: rebase) | **unexercised** |

### Tracker

| Atom | Trigger | Outcome | Layer | Status |
| --- | --- | --- | --- | --- |
| `transition-ticket` | a stage whose status_map entry is ahead of the ticket | ticket at that status (forward or a side state only) | code | proven |
| `follow-ticket` | someone else moved the ticket | the flow jumps to the matching stage, never backward | code | proven |
| `transition-done` | every PR linked to the ticket is merged | ticket Done | code | **unexercised** |

### Chat and QA

| Atom | Trigger | Outcome | Layer | Status |
| --- | --- | --- | --- | --- |
| `review-ping` | PRs need review | one top-level post for the set; later asks are new posts | code | proven |
| `chat-news` | a reply, reaction or mention in a watched conversation | relevant, unseen items emitted; banter and acks marked seen | jev or haiku | proven |
| `answer-in-thread` | a question about the work, anywhere | an answer where it was asked, at that message's exact ts | llm | proven |
| `qa-ready-check` | the work enters QA | QA steps, affected areas and merge order confirmed, or gaps listed | haiku | proven |
| `dm-qa` | QA-ready check passed | a short DM to the QA contact: the PRs, and why they need extra care when they do | code | proven |
| `qa-verdict` | QA reports in chat, a ticket comment or a PR | pass, fail with details, or a question | jev | **unexercised** |

### Captain

| Atom | Trigger | Outcome | Layer | Status |
| --- | --- | --- | --- | --- |
| `ask-grant` | an action outside the playbook and every grant | a grant record asked for, worded for the captain | code, exits needs-jason | proven |
| `draft-to-canvas` | a message the send rules route to the canvas | one callout section on the drafts canvas | code | proven |
| `send-checked-draft` | a draft's "send it for me" box is checked | the current text sent to exactly its target, section removed | code | proven |
| `stall-report` | no progress past the stage's timeout | what the stage waits on and who | code | proven |

Behaviours that are not atoms, each with one home:

- Bot-noise filtering, transient-state suppression, dedupe and the time floor live in the adapters and `lib/sh/`.
- "Use a locked worktree when the lock belongs to the editor and the tree is clean" lives in `lib/sh/worktree.sh`, used by every atom that needs a checkout.
- Review etiquette (eyes reaction first, resolve unless the reviewer must answer) lives in `lib/prose/review-etiquette.md`.
- Ping hygiene (one post per PR set, never reuse an old thread for a new ask) lives in `lib/prose/ping-hygiene.md`.

## 6. Flows

Core flows, all built from core atoms:

- `review-loop`: a standing region. `review-comment`, `failing-check`, `approve-gated-runs` and `re-request-review` on every PR the parent watches.
- `pr-to-done`: one PR, ready to merged, ticket moved along (the example in 2.4).
- `stack-to-done`: several dependent PRs: `stack-link`, a nested `review-loop` per layer, `qa-ready-check`, `dm-qa`, `qa-verdict`, `merge-stack`, `rebase-dependents`, `transition-done`.

Exceptions that belong to a flow, not an atom (from the first run's exceptions table): approval dismissed, parallel fixers colliding on a stack, a lower layer moved, a stack conflicting with trunk, a concern raised outside the ping thread, QA failing (restart at the owning stage), the ticket waiting on other merges (side state Blocked), the ticket moved by someone else, and stall.

## 7. Packs

A pack adds atoms, flows and `lib/` fragments for one organization. Core never references a pack; a pack may reference core.

```
<pack>/
├── numberone-pack.json
├── atoms/<id>/…
├── flows/<id>.flow.yaml
├── lib/
├── config.schema.json          # keys the pack adds under packs.<name> in the config
└── fixtures/                   # real, scrubbed-or-private timelines for the replay judge
```

```json
{
  "schema": "numberone-pack/v1",
  "name": "acme",
  "version": "0.1.0",
  "core": ">=0.1 <0.2",
  "private": true,
  "summary": "Acme's library release and consumer bump flow"
}
```

- **Namespacing.** Pack ids are `<pack>/<id>` (`acme/merge-release`). A pack may not shadow a core id.
- **Delivery.** A pack is any installed plugin that contains `numberone-pack.json` at its root, or a local path listed in `config.packs`. A private pack stays in a private repo or plugin.
- **Leak policy.** `private: true` turns off the leak lint for that pack and makes `doctor` refuse to copy its fixtures into core.
- **The first private pack** holds the library-release atoms (watch for the release PR to contain the change, approve it and its gated runs, merge it, confirm the registry serves the version, open the consumer bump, check the release for other PRs' breaking changes, check whether the consumer's trunk uses the fixed code yet, accept expected visual diffs) and the flow that nests `pr-to-done` for the library and `stack-to-done` for the consumer.

## 8. Commands

`/numberone <subcommand>`:

| Subcommand | Does |
| --- | --- |
| `run <flow> <args>` | Validate, bind, write `run.start`, start or attach a host. |
| `status [run]` | Each live run: flow, current state per region, what it waits on, last news, cost so far vs budget, active grants, canvas drafts. |
| `resume <run>` | Replay and continue (3.4). |
| `doctor [--fix]` | Section 9. |
| `list` | Installed flows and atoms, core and pack, with status and layer. |
| `setup` | Interview that writes the config file; reruns are edits. (Not in the agreed five; see Q14.) |

The skill only parses and calls `bin/numberone`; every subcommand is code. Rendering the result is the only model work.

## 9. doctor

`doctor` reports in four sections, exit code nonzero on any error. `--fix` repairs what it safely can and lists what it did.

**Lint** (section 10), over core, every installed pack and every flow.

**Environment**

- The config file exists, parses and validates against `numberone/v1`; every secret reference resolves (value never printed).
- Forge: each `forge.accounts` login has a working token (`gh auth token --user <login>`), and the gh stack extension is installed when any flow uses stack atoms.
- Tracker: the transport is authenticated and can read one item.
- Chat: one read of the self-DM; for `read: haiku-mcp`, a headless Haiku smoke test that loads the chat tools and returns one message, with its cost.
- Judge: the backend answers one Choice question.
- Capability cache: every entry's skill is installed and its description hash matches; `--fix` re-resolves.

**Live runs**

- Each run's host heartbeat is recent; `--fix` restarts a dead watcher from the log.
- Stale baselines: a baseline older than its source's latest change.
- Orphans: run directories with no host and no `run.end`, and hosts with no run.
- Watermarks: any source whose watermark lags now by more than its poll interval times three.
- Grants: active ones listed; expired ones marked expired in the log.

**Budgets**

- Per atom: actual tokens and dollars from `cost` fields vs `budget`, per call and per run; atoms over budget flagged.
- Per day: total vs `budgets.daily_usd`.

## 10. Lints

| Lint | Checks | How |
| --- | --- | --- |
| Atomicity | one `trigger`, one `outcome`; `act.sh` calls mutating adapter verbs of one kind only | frontmatter schema; static scan of `lib/sh` verb calls |
| References | every `uses`, `fallback`, atom, flow and nested flow exists; every exit a flow maps is declared | resolver over all ids |
| Cost layers | `code` atoms never invoke a model (`claude`, the judge); `jev` atoms invoke only the judge; declared layer matches the cheapest call actually made | static scan of scripts |
| Duplicates | no instruction lives in two places | code: 5-token shingles, Jaccard ≥ 0.5 across atoms and lib; prose: candidate pairs from shingles at a lower bar, then the judge's Noul ("these two passages give the same instruction") confirms |
| Params | schemas valid; defaults that read `$config` point at real keys; every binding type-checks against its source output | JSON Schema compile + binding checker |
| Statechart | every state reachable; every non-final state has an exit path to a final state; every declared exit handled or deliberately unhandled; every `resume` target exists | graph search over the composed statechart, nested flows inlined |
| Budget | every atom declares a budget; `code` atoms declare zero model tokens | schema |
| Leak (core only) | no org, person, channel, repo or skill names | patterns (chat ids, ticket keys, `owner/repo`, `plugin:skill`, emails) plus a denylist built from the local config's names and ids |

## 11. Replay judge and release tests

**Replay judge** (`judge/harness.ts`). Feeds a recorded `timeline.jsonl` through the flows with fake adapters. The fakes serve each source's `watch.observe` events in order as if they were live, and record every action the runner takes. A replay passes when:

- the sequence of `state.enter` and `exit` events matches the recording (or a golden file, for a changed flow);
- every action the runner takes is allowed by the flow's `allows` plus the grants in force at that point;
- no `wake` happens that the recording did not have, and none is missing;
- cost stays inside each atom's budget.

Core ships only synthetic fixtures. A pack ships its own real ones; the first real run becomes the private pack's first fixture.

**Fresh-install test** (`tests/fresh-install.sh`). Creates an empty `HOME` in a temp directory, installs the plugin from the working tree, runs `setup` from an answers file, then `doctor` (must pass with only the expected "not authenticated" warnings) and a synthetic replay. Catches anything that reads the author's own files.

**Leak lint** runs in CI on every push, over core only.

## 12. Open questions

- **Q1. Where does the config file live? Settled:** `~/.claude/rules/numberone.md`. Claude Code has two user-level instruction files that load in every project, `~/.claude/CLAUDE.md` and `~/.claude/rules/*.md` ([memory docs](https://code.claude.com/docs/en/memory.md), "User-level rules"). Auto memory is per project (`~/.claude/projects/<project>/memory/`), relocatable only globally with `autoMemoryDirectory`, so it is the wrong home. A plugin cannot ship a file that loads at user scope (its root `CLAUDE.md` is not loaded), so `setup` writes the rules file with the user's permission. The file loads into every session, so it holds only the YAML config and stays small; `doctor` enforces a size cap. Bulky or churny data (cached skill resolutions, run state) lives in the plugin data dir and is read by path.
- **Q2. Chat reads: user token or headless Haiku?** A user token with search scope reads at zero model cost and keeps "waiting is free" literally true. The Haiku-through-MCP path needs no token but cost about $0.02 per check. Default to token when present, Haiku otherwise?
- **Q3. "Judge" names three things**: the judge adapter (typed judgments), `judge.json` (an atom's questions), and the replay judge (tests). Rename the harness to `replay` and keep `judge` for the adapter?
- **Q4. Is Jev required?** Shareable users may not have TypeSafe. Proposal: Jev is the default judge backend, Haiku the fallback, and both must pass the same judge fixtures. Capability resolution and the duplicate lint then work for everyone.
- **Q5. Runtime for the engine.** Mods are TypeScript in-process; the background host needs a runtime too. Node 22 with type stripping, Bun, or a build step that ships JS?
- **Q6. `/numberone` as a skill or a mod command?** A mod command runs code-only subcommands (`status`, `list`) with no model turn, but only where mods exist; a skill works everywhere. Ship both with the mod overriding when present, or pick one?
- **Q7. Spawning `needs-model` agents.** Headless `claude -p` works in both hosts. Is there a mod API for an in-process subagent that would share the session's tools and auth?
- **Q8. Grant approval surface.** The first run used a sidebar ask. Core cannot depend on a personal sidebar. Proposal: the `needs-jason` wake carries the grant's exact wording and the captain answers in chat; a host may offer a richer surface.
- **Q9. Canvas outside Slack.** The drafts canvas is a Slack feature. For another chat adapter: a local Markdown file, or no drafts surface (everything waits on `needs-jason`)?
- **Q10. Native-draft fallback.** The first run's fallback for a blocked native draft was the self-DM. With native drafts banned outright, is the self-DM still wanted as the canvas-unavailable fallback?
- **Q11. Where run state lives.** `~/.local/state/numberone` (XDG) or under `~/.claude/`? It must survive restarts, so not a temp directory.
- **Q12. Pack delivery and versioning.** A plugin per pack, a path in config, or both? How strict is the `core` range?
- **Q13. Stack merge default.** The first run merged a stack as one through the merge queue at the captain's request; layer by layer keeps upper approvals in some repos. Which is core's default, and is it a flow param?
- **Q14. `setup` as a sixth subcommand.** The agreed list has five; `setup` is required to write the config. Add it, or fold it into `doctor --fix`?
- **Q15. Two runs on one PR.** Share one watcher and one `seen` set per source across runs, or keep runs fully separate and accept double polling?
- **Q16. Grant expiry grammar.** `on: "tracker:ABC-50 status=done"` needs a small condition grammar. Reuse the flow binding grammar plus one comparison, or limit expiry to run end and a time?
- **Q17. The captain's name.** The config key is `captain`; the exit is `needs-jason` as agreed. In a shared plugin, should the exit be `needs-captain`, with the user's name only in their config?
- **Q18. Budgets in tokens or dollars?** Jev reports input tokens; Claude reports both. One unit for lint and doctor, or both?
- **Q19. Leak lint in CI.** The denylist built from a local config does not exist in CI. Patterns only in CI, full denylist locally before push (a pre-push hook)?
- **Q20. Hand-off between hosts.** If a run starts in the background host and a mod-capable session opens, should the mod host take over the run, and how do two hosts agree on ownership (the `host.pid` lease)?
