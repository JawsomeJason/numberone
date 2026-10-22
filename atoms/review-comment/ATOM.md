---
atom: review-comment
schema: numberone-atom/v1
summary: TODO
trigger: "a new human review comment or suggestion"
outcome: "reacted, then fixed and pushed or replied; thread resolved unless the reviewer must answer"
layer: llm
status: proven
params: { type: object }
exits:
  done: {}
budget: { per_call: { tokens: 0, usd: 0 } }
capabilities: []
uses: []
---

Stub. See ARCHITECTURE.md section 5.
