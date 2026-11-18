# Rewording or meaning change?

Test: would someone relying on the old text expect different behavior from the new text? Yes → meaning change.

| Old | New | Verdict |
|---|---|---|
| "Everything runs on your device; no audio ever leaves your laptop." | "100% on-device." | Rewording (shorter, same promise) |
| "Summaries in under 2 seconds." | "Near-instant summaries." | Rewording, but weaker: fine for a headline only if another place keeps the number |
| "Summaries in under 2 seconds." | "Summaries in under 5 seconds." | **Meaning change** (number) |
| "No audio leaves your laptop." | "No raw audio leaves your laptop; summaries sync to the cloud." | **Meaning change** (new data flow) |
| "Works offline." | "Works offline after first login." | **Meaning change** (new condition) |
| "Free for students." | "Free for students during the beta." | **Meaning change** (time limit) |
| "Built with Gemini." | "Built with Gemini 2.5 Flash." | Rewording (more specific, still true) |

Who decides:

| Situation | decided_by | Do |
|---|---|---|
| User says "summaries now sync to the cloud" | `user` | change it, `why` quotes them |
| User asks you to lower a limit the docs state | `user_request` | change it, `why` names the request |
| Two places disagree, user said nothing about it | — | don't pick; mark `conflict`, ask which is right |
| You think a weaker/stronger promise would be better | `agent` → refused | propose it, ask, then call again with `user` |

When the meaning changes (on the user's decision):
1. `claim_update {claim, desc: "<new meaning>", decided_by, why, edits: [<places you already rewrote>]}`.
2. Tell the user: old meaning → new meaning, plus what is now stale (the tool result lists it).
3. Update the remaining places only if the user's request covers them; otherwise ask.
4. If the user wants the old meaning back: `claim_update {claim, revert: <rev>, decided_by: "user", why}`.
