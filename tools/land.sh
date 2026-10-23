#!/usr/bin/env bash
# Lands one reviewed task branch on the integration branch: rebases it, regenerates the
# generated type files when the barrel conflicts, reruns the checks, then fast-forwards.
# Usage: tools/land.sh <task-branch> [integration-branch]   (run from the main checkout)
set -euo pipefail
branch=$1
target=${2:-build/core}
wt=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{p=substr($0,10)} $0=="branch "b{print p}')
[ -n "$wt" ] || { echo "no worktree holds $branch" >&2; exit 2; }

cd "$wt"
if ! git rebase -q "$target"; then
  conflicted=$(git diff --name-only --diff-filter=U)
  if echo "$conflicted" | grep -qvE '^engine/types(\.ts|/.*\.gen\.ts)$'; then
    echo "conflict outside generated types, stopping:" >&2; echo "$conflicted" >&2; exit 3
  fi
  while [ -d "$(git rev-parse --git-path rebase-merge)" ]; do
    node tools/gen-types.ts >/dev/null
    git add engine/types.ts engine/types
    GIT_EDITOR=true git rebase --continue >/dev/null || true
    conflicted=$(git diff --name-only --diff-filter=U)
    if [ -n "$conflicted" ] && echo "$conflicted" | grep -qvE '^engine/types(\.ts|/.*\.gen\.ts)$'; then
      echo "conflict outside generated types, stopping:" >&2; echo "$conflicted" >&2; exit 3
    fi
  done
fi
[ -d node_modules ] || npm ci --silent
node tools/gen-types.ts --check
npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'
npm test >/dev/null 2>&1 || { echo "tests failed on rebased $branch" >&2; exit 4; }
npm run -s typecheck
echo "checks green on $branch at $(git rev-parse --short HEAD)"

cd - >/dev/null
git merge -q --ff-only "$branch"
echo "landed $branch on $target at $(git rev-parse --short HEAD)"
