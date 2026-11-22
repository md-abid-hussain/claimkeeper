# Installing claimkeeper (instructions for AI coding agents)

You are a coding agent (Codex, Cursor, Claude Code, or any agent that can use MCP servers) and the user asked you to install claimkeeper into their project. Follow these steps. Ask the user before editing anything outside the project (global config in their home folder), and tell them at the end exactly what you changed.

claimkeeper keeps what a product says about itself consistent across README, docs, landing page, pitch text, scripts, prompts, SVGs, voiceovers and demo videos. It is an MCP server (7 tools) plus instructions (skills). Nothing is sent over the network; everything is stored in the project's `.claims/` folder.

## 0. Requirements

- Node.js 22 or newer (`node --version`). No `npm install` needed: the built code is in the repo.
- git is optional (needed only for the pre-commit check).

## 1. Claude Code: use the plugin

```bash
claude plugin marketplace add md-abid-hussain/claimkeeper
```

```bash
claude plugin install claimkeeper@claimkeeper
```

The plugin brings the MCP server, skills, subagents and hooks. Start a new session in the project and run `/claimkeeper:init`: it turns tracking on, sets up the first claims and offers the pre-commit check (optional in Claude Code, which has the hooks). Then finish with step 9. Steps 2–8 are for other agents.

## 2. Every other agent: get claimkeeper once

Install it globally from npm (one copy serves every project and gives a stable path for the git hook):

```bash
npm install -g claimkeeper
```

No global install? `npx -y claimkeeper <command>` runs any command once (use it for the MCP entry in step 3; the pre-commit check in step 6 needs the global install or a checkout). Or clone it:

```bash
git clone https://github.com/md-abid-hussain/claimkeeper ~/.claimkeeper
```

Below, `CK` means the absolute folder that holds claimkeeper's `plugin/` folder: `$(npm root -g)/claimkeeper` for the global install, or the clone (for example `/home/me/.claimkeeper` or `C:/Users/me/.claimkeeper`). `claimkeeper` means the command (on the PATH after a global install; from a clone use `node CK/plugin/dist/cli.js` instead). `PROJECT` means the absolute path of the user's project root. Use absolute paths everywhere.

## 3. Register the MCP server

Command `claimkeeper`, arguments `mcp --root PROJECT` (without a global install: command `npx`, arguments `-y claimkeeper mcp --root PROJECT`; from a clone: command `node`, arguments `CK/plugin/dist/cli.js mcp --root PROJECT`; on Windows a client may need `cmd` with `/c npx ...`). Prefer the project-level config file. `--root` tells the server which project to use, so it doesn't depend on the client's working directory.

Codex (`.codex/config.toml` in the project, or `~/.codex/config.toml`):

```toml
[mcp_servers.claimkeeper]
command = "claimkeeper"
args = ["mcp", "--root", "PROJECT"]
```

Cursor (`.cursor/mcp.json` in the project):

```json
{
  "mcpServers": {
    "claimkeeper": {
      "command": "claimkeeper",
      "args": ["mcp", "--root", "PROJECT"]
    }
  }
}
```

Any other MCP client: the same command and arguments in its own config format. File locations and formats change between versions: if a file above doesn't match what your client uses, follow your client's current documentation.

## 4. Make the instructions available

If your agent supports Agent Skills (folders with a `SKILL.md`), copy the folders in `CK/plugin/skills/` (`claims`, `init`, `audit`, `toggle`) into the project's skills folder for your agent (for Codex, `.agents/skills/`; check your agent's docs). Keep each folder's `references/` with it.

Also add this block to the project's agent instructions file (`AGENTS.md`, or a rule such as `.cursor/rules/claimkeeper.mdc`), replacing `CK`:

```markdown
<!-- claimkeeper -->
## Product claims (claimkeeper)

This project tracks what the product says about itself with the claimkeeper MCP server.

- Before writing or changing product-facing text (README, docs, landing page, pitch, scripts, prompts given to the product's model, SVGs) or code a claim depends on: `claim_get` lists the claims; `claims_in` shows a file's claims.
- Register new claims and every place they appear with `claim_add`. A claim with a number also gets the code constant that sets it (`kind: "code"`).
- Rewording: `claim_update` edits. A meaning change only on the user's decision (`decided_by`, `why`); then tell the user what is now stale.
- Places disagree and the user hasn't decided: mark the place with `conflict` and ask; don't pick.
- Never regenerate media (audio, video, images) without the user's yes; record generated files with `output`.
- Before finishing a task that touched product-facing text: run `claims_check` and resolve or report what it lists.

Full guide: CK/plugin/skills/claims/SKILL.md
<!-- /claimkeeper -->
```

## 5. Turn tracking on

```bash
claimkeeper init --root PROJECT
```

Add `--private` to keep the claim store out of git.

## 6. Offer the pre-commit check

Agents other than Claude Code don't run claimkeeper's hooks, so the git pre-commit check is the safety net: it blocks a commit while tracked claims need attention (bypass once with `git commit --no-verify`). Install it only if the user agrees:

```bash
claimkeeper install-git-hook --root PROJECT
```

It adds a marked block to `.git/hooks/pre-commit` and keeps any existing hook. With a hook manager (husky, lefthook) it prints the lines to add instead of editing its files. Remove it with `uninstall-git-hook`. The hook calls claimkeeper at the path it was installed from: if claimkeeper moves or a plugin update changes that path, the hook says so at each commit instead of checking, until you run `install-git-hook` again.

## 7. Reload and verify

Restart or reload the agent so it picks up the MCP server and instructions, then call `claims_config {action: "status"}`: it should report `tracking ON`.

## 8. Set up the first claims

Follow the `init` skill (`CK/plugin/skills/init/SKILL.md`):

- **New project:** ask the user for the 3–7 things the product must always say, and register them.
- **Existing project:** find the claims in the product-facing files, including model prompts and the code constants behind numbers. If you can't run the `claim-scout` subagent, follow `CK/plugin/agents/claim-scout.md` yourself. Propose them, ask about contradictions, and register what the user approves.

## 9. Tell the user what changed

List every file you created or edited: the MCP config, the skills folder, the instructions block, `.claims/`, and the git hook. Then say how to undo each one: remove the MCP entry, the skills and the block, run `uninstall-git-hook`, and delete `.claims/`.

## Which model, and parallel sessions

- A small, cheap model is fine for the mechanical steps: `claim_add`, `claims_check`, `claims_in`, accepting places that still say the same thing, and read-only discovery. Use a stronger model for judgment: does a place contradict a claim, did the new wording change the meaning, when to stop and ask the user.
- Several sessions or subagents may write claims at the same time in one folder: writes are serialized by a short lock, so none is lost. Sessions in separate git worktrees each have their own `.claims/`: commit and merge it. `claims_config {action: "status"}` says when a session is in a linked worktree.
- Give every session the same `--root PROJECT` so they all use one store.

## What works where

| | Claude Code (plugin) | Other agents (MCP + instructions) |
|---|---|---|
| 7 claim tools | yes | yes |
| Instructions | skills, loaded on demand | skills where supported, plus the instructions block |
| Setup and audit in subagents | yes | inline when the agent has no subagents (uses more context) |
| Hints on read, drift warnings after edits, end-of-turn check | hooks | the agent runs `claims_in` and `claims_check` itself, as instructed |
| Pre-commit check | optional | recommended |

Updating claimkeeper: `npm install -g claimkeeper@latest` (or `git -C CK pull` for a clone).
