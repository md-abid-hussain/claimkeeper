---
name: init
description: Turn on claim tracking in this project and set up its first claims (new or existing project).
argument-hint: "[--private]"
disable-model-invocation: true
---

# Set up claim tracking

1. `claims_config {action:"init"}` (`share:false` if the user passed `--private` or wants claims kept out of git).

2. Decide which kind of project this is: look for product-facing files (README beyond a stub, docs/, a landing page, pitch/submission text, scripts, Remotion compositions, SVGs with text).

## New or nearly empty project: claims first

3. Ask the user for the 3-7 things the product must always say about itself: the one-liner, the principles, the key numbers and promises. Offer a draft if they described the product earlier in the conversation.
4. `claim_add` each one with a one-sentence `desc` and a few `keywords`, no mentions yet.
5. Say: from now on, places are registered as they are written, and pitch/README/scripts can be written from `claim_get`.

## Existing project: discover in a subagent

3. Delegate discovery to the `claim-scout` agent (Agent tool, plugin agent `claim-scout`). Pass it the project root and anything the user said about the product. It reads the files in its own context and returns a short proposal; do not read those files yourself. If your agent can't start subagents (or has no `claim-scout`), follow the instructions and output format in `agents/claim-scout.md` of the claimkeeper plugin yourself.
4. Show the user the proposal as is (claims, where they appear, contradictions) and ask which to track and how to settle contradictions. Register nothing before they answer. Even if they approved everything up front, that approval covers which claims to track, not which side of a contradiction is true: ask about each contradiction, or register it with `conflict` and say so.
5. Register the approved ones: one `claim_add` per claim with all its mentions, including the scout's `code` places for numbers (and look for the constant yourself if the scout found none). Contradictions the user has not settled get `conflict`: they wait for the user's decision and don't block the end of the turn. Settled ones: register, then `claim_update` edits with the new wording.
6. If generated media exists and the user knows its sources, `output action=record` it.

## Finish

One or two lines: how many claims and places are tracked, and that `/claimkeeper:toggle off` turns the automatic checks off.

If the project uses git, offer the pre-commit check (`node <claimkeeper>/plugin/dist/cli.js install-git-hook`): it blocks commits while tracked claims need attention. Recommend it when the agent doesn't run claimkeeper's hooks (anything other than Claude Code); install it only on the user's yes.
