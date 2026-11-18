import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileSize, fingerprint, hashText } from "./fingerprint.js";
import { isExcluded, isProtectedPath, isTextPath, safeAbsPath, walkFiles } from "./project.js";
import { blockAt, clip, contextAround, FileIndex, locate } from "./text.js";
import { ANCHORED_KINDS, } from "./types.js";
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export function isUrl(p) {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
}
/** Description of the claim at a given revision. */
export function descAt(claim, rev) {
    if (rev === claim.rev)
        return claim.desc;
    return claim.history.find((h) => h.rev === rev)?.desc;
}
/** Meaning changed since rev? (A revert back to the same wording is not a change.) */
export function meaningChangedSince(claim, rev) {
    return descAt(claim, rev) !== claim.desc;
}
export function readText(abs) {
    try {
        if (statSync(abs).size > MAX_TEXT_BYTES)
            return undefined;
        return readFileSync(abs, "utf8");
    }
    catch {
        return undefined;
    }
}
function indexFor(rel, content, opts) {
    opts.indexes ??= new Map();
    let fx = opts.indexes.get(rel);
    if (!fx || fx.content !== content) {
        fx = new FileIndex(content);
        opts.indexes.set(rel, fx);
    }
    return fx;
}
/** Paths a (possibly untrusted) store may name but claimkeeper must never read or write. */
export function isForbiddenPath(store, rel) {
    return isProtectedPath(rel) || isExcluded(rel, store.config().exclude);
}
function contentOf(store, rel, opts) {
    if (opts.contents?.has(rel))
        return opts.contents.get(rel);
    const abs = safeAbsPath(store.root, rel);
    const c = abs ? readText(abs) : undefined;
    opts.contents?.set(rel, c);
    return c;
}
function findCandidates(store, m, opts) {
    opts.files ??= walkFiles(store.root).filter((f) => !isForbiddenPath(store, f));
    const files = opts.files.filter((f) => f !== m.path);
    const out = [];
    if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
        for (const f of files) {
            if (!isTextPath(f))
                continue;
            const abs = safeAbsPath(store.root, f);
            const c = abs ? readText(abs) : undefined;
            if (c && locate(c, m.anchor, undefined, false).best)
                out.push(f);
            if (out.length >= 5)
                break;
        }
    }
    else {
        const name = basename(m.path);
        const size = fileSize(m.fp);
        for (const f of files) {
            if (basename(f) === name)
                out.push(f);
            else if (size !== undefined) {
                // compare sizes first: fingerprinting every file is the expensive part
                const abs = safeAbsPath(store.root, f);
                let same = false;
                try {
                    same = !!abs && statSync(abs).size === size;
                }
                catch {
                    same = false;
                }
                if (same && fingerprint(abs) === m.fp)
                    out.push(f);
            }
            if (out.length >= 5)
                break;
        }
    }
    return out;
}
/** A fuzzy hit sitting on another tracked mention's exact wording is that mention, not this one. */
function overlapsOtherMention(store, self, content, start, end) {
    for (const id of store.claimIds()) {
        for (const r of store.mentions(id)) {
            const o = r.mention;
            if (o === self || o.path !== self.path || !o.anchor)
                continue;
            let i = content.indexOf(o.anchor);
            while (i !== -1) {
                if (i < end && i + o.anchor.length > start)
                    return true;
                i = content.indexOf(o.anchor, i + 1);
            }
        }
    }
    return false;
}
export function mentionSig(r, claim) {
    return hashText(`${claim.rev}|${r.status}|${r.stale}|${r.current ?? ""}`);
}
export function resolveMention(store, claim, ref, opts = {}) {
    const m = ref.mention;
    const stale = meaningChangedSince(claim, m.rev);
    const base = {
        claim: claim.id,
        mention: m,
        local: ref.local,
        status: "ok",
        stale,
        ...(stale ? { staleFrom: m.rev === 0 ? "(registered as contradicting this claim)" : descAt(claim, m.rev) ?? `(rev ${m.rev})` } : {}),
    };
    const finish = (r) => {
        if (m.ack && m.ack.sig === mentionSig(r, claim))
            r.acked = m.ack.note;
        return r;
    };
    if (m.kind === "url" || isUrl(m.path))
        return finish({ ...base, status: "unchecked" });
    const abs = isForbiddenPath(store, m.path) ? undefined : safeAbsPath(store.root, m.path);
    if (!abs)
        return finish({ ...base, status: "unsafe_path" });
    if (!existsSync(abs)) {
        const r = { ...base, status: "file_not_found" };
        if (opts.searchMissing) {
            const c = findCandidates(store, m, opts);
            if (c.length)
                r.candidates = c;
        }
        return finish(r);
    }
    if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
        const content = contentOf(store, m.path, opts);
        if (content === undefined)
            return finish({ ...base, status: "text_not_found" });
        const { best, others } = locate(indexFor(m.path, content, opts), m.anchor, m.line);
        if (!best)
            return finish({ ...base, status: "text_not_found" });
        if (best.mode === "fuzzy" && overlapsOtherMention(store, m, content, best.start, best.end)) {
            return finish({ ...base, status: "text_not_found" });
        }
        const r = {
            ...base,
            line: best.line,
            current: content.slice(best.start, best.end),
            range: [best.start, best.end],
            status: best.mode === "fuzzy"
                ? "changed"
                : best.mode === "normalized"
                    ? "reformatted"
                    : m.line === undefined || m.line === best.line
                        ? "ok"
                        : "moved",
        };
        if (best.mode === "fuzzy")
            r.similarity = best.similarity;
        if (others.length)
            r.alsoAt = others;
        if (m.kind === "code" && m.block && best.mode !== "fuzzy") {
            if (hashText(blockAt(content, best.line)) !== m.block)
                r.status = "code_changed";
        }
        if (opts.context)
            r.context = contextAround(content, best.line, opts.context);
        return finish(r);
    }
    // fingerprint-only kinds
    const fp = fingerprint(abs);
    return finish({ ...base, status: m.fp && fp !== m.fp ? "changed" : "ok", current: fp });
}
/** A mention needs attention (moved/reformatted are fine; acked is fine). */
export function mentionIsIssue(r) {
    if (r.acked !== undefined)
        return false;
    if (r.stale)
        return true;
    return !["ok", "moved", "reformatted", "unchecked"].includes(r.status);
}
export function parseMentionRef(ref) {
    const m = /^([a-z0-9][a-z0-9-]*)#([A-Za-z0-9]+)$/.exec(ref);
    return m ? { claim: m[1], mention: m[2] } : undefined;
}
/** Current hash of an output input. */
function currentInputHash(store, ref, outputs, opts) {
    const mref = parseMentionRef(ref);
    if (mref) {
        if (!store.hasClaim(mref.claim))
            return "missing";
        const claim = store.getClaim(mref.claim);
        const found = store.mentions(mref.claim).find((r) => r.mention.id === mref.mention);
        if (!found)
            return "missing";
        const r = resolveMention(store, claim, found, opts);
        if (r.status === "file_not_found" || r.status === "text_not_found")
            return "missing";
        return r.current ? hashText(r.current) : `rev${claim.rev}`;
    }
    if (ref.startsWith("out:")) {
        const o = outputs.get(ref.slice(4));
        if (!o)
            return "missing";
        const abs = safeAbsPath(store.root, o.path);
        return (abs && fingerprint(abs)) || "missing";
    }
    const abs = isForbiddenPath(store, ref) ? undefined : safeAbsPath(store.root, ref);
    return (abs && fingerprint(abs)) || "missing";
}
const MAX_CHAIN = 64;
/**
 * After a meaning change, an output is still fine for that claim when the inputs it was
 * built from carry the claim and every such mention is confirmed for the current meaning
 * (unchanged inputs whose wording still holds; changed inputs are caught as needs_regen).
 * Opaque outputs with no tracked wording for the claim stay stale.
 */
function inputsCarryCurrentMeaning(store, claim, o) {
    const paths = new Set();
    const ids = new Set();
    for (const i of o.inputs) {
        const mref = parseMentionRef(i.ref);
        if (mref) {
            if (mref.claim === claim.id)
                ids.add(mref.mention);
        }
        else if (!i.ref.startsWith("out:"))
            paths.add(i.ref);
    }
    const carried = store.mentions(claim.id).filter((r) => ids.has(r.mention.id) || paths.has(r.mention.path));
    return carried.length > 0 && carried.every((r) => !meaningChangedSince(claim, r.mention.rev));
}
export function outputResolver(store, opts = {}) {
    const entries = store.allOutputs();
    const byId = new Map(entries.map((e) => [e.output.id, e.output]));
    const localOf = new Map(entries.map((e) => [e.output.id, e.local]));
    const memo = new Map();
    const visiting = new Set();
    const ctx = { ...opts, contents: opts.contents ?? new Map() };
    const inputHash = (ref) => currentInputHash(store, ref, byId, ctx);
    const resolve = (id, depth = 0) => {
        const hit = memo.get(id);
        if (hit)
            return hit;
        const o = byId.get(id);
        if (!o)
            return undefined;
        if (visiting.has(id))
            return undefined;
        visiting.add(id);
        const reasons = [];
        const nowHashes = [];
        let regen = false;
        let stale = false;
        for (const input of o.inputs) {
            const now = inputHash(input.ref);
            nowHashes.push(now);
            if (now !== input.hash) {
                regen = true;
                reasons.push(now === "missing" ? `input ${input.ref} is missing` : `input ${input.ref} changed`);
            }
            if (input.ref.startsWith("out:")) {
                if (depth >= MAX_CHAIN) {
                    regen = true;
                    reasons.push("output chain is too deep to check");
                    continue;
                }
                const up = resolve(input.ref.slice(4), depth + 1);
                if (up && up.status !== "ok" && !up.acked) {
                    regen = true;
                    reasons.push(`upstream ${input.ref} is ${up.status}`);
                }
            }
        }
        for (const [cid, rev] of Object.entries(o.claims)) {
            if (!store.hasClaim(cid)) {
                reasons.push(`claim ${cid} was removed`);
                stale = true;
                continue;
            }
            const c = store.getClaim(cid);
            if (meaningChangedSince(c, rev) && !inputsCarryCurrentMeaning(store, c, o)) {
                stale = true;
                reasons.push(`claim ${cid} meaning changed: "${clip(descAt(c, rev) ?? `rev ${rev}`, 80)}" -> "${clip(c.desc, 80)}"`);
            }
        }
        const abs = isUrl(o.path) ? undefined : safeAbsPath(store.root, o.path);
        if (!isUrl(o.path) && !abs)
            reasons.push("path is outside the project: refused");
        const exists = isUrl(o.path) || (!!abs && existsSync(abs));
        const fp = exists && abs ? fingerprint(abs) : undefined;
        const changed = exists && !isUrl(o.path) && fp !== o.fp;
        if (changed)
            reasons.push("file differs from what was recorded (regenerated or edited without output action=record)");
        const status = !exists ? "not_generated" : stale ? "stale" : regen ? "needs_regen" : changed ? "changed" : "ok";
        if (!exists)
            reasons.unshift("output file not found");
        // the ack covers this exact state: any new change to an input or the file lapses it
        const sig = hashText(`${status}|${[...reasons].sort().join("|")}|${nowHashes.join(",")}|${fp ?? ""}`);
        const r = { output: o, local: localOf.get(id) ?? false, status, reasons, sig };
        if (o.ack && o.ack.sig === sig)
            r.acked = o.ack.note;
        visiting.delete(id);
        memo.set(id, r);
        return r;
    };
    return {
        resolve,
        inputHash,
        all: () => entries.map((e) => resolve(e.output.id)).filter((r) => !!r),
    };
}
export function outputIsIssue(r) {
    return r.status !== "ok" && r.acked === undefined;
}
