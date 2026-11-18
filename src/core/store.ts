import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_DIR, isGitIgnored } from "./project.ts";
import {
  ClaimsError,
  MENTION_KINDS,
  type Ack,
  type Claim,
  type Config,
  type HistoryEntry,
  type LocalClaim,
  type Mention,
  type MentionKind,
  type Output,
  type OutputsFile,
} from "./types.ts";

export const DEFAULT_CONFIG: Config = {
  version: 1,
  enabled: true,
  share: true,
  stop: "block",
  nudge: true,
  minAnchor: 10,
  exclude: [".env", ".env.*", "*.pem", "*.key", "*.p12", "id_rsa*", "**/secrets/**", "**/.ssh/**"],
};

export const CLAIM_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const OUTPUT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MENTION_ID = /^[ml][0-9]{1,6}$/;
const HISTORY_CAP = 50;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    throw new ClaimsError(`could not parse ${path}: ${(e as Error).message}`);
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const RETRY = new Set(["EPERM", "EBUSY", "EACCES", "EEXIST", "ENOTEMPTY"]);

/** Atomic write; retries the rename while another process (or an antivirus scan) holds the file. */
function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (e) {
      if (attempt >= 8 || !RETRY.has((e as NodeJS.ErrnoException).code ?? "")) {
        rmSync(tmp, { force: true });
        throw e;
      }
      sleep(15 * (attempt + 1));
    }
  }
}

/** Cross-process lock for read-modify-write (mkdir is atomic). Stale locks expire after 5 s. */
export function withLock<T>(path: string, fn: () => T, timeoutMs = 2000): T {
  const lock = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 5000) rmdirSync(lock);
      } catch {
        // lock vanished meanwhile
      }
      if (Date.now() > deadline) break; // proceed unlocked rather than block the agent
      sleep(10);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // already gone
    }
  }
}

// ---------- validation of store data (it may come from an untrusted repo) ----------

const str = (v: unknown): v is string => typeof v === "string";
const cleanStr = (v: unknown): string | undefined => (str(v) && !CONTROL.test(v) ? v : undefined);
const nat = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : dflt);

function sanitizeAck(v: unknown): Ack | undefined {
  if (!v || typeof v !== "object") return undefined;
  const a = v as Record<string, unknown>;
  return str(a.sig) && str(a.note) ? { sig: a.sig, note: a.note, at: str(a.at) ? a.at : "" } : undefined;
}

function sanitizeMention(v: unknown): Mention | undefined {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  const path = cleanStr(m.path);
  if (!str(m.id) || !MENTION_ID.test(m.id) || !path || !MENTION_KINDS.includes(m.kind as MentionKind)) return undefined;
  const out: Mention = { id: m.id, kind: m.kind as MentionKind, path, rev: nat(m.rev, 0) };
  if (str(m.anchor) && m.anchor.length <= 2000) out.anchor = m.anchor;
  if (typeof m.line === "number" && Number.isInteger(m.line) && m.line > 0) out.line = m.line;
  if (str(m.block)) out.block = m.block;
  if (str(m.fp)) out.fp = m.fp;
  if (str(m.note)) out.note = m.note;
  const ack = sanitizeAck(m.ack);
  if (ack) out.ack = ack;
  return out;
}

function sanitizeMentions(v: unknown): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const m = sanitizeMention(raw);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** Next free numeric id for a prefix, robust to merges that reused a counter. */
export function nextMentionId(prefix: "m" | "l", taken: Mention[], counter: number): number {
  const max = taken.reduce((n, m) => (m.id.startsWith(prefix) ? Math.max(n, Number(m.id.slice(1)) || 0) : n), 0);
  return Math.max(counter, max + 1);
}

function sanitizeClaim(raw: unknown, id: string): Claim {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const history: HistoryEntry[] = (Array.isArray(c.history) ? c.history : [])
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .filter((h) => typeof h.rev === "number" && str(h.desc))
    .map((h) => {
      const e: HistoryEntry = { rev: nat(h.rev, 0), desc: h.desc as string, at: cleanStr(h.at) ?? "" };
      if (h.by === "user" || h.by === "user_request") e.by = h.by;
      if (str(h.why)) e.why = h.why;
      return e;
    });
  const desc = str(c.desc) ? c.desc : "";
  const rev = nat(c.rev, 1) || 1;
  return {
    id, // always the file's validated name, never a value from inside the file
    desc,
    keywords: (Array.isArray(c.keywords) ? c.keywords : []).filter(str).slice(0, 20),
    rev,
    history: history.length ? history : [{ rev, desc, at: "" }],
    mentions: sanitizeMentions(c.mentions),
    next: nat(c.next, 1) || 1,
    ...(str(c.noCode) ? { noCode: c.noCode } : {}),
  };
}

function sanitizeOutput(v: unknown): Output | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const path = cleanStr(o.path);
  if (!str(o.id) || !OUTPUT_ID.test(o.id) || !path) return undefined;
  const inputs = (Array.isArray(o.inputs) ? o.inputs : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .map((i) => ({ ref: cleanStr(i.ref), hash: str(i.hash) ? i.hash : "" }))
    .filter((i): i is { ref: string; hash: string } => !!i.ref);
  const claims: Record<string, number> = {};
  if (o.claims && typeof o.claims === "object") {
    for (const [k, rev] of Object.entries(o.claims as Record<string, unknown>)) if (CLAIM_ID.test(k)) claims[k] = nat(rev, 0);
  }
  const meta: Record<string, string> = {};
  if (o.meta && typeof o.meta === "object") {
    for (const [k, val] of Object.entries(o.meta as Record<string, unknown>)) if (/^[\w.-]{1,40}$/.test(k) && str(val)) meta[k] = val;
  }
  const out: Output = {
    id: o.id,
    kind: MENTION_KINDS.includes(o.kind as MentionKind) ? (o.kind as MentionKind) : "file",
    path,
    inputs,
    claims,
    fp: str(o.fp) ? o.fp : "",
    meta,
    at: str(o.at) ? o.at : "",
  };
  const ack = sanitizeAck(o.ack);
  if (ack) out.ack = ack;
  return out;
}

export interface MentionRef {
  mention: Mention;
  local: boolean;
}

/**
 * The on-disk claim store. Shared part (.claims/) is committed; .claims/local/
 * holds mentions and outputs in git-ignored files, personal config, and session state.
 * Everything read from disk is validated: the store may come from an untrusted repo.
 */
export class Store {
  readonly root: string;
  readonly dir: string;
  readonly localDir: string;
  private cache = new Map<string, Claim>();
  private localCache = new Map<string, LocalClaim>();
  private cfg?: Config;

  private constructor(root: string) {
    this.root = root;
    this.dir = join(root, STORE_DIR);
    this.localDir = join(this.dir, "local");
  }

  static isInitialized(root: string): boolean {
    return existsSync(join(root, STORE_DIR, "config.json"));
  }

  static open(root: string): Store | undefined {
    return Store.isInitialized(root) ? new Store(root) : undefined;
  }

  static init(root: string, opts: { share?: boolean } = {}): { store: Store; created: boolean } {
    const store = new Store(root);
    const created = !Store.isInitialized(root);
    mkdirSync(join(store.dir, "claims"), { recursive: true });
    mkdirSync(join(store.localDir, "claims"), { recursive: true });
    // only what differs from the defaults is written, so improved defaults reach existing projects
    if (created) writeJson(join(store.dir, "config.json"), { version: 1, share: opts.share ?? true });
    else if (opts.share !== undefined) store.setConfig({ share: opts.share }, "project");
    store.writeGitignore();
    return { store, created };
  }

  private writeGitignore(): void {
    const share = this.sharedConfig().share;
    const body = share
      ? "# claimkeeper: local/ holds personal settings and mentions in git-ignored files\nlocal/\n*.tmp\n*.lock\n"
      : "# claimkeeper: store kept private (share: false)\n*\n";
    writeFileSync(join(this.dir, ".gitignore"), body, "utf8");
  }

  // ---------- config ----------

  sharedConfig(): Config {
    return { ...DEFAULT_CONFIG, ...(readJson<Partial<Config>>(join(this.dir, "config.json")) ?? {}) };
  }

  /** Project config with personal overrides from .claims/local/config.json applied (cached per Store). */
  config(): Config {
    if (this.cfg) return this.cfg;
    const local = readJson<Partial<Config>>(join(this.localDir, "config.json")) ?? {};
    const merged = { ...this.sharedConfig(), ...local };
    // configs (possibly from an untrusted repo) can add exclusions, never remove the built-in ones
    const extra = Array.isArray(merged.exclude) ? merged.exclude.filter((x): x is string => typeof x === "string") : [];
    merged.exclude = [...new Set([...DEFAULT_CONFIG.exclude, ...extra])];
    const min = Number(merged.minAnchor);
    merged.minAnchor = Number.isFinite(min) ? Math.min(100, Math.max(DEFAULT_CONFIG.minAnchor, min)) : DEFAULT_CONFIG.minAnchor;
    merged.enabled = merged.enabled !== false;
    merged.share = merged.share !== false;
    merged.nudge = merged.nudge !== false;
    if (!["block", "warn", "off"].includes(merged.stop)) merged.stop = DEFAULT_CONFIG.stop;
    this.cfg = merged;
    return merged;
  }

  setConfig(patch: Partial<Config>, scope: "project" | "me"): Config {
    if (scope === "project") {
      const path = join(this.dir, "config.json");
      writeJson(path, { ...(readJson<Partial<Config>>(path) ?? {}), ...patch });
      if (patch.share !== undefined) this.writeGitignore();
    } else {
      mkdirSync(this.localDir, { recursive: true });
      const path = join(this.localDir, "config.json");
      writeJson(path, { ...(readJson<Partial<Config>>(path) ?? {}), ...patch });
    }
    delete this.cfg;
    return this.config();
  }

  // ---------- claims ----------

  /** Valid claim ids only: stray or oddly named files in claims/ are ignored. */
  claimIds(): string[] {
    const dir = join(this.dir, "claims");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((id) => CLAIM_ID.test(id))
      .sort();
  }

  hasClaim(id: string): boolean {
    return CLAIM_ID.test(id) && existsSync(join(this.dir, "claims", `${id}.json`));
  }

  getClaim(id: string): Claim {
    const hit = this.cache.get(id);
    if (hit) return hit;
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}" (use lowercase-with-dashes)`);
    const raw = readJson<unknown>(join(this.dir, "claims", `${id}.json`));
    if (raw === undefined) throw new ClaimsError(`no claim "${id}". Known: ${this.claimIds().join(", ") || "(none)"}`);
    const c = sanitizeClaim(raw, id);
    this.cache.set(id, c);
    return c;
  }

  saveClaim(c: Claim): void {
    if (!CLAIM_ID.test(c.id)) throw new ClaimsError(`invalid claim id "${c.id}"`);
    if (c.history.length > HISTORY_CAP) c.history = c.history.slice(-HISTORY_CAP);
    mkdirSync(join(this.dir, "claims"), { recursive: true });
    writeJson(join(this.dir, "claims", `${c.id}.json`), c);
    this.cache.set(c.id, c);
  }

  deleteClaim(id: string): void {
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}"`);
    rmSync(join(this.dir, "claims", `${id}.json`), { force: true });
    rmSync(join(this.localDir, "claims", `${id}.json`), { force: true });
    this.cache.delete(id);
    this.localCache.delete(id);
  }

  getLocal(id: string): LocalClaim {
    const hit = this.localCache.get(id);
    if (hit) return hit;
    if (!CLAIM_ID.test(id)) throw new ClaimsError(`invalid claim id "${id}"`);
    const raw = readJson<Record<string, unknown>>(join(this.localDir, "claims", `${id}.json`));
    const l: LocalClaim = { id, mentions: sanitizeMentions(raw?.mentions), next: nat(raw?.next, 1) || 1 };
    this.localCache.set(id, l);
    return l;
  }

  saveLocal(l: LocalClaim): void {
    if (!CLAIM_ID.test(l.id)) throw new ClaimsError(`invalid claim id "${l.id}"`);
    const path = join(this.localDir, "claims", `${l.id}.json`);
    if (!l.mentions.length) {
      rmSync(path, { force: true });
    } else {
      mkdirSync(join(this.localDir, "claims"), { recursive: true });
      writeJson(path, l);
    }
    this.localCache.set(l.id, l);
  }

  /** All mentions of a claim, shared first. */
  mentions(id: string): MentionRef[] {
    const shared = this.getClaim(id).mentions.map((mention) => ({ mention, local: false }));
    const local = this.getLocal(id).mentions.map((mention) => ({ mention, local: true }));
    return [...shared, ...local];
  }

  findMention(claimId: string, mentionId: string): MentionRef {
    // accept the "claim#m3" label tools print, not only the bare "m3"
    const bare = mentionId.includes("#") ? mentionId.slice(mentionId.lastIndexOf("#") + 1) : mentionId;
    const ref = this.mentions(claimId).find((r) => r.mention.id === bare);
    if (!ref) throw new ClaimsError(`claim "${claimId}" has no mention "${mentionId}"`);
    return ref;
  }

  /** Persist whichever side a mention lives on. */
  saveMentionSide(claimId: string, local: boolean): void {
    if (local) this.saveLocal(this.getLocal(claimId));
    else this.saveClaim(this.getClaim(claimId));
  }

  /** Should a mention/output at this path live in the local (git-ignored) part? */
  isLocalPath(rel: string): boolean {
    if (/^[a-z]+:\/\//i.test(rel)) return false;
    if (!this.config().share) return false;
    return isGitIgnored(this.root, rel);
  }

  // ---------- outputs ----------

  outputs(local: boolean): Output[] {
    const path = join(local ? this.localDir : this.dir, "outputs.json");
    const raw = readJson<Partial<OutputsFile>>(path);
    const seen = new Set<string>();
    const out: Output[] = [];
    for (const v of Array.isArray(raw?.outputs) ? raw.outputs : []) {
      const o = sanitizeOutput(v);
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        out.push(o);
      }
    }
    return out;
  }

  allOutputs(): Array<{ output: Output; local: boolean }> {
    return [
      ...this.outputs(false).map((output) => ({ output, local: false })),
      ...this.outputs(true).map((output) => ({ output, local: true })),
    ];
  }

  saveOutputs(local: boolean, outputs: Output[]): void {
    const dir = local ? this.localDir : this.dir;
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "outputs.json");
    if (!outputs.length) rmSync(path, { force: true });
    else writeJson(path, { outputs } satisfies OutputsFile);
  }

  // ---------- session state (local, for hooks) ----------

  sessionPath(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "default";
    return join(this.localDir, "sessions", `${safe}.json`);
  }

  readSession<T>(sessionId: string): T | undefined {
    try {
      return readJson<T>(this.sessionPath(sessionId));
    } catch {
      return undefined; // a torn or corrupt session file just starts fresh
    }
  }

  writeSession(sessionId: string, value: unknown): void {
    mkdirSync(join(this.localDir, "sessions"), { recursive: true });
    writeJson(this.sessionPath(sessionId), value);
  }

  /** Read-modify-write a session file under a cross-process lock (hooks run in parallel). */
  updateSession<T>(sessionId: string, fallback: () => T, change: (s: T) => boolean | void): T {
    mkdirSync(join(this.localDir, "sessions"), { recursive: true });
    const path = this.sessionPath(sessionId);
    return withLock(path, () => {
      const s = this.readSession<T>(sessionId) ?? fallback();
      if (change(s) !== false) {
        try {
          writeJson(path, s);
        } catch {
          // losing a dedupe entry is better than losing the hook's message
        }
      }
      return s;
    });
  }

  /** Remove session files older than a week, and stray temp/lock files. */
  pruneSessions(maxAgeMs = 7 * 24 * 3600 * 1000): void {
    const dir = join(this.localDir, "sessions");
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      try {
        if (f.endsWith(".tmp")) {
          if (now - statSync(p).mtimeMs > 60_000) rmSync(p, { force: true });
          continue;
        }
        if (f.endsWith(".lock")) continue;
        const s = JSON.parse(readFileSync(p, "utf8")) as { started?: string };
        if (s.started && now - Date.parse(s.started) > maxAgeMs) rmSync(p, { force: true });
      } catch {
        rmSync(p, { force: true, recursive: true });
      }
    }
  }
}
