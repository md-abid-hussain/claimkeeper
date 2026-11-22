/**
 * The MCP server: the official TypeScript SDK over stdio. Any MCP client starts it as a
 * subprocess (`claimkeeper mcp`), so it is a command-line program with a protocol on stdin/stdout.
 * The SDK handles the protocol (versions, validation, errors); the tools live in tools.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const VERSION = "0.5.1";

type Result = { content: Array<{ type: "text"; text: string }>; isError?: true };
const reply = (text: string): Result => ({ content: [{ type: "text", text }] });

/** Run one tool the way every call runs: writes serialized across sessions, errors as text for the agent. */
function call(name: string, args: Record<string, unknown>): Result {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ...reply(`unknown tool: ${name}`), isError: true };
  try {
    const writes = MUTATING.has(name) && !(name === "claims_config" && args.action === "status");
    // parallel sessions each run their own server: serialize writes so none overwrites another's
    const text = writes ? withStoreLock(projectRoot(), () => tool.run(args)) : tool.run(args);
    if (writes && args.dry_run !== true) trace(name, args, text); // a dry run leaves nothing to log
    return reply(text);
  } catch (e) {
    // the agent gets the message; the stack goes to stderr (MCP logs), not into its context
    if (!(e instanceof ClaimsError)) process.stderr.write(`claimkeeper: ${(e as Error).stack ?? String(e)}\n`);
    return { ...reply(e instanceof ClaimsError ? e.message : `internal error: ${(e as Error).message ?? String(e)}`), isError: true };
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "claimkeeper", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      { title: t.annotations.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      (args: unknown) => call(t.name, (args ?? {}) as Record<string, unknown>),
    );
  }
  if (process.env.CLAIMKEEPER_DEBUG) {
    server.server.oninitialized = () => process.stderr.write(`claimkeeper: client ${JSON.stringify(server.server.getClientVersion())}\n`);
  }
  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // the client closing our stdin is the normal way to stop
  process.stdin.on("end", () => process.exit(0));
}
