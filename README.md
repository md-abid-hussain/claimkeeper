<img src="https://raw.githubusercontent.com/md-abid-hussain/claimkeeper/main/plugin/.claude-plugin/icon.png" width="96" alt="claimkeeper icon: a document with a check badge">

# claimkeeper

**Keep what your product says about itself consistent — across the README, docs, landing page, pitch text, demo script, voiceover, SVGs and the demo video — while coding agents keep changing things.**

[![M8ven Score](https://m8ven.ai/badge/mcp/md-abid-hussain-claimkeeper-136hjc?v=b555fb39f6f022b346726380c3413ec0)](https://m8ven.ai/mcp/md-abid-hussain-claimkeeper-136hjc?s=readme)

You're building a hackathon project with Claude Code. The README says *"everything runs on-device"*, the landing page says *"100% private"*, the voiceover says *"no audio leaves your laptop"*, an SVG says *"on-device"*, and the Remotion video shows it in scene 2. Three sessions later the agent adds cloud sync, updates one file, and your submission contradicts itself.

Git is the tool humans and agents share for code. claimkeeper is the tool the **agent** uses for claims; you watch it through `git diff .claims/`, a status line and an activity log.

- a **claim** is an id + one sentence of what it means (`on-device`: "All processing runs on the user's device; no audio leaves it.")
- each claim knows its **places**: files and exact wording, each place in its own words, short or long
- **generated outputs** (ElevenLabs audio, SVG exports, Remotion renders) remember what they were made from

The tool does the deterministic work (store, find, fetch, rewrite, fingerprint, report). Claude does the judgment (does this contradict? what wording fits here? does the picture still say it?).

## What it catches

| Situation | What you get |
|---|---|
| Lines moved, text reflowed, wrapped in tags | Found anyway (exact → normalized → fuzzy). No false alarms. A moved place is re-pinned to its new line the next time a write tool touches its claim. |
| Wording at one place edited | `changed`, with the old and new wording side by side |
| File renamed / deleted | `file_not_found` with likely new locations — never a crash |
| Code that backs a claim changed | `code_changed`: verify the claim still holds |
| Claim **meaning** changed | Revision bump; every place and output not updated is `STALE`; the agent must tell you |
| A place contradicts a claim | Registered as `CONFLICT` and stays flagged until fixed |
| Voiceover script edited | Audio `needs_regen` → the video that uses it `needs_regen` too (chained) |
| Edits by `sed`, scripts or by hand | Caught by the end-of-turn check and the next session start |
| You want the old meaning back | `claim_update revert` — places written for that meaning are consistent again |

The agent **never regenerates media on its own**. It tells you what's out of date and asks.

## Install

Requires Node.js 22 or newer (tested on 22 and 24; development uses 24). Installing it pulls in no other packages: the pinned MCP SDK is bundled.

```bash
claude plugin marketplace add md-abid-hussain/claimkeeper
```

```bash
claude plugin install claimkeeper@claimkeeper
```

Or try it from a checkout without installing: `claude --plugin-dir ./plugin`.

**Codex, Cursor or another agent?** Any agent that can use MCP servers works: the server hands every client its usage rules when it connects, and the tools declare read-only/destructive hints so hosts can warn before the risky ones. Tell it:

> Install claimkeeper in this project by following https://github.com/md-abid-hussain/claimkeeper/blob/main/INSTALL.md

[INSTALL.md](INSTALL.md) walks the agent through registering the MCP server, adding the instructions, turning tracking on and (with your yes) a git pre-commit check. Without Claude Code's hooks, the agent runs the checks itself as its instructions say, and the pre-commit check catches what slips through at commit time.

## Turn it on per project

Installing does nothing by itself; hooks stay silent until a project runs init.

```
/claimkeeper:init
```

- **New project** (claims first): you name the 3–7 things the product must always say; they become the spec. Places are registered as Claude writes them, and the README, pitch and demo script are written from the claims.
- **Existing project**: a read-only `claim-scout` subagent reads your README, landing page, scripts, compositions and SVGs in its own context and returns a short proposal with contradictions. You approve; Claude registers.

```
/claimkeeper:toggle off       # quiet for you only (git-ignored setting); "on" to resume
/claimkeeper:toggle relaxed   # report problems at the end of a turn, don't block
/claimkeeper:toggle strict    # fix or acknowledge new problems before finishing (default)
/claimkeeper:toggle quiet     # no end-of-turn check and no new-file suggestions; per-edit warnings only
/claimkeeper:audit            # full review (claim-auditor subagent) before you submit or record
```

## Watching it work

You don't have to ask the agent to test anything. Build as usual and look from the side:

```bash
node <claimkeeper>/plugin/dist/cli.js log      # what the agent and hooks did
node <claimkeeper>/plugin/dist/cli.js status   # counts
git diff .claims/                               # what changed in the claims since your last commit
```

Status line (add to `~/.claude/settings.json`), showing `claims ✓13`, `claims ⚠2 · 1 pending` or `claims off`:

```json
{ "statusLine": { "type": "command", "command": "node <claimkeeper>/plugin/dist/cli.js statusline" } }
```

## Context budget

Everything the agent sees costs context, so claimkeeper discloses progressively:

| When | What the agent sees |
|---|---|
| Always | a one-line skill description; 7 tool names (schemas load on demand) |
| Session start | one line: `Claim tracking is on: 13 claims, 2 need attention` |
| Reading a file with claims | one line, once per file per session: `README.md holds claims: on-device l7 "…"` |
| Writing claim wording / an output's input | only when something drifted or went stale |
| End of turn | only **new** problems, top 5; blocks at most once each. A meaning change is shown to you, not sent back to the agent |
| Fetching a claim | `claim_get` lists healthy places by file and id without wording once a claim has more than 8; places needing attention are always shown in full |
| After a meaning change | the first 5 stale places in full, the rest by file and id; the old meaning is printed once, not on every place, and the end-of-turn check counts these places per claim instead of listing them again |
| Claims skill | under 500 words (a test enforces it), loaded when product-facing text or media is touched; media and meaning-change guidance in reference files read only when needed |
| Setup and audit | in Claude Code, run in subagents: only their short report enters the session (other agents run them inline) |

## How it runs

| Hook | Does |
|---|---|
| SessionStart | one line; snapshots existing issues so only new ones block later |
| PostToolUse: Read | the claims a file holds, once per file |
| PostToolUse: Write / Edit | drift in claim wording, outputs now out of date, suggestions for new files |
| PostToolUse: Bash, media MCP tools | reminders to record generated media; tracked files that disappeared |
| Stop | whole-project check; new problems block once (strict) or are reported (relaxed); a meaning change is shown to you as a notice and never blocks by itself |

Hooks never change claims. They write only git-ignored local files: session state, the activity log and the status cache (plus a debug log, only if you set `CLAIMKEEPER_DEBUG`). Errors are swallowed; claim tracking never breaks a session.

## Storage and git

```
.claims/
  config.json            # only settings that differ from defaults (committed)
  claims/<id>.json       # one file per claim: meaning, history, places (committed)
  outputs.json           # generated outputs in tracked files (committed)
  local/                 # git-ignored: places/outputs in ignored files (e.g. out/*.mp4),
                         #   personal settings, session state, activity.log, state.json
```

- Places in files git ignores go to `local/` automatically, since nobody else has those files.
- `/claimkeeper:init --private` keeps the whole store out of git.
- Only short anchor wording is stored (≤ 500 chars per place): the store grows with the number of claims, not the codebase.
- **Secrets are refused**: anything that looks like an API key, token, private key or credential assignment is never stored; `.env*`, key files and `secrets/` folders are never tracked; generation metadata drops keys like `api_key`, `token`, `authorization`.

## Security

A repo you clone or pull can ship its own `.claims/` folder, so claimkeeper treats the store as untrusted input:

- **Paths are contained.** Every path from the store or the agent must resolve inside the project: no absolute paths, no `..`, and no symlinks or junctions that lead out of it. Anything else is reported as `unsafe_path` and never read or written.
- **The store and `.git` are never tracked**, and the file walk never follows links. Excluded and protected paths are refused even when a store file names them.
- **Store files are validated on load.** A claim is always saved under its validated file name (never an id written inside the file), malformed entries are dropped, and exclude patterns are matched without backtracking.
- **Claim text can't impersonate claimkeeper.** Descriptions, notes and wording are kept on one line, control and bidi characters are removed, and `[claimkeeper]` inside stored text is neutralized.
- **Secret protections can't be switched off.** A project config can add exclusions, never remove the built-in ones (`.env*`, key files, `secrets/`).
- **The opt-in debug log redacts** file contents, edits, commands and command output.
- Nothing to install at runtime (the pinned MCP SDK and zod are bundled into `plugin/dist`); `npm audit` is clean. Regression tests for each of these live in `test/security.test.ts`.

## Privacy

claimkeeper makes no network requests and sends nothing anywhere: no telemetry, no external services. Everything it stores stays in your project: the claims in `.claims/` (committed with your repo unless you use `--private`) and your personal settings, session state and activity log in the git-ignored `.claims/local/`. It never stores secrets (see Security). The full policy is in [PRIVACY.md](PRIVACY.md).

## Tools (MCP)

| Tool | Purpose |
|---|---|
| `claims_config` | init, status, on/off, stop mode |
| `claim_add` | create a claim and/or register its places (verified to exist; `conflict` for contradicting places; `dry_run` shows what would be registered and writes nothing) |
| `claim_get` | list claims, or fetch claims with every place resolved live |
| `claims_check` | only what needs attention, plus pending acknowledged items |
| `claims_in` | claims in a file and outputs built from it; `scan` suggests unregistered mentions |
| `claim_update` | new meaning (`desc`), `revert`, `remove`; per place: `text` (writes the wording into the file), `anchor` (the file already says it: keep that wording), `accept`, `ack`, `relink`, `remove`; `accept_all` confirms every other place you checked |
| `output` | `record` / `ack` / `remove` generated media |

Every tool declares all four MCP hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) as explicit booleans. `claim_get`, `claims_check` and `claims_in` are read-only; `claims_config` and `claim_add` only add claimkeeper's own records; `claim_update` (can rewrite files and delete claims) and `output` (can stop tracking) are marked destructive so hosts can ask first. None reaches outside the project.

## Which model

Mechanical work is fine on a small, cheap model (Haiku-class): registering places with exact wording (`claim_add`), `claims_check`, `claims_in`, accepting places that still say the same thing, and the first read-only discovery pass (`claim-scout` runs on Haiku in Claude Code). Use a stronger model (Sonnet-class or better) for judgment: whether a place contradicts a claim, whether new wording changed the meaning, and when to stop and ask the user (`claim-auditor` runs on Sonnet). A weak model that misjudges meaning can only do limited harm: a meaning change still needs the user's decision on record.

## CLI

Install from npm with `npm install -g claimkeeper` (or run one command with `npx -y claimkeeper <command>`); from a checkout use `node <checkout>/plugin/dist/cli.js`.

```bash
node plugin/dist/cli.js init [--private]
node plugin/dist/cli.js on|off [--me]
node plugin/dist/cli.js check --ci     # exit 1 if anything needs attention
node plugin/dist/cli.js get on-device
node plugin/dist/cli.js in README.md
node plugin/dist/cli.js log -n 50
node plugin/dist/cli.js install-git-hook   # pre-commit check (uninstall-git-hook removes it)
node plugin/dist/cli.js status --root ../my-app   # any command: --root or CLAIMKEEPER_ROOT picks the project
```

## Rules

1. Opt-in per project; off per user or per project.
2. A claim's one-sentence meaning is the source of truth; places store exact wording, verified on registration.
3. Rewording keeps the revision; a meaning change bumps it, marks unconfirmed places and outputs stale, and the agent tells you.
4. **Only you decide what the product promises.** A meaning change must say who decided (`user`, or `user_request` when it follows from what you asked for) and why; the agent's own idea is refused until you agree. When places disagree and nothing you said settles it, the agent marks a conflict and asks instead of picking. `git diff .claims/` and `claimkeeper log` show who decided each change.
5. **Numbers are tied to code.** A claim that states a number gets the constant that sets it as a code place, so changing `MAX_REPEATS` flags the docs. Claims with numbers but no code place are listed by `claims_check`.
6. Web pages (a DEV post, a store listing) can't be checked by the tool: they're shown as "check by hand" with the wording to look for.
7. Media is never regenerated without your yes; "not now" is acknowledged and stays listed as pending. A conflict registered on purpose waits for your decision the same way, without blocking.
8. Missing files are reported, never fatal. Secrets are never stored.

## Limits

- It only knows registered claims and places. Keyword nudges, `claims_in scan` and `/claimkeeper:audit` reduce the gap; they don't close it.
- "Tell the user" and "never regenerate" are instructions to the agent, not locks.
- Meaning vs rewording is the agent's judgment; `decided_by` makes the decision visible, but the agent still has to classify the change honestly.
- Audio and video are judged through what they were made from (scripts, captions, compositions). Claude can look at images and SVGs, not watch video.
- Text built at runtime (`t('hero.title')`) must be anchored where the literal string lives.
- Parallel sessions on one folder are safe: each tool call that writes takes a short file lock (`.claims/store.lock`), so places registered at the same moment are all kept. Sessions in separate git worktrees each have their own copy of `.claims/`: commit it and merge it like any file (`claims_config status` says when a session is in a linked worktree).

## Development

```bash
npm install
npm test          # typechecks, bundles plugin/dist with esbuild, runs unit, hook, CLI and MCP tests (a real SDK client talks to the server)
npm run build     # just the bundle: plugin/dist/cli.js plus a lazily loaded chunk holding the MCP SDK
npm run validate  # claude plugin validate (marketplace + plugin)
npm pack          # the npm tarball: plugin/ only, about 240 kB, no runtime dependencies
```

The SDK and zod are exact-pinned devDependencies that the build bundles into `plugin/dist`, which is committed so a checkout or the plugin runs with plain `node`. Hooks load only the small main file; the SDK chunk is read only for `claimkeeper mcp`.

`src/core` is the deterministic engine, `src/mcp` the stdio MCP server (official MCP SDK), `src/hooks` the Claude Code hooks, `plugin/` what ships (manifest, skills, agents, hooks.json, built `dist/`). Dependencies are pinned to exact versions.

## License

MIT
