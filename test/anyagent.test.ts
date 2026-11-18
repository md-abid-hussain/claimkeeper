/** Using claimkeeper from agents other than Claude Code: --root / CLAIMKEEPER_ROOT and the git pre-commit check. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { TOOLS } from "../src/mcp/tools.ts";

const CLI = resolve(import.meta.dirname, "../plugin/dist/cli.js");
const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" });
const ck = (cwd: string, ...args: string[]) => {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env });
};

describe("any agent", { skip: !existsSync(CLI) && "run npm run build first" }, () => {
  let base: string;
  let project: string;
  let elsewhere: string;

  before(() => {
    base = mkdtempSync(join(tmpdir(), "ck-any-"));
    project = join(base, "project");
    elsewhere = join(base, "elsewhere");
    mkdirSync(project, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(project, "README.md"), "# App\n\nThe app keeps every recording on your laptop.\n");
    git(project, "init", "-q");
  });
  after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  test("--root works from any working directory (init, CLI, MCP server)", async () => {
    assert.match(ck(elsewhere, "init", "--root", project).stdout, /Initialized claim tracking/);
    assert.ok(existsSync(join(project, ".claims/config.json")));
    assert.ok(!existsSync(join(elsewhere, ".claims")), "nothing created in the agent's cwd");

    // MCP server started outside the project, as Codex/Cursor may do
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const proc = spawn("node", [CLI, "mcp", "--root", project], { cwd: elsewhere, env });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "claim_add", arguments: { id: "local", desc: "Recordings stay on the device.", mentions: [{ path: "README.md", anchor: "The app keeps every recording on your laptop." }] } },
      }) + "\n",
    );
    const exited = new Promise((r) => proc.on("exit", r));
    setTimeout(() => proc.stdin.end(), 1500);
    await exited;
    assert.match(out, /local#m1 .*README\.md:3 +ok/);
    // CLAIMKEEPER_ROOT does the same as --root
    const r = spawnSync("node", [CLI, "status"], { cwd: elsewhere, encoding: "utf8", env: { ...env, CLAIMKEEPER_ROOT: project } });
    assert.match(r.stdout, /1 claims, 1 mentions/);
  });

  test("the pre-commit check blocks commits while claims need attention", () => {
    writeFileSync(join(project, ".git/hooks/pre-commit"), "#!/bin/sh\necho custom-hook-ran\n");
    assert.match(ck(elsewhere, "install-git-hook", "--root", project).stdout, /installed the claimkeeper pre-commit check/);
    assert.match(ck(elsewhere, "install-git-hook", "--root", project).stdout, /updated/, "re-installing updates in place");
    const hook = readFileSync(join(project, ".git/hooks/pre-commit"), "utf8");
    assert.equal(hook.split(">>> claimkeeper >>>").length, 2, "one block only");
    assert.match(hook, /custom-hook-ran/, "existing hook kept");

    git(project, "add", "-A");
    const clean = git(project, "commit", "-q", "-m", "clean");
    assert.equal(clean.status, 0, clean.stderr);

    writeFileSync(join(project, "README.md"), "# App\n\nRecordings are uploaded to our servers.\n");
    git(project, "add", "-A");
    const blocked = git(project, "commit", "-q", "-m", "drift");
    assert.notEqual(blocked.status, 0, "commit blocked");
    assert.match(blocked.stderr + blocked.stdout, /claimkeeper: tracked claims need attention/);

    ck(elsewhere, "off", "--root", project);
    assert.equal(git(project, "commit", "-q", "-m", "tracking off").status, 0, "respects tracking off");
    ck(elsewhere, "on", "--root", project);

    assert.match(ck(elsewhere, "uninstall-git-hook", "--root", project).stdout, /removed/);
    const left = readFileSync(join(project, ".git/hooks/pre-commit"), "utf8");
    assert.doesNotMatch(left, /claimkeeper/);
    assert.match(left, /custom-hook-ran/);
  });

  test("with a hook manager (core.hooksPath) it prints the lines instead of editing", () => {
    git(project, "config", "core.hooksPath", ".husky");
    const r = ck(elsewhere, "install-git-hook", "--root", project);
    assert.match(r.stdout, /core\.hooksPath is set/);
    assert.ok(!existsSync(join(project, ".husky/pre-commit")));
    git(project, "config", "--unset", "core.hooksPath");
  });

  test("INSTALL.md only names tools that exist", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const text = readFileSync(resolve(import.meta.dirname, "../INSTALL.md"), "utf8");
    const unknown = [...text.matchAll(/`(claims?_[a-z]+)/g)].map((m) => m[1]!).filter((n) => !names.has(n));
    assert.deepEqual(unknown, []);
  });
});
