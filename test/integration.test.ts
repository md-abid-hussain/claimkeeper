/** Regression tests for the code review: packaging, real hook processes, MCP edge cases, CLI, docs. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import * as ops from "../src/core/ops.ts";
import { TOOLS } from "../src/mcp/tools.ts";

const PLUGIN = resolve(import.meta.dirname, "../plugin");
const CLI = join(PLUGIN, "dist/cli.js");

describe("integration", { skip: !existsSync(CLI) && "run npm run build first" }, () => {
  let base: string;
  let root: string;

  before(() => {
    base = mkdtempSync(join(tmpdir(), "ck-int-"));
    root = join(base, "project");
    mkdirSync(join(root, "docs"), { recursive: true });
    for (let i = 0; i < 12; i++) writeFileSync(join(root, "docs", `f${i}.md`), `Doc ${i}: Murmur keeps all audio on your laptop.\n`);
    const store = ops.init(root).store;
    ops.addClaimWithMentions(store, {
      id: "local",
      desc: "Audio stays on the device.",
      mentions: Array.from({ length: 12 }, (_, i) => ({ path: `docs/f${i}.md`, anchor: `Doc ${i}: Murmur keeps all audio on your laptop.` })),
    });
  });
  after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  test("the installed plugin runs under a parent folder whose package.json says commonjs", () => {
    const home = join(base, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "package.json"), JSON.stringify({ type: "commonjs" }));
    const installed = join(home, ".claude/plugins/cache/claimkeeper/claimkeeper/0.2.1");
    cpSync(PLUGIN, installed, { recursive: true });
    const r = spawnSync("node", [join(installed, "dist/cli.js"), "hook", "session-start"], {
      input: JSON.stringify({ session_id: "inst", source: "startup" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    assert.doesNotMatch(r.stderr, /Cannot use import statement|SyntaxError/);
    assert.match(r.stdout, /Claim tracking is on: 1 claims/);
  });

  test("12 hook processes in parallel all answer, and session state stays complete", async () => {
    const run = (i: number) =>
      new Promise<{ code: number | null; out: string }>((done) => {
        const p = spawn("node", [CLI, "hook", "post-tool-use"], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.on("close", (code) => done({ code, out }));
        p.stdin.end(JSON.stringify({ session_id: "par", tool_name: "Read", tool_input: { file_path: join(root, "docs", `f${i}.md`) } }));
      });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => run(i)));
    assert.ok(results.every((r) => r.code === 0));
    assert.equal(results.filter((r) => /holds claims/.test(r.out)).length, 12, "every file hinted once");
    const dir = join(root, ".claims/local/sessions");
    const session = JSON.parse(readFileSync(join(dir, "par.json"), "utf8"));
    assert.equal(session.hinted.length, 12);
    assert.ok(readdirSync(dir).every((f) => !f.endsWith(".tmp") && !f.endsWith(".lock")));
  });

  test("MCP server survives malformed input, reports bad arguments as tool errors, hides stacks", async () => {
    const proc = spawn("node", [CLI, "mcp"], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    const lines: any[] = [];
    let err = "";
    let buf = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.on("data", (d) => (err += d));
    proc.stdout.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
      }
    });
    const send = (x: string) => proc.stdin.write(x + "\n");
    send("null");
    send("42");
    send("{not json");
    send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}');
    send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    send('{"jsonrpc":"2.0","method":"tools/list"}'); // a notification: never answered
    send('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"claim_get","arguments":{"ids":"local"}}}');
    send('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"claim_add","arguments":{"id":"local","mentions":[null]}}}');
    send('{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"no_such_tool","arguments":{}}}');
    send('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"claim_get","arguments":{"bogus":1}}}');
    send('{"jsonrpc":"2.0","id":5,"method":"ping"}');
    await new Promise((r) => setTimeout(r, 1500));
    const exited = new Promise((r) => proc.on("exit", r));
    proc.stdin.end();
    await exited;

    const byId = (id: number) => lines.find((l) => l.id === id);
    const text = (id: number) => byId(id).result.content[0].text as string;
    assert.equal(byId(1).result.protocolVersion, "2025-06-18", "garbage before the handshake did not break it");
    assert.equal(lines.filter((l) => l.result?.tools).length, 0, "a tools/list notification is not answered");
    assert.ok(byId(3).result.isError);
    assert.match(text(3), /ids/, "a wrong argument type names the argument");
    assert.ok(byId(4).result.isError);
    assert.match(text(4), /mentions/);
    assert.ok(byId(6).result.isError);
    assert.match(text(6), /no_such_tool/);
    assert.ok(byId(7).result.isError);
    assert.match(text(7), /bogus/, "unknown arguments are refused, not ignored");
    assert.doesNotMatch(JSON.stringify(lines) + err, /\n\s+at /, "no stack traces");
    assert.deepEqual(byId(5).result, {}, "still alive at the end");
  });

  test("CLI paths resolve from the current folder", () => {
    const r = spawnSync("node", [CLI, "in", "f3.md"], { cwd: join(root, "docs"), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
    assert.match(r.stdout, /docs\/f3\.md/);
  });

  test("skills and agents only name tools that exist", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const files = [
      ...readdirSync(join(PLUGIN, "skills"), { recursive: true }).map((f) => join(PLUGIN, "skills", String(f))),
      ...readdirSync(join(PLUGIN, "agents")).map((f) => join(PLUGIN, "agents", f)),
    ].filter((f) => f.endsWith(".md"));
    const unknown: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/\b(claims?_[a-z]+)\b/g)) if (!names.has(m[1]!)) unknown.push(`${f}: ${m[1]}`);
      for (const m of text.matchAll(/mcp__plugin_claimkeeper_claims__(\w+)/g)) if (!names.has(m[1]!)) unknown.push(`${f}: ${m[1]}`);
    }
    assert.deepEqual(unknown, []);
  });
});
