/**
 * Human-facing traces, kept out of the agent's context:
 * - .claims/local/activity.log: one line per notable event (claimkeeper log)
 * - .claims/local/state.json: cached counts for the status line
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check } from "./ops.ts";
import type { Store } from "./store.ts";

const LOG_MAX = 256 * 1024;

export function logPath(store: Store): string {
  return join(store.localDir, "activity.log");
}

export function logActivity(store: Store, line: string): void {
  try {
    mkdirSync(store.localDir, { recursive: true });
    const path = logPath(store);
    if (existsSync(path) && statSync(path).size > LOG_MAX) {
      const keep = readFileSync(path, "utf8").split("\n").slice(-500).join("\n");
      writeFileSync(path, keep, "utf8");
    }
    const t = new Date();
    const stamp = `${t.toISOString().slice(0, 10)} ${t.toTimeString().slice(0, 8)}`;
    appendFileSync(path, `${stamp}  ${line.replace(/\s*\n\s*/g, " ⏎ ")}\n`, "utf8");
  } catch {
    // logging must never break anything
  }
}

export function readLog(store: Store, lines = 30): string {
  const path = logPath(store);
  if (!existsSync(path)) return "(no activity yet)";
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

export interface State {
  at: string;
  claims: number;
  issues: number;
  pending: number;
}

function statePath(store: Store): string {
  return join(store.localDir, "state.json");
}

/** Recompute counts and cache them. */
export function refreshState(store: Store): State {
  const c = check(store);
  const s: State = {
    at: new Date().toISOString(),
    claims: c.claims,
    issues: c.mentionIssues.length + c.outputIssues.length,
    pending: c.mentionAcked.length + c.outputAcked.length,
  };
  try {
    mkdirSync(store.localDir, { recursive: true });
    writeFileSync(statePath(store), JSON.stringify(s), "utf8");
  } catch {
    // ignore
  }
  return s;
}

/** Cached counts if fresh enough, else recomputed. */
export function currentState(store: Store, maxAgeMs = 60_000): State {
  try {
    const s = JSON.parse(readFileSync(statePath(store), "utf8")) as State;
    if (Date.now() - Date.parse(s.at) < maxAgeMs) return s;
  } catch {
    // fall through
  }
  return refreshState(store);
}

export function statusText(store: Store): string {
  const cfg = store.config();
  if (!cfg.enabled) return "claims off";
  const s = currentState(store);
  if (!s.claims) return "claims –";
  const parts = [s.issues ? `claims ⚠${s.issues}` : `claims ✓${s.claims}`];
  if (s.pending) parts.push(`${s.pending} pending`);
  return parts.join(" · ");
}
