import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/text.ts
function lineAt(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}
var FileIndex = class {
  content;
  starts;
  normCache;
  tokenCache;
  constructor(content) {
    this.content = content;
  }
  line(offset) {
    if (!this.starts) {
      this.starts = [0];
      for (let i = 0; i < this.content.length; i++) if (this.content.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  get norm() {
    return this.normCache ??= normalize(this.content);
  }
  get tokens() {
    return this.tokenCache ??= tokenize(this.content);
  }
};
function fileIndex(c) {
  return typeof c === "string" ? new FileIndex(c) : c;
}
function allIndexes(hay, needle) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}
var QUOTES = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\xA0": " "
};
var INLINE_TAGS = /* @__PURE__ */ new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "tspan",
  "u",
  "var"
]);
function normalize(src) {
  let text = "";
  const map = [];
  let pendingSpace = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "<") {
      const rel = src.slice(i + 1, i + 400).indexOf(">");
      const close = rel === -1 ? -1 : i + 1 + rel;
      const inner = close === -1 ? "" : src.slice(i + 1, close);
      if (close !== -1 && /^\/?[A-Za-z!][^<>]*$/s.test(inner)) {
        const name = /^\/?([A-Za-z0-9]+)/.exec(inner)?.[1]?.toLowerCase() ?? "";
        if (!INLINE_TAGS.has(name)) pendingSpace = true;
        i = close + 1;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "`" || ch === "#" || ch === "{" || ch === "}") {
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = true;
      i++;
      continue;
    }
    if (pendingSpace && text.length > 0) {
      text += " ";
      map.push(i);
    }
    pendingSpace = false;
    const lower = (QUOTES[ch] ?? ch).toLowerCase();
    for (let u = 0; u < lower.length; u++) map.push(i);
    text += lower;
    i++;
  }
  return { text, map };
}
function tokenize(src) {
  const out = [];
  const re = /[\p{L}\p{N}]+(?:['’.][\p{L}\p{N}]+)*/gu;
  for (const m of src.matchAll(re)) {
    out.push({ word: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
  }
  return out;
}
function pickNearest(lines, hint) {
  if (hint === void 0) return 0;
  let best = 0;
  for (let i = 1; i < lines.length; i++) {
    if (Math.abs(lines[i] - hint) < Math.abs(lines[best] - hint)) best = i;
  }
  return best;
}
function locate(input, anchor, hint, fuzzy = true) {
  const fx = fileIndex(input);
  const content = fx.content;
  const exact = allIndexes(content, anchor);
  if (exact.length) {
    const lines = exact.map((o) => fx.line(o));
    const k = pickNearest(lines, hint);
    const start2 = exact[k];
    return {
      best: { mode: "exact", start: start2, end: start2 + anchor.length, line: lines[k], similarity: 1 },
      others: lines.filter((_, i) => i !== k)
    };
  }
  const nc = fx.norm;
  const na = normalize(anchor).text;
  if (na.length >= 3) {
    const hits = allIndexes(nc.text, na);
    if (hits.length) {
      const ranges = hits.map((h) => {
        const start3 = nc.map[h];
        const endIdx = nc.map[h + na.length - 1];
        return [start3, endIdx + 1];
      });
      const lines = ranges.map((r) => fx.line(r[0]));
      const k = pickNearest(lines, hint);
      const [start2, end2] = ranges[k];
      return {
        best: { mode: "normalized", start: start2, end: end2, line: lines[k], similarity: 1 },
        others: lines.filter((_, i) => i !== k)
      };
    }
  }
  if (!fuzzy) return { others: [] };
  const at = tokenize(anchor);
  if (at.length < 4) return { others: [] };
  const ct = fx.tokens;
  if (!ct.length) return { others: [] };
  const want = /* @__PURE__ */ new Map();
  for (const t of at) want.set(t.word, (want.get(t.word) ?? 0) + 1);
  const dice = (from2, to2) => {
    const have = /* @__PURE__ */ new Map();
    let common = 0;
    for (let i = from2; i < to2; i++) {
      const w = ct[i].word;
      const used = have.get(w) ?? 0;
      if (used < (want.get(w) ?? 0)) common++;
      have.set(w, used + 1);
    }
    return 2 * common / (at.length + (to2 - from2));
  };
  const n = at.length;
  let best;
  for (let i = 0; i < ct.length; i++) {
    if (!want.has(ct[i].word)) continue;
    for (let w = Math.max(1, n - 3); w <= n + 3; w++) {
      const to2 = Math.min(ct.length, i + w);
      const score = dice(i, to2);
      if (!best || score > best.score + 1e-9) best = { from: i, to: to2, score };
      else if (Math.abs(score - best.score) < 1e-9 && hint !== void 0) {
        const a = Math.abs(fx.line(ct[i].start) - hint);
        const b = Math.abs(fx.line(ct[best.from].start) - hint);
        if (a < b) best = { from: i, to: to2, score };
      }
    }
  }
  if (!best || best.score < 0.5) return { others: [] };
  let { from, to } = best;
  while (from < to - 1 && !want.has(ct[from].word)) from++;
  while (to - 1 > from && !want.has(ct[to - 1].word)) to--;
  const [start, end] = expandToSentence(content, ct[from].start, ct[to - 1].end);
  return {
    best: { mode: "fuzzy", start, end, line: fx.line(start), similarity: Math.round(best.score * 100) / 100 },
    others: []
  };
}
function expandToSentence(content, start, end) {
  const lineFrom = content.lastIndexOf("\n", start - 1) + 1;
  let lineTo = content.indexOf("\n", end);
  if (lineTo === -1) lineTo = content.length;
  let s = start;
  while (s > lineFrom && !/[.!?]\s/.test(content.slice(s - 2, s))) s--;
  let e = end;
  while (e < lineTo && !/[.!?]/.test(content[e - 1])) e++;
  while (s < e && /\s/.test(content[s])) s++;
  while (e > s && /\s/.test(content[e - 1])) e--;
  return [s, e];
}
function blockAt(content, line) {
  const lines = content.split(/\r?\n/);
  const startIdx = line - 1;
  if (startIdx < 0 || startIdx >= lines.length) return "";
  if (/[;,]\s*$/.test(lines[startIdx]) && !lines[startIdx].includes("{")) return lines[startIdx];
  const out = [];
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < lines.length && out.length < 400; i++) {
    const l = lines[i];
    out.push(l);
    for (const ch of l) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") depth--;
    }
    if (opened && depth <= 0) return out.join("\n");
    if (!opened && i - startIdx >= 2) break;
  }
  const indent = (s) => s.length - s.trimStart().length;
  const base = indent(lines[startIdx]);
  const res = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length && res.length < 400; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      res.push(l);
      continue;
    }
    if (indent(l) <= base) break;
    res.push(l);
  }
  while (res.length > 1 && res[res.length - 1].trim() === "") res.pop();
  return res.join("\n");
}
function contextAround(content, line, radius) {
  const lines = content.split(/\r?\n/);
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const out = [];
  for (let i = from; i <= to; i++) out.push(`${String(i).padStart(5)}| ${lines[i - 1]}`);
  return out.join("\n");
}
var CONTROL_RANGES = [
  [0, 31],
  // C0 controls incl. newlines
  [127, 159],
  // DEL + C1 controls
  [8232, 8233],
  // line/paragraph separators
  [8234, 8238],
  // bidi embeddings/overrides
  [8294, 8297]
  // bidi isolates
];
var CONTROL = new RegExp(`[${CONTROL_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]+`, "g");
function oneLine(s) {
  return s.replace(CONTROL, " ").replace(/\[\s*claimkeeper\s*\]/gi, "(claimkeeper)").replace(/\s+/g, " ").trim();
}
function clip(s, max = 120) {
  const one = oneLine(s);
  return one.length > max ? one.slice(0, max - 1) + "\u2026" : one;
}

// src/core/format.ts
function where(r) {
  const m = r.mention;
  const path = clip(m.path, 160);
  if (m.kind === "url") return path;
  const hint = m.line;
  if (r.line !== void 0 && hint !== void 0 && r.line !== hint) return `${path}:${hint}\u2192${r.line}`;
  if (r.line !== void 0) return `${path}:${r.line}`;
  return path;
}
function mentionLine(r, withClaim = false) {
  const m = r.mention;
  const id = withClaim ? `${r.claim}#${m.id}` : m.id;
  const flags = [r.status === "unchecked" ? "check-by-hand" : r.status];
  if (r.stale) flags.push(m.rev === 0 ? "CONFLICT" : `STALE(rev ${m.rev})`);
  if (r.acked !== void 0) flags.push(`acked: ${clip(r.acked, 60)}`);
  let line = `  ${id.padEnd(withClaim ? 18 : 4)} ${m.kind.padEnd(5)} ${where(r).padEnd(30)} ${flags.join(" ")}`;
  if (r.status === "unchecked") {
    line += m.anchor ? `
        web page: check by hand that it still says "${clip(m.anchor, 120)}"` : `
        web page: check it by hand`;
  } else if (m.anchor) {
    if (r.status === "changed") line += `
        now: "${clip(r.current ?? "", 140)}" (similarity ${r.similarity})
        was: "${clip(m.anchor, 140)}"`;
    else if (r.status === "text_not_found") line += `
        missing wording: "${clip(m.anchor, 140)}"`;
    else line += `  "${clip(r.current ?? m.anchor, 100)}"`;
  }
  if (r.status === "code_changed") line += `
        the code block backing this claim changed: verify the claim still holds, then accept`;
  if (r.stale && r.staleFrom !== void 0) line += `
        confirmed for old meaning: "${clip(r.staleFrom, 120)}"`;
  if (m.kind === "svg" || m.kind === "image") line += `
        visual: open ${clip(m.path, 160)} to look at it`;
  if (r.alsoAt?.length) line += `
        same wording also at lines ${r.alsoAt.join(", ")}`;
  if (r.candidates?.length) line += `
        maybe moved to: ${r.candidates.map((c) => clip(c, 160)).join(", ")} (claim_update edits {mention, relink})`;
  if (m.note) line += `
        note: ${clip(m.note, 120)}`;
  if (r.context) line += `
${r.context}`;
  return line;
}
function outputLine(r) {
  const o = r.output;
  let s = `  out:${o.id.padEnd(16)} ${o.kind.padEnd(5)} ${clip(o.path, 160).padEnd(30)} ${r.status}`;
  if (r.acked !== void 0) s += ` (acked: ${clip(r.acked, 60)})`;
  for (const reason of r.reasons) s += `
        - ${clip(reason, 240)}`;
  const meta = Object.entries(o.meta);
  if (meta.length) s += `
        made with: ${meta.map(([k, v]) => `${k}=${clip(v, 40)}`).join(", ")}`;
  return s;
}
function formatClaimHeader(c) {
  let s = `${c.id}  rev ${c.rev}  "${oneLine(c.desc)}"`;
  if (c.keywords.length) s += `
  keywords: ${oneLine(c.keywords.join(", "))}`;
  const prev = c.history.filter((h) => h.rev !== c.rev).slice(-3).reverse();
  const decided = (h) => h.by ? `, ${h.by === "user" ? "user decided" : "from user's request"}${h.why ? `: ${clip(h.why, 80)}` : ""}` : "";
  const cur = c.history.find((h) => h.rev === c.rev);
  if (cur?.by) s += `
  why: ${cur.by === "user" ? "user decided" : "from user's request"}${cur.why ? `: ${clip(cur.why, 100)}` : ""}`;
  for (const h of prev) s += `
  rev ${h.rev} (${oneLine(h.at).slice(0, 10)}${decided(h)}): "${clip(h.desc, 120)}"`;
  return s;
}
var BRIEF_ABOVE = 8;
var STALE_FULL = 5;
function isQuiet(r) {
  return !r.stale && r.acked === void 0 && ["ok", "moved", "reformatted"].includes(r.status);
}
function idsByFile(rs, withLine = false) {
  const byFile = /* @__PURE__ */ new Map();
  for (const r of rs) {
    const label = withLine && r.line !== void 0 ? `${r.mention.id}:${r.line}` : r.mention.id;
    byFile.set(r.mention.path, [...byFile.get(r.mention.path) ?? [], label]);
  }
  return [...byFile].map(([p, ids]) => `${clip(p, 60)} ${ids.join(",")}`).join("; ");
}
function formatClaimViews(views, view = "auto") {
  return views.map((v) => {
    const parts = [formatClaimHeader(v.claim)];
    const brief = view === "brief" || view === "auto" && v.mentions.length > BRIEF_ABOVE;
    if (!v.mentions.length) parts.push("  (no mentions registered)");
    else if (!brief) parts.push(v.mentions.map((r) => mentionLine(r)).join("\n"));
    else {
      const quiet = v.mentions.filter(isQuiet);
      const loud = v.mentions.filter((r) => !isQuiet(r));
      if (loud.length) parts.push(loud.map((r) => mentionLine(r)).join("\n"));
      if (quiet.length) parts.push(`  ok (${quiet.length}, wording hidden: view "full" shows it): ${idsByFile(quiet, true)}`);
    }
    if (v.outputs.length) parts.push("  generated outputs:\n" + v.outputs.map(outputLine).join("\n"));
    return parts.join("\n");
  }).join("\n\n");
}
function formatList(rows) {
  if (!rows.length) return "No claims yet. Add one with claim_add.";
  return rows.map((r) => `${r.claim.id.padEnd(24)} rev ${String(r.claim.rev).padEnd(3)} ${String(r.mentions).padStart(3)} mentions${r.issues ? `  ${r.issues} need attention` : ""}
  ${clip(r.claim.desc, 140)}`).join("\n");
}
function pendingSection(c) {
  const items = [
    ...c.mentionAcked.map((r) => `  ${r.claim}#${r.mention.id} ${r.mention.path}: ${clip(r.acked ?? "", 90)}`),
    ...c.outputAcked.map((o) => `  out:${o.output.id} ${o.output.path} (${o.status}): ${clip(o.acked ?? "", 90)}`)
  ];
  return items.length ? `Acknowledged, still pending (${items.length}):
${items.join("\n")}` : void 0;
}
function numbersSection(claims) {
  if (!claims.length) return void 0;
  return `Numbers not tied to code (${claims.length}): a constant could change and nothing would notice. Find the constant that sets each number (grep) and register it: claim_add {id, mentions:[{path, kind:"code", anchor:"<declaration line>"}]}. If no code sets it (a guideline, a count in prose): claim_update {claim, no_code:"why"}
` + claims.map((c) => `  ${c.id}: "${clip(c.desc, 100)}"`).join("\n");
}
function formatCheck(c) {
  const head = `${c.claims} claims, ${c.mentions} mentions, ${c.outputs} outputs checked.`;
  const pending = pendingSection(c);
  const numbers = numbersSection(c.unbackedNumbers);
  if (!c.mentionIssues.length && !c.outputIssues.length) {
    return [`${head} ${pending ? "No new issues." : "No issues."}`, pending, numbers].filter(Boolean).join("\n\n");
  }
  const parts = [head];
  if (c.mentionIssues.length) parts.push(`Mentions needing attention (${c.mentionIssues.length}):
` + c.mentionIssues.map((r) => mentionLine(r, true)).join("\n"));
  if (c.outputIssues.length) {
    parts.push(
      `Generated outputs needing attention (${c.outputIssues.length}):
` + c.outputIssues.map(outputLine).join("\n") + "\n  Do not regenerate without the user's approval. Ask, then regenerate and output action=record, or output action=ack with a note."
    );
  }
  if (pending) parts.push(pending);
  if (numbers) parts.push(numbers);
  return parts.join("\n\n");
}
function formatUpdate(u) {
  const parts = [];
  if (u.meaning) {
    parts.push(
      `MEANING CHANGED (rev ${u.meaning.rev}, ${u.meaning.by === "user" ? "user decided" : "from user's request"}: ${clip(u.meaning.why, 100)}) \u2014 tell the user:
  ${u.claim.id}: "${oneLine(u.meaning.from)}"
     \u2192 "${oneLine(u.meaning.to)}"`
    );
  } else parts.push(`${u.claim.id} rev ${u.claim.rev} (meaning unchanged)`);
  if (u.edits.length) {
    parts.push("edits:\n" + u.edits.map((e) => `  ${e.mention}: ${e.ok ? "ok" : "FAILED"} \u2014 ${e.message}`).join("\n"));
  }
  if (u.accepted) {
    parts.push(`accept_all: confirmed ${u.accepted.count} places${u.accepted.left.length ? `; left alone: ${u.accepted.left.join("; ")}` : ""}`);
  }
  if (u.meaning) {
    if (u.staleMentions.length) {
      const shown = u.staleMentions.slice(0, STALE_FULL);
      const rest = u.staleMentions.slice(STALE_FULL);
      parts.push(
        `Still saying the old meaning (${u.staleMentions.length}) \u2014 update with edits[{mention, text}], or accept if still true (accept_all confirms every remaining place):
` + shown.map((r) => mentionLine(r)).join("\n") + (rest.length ? `
  +${rest.length} more, wording not shown: ${idsByFile(rest)} (claim_get {ids:["${u.claim.id}"], view:"full"})` : "")
      );
    } else parts.push("All mentions confirmed against the new meaning.");
    if (u.staleOutputs.length) {
      parts.push(
        `Generated from the old meaning (${u.staleOutputs.length}) \u2014 NOT regenerated. Ask the user before regenerating:
` + u.staleOutputs.map(outputLine).join("\n")
      );
    }
    parts.push("If the user wants the earlier meaning back: claim_update {claim, revert: <rev>}.");
  }
  return parts.join("\n\n");
}
function formatInFile(r) {
  const parts = [];
  parts.push(r.mentions.length ? `Claims mentioned in ${r.path}:
${r.mentions.map((m) => mentionLine(m, true)).join("\n")}` : `No registered claims in ${r.path}.`);
  if (r.outputAt) parts.push(`${r.path} is a generated output:
${outputLine(r.outputAt)}`);
  if (r.outputsFrom.length) parts.push(`Outputs generated from ${r.path}:
${r.outputsFrom.map(outputLine).join("\n")}`);
  return parts.join("\n\n");
}
function formatScan(path, hits) {
  if (!hits.length) return `No likely unregistered claim mentions in ${path}.`;
  return `Possible unregistered mentions in ${path} (suggestions; register real ones with claim_add mentions):
` + hits.map((h) => `  ${h.claim.padEnd(20)} line ${String(h.line).padEnd(5)} ${h.why}
        "${clip(h.text, 160)}"`).join("\n");
}
function formatConfig(cfg) {
  return `tracking ${cfg.enabled ? "ON" : "OFF"} \xB7 stop hook: ${cfg.stop} \xB7 nudges: ${cfg.nudge ? "on" : "off"} \xB7 store ${cfg.share ? "committed to git (local/ ignored)" : "private (not committed)"}`;
}

// src/core/types.ts
var MENTION_KINDS = [
  "text",
  "code",
  "svg",
  "image",
  "audio",
  "video",
  "file",
  "url"
];
var ANCHORED_KINDS = /* @__PURE__ */ new Set(["text", "code", "svg"]);
var ClaimsError = class extends Error {
};

// src/core/project.ts
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
var STORE_DIR = ".claims";
function findRoot(start) {
  let dir = resolve(start);
  for (; ; ) {
    if (existsSync(join(dir, STORE_DIR, "config.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return void 0;
    dir = up;
  }
}
function defaultRoot() {
  return resolve(process.env.CLAIMKEEPER_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}
function projectRoot() {
  const base = defaultRoot();
  return findRoot(base) ?? base;
}
function isLinkedWorktree(root) {
  try {
    return lstatSync(join(root, ".git")).isFile();
  } catch {
    return false;
  }
}
function toPosix(p) {
  return p.split(sep).join("/").replace(/\\/g, "/");
}
var escapes = (rel) => rel === ".." || /^\.\.[\\/]/.test(rel) || isAbsolute(rel);
function relPath(root, p) {
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (escapes(rel)) throw new ClaimsError(`path is outside the project: ${p}`);
  return toPosix(rel);
}
var realRoots = /* @__PURE__ */ new Map();
function realOf(p) {
  return realpathSync.native(p);
}
function absPath(root, rel) {
  if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes("\0")) throw new ClaimsError(`refusing path outside the project: ${rel}`);
  const abs = resolve(root, rel);
  if (escapes(relative(root, abs))) throw new ClaimsError(`refusing path outside the project: ${rel}`);
  let realRoot = realRoots.get(root);
  if (!realRoot) {
    realRoot = existsSync(root) ? realOf(root) : root;
    realRoots.set(root, realRoot);
  }
  let probe = abs;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  if (existsSync(probe) && escapes(relative(realRoot, realOf(probe)))) {
    throw new ClaimsError(`refusing path that links outside the project: ${rel}`);
  }
  return abs;
}
function safeAbsPath(root, rel) {
  try {
    return absPath(root, rel);
  } catch {
    return void 0;
  }
}
function isProtectedPath(rel) {
  return rel === STORE_DIR || rel.startsWith(`${STORE_DIR}/`) || rel === ".git" || rel.startsWith(".git/");
}
function segmentMatch(p, s) {
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && (p[pi] === "?" || p[pi] === s[si])) {
      pi++;
      si++;
    } else if (pi < p.length && p[pi] === "*") {
      star = pi++;
      mark = si;
    } else if (star !== -1) {
      pi = star + 1;
      si = ++mark;
    } else return false;
  }
  while (pi < p.length && p[pi] === "*") pi++;
  return pi === p.length;
}
function globMatch(glob, rel) {
  if (!glob || glob.length > 200) return false;
  const path = rel.split("/");
  if (!glob.includes("/")) return segmentMatch(glob.replace(/\*\*+/g, "*"), path[path.length - 1] ?? "");
  const pat = glob.split("/").filter((p, i, a) => p !== "" || i === 0 || i === a.length - 1);
  const memo = /* @__PURE__ */ new Map();
  const match = (i, j) => {
    const key = i * 1e5 + j;
    const hit = memo.get(key);
    if (hit !== void 0) return hit;
    let r;
    if (i === pat.length) r = j === path.length;
    else if (pat[i] === "**") r = match(i + 1, j) || j < path.length && match(i, j + 1);
    else r = j < path.length && segmentMatch(pat[i].replace(/\*\*+/g, "*"), path[j]) && match(i + 1, j + 1);
    memo.set(key, r);
    return r;
  };
  return match(0, 0);
}
function isExcluded(rel, patterns) {
  return patterns.some((g) => globMatch(g, rel));
}
var gitRootCache = /* @__PURE__ */ new Map();
function isGitRepo(root) {
  const cached = gitRootCache.get(root);
  if (cached && Date.now() - cached.at < 3e4) return cached.ok;
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
  const ok = r.status === 0 && r.stdout.trim() === "true";
  gitRootCache.set(root, { ok, at: Date.now() });
  return ok;
}
function isGitIgnored(root, rel) {
  if (!isGitRepo(root)) return false;
  const r = spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd: root });
  return r.status === 0;
}
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  STORE_DIR,
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__"
]);
function walkFiles(root, limit = 2e4) {
  const out = [];
  const stack = [root];
  let dirs = 0;
  while (stack.length && out.length < limit && dirs++ < 5e3) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) stack.push(abs);
      } else if (st.isFile()) {
        out.push(toPosix(relative(root, abs)));
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
var TEXT_EXT = /\.(md|mdx|txt|html?|tsx?|jsx?|mjs|cjs|vue|svelte|astro|css|scss|json|ya?ml|toml|svg|xml|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|sh|ps1|vtt|srt|csv|tex|rst|ini|cfg|env\.example)$/i;
function isTextPath(rel) {
  return TEXT_EXT.test(rel) || !/\.[A-Za-z0-9]+$/.test(rel.split("/").pop() ?? "");
}

// src/core/store.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, readdirSync as readdirSync2, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var DEFAULT_CONFIG = {
  version: 1,
  enabled: true,
  share: true,
  stop: "block",
  nudge: true,
  minAnchor: 10,
  exclude: [".env", ".env.*", "*.pem", "*.key", "*.p12", "id_rsa*", "**/secrets/**", "**/.ssh/**"]
};
var CLAIM_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
var OUTPUT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
var MENTION_ID = /^[ml][0-9]{1,6}$/;
var HISTORY_CAP = 50;
var CONTROL2 = /[\u0000-\u001f\u007f]/;
function readJson(path) {
  if (!existsSync2(path)) return void 0;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ClaimsError(`could not parse ${path}: ${e.message}`);
  }
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
var RETRY = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES", "EEXIST", "ENOTEMPTY"]);
function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      if (attempt >= 8 || !RETRY.has(e.code ?? "")) {
        rmSync(tmp, { force: true });
        throw e;
      }
      sleep(15 * (attempt + 1));
    }
  }
}
function withLock(path, fn, timeoutMs = 2e3) {
  const lock = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (; ; ) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5e3) rmdirSync(lock);
      } catch {
      }
      if (Date.now() > deadline) break;
      sleep(10);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
    }
  }
}
function withStoreLock(root, fn) {
  if (!existsSync2(join2(root, STORE_DIR, "config.json"))) return fn();
  return withLock(join2(root, STORE_DIR, "store"), fn, 5e3);
}
var str = (v) => typeof v === "string";
var cleanStr = (v) => str(v) && !CONTROL2.test(v) ? v : void 0;
var nat = (v, dflt) => typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : dflt;
function sanitizeAck(v) {
  if (!v || typeof v !== "object") return void 0;
  const a = v;
  return str(a.sig) && str(a.note) ? { sig: a.sig, note: a.note, at: str(a.at) ? a.at : "" } : void 0;
}
function sanitizeMention(v) {
  if (!v || typeof v !== "object") return void 0;
  const m = v;
  const path = cleanStr(m.path);
  if (!str(m.id) || !MENTION_ID.test(m.id) || !path || !MENTION_KINDS.includes(m.kind)) return void 0;
  const out = { id: m.id, kind: m.kind, path, rev: nat(m.rev, 0) };
  if (str(m.anchor) && m.anchor.length <= 2e3) out.anchor = m.anchor;
  if (typeof m.line === "number" && Number.isInteger(m.line) && m.line > 0) out.line = m.line;
  if (str(m.block)) out.block = m.block;
  if (str(m.fp)) out.fp = m.fp;
  if (str(m.note)) out.note = m.note;
  const ack = sanitizeAck(m.ack);
  if (ack) out.ack = ack;
  return out;
}
function sanitizeMentions(v) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const m = sanitizeMention(raw);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}
function nextMentionId(prefix, taken, counter) {
  const max = taken.reduce((n, m) => m.id.startsWith(prefix) ? Math.max(n, Number(m.id.slice(1)) || 0) : n, 0);
  return Math.max(counter, max + 1);
}
function sanitizeClaim(raw, id) {
  const c = raw && typeof raw === "object" ? raw : {};
  const history = (Array.isArray(c.history) ? c.history : []).filter((h) => !!h && typeof h === "object").filter((h) => typeof h.rev === "number" && str(h.desc)).map((h) => {
    const e = { rev: nat(h.rev, 0), desc: h.desc, at: cleanStr(h.at) ?? "" };
    if (h.by === "user" || h.by === "user_request") e.by = h.by;
    if (str(h.why)) e.why = h.why;
    return e;
  });
  const desc = str(c.desc) ? c.desc : "";
  const rev = nat(c.rev, 1) || 1;
  return {
    id,
    // always the file's validated name, never a value from inside the file
    desc,
    keywords: (Array.isArray(c.keywords) ? c.keywords : []).filter(str).slice(0, 20),
    rev,
    history: history.length ? history : [{ rev, desc, at: "" }],
    mentions: sanitizeMentions(c.mentions),
    next: nat(c.next, 1) || 1,
    ...str(c.noCode) ? { noCode: c.noCode } : {}
  };
}
function sanitizeOutput(v) {
  if (!v || typeof v !== "object") return void 0;
  const o = v;
  const path = cleanStr(o.path);
  if (!str(o.id) || !OUTPUT_ID.test(o.id) || !path) return void 0;
  const inputs = (Array.isArray(o.inputs) ? o.inputs : []).filter((i) => !!i && typeof i === "object").map((i) => ({ ref: cleanStr(i.ref), hash: str(i.hash) ? i.hash : "" })).filter((i) => !!i.ref);
  const claims = {};
  if (o.claims && typeof o.claims === "object") {
    for (const [k, rev] of Object.entries(o.claims)) if (CLAIM_ID.test(k)) claims[k] = nat(rev, 0);
  }
  const meta = {};
  if (o.meta && typeof o.meta === "object") {
    for (const [k, val] of Object.entries(o.meta)) if (/^[\w.-]{1,40}$/.test(k) && str(val)) meta[k] = val;
  }
  const out = {
    id: o.id,
    kind: MENTION_KINDS.includes(o.kind) ? o.kind : "file",
    path,
    inputs,
    claims,
    fp: str(o.fp) ? o.fp : "",
    meta,
    at: str(o.at) ? o.at : ""
  };
  const ack = sanitizeAck(o.ack);
  if (ack) out.ack = ack;
  return out;
}
var Store = class _Store {
  root;
  dir;
  localDir;
  cache = /* @__PURE__ */ new Map();
  localCache = /* @__PURE__ */ new Map();
  cfg;
  constructor(root) {
    this.root = root;
    this.dir = join2(root, STORE_DIR);
    this.localDir = join2(this.dir, "local");
  }
  static isInitialized(root) {
    return existsSync2(join2(root, STORE_DIR, "config.json"));
  }
  static open(root) {
    return _Store.isInitialized(root) ? new _Store(root) : void 0;
  }
  static init(root, opts = {}) {
    const store = new _Store(root);
    const created = !_Store.isInitialized(root);
    mkdirSync(join2(store.dir, "claims"), { recursive: true });
    mkdirSync(join2(store.localDir, "claims"), { recursive: true });
    if (created) writeJson(join2(store.dir, "config.json"), { version: 1, share: opts.share ?? true });
    else if (opts.share !== void 0) store.setConfig({ share: opts.share }, "project");
    store.writeGitignore();
    return { store, created };
  }
  writeGitignore() {
    const share = this.sharedConfig().share;
    const body = share ? "# claimkeeper: local/ holds personal settings and mentions in git-ignored files\nlocal/\n*.tmp\n*.lock\n" : "# claimkeeper: store kept private (share: false)\n*\n";
    writeFileSync(join2(this.dir, ".gitignore"), body, "utf8");
  }
  // ---------- config ----------
  sharedConfig() {
    return { ...DEFAULT_CONFIG, ...readJson(join2(this.dir, "config.json")) ?? {} };
  }
  /** Project config with personal overrides from .claims/local/config.json applied (cached per Store). */
  config() {
    if (this.cfg) return this.cfg;
    const local = readJson(join2(this.localDir, "config.json")) ?? {};
    const merged = { ...this.sharedConfig(), ...local };
    const extra = Array.isArray(merged.exclude) ? merged.exclude.filter((x) => typeof x === "string") : [];
    merged.exclude = [.../* @__PURE__ */ new Set([...DEFAULT_CONFIG.exclude, ...extra])];
    const min = Number(merged.minAnchor);
    merged.minAnchor = Number.isFinite(min) ? Math.min(100, Math.max(DEFAULT_CONFIG.minAnchor, min)) : DEFAULT_CONFIG.minAnchor;
    merged.enabled = merged.enabled !== false;
    merged.share = merged.share !== false;
    merged.nudge = merged.nudge !== false;
    if (!["block", "warn", "off"].includes(merged.stop)) merged.stop = DEFAULT_CONFIG.stop;
    this.cfg = merged;
    return merged;
  }
  setConfig(patch, scope) {
    if (scope === "project") {
      const path = join2(this.dir, "config.json");
      writeJson(path, { ...readJson(path) ?? {}, ...patch });
      if (patch.share !== void 0) this.writeGitignore();
    } else {
      mkdirSync(this.localDir, { recursive: true });
      const path = join2(this.localDir, "config.json");
      writeJson(path, { ...readJson(path) ?? {}, ...patch });
    }
    delete this.cfg;
    return this.config();
  }
  // ---------- claims ----------
  /** Valid claim ids only: stray or oddly named files in claims/ are ignored. */
  claimIds() {
    const dir = join2(this.dir, "claims");
    if (!existsSync2(dir)) return [];
    return readdirSync2(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => CLAIM_ID.test(id)).sort();
  }
  hasClaim(id) {
    return CLAIM_ID.test(id) && existsSync2(join2(this.dir, "claims", `${id}.json`));
  }
  getClaim(id) {
    const hit = this.cache.get(id);
    if (hit) return hit;
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}" (use lowercase-with-dashes)`);
    const raw = readJson(join2(this.dir, "claims", `${id}.json`));
    if (raw === void 0) throw new ClaimsError(`no claim "${id}". Known: ${this.claimIds().join(", ") || "(none)"}`);
    const c = sanitizeClaim(raw, id);
    this.cache.set(id, c);
    return c;
  }
  saveClaim(c) {
    if (!CLAIM_ID.test(c.id)) throw new ClaimsError(`invalid claim id "${c.id}"`);
    if (c.history.length > HISTORY_CAP) c.history = c.history.slice(-HISTORY_CAP);
    mkdirSync(join2(this.dir, "claims"), { recursive: true });
    writeJson(join2(this.dir, "claims", `${c.id}.json`), c);
    this.cache.set(c.id, c);
  }
  deleteClaim(id) {
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}"`);
    rmSync(join2(this.dir, "claims", `${id}.json`), { force: true });
    rmSync(join2(this.localDir, "claims", `${id}.json`), { force: true });
    this.cache.delete(id);
    this.localCache.delete(id);
  }
  getLocal(id) {
    const hit = this.localCache.get(id);
    if (hit) return hit;
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}"`);
    const raw = readJson(join2(this.localDir, "claims", `${id}.json`));
    const l = { id, mentions: sanitizeMentions(raw?.mentions), next: nat(raw?.next, 1) || 1 };
    this.localCache.set(id, l);
    return l;
  }
  saveLocal(l) {
    if (!CLAIM_ID.test(l.id)) throw new ClaimsError(`invalid claim id "${l.id}"`);
    const path = join2(this.localDir, "claims", `${l.id}.json`);
    if (!l.mentions.length) {
      rmSync(path, { force: true });
    } else {
      mkdirSync(join2(this.localDir, "claims"), { recursive: true });
      writeJson(path, l);
    }
    this.localCache.set(l.id, l);
  }
  /** All mentions of a claim, shared first. */
  mentions(id) {
    const shared = this.getClaim(id).mentions.map((mention) => ({ mention, local: false }));
    const local = this.getLocal(id).mentions.map((mention) => ({ mention, local: true }));
    return [...shared, ...local];
  }
  findMention(claimId, mentionId) {
    const bare = mentionId.includes("#") ? mentionId.slice(mentionId.lastIndexOf("#") + 1) : mentionId;
    const ref = this.mentions(claimId).find((r) => r.mention.id === bare);
    if (!ref) throw new ClaimsError(`claim "${claimId}" has no mention "${mentionId}"`);
    return ref;
  }
  /** Persist whichever side a mention lives on. */
  saveMentionSide(claimId, local) {
    if (local) this.saveLocal(this.getLocal(claimId));
    else this.saveClaim(this.getClaim(claimId));
  }
  /** Should a mention/output at this path live in the local (git-ignored) part? */
  isLocalPath(rel) {
    if (/^[a-z]+:\/\//i.test(rel)) return false;
    if (!this.config().share) return false;
    return isGitIgnored(this.root, rel);
  }
  // ---------- outputs ----------
  outputs(local) {
    const path = join2(local ? this.localDir : this.dir, "outputs.json");
    const raw = readJson(path);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const v of Array.isArray(raw?.outputs) ? raw.outputs : []) {
      const o = sanitizeOutput(v);
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
  }
  allOutputs() {
    return [
      ...this.outputs(false).map((output) => ({ output, local: false })),
      ...this.outputs(true).map((output) => ({ output, local: true }))
    ];
  }
  saveOutputs(local, outputs) {
    const dir = local ? this.localDir : this.dir;
    mkdirSync(dir, { recursive: true });
    const path = join2(dir, "outputs.json");
    if (!outputs.length) rmSync(path, { force: true });
    else writeJson(path, { outputs });
  }
  // ---------- session state (local, for hooks) ----------
  sessionPath(sessionId) {
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "default";
    return join2(this.localDir, "sessions", `${safe}.json`);
  }
  readSession(sessionId) {
    try {
      return readJson(this.sessionPath(sessionId));
    } catch {
      return void 0;
    }
  }
  writeSession(sessionId, value) {
    mkdirSync(join2(this.localDir, "sessions"), { recursive: true });
    writeJson(this.sessionPath(sessionId), value);
  }
  /** Read-modify-write a session file under a cross-process lock (hooks run in parallel). */
  updateSession(sessionId, fallback, change) {
    mkdirSync(join2(this.localDir, "sessions"), { recursive: true });
    const path = this.sessionPath(sessionId);
    return withLock(path, () => {
      const s = this.readSession(sessionId) ?? fallback();
      if (change(s) !== false) {
        try {
          writeJson(path, s);
        } catch {
        }
      }
      return s;
    });
  }
  /** Remove session files older than a week, and stray temp/lock files. */
  pruneSessions(maxAgeMs = 7 * 24 * 3600 * 1e3) {
    const dir = join2(this.localDir, "sessions");
    if (!existsSync2(dir)) return;
    const now2 = Date.now();
    for (const f of readdirSync2(dir)) {
      const p = join2(dir, f);
      try {
        if (f.endsWith(".tmp")) {
          if (now2 - statSync(p).mtimeMs > 6e4) rmSync(p, { force: true });
          continue;
        }
        if (f.endsWith(".lock")) continue;
        const s = JSON.parse(readFileSync(p, "utf8"));
        if (s.started && now2 - Date.parse(s.started) > maxAgeMs) rmSync(p, { force: true });
      } catch {
        rmSync(p, { force: true, recursive: true });
      }
    }
  }
};

// src/core/ops.ts
import { existsSync as existsSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { basename as basename2, extname } from "node:path";

// src/core/fingerprint.ts
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync as statSync2 } from "node:fs";
var CHUNK = 1024 * 1024;
function fingerprint(absPath2) {
  let size;
  try {
    const st = statSync2(absPath2);
    if (!st.isFile()) return void 0;
    size = st.size;
  } catch {
    return void 0;
  }
  let fd;
  try {
    fd = openSync(absPath2, "r");
    if (size <= 2 * CHUNK) {
      let buf2 = Buffer.alloc(size);
      readSync(fd, buf2, 0, size, 0);
      if (isTextPath(absPath2.replace(/\\/g, "/")) && buf2.includes(13)) {
        buf2 = Buffer.from(buf2.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
        size = buf2.length;
      }
      return `${size}:${createHash("sha256").update(buf2).digest("hex").slice(0, 16)}`;
    }
    const h = createHash("sha256");
    const buf = Buffer.alloc(CHUNK);
    readSync(fd, buf, 0, CHUNK, 0);
    h.update(buf);
    readSync(fd, buf, 0, CHUNK, size - CHUNK);
    h.update(buf);
    return `${size}:${h.digest("hex").slice(0, 16)}`;
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
}
function hashText(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
function fileSize(fp) {
  if (!fp) return void 0;
  const n = Number(fp.split(":")[0]);
  return Number.isFinite(n) ? n : void 0;
}

// src/core/resolve.ts
import { existsSync as existsSync3, readFileSync as readFileSync2, statSync as statSync3 } from "node:fs";
import { basename } from "node:path";
var MAX_TEXT_BYTES = 2 * 1024 * 1024;
function isUrl(p) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
}
function descAt(claim, rev) {
  if (rev === claim.rev) return claim.desc;
  return claim.history.find((h) => h.rev === rev)?.desc;
}
function meaningChangedSince(claim, rev) {
  return descAt(claim, rev) !== claim.desc;
}
function readText(abs) {
  try {
    if (statSync3(abs).size > MAX_TEXT_BYTES) return void 0;
    return readFileSync2(abs, "utf8");
  } catch {
    return void 0;
  }
}
function indexFor(rel, content, opts) {
  opts.indexes ??= /* @__PURE__ */ new Map();
  let fx = opts.indexes.get(rel);
  if (!fx || fx.content !== content) {
    fx = new FileIndex(content);
    opts.indexes.set(rel, fx);
  }
  return fx;
}
function isForbiddenPath(store, rel) {
  return isProtectedPath(rel) || isExcluded(rel, store.config().exclude);
}
function contentOf(store, rel, opts) {
  if (opts.contents?.has(rel)) return opts.contents.get(rel);
  const abs = safeAbsPath(store.root, rel);
  const c = abs ? readText(abs) : void 0;
  opts.contents?.set(rel, c);
  return c;
}
function findCandidates(store, m, opts) {
  opts.files ??= walkFiles(store.root).filter((f) => !isForbiddenPath(store, f));
  const files = opts.files.filter((f) => f !== m.path);
  const out = [];
  if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
    for (const f of files) {
      if (!isTextPath(f)) continue;
      const abs = safeAbsPath(store.root, f);
      const c = abs ? readText(abs) : void 0;
      if (c && locate(c, m.anchor, void 0, false).best) out.push(f);
      if (out.length >= 5) break;
    }
  } else {
    const name = basename(m.path);
    const size = fileSize(m.fp);
    for (const f of files) {
      if (basename(f) === name) out.push(f);
      else if (size !== void 0) {
        const abs = safeAbsPath(store.root, f);
        let same = false;
        try {
          same = !!abs && statSync3(abs).size === size;
        } catch {
          same = false;
        }
        if (same && fingerprint(abs) === m.fp) out.push(f);
      }
      if (out.length >= 5) break;
    }
  }
  return out;
}
function overlapsOtherMention(store, self, content, start, end) {
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
function mentionSig(r, claim) {
  return hashText(`${claim.rev}|${r.status}|${r.stale}|${r.current ?? ""}`);
}
function resolveMention(store, claim, ref, opts = {}) {
  const m = ref.mention;
  const stale = meaningChangedSince(claim, m.rev);
  const base = {
    claim: claim.id,
    mention: m,
    local: ref.local,
    status: "ok",
    stale,
    ...stale ? { staleFrom: m.rev === 0 ? "(registered as contradicting this claim)" : descAt(claim, m.rev) ?? `(rev ${m.rev})` } : {}
  };
  const finish = (r) => {
    if (m.ack && m.ack.sig === mentionSig(r, claim)) r.acked = m.ack.note;
    return r;
  };
  if (m.kind === "url" || isUrl(m.path)) return finish({ ...base, status: "unchecked" });
  const abs = isForbiddenPath(store, m.path) ? void 0 : safeAbsPath(store.root, m.path);
  if (!abs) return finish({ ...base, status: "unsafe_path" });
  if (!existsSync3(abs)) {
    const r = { ...base, status: "file_not_found" };
    if (opts.searchMissing) {
      const c = findCandidates(store, m, opts);
      if (c.length) r.candidates = c;
    }
    return finish(r);
  }
  if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
    const content = contentOf(store, m.path, opts);
    if (content === void 0) return finish({ ...base, status: "text_not_found" });
    const { best, others } = locate(indexFor(m.path, content, opts), m.anchor, m.line);
    if (!best) return finish({ ...base, status: "text_not_found" });
    if (best.mode === "fuzzy" && overlapsOtherMention(store, m, content, best.start, best.end)) {
      return finish({ ...base, status: "text_not_found" });
    }
    const r = {
      ...base,
      line: best.line,
      current: content.slice(best.start, best.end),
      range: [best.start, best.end],
      status: best.mode === "fuzzy" ? "changed" : best.mode === "normalized" ? "reformatted" : m.line === void 0 || m.line === best.line ? "ok" : "moved"
    };
    if (best.mode === "fuzzy") r.similarity = best.similarity;
    if (others.length) r.alsoAt = others;
    if (m.kind === "code" && m.block && best.mode !== "fuzzy") {
      if (hashText(blockAt(content, best.line)) !== m.block) r.status = "code_changed";
    }
    if (opts.context) r.context = contextAround(content, best.line, opts.context);
    return finish(r);
  }
  const fp = fingerprint(abs);
  return finish({ ...base, status: m.fp && fp !== m.fp ? "changed" : "ok", current: fp });
}
function mentionIsIssue(r) {
  if (r.acked !== void 0) return false;
  if (r.stale) return true;
  return !["ok", "moved", "reformatted", "unchecked"].includes(r.status);
}
function parseMentionRef(ref) {
  const m = /^([a-z0-9][a-z0-9-]*)#([A-Za-z0-9]+)$/.exec(ref);
  return m ? { claim: m[1], mention: m[2] } : void 0;
}
function currentInputHash(store, ref, outputs, opts) {
  const mref = parseMentionRef(ref);
  if (mref) {
    if (!store.hasClaim(mref.claim)) return "missing";
    const claim = store.getClaim(mref.claim);
    const found = store.mentions(mref.claim).find((r2) => r2.mention.id === mref.mention);
    if (!found) return "missing";
    const r = resolveMention(store, claim, found, opts);
    if (r.status === "file_not_found" || r.status === "text_not_found") return "missing";
    return r.current ? hashText(r.current) : `rev${claim.rev}`;
  }
  if (ref.startsWith("out:")) {
    const o = outputs.get(ref.slice(4));
    if (!o) return "missing";
    const abs2 = safeAbsPath(store.root, o.path);
    return abs2 && fingerprint(abs2) || "missing";
  }
  const abs = isForbiddenPath(store, ref) ? void 0 : safeAbsPath(store.root, ref);
  return abs && fingerprint(abs) || "missing";
}
var MAX_CHAIN = 64;
function inputsCarryCurrentMeaning(store, claim, o) {
  const paths = /* @__PURE__ */ new Set();
  const ids = /* @__PURE__ */ new Set();
  for (const i of o.inputs) {
    const mref = parseMentionRef(i.ref);
    if (mref) {
      if (mref.claim === claim.id) ids.add(mref.mention);
    } else if (!i.ref.startsWith("out:")) paths.add(i.ref);
  }
  const carried = store.mentions(claim.id).filter((r) => ids.has(r.mention.id) || paths.has(r.mention.path));
  return carried.length > 0 && carried.every((r) => !meaningChangedSince(claim, r.mention.rev));
}
function outputResolver(store, opts = {}) {
  const entries = store.allOutputs();
  const byId = new Map(entries.map((e) => [e.output.id, e.output]));
  const localOf = new Map(entries.map((e) => [e.output.id, e.local]));
  const memo = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const ctx = { ...opts, contents: opts.contents ?? /* @__PURE__ */ new Map() };
  const inputHash = (ref) => currentInputHash(store, ref, byId, ctx);
  const resolve2 = (id, depth = 0) => {
    const hit = memo.get(id);
    if (hit) return hit;
    const o = byId.get(id);
    if (!o) return void 0;
    if (visiting.has(id)) return void 0;
    visiting.add(id);
    const reasons = [];
    const nowHashes = [];
    let regen = false;
    let stale = false;
    for (const input of o.inputs) {
      const now2 = inputHash(input.ref);
      nowHashes.push(now2);
      if (now2 !== input.hash) {
        regen = true;
        reasons.push(now2 === "missing" ? `input ${input.ref} is missing` : `input ${input.ref} changed`);
      }
      if (input.ref.startsWith("out:")) {
        if (depth >= MAX_CHAIN) {
          regen = true;
          reasons.push("output chain is too deep to check");
          continue;
        }
        const up = resolve2(input.ref.slice(4), depth + 1);
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
    const abs = isUrl(o.path) ? void 0 : safeAbsPath(store.root, o.path);
    if (!isUrl(o.path) && !abs) reasons.push("path is outside the project: refused");
    const exists = isUrl(o.path) || !!abs && existsSync3(abs);
    const fp = exists && abs ? fingerprint(abs) : void 0;
    const changed = exists && !isUrl(o.path) && fp !== o.fp;
    if (changed) reasons.push("file differs from what was recorded (regenerated or edited without output action=record)");
    const status = !exists ? "not_generated" : stale ? "stale" : regen ? "needs_regen" : changed ? "changed" : "ok";
    if (!exists) reasons.unshift("output file not found");
    const sig = hashText(`${status}|${[...reasons].sort().join("|")}|${nowHashes.join(",")}|${fp ?? ""}`);
    const r = { output: o, local: localOf.get(id) ?? false, status, reasons, sig };
    if (o.ack && o.ack.sig === sig) r.acked = o.ack.note;
    visiting.delete(id);
    memo.set(id, r);
    return r;
  };
  return {
    resolve: resolve2,
    inputHash,
    all: () => entries.map((e) => resolve2(e.output.id)).filter((r) => !!r)
  };
}
function outputIsIssue(r) {
  return r.status !== "ok" && r.acked === void 0;
}

// src/core/secrets.ts
var PATTERNS = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["OpenAI/Anthropic-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["Stripe-style key", /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // KEY=value is code/config: any 8+ char value. "key: value" is often prose, so the value must look like a token (has a digit).
  ["credential assignment", /\b(api[_-]?key|secret|token|passw(or)?d|auth)\b\s*=\s*["']?[^\s"']{8,}/i],
  ["credential assignment", /\b(api[_-]?key|secret|token|passw(or)?d|auth)\b\s*:\s*["']?(?=[^\s"']*\d)[^\s"']{8,}/i]
];
function entropy(s) {
  const counts = /* @__PURE__ */ new Map();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}
function findSecret(text) {
  for (const [name, re] of PATTERNS) if (re.test(text)) return name;
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) {
    const tok = m[0];
    if (/[0-9]/.test(tok) && /[A-Za-z]/.test(tok) && entropy(tok) > 4) return "high-entropy string";
  }
  return void 0;
}
var SECRET_KEY = /key|token|secret|auth|passw|cookie|credential|bearer/i;
function cleanMeta(meta) {
  const out = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    if (v === null || v === void 0) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length > 300 || findSecret(s)) continue;
    out[k] = s;
  }
  return out;
}

// src/core/ops.ts
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var MAX_ANCHOR = 500;
var MAX_DESC = 500;
var MAX_NOTE = 300;
function cleanText(what, text, max) {
  const t = oneLine(text);
  if (t.length > max) throw new ClaimsError(`${what} too long (${t.length} chars, max ${max}); keep it to one sentence`);
  return t;
}
function cleanKeywords(keywords) {
  return keywords.map((k) => oneLine(k).toLowerCase().slice(0, 60)).filter(Boolean).slice(0, 20);
}
function noSecret(what, text) {
  if (!text) return;
  const why = findSecret(text);
  if (why) throw new ClaimsError(`refusing to store ${what}: it looks like it contains a secret (${why})`);
}
function guardPath(rel, exclude) {
  if (isProtectedPath(rel)) throw new ClaimsError(`${rel} is claimkeeper's or git's own data and is never tracked`);
  if (isExcluded(rel, exclude)) throw new ClaimsError(`${rel} matches an exclude pattern (secrets/private files are never tracked)`);
}
function init(root, share) {
  return Store.init(root, share === void 0 ? {} : { share });
}
function requireStore(root) {
  const s = Store.open(root);
  if (!s) throw new ClaimsError("claim tracking is not initialized in this project. Run /claimkeeper:init (or `claimkeeper init`) first.");
  return s;
}
function toggle(store, patch, scope) {
  return store.setConfig(patch, scope);
}
function addClaim(store, input) {
  const id = input.id.trim();
  if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}": use 2-64 chars, lowercase letters, digits and dashes`);
  if (store.hasClaim(id)) throw new ClaimsError(`claim "${id}" already exists; use claim_update to change it`);
  const desc = cleanText("desc", input.desc, MAX_DESC);
  if (!desc) throw new ClaimsError("desc is required: one sentence saying what the claim means");
  noSecret("desc", desc);
  const keywords = cleanKeywords(input.keywords ?? []);
  noSecret("keywords", keywords.join(" "));
  const claim = { id, desc, keywords, rev: 1, history: [{ rev: 1, desc, at: now() }], mentions: [], next: 1 };
  store.saveClaim(claim);
  return claim;
}
function inferKind(rel, hasAnchor) {
  if (isUrl(rel)) return "url";
  const ext = extname(rel).toLowerCase();
  if (ext === ".svg") return "svg";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico"].includes(ext)) return "image";
  if ([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"].includes(ext)) return "audio";
  if ([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"].includes(ext)) return "video";
  return hasAnchor ? "text" : "file";
}
function addMention(store, input) {
  const claim = store.getClaim(input.claim);
  const cfg = store.config();
  const url = isUrl(input.path);
  const rel = url ? input.path : relPath(store.root, input.path);
  const anchor = input.anchor?.trim() ? input.anchor : void 0;
  const kind = input.kind ?? inferKind(rel, !!anchor);
  if (!MENTION_KINDS.includes(kind)) throw new ClaimsError(`unknown kind "${kind}"; use one of ${MENTION_KINDS.join(", ")}`);
  if (!url) guardPath(rel, cfg.exclude);
  noSecret("note", input.note);
  noSecret("conflict", input.conflict);
  if (input.note) input = { ...input, note: cleanText("note", input.note, MAX_NOTE) };
  if (input.conflict) input = { ...input, conflict: cleanText("conflict", input.conflict, MAX_NOTE) };
  const m = { id: "", kind, path: rel, rev: input.conflict ? 0 : claim.rev };
  const note = [input.conflict ? `CONFLICT: ${input.conflict}` : "", input.note ?? ""].filter(Boolean).join(" | ");
  if (note) m.note = note;
  if (kind === "url") {
    if (anchor) {
      if (anchor.length > MAX_ANCHOR) throw new ClaimsError(`anchor too long (${anchor.length} chars, max ${MAX_ANCHOR})`);
      noSecret("anchor", anchor);
      m.anchor = cleanText("anchor", anchor, MAX_ANCHOR);
    }
  } else {
    const abs = absPath(store.root, rel);
    if (!existsSync4(abs)) throw new ClaimsError(`file not found: ${rel}`);
    if (ANCHORED_KINDS.has(kind) && (anchor || kind !== "svg")) {
      if (!anchor) throw new ClaimsError(`kind "${kind}" needs an anchor: the exact wording of the claim in ${rel}`);
      if (anchor.length < cfg.minAnchor) throw new ClaimsError(`anchor too short (${anchor.length} chars, min ${cfg.minAnchor}); include more of the sentence so it is unique`);
      if (anchor.length > MAX_ANCHOR) throw new ClaimsError(`anchor too long (${anchor.length} chars, max ${MAX_ANCHOR}); anchor the key sentence, not the whole passage`);
      noSecret("anchor", anchor);
      const content = readText(abs);
      if (content === void 0) throw new ClaimsError(`${rel} is not a readable text file (or is over 2 MB)`);
      const { best, others } = locate(content, anchor, input.line, false);
      if (!best) throw new ClaimsError(`anchor not found in ${rel}. Copy the wording exactly as it appears in the file.`);
      if (others.length && input.line === void 0) {
        throw new ClaimsError(`anchor appears ${others.length + 1} times in ${rel} (lines ${[best.line, ...others].sort((a, b) => a - b).join(", ")}). Pass line to pick one, or use a longer anchor.`);
      }
      const stored = content.slice(best.start, best.end);
      if (stored.length > MAX_ANCHOR) throw new ClaimsError(`the matched wording is too long (${stored.length} chars, max ${MAX_ANCHOR}); anchor a shorter sentence`);
      noSecret("anchor", stored);
      m.anchor = stored;
      m.line = best.line;
      if (kind === "code") m.block = hashText(blockAt(content, best.line));
    } else {
      const fp = fingerprint(abs);
      if (fp) m.fp = fp;
    }
  }
  const existing = store.mentions(claim.id).find((r) => r.mention.path === m.path && r.mention.anchor === m.anchor && r.mention.kind === m.kind);
  if (existing) {
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
  } else {
    claim.next = nextMentionId("m", claim.mentions, claim.next);
    m.id = `m${claim.next++}`;
    claim.mentions.push(m);
    store.saveClaim(claim);
  }
  if (input.conflict) return ackRegisteredConflict(store, claim, { mention: m, local }, input.conflict);
  return resolveMention(store, claim, { mention: m, local });
}
function ackRegisteredConflict(store, claim, ref, conflict) {
  const r = resolveMention(store, claim, ref);
  ref.mention.ack = { sig: mentionSig(r, claim), note: `conflict registered, awaiting the user's decision: ${conflict}`, at: now() };
  store.saveMentionSide(claim.id, ref.local);
  return resolveMention(store, claim, ref);
}
function addClaimWithMentions(store, input) {
  let created = false;
  if (!store.hasClaim(input.id.trim())) {
    if (!input.desc?.trim()) throw new ClaimsError(`claim "${input.id}" does not exist yet: desc is required to create it`);
    addClaim(store, { id: input.id, desc: input.desc, ...input.keywords ? { keywords: input.keywords } : {} });
    created = true;
  } else if (input.desc?.trim() && cleanText("desc", input.desc, MAX_DESC) !== store.getClaim(input.id.trim()).desc) {
    throw new ClaimsError(`claim "${input.id}" already exists with a different meaning; use claim_update with desc to change it (and tell the user)`);
  }
  const claim = store.getClaim(input.id.trim());
  const mentions = (input.mentions ?? []).map((m) => {
    try {
      return { path: m.path, ok: true, resolved: addMention(store, { ...m, claim: claim.id }) };
    } catch (e) {
      return { path: m.path, ok: false, error: e.message };
    }
  });
  return { claim, created, mentions };
}
function getClaims(store, ids, opts = {}) {
  const ctx = { searchMissing: true, contents: /* @__PURE__ */ new Map(), ...opts.context ? { context: opts.context } : {} };
  const outs = outputResolver(store, { contents: ctx.contents });
  const allOuts = outs.all();
  return ids.map((id) => {
    const claim = store.getClaim(id);
    return {
      claim,
      mentions: store.mentions(id).map((r) => resolveMention(store, claim, r, ctx)),
      outputs: allOuts.filter((o) => Object.hasOwn(o.output.claims, id))
    };
  });
}
function listClaims(store) {
  const contents = /* @__PURE__ */ new Map();
  return store.claimIds().map((id) => {
    const claim = store.getClaim(id);
    const refs = store.mentions(id);
    const issues = refs.map((r) => resolveMention(store, claim, r, { contents })).filter(mentionIsIssue).length;
    return { claim, mentions: refs.length, issues };
  });
}
function confirm(m, claim) {
  m.rev = claim.rev;
  delete m.ack;
  if (m.note?.startsWith("CONFLICT:")) {
    const rest = m.note.split(" | ").slice(1).join(" | ");
    if (rest) m.note = rest;
    else delete m.note;
  }
}
function reanchor(store, claim, ref, anchor, line) {
  const m = ref.mention;
  if (!m.anchor || !ANCHORED_KINDS.has(m.kind)) throw new ClaimsError(`mention ${m.id} is ${m.kind}; anchor only applies to text/code/svg wording. Use accept.`);
  guardPath(m.path, store.config().exclude);
  const min = store.config().minAnchor;
  if (anchor.length < min) throw new ClaimsError(`anchor too short (${anchor.length} chars, min ${min}); include more of the sentence`);
  if (anchor.length > MAX_ANCHOR) throw new ClaimsError(`anchor too long (${anchor.length} chars, max ${MAX_ANCHOR}); anchor the key sentence`);
  noSecret("anchor", anchor);
  const content = readText(absPath(store.root, m.path));
  if (content === void 0) throw new ClaimsError(`${m.path} not found or not readable`);
  const { best, others } = locate(content, anchor, line ?? m.line, false);
  if (!best) throw new ClaimsError(`that wording is not in ${m.path}; copy it exactly as the file says it now`);
  const stored = content.slice(best.start, best.end);
  if (stored.length > MAX_ANCHOR) throw new ClaimsError(`the matched wording is too long (${stored.length} chars, max ${MAX_ANCHOR})`);
  noSecret("anchor", stored);
  m.anchor = stored;
  m.line = best.line;
  if (m.kind === "code") m.block = hashText(blockAt(content, best.line));
  confirm(m, claim);
  store.saveMentionSide(claim.id, ref.local);
  return `re-anchored ${m.path}:${m.line} at rev ${claim.rev}${others.length ? ` (same wording also at lines ${others.join(", ")}: pass line to pick another)` : ""}`;
}
function applyEdit(store, claim, e) {
  const ref = store.findMention(claim.id, e.mention);
  const m = ref.mention;
  const actions = [e.text !== void 0, !!e.accept, e.anchor !== void 0, e.ack !== void 0, e.relink !== void 0, !!e.remove].filter(Boolean).length;
  if (actions !== 1) throw new ClaimsError("each edit needs exactly one of: text, accept, anchor, ack, relink, remove");
  if (e.remove) {
    removeMention(store, { claim: claim.id, mention: m.id });
    return "removed";
  }
  if (e.relink !== void 0) {
    const r = relinkMention(store, { claim: claim.id, mention: m.id, path: e.relink, ...e.line !== void 0 ? { line: e.line } : {} });
    return `relinked to ${r.mention.path}${r.line !== void 0 ? `:${r.line}` : ""}`;
  }
  if (e.ack !== void 0) {
    noSecret("ack note", e.ack);
    if (e.ack) e = { ...e, ack: cleanText("ack", e.ack, MAX_NOTE) };
    const r = resolveMention(store, claim, ref);
    m.ack = { sig: mentionSig(r, claim), note: e.ack || "acknowledged", at: now() };
    store.saveMentionSide(claim.id, ref.local);
    const state = [r.status === "unchecked" ? "web place, check by hand" : r.status, r.stale ? m.rev === 0 ? "registered conflict" : "written for an earlier meaning" : ""];
    return `acknowledged, waiting on the user (${state.filter(Boolean).join("; ")})`;
  }
  if (e.anchor !== void 0) return reanchor(store, claim, ref, e.anchor, e.line);
  if (e.accept) {
    guardPath(m.path, store.config().exclude);
    const r = resolveMention(store, claim, ref);
    if (r.status === "file_not_found") throw new ClaimsError(`${m.path} not found; use edits {mention, relink} or {mention, remove:true}`);
    if (r.status === "text_not_found") throw new ClaimsError(`wording not found in ${m.path}; if the file already says it differently use {mention, anchor:"<wording now in the file>"}; else text with old, or remove`);
    if (m.anchor && r.current !== void 0) {
      if (r.current.length > MAX_ANCHOR) throw new ClaimsError("current text too long to anchor; use text to set a shorter wording");
      noSecret("current wording", r.current);
      m.anchor = r.current;
      if (r.line !== void 0) m.line = r.line;
      if (m.kind === "code" && r.line !== void 0) {
        const content2 = readText(absPath(store.root, m.path)) ?? "";
        m.block = hashText(blockAt(content2, r.line));
      }
    } else if (m.kind !== "url") {
      const fp = fingerprint(absPath(store.root, m.path));
      if (fp) m.fp = fp;
    }
    confirm(m, claim);
    store.saveMentionSide(claim.id, ref.local);
    return `accepted at rev ${claim.rev}`;
  }
  const text = e.text;
  if (!m.anchor || !ANCHORED_KINDS.has(m.kind)) throw new ClaimsError(`mention ${m.id} is ${m.kind}; text edits only apply to text/code/svg wording. Regenerate the file, then use accept.`);
  if (!text.trim()) throw new ClaimsError("text is empty; to stop tracking a place use edits {mention, remove:true}");
  if (text.length > MAX_ANCHOR) throw new ClaimsError(`text too long (${text.length} chars, max ${MAX_ANCHOR})`);
  noSecret("text", text);
  guardPath(m.path, store.config().exclude);
  const abs = absPath(store.root, m.path);
  const content = readText(abs);
  if (content === void 0) throw new ClaimsError(`${m.path} not found or not readable`);
  let start;
  let end;
  if (e.old !== void 0) {
    const hit = locate(content, e.old, m.line, false).best;
    if (!hit || hit.mode !== "exact") throw new ClaimsError(`old text not found exactly in ${m.path}`);
    start = hit.start;
    end = hit.end;
  } else {
    const r = resolveMention(store, claim, ref, { contents: /* @__PURE__ */ new Map([[m.path, content]]) });
    if (!r.range || !["ok", "moved", "reformatted", "code_changed"].includes(r.status)) {
      throw new ClaimsError(`mention is ${r.status}${r.current ? ` (now: "${r.current.slice(0, 80)}")` : ""}; the file's wording changed: keep it with {mention, anchor:"<wording now in the file>"}, or pass old with the exact current text to replace`);
    }
    [start, end] = r.range;
  }
  const next = content.slice(0, start) + text + content.slice(end);
  writeFileSync2(abs, next, "utf8");
  m.anchor = text;
  m.line = lineAt(next, start);
  if (m.kind === "code") m.block = hashText(blockAt(next, m.line));
  confirm(m, claim);
  store.saveMentionSide(claim.id, ref.local);
  return `rewrote ${m.path}:${m.line}`;
}
function updateClaim(store, input) {
  const claim = store.getClaim(input.claim);
  let desc = input.desc;
  if (input.revert !== void 0) {
    if (desc !== void 0) throw new ClaimsError("pass desc or revert, not both");
    desc = descAt(claim, input.revert);
    if (desc === void 0) throw new ClaimsError(`claim "${claim.id}" has no revision ${input.revert}; known: ${claim.history.map((h) => h.rev).join(", ")}`);
  }
  let meaning;
  if (desc !== void 0 && desc.trim() && cleanText("desc", desc, MAX_DESC) !== claim.desc) {
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
  if (input.noCode !== void 0) {
    noSecret("no_code", input.noCode);
    if (input.noCode.trim()) claim.noCode = cleanText("no_code", input.noCode, MAX_NOTE);
    else delete claim.noCode;
  }
  store.saveClaim(claim);
  const edits = [];
  for (const e of input.edits ?? []) {
    try {
      edits.push({ mention: e.mention, ok: true, message: applyEdit(store, claim, e) });
    } catch (err) {
      edits.push({ mention: e.mention, ok: false, message: err.message });
    }
  }
  let accepted;
  if (input.acceptAll) {
    const edited = new Set((input.edits ?? []).map((e) => e.mention.slice(e.mention.lastIndexOf("#") + 1)));
    const contents = /* @__PURE__ */ new Map();
    const left = [];
    let count = 0;
    for (const ref of store.mentions(claim.id)) {
      if (edited.has(ref.mention.id)) continue;
      const res = resolveMention(store, claim, ref, { contents });
      if (!mentionIsIssue(res)) continue;
      if (res.status === "text_not_found" || res.status === "file_not_found" || res.status === "unsafe_path" || res.status === "unchecked") {
        left.push(`${ref.mention.id} ${res.status === "unchecked" ? "web place, check by hand" : res.status}`);
        continue;
      }
      try {
        applyEdit(store, claim, { mention: ref.mention.id, accept: true });
        count++;
      } catch (err) {
        left.push(`${ref.mention.id} ${err.message}`);
      }
    }
    accepted = { count, left };
  }
  let staleMentions = [];
  let staleOutputs = [];
  if (meaning) {
    const contents = /* @__PURE__ */ new Map();
    staleMentions = store.mentions(claim.id).map((r) => resolveMention(store, claim, r, { contents })).filter((r) => r.stale && !r.acked);
    staleOutputs = outputResolver(store, { contents }).all().filter((o) => Object.hasOwn(o.output.claims, claim.id) && outputIsIssue(o));
  }
  return { claim, ...meaning ? { meaning } : {}, edits, ...accepted ? { accepted } : {}, staleMentions, staleOutputs };
}
function decision(claim, to, decidedBy, why) {
  const proposal = `"${clip(claim.desc, 80)}" -> "${clip(to, 80)}"`;
  if (decidedBy === "agent") {
    throw new ClaimsError(
      `Not applied: changing what "${claim.id}" promises is the user's decision. Ask the user (${proposal}); if they agree, call again with decided_by "user" and why quoting their answer.`
    );
  }
  if (decidedBy !== "user" && decidedBy !== "user_request") {
    throw new ClaimsError(
      `A meaning change needs decided_by: "user" (they said so), "user_request" (it follows from what they asked for), or "agent" (your own idea: then ask them first). Plus why, quoting or summarizing the user. Proposed: ${proposal}`
    );
  }
  if (!why?.trim()) throw new ClaimsError(`A meaning change needs why: the user's words or the request it follows from.`);
  noSecret("why", why);
  return { by: decidedBy, why: cleanText("why", why, MAX_NOTE) };
}
function relinkMention(store, input) {
  const claim = store.getClaim(input.claim);
  const ref = store.findMention(claim.id, input.mention);
  const m = ref.mention;
  const rel = relPath(store.root, input.path);
  guardPath(rel, store.config().exclude);
  const abs = absPath(store.root, rel);
  if (!existsSync4(abs)) throw new ClaimsError(`file not found: ${rel}`);
  if (m.anchor && ANCHORED_KINDS.has(m.kind)) {
    const content = readText(abs);
    const hit = content === void 0 ? void 0 : locate(content, m.anchor, input.line ?? m.line).best;
    if (!hit) throw new ClaimsError(`the mention's wording was not found in ${rel}`);
    m.line = hit.line;
  }
  m.path = rel;
  const local = store.isLocalPath(rel);
  if (local !== ref.local) {
    if (ref.local) {
      const l = store.getLocal(claim.id);
      l.mentions = l.mentions.filter((x) => x !== m);
      store.saveLocal(l);
      claim.mentions.push(m);
      store.saveClaim(claim);
    } else {
      claim.mentions = claim.mentions.filter((x) => x !== m);
      store.saveClaim(claim);
      const l = store.getLocal(claim.id);
      l.mentions.push(m);
      store.saveLocal(l);
    }
  } else store.saveMentionSide(claim.id, local);
  return resolveMention(store, claim, { mention: m, local });
}
function removeMention(store, input) {
  const claim = store.getClaim(input.claim);
  const ref = store.findMention(claim.id, input.mention);
  if (ref.local) {
    const l = store.getLocal(claim.id);
    l.mentions = l.mentions.filter((x) => x.id !== input.mention);
    store.saveLocal(l);
  } else {
    claim.mentions = claim.mentions.filter((x) => x.id !== input.mention);
    store.saveClaim(claim);
  }
}
function removeClaim(store, id) {
  store.getClaim(id);
  store.deleteClaim(id);
}
var NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred|thousand|million|once|twice|dozen)\b/i;
function isUnbackedNumber(store, claim) {
  return !claim.noCode && NUMBER.test(claim.desc) && !store.mentions(claim.id).some((r) => r.mention.kind === "code");
}
function check(store, opts = {}) {
  const ids = opts.claims?.length ? opts.claims : store.claimIds();
  const paths = opts.paths ? new Set(opts.paths.map((p) => isUrl(p) ? p : relPath(store.root, p))) : void 0;
  const contents = /* @__PURE__ */ new Map();
  const mentionIssues = [];
  const mentionAcked = [];
  let mentions = 0;
  for (const id of ids) {
    const claim = store.getClaim(id);
    for (const r of store.mentions(id)) {
      if (paths && !paths.has(r.mention.path)) continue;
      mentions++;
      const res = resolveMention(store, claim, r, { contents, searchMissing: opts.searchMissing ?? false });
      if (mentionIsIssue(res)) mentionIssues.push(res);
      else if (res.acked !== void 0 && mentionIsIssue({ ...res, acked: void 0 })) mentionAcked.push(res);
    }
  }
  const outs = outputResolver(store, { contents }).all();
  const relevant = outs.filter((o) => {
    if (opts.claims?.length && !opts.claims.some((c) => Object.hasOwn(o.output.claims, c))) return false;
    if (paths && !paths.has(o.output.path) && !o.output.inputs.some((i) => paths.has(i.ref))) return false;
    return true;
  });
  return {
    claims: ids.length,
    mentions,
    outputs: relevant.length,
    mentionIssues,
    outputIssues: relevant.filter(outputIsIssue),
    mentionAcked,
    outputAcked: relevant.filter((o) => o.status !== "ok" && o.acked !== void 0),
    unbackedNumbers: paths ? [] : ids.map((id) => store.getClaim(id)).filter((c) => isUnbackedNumber(store, c))
  };
}
function issueKeys(c) {
  return [
    ...c.mentionIssues.map((r) => `${r.claim}#${r.mention.id}:${r.status}:${r.stale}`),
    ...c.outputIssues.map((o) => `out:${o.output.id}:${o.status}`)
  ];
}
function claimsIn(store, path) {
  const rel = isUrl(path) ? path : relPath(store.root, path);
  const contents = /* @__PURE__ */ new Map();
  const mentions = [];
  for (const id of store.claimIds()) {
    const claim = store.getClaim(id);
    for (const r of store.mentions(id)) if (r.mention.path === rel) mentions.push(resolveMention(store, claim, r, { contents }));
  }
  const outs = outputResolver(store, { contents }).all();
  const mentionRefs = new Set(mentions.map((r) => `${r.claim}#${r.mention.id}`));
  const outputAt = outs.find((o) => o.output.path === rel);
  return {
    path: rel,
    mentions,
    outputsFrom: outs.filter((o) => o.output.inputs.some((i) => i.ref === rel || mentionRefs.has(i.ref))),
    ...outputAt ? { outputAt } : {}
  };
}
function scanFile(store, path) {
  const rel = relPath(store.root, path);
  const content = readText(absPath(store.root, rel));
  if (content === void 0) return [];
  const lines = content.split(/\r?\n/);
  const hits = [];
  for (const id of store.claimIds()) {
    const claim = store.getClaim(id);
    const refs = store.mentions(id);
    const registeredHere = new Set(refs.filter((r) => r.mention.path === rel).map((r) => r.mention.line));
    const seen = /* @__PURE__ */ new Set();
    for (const r of refs) {
      if (r.mention.path === rel || !r.mention.anchor) continue;
      const hit = locate(content, r.mention.anchor, void 0, false).best;
      if (hit && !registeredHere.has(hit.line) && !seen.has(hit.line)) {
        seen.add(hit.line);
        hits.push({ claim: id, line: hit.line, text: lines[hit.line - 1].trim().slice(0, 160), why: `same wording as ${id}#${r.mention.id}` });
      }
    }
    if (!claim.keywords.length) continue;
    const kw = new Set(claim.keywords);
    const need = Math.min(2, kw.size);
    lines.forEach((l, i) => {
      const line = i + 1;
      if (seen.has(line) || registeredHere.has(line)) return;
      const words = new Set(tokenize(l).map((t) => t.word));
      const found = [...kw].filter((k) => k.includes(" ") ? l.toLowerCase().includes(k) : words.has(k));
      if (found.length >= need) {
        seen.add(line);
        hits.push({ claim: id, line, text: l.trim().slice(0, 160), why: `keywords: ${found.join(", ")}` });
      }
    });
  }
  return hits.slice(0, 30);
}
function dependsOn(outputs, from, target) {
  const byId = new Map(outputs.map((o) => [o.id, o]));
  const seen = /* @__PURE__ */ new Set();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const i of byId.get(id)?.inputs ?? []) if (i.ref.startsWith("out:")) stack.push(i.ref.slice(4));
  }
  return false;
}
function slug(s) {
  return s.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "output";
}
function recordOutput(store, input) {
  const url = isUrl(input.path);
  const rel = url ? input.path : relPath(store.root, input.path);
  if (!url && !existsSync4(absPath(store.root, rel))) throw new ClaimsError(`output file not found: ${rel}. Record it after generating.`);
  if (!url) guardPath(rel, store.config().exclude);
  if (!input.inputs.length) throw new ClaimsError("inputs is required: list the scripts, files, mentions (claim#m1) or outputs (out:id) this was generated from");
  const all = store.allOutputs();
  const existing = all.find((e) => input.id && e.output.id === input.id || e.output.path === rel);
  const id = existing?.output.id ?? input.id ?? (() => {
    const baseId = slug(basename2(rel));
    let candidate = baseId;
    for (let n = 2; all.some((e) => e.output.id === candidate); n++) candidate = `${baseId}-${n}`;
    return candidate;
  })();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new ClaimsError(`invalid output id "${id}"`);
  const resolver = outputResolver(store);
  const claimIds = new Set(input.claims ?? []);
  const inputs = input.inputs.map((raw) => {
    const mref = parseMentionRef(raw);
    let ref = raw;
    if (mref) {
      store.findMention(mref.claim, mref.mention);
      claimIds.add(mref.claim);
    } else if (raw.startsWith("out:")) {
      const up = all.find((e) => e.output.id === raw.slice(4));
      if (!up) throw new ClaimsError(`unknown output ${raw}`);
      if (up.output.id === id || dependsOn(all.map((e) => e.output), up.output.id, id)) {
        throw new ClaimsError(`out:${up.output.id} is built from ${id}; an output cannot (indirectly) be its own input`);
      }
      for (const c of Object.keys(up.output.claims)) claimIds.add(c);
    } else {
      ref = relPath(store.root, raw);
      guardPath(ref, store.config().exclude);
      if (!existsSync4(absPath(store.root, ref))) throw new ClaimsError(`input not found: ${ref}`);
      for (const cid of store.claimIds()) if (store.mentions(cid).some((r) => r.mention.path === ref)) claimIds.add(cid);
    }
    return { ref, hash: resolver.inputHash(ref) };
  });
  const claims = {};
  for (const c of claimIds) claims[c] = store.getClaim(c).rev;
  const kind = input.kind ?? existing?.output.kind ?? inferKind(rel, false);
  const out = {
    id,
    kind,
    path: rel,
    inputs,
    claims,
    fp: url ? "" : fingerprint(absPath(store.root, rel)) ?? "",
    meta: cleanMeta(input.meta),
    at: now()
  };
  const local = !url && store.isLocalPath(rel);
  for (const side of [false, true]) {
    const list = store.outputs(side).filter((o) => o.id !== id);
    if (side === local) list.push(out);
    store.saveOutputs(side, list);
  }
  return outputResolver(store).resolve(id);
}
function ackOutput(store, input) {
  noSecret("note", input.note);
  const r = outputResolver(store).resolve(input.id);
  if (!r) throw new ClaimsError(`unknown output "${input.id}"`);
  const list = store.outputs(r.local);
  const o = list.find((x) => x.id === input.id);
  o.ack = { sig: r.sig, note: input.note || "acknowledged", at: now() };
  store.saveOutputs(r.local, list);
  return outputResolver(store).resolve(input.id);
}
function removeOutput(store, id) {
  const hit = store.allOutputs().find((e) => e.output.id === id);
  if (!hit) throw new ClaimsError(`unknown output "${id}"`);
  store.saveOutputs(hit.local, store.outputs(hit.local).filter((o) => o.id !== id));
}

// src/core/activity.ts
import { appendFileSync, existsSync as existsSync5, mkdirSync as mkdirSync2, readFileSync as readFileSync3, statSync as statSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var LOG_MAX = 256 * 1024;
function logPath(store) {
  return join3(store.localDir, "activity.log");
}
function logActivity(store, line) {
  try {
    mkdirSync2(store.localDir, { recursive: true });
    const path = logPath(store);
    if (existsSync5(path) && statSync4(path).size > LOG_MAX) {
      const keep = readFileSync3(path, "utf8").split("\n").slice(-500).join("\n");
      writeFileSync3(path, keep, "utf8");
    }
    const t = /* @__PURE__ */ new Date();
    const stamp = `${t.toISOString().slice(0, 10)} ${t.toTimeString().slice(0, 8)}`;
    appendFileSync(path, `${stamp}  ${line.replace(/\s*\n\s*/g, " \u23CE ")}
`, "utf8");
  } catch {
  }
}
function readLog(store, lines = 30) {
  const path = logPath(store);
  if (!existsSync5(path)) return "(no activity yet)";
  return readFileSync3(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}
function statePath(store) {
  return join3(store.localDir, "state.json");
}
function refreshState(store) {
  const c = check(store);
  const s = {
    at: (/* @__PURE__ */ new Date()).toISOString(),
    claims: c.claims,
    issues: c.mentionIssues.length + c.outputIssues.length,
    pending: c.mentionAcked.length + c.outputAcked.length
  };
  try {
    mkdirSync2(store.localDir, { recursive: true });
    writeFileSync3(statePath(store), JSON.stringify(s), "utf8");
  } catch {
  }
  return s;
}
function currentState(store, maxAgeMs = 6e4) {
  try {
    const s = JSON.parse(readFileSync3(statePath(store), "utf8"));
    if (Date.now() - Date.parse(s.at) < maxAgeMs) return s;
  } catch {
  }
  return refreshState(store);
}
function statusText(store) {
  const cfg = store.config();
  if (!cfg.enabled) return "claims off";
  const s = currentState(store);
  if (!s.claims) return "claims \u2013";
  const parts = [s.issues ? `claims \u26A0${s.issues}` : `claims \u2713${s.claims}`];
  if (s.pending) parts.push(`${s.pending} pending`);
  return parts.join(" \xB7 ");
}

export {
  __commonJS,
  __export,
  __toESM,
  clip,
  mentionLine,
  outputLine,
  formatClaimViews,
  formatList,
  formatCheck,
  formatUpdate,
  formatInFile,
  formatScan,
  formatConfig,
  MENTION_KINDS,
  ClaimsError,
  STORE_DIR,
  findRoot,
  defaultRoot,
  projectRoot,
  isLinkedWorktree,
  relPath,
  safeAbsPath,
  hashText,
  isUrl,
  mentionIsIssue,
  outputIsIssue,
  withStoreLock,
  Store,
  init,
  requireStore,
  toggle,
  addClaimWithMentions,
  getClaims,
  listClaims,
  updateClaim,
  removeClaim,
  isUnbackedNumber,
  check,
  issueKeys,
  claimsIn,
  scanFile,
  recordOutput,
  ackOutput,
  removeOutput,
  logActivity,
  readLog,
  refreshState,
  statusText
};
