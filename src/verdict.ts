/**
 * Verdict rules (blueprint section 5).
 *
 * OWNABLE     - human-authored, or human-edited after AI generation,
 *               licence header present, no attribution gap.
 * AT-RISK     - AI-attributed with no human edit after, OR licence header
 *               missing, OR third-party code without attribution.
 * UNPROTECTED - pure AI output: 100% of commits AI-attributed, no human
 *               author anywhere in the file history, no licence header.
 *               Under US Copyright Office guidance (Part 2, 29 Jan 2025)
 *               this file is likely uncopyrightable in the US. The UK and
 *               some other jurisdictions DO protect machine-generated
 *               works - the caveat travels with every verdict.
 * UNKNOWN     - history too thin to judge (no commits in range, or a
 *               single commit with no signals and no licence header).
 *
 * A human commit is evidence of a human touch, NOT proof of review
 * depth. owncode cannot verify how carefully a human reviewed AI output
 * and never claims otherwise.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Commit } from "./git.js";
import {
  detectLicenceHeader,
  detectMarkers,
  findAgentName,
  isAgentPath,
  isAiAuthor,
  isVendorPath,
  parseTrailers,
  vendorDirOf,
  type Marker,
} from "./signals.js";

export type Verdict = "OWNABLE" | "AT-RISK" | "UNPROTECTED" | "UNKNOWN";

export interface FileEvidence {
  file: string;
  verdict: Verdict;
  /** Share of commits touching the file that are human-authored (0-1). */
  humanRatio: number;
  totalCommits: number;
  humanCommits: number;
  aiCommits: number;
  /** Agent names seen in trailers/authors/markers (sorted, unique). */
  agents: string[];
  markers: Marker[];
  agentPath: boolean;
  vendorPath: boolean;
  spdx: string | null;
  hasCopyright: boolean;
  headerPresent: boolean;
  attributionGap: boolean;
  /** Human commit exists after the most recent AI-attributed commit. */
  humanAfterAi: boolean;
  /** Commit SHAs behind the verdict, newest first (max 10). */
  commitShas: string[];
  reasons: string[];
}

const NOTICE_NAMES = [
  "NOTICE",
  "NOTICE.md",
  "NOTICE.txt",
  "ATTRIBUTION",
  "ATTRIBUTION.md",
  "LICENSE",
  "LICENSE.md",
  "LICENSE.txt",
  "COPYING",
];

/** True when a NOTICE / attribution / licence file sits near a vendored dir. */
export function hasAttributionNearby(root: string, file: string): boolean {
  const dir = vendorDirOf(file);
  if (!dir) return true; // not vendored: no gap by definition
  const candidates = [join(root, dir), join(root, dirname(dir))];
  for (const base of candidates) {
    for (const name of NOTICE_NAMES) {
      if (existsSync(join(base, name))) return true;
    }
  }
  return false;
}

export interface AnalyseInput {
  file: string;
  commits: Commit[];
  content: string | null; // null when the file cannot be read (binary/deleted)
  root: string;
  extraMarkers: string[];
}

/** Build the evidence record and verdict for one file. */
export function analyseFile(input: AnalyseInput): FileEvidence {
  const { file, commits, content, root, extraMarkers } = input;
  const agents = new Set<string>();
  let humanCommits = 0;
  let aiCommits = 0;
  // Index (newest-first) of the most recent AI-attributed commit, if any.
  let lastAiIndex = -1;
  // Index of the most recent human commit, if any.
  let firstHumanIndex = -1;

  commits.forEach((c, i) => {
    const trailers = parseTrailers(c.message);
    const aiTrailer = trailers.find((t) => t.agent !== null);
    const aiAuthor = isAiAuthor(c.authorName, c.authorEmail);
    if (aiTrailer) agents.add(aiTrailer.agent as string);
    if (aiAuthor) {
      const agent = findAgentName(`${c.authorName} ${c.authorEmail}`);
      if (agent) agents.add(agent);
    }
    if (aiTrailer || aiAuthor) {
      aiCommits++;
      if (lastAiIndex < 0) lastAiIndex = i;
    } else {
      humanCommits++;
      if (firstHumanIndex < 0) firstHumanIndex = i;
    }
  });

  const total = commits.length;
  const humanRatio = total === 0 ? 0 : humanCommits / total;
  // A human commit is "after AI" when it is newer than the newest AI commit.
  const humanAfterAi =
    lastAiIndex >= 0 && firstHumanIndex >= 0 && firstHumanIndex < lastAiIndex;

  const markers = content === null ? [] : detectMarkers(content, extraMarkers);
  for (const m of markers) {
    const agent = findAgentName(m.text);
    if (agent) agents.add(agent);
  }
  const header =
    content === null
      ? { spdx: null, hasCopyright: false }
      : detectLicenceHeader(content);
  const headerPresent = header.spdx !== null || header.hasCopyright;
  const agentPath = isAgentPath(file);
  const vendorPath = isVendorPath(file);
  const attributionGap = vendorPath && !hasAttributionNearby(root, file);
  const aiSignals = aiCommits > 0 || markers.length > 0 || agentPath;

  const reasons: string[] = [];
  let verdict: Verdict;
  if (total === 0) {
    verdict = "UNKNOWN";
    reasons.push("no commits touch this file in the scanned range");
  } else if (total === 1 && !aiSignals && !headerPresent) {
    verdict = "UNKNOWN";
    reasons.push(
      "single commit, no AI signals, no licence header - history too thin to judge",
    );
  } else if (humanCommits === 0 && aiSignals && !headerPresent) {
    verdict = "UNPROTECTED";
    reasons.push(
      "100% of commits are AI-attributed and no human author appears in this file's history",
    );
    reasons.push("no licence header");
    reasons.push(
      "under US Copyright Office guidance (Part 2, 29 Jan 2025) pure AI output is likely uncopyrightable in the US; the UK and some other jurisdictions protect machine-generated works",
    );
  } else if (attributionGap) {
    verdict = "AT-RISK";
    reasons.push(
      "vendored / third-party code with no NOTICE or attribution file nearby",
    );
  } else if (!headerPresent) {
    verdict = "AT-RISK";
    reasons.push("no licence header (no SPDX identifier, no copyright line)");
  } else if (aiSignals && !humanAfterAi) {
    verdict = "AT-RISK";
    reasons.push("AI-attributed with no human edit after the AI contribution");
  } else {
    verdict = "OWNABLE";
    if (aiCommits > 0) {
      reasons.push(
        "AI-assisted, but a human edited the file after the AI contribution",
      );
    } else {
      reasons.push("human-authored, licence header present");
    }
  }
  if (markers.length > 0) {
    reasons.push(
      `AI markers in file: ${markers.map((m) => m.pattern).join(", ")}`,
    );
  }
  if (agentPath) reasons.push("file sits on an agent-output path");

  return {
    file,
    verdict,
    humanRatio: Math.round(humanRatio * 100) / 100,
    totalCommits: total,
    humanCommits,
    aiCommits,
    agents: [...agents].sort(),
    markers,
    agentPath,
    vendorPath,
    spdx: header.spdx,
    hasCopyright: header.hasCopyright,
    headerPresent,
    attributionGap,
    humanAfterAi,
    commitShas: commits.slice(0, 10).map((c) => c.sha),
    reasons,
  };
}

export interface Summary {
  total: number;
  ownable: number;
  atRisk: number;
  unprotected: number;
  unknown: number;
  /** Share of files with a verdict other than UNKNOWN (0-100). */
  attributablePct: number;
}

export function summarize(results: FileEvidence[]): Summary {
  const total = results.length;
  const ownable = results.filter((r) => r.verdict === "OWNABLE").length;
  const atRisk = results.filter((r) => r.verdict === "AT-RISK").length;
  const unprotected = results.filter((r) => r.verdict === "UNPROTECTED").length;
  const unknown = results.filter((r) => r.verdict === "UNKNOWN").length;
  return {
    total,
    ownable,
    atRisk,
    unprotected,
    unknown,
    attributablePct:
      total === 0 ? 100 : Math.round(((total - unknown) / total) * 100),
  };
}

/** Risky verdicts fail the gate (exit 1). */
export function isRisky(v: Verdict): boolean {
  return v === "AT-RISK" || v === "UNPROTECTED";
}
