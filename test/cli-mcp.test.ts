/** Exercises the built artifact (plugin/dist) the way Claude Code runs it. `npm test` builds first. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { HACKATHON, makeProject, type Project } from "./helpers.ts";

const CLI = resolve(import.meta.dirname, "../plugin/dist/cli.js");

function cli(p: Project, args: string[], input?: string) {
  return spawnSync("node", [CLI, ...args], { cwd: p.root, input, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: p.root } });
}

describe("built CLI and MCP server", { skip: !existsSync(CLI) && "run npm run build first" }, () => {
  let p: Project;
  before(() => {
    p = makeProject(HACKATHON);
  });
  after(() => p.cleanup());

  test("CLI init / off / on / check / statusline", () => {
    assert.match(cli(p, ["check"]).stderr, /not initialized/);
    assert.equal(cli(p, ["statusline"], "{}").stdout, "", "no output in projects without claimkeeper");
    assert.match(cli(p, ["init"]).stdout, /Initialized claim tracking/);
    assert.match(cli(p, ["off", "--me"]).stdout, /tracking OFF/);
    assert.equal(cli(p, ["statusline"], JSON.stringify({ workspace: { project_dir: p.root } })).stdout, "claims off");
    assert.match(cli(p, ["on", "--me"]).stdout, /tracking ON/);
    const r = cli(p, ["check", "--ci"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /No issues/);
  });

  test("hook entry point reads stdin JSON and never fails the session", () => {
    const ok = cli(p, ["hook", "session-start"], JSON.stringify({ session_id: "s1", source: "startup" }));
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /additionalContext/);
    const bad = cli(p, ["hook", "post-tool-use"], "{not json");
    assert.equal(bad.status, 0);
    assert.match(bad.stderr, /skipped/);
  });

  test("MCP: initialize, 7 tools, full round trip, activity log", async (t) => {
    const proc = spawn("node", [CLI, "mcp"], { cwd: p.root, env: { ...process.env, CLAUDE_PROJECT_DIR: p.root } });
    t.after(() => proc.kill()); // a failed assertion must never leave the server running (it hangs the run)
    let buf = "";
    const waiting = new Map<number, (v: any) => void>();
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        waiting.get(msg.id)?.(msg);
      }
    });
    let id = 0;
    const call = (method: string, params?: unknown) =>
      new Promise<any>((res) => {
        const n = ++id;
        waiting.set(n, res);
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
      });
    const tool = async (name: string, args: unknown) => {
      const r = await call("tools/call", { name, arguments: args });
      return { text: r.result.content[0].text as string, isError: !!r.result.isError };
    };

    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await call("tools/list");
    assert.deepEqual(list.result.tools.map((t: any) => t.name).sort(), ["claim_add", "claim_get", "claim_update", "claims_check", "claims_config", "claims_in", "output"]);
    const schemaChars = JSON.stringify(list.result.tools).length;
    assert.ok(schemaChars < 10_000, `tool list should stay small, is ${schemaChars} chars`);

    const add = await tool("claim_add", {
      id: "fast-summary",
      desc: "Summaries arrive in under 2 seconds.",
      keywords: ["seconds", "summaries"],
      mentions: [{ path: "README.md", anchor: "Summaries arrive in under 2 seconds." }, { path: "nope.md", anchor: "does not matter here" }],
    });
    assert.match(add.text, /Added fast-summary/);
    assert.match(add.text, /fast-summary#m1 .*README\.md:8 +ok/);
    assert.match(add.text, /FAILED nope\.md: file not found/);

    const refused = await tool("claim_update", { claim: "fast-summary", desc: "Summaries arrive in under 3 seconds.", decided_by: "agent", why: "seems nicer" });
    assert.ok(refused.isError);
    assert.match(refused.text, /user's decision\. Ask the user/);
    const u = await tool("claim_update", { claim: "fast-summary", desc: "Summaries arrive in under 5 seconds.", decided_by: "user", why: "user: make it 5 seconds", edits: [{ mention: "m1", text: "Summaries arrive in under 5 seconds." }] });
    assert.match(u.text, /MEANING CHANGED \(rev 2, user decided: user: make it 5 seconds\)/);
    assert.match((await tool("claim_get", { ids: ["fast-summary"] })).text, /rev 1 \(.*\): "Summaries arrive in under 2 seconds\."/);
    assert.match((await tool("claim_get", {})).text, /fast-summary +rev 2/);
    assert.match((await tool("claim_update", { claim: "fast-summary", revert: 1, decided_by: "user", why: "user: back to 2 seconds" })).text, /MEANING CHANGED \(rev 3, user decided/);
    assert.match((await tool("claims_config", { action: "status" })).text, /tracking ON/);

    const err = await tool("claim_get", { ids: ["nope"] });
    assert.ok(err.isError);
    assert.match(err.text, /no claim "nope"/);
    const exited = new Promise((res) => proc.on("exit", res));
    proc.stdin.end();
    await exited;

    const log = cli(p, ["log"]).stdout;
    assert.match(log, /claim_add fast-summary created \+1 places \(1 failed\)/);
    assert.match(log, /claim_update fast-summary MEANING CHANGED \(user decided\)/);
  });
});
