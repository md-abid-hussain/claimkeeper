/** Refuse to store anything that looks like a secret. Deliberately conservative. */

const PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["OpenAI/Anthropic-style key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["Stripe-style key", /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  // KEY=value is code/config: any 8+ char value. "key: value" is often prose, so the value must look like a token (has a digit).
  ["credential assignment", /\b(api[_-]?key|secret|token|passw(or)?d|auth)\b\s*=\s*["']?[^\s"']{8,}/i],
  ["credential assignment", /\b(api[_-]?key|secret|token|passw(or)?d|auth)\b\s*:\s*["']?(?=[^\s"']*\d)[^\s"']{8,}/i],
];

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let e = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/** Returns a reason if the text looks like it contains a secret. */
export function findSecret(text: string): string | undefined {
  for (const [name, re] of PATTERNS) if (re.test(text)) return name;
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) {
    const tok = m[0];
    if (/[0-9]/.test(tok) && /[A-Za-z]/.test(tok) && entropy(tok) > 4.0) return "high-entropy string";
  }
  return undefined;
}

const SECRET_KEY = /key|token|secret|auth|passw|cookie|credential|bearer/i;

/** Keep only small, non-secret string metadata. */
export function cleanMeta(meta: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length > 300 || findSecret(s)) continue;
    out[k] = s;
  }
  return out;
}
