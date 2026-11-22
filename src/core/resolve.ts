import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileSize, fingerprint, hashText } from "./fingerprint.ts";
import { followRename, gitRenames, isExcluded, isProtectedPath, isTextPath, safeAbsPath, walkFiles } from "./project.ts";
import type { MentionRef, Store } from "./store.ts";
import { blockAt, clip, contextAround, FileIndex, locate } from "./text.ts";
import {
  ANCHORED_KINDS,
  type Claim,
  type Mention,
  type Output,
  type ResolvedMention,
  type ResolvedOutput,
} from "./types.ts";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export function isUrl(p: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
}

/** Description of the claim at a given revision. */
export function descAt(claim: Claim, rev: number): string | undefined {
  if (rev === claim.rev) return claim.desc;
  return claim.history.find((h) => h.rev === rev)?.desc;
}

/** Meaning changed since rev? (A revert back to the same wording is not a change.) */
export function meaningChangedSince(claim: Claim, rev: number): boolean {
  return descAt(claim, rev) !== claim.desc;
}

export function readText(abs: string): string | undefined {
  try {
    if (statSync(abs).size > MAX_TEXT_BYTES) return undefined;
    return readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
}

export interface ResolveOptions {
  context?: number;
  /** Search the project for a missing file's wording (slower). */
  searchMissing?: boolean;
  /** Pre-read file content keyed by relative path (avoids re-reading in loops). */
  contents?: Map<string, string | undefined>;
  /** Per-file lookups (line starts, normalized text, tokens) shared by every mention in a file. */
  indexes?: Map<string, FileIndex>;
  /** Project file list, walked at most once per call. */
  files?: string[];
}

function indexFor(rel: string, content: string, opts: ResolveOptions): FileIndex {
  opts.indexes ??= new Map();
  let fx = opts.indexes.get(rel);
  if (!fx || fx.content !== content) {
    fx = new FileIndex(content);
    opts.indexes.set(rel, fx);
  }
  return fx;
}

/** Paths a (possibly untrusted) store may name but claimkeeper must never read or write. */
export function isForbiddenPath(store: Store, rel: string): boolean {
  return isProtectedPath(rel) || isExcluded(rel, store.config().exclude);
}

function contentOf(store: Store, rel: string, opts: ResolveOptions): string | undefined {
  if (opts.contents?.has(rel)) return opts.contents.get(rel);
  const abs = safeAbsPath(store.root, rel);
  const c = abs ? readText(abs) : undefined;
  opts.contents?.set(rel, c);
  return c;
}

/** The path git says this missing file was renamed to, if that file exists and may be tracked. */
function gitRenamedTo(store: Store, rel: string): string | undefined {
  const to = followRename(gitRenames(store.root), rel);
  if (!to || isForbiddenPath(store, to)) return undefined;
  const abs = safeAbsPath(store.root, to);
  return abs && existsSync(abs) ? to : undefined;
}

function findCandidates(store: Store, m: Mention, opts: ResolveOptions): string[] {
  opts.files ??= walkFiles(store.root).filter((f) => !isForbiddenPath(store, f));
  const files = opts.files.filter((f) => f !== m.path);
  const out: string[] = [];
  if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
    for (const f of files) {
      if (!isTextPath(f)) continue;
      const abs = safeAbsPath(store.root, f);
      const c = abs ? readText(abs) : undefined;
      if (c && locate(c, m.anchor, undefined, false).best) out.push(f);
      if (out.length >= 5) break;
    }
  } else {
    const name = basename(m.path);
    const size = fileSize(m.fp);
    for (const f of files) {
      if (basename(f) === name) out.push(f);
      else if (size !== undefined) {
        // compare sizes first: fingerprinting every file is the expensive part
        const abs = safeAbsPath(store.root, f);
        let same = false;
        try {
          same = !!abs && statSync(abs).size === size;
        } catch {
          same = false;
        }
        if (same && fingerprint(abs!) === m.fp) out.push(f);
      }
      if (out.length >= 5) break;
    }
  }
  return out;
}

/** A fuzzy hit sitting on another tracked mention's exact wording is that mention, not this one. */
function overlapsOtherMention(store: Store, self: Mention, content: string, start: number, end: number): boolean {
  for (const id of store.claimIds()) {
    for (const r of store.mentions(id)) {
      const o = r.mention;
      if (o === self || o.path !== self.path || !o.anchor) continue;
      let i = content.indexOf(o.anchor);
      while (i !== -1) {
        if (i < end && i + o.anchor.length > start) return true;
        i = content.indexOf(o.anchor, i + 1);
      }
    }
  }
  return false;
}

export function mentionSig(r: Pick<ResolvedMention, "status" | "current" | "stale">, claim: Claim): string {
  return hashText(`${claim.rev}|${r.status}|${r.stale}|${r.current ?? ""}`);
}

export function resolveMention(store: Store, claim: Claim, ref: MentionRef, opts: ResolveOptions = {}): ResolvedMention {
  const m = ref.mention;
  const stale = meaningChangedSince(claim, m.rev);
  const base: ResolvedMention = {
    claim: claim.id,
    mention: m,
    local: ref.local,
    status: "ok",
    stale,
    ...(stale ? { staleFrom: m.rev === 0 ? "(registered as contradicting this claim)" : descAt(claim, m.rev) ?? `(rev ${m.rev})` } : {}),
  };
  const finish = (r: ResolvedMention): ResolvedMention => {
    if (m.ack && m.ack.sig === mentionSig(r, claim)) r.acked = m.ack.note;
    return r;
  };

  if (m.kind === "url" || isUrl(m.path)) return finish({ ...base, status: "unchecked" });

  const abs = isForbiddenPath(store, m.path) ? undefined : safeAbsPath(store.root, m.path);
  if (!abs) return finish({ ...base, status: "unsafe_path" });
  if (!existsSync(abs)) {
    const r: ResolvedMention = { ...base, status: "file_not_found" };
    if (opts.searchMissing) {
      // git knows renames exactly; only when it doesn't, search by name, size and wording
      const moved = gitRenamedTo(store, m.path);
      if (moved) r.gitRename = moved;
      else {
        const c = findCandidates(store, m, opts);
        if (c.length) r.candidates = c;
      }
    }
    return finish(r);
  }

  if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
    const content = contentOf(store, m.path, opts);
    if (content === undefined) return finish({ ...base, status: "text_not_found" });
    const { best, others } = locate(indexFor(m.path, content, opts), m.anchor, m.line);
    if (!best) return finish({ ...base, status: "text_not_found" });
    if (best.mode === "fuzzy" && overlapsOtherMention(store, m, content, best.start, best.end)) {
      return finish({ ...base, status: "text_not_found" });
    }
    const r: ResolvedMention = {
      ...base,
      line: best.line,
      current: content.slice(best.start, best.end),
      range: [best.start, best.end],
      status:
        best.mode === "fuzzy"
          ? "changed"
          : best.mode === "normalized"
            ? "reformatted"
            : m.line === undefined || m.line === best.line
              ? "ok"
              : "moved",
    };
    if (best.mode === "fuzzy") r.similarity = best.similarity;
    if (others.length) r.alsoAt = others;
    if (m.kind === "code" && m.block && best.mode !== "fuzzy") {
      if (hashText(blockAt(content, best.line)) !== m.block) r.status = "code_changed";
    }
    if (opts.context) r.context = contextAround(content, best.line, opts.context);
    return finish(r);
  }

  // fingerprint-only kinds
  const fp = fingerprint(abs);
  return finish({ ...base, status: m.fp && fp !== m.fp ? "changed" : "ok", current: fp });
}

/** A mention needs attention (moved/reformatted are fine; acked is fine). */
export function mentionIsIssue(r: ResolvedMention): boolean {
  if (r.acked !== undefined) return false;
  if (r.stale) return true;
  return !["ok", "moved", "reformatted", "unchecked"].includes(r.status);
}

// ---------- outputs ----------

export interface OutputResolver {
  resolve(id: string): ResolvedOutput | undefined;
  inputHash(ref: string): string;
  all(): ResolvedOutput[];
}

export function parseMentionRef(ref: string): { claim: string; mention: string } | undefined {
  const m = /^([a-z0-9][a-z0-9-]*)#([A-Za-z0-9]+)$/.exec(ref);
  return m ? { claim: m[1]!, mention: m[2]! } : undefined;
}

/** Current hash of an output input. */
function currentInputHash(store: Store, ref: string, outputs: Map<string, Output>, opts: ResolveOptions): string {
  const mref = parseMentionRef(ref);
  if (mref) {
    if (!store.hasClaim(mref.claim)) return "missing";
    const claim = store.getClaim(mref.claim);
    const found = store.mentions(mref.claim).find((r) => r.mention.id === mref.mention);
    if (!found) return "missing";
    const r = resolveMention(store, claim, found, opts);
    if (r.status === "file_not_found" || r.status === "text_not_found") return "missing";
    return r.current ? hashText(r.current) : `rev${claim.rev}`;
  }
  if (ref.startsWith("out:")) {
    const o = outputs.get(ref.slice(4));
    if (!o) return "missing";
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
function inputsCarryCurrentMeaning(store: Store, claim: Claim, o: Output): boolean {
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const i of o.inputs) {
    const mref = parseMentionRef(i.ref);
    if (mref) {
      if (mref.claim === claim.id) ids.add(mref.mention);
    } else if (!i.ref.startsWith("out:")) paths.add(i.ref);
  }
  const carried = store.mentions(claim.id).filter((r) => ids.has(r.mention.id) || paths.has(r.mention.path));
  return carried.length > 0 && carried.every((r) => !meaningChangedSince(claim, r.mention.rev));
}

export function outputResolver(store: Store, opts: ResolveOptions = {}): OutputResolver {
  const entries = store.allOutputs();
  const byId = new Map(entries.map((e) => [e.output.id, e.output]));
  const localOf = new Map(entries.map((e) => [e.output.id, e.local]));
  const memo = new Map<string, ResolvedOutput>();
  const visiting = new Set<string>();
  const ctx: ResolveOptions = { ...opts, contents: opts.contents ?? new Map() };

  const inputHash = (ref: string) => currentInputHash(store, ref, byId, ctx);

  const resolve = (id: string, depth = 0): ResolvedOutput | undefined => {
    const hit = memo.get(id);
    if (hit) return hit;
    const o = byId.get(id);
    if (!o) return undefined;
    if (visiting.has(id)) return undefined;
    visiting.add(id);

    const reasons: string[] = [];
    const nowHashes: string[] = [];
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
    if (!isUrl(o.path) && !abs) reasons.push("path is outside the project: refused");
    const exists = isUrl(o.path) || (!!abs && existsSync(abs));
    const fp = exists && abs ? fingerprint(abs) : undefined;
    const changed = exists && !isUrl(o.path) && fp !== o.fp;
    if (changed) reasons.push("file differs from what was recorded (regenerated or edited without output action=record)");

    const status = !exists ? "not_generated" : stale ? "stale" : regen ? "needs_regen" : changed ? "changed" : "ok";
    if (!exists) reasons.unshift("output file not found");
    // the ack covers this exact state: any new change to an input or the file lapses it
    const sig = hashText(`${status}|${[...reasons].sort().join("|")}|${nowHashes.join(",")}|${fp ?? ""}`);
    const r: ResolvedOutput = { output: o, local: localOf.get(id) ?? false, status, reasons, sig };
    if (o.ack && o.ack.sig === sig) r.acked = o.ack.note;
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };

  return {
    resolve,
    inputHash,
    all: () => entries.map((e) => resolve(e.output.id)).filter((r): r is ResolvedOutput => !!r),
  };
}

export function outputIsIssue(r: ResolvedOutput): boolean {
  return r.status !== "ok" && r.acked === undefined;
}
