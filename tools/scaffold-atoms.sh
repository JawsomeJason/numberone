#!/usr/bin/env bash
# Writes the numberone scaffold. Idempotent: never overwrites an existing file.
set -euo pipefail
root=${1:?usage: numberone-scaffold.sh <repo-root>}
cd "$root"
made=0 skipped=0

put() { # put <path> <content>
  if [ -e "$1" ]; then skipped=$((skipped+1)); return; fi
  mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; made=$((made+1))
}
stub_sh() { printf '#!/usr/bin/env bash\n# %s: stub. Contract: ARCHITECTURE.md section 2.3.\necho '"'"'{"exit":"error","note":"not implemented"}'"'"'\nexit 70' "$1"; }

# atoms: id|layer|status|trigger|outcome
atoms='pr-ready|code|proven|PR leaves draft|stage advances
pr-mergeable|code|proven|approved, required checks green, no open thread|stage advances with head sha
review-comment|llm|proven|a new human review comment or suggestion|reacted, then fixed and pushed or replied; thread resolved unless the reviewer must answer
failing-check|llm|proven|a required check fails|fix pushed, or a diagnosis reported
approve-gated-runs|code|proven|workflow runs await approval on an allowed PR|runs approved
re-request-review|code|proven|an approval was dismissed by a push|the same reviewer re-requested and mentioned in the original ping thread
merge-pr|code|proven|stage entered with a mergeable PR|PR merged at the expected head
stack-link|code|proven|the work spans several dependent PRs|one native stack
restack|code|proven|a lower layer head moved|upper layers rebased and force-pushed with lease
rebase-onto-trunk|llm|proven|a stack layer reads conflicting against trunk|whole stack rebased, dismissed approvals re-requested
lower-layer-draft|code|proven|a layer below is still a draft|the captain asked to mark it ready
merge-stack|code|unexercised|every layer approved, green, mergeable, and the flow gate passed|the stack merged as one
rebase-dependents|llm|unexercised|a merge landed that open PRs depend on|each dependent PR rebased onto trunk
transition-ticket|code|proven|a stage whose status_map entry is ahead of the ticket|ticket at that status, forward or side state only
follow-ticket|code|proven|someone else moved the ticket|the flow jumps to the matching stage, never backward
transition-done|code|unexercised|every PR linked to the ticket is merged|ticket Done
review-ping|code|proven|PRs need review|one top-level post for the set
chat-news|jev|proven|a reply, reaction or mention in a watched conversation|relevant unseen items emitted; banter and acks marked seen
answer-in-thread|llm|proven|a question about the work, anywhere|an answer where it was asked, at that message exact ts
qa-ready-check|haiku|proven|the work enters QA|QA steps, affected areas and merge order confirmed, or gaps listed
dm-qa|code|proven|QA-ready check passed|a short DM to the QA contact
qa-verdict|jev|unexercised|QA reports in chat, a ticket comment or a PR|pass, fail with details, or a question
ask-grant|code|proven|an action outside the playbook and every grant|a grant record asked for, worded for the captain
draft-to-canvas|code|proven|a message the send rules route to the canvas|one callout section on the drafts canvas
send-checked-draft|code|proven|a draft send-it-for-me box is checked|the current text sent to its exact target, section removed
stall-report|code|proven|no progress past the stage timeout|what the stage waits on and who'

n_atoms=0
while IFS='|' read -r id layer status trigger outcome; do
  n_atoms=$((n_atoms+1))
  put "atoms/$id/ATOM.md" "---
atom: $id
schema: numberone-atom/v1
summary: TODO
trigger: \"$trigger\"
outcome: \"$outcome\"
layer: $layer
status: $status
params: { type: object }
exits:
  done: {}
budget: { per_call: { tokens: 0, usd: 0 } }
capabilities: []
uses: []
---

Stub. See ARCHITECTURE.md section 5."
  put "atoms/$id/wait.sh" "$(stub_sh "$id/wait.sh")"
  put "atoms/$id/act.sh" "$(stub_sh "$id/act.sh")"
  chmod +x "atoms/$id/wait.sh" "atoms/$id/act.sh"
done <<< "$atoms"

for f in review-loop pr-to-done stack-to-done; do
  put "flows/$f.flow.yaml" "# $f: stub. Format: ARCHITECTURE.md section 2.4.
flow: $f
schema: numberone-flow/v1
states: {}"
done

for s in config atom flow event grant draft pack; do
  put "schemas/$s.v1.json" "{
  \"\$schema\": \"https://json-schema.org/draft/2020-12/schema\",
  \"\$id\": \"https://github.com/JawsomeJason/numberone/schemas/$s.v1.json\",
  \"title\": \"numberone $s v1 (stub, see ARCHITECTURE.md section 2)\"
}"
done

for f in engine/types.ts engine/runner.ts engine/statechart.ts engine/bind.ts engine/policy.ts \
         engine/log.ts engine/fold.ts engine/capabilities.ts engine/config/load.ts engine/config/migrate.ts \
         hosts/mod/host.ts hosts/background/host.ts \
         adapters/forge/github.ts adapters/tracker/jira.ts adapters/chat/slack.ts \
         adapters/judge/jev.ts adapters/judge/haiku.ts adapters/config/claude-code.ts \
         replay/harness.ts; do
  put "$f" "// Stub. Design: ARCHITECTURE.md."
done

for d in lib/sh lib/prose doctor/lint doctor/env doctor/live replay/fakes replay/fixtures; do
  put "$d/.gitkeep" ""
done

echo "atoms=$n_atoms made=$made skipped=$skipped"
