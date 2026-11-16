/**
 * Output rendering: human table and machine JSON.
 * Every output carries the jurisdiction caveat and the "not legal
 * advice" line - verdicts are heuristics, not legal opinions.
 */
import type { FileEvidence, Summary } from "./verdict.js";
import { SIGNALS_VERSION } from "./baseline.js";

export const LEGAL_FOOTER =
  "Verdicts are heuristics under US Copyright Office guidance (Part 2, 29 Jan 2025). " +
  "The UK and some other jurisdictions protect machine-generated works. Not legal advice.";

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export function renderHuman(results: FileEvidence[], summary: Summary): string {
  const lines: string[] = [];
  lines.push("file  verdict  human%  header  signals");
  for (const r of results) {
    const signals: string[] = [];
    if (r.agents.length > 0) signals.push(`agents:${r.agents.join(",")}`);
    if (r.markers.length > 0) signals.push(`markers:${r.markers.length}`);
    if (r.agentPath) signals.push("agent-path");
    if (r.attributionGap) signals.push("attribution-gap");
    if (!r.headerPresent) signals.push("no-header");
    lines.push(
      `${pad(r.file, 42)} ${pad(r.verdict, 11)} ${pad(String(Math.round(r.humanRatio * 100)), 6)} ${pad(r.headerPresent ? "yes" : "no", 6)} ${signals.join(" ") || "-"}`,
    );
  }
  lines.push("");
  lines.push(
    `summary: OWNABLE ${summary.ownable} | AT-RISK ${summary.atRisk} | ` +
      `UNPROTECTED ${summary.unprotected} | UNKNOWN ${summary.unknown} ` +
      `| attributable ${summary.attributablePct}% (${summary.total - summary.unknown}/${summary.total} files)`,
  );
  lines.push(LEGAL_FOOTER);
  return lines.join("\n");
}

export function renderJson(
  results: FileEvidence[],
  summary: Summary,
  version: string,
  repo: string,
): string {
  return (
    JSON.stringify(
      {
        tool: "owncode",
        version,
        signalsVersion: SIGNALS_VERSION,
        checkedAt: new Date().toISOString(),
        repo,
        summary,
        legalNote: LEGAL_FOOTER,
        files: results.map((r) => ({
          file: r.file,
          verdict: r.verdict,
          humanRatio: r.humanRatio,
          totalCommits: r.totalCommits,
          humanCommits: r.humanCommits,
          aiCommits: r.aiCommits,
          agents: r.agents,
          markers: r.markers,
          agentPath: r.agentPath,
          vendorPath: r.vendorPath,
          spdx: r.spdx,
          hasCopyright: r.hasCopyright,
          headerPresent: r.headerPresent,
          attributionGap: r.attributionGap,
          humanAfterAi: r.humanAfterAi,
          commitShas: r.commitShas,
          reasons: r.reasons,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}
