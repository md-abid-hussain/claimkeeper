import { clip, oneLine } from "./text.js";
/** Every store-derived string is shown through clip/oneLine: it may come from an untrusted repo. */
function where(r) {
    const m = r.mention;
    const path = clip(m.path, 160);
    if (m.kind === "url")
        return path;
    const hint = m.line;
    if (r.line !== undefined && hint !== undefined && r.line !== hint)
        return `${path}:${hint}→${r.line}`;
    if (r.line !== undefined)
        return `${path}:${r.line}`;
    return path;
}
export function mentionLine(r, withClaim = false) {
    const m = r.mention;
    const id = withClaim ? `${r.claim}#${m.id}` : m.id;
    const flags = [r.status === "unchecked" ? "check-by-hand" : r.status];
    if (r.stale)
        flags.push(m.rev === 0 ? "CONFLICT" : `STALE(rev ${m.rev})`);
    if (r.acked !== undefined)
        flags.push(`acked: ${clip(r.acked, 60)}`);
    let line = `  ${id.padEnd(withClaim ? 18 : 4)} ${m.kind.padEnd(5)} ${where(r).padEnd(30)} ${flags.join(" ")}`;
    if (r.status === "unchecked") {
        // web pages are never fetched: tell the person what to look for
        line += m.anchor ? `\n        web page: check by hand that it still says "${clip(m.anchor, 120)}"` : `\n        web page: check it by hand`;
    }
    else if (m.anchor) {
        if (r.status === "changed")
            line += `\n        now: "${clip(r.current ?? "", 140)}" (similarity ${r.similarity})\n        was: "${clip(m.anchor, 140)}"`;
        else if (r.status === "text_not_found")
            line += `\n        missing wording: "${clip(m.anchor, 140)}"`;
        else
            line += `  "${clip(r.current ?? m.anchor, 100)}"`;
    }
    if (r.status === "code_changed")
        line += `\n        the code block backing this claim changed: verify the claim still holds, then accept`;
    if (r.stale && r.staleFrom !== undefined)
        line += `\n        confirmed for old meaning: "${clip(r.staleFrom, 120)}"`;
    if (m.kind === "svg" || m.kind === "image")
        line += `\n        visual: open ${clip(m.path, 160)} to look at it`;
    if (r.alsoAt?.length)
        line += `\n        same wording also at lines ${r.alsoAt.join(", ")}`;
    if (r.candidates?.length)
        line += `\n        maybe moved to: ${r.candidates.map((c) => clip(c, 160)).join(", ")} (claim_update edits {mention, relink})`;
    if (m.note)
        line += `\n        note: ${clip(m.note, 120)}`;
    if (r.context)
        line += `\n${r.context}`;
    return line;
}
export function outputLine(r) {
    const o = r.output;
    let s = `  out:${o.id.padEnd(16)} ${o.kind.padEnd(5)} ${clip(o.path, 160).padEnd(30)} ${r.status}`;
    if (r.acked !== undefined)
        s += ` (acked: ${clip(r.acked, 60)})`;
    for (const reason of r.reasons)
        s += `\n        - ${clip(reason, 240)}`;
    const meta = Object.entries(o.meta);
    if (meta.length)
        s += `\n        made with: ${meta.map(([k, v]) => `${k}=${clip(v, 40)}`).join(", ")}`;
    return s;
}
export function formatClaimHeader(c) {
    let s = `${c.id}  rev ${c.rev}  "${oneLine(c.desc)}"`;
    if (c.keywords.length)
        s += `\n  keywords: ${oneLine(c.keywords.join(", "))}`;
    const prev = c.history.filter((h) => h.rev !== c.rev).slice(-3).reverse();
    const decided = (h) => (h.by ? `, ${h.by === "user" ? "user decided" : "from user's request"}${h.why ? `: ${clip(h.why, 80)}` : ""}` : "");
    const cur = c.history.find((h) => h.rev === c.rev);
    if (cur?.by)
        s += `\n  why: ${cur.by === "user" ? "user decided" : "from user's request"}${cur.why ? `: ${clip(cur.why, 100)}` : ""}`;
    for (const h of prev)
        s += `\n  rev ${h.rev} (${oneLine(h.at).slice(0, 10)}${decided(h)}): "${clip(h.desc, 120)}"`;
    return s;
}
/** Claims with more places than this list the healthy ones compactly unless the full view is asked for. */
const BRIEF_ABOVE = 8;
/** After a meaning change, this many stale places are shown in full; the rest are listed by file and id. */
const STALE_FULL = 5;
/** Places that need no attention and no wording shown: found where expected and confirmed. */
function isQuiet(r) {
    return !r.stale && r.acked === undefined && ["ok", "moved", "reformatted"].includes(r.status);
}
/** "README.md m1,m3; docs/a.md m7": ids grouped by file, no wording. */
function idsByFile(rs, withLine = false) {
    const byFile = new Map();
    for (const r of rs) {
        const label = withLine && r.line !== undefined ? `${r.mention.id}:${r.line}` : r.mention.id;
        byFile.set(r.mention.path, [...(byFile.get(r.mention.path) ?? []), label]);
    }
    return [...byFile].map(([p, ids]) => `${clip(p, 60)} ${ids.join(",")}`).join("; ");
}
export function formatClaimViews(views, view = "auto") {
    return views
        .map((v) => {
        const parts = [formatClaimHeader(v.claim)];
        const brief = view === "brief" || (view === "auto" && v.mentions.length > BRIEF_ABOVE);
        if (!v.mentions.length)
            parts.push("  (no mentions registered)");
        else if (!brief)
            parts.push(v.mentions.map((r) => mentionLine(r)).join("\n"));
        else {
            const quiet = v.mentions.filter(isQuiet);
            const loud = v.mentions.filter((r) => !isQuiet(r));
            if (loud.length)
                parts.push(loud.map((r) => mentionLine(r)).join("\n"));
            if (quiet.length)
                parts.push(`  ok (${quiet.length}, wording hidden: view "full" shows it): ${idsByFile(quiet, true)}`);
        }
        if (v.outputs.length)
            parts.push("  generated outputs:\n" + v.outputs.map(outputLine).join("\n"));
        return parts.join("\n");
    })
        .join("\n\n");
}
export function formatList(rows) {
    if (!rows.length)
        return "No claims yet. Add one with claim_add.";
    return rows
        .map((r) => `${r.claim.id.padEnd(24)} rev ${String(r.claim.rev).padEnd(3)} ${String(r.mentions).padStart(3)} mentions${r.issues ? `  ${r.issues} need attention` : ""}\n  ${clip(r.claim.desc, 140)}`)
        .join("\n");
}
function pendingSection(c) {
    const items = [
        ...c.mentionAcked.map((r) => `  ${r.claim}#${r.mention.id} ${r.mention.path}: ${clip(r.acked ?? "", 90)}`),
        ...c.outputAcked.map((o) => `  out:${o.output.id} ${o.output.path} (${o.status}): ${clip(o.acked ?? "", 90)}`),
    ];
    return items.length ? `Acknowledged, still pending (${items.length}):\n${items.join("\n")}` : undefined;
}
export function numbersSection(claims) {
    if (!claims.length)
        return undefined;
    return (`Numbers not tied to code (${claims.length}): a constant could change and nothing would notice. Find the constant that sets each number (grep) and register it: claim_add {id, mentions:[{path, kind:"code", anchor:"<declaration line>"}]}. If no code sets it (a guideline, a count in prose): claim_update {claim, no_code:"why"}\n` +
        claims.map((c) => `  ${c.id}: "${clip(c.desc, 100)}"`).join("\n"));
}
export function formatCheck(c) {
    const head = `${c.claims} claims, ${c.mentions} mentions, ${c.outputs} outputs checked.`;
    const pending = pendingSection(c);
    const numbers = numbersSection(c.unbackedNumbers);
    if (!c.mentionIssues.length && !c.outputIssues.length) {
        return [`${head} ${pending ? "No new issues." : "No issues."}`, pending, numbers].filter(Boolean).join("\n\n");
    }
    const parts = [head];
    if (c.mentionIssues.length)
        parts.push(`Mentions needing attention (${c.mentionIssues.length}):\n` + c.mentionIssues.map((r) => mentionLine(r, true)).join("\n"));
    if (c.outputIssues.length) {
        parts.push(`Generated outputs needing attention (${c.outputIssues.length}):\n` +
            c.outputIssues.map(outputLine).join("\n") +
            "\n  Do not regenerate without the user's approval. Ask, then regenerate and output action=record, or output action=ack with a note.");
    }
    if (pending)
        parts.push(pending);
    if (numbers)
        parts.push(numbers);
    return parts.join("\n\n");
}
export function formatUpdate(u) {
    const parts = [];
    if (u.meaning) {
        parts.push(`MEANING CHANGED (rev ${u.meaning.rev}, ${u.meaning.by === "user" ? "user decided" : "from user's request"}: ${clip(u.meaning.why, 100)}) — tell the user:\n` +
            `  ${u.claim.id}: "${oneLine(u.meaning.from)}"\n     → "${oneLine(u.meaning.to)}"`);
    }
    else
        parts.push(`${u.claim.id} rev ${u.claim.rev} (meaning unchanged)`);
    if (u.edits.length) {
        parts.push("edits:\n" + u.edits.map((e) => `  ${e.mention}: ${e.ok ? "ok" : "FAILED"} — ${e.message}`).join("\n"));
    }
    if (u.accepted) {
        parts.push(`accept_all: confirmed ${u.accepted.count} places${u.accepted.left.length ? `; left alone: ${u.accepted.left.join("; ")}` : ""}`);
    }
    if (u.meaning) {
        if (u.staleMentions.length) {
            // the first few in full, the rest by file and id: a claim with 19 places must not cost 19 blocks of context
            const shown = u.staleMentions.slice(0, STALE_FULL);
            const rest = u.staleMentions.slice(STALE_FULL);
            parts.push(`Still saying the old meaning (${u.staleMentions.length}) — update with edits[{mention, text}], or accept if still true (accept_all confirms every remaining place):\n` +
                shown.map((r) => mentionLine(r)).join("\n") +
                (rest.length ? `\n  +${rest.length} more, wording not shown: ${idsByFile(rest)} (claim_get {ids:["${u.claim.id}"], view:"full"})` : ""));
        }
        else
            parts.push("All mentions confirmed against the new meaning.");
        if (u.staleOutputs.length) {
            parts.push(`Generated from the old meaning (${u.staleOutputs.length}) — NOT regenerated. Ask the user before regenerating:\n` +
                u.staleOutputs.map(outputLine).join("\n"));
        }
        parts.push("If the user wants the earlier meaning back: claim_update {claim, revert: <rev>}.");
    }
    return parts.join("\n\n");
}
export function formatInFile(r) {
    const parts = [];
    parts.push(r.mentions.length ? `Claims mentioned in ${r.path}:\n${r.mentions.map((m) => mentionLine(m, true)).join("\n")}` : `No registered claims in ${r.path}.`);
    if (r.outputAt)
        parts.push(`${r.path} is a generated output:\n${outputLine(r.outputAt)}`);
    if (r.outputsFrom.length)
        parts.push(`Outputs generated from ${r.path}:\n${r.outputsFrom.map(outputLine).join("\n")}`);
    return parts.join("\n\n");
}
export function formatScan(path, hits) {
    if (!hits.length)
        return `No likely unregistered claim mentions in ${path}.`;
    return (`Possible unregistered mentions in ${path} (suggestions; register real ones with claim_add mentions):\n` +
        hits.map((h) => `  ${h.claim.padEnd(20)} line ${String(h.line).padEnd(5)} ${h.why}\n        "${clip(h.text, 160)}"`).join("\n"));
}
export function formatConfig(cfg) {
    return `tracking ${cfg.enabled ? "ON" : "OFF"} · stop hook: ${cfg.stop} · nudges: ${cfg.nudge ? "on" : "off"} · store ${cfg.share ? "committed to git (local/ ignored)" : "private (not committed)"}`;
}
