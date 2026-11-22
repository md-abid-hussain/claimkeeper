/** Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). No dependencies. */
import { logActivity, refreshState } from "../core/activity.ts";
import { projectRoot } from "../core/project.ts";
import { Store, withStoreLock } from "../core/store.ts";
import { ClaimsError } from "../core/types.ts";
import { TOOLS } from "./tools.ts";

const MUTATING = new Set(["claims_config", "claim_add", "claim_update", "output"]);

/** Record what the agent changed, for the human (activity log + status cache). */
function trace(name: string, args: Record<string, unknown>, result: string): void {
  try {
    const store = Store.open(projectRoot());
    if (!store) return;
    const subject = [args.action, args.id ?? args.claim].filter((x) => typeof x === "string").join(" ");
    const decided = /MEANING CHANGED \(rev \d+, (user decided|from user's request)/.exec(result)?.[1];
    const meaning = decided ? ` MEANING CHANGED (${decided})` : "";
    const failed = (result.match(/FAILED/g) ?? []).length;
    const added = name === "claim_add" ? (result.match(/^ {2}[a-z0-9-]+#[ml]\d+ /gm) ?? []).length : 0;
    const created = /^Added /.test(result) ? " created" : "";
    logActivity(store, `${name} ${subject}${created}${meaning}${added ? ` +${added} places` : ""}${failed ? ` (${failed} failed)` : ""}`);
    refreshState(store);
  } catch {
    // tracing never affects the tool result
  }
}

/** Works in any MCP client: the only guidance an agent without skills or hooks is sure to get. */
export const INSTRUCTIONS =
  "Tracks product claims across docs, pages, scripts and media. Before editing product-facing text call claims_in {path} (or claim_get); register claims with claim_add; reword with claim_update edits; run claims_check before finishing. Only the user decides a meaning change (decided_by + why). Never regenerate media without their yes.";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "0.4.0";

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

type Id = string | number | null;
type Response = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Id, result: unknown): Response => ({ jsonrpc: "2.0", id, result });
const err = (id: Id, code: number, message: string): Response => ({ jsonrpc: "2.0", id, error: { code, message } });

function validId(v: unknown): v is string | number {
  return typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

/** Handle one JSON-RPC message; returns the response, or undefined for notifications and client responses. */
export function handle(msg: unknown): Response | undefined {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return err(null, -32600, "invalid request");
  const req = msg as Partial<Request> & { result?: unknown; error?: unknown };
  // a response from the client (e.g. to a server request): nothing to answer
  if (req.method === undefined && ("result" in req || "error" in req)) return undefined;
  const isNotification = !("id" in req) || req.id === undefined;
  const id: Id = validId(req.id) ? req.id : null;
  if (typeof req.method !== "string") return isNotification ? undefined : err(id, -32600, "invalid request: method missing");
  const params = req.params && typeof req.params === "object" ? req.params : {};
  const answer = (r: Response): Response | undefined => (isNotification ? undefined : r);
  try {
    switch (req.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : SUPPORTED[0]!;
        if (process.env.CLAIMKEEPER_DEBUG) process.stderr.write(`claimkeeper: client asked protocol ${asked}\n`);
        return answer(
          ok(id, {
            protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "claimkeeper", version: VERSION },
            instructions: INSTRUCTIONS,
          }),
        );
      }
      case "ping":
        return answer(ok(id, {}));
      case "tools/list":
        return answer(ok(id, { tools: TOOLS.map(({ name, description, annotations, inputSchema }) => ({ name, description, inputSchema, annotations })) }));
      case "tools/call": {
        if (isNotification) return undefined; // never run a tool nobody will hear back from
        const name = String(params.name ?? "");
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return err(id, -32602, `unknown tool: ${name}`);
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
        try {
          const writes = MUTATING.has(name) && !(name === "claims_config" && args.action === "status");
          // parallel sessions each run their own server: serialize writes so none overwrites another's
          const text = writes ? withStoreLock(projectRoot(), () => tool.run(args)) : tool.run(args);
          if (writes) trace(name, args, text);
          return ok(id, { content: [{ type: "text", text }] });
        } catch (e) {
          // the agent gets the message; the stack goes to stderr (MCP logs), not into its context
          if (!(e instanceof ClaimsError)) process.stderr.write(`claimkeeper: ${(e as Error).stack ?? String(e)}\n`);
          const text = e instanceof ClaimsError ? e.message : `internal error: ${(e as Error).message ?? String(e)}`;
          return ok(id, { content: [{ type: "text", text }], isError: true });
        }
      }
      default:
        if (req.method.startsWith("notifications/")) return undefined;
        return answer(err(id, -32601, `method not found: ${req.method}`));
    }
  } catch (e) {
    return answer(err(id, -32603, (e as Error).message));
  }
}

/** One line of input: a message or a batch (array) of messages. */
export function handleLine(line: string): unknown {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return err(null, -32700, "parse error");
  }
  if (Array.isArray(msg)) {
    if (!msg.length) return err(null, -32600, "invalid request: empty batch");
    const out = msg.map(handle).filter((r): r is Response => !!r);
    return out.length ? out : undefined;
  }
  return handle(msg);
}

export function startServer(): void {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const out = handleLine(line);
        if (out !== undefined) send(out);
      } catch (e) {
        process.stderr.write(`claimkeeper: ${(e as Error).stack ?? String(e)}\n`);
      }
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
