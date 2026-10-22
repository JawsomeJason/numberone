---
atom: follow-ticket
schema: numberone-atom/v1
summary: TODO
trigger: "someone else moved the ticket"
outcome: "the flow jumps to the matching stage, never backward"
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
