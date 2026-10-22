# numberone build plan

Scope: the core engine plus the 22 atoms marked **proven** in ARCHITECTURE.md section 5, three core flows, six commands, the lints, the replay judge and the fresh-install test.

Out of scope until the live run finishes: `merge-stack`, `rebase-dependents`, `qa-verdict`, `transition-done`, the stack-merge default (Q13), and any private org pack. Their scaffold stubs stay where they are with `status: unexercised`; task 54 keeps flows from using them.

Also deferred: the in-process mod host and the model-free mod `status` and `list` (Q6, Q20), the tracker's `mcp` transport, and any `numberone/v2` migration (`migrate.ts` stays the identity function).

## Conventions

- **Runtime.** Node 22.18 or later, which strips types by default. Write erasable TypeScript only, with no `enum`, `namespace` or parameter properties. There is no build step, and `bin/numberone` runs `node engine/cli.ts`.
- **Dependencies.** Plugin installs never run `npm install`, so all runtime code ships in the tree.
  - `typescript` is the one dev dependency. It runs `tsc --noEmit --erasableSyntaxOnly` and nothing imports it at runtime (task 1).
  - `yaml` is the one vendored runtime library (task 3). Config, atom frontmatter and flows are all YAML, and a correct YAML parser is not a small job.
  - JSON Schema validation and type generation are written in-house for the subset our schemas use (task 2). Ajv would have to be vendored, and it is far larger than that subset.
  - A task that wants anything else must justify it in its PR.
- **Tests.** `npm test` runs `node --test "**/*.test.ts"`. Engine tests live in `tests/`. Atom, lint and replay tests sit next to their code, so tasks that run in parallel never share a test file.
- **Done.** Each task is one PR. Its PR is done when `npm test`, `npm run typecheck`, and the task's own check all pass.
- **Fixtures** are synthetic, with org `acme`, people `ada-example` and `qa-example`, and made-up ids. No real org, person, channel or ticket names appear anywhere.
- **Size.** S means under about 150 lines. M means about 150 to 400 lines. L means more than that, or that the task needs a design review before code.
- **Group.** Tasks that share a group letter touch disjoint files and can run in parallel once their "after" tasks have merged. Within a group, the "after" column overrides the group.

## Wave A: groundwork

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Reconcile ARCHITECTURE.md with the section 12 decisions. See "Contradictions" at the end of this plan. | `ARCHITECTURE.md` | `grep -nE 'haiku-mcp\|read: token\|judge/harness\|grants file\|status=done' ARCHITECTURE.md` finds nothing | S | A | none |
| 1 | Tooling, plus subtract before adding. Add `package.json` (`type: module`, `engines`, `test` and `typecheck` scripts), `tsconfig.json` (noEmit, erasableSyntaxOnly, excluding `hooks/` and `hosts/mod/`), and `.node-version`. Rename `judge/` to `replay/` (Q3) and `engine/replay.ts` to `engine/fold.ts`, so the word "replay" means only the test harness. | `package.json`, `tsconfig.json`, `.node-version`, `replay/**` (moved), `engine/fold.ts` (moved), `tests/smoke.test.ts` | `npm test` (the smoke test imports every engine module) and `npm run typecheck` | S | A | none |
| 2 | Schema toolkit. Write a validator for the JSON Schema 2020-12 subset we use: `type`, `required`, `properties`, `additionalProperties`, `items`, `enum`, `const`, `pattern`, `oneOf`, local `$ref` and `numberone:` ids, and applying defaults. Write `tools/gen-types.ts`, which writes one `engine/types/<schema>.gen.ts` per schema, and the `engine/types.ts` barrel that re-exports them. | `engine/schema/validate.ts`, `tools/gen-types.ts`, `engine/types.ts`, `tests/schema.test.ts` | `node --test tests/schema.test.ts`; `node tools/gen-types.ts --check` exits 0 | M | B | 1 |
| 3 | Vendor `yaml`: a pinned copy with its LICENSE, and `tools/vendor.sh`, which refetches the copy and verifies its hash. Write `engine/yaml.ts`, which parses frontmatter, a fenced block inside Markdown, and plain YAML. | `vendor/yaml/**`, `tools/vendor.sh`, `engine/yaml.ts`, `tests/yaml.test.ts` | `node --test tests/yaml.test.ts`; `tools/vendor.sh --check` | S | B | 1 |

## Wave B: data shapes

Each task writes its schema, its loader and its generated types, and runs `gen-types` only for its own schema.

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | Config `numberone/v1`. Write the schema, the Markdown fenced-block loader that keeps prose byte-for-byte, the secret-reference validator (it rejects values that look like tokens), and the `ConfigStore` for `~/.claude/rules/numberone.md` with a size cap. The config has no `chat.read` key (Q2) and no `capabilities.cache` key (Q1, Q11). | `schemas/config.v1.json`, `engine/config/load.ts`, `adapters/config/claude-code.ts`, `engine/types/config.gen.ts`, `tests/config.test.ts` | Test: a round trip keeps the prose; `ghp_…`- and `xoxp-…`-shaped values are rejected; the example config validates; the store writes only under a temp `HOME` | M | C | 2, 3 |
| 5 | Atom frontmatter `numberone-atom/v1`, plus the exit record schema (new `schemas/exit.v1.json`). The loader enforces one trigger and one outcome, a `done` exit, and a `reason` on every `needs-model` and `needs-captain` exit. | `schemas/atom.v1.json`, `schemas/exit.v1.json`, `engine/atom/load.ts`, `engine/types/atom.gen.ts`, `engine/types/exit.gen.ts`, `tests/atom.test.ts` | Test: good and bad frontmatter fixtures; every `atoms/*/ATOM.md` parses as YAML | M | C | 2, 3 |
| 6 | Flow `numberone-flow/v1`. Write the schema, the flow loader, and `engine/bind.ts`: a parser for the closed grammar (`$args`, `$config`, `$out`, `$run`, literals) that type-checks each binding against the target's param schema and the source exit's output schema. | `schemas/flow.v1.json`, `engine/flow/load.ts`, `engine/bind.ts`, `engine/types/flow.gen.ts`, `tests/bind.test.ts` | Test: a well-typed binding resolves; `$out` of an unknown state, a wrong type, and free code are each rejected | M | C | 2, 3 |
| 7 | Event, grant, draft and world-event schemas. The world-event schema has the shape the replay judge reads: `{t, source, kind, actor, bot, ref, summary, url}`. Grant expiry is one of `run-end`, `at`, or `stage` (Q16). | `schemas/{event,grant,draft,world-event}.v1.json`, `engine/types/{event,grant,draft,world-event}.gen.ts`, `tests/records.test.ts` | Test: valid and invalid examples for each schema | S | C | 2 |
| 8 | Pack `numberone-pack/v1`. Write the pack loader: `<pack>/<id>` namespacing, no shadowing of core ids, a `core: ^0.x` range check (Q12), and local path overrides. | `schemas/pack.v1.json`, `engine/pack/load.ts`, `engine/types/pack.gen.ts`, `tests/pack.test.ts` | Test: loads `packs/example`; a shadowing id and an out-of-range core are each rejected | S | C | 2, 3 |

## Wave C: event log and run state

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | `engine/log.ts`. An append-only JSONL writer that fsyncs each write and keeps `seq` dense. It computes idempotency keys as `sha256(run, state, atom, canonical(params))`. The reader tolerates a torn last line. | `engine/log.ts`, `tests/log.test.ts` | Test: concurrent appends keep `seq` dense; a file truncated mid-line reads back to the last whole event | M | D | 7 |
| 10 | `engine/fold.ts`. Folds events into run state: active states and regions, watermarks, per-run `seen` sets, grants (with expiry), pending acts (`act.start` with no `act.done`), drafts, and tokens spent. | `engine/fold.ts`, `tests/fold.test.ts` | Test: `fold(a ++ b)` equals `fold(b, fold(a))`; an interrupted act shows as pending; an expired grant drops out | M | D | 9 |
| 11 | Run directory and lease under `$XDG_STATE_HOME/numberone/runs/<id>/` (Q11). `run.json` is immutable. The `host.pid` lease uses `O_EXCL`, keeps a heartbeat, and is taken over when stale. | `engine/runs.ts`, `tests/runs.test.ts` | Test, with a temp `XDG_STATE_HOME`: a second lease fails while the heartbeat is fresh and succeeds once it is stale | S | D | 7 |
| 12 | `engine/policy.ts`. An action is allowed when the flow's `allows` covers it, or when an approved grant that has not expired covers it exactly. `send_rules` uses the first match; `prefs.dm: avoid` and `dm_allowlist` turn a send into a draft. | `engine/policy.ts`, `tests/policy.test.ts` | Table test: allowed, granted, drafted and refused cases; a superseded grant never widens | S | D | 4, 7 |

## Wave D: adapters behind interfaces, with fakes

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | Interfaces and the shell bridge. Write the TypeScript interfaces from section 2.8, `bin/adapter.ts`, and `lib/sh/{forge,tracker,chat,judge}.sh`, which call `node bin/adapter.ts <iface> <verb> <json>`. When `NUMBERONE_FAKE=<world.jsonl>` is set, the bridge routes to the fakes. | `adapters/interfaces.ts`, `bin/adapter.ts`, `lib/sh/{forge,tracker,chat,judge}.sh`, `tests/bridge.test.ts` | Test: `lib/sh/forge.sh pr '{…}'` returns the fake's snapshot | S | E | 5, 7 |
| 14 | Fakes for `Forge`, `Tracker`, `Chat`, `Judge` and `Host`. They are driven by a world timeline on a virtual clock and record every call. | `replay/fakes/*.ts`, `replay/fakes/fakes.test.ts` | Test: events surface in time order; every call is recorded; the clock advances only when told | M | E | 13 |
| 15 | GitHub forge through the `gh` CLI. The signature ignores bot comments and maps `mergeStateStatus: UNKNOWN` to the last settled value. Each owner gets its account from `forge.accounts`. `stack.link` and `stack.restack` use `gh stack`; `stack.merge` stays unimplemented. | `adapters/forge/github.ts`, `tests/forge-github.test.ts`, `tests/bin/gh` (a stub) | Test with the stub `gh` on `PATH`: UNKNOWN does not change the signature; a bot comment does not change it; a human comment does | M | E | 13 |
| 16 | Jira tracker over the REST transport, with its token from a secret reference. Transitions are discovered on every call. Backward moves under `status_map` are refused; side states are allowed. | `adapters/tracker/jira.ts`, `tests/tracker-jira.test.ts` | Test against an in-process HTTP fake: backward moves are refused, and transitions are fetched on every call | M | E | 13 |
| 17 | Slack chat through headless Haiku (Q2): `claude -p --model haiku` with a strict JSON contract that returns exact message `ts` values. The time floor and `seen` set live in code: `ts` compares on whole seconds, and an item whose time cannot be parsed passes through. Port this logic from the prototype watcher. Each read reports its token cost. | `adapters/chat/slack.ts`, `lib/sh/seen.sh`, `tests/chat-slack.test.ts`, `tests/bin/claude` (a stub) | Test with the stub `claude`: the floor drops old items, `seen` drops repeats, an unparseable `ts` passes, and the cost is recorded | M | E | 13 |
| 18 | Judge backends: `jev.ts` over the HTTP API with `fetch` (read the live docs at docs.typesafe.ai and invent no fields), and `haiku.ts` over `claude -p` with a JSON schema. Both must pass the shared judge fixtures (Q4). | `adapters/judge/{jev,haiku}.ts`, `replay/fixtures/judge/*.json`, `tests/judge.test.ts` | Test: both backends pass against fakes; the live Jev case runs only when `TYPESAFE_API_KEY` is set | M | E | 13 |
| 19 | Capability resolution. The order is: guidance events, then config guidance, then a judge Choice over the descriptions of installed skills (threshold 0.8, tunable), then the atom's fallback. The cache lives under XDG state and is keyed by a hash of the matched skill's description. | `engine/capabilities.ts`, `tests/capabilities.test.ts` | Test with a fake judge and a fake skills directory: guidance wins; a changed description invalidates its cache entry | S | E | 13 |

## Wave E: runner and background host (serial)

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | `engine/statechart.ts`, a pure transition function. It covers `on` edges, `entry` actions, `standing` regions (nested flows), final states, `exceptions` with `resume: same`, a state id, or `history`, and idle timers. | `engine/statechart.ts`, `tests/statechart.test.ts` | Test: the section 2.4 example walks from ready to done; `approval-dismissed` resumes to the same state; history restores a nested region | L | F | 6, 10 |
| 21 | `engine/runner.ts`, the loop from section 3.2 over `Host`. It schedules probes, reruns pending acts, and spawns a `needs-model` agent with one escalation tier before falling back to `needs-captain`. Errors retry three times with backoff and then become `needs-captain`. It enforces token budgets and one writer per branch on a stack (lower layers first). | `engine/runner.ts`, `tests/runner.test.ts`, `tests/fixtures/atoms/*` | Test with the fake host and toy shell atoms: a pending act reruns once; three errors trigger the andon; two fixers on one stack run in order | L | F | 12, 14, 19, 20 |
| 22 | CLI dispatcher. `bin/numberone` execs `node engine/cli.ts`, which finds `engine/commands/<name>.ts` by name. Write the real `skills/numberone/SKILL.md`, which only parses arguments and calls the CLI. | `bin/numberone`, `engine/cli.ts`, `skills/numberone/SKILL.md`, `tests/cli.test.ts` | Test: an unknown subcommand exits 64 and prints usage | S | F | 1 |
| 23 | Background host, run as `numberone watch`. One process per install owns every live run: it holds each run's lease (Q20) and shares one poller per source (Q15). It spawns agents with `claude -p --model <m>` and exits with a report on `needs-captain`. A fresh `watch` resumes from the log. | `hosts/background/host.ts`, `engine/commands/watch.ts`, `tests/host-background.test.ts` | Test: a synthetic run reaching `needs-captain` exits with the report; a restart repeats no act; two runs on one PR make one poll per tick | M | F | 21, 22 |

## Wave F: shared lib and atoms

Task 24 comes first. Each atom task after it touches only `atoms/<id>/`: `ATOM.md` with full frontmatter, `wait.sh`, `act.sh`, an optional `judge.json`, and `atom.test.ts`. Each atom's check is `node --test atoms/<id>/atom.test.ts`, which drives the atom's scripts against the fakes and asserts the exit records. All atom tasks share group G.

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | Shared lib. `lib/sh/{watermark,worktree}.sh`: use the editor's locked worktree when the tree is clean. `lib/prose/{review-etiquette,ping-hygiene}.md`, plus fallbacks for resolving review threads, fixing failing checks and rebasing. `tests/atom-harness.ts` runs one script with params and a fake world. | `lib/**`, `tests/atom-harness.ts`, `tests/lib.test.ts` | `node --test tests/lib.test.ts` | S | G | 13, 14 |

| # | Atom | Size | The test asserts |
| --- | --- | --- | --- |
| 25 | `pr-ready` | S | a draft-to-ready change emits `done` exactly once |
| 26 | `pr-mergeable` | S | an UNKNOWN merge state in between emits nothing; a blocking human review exits `needs-captain`; the outputs carry `head_sha` |
| 27 | `review-comment` | M | a bot comment is ignored; a human comment gets the eyes reaction and then exits `needs-model` with the resolved capability; the thread stays open when the reviewer must answer |
| 28 | `failing-check` | M | one exit per failing required check per head sha; a green bot report stays silent |
| 29 | `approve-gated-runs` | S | runs are approved; a second act makes no calls |
| 30 | `re-request-review` | S | the same reviewer is re-requested; the thread reply targets the original ping's exact `ts` from the run log |
| 31 | `merge-pr` | S | the merge happens at `expectHead`; an already-merged PR is `done`; a moved head exits instead of merging |
| 32 | `stack-link` | S | an already-linked stack is `done` with no calls |
| 33 | `restack` | M | the push uses a lease; a foreign branch is refused; a lease mismatch exits `needs-captain` |
| 34 | `rebase-onto-trunk` | M | the `needs-model` brief lists the layers lowest first; dismissed approvals are emitted for re-request |
| 35 | `lower-layer-draft` | S | a draft lower layer wakes with its PR ref; nothing happens when every layer is ready |
| 36 | `transition-ticket` | S | the move is forward only; side states are allowed; transitions are never cached |
| 37 | `follow-ticket` | S | someone else's forward move jumps the flow to that stage; a backward move is only a note |
| 38 | `review-ping` | S | one post per PR set in `channels.review`; a later ask makes a new post; the post's `ts` is logged |
| 39 | `chat-news` | M | banter, acks and the captain's own messages are marked seen; a QA contact message about any ticket counts; replies in every thread are seen |
| 40 | `answer-in-thread` | M | the reply goes to the exact source `ts`; outside the review channel the answer becomes a draft |
| 41 | `qa-ready-check` | S | a gaps answer exits listing the gaps; a complete answer is `done` |
| 42 | `dm-qa` | S | `prefs.dm: avoid` or a contact outside the allowlist produces a draft instead of a DM |
| 43 | `ask-grant` | S | the wake carries the exact wording; the answer records `grant.decide`; widening creates a new id with `supersedes` |
| 44 | `draft-to-canvas` | S | a replace keeps one section and starts unchecked; a non-Slack chat writes `drafts.md` (Q9); an unavailable canvas exits `needs-captain` (Q10) |
| 45 | `send-checked-draft` | M | the captain's edited text is what gets sent; a message the captain already sent by hand only removes the section; an unchecked box does nothing |
| 46 | `stall-report` | S | nothing happens before the timeout on the virtual clock; after it, the report names the source being waited on and who |

## Wave G: flows

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 47 | `review-loop`, a standing region over `review-comment`, `failing-check`, `approve-gated-runs` and `re-request-review` for each PR it watches. | `flows/review-loop.flow.yaml`, `tests/flows/review-loop.test.ts` | Test: it loads and binds, and a short fake world exercises all four atoms | S | H | 27-30 |
| 48 | `pr-to-done`, as in section 2.4, except that the final entry is `transition-ticket {to: done}` because `transition-done` is deferred. Exceptions: approval dismissed, ticket moved by someone else, and stall. | `flows/pr-to-done.flow.yaml`, `tests/flows/pr-to-done.test.ts` | Test: a fake world runs it to the final state | S | H | 25, 26, 31, 36, 37, 46, 47 |
| 49 | `stack-to-done` v0: `stack-link`, then per layer `review-loop` with `restack`, `rebase-onto-trunk` and `lower-layer-draft`, then `qa-ready-check`, then `dm-qa`. It ends in a `ready-to-merge` state that exits `needs-captain` until the deferred atoms land. | `flows/stack-to-done.flow.yaml`, `tests/flows/stack-to-done.test.ts` | Test: a fake world reaches `ready-to-merge` with exactly one wake | M | H | 32-35, 38-45, 47 |

## Wave H: commands

Each command touches only `engine/commands/<name>.ts` and `tests/commands/<name>.test.ts`, so all six share group I. All six come after task 23; `run` and `resume` also come after task 48.

| # | Command | Check | Size |
| --- | --- | --- | --- |
| 50 | `setup`: an interview, or `--answers <file>` for tests. It writes the rules file only after asking permission. A rerun edits only the keys that changed. | Test with a temp `HOME`: the answers produce a valid config; a rerun with one change touches only that key and keeps the prose | M |
| 51 | `run <flow> <args>`: validate, bind, write `run.json` and `run.start` with the config and flow hashes, then start or attach a host. | Test: it creates the run directory; a second `run` attaches instead of starting another host | S |
| 52 | `status [run]`: regions, what each waits on, the last news, tokens against budget with dollars from a price table (Q18), grants, and drafts. Supports `--json`. | Golden test over a fixture run log | S |
| 53 | `resume <run>`: fold, then check the hashes. A changed flow or config prints a diff and exits `needs-captain` unless `--accept-changes` is passed. | Test: a changed flow exits 3 with the diff; an unchanged one resumes with no repeated act | S |
| 54 | `doctor [--fix]`: the environment, live-run and budget sections from section 9, the rules-file size cap, and a stub for the lint section. `--fix` restarts dead watchers and re-resolves the capability cache. | Test with a temp `HOME` and a broken config: it exits nonzero naming the error; `--fix` restarts a watcher whose heartbeat is stale | M |
| 55 | `list`: flows and atoms from core and packs, with status and layer. | Golden test | S |

## Wave I: lints

Each lint is `doctor/lint/<name>.ts` with `doctor/lint/<name>.test.ts`, which runs it over its good and bad fixtures in `doctor/lint/fixtures/<name>/`. The lints need only waves B and F, so they can start as soon as task 24 lands, alongside waves G and H. All eight share group J.

| # | Lint | Check (the bad fixture must fail) | Size |
| --- | --- | --- | --- |
| 56 | Atomicity: one trigger and one outcome; `act.sh` calls mutating verbs of one kind only | an `act.sh` that both merges and posts | S |
| 57 | References: every `uses`, `fallback`, atom, flow and mapped exit exists; no flow uses an `unexercised` atom | a flow that maps an undeclared exit or uses `merge-stack` | S |
| 58 | Cost layers: `code` atoms never call `claude` or the judge; `jev` atoms call only the judge | a `code` atom whose script runs `claude -p` | S |
| 59 | Duplicates: 5-token shingles with Jaccard of at least 0.5 for code; prose candidates confirmed by a judge Noul question | a paragraph copied across two atoms (the test uses the fake judge) | M |
| 60 | Params: schemas compile; `$config` defaults point at real keys; every binding type-checks | a default that reads `$config.nope` | S |
| 61 | Statechart: every state reachable; every non-final state has a path to a final state; every `resume` target exists | an unreachable state | S |
| 62 | Budget: every atom declares one; `code` atoms declare zero tokens | a `code` atom with a token budget | S |
| 63 | Leak: the patterns from section 10 everywhere; the denylist built from the local config only in the pre-push hook (Q19); private packs are skipped | a chat id, a ticket key and an `owner/repo` in core | M |
| 64 | `numberone lint`; the lint section of `doctor`; `.github/workflows/ci.yml` (typecheck, test, lint with pattern-only leak checks, shellcheck); `tools/pre-push` | `bin/numberone lint` exits 0 on the repo; CI is green on the PR | S |

Task 64 comes after tasks 54 and 56-63.

## Wave J: replay judge

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 65 | The synthetic fixture: `world.jsonl`, in the task 7 shape, plus `args.json` and a golden `expected.jsonl`. It covers a ready PR, review comments (one from a human, one from a bot), a failing check, gated runs, an approval dismissed by a push, a lower layer moving, trunk moving, the ticket moved by someone else, and chat banter and acks next to a real question. `tools/fixture-parity.ts <path>` compares a recording against the fixture and prints only the key sets and kind counts the fixture is missing, so a private recording can be checked without copying any of it. | `replay/fixtures/synthetic-stack/*`, `tools/fixture-parity.ts` | The fixture validates; the leak lint passes on it; the parity check of the fixture against itself reports zero gaps | M | K | 7, 63 |
| 66 | `replay/harness.ts`: run a flow on the virtual-clock fakes and pass only under the four conditions in section 11 (state and exit sequence, allowed actions, wakes, budgets). | `replay/harness.ts`, `replay/harness.test.ts` | `node replay/harness.ts replay/fixtures/synthetic-stack` exits 0; the test injects an extra wake, a disallowed action and an overspent budget, and each one fails | L | K | 49, 65 |

## Wave K: fresh install

| # | Task | Files | Check | Size | Group | After |
| --- | --- | --- | --- | --- | --- | --- |
| 67 | `tests/fresh-install.sh`. Under `env -i`, with temp `HOME` and `XDG_STATE_HOME` directories, install from the working tree: through `claude plugin` when it is present, otherwise by copying the tree. Then run `setup --answers`, then `doctor` (only the expected "not authenticated" warnings may appear), then the synthetic replay. Fail if any output names the real home path. | `tests/fresh-install.sh`, `tests/fixtures/answers.json`, `.github/workflows/ci.yml` | `bash tests/fresh-install.sh` exits 0, locally and in CI | M | L | 50, 54, 64, 66 |

## Critical path

1 → 2 → 4 and 7 → 9 → 10 → 20 → 21 → 23 → 24 → the atoms → 49 → 66 → 67. Everything else hangs off this path in its group.

## Contradictions in ARCHITECTURE.md (task 0 fixes these)

1. **Two different timelines.** Section 11 says the replay judge feeds a recorded `timeline.jsonl` of section 2.7 run events (`watch.observe`). The recording from the first run has a different shape: world events with the fields `t`, `source`, `kind`, `actor`, `bot`, `ref`, `summary` and `url`. The plan names the replay input `world.jsonl` and keeps `timeline.jsonl` for the run log.
2. **Chat reads.** Q2 decided headless Haiku only, but section 2.1 (`read: token | haiku-mcp`, the `slack-user` secret), section 3.3 and section 9 still describe a token path. Q2 also leaves chat writes and canvas edits unspecified. And with Haiku only, every chat probe costs tokens, so "waiting is free" (sections 1 and 3.3) no longer holds for chat.
3. **Grants.** Q8 says grants are "recorded in the run's grants file", but section 2.5 says grants are a fold over events and not a file.
4. **Grant expiry.** Section 2.5 uses `on: "tracker:ABC-50 status=done"`, but Q16 decided there is no grammar.
5. **Budget units.** Q18 decided budgets are in tokens, but `budget.*.usd`, `budgets.daily_usd` and `cost.usd` remain in sections 2.1, 2.2 and 2.7.
6. **The capability cache has three homes.** Section 2.1 puts it in the config, Q1 puts it in the plugin data directory, and Q11 puts it in XDG state.
7. **Pack core range.** Q12 decided `^0.x`, but section 7 shows `>=0.1 <0.2`.
8. **Pollers and hosts.** Q15's shared poller per source conflicts with section 3.1's background host, which is one process per run. The plan resolves this with one background process that owns every live run.
9. **Leftover names.** Q3 renamed the harness to `replay`, but sections 4 and 11 and the scaffold still use `judge/harness.ts`. `pr-to-done` (section 2.4) ends on `transition-done`, which is unexercised. Q10 dropped the self-DM fallback, but the config still has `self_dm`.
