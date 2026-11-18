---
name: audit
description: Full claim consistency review before a submission, demo recording or launch.
argument-hint: "[claim-id ...]"
disable-model-invocation: true
---

# Claim audit

1. Delegate the review to the `claim-auditor` agent (Agent tool, plugin agent `claim-auditor`), passing any claim ids from the arguments. It reads files in its own context and returns a short report; do not re-read them yourself. If your agent can't start subagents (or has no `claim-auditor`), follow the steps and report format in `agents/claim-auditor.md` of the claimkeeper plugin yourself.

2. Show the user the report: contradictions, stale media, unregistered claims, and the one-line "fine" count.

3. Offer fixes and apply only what the user agrees to: wording via `claim_update` edits, new claims via `claim_add`, conflicts via `conflict`. For each contradiction, ask which version is right; a meaning change is recorded with `decided_by: "user"` and `why` quoting their answer. Regenerate media only on an explicit yes, then `output action=record`.
