---
name: toggle
description: Turn claimkeeper's automatic checks on or off, change the end-of-turn check, or show status.
argument-hint: "on | off | strict | relaxed | quiet | status  [--project]"
disable-model-invocation: true
---

Arguments: `$ARGUMENTS`. Scope is `me` unless they include `--project`.

| Argument | Call |
|---|---|
| `on` / `off` | `claims_config {action:"set", enabled:true/false, scope}` |
| `strict` | `claims_config {action:"set", stop:"block", scope}` |
| `relaxed` | `claims_config {action:"set", stop:"warn", scope}` |
| `quiet` | `claims_config {action:"set", stop:"off", nudge:false, scope}` |
| `status` or none | `claims_config {action:"status"}` |

Reply with the one-line result. If tracking is not initialized, suggest `/claimkeeper:init`.
