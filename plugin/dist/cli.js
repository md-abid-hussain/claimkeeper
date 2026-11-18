#!/usr/bin/env node
/** claimkeeper CLI: setup, on/off, checks for humans and CI, hook entry points, and the MCP server. */
import { formatCheck, formatClaimViews, formatConfig, formatInFile, formatList, formatScan } from "./core/format.js";
import { readLog, statusText } from "./core/activity.js";
import * as ops from "./core/ops.js";
import { resolve } from "node:path";
import { defaultRoot, findRoot, projectRoot } from "./core/project.js";
import { Store } from "./core/store.js";
import { ClaimsError } from "./core/types.js";
import { readStdin, runHook } from "./hooks/hooks.js";
import { startServer } from "./mcp/server.js";
const HELP = `claimkeeper — keep product claims consistent across docs, pages, scripts and media

Usage:
  claimkeeper init [--private]     start tracking claims in this project (.claims/)
  claimkeeper on|off [--me]        turn automatic checks on/off (--me: only for you)
  claimkeeper stop-mode <block|warn|off> [--me]
  claimkeeper status               settings and health summary
  claimkeeper list                 all claims
  claimkeeper get <id...> [--context N]
  claimkeeper check [--ci]         what needs attention (--ci: exit 1 if anything)
  claimkeeper in <path>            claims in a file, outputs built from it
  claimkeeper scan <path>          possible unregistered mentions in a file
  claimkeeper log [-n N]           what the agent and hooks did (activity log)
  claimkeeper statusline           one-line status for Claude Code's status line
  claimkeeper mcp                  run the MCP server (stdio)
  claimkeeper hook <session-start|post-tool-use|stop>   Claude Code hook entry
`;
function flag(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return false;
    args.splice(i, 1);
    return true;
}
function option(args, name) {
    const i = args.indexOf(name);
    if (i === -1)
        return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
}
async function main(argv) {
    const [cmd, ...args] = argv;
    switch (cmd) {
        case "mcp":
            startServer();
            return -1; // keep running
        case "hook":
            await runHook(args[0] ?? "");
            return 0;
        case "init": {
            const priv = flag(args, "--private");
            const { store, created } = ops.init(defaultRoot(), priv ? false : undefined);
            console.log(`${created ? "Initialized" : "Already initialized"} claim tracking in ${store.dir}`);
            console.log(formatConfig(store.config()));
            return 0;
        }
        case "on":
        case "off": {
            const me = flag(args, "--me");
            console.log(formatConfig(ops.toggle(ops.requireStore(projectRoot()), { enabled: cmd === "on" }, me ? "me" : "project")));
            return 0;
        }
        case "stop-mode": {
            const me = flag(args, "--me");
            const mode = args[0];
            if (mode !== "block" && mode !== "warn" && mode !== "off")
                throw new ClaimsError("stop-mode needs block, warn or off");
            console.log(formatConfig(ops.toggle(ops.requireStore(projectRoot()), { stop: mode }, me ? "me" : "project")));
            return 0;
        }
        case "status": {
            const store = ops.requireStore(projectRoot());
            const c = ops.check(store);
            console.log(formatConfig(store.config()));
            console.log(`${c.claims} claims, ${c.mentions} mentions, ${c.outputs} outputs; ${c.mentionIssues.length + c.outputIssues.length} need attention`);
            return 0;
        }
        case "list":
            console.log(formatList(ops.listClaims(ops.requireStore(projectRoot()))));
            return 0;
        case "get": {
            const ctx = option(args, "--context");
            if (!args.length)
                throw new ClaimsError("get needs claim ids");
            console.log(formatClaimViews(ops.getClaims(ops.requireStore(projectRoot()), args, ctx ? { context: Number(ctx) } : {})));
            return 0;
        }
        case "check": {
            const ci = flag(args, "--ci");
            const res = ops.check(ops.requireStore(projectRoot()), { searchMissing: true });
            console.log(formatCheck(res));
            return ci && (res.mentionIssues.length || res.outputIssues.length) ? 1 : 0;
        }
        case "in":
            if (!args[0])
                throw new ClaimsError("in needs a path");
            console.log(formatInFile(ops.claimsIn(ops.requireStore(projectRoot()), resolve(process.cwd(), args[0]))));
            return 0;
        case "scan":
            if (!args[0])
                throw new ClaimsError("scan needs a path");
            console.log(formatScan(args[0], ops.scanFile(ops.requireStore(projectRoot()), resolve(process.cwd(), args[0]))));
            return 0;
        case "log": {
            const n = Number(option(args, "-n") ?? 30);
            console.log(readLog(ops.requireStore(projectRoot()), Number.isFinite(n) ? n : 30));
            return 0;
        }
        case "statusline": {
            // Claude Code passes session JSON on stdin; use its project dir when present
            let dir;
            try {
                const raw = await readStdin();
                const j = raw.trim() ? JSON.parse(raw) : {};
                dir = j.workspace?.project_dir ?? j.workspace?.current_dir ?? j.cwd;
            }
            catch {
                // ignore malformed input
            }
            const root = findRoot(dir ?? projectRoot());
            const store = root ? Store.open(root) : undefined;
            process.stdout.write(store ? statusText(store) : "");
            return 0;
        }
        case undefined:
        case "help":
        case "--help":
        case "-h":
            console.log(HELP);
            return 0;
        default:
            console.error(`unknown command: ${cmd}\n\n${HELP}`);
            return 2;
    }
}
main(process.argv.slice(2)).then((code) => {
    if (code >= 0)
        process.exitCode = code;
}, (e) => {
    console.error(e instanceof ClaimsError ? `claimkeeper: ${e.message}` : e);
    process.exitCode = 1;
});
