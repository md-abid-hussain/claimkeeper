/**
 * Claude Code hook handlers.
 *
 * Context budget first: every line printed here lands in the agent's context, so hooks
 * stay silent unless something relevant happened, and say it in as few lines as possible.
 * Hooks never change claims; they write only git-ignored local files (session state,
 * activity log, status cache; plus CLAIMKEEPER_DEBUG's log when set). Errors are swallowed:
 * claim tracking never breaks a session.
 */
import { appendFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { logActivity, refreshState } from "../core/activity.js";
import { hashText } from "../core/fingerprint.js";
import { mentionLine, outputLine } from "../core/format.js";
import * as ops from "../core/ops.js";
import { findRoot, relPath, safeAbsPath, STORE_DIR } from "../core/project.js";
import { isUrl, mentionIsIssue, outputIsIssue } from "../core/resolve.js";
import { Store } from "../core/store.js";
import { clip } from "../core/text.js";
const TAG = "[claimkeeper]";
const TOP = 5;
function openStore(input) {
    const root = findRoot(process.env.CLAIMKEEPER_ROOT || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
    if (!root)
        return undefined;
    const store = Store.open(root);
    return store?.config().enabled ? store : undefined;
}
const freshSession = () => ({ started: new Date().toISOString(), known: [], hinted: [], warned: [] });
function currentRevs(store) {
    return Object.fromEntries(store.claimIds().map((id) => [id, store.getClaim(id).rev]));
}
/** Normalize a session read from disk (older versions may lack fields). */
function fill(s) {
    s.started ??= new Date().toISOString();
    s.known = Array.isArray(s.known) ? s.known : [];
    s.hinted = Array.isArray(s.hinted) ? s.hinted : [];
    s.warned = Array.isArray(s.warned) ? s.warned : [];
    return s;
}
/** Locked read-modify-write of this session's state (hooks for parallel tool calls run concurrently). */
function updateSession(store, input, change) {
    return store.updateSession(input.session_id ?? "default", freshSession, (s) => change(fill(s)));
}
/** Hints and warnings are per agent: a subagent reading a file must not use up the main agent's hint. */
function agentKey(input) {
    return input.agent_id ? `${input.agent_id}|` : "";
}
function context(event, lines) {
    if (!lines.length)
        return undefined;
    return { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join("\n") } };
}
/** Clip two versions of a sentence around where they start to differ, so the change is visible. */
export function diffClip(a, b, max) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p])
        p++;
    let start = Math.max(0, p - 20);
    while (start > 0 && a[start - 1] !== " ")
        start--;
    const cut = (s) => (start > 0 ? "…" : "") + clip(s.slice(start), max);
    return [cut(a), cut(b)];
}
function top(lines, more) {
    return lines.length > TOP ? [...lines.slice(0, TOP), `  +${lines.length - TOP} more (${more})`] : lines;
}
// ---------------- SessionStart: one line, or nothing ----------------
export function sessionStart(input) {
    const store = openStore(input);
    if (!store)
        return undefined;
    store.pruneSessions();
    const c = ops.check(store);
    const keys = ops.issueKeys(c);
    const resume = input.source === "resume" || input.source === "compact";
    updateSession(store, input, (s) => {
        if (resume) {
            // issues that appeared between sessions (hand edits) are known, not new: don't block on them
            s.known = [...new Set([...s.known, ...keys])];
            s.revs ??= currentRevs(store);
            if (input.source === "compact")
                s.hinted = []; // the agent lost its context: hint again
        }
        else {
            Object.assign(s, freshSession(), { known: keys, revs: currentRevs(store) });
        }
    });
    refreshState(store);
    const issues = c.mentionIssues.length + c.outputIssues.length;
    const pending = c.mentionAcked.length + c.outputAcked.length;
    let line = `${TAG} Claim tracking is on: ${c.claims} claims`;
    if (issues)
        line += `, ${issues} need attention`;
    if (pending)
        line += `, ${pending} pending the user's decision`;
    line += c.claims
        ? ". Use the claims skill before changing product-facing text or media."
        : ". Use the claims skill to register product claims as you write them.";
    return context("SessionStart", [line]);
}
// ---------------- PostToolUse ----------------
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const GEN_MCP = /eleven|speech|tts|voice|audio|sound|music|image|video|render|generate/i;
const GEN_BASH = /remotion\s+(render|still)|renderMedia|renderStill|\bffmpeg\b|elevenlabs|text[-_]to[-_]speech/i;
function filePathOf(input) {
    const ti = input.tool_input ?? {};
    const p = ti.file_path ?? ti.notebook_path ?? ti.path;
    return typeof p === "string" ? p : undefined;
}
function isCreate(input) {
    const r = input.tool_response;
    return !!r && typeof r === "object" && r.type === "create";
}
function existsAt(store, rel) {
    const abs = safeAbsPath(store.root, rel);
    return !!abs && existsSync(abs);
}
function relOf(store, input) {
    const p = filePathOf(input);
    if (!p)
        return undefined;
    try {
        const rel = relPath(store.root, p);
        return rel === STORE_DIR || rel.startsWith(`${STORE_DIR}/`) ? undefined : rel;
    }
    catch {
        return undefined;
    }
}
/** Read: tell the agent, once per file per session, which claims the file holds. */
function onRead(store, input) {
    const rel = relOf(store, input);
    if (!rel || !store.claimIds().length)
        return undefined;
    const info = ops.claimsIn(store, rel);
    if (!info.mentions.length && !info.outputAt)
        return undefined;
    const key = `${agentKey(input)}${rel}`;
    let first = false;
    updateSession(store, input, (s) => {
        if (s.hinted.includes(key))
            return false;
        s.hinted.push(key);
        first = true;
    });
    if (!first)
        return undefined;
    const byClaim = new Map();
    for (const r of info.mentions) {
        const where = r.line !== undefined ? `l${r.line}` : r.mention.kind;
        const flag = mentionIsIssue(r) ? `(${r.stale ? "stale" : r.status})` : "";
        byClaim.set(r.claim, [...(byClaim.get(r.claim) ?? []), `${where}${flag}`]);
    }
    const parts = [...byClaim].slice(0, TOP).map(([id, where]) => `${id} ${where.join(",")} "${clip(store.getClaim(id).desc, 60)}"`);
    const lines = [`${TAG} ${rel} holds claims: ${parts.join("; ")}${byClaim.size > TOP ? ` +${byClaim.size - TOP} more` : ""}. Keep them consistent; changes go through claim_update.`];
    if (info.outputAt)
        lines.push(`${TAG} ${rel} is a generated output (out:${info.outputAt.output.id}); regenerate only with the user's approval.`);
    logActivity(store, `read ${rel}: hinted ${[...byClaim.keys()].join(", ") || "output"}`);
    return context("PostToolUse", lines);
}
function onFileWrite(store, input) {
    const rel = relOf(store, input);
    if (!rel || !store.claimIds().length)
        return undefined;
    const lines = [];
    const info = ops.claimsIn(store, rel);
    // say each problem once per session (per agent); repeat only if its state changes again
    const agent = agentKey(input);
    const driftKey = (r) => `${agent}${r.claim}#${r.mention.id}:${r.status}:${hashText(r.current ?? "")}`;
    const regenKey = (o) => `${agent}out:${o.output.id}:${o.sig}`;
    const candidates = info.mentions.filter((r) => ["changed", "text_not_found", "code_changed"].includes(r.status) && r.acked === undefined);
    const regenCandidates = info.outputsFrom.filter(outputIsIssue);
    const newKeys = new Set();
    updateSession(store, input, (s) => {
        const warned = new Set(s.warned);
        for (const k of [...candidates.map(driftKey), ...regenCandidates.map(regenKey)])
            if (!warned.has(k))
                newKeys.add(k);
        if (!newKeys.size)
            return false;
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
    if (info.outputAt?.status === "changed")
        lines.push(`${TAG} ${rel} is a recorded output and changed: if you regenerated it, output record it.`);
    if (isCreate(input) && store.config().nudge) {
        const hits = ops.scanFile(store, rel).slice(0, 3);
        if (hits.length) {
            lines.push(`${TAG} New file may repeat claims (register real ones with claim_add mentions):`);
            for (const h of hits)
                lines.push(`  ${h.claim} l${h.line}: "${clip(h.text, 80)}"`);
        }
    }
    if (lines.length)
        logActivity(store, `edit ${rel}: ${[drifted.length && `${drifted.length} drifted`, regen.length && `${regen.length} outputs stale`].filter(Boolean).join(", ") || "suggestions"}`);
    return context("PostToolUse", lines);
}
function onBash(store, input) {
    if (!store.claimIds().length)
        return undefined;
    const cmd = String(input.tool_input?.command ?? "");
    const lines = [];
    if (GEN_BASH.test(cmd))
        lines.push(`${TAG} Media generated? If it states product claims: output action=record with its inputs.`);
    const gone = [];
    for (const id of store.claimIds()) {
        for (const r of store.mentions(id)) {
            const m = r.mention;
            if (m.kind !== "url" && !isUrl(m.path) && cmd.includes(basename(m.path)) && !existsAt(store, m.path))
                gone.push(`${id}#${m.id} ${clip(m.path, 80)}`);
        }
    }
    for (const { output } of store.allOutputs()) {
        if (!isUrl(output.path) && cmd.includes(basename(output.path)) && !existsAt(store, output.path))
            gone.push(`out:${output.id} ${clip(output.path, 80)}`);
    }
    if (gone.length)
        lines.push(`${TAG} Tracked files gone (moved: claim_update relink; deleted on purpose: remove): ${gone.slice(0, TOP).join(", ")}${gone.length > TOP ? ` +${gone.length - TOP}` : ""}`);
    if (lines.length)
        logActivity(store, `bash: ${lines.length} notes`);
    return context("PostToolUse", lines);
}
export function postToolUse(input) {
    const store = openStore(input);
    if (!store)
        return undefined;
    const tool = input.tool_name ?? "";
    if (tool === "Read")
        return onRead(store, input);
    if (FILE_TOOLS.has(tool))
        return onFileWrite(store, input);
    if (tool === "Bash")
        return onBash(store, input);
    if (tool.startsWith("mcp__") && !/claimkeeper/i.test(tool) && GEN_MCP.test(tool) && store.claimIds().length) {
        logActivity(store, `${tool}: nudged output record`);
        return context("PostToolUse", [`${TAG} Generated media that states product claims? Save it in the project and output action=record with its script/prompt inputs.`]);
    }
    return undefined;
}
// ---------------- Stop: new problems block once ----------------
export function stop(input) {
    const store = openStore(input);
    if (!store)
        return undefined;
    const cfg = store.config();
    if (cfg.stop === "off" || input.stop_hook_active || !store.claimIds().length)
        return undefined;
    // whole-project check: also catches edits made through Bash, scripts or by hand during the session
    const res = ops.check(store);
    const keys = ops.issueKeys(res);
    let since = "";
    let baseline;
    let fresh = new Set();
    updateSession(store, input, (s) => {
        since = s.lastStop ?? s.started;
        baseline = s.revs;
        const known = new Set(s.known);
        fresh = new Set(keys.filter((k) => !known.has(k)));
        // remember only what is open now: an issue that gets fixed and later breaks again is new again
        s.known = keys;
        s.lastStop = new Date().toISOString();
        s.revs = currentRevs(store);
    });
    const older = keys.length - fresh.size;
    refreshState(store);
    const meaning = [];
    for (const id of store.claimIds()) {
        const c = store.getClaim(id);
        // by revision when the session recorded them (claims created since started at rev 1);
        // sessions from older versions fall back to timestamps
        const changed = baseline ? c.rev > (baseline[id] ?? 1) : c.history.some((h) => h.rev === c.rev && h.at > since);
        if (changed && c.history.length > 1) {
            const prev = c.history.filter((h) => h.rev < c.rev).pop();
            const [from, to] = diffClip(prev?.desc ?? "", c.desc, 70);
            const cur = c.history.find((h) => h.rev === c.rev);
            const by = cur?.by ? ` (${cur.by === "user" ? "user decided" : "from user's request"})` : "";
            meaning.push(`  ${id}: "${from}" → "${to}"${by}`);
        }
    }
    const mentionNew = res.mentionIssues.filter((r) => fresh.has(`${r.claim}#${r.mention.id}:${r.status}:${r.stale}`)).map((r) => mentionLine(r, true));
    const outputNew = res.outputIssues.filter((o) => fresh.has(`out:${o.output.id}:${o.status}`)).map(outputLine);
    if (!meaning.length && !mentionNew.length && !outputNew.length) {
        logActivity(store, `stop: ok${older ? ` (${older} older issues)` : ""}`);
        return undefined;
    }
    // A meaning change never blocks and never goes to the agent: claim_update already told it to report
    // the change, and asking again cost an extra turn. The user sees it as a notice instead.
    const notice = meaning.length ? `${TAG} Claim meaning changed this turn:\n${meaning.join("\n")}` : undefined;
    if (!mentionNew.length && !outputNew.length) {
        logActivity(store, `stop: ${meaning.length} meaning changes noted${older ? ` (${older} older issues)` : ""}`);
        return { systemMessage: notice };
    }
    const parts = [`${TAG} Before finishing:`];
    if (mentionNew.length) {
        parts.push(`Places now inconsistent (fix with claim_update, or accept/ack):\n${top(mentionNew, "claims_check").join("\n")}\n` +
            `  If you can't tell which version is right, don't guess to finish: ack it ("asked the user") and ask one short question.`);
    }
    if (outputNew.length)
        parts.push(`Outputs out of date — ask the user before regenerating; output ack if they decline:\n${top(outputNew, "claims_check").join("\n")}`);
    if (older)
        parts.push(`(${older} older issues unchanged: claims_check)`);
    const text = parts.join("\n\n");
    logActivity(store, `stop: ${cfg.stop === "block" ? "blocked" : "warned"}: ${meaning.length} meaning changes, ${mentionNew.length} places, ${outputNew.length} outputs`);
    if (cfg.stop === "block")
        return { decision: "block", reason: text, ...(notice ? { systemMessage: notice } : {}) };
    return { systemMessage: notice ? `${notice}\n\n${text}` : text };
}
// ---------------- runner ----------------
const REDACT = new Set(["content", "old_string", "new_string", "edits", "command", "new_source", "originalFile", "oldString", "newString", "structuredPatch", "stdout", "stderr"]);
/** Debug log keeps the shape of hook inputs, never file contents or command output. */
export function redact(value) {
    if (Array.isArray(value))
        return value.map(redact);
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, REDACT.has(k) ? `<redacted ${typeof v === "string" ? v.length : JSON.stringify(v ?? "").length} chars>` : redact(v)]));
}
export async function readStdin() {
    if (process.stdin.isTTY)
        return "";
    const chunks = [];
    for await (const c of process.stdin)
        chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
}
export async function runHook(event) {
    try {
        const raw = await readStdin();
        const input = (raw.trim() ? JSON.parse(raw) : {});
        const handler = event === "session-start" ? sessionStart : event === "post-tool-use" ? postToolUse : event === "stop" ? stop : undefined;
        if (!handler)
            throw new Error(`unknown hook event ${event}`);
        const out = handler(input);
        if (process.env.CLAIMKEEPER_DEBUG)
            appendFileSync(process.env.CLAIMKEEPER_DEBUG, JSON.stringify({ event, input: redact(input), out }) + "\n");
        if (out)
            process.stdout.write(JSON.stringify(out));
    }
    catch (e) {
        process.stderr.write(`${TAG} hook ${event} skipped: ${e.message}\n`);
    }
    process.exit(0);
}
