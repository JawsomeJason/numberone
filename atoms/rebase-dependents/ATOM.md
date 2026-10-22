---
atom: rebase-dependents
schema: numberone-atom/v1
summary: TODO
trigger: "a merge landed that open PRs depend on"
outcome: "each dependent PR rebased onto trunk"
layer: llm
status: unexercised
params: { type: object }
exits:
  done: {}
budget: { per_call: { tokens: 0, usd: 0 } }
capabilities: []
uses: []
---

Stub. See ARCHITECTURE.md section 5.
