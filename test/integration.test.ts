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

  test("MCP server survives malformed input, handles batches and notifications, hides stacks", async () => {
    const proc = spawn("node", [CLI, "mcp"], { env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    const lines: unknown[] = [];
    let buf = "";
    proc.stdout.setEncoding("utf8");
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
    send('{"jsonrpc":"2.0","method":"tools/list"}'); // notification: no reply
    send('{"jsonrpc":"2.0","id":99,"result":{}}'); // a client response: no reply
    send('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]');
    send('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"claim_get","arguments":{"ids":"local"}}}');
    send('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"claim_add","arguments":{"id":"local","mentions":[null]}}}');
    send('{"jsonrpc":"2.0","id":5,"method":"ping"}');
    await new Promise((r) => setTimeout(r, 1500));
    const exited = new Promise((r) => proc.on("exit", r));
    proc.stdin.end();
    await exited;

    const byId = (id: number) => lines.find((l) => (l as { id?: unknown }).id === id) as any;
    assert.equal((lines[0] as any).error.code, -32600, "null line → invalid request, server keeps running");
    assert.equal((lines[1] as any).error.code, -32600);
    const batch = lines.find(Array.isArray) as any[];
    assert.deepEqual(batch.map((r) => r.id), [1, 2], "batch answered item by item, notification skipped");
    assert.ok(!lines.some((l) => (l as any).id === 99), "client responses are not answered");
    assert.equal(lines.filter((l) => !Array.isArray(l) && (l as any).result?.tools).length, 0, "tools/list notification not answered");
    assert.match(byId(3).result.content[0].text, /ids must be an array of strings/);
    assert.match(byId(4).result.content[0].text, /mentions must be an array of objects/);
    assert.doesNotMatch(JSON.stringify(lines), /\n\s+at /, "no stack traces");
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
