---
atom: transition-ticket
schema: numberone-atom/v1
summary: TODO
trigger: "a stage whose status_map entry is ahead of the ticket"
outcome: "ticket at that status, forward or side state only"
layer: code
status: proven
params: { type: object }
exits:
  done: {}
budget: { per_call: { tokens: 0, usd: 0 } }
capabilities: []
uses: []
---

Stub. See ARCHITECTURE.md section 5.
