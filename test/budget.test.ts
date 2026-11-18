/** Context budget: what the agent always or often loads must stay small. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { TOOLS } from "../src/mcp/tools.ts";

const MAX_CLAIMS_SKILL_WORDS = 500;
const TOOL_COUNT = 7;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

test("the core claims skill stays under its word budget", () => {
  const text = readFileSync(resolve(import.meta.dirname, "../plugin/skills/claims/SKILL.md"), "utf8");
  const body = text.replace(/^---[\s\S]*?---/, "");
  assert.ok(words(body) < MAX_CLAIMS_SKILL_WORDS, `claims skill body is ${words(body)} words`);
});

test("the MCP server exposes exactly the documented number of tools", () => {
  assert.equal(TOOLS.length, TOOL_COUNT);
});
