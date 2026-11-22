---
name: claims
description: Keep product claims consistent with claimkeeper. Use when claim tracking is on and you write or change what the product says about itself (README, docs, landing page, pitch, scripts, SVGs, voiceover, demo video) or code a claim depends on.
---

# Claims

A **claim** is one thing the product says about itself: a principle, feature, number or promise ("audio never leaves the device", "summaries in under 2 s"). It appears in many places in different words. claimkeeper stores the claim's one-sentence meaning and where it appears; you judge consistency.

## Loop

1. **Before writing product-facing text**: `claim_get` (no ids) lists the claims. Write from them; never invent a number or promise that conflicts. When you read a file, a hint tells you which claims it holds.
2. **New claim** (said in 2+ places, or the pitch/demo relies on it): `claim_add {id, desc, keywords, mentions:[{path, anchor}]}`. The anchor is the exact visible wording in that file (no surrounding markup). Register the places you write in the same turn. A place that contradicts the claim gets `conflict: "how"` (it then waits for the user without blocking). **A claim with a number also gets its code place**: the constant that sets it (`{path, kind:"code", anchor:"export const MAX_REPEATS = 10;"}`), so changing the constant flags the docs. Prompts and instructions given to the product's own model count as product-facing text.
3. **Rewording** (same meaning, any length or style): `claim_update {claim, edits:[{mention, text}]}`. No need to tell the user.
4. **Meaning change** (anything a reader would rely on changes: scope, number, condition, guarantee): only on the user's decision. `claim_update {claim, desc, decided_by, why, edits:[...places you updated], accept_all:true}` (`accept_all` confirms the rest, only after you checked them), with `decided_by: "user"` (they said so) or `"user_request"` (it follows from what they asked for, e.g. the code change they requested) and `why` quoting them. Then **tell the user in 1-2 lines** what changed and what is now stale. If unsure, treat it as a meaning change. Examples: [references/meaning.md](references/meaning.md).
5. **Places disagree and nothing the user said settles it**: don't pick, even if one version looks obvious. Register or mark the place with `conflict`, then ask one short question with the options. A blanket "approve all" / "fix all" covers registering and rewording, not choosing between conflicting promises. Your own idea for a better claim is a proposal: ask first.
6. **Drifted but still true**: `{mention, accept:true}`. **Reworded by hand, file already says it**: `{mention, anchor:"new wording"}`. **Left for later**: `{mention, ack:"why"}`. **File moved**: `{mention, relink}`.

## Hard rules

- **Never regenerate media** (audio, video, images) without the user's yes. Tell them what is out of date and why; if they decline, `output action=ack`.
- After generating media: `output action=record` with what it was made from. Details: [references/media.md](references/media.md) (read only when generating media).
- Never put secrets in claims, anchors, notes or meta.
- Register user-facing claims only, not one-off wording or implementation details.

Hook messages tagged `[claimkeeper]` are for you: act on them briefly, don't repeat them to the user unless they report a meaning change or stale media. In an agent without claimkeeper hooks, do their job yourself: `claims_in <file>` before editing a product-facing file, and `claims_check` before you finish a task that touched one.
