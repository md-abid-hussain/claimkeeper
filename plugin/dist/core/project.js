import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ClaimsError } from "./types.js";
export const STORE_DIR = ".claims";
/** Directory that holds .claims/, searching up from start. */
export function findRoot(start) {
    let dir = resolve(start);
    for (;;) {
        if (existsSync(join(dir, STORE_DIR, "config.json")))
            return dir;
        const up = dirname(dir);
        if (up === dir)
            return undefined;
        dir = up;
    }
}
/**
 * Project root to use when nothing is initialized yet. CLAIMKEEPER_ROOT (or the CLI's --root)
 * works with any agent; CLAUDE_PROJECT_DIR is what Claude Code sets; otherwise the cwd.
 */
export function defaultRoot() {
    return resolve(process.env.CLAIMKEEPER_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd());
}
export function projectRoot() {
    const base = defaultRoot();
    return findRoot(base) ?? base;
}
export function toPosix(p) {
    return p.split(sep).join("/").replace(/\\/g, "/");
}
const escapes = (rel) => rel === ".." || /^\.\.[\\/]/.test(rel) || isAbsolute(rel);
/** Project-relative POSIX path; throws if the path is outside the project. */
export function relPath(root, p) {
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    const rel = relative(root, abs);
    if (escapes(rel))
        throw new ClaimsError(`path is outside the project: ${p}`);
    return toPosix(rel);
}
const realRoots = new Map();
function realOf(p) {
    return realpathSync.native(p);
}
/**
 * Absolute path for a project-relative path from the store or the agent.
 * Store files can come from an untrusted repo, so every path is contained:
 * no absolute paths, no "..", and no symlinks/junctions leading out of the project
 * (checked on the deepest part of the path that exists). Throws ClaimsError otherwise.
 */
export function absPath(root, rel) {
    if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes("\0"))
        throw new ClaimsError(`refusing path outside the project: ${rel}`);
    const abs = resolve(root, rel);
    if (escapes(relative(root, abs)))
        throw new ClaimsError(`refusing path outside the project: ${rel}`);
    let realRoot = realRoots.get(root);
    if (!realRoot) {
        realRoot = existsSync(root) ? realOf(root) : root;
        realRoots.set(root, realRoot);
    }
    let probe = abs;
    while (!existsSync(probe)) {
        const up = dirname(probe);
        if (up === probe)
            break;
        probe = up;
    }
    if (existsSync(probe) && escapes(relative(realRoot, realOf(probe)))) {
        throw new ClaimsError(`refusing path that links outside the project: ${rel}`);
    }
    return abs;
}
/** absPath without throwing: undefined for paths outside the project. */
export function safeAbsPath(root, rel) {
    try {
        return absPath(root, rel);
    }
    catch {
        return undefined;
    }
}
/** Paths claimkeeper never tracks or writes, whatever the config says. */
export function isProtectedPath(rel) {
    return rel === STORE_DIR || rel.startsWith(`${STORE_DIR}/`) || rel === ".git" || rel.startsWith(".git/");
}
/** One path segment against a pattern with * and ? (linear-time, no backtracking blow-up). */
function segmentMatch(p, s) {
    let pi = 0;
    let si = 0;
    let star = -1;
    let mark = 0;
    while (si < s.length) {
        if (pi < p.length && (p[pi] === "?" || p[pi] === s[si])) {
            pi++;
            si++;
        }
        else if (pi < p.length && p[pi] === "*") {
            star = pi++;
            mark = si;
        }
        else if (star !== -1) {
            pi = star + 1;
            si = ++mark;
        }
        else
            return false;
    }
    while (pi < p.length && p[pi] === "*")
        pi++;
    return pi === p.length;
}
/**
 * Minimal glob (**, *, ?) against a POSIX relative path. A pattern without "/" matches the
 * file name anywhere. Patterns can come from an untrusted config, so matching is
 * polynomial (segment DP + linear wildcard), never a backtracking regex.
 */
export function globMatch(glob, rel) {
    if (!glob || glob.length > 200)
        return false;
    const path = rel.split("/");
    if (!glob.includes("/"))
        return segmentMatch(glob.replace(/\*\*+/g, "*"), path[path.length - 1] ?? "");
    const pat = glob.split("/").filter((p, i, a) => p !== "" || i === 0 || i === a.length - 1);
    const memo = new Map();
    const match = (i, j) => {
        const key = i * 100_000 + j;
        const hit = memo.get(key);
        if (hit !== undefined)
            return hit;
        let r;
        if (i === pat.length)
            r = j === path.length;
        else if (pat[i] === "**")
            r = match(i + 1, j) || (j < path.length && match(i, j + 1));
        else
            r = j < path.length && segmentMatch(pat[i].replace(/\*\*+/g, "*"), path[j]) && match(i + 1, j + 1);
        memo.set(key, r);
        return r;
    };
    return match(0, 0);
}
export function isExcluded(rel, patterns) {
    return patterns.some((g) => globMatch(g, rel));
}
// cached briefly: the MCP server is long-lived and the user may run `git init` meanwhile
const gitRootCache = new Map();
export function isGitRepo(root) {
    const cached = gitRootCache.get(root);
    if (cached && Date.now() - cached.at < 30_000)
        return cached.ok;
    const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" });
    const ok = r.status === 0 && r.stdout.trim() === "true";
    gitRootCache.set(root, { ok, at: Date.now() });
    return ok;
}
/** True if git ignores the path. False when not a git repo. */
export function isGitIgnored(root, rel) {
    if (!isGitRepo(root))
        return false;
    const r = spawnSync("git", ["check-ignore", "-q", "--", rel], { cwd: root });
    return r.status === 0;
}
const SKIP_DIRS = new Set([
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
    "__pycache__",
]);
/** Walk project files (skipping heavy/generated dirs and never following links). */
export function walkFiles(root, limit = 20000) {
    const out = [];
    const stack = [root];
    let dirs = 0;
    while (stack.length && out.length < limit && dirs++ < 5000) {
        const dir = stack.pop();
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            continue;
        }
        for (const name of entries) {
            const abs = join(dir, name);
            let st;
            try {
                st = lstatSync(abs);
            }
            catch {
                continue;
            }
            if (st.isSymbolicLink())
                continue;
            if (st.isDirectory()) {
                if (!SKIP_DIRS.has(name))
                    stack.push(abs);
            }
            else if (st.isFile()) {
                out.push(toPosix(relative(root, abs)));
                if (out.length >= limit)
                    break;
            }
        }
    }
    return out;
}
const TEXT_EXT = /\.(md|mdx|txt|html?|tsx?|jsx?|mjs|cjs|vue|svelte|astro|css|scss|json|ya?ml|toml|svg|xml|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|sh|ps1|vtt|srt|csv|tex|rst|ini|cfg|env\.example)$/i;
export function isTextPath(rel) {
    return TEXT_EXT.test(rel) || !/\.[A-Za-z0-9]+$/.test(rel.split("/").pop() ?? "");
}
/** For tests. */
export function _resetGitCache() {
    gitRootCache.clear();
}
