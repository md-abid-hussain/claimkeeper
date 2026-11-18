/**
 * Locating claim wording inside a file, deterministically:
 * exact -> normalized (ignores whitespace, tags, markdown, case, quotes) -> fuzzy (token overlap).
 */

export type MatchMode = "exact" | "normalized" | "fuzzy";

export interface Match {
  mode: MatchMode;
  start: number;
  end: number;
  line: number;
  similarity: number;
}

export interface LocateResult {
  best?: Match;
  /** Lines of other exact/normalized matches. */
  others: number[];
}

/** 1-based line number of a character offset (single lookups; use FileIndex in loops). */
export function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * A file's content plus lazily built lookups, shared by every mention resolved in that file:
 * line starts (binary-searched), normalized text and tokens are computed at most once.
 */
export class FileIndex {
  readonly content: string;
  private starts?: number[];
  private normCache?: Normalized;
  private tokenCache?: Token[];

  constructor(content: string) {
    this.content = content;
  }

  line(offset: number): number {
    if (!this.starts) {
      this.starts = [0];
      for (let i = 0; i < this.content.length; i++) if (this.content.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  get norm(): Normalized {
    return (this.normCache ??= normalize(this.content));
  }

  get tokens(): Token[] {
    return (this.tokenCache ??= tokenize(this.content));
  }
}

export function fileIndex(c: string | FileIndex): FileIndex {
  return typeof c === "string" ? new FileIndex(c) : c;
}

/** Offset where a 1-based line starts. */
export function lineStart(content: string, line: number): number {
  let cur = 1;
  for (let i = 0; i < content.length; i++) {
    if (cur === line) return i;
    if (content.charCodeAt(i) === 10) cur++;
  }
  return cur === line ? content.length : content.length;
}

function allIndexes(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  " ": " ",
};

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "i", "ins", "kbd",
  "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "tspan", "u", "var",
]);

export interface Normalized {
  text: string;
  /** map[i] = offset in the original string of normalized char i */
  map: number[];
}

/**
 * Normalize for matching: drop HTML/JSX tags and markdown emphasis, unify quotes,
 * collapse whitespace, lowercase. Keeps a map back to original offsets.
 */
export function normalize(src: string): Normalized {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "<") {
      // tags are short: look for ">" only in the next 400 chars (avoids quadratic scans)
      const rel = src.slice(i + 1, i + 400).indexOf(">");
      const close = rel === -1 ? -1 : i + 1 + rel;
      const inner = close === -1 ? "" : src.slice(i + 1, close);
      if (close !== -1 && /^\/?[A-Za-z!][^<>]*$/s.test(inner)) {
        // inline tags join words (Runs <b>on-device</b>.), block tags separate them
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
    // lowercasing can produce more than one code unit ("İ" -> "i̇"): map every unit back
    const lower = (QUOTES[ch] ?? ch).toLowerCase();
    for (let u = 0; u < lower.length; u++) map.push(i);
    text += lower;
    i++;
  }
  return { text, map };
}

export interface Token {
  word: string;
  start: number;
  end: number;
}

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{N}]+(?:['’.][\p{L}\p{N}]+)*/gu;
  for (const m of src.matchAll(re)) {
    out.push({ word: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function pickNearest(lines: number[], hint?: number): number {
  if (hint === undefined) return 0;
  let best = 0;
  for (let i = 1; i < lines.length; i++) {
    if (Math.abs(lines[i]! - hint) < Math.abs(lines[best]! - hint)) best = i;
  }
  return best;
}

/** Find the anchor in content (pass a FileIndex to share work across anchors in one file). */
export function locate(input: string | FileIndex, anchor: string, hint?: number, fuzzy = true): LocateResult {
  const fx = fileIndex(input);
  const content = fx.content;
  // 1. exact
  const exact = allIndexes(content, anchor);
  if (exact.length) {
    const lines = exact.map((o) => fx.line(o));
    const k = pickNearest(lines, hint);
    const start = exact[k]!;
    return {
      best: { mode: "exact", start, end: start + anchor.length, line: lines[k]!, similarity: 1 },
      others: lines.filter((_, i) => i !== k),
    };
  }
  // 2. normalized
  const nc = fx.norm;
  const na = normalize(anchor).text;
  if (na.length >= 3) {
    const hits = allIndexes(nc.text, na);
    if (hits.length) {
      const ranges = hits.map((h) => {
        const start = nc.map[h]!;
        const endIdx = nc.map[h + na.length - 1]!;
        return [start, endIdx + 1] as [number, number];
      });
      const lines = ranges.map((r) => fx.line(r[0]));
      const k = pickNearest(lines, hint);
      const [start, end] = ranges[k]!;
      return {
        best: { mode: "normalized", start, end, line: lines[k]!, similarity: 1 },
        others: lines.filter((_, i) => i !== k),
      };
    }
  }
  if (!fuzzy) return { others: [] };
  // 3. fuzzy: sliding window over tokens, Dice coefficient on token multisets
  const at = tokenize(anchor);
  // short anchors ("npx claimkeeper status") fuzzy-match too many neighbours: exact/normalized only
  if (at.length < 4) return { others: [] };
  const ct = fx.tokens;
  if (!ct.length) return { others: [] };
  const want = new Map<string, number>();
  for (const t of at) want.set(t.word, (want.get(t.word) ?? 0) + 1);

  const dice = (from: number, to: number): number => {
    const have = new Map<string, number>();
    let common = 0;
    for (let i = from; i < to; i++) {
      const w = ct[i]!.word;
      const used = have.get(w) ?? 0;
      if (used < (want.get(w) ?? 0)) common++;
      have.set(w, used + 1);
    }
    return (2 * common) / (at.length + (to - from));
  };

  const n = at.length;
  let best: { from: number; to: number; score: number } | undefined;
  for (let i = 0; i < ct.length; i++) {
    if (!want.has(ct[i]!.word)) continue; // windows start on a shared word
    for (let w = Math.max(1, n - 3); w <= n + 3; w++) {
      const to = Math.min(ct.length, i + w);
      const score = dice(i, to);
      if (!best || score > best.score + 1e-9) best = { from: i, to, score };
      else if (Math.abs(score - best.score) < 1e-9 && hint !== undefined) {
        const a = Math.abs(fx.line(ct[i]!.start) - hint);
        const b = Math.abs(fx.line(ct[best.from]!.start) - hint);
        if (a < b) best = { from: i, to, score };
      }
    }
  }
  if (!best || best.score < 0.5) return { others: [] };
  // trim window edges that are not shared words
  let { from, to } = best;
  while (from < to - 1 && !want.has(ct[from]!.word)) from++;
  while (to - 1 > from && !want.has(ct[to - 1]!.word)) to--;
  const [start, end] = expandToSentence(content, ct[from]!.start, ct[to - 1]!.end);
  return {
    best: { mode: "fuzzy", start, end, line: fx.line(start), similarity: Math.round(best.score * 100) / 100 },
    others: [],
  };
}

/**
 * Widen a fuzzy hit to whole sentences on its lines, so the agent sees what the
 * place says now (not just the words it shares with the old wording).
 */
function expandToSentence(content: string, start: number, end: number): [number, number] {
  const lineFrom = content.lastIndexOf("\n", start - 1) + 1;
  let lineTo = content.indexOf("\n", end);
  if (lineTo === -1) lineTo = content.length;
  let s = start;
  while (s > lineFrom && !/[.!?]\s/.test(content.slice(s - 2, s))) s--;
  let e = end;
  while (e < lineTo && !/[.!?]/.test(content[e - 1]!)) e++;
  while (s < e && /\s/.test(content[s]!)) s++;
  while (e > s && /\s/.test(content[e - 1]!)) e--;
  return [s, e];
}

/**
 * The code block that starts at a line: brace-balanced if a brace opens within
 * the first lines, otherwise indentation-based. Capped at 400 lines.
 */
export function blockAt(content: string, line: number): string {
  const lines = content.split(/\r?\n/);
  const startIdx = line - 1;
  if (startIdx < 0 || startIdx >= lines.length) return "";
  // a complete one-line statement (`const X = 500;`, `"version": "0.2.0",`) is its own block
  if (/[;,]\s*$/.test(lines[startIdx]!) && !lines[startIdx]!.includes("{")) return lines[startIdx]!;
  const out: string[] = [];
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < lines.length && out.length < 400; i++) {
    const l = lines[i]!;
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
  // indentation mode
  const indent = (s: string) => s.length - s.trimStart().length;
  const base = indent(lines[startIdx]!);
  const res = [lines[startIdx]!];
  for (let i = startIdx + 1; i < lines.length && res.length < 400; i++) {
    const l = lines[i]!;
    if (l.trim() === "") {
      res.push(l);
      continue;
    }
    if (indent(l) <= base) break;
    res.push(l);
  }
  while (res.length > 1 && res[res.length - 1]!.trim() === "") res.pop();
  return res.join("\n");
}

/** Lines around a line, for context in reports. */
export function contextAround(content: string, line: number, radius: number): string {
  const lines = content.split(/\r?\n/);
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${String(i).padStart(5)}| ${lines[i - 1]}`);
  return out.join("\n");
}

/**
 * Store text can come from an untrusted repo and is shown to the agent: keep it on one line,
 * drop control and bidi characters, and neutralize anything posing as claimkeeper's own messages.
 */
const CONTROL_RANGES: Array<[number, number]> = [
  [0x00, 0x1f], // C0 controls incl. newlines
  [0x7f, 0x9f], // DEL + C1 controls
  [0x2028, 0x2029], // line/paragraph separators
  [0x202a, 0x202e], // bidi embeddings/overrides
  [0x2066, 0x2069], // bidi isolates
];
const CONTROL = new RegExp(`[${CONTROL_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join("")}]+`, "g");

export function oneLine(s: string): string {
  return s
    .replace(CONTROL, " ")
    .replace(/\[\s*claimkeeper\s*\]/gi, "(claimkeeper)")
    .replace(/\s+/g, " ")
    .trim();
}

export function clip(s: string, max = 120): string {
  const one = oneLine(s);
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}
