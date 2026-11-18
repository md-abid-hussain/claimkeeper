import assert from "node:assert/strict";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { readLog, statusText } from "../src/core/activity.ts";
import * as ops from "../src/core/ops.ts";
import type { Store } from "../src/core/store.ts";
import { diffClip, postToolUse, sessionStart, stop } from "../src/hooks/hooks.ts";
import { HACKATHON, makeProject, type Project } from "./helpers.ts";

let p: Project;
let store: Store;
const sid = "test-session";

const ctx = (out: unknown): string => (out as { hookSpecificOutput?: { additionalContext?: string } } | undefined)?.hookSpecificOutput?.additionalContext ?? "";

describe("hooks", () => {
  beforeEach(() => {
    p = makeProject(HACKATHON);
    process.env.CLAUDE_PROJECT_DIR = p.root;
  });
  afterEach(() => {
    delete process.env.CLAUDE_PROJECT_DIR;
    p.cleanup();
  });

  function init() {
    store = ops.init(p.root).store;
    ops.addClaimWithMentions(store, {
      id: "on-device",
      desc: "All processing runs on the user's device; no audio leaves it.",
      keywords: ["on-device", "audio", "laptop"],
      mentions: [
        { path: "README.md", anchor: "Everything runs on your device; no audio ever leaves your laptop." },
        { path: "video/voiceover.txt", anchor: "Everything runs on your device, so no audio ever leaves your laptop." },
      ],
    });
    p.write("public/vo.mp3", Buffer.from("mp3"));
    ops.recordOutput(store, { path: "public/vo.mp3", id: "voiceover", inputs: ["video/voiceover.txt"] });
  }

  test("meaning-change lines show where long sentences differ", () => {
    const base = "Hooks never change claims, their places or outputs; they write only git-ignored local files under .claims/local/";
    const [from, to] = diffClip(`${base}: session state.`, `${base} (session state), plus a debug log.`, 70);
    assert.notEqual(from, to);
    assert.match(to, /^….*plus a debug log/);
  });

  test("silent when the project never ran init (opt-in)", () => {
    assert.equal(sessionStart({ session_id: sid }), undefined);
    assert.equal(postToolUse({ session_id: sid, tool_name: "Read", tool_input: { file_path: join(p.root, "README.md") } }), undefined);
    assert.equal(stop({ session_id: sid }), undefined);
  });

  test("silent when turned off", () => {
    init();
    ops.toggle(store, { enabled: false }, "me");
    assert.equal(sessionStart({ session_id: sid }), undefined);
    p.write("README.md", "gone");
    assert.equal(postToolUse({ session_id: sid, tool_name: "Write", tool_input: { file_path: join(p.root, "README.md") } }), undefined);
    assert.equal(statusText(store), "claims off");
  });

  test("session start is a single line", () => {
    init();
    const out = ctx(sessionStart({ session_id: sid, source: "startup" }));
    assert.equal(out.split("\n").length, 1);
    assert.match(out, /Claim tracking is on: 1 claims\. Use the claims skill/);
  });

  test("reading a file with claims gives a one-line hint, once per session", () => {
    init();
    sessionStart({ session_id: sid, source: "startup" });
    const first = ctx(postToolUse({ session_id: sid, tool_name: "Read", tool_input: { file_path: join(p.root, "README.md") } }));
    assert.match(first, /README\.md holds claims: on-device l7 "All processing runs/);
    assert.equal(postToolUse({ session_id: sid, tool_name: "Read", tool_input: { file_path: join(p.root, "README.md") } }), undefined);
    assert.equal(postToolUse({ session_id: sid, tool_name: "Read", tool_input: { file_path: join(p.root, "src/engine.ts") } }), undefined, "no claims, no hint");
  });

  test("editing claim wording and a script is reported right away", () => {
    init();
    sessionStart({ session_id: sid, source: "startup" });
    p.write("video/voiceover.txt", "Everything runs on your device, but audio may be uploaded for better results.\n");
    const out = ctx(postToolUse({ session_id: sid, tool_name: "Edit", tool_input: { file_path: join(p.root, "video/voiceover.txt") } }));
    assert.match(out, /You changed claim wording in video\/voiceover\.txt/);
    assert.match(out, /out:voiceover public\/vo\.mp3 needs_regen/);
    assert.match(out, /ask the user before regenerating/);
    assert.match(readLog(store), /edit video\/voiceover\.txt: 1 drifted, 1 outputs stale/);
  });

  test("the same drift is reported once per session, not on every edit", () => {
    init();
    sessionStart({ session_id: sid, source: "startup" });
    p.write("video/voiceover.txt", "Everything runs on your device, but audio may be uploaded for better results.\n");
    const edit = () => ctx(postToolUse({ session_id: sid, tool_name: "Edit", tool_input: { file_path: join(p.root, "video/voiceover.txt") } }));
    assert.match(edit(), /You changed claim wording/);
    assert.equal(edit(), "", "unchanged problem: silent");
    p.write("video/voiceover.txt", "Everything runs on your device, but audio may be uploaded to our servers.\n");
    assert.match(edit(), /You changed claim wording/, "new state: reported again");
  });

  test("unrelated edits stay silent", () => {
    init();
    p.write("src/other.ts", "export const x = 1;\n");
    assert.equal(postToolUse({ session_id: sid, tool_name: "Write", tool_input: { file_path: join(p.root, "src/other.ts") }, tool_response: { type: "create" } }), undefined);
  });

  test("new files that repeat a claim get a nudge", () => {
    init();
    p.write("SUBMISSION.md", "Murmur keeps all audio on your laptop, fully on-device.\n");
    assert.match(ctx(postToolUse({ session_id: sid, tool_name: "Write", tool_input: { file_path: join(p.root, "SUBMISSION.md") }, tool_response: { type: "create" } })), /New file may repeat claims/);
  });

  test("media commands and generator MCP tools get a record nudge; deleted tracked files are reported", () => {
    init();
    assert.match(ctx(postToolUse({ session_id: sid, tool_name: "Bash", tool_input: { command: "npx remotion render Promo out/promo.mp4" } })), /output action=record/);
    p.rm("video/voiceover.txt");
    assert.match(ctx(postToolUse({ session_id: sid, tool_name: "Bash", tool_input: { command: "rm video/voiceover.txt" } })), /Tracked files gone[\s\S]*voiceover\.txt/);
    assert.match(ctx(postToolUse({ session_id: sid, tool_name: "mcp__elevenlabs__text_to_speech", tool_input: {} })), /output action=record/);
  });

  test("stop blocks once on NEW problems, including edits made outside Edit/Write", () => {
    init();
    sessionStart({ session_id: sid, source: "startup" });
    // e.g. a sed command or a script: no Edit hook fired
    p.write("README.md", p.read("README.md").replace("no audio ever leaves your laptop", "audio is processed in our cloud"));
    const first = stop({ session_id: sid }) as { decision?: string; reason?: string };
    assert.equal(first?.decision, "block");
    assert.match(first.reason!, /README\.md/);
    assert.equal(stop({ session_id: sid, stop_hook_active: true }), undefined, "never loops");
    assert.equal(stop({ session_id: sid }), undefined, "already reported: not blocked again");
    assert.match(statusText(store), /claims ⚠1/);
  });

  test("problems that existed before the session do not block", () => {
    init();
    p.write("README.md", "rewritten by hand\n");
    sessionStart({ session_id: sid, source: "startup" });
    assert.equal(stop({ session_id: sid }), undefined);
    assert.match(readLog(store), /stop: ok \(1 older issues\)/);
  });

  test("meaning changes are reminded once; warn mode does not block", () => {
    init();
    sessionStart({ session_id: sid, source: "startup" });
    ops.updateClaim(store, { claim: "on-device", desc: "Audio is processed on-device; summaries sync to the cloud.", decidedBy: "user", why: "user: add cloud sync" });
    ops.toggle(store, { stop: "warn" }, "project");
    const out = stop({ session_id: sid }) as { systemMessage?: string; decision?: string };
    assert.equal(out.decision, undefined);
    assert.match(out.systemMessage!, /Meaning changed[\s\S]*on-device/);
    assert.match(out.systemMessage!, /out:voiceover/);
    assert.equal(stop({ session_id: sid }), undefined);
  });
});
