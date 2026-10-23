# Grants: numberone build

## G2 · approved by Jason 2026-10-22 · expires when the core build PR merges (or revoked)

Jason chose one PR for the whole build instead of a PR per task or landing on `main`.

Allowed without asking:

1. Build each PLAN.md task on its own branch in a worktree (outside the repo directory).
2. Review its diff and rerun its checks (`npm test`, `npm run typecheck`, the task's own check) myself.
3. If green, land it on `build/core` and push that branch.
4. Keep the single draft PR (`build/core` → `main`) current: tick waves, update the body.

Not allowed: pushing to `main`, merging the PR, force-pushing `main`, rewriting published history on `build/core`, changing repo settings or visibility, publishing a release or marketplace entry.
