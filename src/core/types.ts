/** Kinds of places a claim can appear in. */
export type MentionKind =
  | "text" // prose in docs, pages, scripts, JSX strings: tracked by its wording
  | "code" // code that makes the claim true: tracked by wording + hash of its block
  | "svg" // SVG with the claim in its text: tracked by wording, and Claude can look at it
  | "image" // raster image: fingerprint only
  | "audio" // fingerprint only
  | "video" // fingerprint only
  | "file" // any other file: fingerprint only
  | "url"; // hosted somewhere else: meaning revision only

export const MENTION_KINDS: readonly MentionKind[] = [
  "text",
  "code",
  "svg",
  "image",
  "audio",
  "video",
  "file",
  "url",
];

export const ANCHORED_KINDS: ReadonlySet<MentionKind> = new Set(["text", "code", "svg"]);

export interface Ack {
  /** Signature of the state that was acknowledged; the ack lapses when it changes. */
  sig: string;
  note: string;
  at: string;
}

export interface Mention {
  id: string;
  kind: MentionKind;
  /** Project-relative POSIX path, or a URL for kind "url". */
  path: string;
  /** Wording that locates the mention (anchored kinds). */
  anchor?: string;
  /** Last known line (1-based). A hint only: never trusted, refreshed only when the claim is written. */
  line?: number;
  /** Hash of the code block that starts at the anchor (kind "code"). */
  block?: string;
  /** Fingerprint of the whole file (media/file kinds, and svg without anchor). */
  fp?: string;
  /** Claim revision this mention was last confirmed against. */
  rev: number;
  note?: string;
  ack?: Ack;
}

/**
 * Who decided a meaning change. Only the user decides what the product promises:
 * "user" = the user said so; "user_request" = it follows from something the user asked for
 * (e.g. the code change they requested). The agent's own idea is a proposal, never a decision.
 */
export type DecidedBy = "user" | "user_request";
export const DECIDERS: readonly string[] = ["user", "user_request", "agent"];

export interface HistoryEntry {
  rev: number;
  desc: string;
  at: string;
  by?: DecidedBy;
  /** Short reason, e.g. 'user asked: "summaries now sync to the cloud"'. */
  why?: string;
}

export interface Claim {
  id: string;
  desc: string;
  keywords: string[];
  rev: number;
  history: HistoryEntry[];
  mentions: Mention[];
  next: number;
  /** Why a number in this claim has no code constant behind it (e.g. "a guideline, not a setting"). */
  noCode?: string;
}

/** Mentions of a claim that live in files git ignores (kept in .claims/local). */
export interface LocalClaim {
  id: string;
  mentions: Mention[];
  next: number;
}

export interface OutputInput {
  /** "claim#m3" for a mention, "out:<id>" for another output, or a project-relative path. */
  ref: string;
  hash: string;
}

export interface Output {
  id: string;
  kind: MentionKind;
  path: string;
  inputs: OutputInput[];
  /** Claim revisions the output was generated against. */
  claims: Record<string, number>;
  fp: string;
  /** Small, non-secret generation details: tool, voice, model, composition... */
  meta: Record<string, string>;
  at: string;
  ack?: Ack;
}

export interface OutputsFile {
  outputs: Output[];
}

export type StopMode = "block" | "warn" | "off";

export interface Config {
  version: 1;
  /** Hooks run only when enabled. Tools always work. */
  enabled: boolean;
  /** Commit the store to git (local/ is always ignored). */
  share: boolean;
  stop: StopMode;
  /** Suggest possible unregistered mentions when new files are written. */
  nudge: boolean;
  minAnchor: number;
  exclude: string[];
}

/** Resolved state of one mention. */
export type MentionStatus =
  | "ok"
  | "moved"
  | "reformatted"
  | "changed"
  | "code_changed"
  | "text_not_found"
  | "file_not_found"
  | "unsafe_path"
  | "unchecked";

export interface ResolvedMention {
  claim: string;
  mention: Mention;
  local: boolean;
  status: MentionStatus;
  line?: number;
  /** Current wording at the mention (anchored kinds). */
  current?: string;
  /** Character range of `current` in the file. */
  range?: [number, number];
  /** Other lines where the same wording appears. */
  alsoAt?: number[];
  similarity?: number;
  /** Paths that may be where a missing file went. */
  candidates?: string[];
  /** Meaning changed since this mention was confirmed. */
  stale: boolean;
  /** Description the mention was confirmed against, when stale. */
  staleFrom?: string;
  acked?: string;
  context?: string;
}

export type OutputStatus = "ok" | "needs_regen" | "stale" | "changed" | "not_generated";

export interface ResolvedOutput {
  output: Output;
  local: boolean;
  status: OutputStatus;
  reasons: string[];
  acked?: string;
  sig: string;
}

export class ClaimsError extends Error {}
