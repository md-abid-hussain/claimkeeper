/**
 * All claim operations. Deterministic: they store, locate, fetch, write and report.
 * Judgment (is this a contradiction? what wording fits here?) is left to the agent.
 */
import { existsSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { fingerprint, hashText } from "./fingerprint.js";
import { absPath, isExcluded, isProtectedPath, relPath } from "./project.js";
import { descAt, isUrl, mentionIsIssue, mentionSig, outputIsIssue, outputResolver, parseMentionRef, readText, resolveMention, } from "./resolve.js";
import { cleanMeta, findSecret } from "./secrets.js";
import { CLAIM_ID, nextMentionId, Store } from "./store.js";
import { blockAt, clip, lineAt, locate, oneLine, tokenize } from "./text.js";
import { ANCHORED_KINDS, ClaimsError, MENTION_KINDS, } from "./types.js";
const now = () => new Date().toISOString();
const MAX_ANCHOR = 500;
const MAX_DESC = 500;
const MAX_NOTE = 300;
/** Claim text is shown to agents: one line, no control characters, bounded size. */
function cleanText(what, text, max) {
    const t = oneLine(text);
    if (t.length > max)
        throw new ClaimsError(`${what} too long (${t.length} chars, max ${max}); keep it to one sentence`);
    return t;
}
function cleanKeywords(keywords) {
    return keywords.map((k) => oneLine(k).toLowerCase().slice(0, 60)).filter(Boolean).slice(0, 20);
}
function noSecret(what, text) {
    if (!text)
        return;
    const why = findSecret(text);
    if (why)
        throw new ClaimsError(`refusing to store ${what}: it looks like it contains a secret (${why})`);
}
/** Never track or write the store itself, .git, or secret/excluded files. */
function guardPath(rel, exclude) {
    if (isProtectedPath(rel))
        throw new ClaimsError(`${rel} is claimkeeper's or git's own data and is never tracked`);
    if (isExcluded(rel, exclude))
        throw new ClaimsError(`${rel} matches an exclude pattern (secrets/private files are never tracked)`);
}
// ---------- setup / on-off ----------
export function init(root, share) {
    return Store.init(root, share === undefined ? {} : { share });
}
export function requireStore(root) {
    const s = Store.open(root);
    if (!s)
        throw new ClaimsError("claim tracking is not initialized in this project. Run /claimkeeper:init (or `claimkeeper init`) first.");
    return s;
}
export function toggle(store, patch, scope) {
    return store.setConfig(patch, scope);
}
// ---------- claims ----------
export function addClaim(store, input) {
    const id = input.id.trim();
    if (!CLAIM_ID.test(id))
        throw new ClaimsError(`invalid claim id "${id}": use 2-64 chars, lowercase letters, digits and dashes`);
    if (store.hasClaim(id))
        throw new ClaimsError(`claim "${id}" already exists; use claim_update to change it`);
    const desc = cleanText("desc", input.desc, MAX_DESC);
    if (!desc)
        throw new ClaimsError("desc is required: one sentence saying what the claim means");
    noSecret("desc", desc);
    const keywords = cleanKeywords(input.keywords ?? []);
    noSecret("keywords", keywords.join(" "));
    const claim = { id, desc, keywords, rev: 1, history: [{ rev: 1, desc, at: now() }], mentions: [], next: 1 };
    store.saveClaim(claim);
    return claim;
}
function inferKind(rel, hasAnchor) {
    if (isUrl(rel))
        return "url";
    const ext = extname(rel).toLowerCase();
    if (ext === ".svg")
        return "svg";
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico"].includes(ext))
        return "image";
    if ([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"].includes(ext))
        return "audio";
    if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"].includes(ext))
        return "video";
    return hasAnchor ? "text" : "file";
}
/** Register where a claim appears. Validates that the wording is really there. */
export function addMention(store, input) {
    const claim = store.getClaim(input.claim);
    const cfg = store.config();
    const url = isUrl(input.path);
    const rel = url ? input.path : relPath(store.root, input.path);
    const anchor = input.anchor?.trim() ? input.anchor : undefined;
    const kind = input.kind ?? inferKind(rel, !!anchor);
    if (!MENTION_KINDS.includes(kind))
        throw new ClaimsError(`unknown kind "${kind}"; use one of ${MENTION_KINDS.join(", ")}`);
    if (!url)
        guardPath(rel, cfg.exclude);
    noSecret("note", input.note);
    noSecret("conflict", input.conflict);
    if (input.note)
        input = { ...input, note: cleanText("note", input.note, MAX_NOTE) };
    if (input.conflict)
        input = { ...input, conflict: cleanText("conflict", input.conflict, MAX_NOTE) };
    // rev 0 = never confirmed for any meaning: reported STALE until fixed or accepted
    const m = { id: "", kind, path: rel, rev: input.conflict ? 0 : claim.rev };
    const note = [input.conflict ? `CONFLICT: ${input.conflict}` : "", input.note ?? ""].filter(Boolean).join(" | ");
    if (note)
        m.note = note;
    if (kind === "url") {
        // web pages can't be checked by the tool; keep the expected wording so a person can
        if (anchor) {
            if (anchor.length > MAX_ANCHOR)
                throw new ClaimsError(`anchor too long (${anchor.length} chars, max ${MAX_ANCHOR})`);
            noSecret("anchor", anchor);
            m.anchor = cleanText("anchor", anchor, MAX_ANCHOR);
        }
    }
    else {
        const abs = absPath(store.root, rel);
        if (!existsSync(abs))
            throw new ClaimsError(`file not found: ${rel}`);
        if (ANCHORED_KINDS.has(kind) && (anchor || kind !== "svg")) {
            if (!anchor)
                throw new ClaimsError(`kind "${kind}" needs an anchor: the exact wording of the claim in ${rel}`);
            if (anchor.length < cfg.minAnchor)
                throw new ClaimsError(`anchor too short (${anchor.length} chars, min ${cfg.minAnchor}); include more of the sentence so it is unique`);
            if (anchor.length > MAX_ANCHOR)
                throw new ClaimsError(`anchor too long (${anchor.length} chars, max ${MAX_ANCHOR}); anchor the key sentence, not the whole passage`);
            noSecret("anchor", anchor);
            const content = readText(abs);
            if (content === undefined)
                throw new ClaimsError(`${rel} is not a readable text file (or is over 2 MB)`);
            const { best, others } = locate(content, anchor, input.line, false);
            if (!best)
                throw new ClaimsError(`anchor not found in ${rel}. Copy the wording exactly as it appears in the file.`);
            if (others.length && input.line === undefined) {
                throw new ClaimsError(`anchor appears ${others.length + 1} times in ${rel} (lines ${[best.line, ...others].sort((a, b) => a - b).join(", ")}). Pass line to pick one, or use a longer anchor.`);
            }
            // the stored wording is what the file says (may differ from the given anchor by markup): check it too
            const stored = content.slice(best.start, best.end);
            if (stored.length > MAX_ANCHOR)
                throw new ClaimsError(`the matched wording is too long (${stored.length} chars, max ${MAX_ANCHOR}); anchor a shorter sentence`);
            noSecret("anchor", stored);
            m.anchor = stored;
            m.line = best.line;
            if (kind === "code")
                m.block = hashText(blockAt(content, best.line));
        }
        else {
            const fp = fingerprint(abs);
            if (fp)
                m.fp = fp;
        }
    }
    // already registered?
    const existing = store.mentions(claim.id).find((r) => r.mention.path === m.path && r.mention.anchor === m.anchor && r.mention.kind === m.kind);
    if (existing) {
        // re-registering a known place can still flag it as contradicting the claim
        if (input.conflict) {
            existing.mention.rev = 0;
            existing.mention.note = [`CONFLICT: ${input.conflict}`, existing.mention.note?.replace(/^CONFLICT: [^|]*\| ?/, "") ?? ""].filter(Boolean).join(" | ");
            return ackRegisteredConflict(store, claim, existing, input.conflict);
        }
        return resolveMention(store, claim, existing);
    }
    const local = !url && store.isLocalPath(rel);
    if (local) {
        const l = store.getLocal(claim.id);
        l.next = nextMentionId("l", l.mentions, l.next);
        m.id = `l${l.next++}`;
        l.mentions.push(m);
        store.saveLocal(l);
    }
    else {
        claim.next = nextMentionId("m", claim.mentions, claim.next);
        m.id = `m${claim.next++}`;
        claim.mentions.push(m);
        store.saveClaim(claim);
    }
    if (input.conflict)
        return ackRegisteredConflict(store, claim, { mention: m, local }, input.conflict);
    return resolveMention(store, claim, { mention: m, local });
}
/**
 * A conflict registered on purpose is known, not news: acknowledge it in the same step so it
 * waits for the user's decision (listed as pending) instead of blocking the end of the turn.
 * The ack lapses as soon as the place changes, so a later edit is still reported.
 */
function ackRegisteredConflict(store, claim, ref, conflict) {
    const r = resolveMention(store, claim, ref);
    ref.mention.ack = { sig: mentionSig(r, claim), note: `conflict registered, awaiting the user's decision: ${conflict}`, at: now() };
    store.saveMentionSide(claim.id, ref.local);
    return resolveMention(store, claim, ref);
}
/** Create a claim (desc required) or add places to an existing one, in one call. */
export function addClaimWithMentions(store, input) {
    let created = false;
    if (!store.hasClaim(input.id.trim())) {
        if (!input.desc?.trim())
            throw new ClaimsError(`claim "${input.id}" does not exist yet: desc is required to create it`);
        addClaim(store, { id: input.id, desc: input.desc, ...(input.keywords ? { keywords: input.keywords } : {}) });
        created = true;
    }
    else if (input.desc?.trim() && cleanText("desc", input.desc, MAX_DESC) !== store.getClaim(input.id.trim()).desc) {
        throw new ClaimsError(`claim "${input.id}" already exists with a different meaning; use claim_update with desc to change it (and tell the user)`);
    }
    const claim = store.getClaim(input.id.trim());
    const mentions = (input.mentions ?? []).map((m) => {
        try {
            return { path: m.path, ok: true, resolved: addMention(store, { ...m, claim: claim.id }) };
        }
        catch (e) {
            return { path: m.path, ok: false, error: e.message };
        }
    });
    return { claim, created, mentions };
}
export function getClaims(store, ids, opts = {}) {
    const ctx = { searchMissing: true, contents: new Map(), ...(opts.context ? { context: opts.context } : {}) };
    const outs = outputResolver(store, { contents: ctx.contents });
    const allOuts = outs.all();
    return ids.map((id) => {
        const claim = store.getClaim(id);
        return {
            claim,
            mentions: store.mentions(id).map((r) => resolveMention(store, claim, r, ctx)),
            outputs: allOuts.filter((o) => Object.hasOwn(o.output.claims, id)),
        };
    });
}
export function listClaims(store) {
    const contents = new Map();
    return store.claimIds().map((id) => {
        const claim = store.getClaim(id);
        const refs = store.mentions(id);
        const issues = refs.map((r) => resolveMention(store, claim, r, { contents })).filter(mentionIsIssue).length;
        return { claim, mentions: refs.length, issues };
    });
}
/** A place now confirmed for the current meaning: no ack, no leftover conflict note. */
function confirm(m, claim) {
    m.rev = claim.rev;
    delete m.ack;
    if (m.note?.startsWith("CONFLICT:")) {
        const rest = m.note.split(" | ").slice(1).join(" | ");
        if (rest)
            m.note = rest;
        else
            delete m.note;
    }
}
function applyEdit(store, claim, e) {
    const ref = store.findMention(claim.id, e.mention);
    const m = ref.mention;
    const actions = [e.text !== undefined, !!e.accept, e.ack !== undefined, e.relink !== undefined, !!e.remove].filter(Boolean).length;
    if (actions !== 1)
        throw new ClaimsError("each edit needs exactly one of: text, accept, ack, relink, remove");
    if (e.remove) {
        removeMention(store, { claim: claim.id, mention: m.id });
        return "removed";
    }
    if (e.relink !== undefined) {
        const r = relinkMention(store, { claim: claim.id, mention: m.id, path: e.relink, ...(e.line !== undefined ? { line: e.line } : {}) });
        return `relinked to ${r.mention.path}${r.line !== undefined ? `:${r.line}` : ""}`;
    }
    if (e.ack !== undefined) {
        noSecret("ack note", e.ack);
        if (e.ack)
            e = { ...e, ack: cleanText("ack", e.ack, MAX_NOTE) };
        const r = resolveMention(store, claim, ref);
        m.ack = { sig: mentionSig(r, claim), note: e.ack || "acknowledged", at: now() };
        store.saveMentionSide(claim.id, ref.local);
        const state = [r.status === "unchecked" ? "web place, check by hand" : r.status, r.stale ? (m.rev === 0 ? "registered conflict" : "written for an earlier meaning") : ""];
        return `acknowledged, waiting on the user (${state.filter(Boolean).join("; ")})`;
    }
    if (e.accept) {
        guardPath(m.path, store.config().exclude);
        const r = resolveMention(store, claim, ref);
        if (r.status === "file_not_found")
            throw new ClaimsError(`${m.path} not found; use edits {mention, relink} or {mention, remove:true}`);
        if (r.status === "text_not_found")
            throw new ClaimsError(`wording not found in ${m.path}; use text with old, or remove the mention`);
        if (m.anchor && r.current !== undefined) {
            if (r.current.length > MAX_ANCHOR)
                throw new ClaimsError("current text too long to anchor; use text to set a shorter wording");
            noSecret("current wording", r.current);
            m.anchor = r.current;
            if (r.line !== undefined)
                m.line = r.line;
            if (m.kind === "code" && r.line !== undefined) {
                const content = readText(absPath(store.root, m.path)) ?? "";
                m.block = hashText(blockAt(content, r.line));
            }
        }
        else if (m.kind !== "url") {
            const fp = fingerprint(absPath(store.root, m.path));
            if (fp)
                m.fp = fp;
        }
        confirm(m, claim);
        store.saveMentionSide(claim.id, ref.local);
        return `accepted at rev ${claim.rev}`;
    }
    // text replacement
    const text = e.text;
    if (!m.anchor || !ANCHORED_KINDS.has(m.kind))
        throw new ClaimsError(`mention ${m.id} is ${m.kind}; text edits only apply to text/code/svg wording. Regenerate the file, then use accept.`);
    if (!text.trim())
        throw new ClaimsError("text is empty; to stop tracking a place use edits {mention, remove:true}");
    if (text.length > MAX_ANCHOR)
        throw new ClaimsError(`text too long (${text.length} chars, max ${MAX_ANCHOR})`);
    noSecret("text", text);
    guardPath(m.path, store.config().exclude); // the store may name .env, .git/ or .claims/: never write there
    const abs = absPath(store.root, m.path);
    const content = readText(abs);
    if (content === undefined)
        throw new ClaimsError(`${m.path} not found or not readable`);
    let start;
    let end;
    if (e.old !== undefined) {
        const hit = locate(content, e.old, m.line, false).best;
        if (!hit || hit.mode !== "exact")
            throw new ClaimsError(`old text not found exactly in ${m.path}`);
        start = hit.start;
        end = hit.end;
    }
    else {
        const r = resolveMention(store, claim, ref, { contents: new Map([[m.path, content]]) });
        if (!r.range || !["ok", "moved", "reformatted", "code_changed"].includes(r.status)) {
            throw new ClaimsError(`mention is ${r.status}${r.current ? ` (now: "${r.current.slice(0, 80)}")` : ""}; pass old with the exact current text to replace`);
        }
        [start, end] = r.range;
    }
    const next = content.slice(0, start) + text + content.slice(end);
    writeFileSync(abs, next, "utf8");
    m.anchor = text;
    m.line = lineAt(next, start);
    if (m.kind === "code")
        m.block = hashText(blockAt(next, m.line));
    confirm(m, claim);
    store.saveMentionSide(claim.id, ref.local);
    return `rewrote ${m.path}:${m.line}`;
}
export function updateClaim(store, input) {
    const claim = store.getClaim(input.claim);
    let desc = input.desc;
    if (input.revert !== undefined) {
        if (desc !== undefined)
            throw new ClaimsError("pass desc or revert, not both");
        desc = descAt(claim, input.revert);
        if (desc === undefined)
            throw new ClaimsError(`claim "${claim.id}" has no revision ${input.revert}; known: ${claim.history.map((h) => h.rev).join(", ")}`);
    }
    let meaning;
    if (desc !== undefined && desc.trim() && cleanText("desc", desc, MAX_DESC) !== claim.desc) {
        const to = cleanText("desc", desc, MAX_DESC);
        noSecret("desc", to);
        const by = decision(claim, to, input.decidedBy, input.why);
        const from = claim.desc;
        claim.rev = Math.max(claim.rev, ...claim.history.map((h) => h.rev)) + 1;
        claim.desc = to;
        claim.history.push({ rev: claim.rev, desc: to, at: now(), ...by });
        meaning = { from, to, rev: claim.rev, ...by };
    }
    if (input.keywords) {
        noSecret("keywords", input.keywords.join(" "));
        claim.keywords = cleanKeywords(input.keywords);
    }
    if (input.noCode !== undefined) {
        noSecret("no_code", input.noCode);
        if (input.noCode.trim())
            claim.noCode = cleanText("no_code", input.noCode, MAX_NOTE);
        else
            delete claim.noCode;
    }
    store.saveClaim(claim);
    const edits = [];
    for (const e of input.edits ?? []) {
        try {
            edits.push({ mention: e.mention, ok: true, message: applyEdit(store, claim, e) });
        }
        catch (err) {
            edits.push({ mention: e.mention, ok: false, message: err.message });
        }
    }
    let staleMentions = [];
    let staleOutputs = [];
    if (meaning) {
        const contents = new Map();
        staleMentions = store.mentions(claim.id).map((r) => resolveMention(store, claim, r, { contents })).filter((r) => r.stale && !r.acked);
        staleOutputs = outputResolver(store, { contents }).all().filter((o) => Object.hasOwn(o.output.claims, claim.id) && outputIsIssue(o));
    }
    return { claim, ...(meaning ? { meaning } : {}), edits, staleMentions, staleOutputs };
}
/** Bring back the meaning of an earlier revision (as a new revision). */
export function revertClaim(store, input) {
    return updateClaim(store, {
        claim: input.claim,
        revert: input.rev,
        ...(input.decidedBy ? { decidedBy: input.decidedBy } : {}),
        ...(input.why ? { why: input.why } : {}),
    });
}
/**
 * A meaning change is the user's decision, recorded with who decided and why.
 * The agent's own idea is refused: it must ask first, then call again with decided_by "user".
 */
function decision(claim, to, decidedBy, why) {
    const proposal = `"${clip(claim.desc, 80)}" -> "${clip(to, 80)}"`;
    if (decidedBy === "agent") {
        throw new ClaimsError(`Not applied: changing what "${claim.id}" promises is the user's decision. Ask the user (${proposal}); if they agree, call again with decided_by "user" and why quoting their answer.`);
    }
    if (decidedBy !== "user" && decidedBy !== "user_request") {
        throw new ClaimsError(`A meaning change needs decided_by: "user" (they said so), "user_request" (it follows from what they asked for), or "agent" (your own idea: then ask them first). Plus why, quoting or summarizing the user. Proposed: ${proposal}`);
    }
    if (!why?.trim())
        throw new ClaimsError(`A meaning change needs why: the user's words or the request it follows from.`);
    noSecret("why", why);
    return { by: decidedBy, why: cleanText("why", why, MAX_NOTE) };
}
export function relinkMention(store, input) {
    const claim = store.getClaim(input.claim);
    const ref = store.findMention(claim.id, input.mention);
    const m = ref.mention;
    const rel = relPath(store.root, input.path);
    guardPath(rel, store.config().exclude);
    const abs = absPath(store.root, rel);
    if (!existsSync(abs))
        throw new ClaimsError(`file not found: ${rel}`);
    if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
        const content = readText(abs);
        const hit = content === undefined ? undefined : locate(content, m.anchor, input.line ?? m.line).best;
        if (!hit)
            throw new ClaimsError(`the mention's wording was not found in ${rel}`);
        m.line = hit.line;
    }
    m.path = rel;
    const local = store.isLocalPath(rel);
    if (local !== ref.local) {
        // move between shared and local storage, keeping the id
        if (ref.local) {
            const l = store.getLocal(claim.id);
            l.mentions = l.mentions.filter((x) => x !== m);
            store.saveLocal(l);
            claim.mentions.push(m);
            store.saveClaim(claim);
        }
        else {
            claim.mentions = claim.mentions.filter((x) => x !== m);
            store.saveClaim(claim);
            const l = store.getLocal(claim.id);
            l.mentions.push(m);
            store.saveLocal(l);
        }
    }
    else
        store.saveMentionSide(claim.id, local);
    return resolveMention(store, claim, { mention: m, local });
}
export function removeMention(store, input) {
    const claim = store.getClaim(input.claim);
    const ref = store.findMention(claim.id, input.mention);
    if (ref.local) {
        const l = store.getLocal(claim.id);
        l.mentions = l.mentions.filter((x) => x.id !== input.mention);
        store.saveLocal(l);
    }
    else {
        claim.mentions = claim.mentions.filter((x) => x.id !== input.mention);
        store.saveClaim(claim);
    }
}
export function removeClaim(store, id) {
    store.getClaim(id);
    store.deleteClaim(id);
}
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred|thousand|million|once|twice|dozen)\b/i;
/** A claim that states a number but has no code place, so nothing would notice its constant changing. */
export function isUnbackedNumber(store, claim) {
    return !claim.noCode && NUMBER.test(claim.desc) && !store.mentions(claim.id).some((r) => r.mention.kind === "code");
}
export function check(store, opts = {}) {
    const ids = opts.claims?.length ? opts.claims : store.claimIds();
    const paths = opts.paths ? new Set(opts.paths.map((p) => (isUrl(p) ? p : relPath(store.root, p)))) : undefined;
    const contents = new Map();
    const mentionIssues = [];
    const mentionAcked = [];
    let mentions = 0;
    for (const id of ids) {
        const claim = store.getClaim(id);
        for (const r of store.mentions(id)) {
            if (paths && !paths.has(r.mention.path))
                continue;
            mentions++;
            const res = resolveMention(store, claim, r, { contents, searchMissing: opts.searchMissing ?? false });
            if (mentionIsIssue(res))
                mentionIssues.push(res);
            else if (res.acked !== undefined && mentionIsIssue({ ...res, acked: undefined }))
                mentionAcked.push(res);
        }
    }
    const outs = outputResolver(store, { contents }).all();
    const relevant = outs.filter((o) => {
        if (opts.claims?.length && !opts.claims.some((c) => Object.hasOwn(o.output.claims, c)))
            return false;
        if (paths && !paths.has(o.output.path) && !o.output.inputs.some((i) => paths.has(i.ref)))
            return false;
        return true;
    });
    return {
        claims: ids.length,
        mentions,
        outputs: relevant.length,
        mentionIssues,
        outputIssues: relevant.filter(outputIsIssue),
        mentionAcked,
        outputAcked: relevant.filter((o) => o.status !== "ok" && o.acked !== undefined),
        unbackedNumbers: paths ? [] : ids.map((id) => store.getClaim(id)).filter((c) => isUnbackedNumber(store, c)),
    };
}
/** Stable keys for open issues, used to tell new problems from ones that existed at session start. */
export function issueKeys(c) {
    return [
        ...c.mentionIssues.map((r) => `${r.claim}#${r.mention.id}:${r.status}:${r.stale}`),
        ...c.outputIssues.map((o) => `out:${o.output.id}:${o.status}`),
    ];
}
export function claimsIn(store, path) {
    const rel = isUrl(path) ? path : relPath(store.root, path);
    const contents = new Map();
    const mentions = [];
    for (const id of store.claimIds()) {
        const claim = store.getClaim(id);
        for (const r of store.mentions(id))
            if (r.mention.path === rel)
                mentions.push(resolveMention(store, claim, r, { contents }));
    }
    const outs = outputResolver(store, { contents }).all();
    const mentionRefs = new Set(mentions.map((r) => `${r.claim}#${r.mention.id}`));
    const outputAt = outs.find((o) => o.output.path === rel);
    return {
        path: rel,
        mentions,
        outputsFrom: outs.filter((o) => o.output.inputs.some((i) => i.ref === rel || mentionRefs.has(i.ref))),
        ...(outputAt ? { outputAt } : {}),
    };
}
/** Possible unregistered mentions of known claims in a file (suggestions only). */
export function scanFile(store, path) {
    const rel = relPath(store.root, path);
    const content = readText(absPath(store.root, rel));
    if (content === undefined)
        return [];
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (const id of store.claimIds()) {
        const claim = store.getClaim(id);
        const refs = store.mentions(id);
        const registeredHere = new Set(refs.filter((r) => r.mention.path === rel).map((r) => r.mention.line));
        // same wording as another mention of this claim
        const seen = new Set();
        for (const r of refs) {
            if (r.mention.path === rel || !r.mention.anchor)
                continue;
            const hit = locate(content, r.mention.anchor, undefined, false).best;
            if (hit && !registeredHere.has(hit.line) && !seen.has(hit.line)) {
                seen.add(hit.line);
                hits.push({ claim: id, line: hit.line, text: lines[hit.line - 1].trim().slice(0, 160), why: `same wording as ${id}#${r.mention.id}` });
            }
        }
        // keyword lines
        if (!claim.keywords.length)
            continue;
        const kw = new Set(claim.keywords);
        const need = Math.min(2, kw.size);
        lines.forEach((l, i) => {
            const line = i + 1;
            if (seen.has(line) || registeredHere.has(line))
                return;
            const words = new Set(tokenize(l).map((t) => t.word));
            const found = [...kw].filter((k) => (k.includes(" ") ? l.toLowerCase().includes(k) : words.has(k)));
            if (found.length >= need) {
                seen.add(line);
                hits.push({ claim: id, line, text: l.trim().slice(0, 160), why: `keywords: ${found.join(", ")}` });
            }
        });
    }
    return hits.slice(0, 30);
}
// ---------- generated outputs ----------
/** Does output `from` (transitively) use output `target` as an input? */
function dependsOn(outputs, from, target) {
    const byId = new Map(outputs.map((o) => [o.id, o]));
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
        const id = stack.pop();
        if (id === target)
            return true;
        if (seen.has(id))
            continue;
        seen.add(id);
        for (const i of byId.get(id)?.inputs ?? [])
            if (i.ref.startsWith("out:"))
                stack.push(i.ref.slice(4));
    }
    return false;
}
function slug(s) {
    return s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "output";
}
/** Record (or re-record after regenerating) a generated file and what it was made from. */
export function recordOutput(store, input) {
    const url = isUrl(input.path);
    const rel = url ? input.path : relPath(store.root, input.path);
    if (!url && !existsSync(absPath(store.root, rel)))
        throw new ClaimsError(`output file not found: ${rel}. Record it after generating.`);
    if (!url)
        guardPath(rel, store.config().exclude);
    if (!input.inputs.length)
        throw new ClaimsError("inputs is required: list the scripts, files, mentions (claim#m1) or outputs (out:id) this was generated from");
    const all = store.allOutputs();
    const existing = all.find((e) => (input.id && e.output.id === input.id) || e.output.path === rel);
    const id = existing?.output.id ?? input.id ?? (() => {
        const baseId = slug(basename(rel));
        let candidate = baseId;
        for (let n = 2; all.some((e) => e.output.id === candidate); n++)
            candidate = `${baseId}-${n}`;
        return candidate;
    })();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
        throw new ClaimsError(`invalid output id "${id}"`);
    const resolver = outputResolver(store);
    const claimIds = new Set(input.claims ?? []);
    const inputs = input.inputs.map((raw) => {
        const mref = parseMentionRef(raw);
        let ref = raw;
        if (mref) {
            store.findMention(mref.claim, mref.mention);
            claimIds.add(mref.claim);
        }
        else if (raw.startsWith("out:")) {
            const up = all.find((e) => e.output.id === raw.slice(4));
            if (!up)
                throw new ClaimsError(`unknown output ${raw}`);
            if (up.output.id === id || dependsOn(all.map((e) => e.output), up.output.id, id)) {
                throw new ClaimsError(`out:${up.output.id} is built from ${id}; an output cannot (indirectly) be its own input`);
            }
            for (const c of Object.keys(up.output.claims))
                claimIds.add(c);
        }
        else {
            ref = relPath(store.root, raw);
            guardPath(ref, store.config().exclude);
            if (!existsSync(absPath(store.root, ref)))
                throw new ClaimsError(`input not found: ${ref}`);
            for (const cid of store.claimIds())
                if (store.mentions(cid).some((r) => r.mention.path === ref))
                    claimIds.add(cid);
        }
        return { ref, hash: resolver.inputHash(ref) };
    });
    const claims = {};
    for (const c of claimIds)
        claims[c] = store.getClaim(c).rev;
    const kind = input.kind ?? existing?.output.kind ?? inferKind(rel, false);
    const out = {
        id,
        kind,
        path: rel,
        inputs,
        claims,
        fp: url ? "" : fingerprint(absPath(store.root, rel)) ?? "",
        meta: cleanMeta(input.meta),
        at: now(),
    };
    const local = !url && store.isLocalPath(rel);
    for (const side of [false, true]) {
        const list = store.outputs(side).filter((o) => o.id !== id);
        if (side === local)
            list.push(out);
        store.saveOutputs(side, list);
    }
    return outputResolver(store).resolve(id);
}
export function ackOutput(store, input) {
    noSecret("note", input.note);
    const r = outputResolver(store).resolve(input.id);
    if (!r)
        throw new ClaimsError(`unknown output "${input.id}"`);
    const list = store.outputs(r.local);
    const o = list.find((x) => x.id === input.id);
    o.ack = { sig: r.sig, note: input.note || "acknowledged", at: now() };
    store.saveOutputs(r.local, list);
    return outputResolver(store).resolve(input.id);
}
export function removeOutput(store, id) {
    const hit = store.allOutputs().find((e) => e.output.id === id);
    if (!hit)
        throw new ClaimsError(`unknown output "${id}"`);
    store.saveOutputs(hit.local, store.outputs(hit.local).filter((o) => o.id !== id));
}
