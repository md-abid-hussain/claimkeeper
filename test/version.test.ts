/** One version number: package.json is the source, the server reports it, the plugin manifest matches. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { connect } from "./mcp-client.ts";

const root = resolve(import.meta.dirname, "..");
const json = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), "utf8")) as { version: string };
const CLI = resolve(root, "plugin/dist/cli.js");

test("the server reports package.json's version, and the plugin manifest matches it", async () => {
  const version = json("package.json").version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(json("plugin/.claude-plugin/plugin.json").version, version, "plugin.json is edited by hand: it must match package.json");
  const { client, close } = await connect();
  try {
    assert.equal(client.getServerVersion()?.version, version);
  } finally {
    await close();
  }
});

test("the built bundle reports the same version without reading package.json at runtime", { skip: !existsSync(CLI) && "run npm run build first" }, async () => {
  const proc = spawn("node", [CLI, "mcp"], { cwd: resolve(root, "plugin/dist") }); // far from package.json
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n");
  await new Promise((r) => setTimeout(r, 1200));
  const exited = new Promise((r) => proc.on("exit", r));
  proc.stdin.end();
  await exited;
  assert.equal(JSON.parse(out.split("\n")[0]!).result.serverInfo.version, json("package.json").version);
});
