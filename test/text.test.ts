import assert from "node:assert/strict";
import { test } from "node:test";
import { findSecret, cleanMeta } from "../src/core/secrets.ts";
import { globMatch } from "../src/core/project.ts";
import { blockAt, locate } from "../src/core/text.ts";

test("exact match picks the occurrence nearest the hint", () => {
  const c = "a\nWorks offline today.\nb\nc\nWorks offline today.\n";
  const r = locate(c, "Works offline today.", 5);
  assert.equal(r.best?.mode, "exact");
  assert.equal(r.best?.line, 5);
  assert.deepEqual(r.others, [2]);
});

test("normalized match survives reflow, tags, markdown and curly quotes", () => {
  const c = "<p>Runs <strong>on-device</strong>.\n   No audio\n leaves your “laptop”.</p>";
  const r = locate(c, 'Runs on-device. No audio leaves your "laptop".');
  assert.equal(r.best?.mode, "normalized");
  assert.equal(r.best?.line, 1);
  assert.match(c.slice(r.best!.start, r.best!.end), /^Runs <strong>on-device<\/strong>/);
});

test("fuzzy match finds edited wording and reports similarity", () => {
  const c = "intro\nEverything runs on your device, and no audio ever leaves the laptop.\noutro";
  const r = locate(c, "Everything runs on your device; no audio ever leaves your laptop.");
  assert.equal(r.best?.mode, "fuzzy");
  assert.equal(r.best?.line, 2);
  assert.ok(r.best!.similarity >= 0.7);
});

test("fuzzy match gives up on unrelated text", () => {
  const r = locate("totally different content here about cats and dogs", "Everything runs on your device; no audio leaves");
  assert.equal(r.best, undefined);
});

test("blockAt follows braces and indentation", () => {
  const ts = "function a() {\n  if (x) {\n    y();\n  }\n}\nconst z = 1;";
  assert.equal(blockAt(ts, 1).split("\n").length, 5);
  const py = "def a():\n    x = 1\n    return x\n\ndef b():\n    pass";
  assert.equal(blockAt(py, 1), "def a():\n    x = 1\n    return x");
});

test("secrets are detected, normal prose is not", () => {
  assert.ok(findSecret("key sk-abcdefghijklmnopqrstuvwxyz123456"));
  assert.ok(findSecret("ELEVENLABS_API_KEY=abcd1234efgh5678"));
  assert.ok(findSecret("token: 9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a"));
  assert.equal(findSecret("Everything runs on your device; no audio ever leaves your laptop."), undefined);
  assert.equal(findSecret("It never stores anything that looks like a secret: secret-looking anchors are refused."), undefined);
  assert.ok(findSecret("password: hunter2hunter2"));
  assert.deepEqual(cleanMeta({ tool: "elevenlabs", voice: "Rachel", api_key: "x", headers: "Bearer abcdefghijklmnop1234" }), { tool: "elevenlabs", voice: "Rachel" });
});

test("globs", () => {
  assert.ok(globMatch(".env.*", "app/.env.local"));
  assert.ok(globMatch("**/secrets/**", "config/secrets/a.json"));
  assert.ok(globMatch("**/secrets/**", "secrets/a.json"));
  assert.ok(!globMatch("*.key", "keyboard.ts"));
  assert.ok(globMatch("src/*.ts", "src/a.ts") && !globMatch("src/*.ts", "src/x/a.ts"));
  assert.ok(globMatch("id_rsa*", "home/.ssh/id_rsa.pub"));
});
