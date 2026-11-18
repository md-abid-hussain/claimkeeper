import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { formatCheck, formatClaimViews, formatUpdate } from "../src/core/format.ts";
import * as ops from "../src/core/ops.ts";
import type { Store } from "../src/core/store.ts";
import { FAKE } from "./fakes.ts";
import { HACKATHON, makeProject, type Project } from "./helpers.ts";

let p: Project;
let store: Store;

function setup(git = true) {
  p = makeProject(HACKATHON, git);
  store = ops.init(p.root).store;
  ops.addClaim(store, { id: "on-device", desc: "All processing runs on the user's device; no audio leaves it.", keywords: ["on-device", "device", "audio", "laptop"] });
  ops.addMention(store, { claim: "on-device", path: "README.md", anchor: "Everything runs on your device; no audio ever leaves your laptop." });
  ops.addMention(store, { claim: "on-device", path: "site/index.html", anchor: "Runs on-device. No audio leaves your laptop." });
  ops.addMention(store, { claim: "on-device", path: "video/voiceover.txt", anchor: "Everything runs on your device, so no audio ever leaves your laptop." });
  ops.addMention(store, { claim: "on-device", path: "public/hero.svg", anchor: "100% on-device" });
  ops.addMention(store, { claim: "on-device", path: "video/Promo.tsx", anchor: "No audio leaves your laptop" });
  ops.addMention(store, { claim: "on-device", path: "src/engine.ts", kind: "code", anchor: "export function transcribe(audio: Buffer) {" });
}

function statuses(): Record<string, string> {
  const v = ops.getClaims(store, ["on-device"])[0]!;
  return Object.fromEntries(v.mentions.map((r) => [r.mention.path, r.status + (r.stale ? "+stale" : "")]));
}

describe("claims and mentions", () => {
  beforeEach(() => setup());
  afterEach(() => p.cleanup());

  test("init writes a committed store with ignored local/", () => {
    assert.match(readFileSync(join(p.root, ".claims/.gitignore"), "utf8"), /^local\/$/m);
    assert.ok(existsSync(join(p.root, ".claims/claims/on-device.json")));
    const s = statuses();
    assert.equal(s["README.md"], "ok");
    assert.equal(s["public/hero.svg"], "ok");
    assert.equal(s["src/engine.ts"], "ok");
  });

  test("lines moving, reflow, edits, deletion and renames are all reported, never fatal", () => {
    p.write("README.md", "New intro line\n\n" + p.read("README.md"));
    p.write("site/index.html", p.read("site/index.html").replace("Runs on-device. No audio", "Runs <b>on-device</b>.\n    No audio"));
    p.write("video/voiceover.txt", "Murmur listens. Everything runs on your device, but some audio may be sent to our servers.\n");
    p.write("video/Promo.tsx", p.read("video/Promo.tsx").replace("No audio leaves your laptop", "Private by design"));
    renameSync(join(p.root, "public/hero.svg"), join(p.root, "public/hero-v2.svg"));
    const v = ops.getClaims(store, ["on-device"])[0]!;
    const by = Object.fromEntries(v.mentions.map((r) => [r.mention.path, r]));
    assert.equal(by["README.md"]!.status, "moved");
    assert.equal(by["README.md"]!.line, 9);
    assert.equal(by["site/index.html"]!.status, "reformatted");
    assert.equal(by["video/voiceover.txt"]!.status, "changed");
    assert.match(by["video/voiceover.txt"]!.current!, /servers/);
    assert.equal(by["video/Promo.tsx"]!.status, "text_not_found");
    assert.equal(by["public/hero.svg"]!.status, "file_not_found");
    assert.deepEqual(by["public/hero.svg"]!.candidates, ["public/hero-v2.svg"]);
    // the formatted view mentions everything a model needs
    const text = formatClaimViews([v]);
    assert.match(text, /README\.md:7→9/);
    assert.match(text, /maybe moved to: public\/hero-v2\.svg/);
  });

  test("a removed short line is not fuzzy-matched onto another tracked line", () => {
    p.write("docs/cli.md", "Setup: npx murmur init\n\nUsage:\nnpx murmur status --json\n");
    ops.addClaim(store, { id: "cli", desc: "The CLI runs with npx." });
    ops.addMention(store, { claim: "cli", path: "docs/cli.md", anchor: "Setup: npx murmur init" });
    const st = ops.addMention(store, { claim: "cli", path: "docs/cli.md", anchor: "npx murmur status --json" });
    p.write("docs/cli.md", "Setup: npx murmur init\n\nUsage: see above.\n");
    const r = ops.getClaims(store, ["cli"])[0]!.mentions.find((x) => x.mention.id === st.mention.id)!;
    assert.equal(r.status, "text_not_found");
  });

  test("relink and remove through claim_update edits", () => {
    renameSync(join(p.root, "public/hero.svg"), join(p.root, "public/hero-v2.svg"));
    const svg = store.mentions("on-device").find((r) => r.mention.path === "public/hero.svg")!.mention.id;
    const code = store.mentions("on-device").find((r) => r.mention.path === "src/engine.ts")!.mention.id;
    const u = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: svg, relink: "public/hero-v2.svg" }, { mention: code, remove: true }] });
    assert.ok(u.edits.every((e) => e.ok), JSON.stringify(u.edits));
    assert.equal(statuses()["public/hero-v2.svg"], "ok");
    assert.equal(statuses()["src/engine.ts"], undefined);
  });

  test("claim_add creates with mentions, extends existing claims, refuses silent meaning changes", () => {
    p.write("docs/pitch.md", "Murmur is fast: summaries arrive in under 2 seconds.\n");
    const r = ops.addClaimWithMentions(store, {
      id: "fast",
      desc: "Summaries arrive in under 2 seconds.",
      mentions: [{ path: "README.md", anchor: "Summaries arrive in under 2 seconds." }, { path: "nope.md", anchor: "whatever wording" }],
    });
    assert.equal(r.created, true);
    assert.deepEqual(r.mentions.map((m) => m.ok), [true, false]);
    const more = ops.addClaimWithMentions(store, { id: "fast", mentions: [{ path: "docs/pitch.md", anchor: "summaries arrive in under 2 seconds." }] });
    assert.equal(more.created, false);
    assert.equal(store.mentions("fast").length, 2);
    assert.throws(() => ops.addClaimWithMentions(store, { id: "fast", desc: "Summaries arrive in under 5 seconds." }), /different meaning/);
    assert.throws(() => ops.addClaimWithMentions(store, { id: "brand-new" }), /desc is required/);
  });

  test("code mentions report when the code behind the claim changes", () => {
    p.write("src/engine.ts", p.read("src/engine.ts").replace("return localModel.run(audio);", "return fetch('https://api.example.com', { body: audio });"));
    assert.equal(statuses()["src/engine.ts"], "code_changed");
    p.write("src/engine.ts", p.read("src/engine.ts").replace("export const other = 1;", "export const other = 2;"));
    assert.equal(statuses()["src/engine.ts"], "code_changed", "unrelated code outside the block does not matter, block still differs");
  });

  test("batch rewording: different text per place, meaning and revision unchanged", () => {
    const ids = Object.fromEntries(store.mentions("on-device").map((r) => [r.mention.path, r.mention.id]));
    const u = ops.updateClaim(store, {
      claim: "on-device",
      edits: [
        { mention: ids["site/index.html"]!, text: "100% on-device. Your audio stays home." },
        { mention: ids["README.md"]!, text: "All transcription and summarizing happen locally; your audio never leaves your laptop." },
      ],
    });
    assert.equal(u.meaning, undefined);
    assert.ok(u.edits.every((e) => e.ok), JSON.stringify(u.edits));
    assert.match(p.read("site/index.html"), /<p>100% on-device\. Your audio stays home\.<\/p>/);
    assert.match(p.read("README.md"), /happen locally/);
    assert.equal(store.getClaim("on-device").rev, 1);
    assert.equal(statuses()["site/index.html"], "ok");
  });

  test("editing a drifted mention needs the exact old text", () => {
    p.write("video/voiceover.txt", "Everything runs on your device, and no audio ever leaves the laptop.\n");
    const id = store.mentions("on-device").find((r) => r.mention.path === "video/voiceover.txt")!.mention.id;
    const bad = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: id, text: "x".repeat(20) }] });
    assert.equal(bad.edits[0]!.ok, false);
    const good = ops.updateClaim(store, {
      claim: "on-device",
      edits: [{ mention: id, old: "Everything runs on your device, and no audio ever leaves the laptop.", text: "It all runs on your device. No audio leaves your laptop." }],
    });
    assert.equal(good.edits[0]!.ok, true, good.edits[0]!.message);
    assert.equal(p.read("video/voiceover.txt"), "It all runs on your device. No audio leaves your laptop.\n");
  });

  test("meaning change makes every unconfirmed mention stale; revert restores them", () => {
    const ids = Object.fromEntries(store.mentions("on-device").map((r) => [r.mention.path, r.mention.id]));
    const u = ops.updateClaim(store, {
      claim: "on-device",
      desc: "Audio is processed on-device; only anonymous summaries sync to the cloud.",
      decidedBy: "user",
      why: "user: anonymous summaries sync",
      edits: [{ mention: ids["README.md"]!, text: "Audio is processed on your device; only anonymous summaries sync." }],
    });
    assert.equal(u.meaning?.rev, 2);
    assert.equal(u.staleMentions.length, 5);
    assert.ok(!u.staleMentions.some((r) => r.mention.path === "README.md"));
    assert.match(formatUpdate(u), /MEANING CHANGED \(rev 2, user decided: .*\) — tell the user/);

    const r = ops.revertClaim(store, { claim: "on-device", rev: 1, decidedBy: "user", why: "user: go back" });
    assert.equal(r.meaning?.rev, 3);
    const s = statuses();
    assert.equal(s["site/index.html"], "ok", "confirmed for rev 1 = same meaning as rev 3");
    assert.equal(s["README.md"], "ok+stale", "README was confirmed for rev 2, which is no longer the meaning");
  });

  test("accept and ack", () => {
    p.write("video/voiceover.txt", "Everything runs on your device, and no audio ever leaves the laptop.\n");
    const id = store.mentions("on-device").find((r) => r.mention.path === "video/voiceover.txt")!.mention.id;
    assert.equal(ops.check(store).mentionIssues.length, 1);
    ops.updateClaim(store, { claim: "on-device", edits: [{ mention: id, ack: "user will rewrite the script" }] });
    assert.equal(ops.check(store).mentionIssues.length, 0, "acked");
    assert.equal(ops.check(store).mentionAcked.length, 1, "but still listed as pending");
    assert.match(formatCheck(ops.check(store)), /Acknowledged, still pending \(1\)[\s\S]*user will rewrite the script/);
    p.write("video/voiceover.txt", "Everything runs on your device, so audio rarely leaves the laptop.\n");
    assert.equal(ops.check(store).mentionIssues.length, 1, "ack lapses when the state changes");
    ops.updateClaim(store, { claim: "on-device", edits: [{ mention: id, accept: true }] });
    assert.equal(ops.check(store).mentionIssues.length, 0);
    assert.equal(statuses()["video/voiceover.txt"], "ok");
  });

  test("anchors must exist, be unique and not be secrets; secret files are never tracked", () => {
    p.write("docs/a.md", `Fast and private. Fast and private.\n${FAKE.skAssignment}\n`);
    p.write(".env", "ELEVENLABS_API_KEY=abc\n");
    assert.throws(() => ops.addMention(store, { claim: "on-device", path: "docs/a.md", anchor: "not in the file at all" }), /not found/);
    assert.throws(() => ops.addMention(store, { claim: "on-device", path: "docs/a.md", anchor: "Fast and private." }), /appears 2 times/);
    assert.throws(() => ops.addMention(store, { claim: "on-device", path: "docs/a.md", anchor: FAKE.skAssignment }), /secret/);
    assert.throws(() => ops.addMention(store, { claim: "on-device", path: ".env", anchor: "ELEVENLABS_API_KEY=abc" }), /exclude/);
    assert.throws(() => ops.addMention(store, { claim: "on-device", path: "missing.md", anchor: "whatever text here" }), /file not found/);
    assert.throws(() => ops.addClaim(store, { id: "Bad Id", desc: "x" }), /invalid claim id/);
  });

  test("a place registered as conflicting stays flagged until its wording is fixed", () => {
    p.write("docs/faq.md", "Q: Does audio leave my laptop?\nA: Audio is uploaded for transcription.\n");
    const r = ops.addMention(store, { claim: "on-device", path: "docs/faq.md", anchor: "Audio is uploaded for transcription.", conflict: "says audio is uploaded" });
    assert.equal(r.stale, true);
    // registered on purpose: waits for the user (pending), doesn't block, still marked CONFLICT
    assert.equal(ops.check(store).mentionIssues.length, 0);
    assert.match(formatCheck(ops.check(store)), /Acknowledged, still pending[\s\S]*conflict registered, awaiting the user's decision: says audio is uploaded/);
    assert.match(formatClaimViews(ops.getClaims(store, ["on-device"])), /CONFLICT[\s\S]*registered as contradicting this claim/);
    // the place changing again lapses the acknowledgment
    p.write("docs/faq.md", "Q: Does audio leave my laptop?\nA: Audio is uploaded for transcription and storage.\n");
    assert.equal(ops.check(store).mentionIssues.length, 1);
    const fixed = ops.updateClaim(store, { claim: "on-device", edits: [{ mention: r.mention.id, old: "Audio is uploaded for transcription and storage.", text: "No. Audio is transcribed on your device." }] });
    assert.ok(fixed.edits[0]!.ok, fixed.edits[0]!.message);
    assert.equal(ops.check(store).mentionIssues.length, 0);
    assert.equal(store.findMention("on-device", r.mention.id).mention.note, undefined, "conflict note cleared once fixed");
  });

  test("scan suggests unregistered mentions in a new file", () => {
    p.write("SUBMISSION.md", "# Murmur\n\nMurmur is fast.\nIt runs fully on-device and keeps audio on your laptop.\n");
    const hits = ops.scanFile(store, "SUBMISSION.md");
    assert.ok(hits.some((h) => h.claim === "on-device" && h.line === 4), JSON.stringify(hits));
  });
});

describe("generated outputs", () => {
  beforeEach(() => setup());
  afterEach(() => p.cleanup());

  function generate() {
    p.write("public/vo.mp3", Buffer.from("fake-mp3-" + p.read("video/voiceover.txt")));
    ops.recordOutput(store, { path: "public/vo.mp3", id: "voiceover", inputs: ["video/voiceover.txt"], meta: { tool: "elevenlabs", voice: "Rachel", xi_api_key: "nope" } });
    p.write("out/promo.mp4", Buffer.from("fake-mp4-" + p.read("video/Promo.tsx")));
    ops.recordOutput(store, { path: "out/promo.mp4", id: "promo", inputs: ["video/Promo.tsx", "out:voiceover", "public/hero.svg"], meta: { tool: "remotion" } });
  }

  test("outputs inherit claims, drop secret meta, and git-ignored ones are stored locally", () => {
    generate();
    const all = store.allOutputs();
    const vo = all.find((o) => o.output.id === "voiceover")!;
    const promo = all.find((o) => o.output.id === "promo")!;
    assert.deepEqual(vo.output.claims, { "on-device": 1 });
    assert.deepEqual(vo.output.meta, { tool: "elevenlabs", voice: "Rachel" });
    assert.equal(vo.local, false);
    assert.equal(promo.local, true, "out/ is git-ignored");
    assert.ok(existsSync(join(p.root, ".claims/local/outputs.json")));
    assert.equal(ops.check(store).outputIssues.length, 0);
  });

  test("script change -> audio needs regen -> video needs regen (chain); re-record clears it", () => {
    generate();
    p.write("video/voiceover.txt", p.read("video/voiceover.txt") + "Try it today.\n");
    const res = ops.check(store);
    const by = Object.fromEntries(res.outputIssues.map((o) => [o.output.id, o]));
    assert.equal(by.voiceover?.status, "needs_regen");
    assert.equal(by.promo?.status, "needs_regen");
    assert.ok(by.promo!.reasons.some((r) => r.includes("upstream out:voiceover")));
    assert.match(formatCheck(res), /Do not regenerate without the user's approval/);

    // user approves: regenerate audio, re-record; video still needs a render
    p.write("public/vo.mp3", Buffer.from("fake-mp3-v2"));
    ops.recordOutput(store, { path: "public/vo.mp3", inputs: ["video/voiceover.txt"] });
    const after = ops.check(store).outputIssues.map((o) => o.output.id);
    assert.deepEqual(after, ["promo"], "audio input of the video changed");
  });

  test("meaning change marks outputs stale; user declines -> ack", () => {
    generate();
    ops.updateClaim(store, { claim: "on-device", desc: "Audio is processed on-device; summaries sync to the cloud.", decidedBy: "user", why: "user: add sync" });
    const res = ops.check(store);
    assert.deepEqual(res.outputIssues.map((o) => o.status).sort(), ["stale", "stale"]);
    ops.ackOutput(store, { id: "promo", note: "user re-records the video tomorrow" });
    assert.deepEqual(ops.check(store).outputIssues.map((o) => o.output.id), ["voiceover"]);
  });

  test("after a meaning change, outputs built from re-confirmed unchanged inputs are not stale", () => {
    p.write("dist/README.md", p.read("README.md"));
    ops.recordOutput(store, { path: "dist/README.md", id: "readme-copy", inputs: ["README.md"] });
    const readme = store.mentions("on-device").find((r) => r.mention.path === "README.md")!.mention.id;
    ops.updateClaim(store, { claim: "on-device", desc: "All processing runs on the user's device (audio and text); nothing leaves it.", decidedBy: "user_request", why: "follows from text support", edits: [{ mention: readme, accept: true }] });
    const copy = ops.check(store).outputIssues.find((o) => o.output.id === "readme-copy");
    assert.equal(copy, undefined, "README wording was confirmed for the new meaning and did not change");
  });

  test("output regenerated without recording, and deleted outputs", () => {
    generate();
    p.write("public/vo.mp3", Buffer.from("something else"));
    const vo = ops.check(store).outputIssues.find((o) => o.output.id === "voiceover");
    assert.equal(vo?.status, "changed");
    p.rm("out/promo.mp4");
    const promo = ops.check(store).outputIssues.find((o) => o.output.id === "promo");
    assert.equal(promo?.status, "not_generated");
  });

  test("works without git: everything in one store", () => {
    p.cleanup();
    setup(false);
    generate();
    assert.ok(store.allOutputs().every((o) => !o.local));
  });
});

describe("on/off", () => {
  beforeEach(() => setup());
  afterEach(() => p.cleanup());

  test("config files hold only overrides, so new defaults reach existing projects", () => {
    ops.toggle(store, { stop: "warn" }, "project");
    const raw = JSON.parse(readFileSync(join(p.root, ".claims/config.json"), "utf8"));
    assert.deepEqual(raw, { version: 1, share: true, stop: "warn" });
    assert.equal(store.config().minAnchor, 10, "default filled in at read time");
  });

  test("personal override beats project config", () => {
    ops.toggle(store, { enabled: false }, "me");
    assert.equal(store.config().enabled, false);
    assert.equal(store.sharedConfig().enabled, true);
    ops.toggle(store, { enabled: true }, "me");
    ops.toggle(store, { stop: "warn" }, "project");
    assert.equal(store.config().stop, "warn");
  });

  test("private store ignores everything", () => {
    ops.init(p.root, false);
    assert.equal(readFileSync(join(p.root, ".claims/.gitignore"), "utf8").trim().split("\n").pop(), "*");
  });
});
