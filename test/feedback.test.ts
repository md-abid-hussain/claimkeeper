/** Tool annotations, parallel sessions, editing after hand-rewording, and the size of what the agent reads. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import * as ops from "../src/core/ops.ts";
import type { Store } from "../src/core/store.ts";
import { sessionStart, stop } from "../src/hooks/hooks.ts";
import { INSTRUCTIONS } from "../src/mcp/server.ts";
import { TOOLS } from "../src/mcp/tools.ts";
import { HACKATHON, makeProject, type Project } from "./helpers.ts";
import { connect } from "./mcp-client.ts";

const CLI = resolve(import.meta.dirname, "../plugin/dist/cli.js");
const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

/** Every file under a folder with its size and mtime: any write changes it. */
function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      if (f === ".git") continue;
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${p}:${st.size}:${st.mtimeMs}:${readFileSync(p, "utf8").length}`);
    }
  };
  walk(dir);
  return out.join("\n");
}

describe("tool annotations", () => {
  test("tools/list declares all four hints as booleans on every tool", async () => {
    // through a real MCP client (the official SDK), as a host sees the server
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 7);
      for (const t of tools) {
        assert.ok(t.annotations, `${t.name} has annotations`);
        for (const h of HINTS) assert.equal(typeof t.annotations![h], "boolean", `${t.name}.${h} must be an explicit boolean`);
        assert.equal(typeof t.annotations!.title, "string");
        assert.equal(t.annotations!.openWorldHint, false, `${t.name} never touches anything outside the project`);
      }
      assert.equal(client.getServerVersion()?.name, "claimkeeper");
      assert.equal(client.getInstructions(), INSTRUCTIONS);
    } finally {
      await close();
    }
  });

  test("hints match what each tool does", () => {
    const readOnly = ["claim_get", "claims_check", "claims_in"];
    for (const t of TOOLS) {
      const a = t.annotations;
      assert.equal(a.readOnlyHint, readOnly.includes(t.name), `${t.name} readOnlyHint`);
      if (a.readOnlyHint) assert.ok(a.idempotentHint && !a.destructiveHint, `${t.name}: reading is idempotent and not destructive`);
    }
    // the two that can rewrite files, delete claims or stop tracking must warn
    assert.equal(tool("claim_update").annotations.destructiveHint, true);
    assert.equal(tool("output").annotations.destructiveHint, true);
    // setup and registration only add records
    assert.equal(tool("claim_add").annotations.destructiveHint, false);
    assert.equal(tool("claims_config").annotations.destructiveHint, false);
  });

  describe("read-only tools write nothing", () => {
    let p: Project;
    let store: Store;
    beforeEach(() => {
      p = makeProject(HACKATHON);
      process.env.CLAUDE_PROJECT_DIR = p.root;
      store = ops.init(p.root).store;
      ops.addClaimWithMentions(store, {
        id: "on-device",
        desc: "All processing runs on the user's device; no audio leaves it.",
        keywords: ["on-device", "laptop"],
        mentions: [{ path: "README.md", anchor: "Everything runs on your device; no audio ever leaves your laptop." }],
      });
    });
    afterEach(() => {
      delete process.env.CLAUDE_PROJECT_DIR;
      p.cleanup();
    });

    test("claim_get, claims_check, claims_in and claims_config status leave the project and .claims untouched", () => {
      const before = snapshot(p.root);
      assert.match(before, /README\.md/);
      assert.match(before, /on-device\.json/);
      tool("claim_get").run({});
      tool("claim_get").run({ ids: ["on-device"], view: "brief", context: 2 });
      tool("claims_check").run({});
      tool("claims_in").run({ path: "README.md", scan: true });
      tool("claims_config").run({ action: "status" });
      assert.equal(snapshot(p.root), before);
    });

    test("a writing tool does change the store (the snapshot would notice)", () => {
      const before = snapshot(p.root);
      tool("claim_add").run({ id: "second-claim", desc: "A second claim for the comparison." });
      assert.notEqual(snapshot(p.root), before);
    });
  });
});

describe("parallel sessions", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "ck-par-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  test("sessions registering places on the same claim at the same time keep every place", { skip: !existsSync(CLI) && "run npm run build first", timeout: 60_000 }, async () => {
    const sessions = 6;
    const each = 8;
    const lines = Array.from({ length: sessions * each }, (_, i) => `Feature number ${i} works the same on every device we support.`);
    writeFileSync(join(base, "README.md"), `# Doc\n\n${lines.join("\n")}\n`);
    const st = ops.init(base).store;
    ops.addClaimWithMentions(st, { id: "same-everywhere", desc: "Every feature works the same on every supported device." });

    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const runs = Array.from({ length: sessions }, (_, s) => {
      // each session is its own server process, as with parallel agent sessions
      const proc = spawn("node", [CLI, "mcp", "--root", base], { env });
      let out = "";
      proc.stdout.on("data", (d) => (out += d));
      const exited = new Promise<string>((done) => proc.on("exit", () => done(out)));
      const reqs = Array.from({ length: each }, (_, k) => {
        const anchor = lines[s * each + k];
        return JSON.stringify({ jsonrpc: "2.0", id: k + 1, method: "tools/call", params: { name: "claim_add", arguments: { id: "same-everywhere", mentions: [{ path: "README.md", anchor }] } } });
      });
      proc.stdin.write(reqs.join("\n") + "\n");
      return { proc, exited };
    });
    // let every process answer all of its requests, then close them
    await new Promise((r) => setTimeout(r, 4000));
    for (const r of runs) r.proc.stdin.end();
    const outputs = await Promise.all(runs.map((r) => r.exited));

    const failed = outputs.flatMap((o) => o.split("\n").filter((l) => l.includes("FAILED") || l.includes('"isError":true')));
    assert.deepEqual(failed, [], "no call failed");
    const claim = ops.requireStore(base).getClaim("same-everywhere");
    assert.equal(claim.mentions.length, sessions * each, "no session's places were overwritten");
    assert.equal(new Set(claim.mentions.map((m) => m.id)).size, sessions * each, "no two places share an id");
    assert.ok(!existsSync(join(base, ".claims", "store.lock")), "lock released");
  });

  test("a linked git worktree is named in status", () => {
    const wt = join(base, "wt");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, ".git"), "gitdir: ../main/.git/worktrees/wt\n");
    ops.init(wt);
    process.env.CLAIMKEEPER_ROOT = wt;
    try {
      assert.match(tool("claims_config").run({ action: "status" }), /Linked git worktree: claim changes made here live on this branch/);
    } finally {
      delete process.env.CLAIMKEEPER_ROOT;
    }
  });
});

describe("editing after the files were reworded by hand", () => {
  let p: Project;
  let store: Store;
  beforeEach(() => {
    p = makeProject(HACKATHON);
    process.env.CLAUDE_PROJECT_DIR = p.root;
    store = ops.init(p.root).store;
    ops.addClaimWithMentions(store, {
      id: "on-device",
      desc: "All processing runs on the user's device; no audio leaves it.",
      mentions: [
        { path: "README.md", anchor: "Everything runs on your device; no audio ever leaves your laptop." },
        { path: "video/voiceover.txt", anchor: "Everything runs on your device, so no audio ever leaves your laptop." },
        { path: "site/index.html", anchor: "Runs on-device. No audio leaves your laptop." },
      ],
    });
  });
  afterEach(() => {
    delete process.env.CLAUDE_PROJECT_DIR;
    p.cleanup();
  });

  test("anchor points a place at wording the file already has, without rewriting the file", () => {
    p.write("README.md", p.read("README.md").replace("Everything runs on your device; no audio ever leaves your laptop.", "All audio stays on your laptop, always."));
    assert.equal(ops.check(store).mentionIssues.length, 1);
    const before = p.read("README.md");
    const r = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: "m1", anchor: "All audio stays on your laptop, always." }] });
    assert.equal(r.edits[0]!.ok, true, r.edits[0]!.message);
    assert.match(r.edits[0]!.message, /re-anchored README\.md:7/);
    assert.equal(p.read("README.md"), before, "the file is not touched");
    assert.equal(ops.check(store).mentionIssues.length, 0);
    assert.equal(store.getClaim("on-device").mentions[0]!.anchor, "All audio stays on your laptop, always.");
  });

  test("anchor refuses wording that is not in the file, and the old errors point to it", () => {
    p.write("README.md", p.read("README.md").replace("Everything runs on your device; no audio ever leaves your laptop.", "All audio stays on your laptop, always."));
    const bad = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: "m1", anchor: "Words that are nowhere in the file." }] }).edits[0]!;
    assert.equal(bad.ok, false);
    assert.match(bad.message, /not in README\.md/);
    const text = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: "m1", text: "Audio never leaves your laptop." }] }).edits[0]!;
    assert.match(text.message, /anchor/);
    const accept = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: "m1", accept: true }] }).edits[0]!;
    assert.match(accept.message, /anchor/);
    const two = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: "m1", anchor: "All audio stays on your laptop, always.", accept: true }] }).edits[0]!;
    assert.match(two.message, /exactly one of/);
  });

  test("accept_all confirms the remaining places in the same call as the new meaning, and leaves missing ones", () => {
    p.write("site/index.html", p.read("site/index.html").replace("Runs on-device. No audio leaves your laptop.", "Runs on-device. Audio never leaves your laptop."));
    p.write("video/voiceover.txt", "Totally different text now.\n");
    const r = ops.updateClaim(store, {
      claim: "on-device",
      desc: "All processing runs on the user's device; summaries may sync to the cloud.",
      decidedBy: "user",
      why: "user: add sync",
      acceptAll: true,
      edits: [{ mention: "m1", accept: true }],
    });
    assert.equal(r.accepted?.count, 1, "the changed html place was confirmed");
    assert.deepEqual(r.accepted?.left.map((l) => l.split(" ")[0]), ["m2"], "the place whose wording is gone is left for a decision");
    assert.deepEqual(r.staleMentions.map((m) => m.mention.id), ["m2"]);
    const text = tool("claim_update").run({ claim: "on-device", accept_all: true, edits: [{ mention: "m2", remove: true }] });
    assert.match(text, /accept_all: confirmed 0 places/);
    assert.equal(ops.check(ops.requireStore(p.root)).mentionIssues.length, 0, "nothing is left over");
  });
});

describe("what the agent reads stays small", () => {
  let p: Project;
  let store: Store;
  const PLACES = 19;
  beforeEach(() => {
    const lines = Array.from({ length: PLACES }, (_, i) => `Place ${i} says that every recording stays on this laptop and never leaves it.`);
    p = makeProject({ "doc.md": `# Doc\n\n${lines.join("\n")}\n` });
    process.env.CLAUDE_PROJECT_DIR = p.root;
    store = ops.init(p.root).store;
    ops.addClaimWithMentions(store, {
      id: "stays-local",
      desc: "Recordings stay on the laptop.",
      mentions: lines.map((anchor) => ({ path: "doc.md", anchor })),
    });
  });
  afterEach(() => {
    delete process.env.CLAUDE_PROJECT_DIR;
    p.cleanup();
  });

  test("a meaning change shows a few stale places in full and the rest by id", () => {
    const text = tool("claim_update").run({ claim: "stays-local", desc: "Recordings stay on the laptop unless the user exports them.", decided_by: "user", why: "user: allow export" });
    assert.match(text, /Still saying the old meaning \(19\)/);
    assert.match(text, /\+14 more, wording not shown: doc\.md m6,m7/);
    assert.equal((text.match(/confirmed for old meaning/g) ?? []).length, 0, "the old meaning is printed once, in the MEANING CHANGED block, not on every place");
    assert.equal((text.match(/Recordings stay on the laptop\./g) ?? []).length, 1);
    assert.ok(text.length < 2500, `output is ${text.length} chars`);
  });

  test("a list of stale places prints each old meaning once", () => {
    tool("claim_update").run({ claim: "stays-local", desc: "Recordings stay on the laptop unless exported.", decided_by: "user", why: "user: allow export" });
    const check = tool("claims_check").run({});
    assert.equal((check.match(/confirmed for old meaning/g) ?? []).length, 1, "claims_check shows it on the first place only");
    assert.equal((check.match(/STALE\(rev 1\)/g) ?? []).length, 19, "every place is still listed");
  });

  test("the Stop hook counts places that still carry a just-changed meaning instead of listing them again", () => {
    process.env.CLAUDE_PROJECT_DIR = p.root;
    sessionStart({ session_id: "s", source: "startup" });
    tool("claim_update").run({ claim: "stays-local", desc: "Recordings stay on the laptop unless exported.", decided_by: "user", why: "user: allow export" });
    const out = stop({ session_id: "s" }) as { decision?: string; reason?: string; systemMessage?: string };
    assert.equal(out.decision, "block", "stale places are still a real problem");
    assert.match(out.reason!, /stays-local: 19 places still say the old meaning \(m1, m2, m3, m4, m5, m6, m7, m8, …\)/);
    assert.doesNotMatch(out.reason!, /Place 3 says/, "no place is listed again");
    assert.ok(out.reason!.length < 700, `Stop output is ${out.reason!.length} chars`);
  });

  test("a place that only moved is re-pinned by the next write to its claim, so the arrow clears", () => {
    p.write("doc.md", `# Doc\n\nA new intro paragraph.\n\nAnother new paragraph.\n\n${p.read("doc.md").split("\n").slice(2).join("\n")}`);
    assert.match(tool("claim_get").run({ ids: ["stays-local"], view: "full" }), /doc\.md:3→\d+/, "the move is visible before");
    const readOnly = tool("claim_get").run({ ids: ["stays-local"], view: "full" });
    assert.match(readOnly, /→/, "reading never writes");
    tool("claim_update").run({ claim: "stays-local", keywords: ["laptop", "recordings"] });
    assert.doesNotMatch(tool("claim_get").run({ ids: ["stays-local"], view: "full" }), /→/, "arrows are gone");
    assert.equal(ops.check(ops.requireStore(p.root)).mentionIssues.length, 0);
  });

  test("claim_add dry_run reports what would happen and writes nothing", () => {
    const before = snapshot(p.root);
    const text = tool("claim_add").run({
      id: "second-claim",
      desc: "A second claim.",
      mentions: [{ path: "doc.md", anchor: "Place 4 says that every recording stays on this laptop and never leaves it." }, { path: "missing.md", anchor: "does not exist anywhere" }],
      dry_run: true,
    });
    assert.match(text, /^DRY RUN, nothing was written/);
    assert.match(text, /Added second-claim/);
    assert.match(text, /FAILED missing\.md: file not found/);
    assert.equal(snapshot(p.root), before, "the store is exactly as it was");
    assert.ok(!existsSync(join(p.root, ".claims/claims/second-claim.json")));
    const real = tool("claim_add").run({ id: "second-claim", desc: "A second claim.", mentions: [{ path: "doc.md", anchor: "Place 4 says that every recording stays on this laptop and never leaves it." }] });
    assert.match(real, /^Added second-claim/);
    assert.ok(existsSync(join(p.root, ".claims/claims/second-claim.json")), "the real call does write");
  });

  test("claim_get is brief for a claim with many places, full on request", () => {
    const brief = tool("claim_get").run({ ids: ["stays-local"] });
    assert.match(brief, /ok \(19, wording hidden/);
    assert.doesNotMatch(brief, /Place 3 says/);
    assert.ok(brief.length < 1200, `brief view is ${brief.length} chars`);
    assert.match(tool("claim_get").run({ ids: ["stays-local"], view: "full" }), /Place 3 says/);
    assert.match(tool("claim_get").run({ ids: ["stays-local"], context: 1 }), /Place 3 says/, "context implies the full view");
    assert.throws(() => tool("claim_get").run({ ids: ["stays-local"], view: "huge" }), /view must be/);
  });

  test("places that need attention are always shown in full, even in the brief view", () => {
    p.write("doc.md", p.read("doc.md").replace("Place 3 says that every recording stays on this laptop and never leaves it.", "Place 3 now says recordings are uploaded."));
    const text = tool("claim_get").run({ ids: ["stays-local"] });
    assert.match(text, /m4 .*text_not_found/);
    assert.match(text, /missing wording: "Place 3 says/);
    assert.match(text, /ok \(18, wording hidden/);
  });

  test("tool definitions and server instructions stay small", async () => {
    const { client, close } = await connect();
    const size = JSON.stringify((await client.listTools()).tools).length;
    await close();
    assert.ok(size < 10_000, `tools/list is ${size} bytes (the SDK adds about 120 per tool)`);
    assert.ok(INSTRUCTIONS.split(/\s+/).length < 60, "server instructions are one short paragraph");
    assert.doesNotMatch(INSTRUCTIONS, /skill|Claude/i, "instructions work in any MCP client");
  });
});
