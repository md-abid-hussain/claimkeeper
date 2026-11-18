/**
 * A git pre-commit check: the safety net that works with any agent (and with people),
 * whatever hooks the agent itself supports. Installed as a marked block, so it coexists
 * with an existing pre-commit hook and can be updated or removed cleanly.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { ClaimsError } from "./types.ts";

const START = "# >>> claimkeeper >>>";
const END = "# <<< claimkeeper <<<";

function git(root: string, args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function block(cliPath: string): string {
  const cli = cliPath.replace(/\\/g, "/");
  return [
    START,
    "# Blocks the commit when tracked claims need attention. Bypass once: git commit --no-verify",
    `CK_CLI="${cli}"`,
    'CK_ROOT="$(git rev-parse --show-toplevel)"',
    'if [ -f "$CK_ROOT/.claims/config.json" ]; then',
    '  if [ -f "$CK_CLI" ]; then',
    '    CLAIMKEEPER_ROOT="$CK_ROOT" node "$CK_CLI" check --ci --if-enabled || {',
    '      echo "claimkeeper: tracked claims need attention (above). Fix them, acknowledge them, or commit with --no-verify." >&2',
    "      exit 1",
    "    }",
    "  else",
    '    echo "claimkeeper: pre-commit check skipped: $CK_CLI not found (claimkeeper moved or was updated). Run install-git-hook again." >&2',
    "  fi",
    "fi",
    END,
  ].join("\n");
}

export interface HookResult {
  path?: string;
  action: "installed" | "updated" | "removed" | "absent" | "manual";
  message: string;
}

/** Where git runs hooks for this repo, or why we won't write there. */
function hookFile(root: string): { path?: string; manual?: string } {
  if (!git(root, ["rev-parse", "--is-inside-work-tree"])) throw new ClaimsError(`${root} is not a git repository`);
  const custom = git(root, ["config", "--get", "core.hooksPath"]);
  if (custom) {
    // a hook manager (husky, lefthook, ...) owns the hooks: don't edit its files behind its back
    return { manual: `core.hooksPath is set (${custom}): add this to your pre-commit hook manually:\n\n${block("<path-to-claimkeeper>/plugin/dist/cli.js")}` };
  }
  const dir = git(root, ["rev-parse", "--git-path", "hooks"]);
  if (!dir) throw new ClaimsError("could not find the git hooks directory");
  return { path: join(isAbsolute(dir) ? dir : resolve(root, dir), "pre-commit") };
}

export function installGitHook(root: string, cliPath: string): HookResult {
  const { path, manual } = hookFile(root);
  if (!path) return { action: "manual", message: manual! };
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const ours = block(cliPath);
  let next: string;
  let action: HookResult["action"];
  if (existing.includes(START) && existing.includes(END)) {
    next = existing.slice(0, existing.indexOf(START)) + ours + existing.slice(existing.indexOf(END) + END.length);
    action = "updated";
  } else if (existing.trim()) {
    next = `${existing.replace(/\s*$/, "")}\n\n${ours}\n`;
    action = "installed";
  } else {
    next = `#!/bin/sh\n${ours}\n`;
    action = "installed";
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows: git for Windows runs hooks regardless of mode bits
  }
  return { path, action, message: `${action} the claimkeeper pre-commit check in ${path}` };
}

export function uninstallGitHook(root: string): HookResult {
  const { path, manual } = hookFile(root);
  if (!path) return { action: "manual", message: manual!.replace("add this to", "remove this from") };
  if (!existsSync(path)) return { action: "absent", message: "no pre-commit hook installed" };
  const existing = readFileSync(path, "utf8");
  if (!existing.includes(START)) return { path, action: "absent", message: "the pre-commit hook has no claimkeeper block" };
  const rest = (existing.slice(0, existing.indexOf(START)) + existing.slice(existing.indexOf(END) + END.length)).replace(/\n{3,}/g, "\n\n");
  if (rest.replace("#!/bin/sh", "").trim()) writeFileSync(path, rest, "utf8");
  else rmSync(path, { force: true });
  return { path, action: "removed", message: `removed the claimkeeper block from ${path}` };
}
