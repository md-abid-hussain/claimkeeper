import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { _resetGitCache } from "../src/core/project.ts";

export interface Project {
  root: string;
  write(rel: string, content: string | Buffer): void;
  read(rel: string): string;
  rm(rel: string): void;
  cleanup(): void;
}

/** A throwaway hackathon-style project, optionally a git repo. */
export function makeProject(files: Record<string, string | Buffer> = {}, git = true): Project {
  const root = mkdtempSync(join(tmpdir(), "claimkeeper-"));
  const p: Project = {
    root,
    write(rel, content) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    read: (rel) => readFileSync(join(root, rel), "utf8"),
    rm: (rel) => rmSync(join(root, rel), { force: true }),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
  for (const [rel, c] of Object.entries(files)) p.write(rel, c);
  if (git) spawnSync("git", ["init", "-q"], { cwd: root });
  _resetGitCache();
  return p;
}

export const HACKATHON = {
  ".gitignore": "out/\nnode_modules/\n.env\n",
  "README.md": [
    "# Murmur",
    "",
    "Murmur turns meeting audio into action items.",
    "",
    "## Principles",
    "",
    "- Everything runs on your device; no audio ever leaves your laptop.",
    "- Summaries arrive in under 2 seconds.",
    "",
  ].join("\n"),
  "site/index.html": [
    "<html><body>",
    "  <h1>Your meetings, <em>private</em> by default</h1>",
    "  <p>Runs on-device. No audio leaves your laptop.</p>",
    "</body></html>",
  ].join("\n"),
  "video/voiceover.txt": "Murmur listens to your meeting and writes the action items. Everything runs on your device, so no audio ever leaves your laptop.\n",
  "video/Promo.tsx": [
    "export const Promo = () => (",
    "  <AbsoluteFill>",
    "    <Title text=\"No audio leaves your laptop\" />",
    "    <Audio src={staticFile('vo.mp3')} />",
    "  </AbsoluteFill>",
    ");",
  ].join("\n"),
  "public/hero.svg": '<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20">100% on-device</text></svg>\n',
  "src/engine.ts": [
    "export function transcribe(audio: Buffer) {",
    "  // local whisper model, no network",
    "  return localModel.run(audio);",
    "}",
    "",
    "export const other = 1;",
  ].join("\n"),
};
