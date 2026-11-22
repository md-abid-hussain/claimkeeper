#!/usr/bin/env node
import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import {
  ClaimsError,
  STORE_DIR,
  Store,
  check,
  claimsIn,
  clip,
  defaultRoot,
  findRoot,
  formatCheck,
  formatClaimViews,
  formatConfig,
  formatInFile,
  formatList,
  formatScan,
  getClaims,
  hashText,
  init,
  isUrl,
  issueKeys,
  listClaims,
  logActivity,
  mentionIsIssue,
  mentionLine,
  outputIsIssue,
  outputLine,
  projectRoot,
  readLog,
  refreshState,
  relPath,
  requireStore,
  safeAbsPath,
  scanFile,
  statusText,
  toggle
} from "./chunks/chunk-FJCQI5AX.js";

// src/cli.ts
import { resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/core/githook.ts
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
var START = "# >>> claimkeeper >>>";
var END = "# <<< claimkeeper <<<";
function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : void 0;
}
function block(cliPath) {
  const cli = cliPath.replace(/\\/g, "/");
  return [
    START,
    "# Blocks the commit when tracked claims need attention. Bypass once: git commit --no-verify",
    `CK_CLI="${cli}"`,
    'CK_ROOT="$(git rev-parse --show-toplevel)"',
    'if [ -f "$CK_ROOT/.claims/config.json" ]; then',
    '  if [ -f "$CK_CLI" ]; then',
    '    CLAIMKEEPER_ROOT="$CK_ROOT" node "$CK_CLI" check --ci --if-enabled || {',
    '      echo "claimkeeper: tracked claims need attention (above). Fix them, acknowledge them, or commit with --no-verify." >&2',
    "      exit 1",
    "    }",
    "  else",
    '    echo "claimkeeper: pre-commit check skipped: $CK_CLI not found (claimkeeper moved or was updated). Run install-git-hook again." >&2',
    "  fi",
    "fi",
    END
  ].join("\n");
}
function hookFile(root) {
  if (!git(root, ["rev-parse", "--is-inside-work-tree"])) throw new ClaimsError(`${root} is not a git repository`);
  const custom = git(root, ["config", "--get", "core.hooksPath"]);
  if (custom) {
    return { manual: `core.hooksPath is set (${custom}): add this to your pre-commit hook manually:

${block("<path-to-claimkeeper>/plugin/dist/cli.js")}` };
  }
  const dir = git(root, ["rev-parse", "--git-path", "hooks"]);
  if (!dir) throw new ClaimsError("could not find the git hooks directory");
  return { path: join(isAbsolute(dir) ? dir : resolve(root, dir), "pre-commit") };
}
function installGitHook(root, cliPath) {
  const { path, manual } = hookFile(root);
  if (!path) return { action: "manual", message: manual };
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const ours = block(cliPath);
  let next;
  let action;
  if (existing.includes(START) && existing.includes(END)) {
    next = existing.slice(0, existing.indexOf(START)) + ours + existing.slice(existing.indexOf(END) + END.length);
    action = "updated";
  } else if (existing.trim()) {
    next = `${existing.replace(/\s*$/, "")}

${ours}
`;
    action = "installed";
  } else {
    next = `#!/bin/sh
${ours}
`;
    action = "installed";
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");
  try {
    chmodSync(path, 493);
  } catch {
  }
  return { path, action, message: `${action} the claimkeeper pre-commit check in ${path}` };
}
function uninstallGitHook(root) {
  const { path, manual } = hookFile(root);
  if (!path) return { action: "manual", message: manual.replace("add this to", "remove this from") };
  if (!existsSync(path)) return { action: "absent", message: "no pre-commit hook installed" };
  const existing = readFileSync(path, "utf8");
  if (!existing.includes(START)) return { path, action: "absent", message: "the pre-commit hook has no claimkeeper block" };
  const rest = (existing.slice(0, existing.indexOf(START)) + existing.slice(existing.indexOf(END) + END.length)).replace(/\n{3,}/g, "\n\n");
  if (rest.replace("#!/bin/sh", "").trim()) writeFileSync(path, rest, "utf8");
  else rmSync(path, { force: true });
  return { path, action: "removed", message: `removed the claimkeeper block from ${path}` };
}

// src/hooks/hooks.ts
import { appendFileSync, existsSync as existsSync2 } from "node:fs";
import { basename } from "node:path";
var TAG = "[claimkeeper]";
var TOP = 5;
function openStore(input) {
  const root = findRoot(process.env.CLAIMKEEPER_ROOT || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (!root) return void 0;
  const store = Store.open(root);
  return store?.config().enabled ? store : void 0;
}
var freshSession = () => ({ started: (/* @__PURE__ */ new Date()).toISOString(), known: [], hinted: [], warned: [] });
function currentRevs(store) {
  return Object.fromEntries(store.claimIds().map((id) => [id, store.getClaim(id).rev]));
}
function fill(s) {
  s.started ??= (/* @__PURE__ */ new Date()).toISOString();
  s.known = Array.isArray(s.known) ? s.known : [];
  s.hinted = Array.isArray(s.hinted) ? s.hinted : [];
  s.warned = Array.isArray(s.warned) ? s.warned : [];
  return s;
}
function updateSession(store, input, change) {
  return store.updateSession(input.session_id ?? "default", freshSession, (s) => change(fill(s)));
}
function agentKey(input) {
  return input.agent_id ? `${input.agent_id}|` : "";
}
function context(event, lines) {
  if (!lines.length) return void 0;
  return { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join("\n") } };
}
function diffClip(a, b, max) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let start = Math.max(0, p - 20);
  while (start > 0 && a[start - 1] !== " ") start--;
  const cut = (s) => (start > 0 ? "\u2026" : "") + clip(s.slice(start), max);
  return [cut(a), cut(b)];
}
function top(lines, more) {
  return lines.length > TOP ? [...lines.slice(0, TOP), `  +${lines.length - TOP} more (${more})`] : lines;
}
function sessionStart(input) {
  const store = openStore(input);
  if (!store) return void 0;
  store.pruneSessions();
  const c = check(store);
  const keys = issueKeys(c);
  const resume = input.source === "resume" || input.source === "compact";
  updateSession(store, input, (s) => {
    if (resume) {
      s.known = [.../* @__PURE__ */ new Set([...s.known, ...keys])];
      s.revs ??= currentRevs(store);
      if (input.source === "compact") s.hinted = [];
    } else {
      Object.assign(s, freshSession(), { known: keys, revs: currentRevs(store) });
    }
  });
  refreshState(store);
  const issues = c.mentionIssues.length + c.outputIssues.length;
  const pending = c.mentionAcked.length + c.outputAcked.length;
  let line = `${TAG} Claim tracking is on: ${c.claims} claims`;
  if (issues) line += `, ${issues} need attention`;
  if (pending) line += `, ${pending} pending the user's decision`;
  line += c.claims ? ". Use the claims skill before changing product-facing text or media." : ". Use the claims skill to register product claims as you write them.";
  return context("SessionStart", [line]);
}
var FILE_TOOLS = /* @__PURE__ */ new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
var GEN_MCP = /eleven|speech|tts|voice|audio|sound|music|image|video|render|generate/i;
var GEN_BASH = /remotion\s+(render|still)|renderMedia|renderStill|\bffmpeg\b|elevenlabs|text[-_]to[-_]speech/i;
function filePathOf(input) {
  const ti = input.tool_input ?? {};
  const p = ti.file_path ?? ti.notebook_path ?? ti.path;
  return typeof p === "string" ? p : void 0;
}
function isCreate(input) {
  const r = input.tool_response;
  return !!r && typeof r === "object" && r.type === "create";
}
function existsAt(store, rel) {
  const abs = safeAbsPath(store.root, rel);
  return !!abs && existsSync2(abs);
}
function relOf(store, input) {
  const p = filePathOf(input);
  if (!p) return void 0;
  try {
    const rel = relPath(store.root, p);
    return rel === STORE_DIR || rel.startsWith(`${STORE_DIR}/`) ? void 0 : rel;
  } catch {
    return void 0;
  }
}
function onRead(store, input) {
  const rel = relOf(store, input);
  if (!rel || !store.claimIds().length) return void 0;
  const info = claimsIn(store, rel);
  if (!info.mentions.length && !info.outputAt) return void 0;
  const key = `${agentKey(input)}${rel}`;
  let first = false;
  updateSession(store, input, (s) => {
    if (s.hinted.includes(key)) return false;
    s.hinted.push(key);
    first = true;
  });
  if (!first) return void 0;
  const byClaim = /* @__PURE__ */ new Map();
  for (const r of info.mentions) {
    const where = r.line !== void 0 ? `l${r.line}` : r.mention.kind;
    const flag2 = mentionIsIssue(r) ? `(${r.stale ? "stale" : r.status})` : "";
    byClaim.set(r.claim, [...byClaim.get(r.claim) ?? [], `${where}${flag2}`]);
  }
  const parts = [...byClaim].slice(0, TOP).map(([id, where]) => `${id} ${where.join(",")} "${clip(store.getClaim(id).desc, 60)}"`);
  const lines = [`${TAG} ${rel} holds claims: ${parts.join("; ")}${byClaim.size > TOP ? ` +${byClaim.size - TOP} more` : ""}. Keep them consistent; changes go through claim_update.`];
  if (info.outputAt) lines.push(`${TAG} ${rel} is a generated output (out:${info.outputAt.output.id}); regenerate only with the user's approval.`);
  logActivity(store, `read ${rel}: hinted ${[...byClaim.keys()].join(", ") || "output"}`);
  return context("PostToolUse", lines);
}
function onFileWrite(store, input) {
  const rel = relOf(store, input);
  if (!rel || !store.claimIds().length) return void 0;
  const lines = [];
  const info = claimsIn(store, rel);
  const agent = agentKey(input);
  const driftKey = (r) => `${agent}${r.claim}#${r.mention.id}:${r.status}:${hashText(r.current ?? "")}`;
  const regenKey = (o) => `${agent}out:${o.output.id}:${o.sig}`;
  const candidates = info.mentions.filter((r) => ["changed", "text_not_found", "code_changed"].includes(r.status) && r.acked === void 0);
  const regenCandidates = info.outputsFrom.filter(outputIsIssue);
  const newKeys = /* @__PURE__ */ new Set();
  updateSession(store, input, (s) => {
    const warned = new Set(s.warned);
    for (const k of [...candidates.map(driftKey), ...regenCandidates.map(regenKey)]) if (!warned.has(k)) newKeys.add(k);
    if (!newKeys.size) return false;
    s.warned = [...warned, ...newKeys].slice(-500);
  });
  const drifted = candidates.filter((r) => newKeys.has(driftKey(r)));
  if (drifted.length) {
    lines.push(`${TAG} You changed claim wording in ${rel}:`, ...top(drifted.map((r) => mentionLine(r, true)), "claims_check"));
    lines.push(`  Same meaning: claim_update edits {mention, accept:true}. New meaning: claim_update desc + tell the user. Accidental: restore it.`);
  }
  const regen = regenCandidates.filter((o) => newKeys.has(regenKey(o)));
  if (regen.length) {
    lines.push(`${TAG} Now out of date (ask the user before regenerating):`, ...top(regen.map((o) => `  out:${o.output.id} ${clip(o.output.path, 80)} ${o.status}`), "claims_check"));
  }
  if (info.outputAt?.status === "changed") lines.push(`${TAG} ${rel} is a recorded output and changed: if you regenerated it, output record it.`);
  if (isCreate(input) && store.config().nudge) {
    const hits = scanFile(store, rel).slice(0, 3);
    if (hits.length) {
      lines.push(`${TAG} New file may repeat claims (register real ones with claim_add mentions):`);
      for (const h of hits) lines.push(`  ${h.claim} l${h.line}: "${clip(h.text, 80)}"`);
    }
  }
  if (lines.length) logActivity(store, `edit ${rel}: ${[drifted.length && `${drifted.length} drifted`, regen.length && `${regen.length} outputs stale`].filter(Boolean).join(", ") || "suggestions"}`);
  return context("PostToolUse", lines);
}
function onBash(store, input) {
  if (!store.claimIds().length) return void 0;
  const cmd = String(input.tool_input?.command ?? "");
  const lines = [];
  if (GEN_BASH.test(cmd)) lines.push(`${TAG} Media generated? If it states product claims: output action=record with its inputs.`);
  const gone = [];
  for (const id of store.claimIds()) {
    for (const r of store.mentions(id)) {
      const m = r.mention;
      if (m.kind !== "url" && !isUrl(m.path) && cmd.includes(basename(m.path)) && !existsAt(store, m.path)) gone.push(`${id}#${m.id} ${clip(m.path, 80)}`);
    }
  }
  for (const { output } of store.allOutputs()) {
    if (!isUrl(output.path) && cmd.includes(basename(output.path)) && !existsAt(store, output.path)) gone.push(`out:${output.id} ${clip(output.path, 80)}`);
  }
  if (gone.length) lines.push(`${TAG} Tracked files gone (moved: claim_update relink; deleted on purpose: remove): ${gone.slice(0, TOP).join(", ")}${gone.length > TOP ? ` +${gone.length - TOP}` : ""}`);
  if (lines.length) logActivity(store, `bash: ${lines.length} notes`);
  return context("PostToolUse", lines);
}
function postToolUse(input) {
  const store = openStore(input);
  if (!store) return void 0;
  const tool = input.tool_name ?? "";
  if (tool === "Read") return onRead(store, input);
  if (FILE_TOOLS.has(tool)) return onFileWrite(store, input);
  if (tool === "Bash") return onBash(store, input);
  if (tool.startsWith("mcp__") && !/claimkeeper/i.test(tool) && GEN_MCP.test(tool) && store.claimIds().length) {
    logActivity(store, `${tool}: nudged output record`);
    return context("PostToolUse", [`${TAG} Generated media that states product claims? Save it in the project and output action=record with its script/prompt inputs.`]);
  }
  return void 0;
}
function stop(input) {
  const store = openStore(input);
  if (!store) return void 0;
  const cfg = store.config();
  if (cfg.stop === "off" || input.stop_hook_active || !store.claimIds().length) return void 0;
  const res = check(store);
  const keys = issueKeys(res);
  let since = "";
  let baseline;
  let fresh = /* @__PURE__ */ new Set();
  updateSession(store, input, (s) => {
    since = s.lastStop ?? s.started;
    baseline = s.revs;
    const known = new Set(s.known);
    fresh = new Set(keys.filter((k) => !known.has(k)));
    s.known = keys;
    s.lastStop = (/* @__PURE__ */ new Date()).toISOString();
    s.revs = currentRevs(store);
  });
  const older = keys.length - fresh.size;
  refreshState(store);
  const meaning = [];
  const meaningIds = /* @__PURE__ */ new Set();
  for (const id of store.claimIds()) {
    const c = store.getClaim(id);
    const changed = baseline ? c.rev > (baseline[id] ?? 1) : c.history.some((h) => h.rev === c.rev && h.at > since);
    if (changed && c.history.length > 1) {
      const prev = c.history.filter((h) => h.rev < c.rev).pop();
      const [from, to] = diffClip(prev?.desc ?? "", c.desc, 70);
      const cur = c.history.find((h) => h.rev === c.rev);
      const by = cur?.by ? ` (${cur.by === "user" ? "user decided" : "from user's request"})` : "";
      meaning.push(`  ${id}: "${from}" \u2192 "${to}"${by}`);
      meaningIds.add(id);
    }
  }
  const freshMentions = res.mentionIssues.filter((r) => fresh.has(`${r.claim}#${r.mention.id}:${r.status}:${r.stale}`));
  const oldMeaning = freshMentions.filter((r) => r.stale && meaningIds.has(r.claim) && r.status !== "text_not_found" && r.status !== "file_not_found");
  const byClaim = /* @__PURE__ */ new Map();
  for (const r of oldMeaning) byClaim.set(r.claim, [...byClaim.get(r.claim) ?? [], r.mention.id]);
  const mentionNew = [
    ...freshMentions.filter((r) => !oldMeaning.includes(r)).map((r) => mentionLine(r, true)),
    ...[...byClaim].map(([claim, ids]) => `  ${claim}: ${ids.length} places still say the old meaning (${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", \u2026" : ""}): update them, or claim_update accept_all if they still hold`)
  ];
  const outputNew = res.outputIssues.filter((o) => fresh.has(`out:${o.output.id}:${o.status}`)).map(outputLine);
  if (!meaning.length && !mentionNew.length && !outputNew.length) {
    logActivity(store, `stop: ok${older ? ` (${older} older issues)` : ""}`);
    return void 0;
  }
  const notice = meaning.length ? `${TAG} Claim meaning changed this turn:
${meaning.join("\n")}` : void 0;
  if (!mentionNew.length && !outputNew.length) {
    logActivity(store, `stop: ${meaning.length} meaning changes noted${older ? ` (${older} older issues)` : ""}`);
    return { systemMessage: notice };
  }
  const parts = [`${TAG} Before finishing:`];
  if (mentionNew.length) {
    parts.push(
      `Places now inconsistent (fix with claim_update, or accept/ack):
${top(mentionNew, "claims_check").join("\n")}
  If you can't tell which version is right, don't guess to finish: ack it ("asked the user") and ask one short question.`
    );
  }
  if (outputNew.length) parts.push(`Outputs out of date \u2014 ask the user before regenerating; output ack if they decline:
${top(outputNew, "claims_check").join("\n")}`);
  if (older) parts.push(`(${older} older issues unchanged: claims_check)`);
  const text = parts.join("\n\n");
  logActivity(store, `stop: ${cfg.stop === "block" ? "blocked" : "warned"}: ${meaning.length} meaning changes, ${mentionNew.length} places, ${outputNew.length} outputs`);
  if (cfg.stop === "block") return { decision: "block", reason: text, ...notice ? { systemMessage: notice } : {} };
  return { systemMessage: notice ? `${notice}

${text}` : text };
}
var REDACT = /* @__PURE__ */ new Set(["content", "old_string", "new_string", "edits", "command", "new_source", "originalFile", "oldString", "newString", "structuredPatch", "stdout", "stderr"]);
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, REDACT.has(k) ? `<redacted ${typeof v === "string" ? v.length : JSON.stringify(v ?? "").length} chars>` : redact(v)])
  );
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function runHook(event) {
  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const handler = event === "session-start" ? sessionStart : event === "post-tool-use" ? postToolUse : event === "stop" ? stop : void 0;
    if (!handler) throw new Error(`unknown hook event ${event}`);
    const out = handler(input);
    if (process.env.CLAIMKEEPER_DEBUG) appendFileSync(process.env.CLAIMKEEPER_DEBUG, JSON.stringify({ event, input: redact(input), out }) + "\n");
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (e) {
    process.stderr.write(`${TAG} hook ${event} skipped: ${e.message}
`);
  }
  process.exit(0);
}

// src/cli.ts
var HELP = `claimkeeper \u2014 keep product claims consistent across docs, pages, scripts and media

Usage:
  claimkeeper init [--private]     start tracking claims in this project (.claims/)
  claimkeeper on|off [--me]        turn automatic checks on/off (--me: only for you)
  claimkeeper stop-mode <block|warn|off> [--me]
  claimkeeper status               settings and health summary
  claimkeeper list                 all claims
  claimkeeper get <id...> [--context N]
  claimkeeper check [--ci]         what needs attention (--ci: exit 1 if anything)
  claimkeeper install-git-hook     pre-commit check, for any agent (uninstall-git-hook removes it)
  claimkeeper in <path>            claims in a file, outputs built from it
  claimkeeper scan <path>          possible unregistered mentions in a file
  claimkeeper log [-n N]           what the agent and hooks did (activity log)
  claimkeeper statusline           one-line status for Claude Code's status line
  claimkeeper mcp                  run the MCP server (stdio)
  claimkeeper hook <session-start|post-tool-use|stop>   Claude Code hook entry

Any command: --root <dir> (or CLAIMKEEPER_ROOT) sets the project, for agents that
don't start the MCP server inside it.
`;
function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}
function option(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return void 0;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}
async function main(argv) {
  const all = [...argv];
  const root = option(all, "--root");
  if (root) process.env.CLAIMKEEPER_ROOT = resolve2(root);
  const [cmd, ...args] = all;
  switch (cmd) {
    case "mcp": {
      const { startServer } = await import("./chunks/server-R62DSM34.js");
      await startServer();
      return -1;
    }
    case "hook":
      await runHook(args[0] ?? "");
      return 0;
    case "init": {
      const priv = flag(args, "--private");
      const { store, created } = init(defaultRoot(), priv ? false : void 0);
      console.log(`${created ? "Initialized" : "Already initialized"} claim tracking in ${store.dir}`);
      console.log(formatConfig(store.config()));
      return 0;
    }
    case "on":
    case "off": {
      const me = flag(args, "--me");
      console.log(formatConfig(toggle(requireStore(projectRoot()), { enabled: cmd === "on" }, me ? "me" : "project")));
      return 0;
    }
    case "stop-mode": {
      const me = flag(args, "--me");
      const mode = args[0];
      if (mode !== "block" && mode !== "warn" && mode !== "off") throw new ClaimsError("stop-mode needs block, warn or off");
      console.log(formatConfig(toggle(requireStore(projectRoot()), { stop: mode }, me ? "me" : "project")));
      return 0;
    }
    case "status": {
      const store = requireStore(projectRoot());
      const c = check(store);
      console.log(formatConfig(store.config()));
      console.log(`${c.claims} claims, ${c.mentions} mentions, ${c.outputs} outputs; ${c.mentionIssues.length + c.outputIssues.length} need attention`);
      return 0;
    }
    case "list":
      console.log(formatList(listClaims(requireStore(projectRoot()))));
      return 0;
    case "get": {
      const ctx = option(args, "--context");
      if (!args.length) throw new ClaimsError("get needs claim ids");
      console.log(formatClaimViews(getClaims(requireStore(projectRoot()), args, ctx ? { context: Number(ctx) } : {})));
      return 0;
    }
    case "check": {
      const ci = flag(args, "--ci");
      const ifEnabled = flag(args, "--if-enabled");
      const store = requireStore(projectRoot());
      if (ifEnabled && !store.config().enabled) {
        console.log("claimkeeper: tracking is off, skipping the check");
        return 0;
      }
      const res = check(store, { searchMissing: true });
      console.log(formatCheck(res));
      return ci && (res.mentionIssues.length || res.outputIssues.length) ? 1 : 0;
    }
    case "install-git-hook":
    case "uninstall-git-hook": {
      const store = requireStore(projectRoot());
      const cli = fileURLToPath(import.meta.url);
      const r = cmd === "install-git-hook" ? installGitHook(store.root, cli) : uninstallGitHook(store.root);
      console.log(r.message);
      return 0;
    }
    case "in":
      if (!args[0]) throw new ClaimsError("in needs a path");
      console.log(formatInFile(claimsIn(requireStore(projectRoot()), resolve2(process.cwd(), args[0]))));
      return 0;
    case "scan":
      if (!args[0]) throw new ClaimsError("scan needs a path");
      console.log(formatScan(args[0], scanFile(requireStore(projectRoot()), resolve2(process.cwd(), args[0]))));
      return 0;
    case "log": {
      const n = Number(option(args, "-n") ?? 30);
      console.log(readLog(requireStore(projectRoot()), Number.isFinite(n) ? n : 30));
      return 0;
    }
    case "statusline": {
      let dir;
      try {
        const raw = await readStdin();
        const j = raw.trim() ? JSON.parse(raw) : {};
        dir = j.workspace?.project_dir ?? j.workspace?.current_dir ?? j.cwd;
      } catch {
      }
      const root2 = findRoot(dir ?? projectRoot());
      const store = root2 ? Store.open(root2) : void 0;
      process.stdout.write(store ? statusText(store) : "");
      return 0;
    }
    case void 0:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`unknown command: ${cmd}

${HELP}`);
      return 2;
  }
}
main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (e) => {
    console.error(e instanceof ClaimsError ? `claimkeeper: ${e.message}` : e);
    process.exitCode = 1;
  }
);
