/**
 * Build plugin/dist: one self-contained ESM program (plus a lazily loaded chunk for the MCP server).
 * The MCP SDK and zod are pinned devDependencies bundled into it, so the plugin, a git checkout and
 * the npm package all run with plain `node` and install nothing. Hooks load only the small main
 * file; the SDK chunk is read only for `claimkeeper mcp`.
 */
import { build } from "esbuild";
import { copyFileSync, rmSync } from "node:fs";

rmSync("plugin/dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/cli.ts"],
  outdir: "plugin/dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  chunkNames: "chunks/[name]-[hash]",
  legalComments: "none",
  // bundled CommonJS dependencies may call require() for Node built-ins
  banner: { js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);' },
  logLevel: "warning",
});

for (const f of ["README.md", "LICENSE", "PRIVACY.md"]) copyFileSync(f, `plugin/${f}`);
