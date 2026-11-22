/** A missing file is looked up in git (renames) before searching by name, size and wording. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { mentionLine } from "../src/core/format.ts";
import * as ops from "../src/core/ops.ts";
import { _resetGitCache, followRename } from "../src/core/project.ts";
import type { Store } from "../src/core/store.ts";
import { makeProject, type Project } from "./helpers.ts";

const SENTENCE = "Everything runs on your device and no audio ever leaves your laptop.";
const DOC = ["# Privacy", "", "Some intro text that stays the same across edits.", "More filler so git sees the rename.", "", SENTENCE, "", "Closing paragraph that is also unchanged.", "Another unchanged line.", ""].join("\n");

let p: Project;
let store: Store;
const git = (...args: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: p.root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  _resetGitCache(); // the cache is for a long-lived server: a test changes the repo between checks
};
const found = (): { gitRename?: string; candidates?: string[]; status: string } => {
  _resetGitCache();
  const m = ops.check(store, { searchMissing: true }).mentionIssues.find((r) => r.claim === "private");
  assert.ok(m, "the place is reported");
  return m;
};

describe("git rename detection", () => {
  beforeEach(() => {
    p = makeProject({ "docs/privacy.md": DOC });
    store = ops.init(p.root).store;
    ops.addClaimWithMentions(store, { id: "private", desc: "Audio never leaves the device.", mentions: [{ path: "docs/privacy.md", anchor: SENTENCE }] });
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });
  afterEach(() => p.cleanup());

  test("a committed rename is found even though the wording changed (search could not)", () => {
    git("mv", "docs/privacy.md", "docs/security.md");
    git("commit", "-q", "-m", "rename");
    p.write("docs/security.md", DOC.replace(SENTENCE, "Audio stays on this machine at all times."));
    git("commit", "-q", "-am", "reword");
    const r = found();
    assert.equal(r.status, "file_not_found");
    assert.equal(r.gitRename, "docs/security.md");
    assert.equal(r.candidates, undefined, "no guessing when git knows");
  });

  test("a rename that is staged but not committed counts", () => {
    git("mv", "docs/privacy.md", "docs/security.md");
    assert.equal(found().gitRename, "docs/security.md");
  });

  test("a chain of renames is followed to the file that exists now", () => {
    git("mv", "docs/privacy.md", "docs/security.md");
    git("commit", "-q", "-m", "first");
    git("mv", "docs/security.md", "docs/trust.md");
    git("commit", "-q", "-m", "second");
    assert.equal(found().gitRename, "docs/trust.md");
  });

  test("the suggestion is shown and relink accepts it", () => {
    git("mv", "docs/privacy.md", "docs/security.md");
    const r = found() as never as Parameters<typeof mentionLine>[0];
    assert.match(mentionLine(r, true), /git: renamed to docs\/security\.md \(claim_update edits \{mention, relink\}\)/);
    const res = ops.updateClaim(store, { claim: "private", edits: [{ mention: "m1", relink: "docs/security.md" }] });
    assert.equal(res.edits[0]!.ok, true, res.edits[0]!.message);
    _resetGitCache();
    assert.equal(ops.check(ops.requireStore(p.root), { searchMissing: true }).mentionIssues.length, 0);
  });

  test("a deleted file gets no suggestion and nothing crashes", () => {
    git("rm", "-q", "docs/privacy.md");
    const r = found();
    assert.equal(r.status, "file_not_found");
    assert.equal(r.gitRename, undefined);
    assert.equal(r.candidates, undefined);
  });

  test("a plain move git was not told about falls back to the wording search", () => {
    renameSync(join(p.root, "docs/privacy.md"), join(p.root, "docs/elsewhere.md"));
    const r = found();
    assert.equal(r.gitRename, undefined);
    assert.deepEqual(r.candidates, ["docs/elsewhere.md"]);
  });

  test("outside a git repository it falls back without errors", () => {
    const q = makeProject({ "a.md": DOC }, false);
    try {
      const s = ops.init(q.root).store;
      ops.addClaimWithMentions(s, { id: "private", desc: "Audio never leaves the device.", mentions: [{ path: "a.md", anchor: SENTENCE }] });
      renameSync(join(q.root, "a.md"), join(q.root, "b.md"));
      _resetGitCache();
      const m = ops.check(s, { searchMissing: true }).mentionIssues[0]!;
      assert.equal(m.gitRename, undefined);
      assert.deepEqual(m.candidates, ["b.md"]);
    } finally {
      q.cleanup();
    }
  });

  test("followRename follows chains and ignores paths that never moved", () => {
    const renames = [["a", "b"], ["b", "c"], ["x", "y"]] as const;
    assert.equal(followRename(renames, "a"), "c");
    assert.equal(followRename(renames, "x"), "y");
    assert.equal(followRename(renames, "q"), undefined);
  });
});

describe("keywords that went stale with the meaning", () => {
  beforeEach(() => {
    p = makeProject({ "README.md": "# App\n\nThe current version is 0.2.0 everywhere.\n" });
    store = ops.init(p.root).store;
    ops.addClaimWithMentions(store, { id: "version", desc: "The current version is 0.2.0.", keywords: ["version", "0.2.0", "release"], mentions: [{ path: "README.md", anchor: "The current version is 0.2.0 everywhere." }] });
  });
  afterEach(() => p.cleanup());

  test("a meaning change lists number keywords the new meaning no longer contains, and rewrites nothing", () => {
    const u = ops.updateClaim(store, { claim: "version", desc: "The current version is 0.5.1.", decidedBy: "user", why: "user: new release", edits: [{ mention: "m1", text: "The current version is 0.5.1 everywhere." }] });
    assert.deepEqual(u.staleKeywords, ["0.2.0"]);
    assert.deepEqual(ops.requireStore(p.root).getClaim("version").keywords, ["version", "0.2.0", "release"], "keywords are the user's: untouched");
  });

  test("it is silent when the keywords still fit, and for rewording", () => {
    assert.equal(ops.updateClaim(store, { claim: "version", edits: [{ mention: "m1", accept: true }] }).staleKeywords, undefined, "no meaning change");
    const u = ops.updateClaim(store, { claim: "version", desc: "The current version is 0.2.0, shown in the README.", decidedBy: "user", why: "user: clarify" });
    assert.equal(u.staleKeywords, undefined);
  });
});
