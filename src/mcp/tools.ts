/**
 * Seven MCP tools. Few tools, short descriptions, compact text output:
 * the agent's context pays for every word here.
 */
import {
  formatCheck,
  formatClaimViews,
  formatConfig,
  formatInFile,
  formatList,
  formatScan,
  formatUpdate,
  mentionLine,
  outputLine,
} from "../core/format.ts";
import * as z from "zod";
import * as ops from "../core/ops.ts";
import { defaultRoot, isLinkedWorktree, projectRoot } from "../core/project.ts";
import { ClaimsError, MENTION_KINDS, type MentionKind, type StopMode } from "../core/types.ts";

type Json = Record<string, unknown>;

/**
 * MCP tool annotations. All four hints are always set to explicit booleans (some hosts reject
 * tools that omit one). They describe the tool as a whole, so for a tool with several actions
 * they describe its most impactful action; the description says which.
 * openWorldHint is false everywhere: claimkeeper never touches the network or anything outside
 * the project folder.
 */
export interface Annotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

export interface ToolDef {
  name: string;
  description: string;
  annotations: Annotations;
  inputSchema: Z;
  run(args: Json): string;
}

/** Reads only: never writes a file, in the project or in .claims/. */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** Adds or updates claimkeeper's own records; never deletes or overwrites anything the user wrote. */
const ADDITIVE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
/** Can rewrite project text, delete a claim or stop tracking: hosts should confirm. */
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

// Input schemas are zod: the MCP SDK validates arguments against them and publishes them as JSON Schema.
// Objects are strict (unknown arguments are an error, as before); fields not listed as required are optional.
type Z = z.ZodType;
const str = (description: string) => z.string().describe(description);
const num = (description: string) => z.number().describe(description);
const bool = (description: string) => z.boolean().describe(description);
const strArr = (description: string) => z.array(z.string()).describe(description);
const en = (values: readonly string[], description?: string) => (description ? z.enum(values).describe(description) : z.enum(values));
const obj = (properties: Record<string, Z>, required: string[] = []) =>
  z.strictObject(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, required.includes(k) ? v : v.optional()])));

function s(args: Json, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || !v) throw new ClaimsError(`${key} is required`);
  return v;
}
// Optional args: absent is fine, a wrong type is an error (never silently widened to "everything").
const present = (a: Json, k: string) => a[k] !== undefined && a[k] !== null;
function os(a: Json, k: string): string | undefined {
  if (!present(a, k)) return undefined;
  if (typeof a[k] !== "string") throw new ClaimsError(`${k} must be a string`);
  return (a[k] as string) || undefined;
}
function oarr(a: Json, k: string): string[] | undefined {
  if (!present(a, k)) return undefined;
  const v = a[k];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new ClaimsError(`${k} must be an array of strings`);
  return v as string[];
}
function onum(a: Json, k: string): number | undefined {
  if (!present(a, k)) return undefined;
  if (typeof a[k] !== "number" || !Number.isFinite(a[k])) throw new ClaimsError(`${k} must be a number`);
  return a[k] as number;
}
function obool(a: Json, k: string): boolean | undefined {
  if (!present(a, k)) return undefined;
  if (typeof a[k] !== "boolean") throw new ClaimsError(`${k} must be true or false`);
  return a[k] as boolean;
}
function objects(a: Json, k: string): Json[] | undefined {
  if (!present(a, k)) return undefined;
  const v = a[k];
  if (!Array.isArray(v) || !v.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new ClaimsError(`${k} must be an array of objects`);
  return v as Json[];
}

/** Build an object without undefined values (exactOptionalPropertyTypes-friendly). */
function defined<T extends Json>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;
}

const store = () => ops.requireStore(projectRoot());

const mentionSchema = obj(
  {
    path: str("File path (or URL for kind url)."),
    anchor: str("Exact wording of the claim in that file, 10-500 chars. Required for text/code."),
    kind: en(MENTION_KINDS, "Default from extension. text/code/svg: wording; image/audio/video/file: fingerprint; url: meaning only."),
    line: num("Pick one occurrence when the wording repeats."),
    note: str("Short label, e.g. 'hero headline'."),
    conflict: str("This place CONTRADICTS the claim: say how. Stays flagged until fixed."),
  },
  ["path"],
);

function mentionInputs(a: Json): Array<Omit<ops.MentionInput, "claim">> {
  return (objects(a, "mentions") ?? []).map((it) =>
    defined({
      path: s(it, "path"),
      anchor: os(it, "anchor"),
      kind: os(it, "kind") as MentionKind | undefined,
      line: onum(it, "line"),
      note: os(it, "note"),
      conflict: os(it, "conflict"),
    }),
  );
}

export const TOOLS: ToolDef[] = [
  {
    name: "claims_config",
    description: "Set up or configure claim tracking. init: turn it on here (.claims/, committed unless share=false). status: settings + health (read-only). set: checks on/off (enabled), stop mode, nudges; scope 'me' (default) or 'project'. Writes only claimkeeper's own settings.",
    annotations: { title: "Set up claim tracking", ...ADDITIVE },
    inputSchema: obj(
      {
        action: en(["init", "status", "set"]),
        share: bool("init: commit the store to git (default true)."),
        enabled: bool("set: automatic checks on/off."),
        stop: en(["block", "warn", "off"], "set: end-of-turn check: block (fix or ack first), warn (report), off."),
        nudge: bool("set: suggest unregistered mentions in new files."),
        scope: en(["me", "project"]),
      },
      ["action"],
    ),
    run(a) {
      const action = s(a, "action");
      if (action === "init") {
        const { store: st, created } = ops.init(defaultRoot(), obool(a, "share"));
        return `${created ? "Initialized" : "Already initialized"} ${st.dir}\n${formatConfig(st.config())}`;
      }
      const st = store();
      if (action === "set") {
        const stop = a.stop === "block" || a.stop === "warn" || a.stop === "off" ? (a.stop as StopMode) : undefined;
        return formatConfig(ops.toggle(st, defined({ enabled: obool(a, "enabled"), stop, nudge: obool(a, "nudge") }), a.scope === "project" ? "project" : "me"));
      }
      const c = ops.check(st);
      // a session in a linked git worktree keeps its own copy of the store: say so, it is the usual reason a claim "went missing"
      const wt = isLinkedWorktree(st.root) ? `\nLinked git worktree: claim changes made here live on this branch (${st.dir}); commit .claims/ and merge it to share them.` : "";
      return `${formatConfig(st.config())}\n${c.claims} claims, ${c.mentions} mentions, ${c.outputs} outputs; ${c.mentionIssues.length + c.outputIssues.length} need attention, ${c.mentionAcked.length + c.outputAcked.length} pending.${wt}`;
    },
  },
  {
    name: "claim_add",
    description: "Create a claim (id + one-sentence meaning) and/or register the places it appears. On an existing claim, just pass mentions. Wording is verified to exist. dry_run previews without writing. Only adds records; changes no project file.",
    annotations: { title: "Add a claim or its places", ...ADDITIVE },
    inputSchema: obj(
      {
        id: str("lowercase-with-dashes, e.g. 'on-device'."),
        desc: str("One sentence: the meaning every place must agree with. Required for a new claim."),
        keywords: strArr("Words that signal this claim (for spotting unregistered mentions)."),
        mentions: z.array(mentionSchema),
        dry_run: bool("Check everything and show what would be registered (and which places would FAIL), but write nothing."),
      },
      ["id"],
    ),
    run(a) {
      const go = (): string => {
        const r = ops.addClaimWithMentions(store(), defined({ id: s(a, "id"), desc: os(a, "desc"), keywords: oarr(a, "keywords"), mentions: mentionInputs(a) }));
        const lines = [r.created ? `Added ${r.claim.id} (rev 1): "${r.claim.desc}"` : `${r.claim.id} rev ${r.claim.rev}`];
        for (const m of r.mentions) lines.push(m.ok ? mentionLine(m.resolved, true) : `  FAILED ${m.path}: ${m.error}`);
        // numbers drift silently in code: ask for the constant right when the claim is registered
        if (ops.isUnbackedNumber(store(), r.claim)) {
          lines.push(`  This claim states a number with no code place yet: find the constant that sets it (grep) and add it as {path, kind:"code", anchor:"<declaration line>"}.`);
        }
        return lines.join("\n");
      };
      if (!obool(a, "dry_run")) return go();
      return `DRY RUN, nothing was written. claim_add would do this:\n${store().rollback(go)}`;
    },
  },
  {
    name: "claim_get",
    description: "Claims with every place resolved against the files as they are now (line, status, wording) plus outputs built from them. No ids: list all claims. Read-only. Prefer one id at a time.",
    annotations: { title: "Get claims", ...READ_ONLY },
    inputSchema: obj({
      ids: strArr("Claim ids (omit to list all)."),
      context: num("Lines of context per text place, 0-10."),
      view: en(["full", "brief"], "brief: healthy places by file and id only, no wording (default for claims with more than 8 places). full: all wording."),
    }),
    run(a) {
      const ids = oarr(a, "ids") ?? [];
      if (!ids.length) return formatList(ops.listClaims(store()));
      const ctx = Math.max(0, Math.min(10, onum(a, "context") ?? 0));
      const v = os(a, "view");
      if (v !== undefined && v !== "full" && v !== "brief") throw new ClaimsError('view must be "full" or "brief"');
      return formatClaimViews(ops.getClaims(store(), ids, ctx ? { context: ctx } : {}), v ?? (ctx ? "full" : "auto"));
    },
  },
  {
    name: "claims_check",
    description: "Only what needs attention: drifted/missing places, stale meanings, outputs needing regeneration, plus pending acknowledged items. Read-only.",
    annotations: { title: "Check claims", ...READ_ONLY },
    inputSchema: obj({ claims: strArr("Limit to these claims."), paths: strArr("Limit to these files.") }),
    run(a) {
      return formatCheck(ops.check(store(), defined({ claims: oarr(a, "claims"), paths: oarr(a, "paths"), searchMissing: true })));
    },
  },
  {
    name: "claims_in",
    description: "Claims a file holds and outputs built from it. scan=true also suggests unregistered mentions of known claims. Read-only.",
    annotations: { title: "Claims in a file", ...READ_ONLY },
    inputSchema: obj({ path: str("File path."), scan: bool("Also suggest unregistered mentions.") }, ["path"]),
    run(a) {
      const st = store();
      const path = s(a, "path");
      const out = formatInFile(ops.claimsIn(st, path));
      return obool(a, "scan") ? `${out}\n\n${formatScan(path, ops.scanFile(st, path))}` : out;
    },
  },
  {
    name: "claim_update",
    description:
      "Change a claim. desc = new MEANING, only on the user's decision (decided_by + why; bumps revision; unconfirmed places/outputs go stale; tell the user). revert = an earlier revision's meaning (same rule). remove = delete the claim. edits per place: {mention, text} new wording written into the file; {mention, anchor} the file already says it, keep that wording; {mention, accept:true} still true; {mention, ack} left for later; {mention, relink} file moved; {mention, remove:true}. accept_all confirms every other place that still has its wording. Rewording without desc keeps the meaning. Can rewrite project files and delete claims.",
    annotations: { title: "Update or remove a claim", ...DESTRUCTIVE },
    inputSchema: obj(
      {
        claim: str("Claim id."),
        desc: str("New meaning (only when the meaning really changes)."),
        revert: num("Bring back this revision's meaning."),
        decided_by: en(["user", "user_request", "agent"], "Required with desc/revert. user: they said so. user_request: it follows from what they asked for. agent: your own idea (refused: ask the user first)."),
        why: str("Required with desc/revert: the user's words, or the request the change follows from."),
        remove: bool("Delete the whole claim."),
        accept_all: bool("After the edits: confirm every other place whose wording is still found (changed, moved, code changed) at the current revision. Only after you checked each still says the same thing; places with missing wording or files are left and listed."),
        keywords: strArr("Replace keywords."),
        no_code: str("Why a number in this claim has no code constant (e.g. 'a guideline, not a setting'); \"\" clears it."),
        edits: z.array(
          obj(
            {
              mention: str("Place id, e.g. m3."),
              text: str("New wording for this place."),
              old: str("Exact current text to replace when the place drifted."),
              anchor: str("The file already says it in new words: this exact wording, now in the file. Updates the place without touching the file."),
              accept: bool("Current content is still true."),
              ack: str("Why this known issue is left for now."),
              relink: str("New path after a rename."),
              line: num("Line hint for relink."),
              remove: bool("Stop tracking this place."),
            },
            ["mention"],
          ),
        ),
      },
      ["claim"],
    ),
    run(a) {
      const st = store();
      const claim = s(a, "claim");
      if (obool(a, "remove")) {
        ops.removeClaim(st, claim);
        return `Removed claim ${claim}.`;
      }
      const edits = objects(a, "edits")?.map((e) => {
        // text and ack may legitimately be "" (ack: "acknowledged"), so check types, not truthiness
        if (e.text !== undefined && typeof e.text !== "string") throw new ClaimsError("text must be a string");
        if (e.old !== undefined && typeof e.old !== "string") throw new ClaimsError("old must be a string");
        if (e.ack !== undefined && typeof e.ack !== "string") throw new ClaimsError("ack must be a string");
        return defined({
          mention: s(e, "mention"),
          text: e.text as string | undefined,
          old: e.old as string | undefined,
          anchor: os(e, "anchor"),
          accept: obool(e, "accept") ? true : undefined,
          ack: e.ack as string | undefined,
          relink: os(e, "relink"),
          line: onum(e, "line"),
          remove: obool(e, "remove") ? true : undefined,
        }) as ops.EditInput;
      });
      return formatUpdate(
        ops.updateClaim(
          st,
          defined({ claim, desc: os(a, "desc"), revert: onum(a, "revert"), keywords: oarr(a, "keywords"), edits, acceptAll: obool(a, "accept_all") ? true : undefined, decidedBy: os(a, "decided_by"), why: os(a, "why"), noCode: typeof a.no_code === "string" ? a.no_code : undefined }),
        ),
      );
    },
  },
  {
    name: "output",
    description:
      "Generated files (ElevenLabs audio, SVG export, Remotion render...). record: right after (re)generating, with the inputs it was made from; it is then flagged when an input or claim meaning changes. ack: user chose not to regenerate now. remove: stop tracking (the file stays). Never generates files; never regenerate without the user's approval.",
    annotations: { title: "Record generated files", ...DESTRUCTIVE },
    inputSchema: obj(
      {
        action: en(["record", "ack", "remove"]),
        path: str("record: the generated file."),
        inputs: strArr("record: paths (script, composition, svg, audio), 'claim#m3', or 'out:<id>'."),
        id: str("Output id (record: optional, default from file name; ack/remove: required)."),
        kind: en(MENTION_KINDS),
        claims: strArr("record: extra claim ids it expresses."),
        meta: z.record(z.string(), z.unknown()).describe("record: non-secret details (tool, voice, model, composition)."),
        note: str("ack: why it is left as is."),
      },
      ["action"],
    ),
    run(a) {
      const st = store();
      const action = s(a, "action");
      const id = os(a, "id")?.replace(/^out:/, "");
      if (action === "ack") return outputLine(ops.ackOutput(st, { id: id ?? s(a, "id"), note: s(a, "note") }));
      if (action === "remove") {
        ops.removeOutput(st, id ?? s(a, "id"));
        return `Removed out:${id}.`;
      }
      const meta = a.meta && typeof a.meta === "object" ? (a.meta as Json) : undefined;
      const r = ops.recordOutput(st, defined({ path: s(a, "path"), inputs: oarr(a, "inputs") ?? [], id, kind: os(a, "kind") as MentionKind | undefined, claims: oarr(a, "claims"), meta }));
      return `Recorded:\n${outputLine(r)}\n  claims: ${Object.entries(r.output.claims).map(([c, v]) => `${c}@rev${v}`).join(", ") || "(none)"}`;
    },
  },
];
