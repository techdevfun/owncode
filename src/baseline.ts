/**
 * Baselines: `audit --save-baseline` writes one; `check` compares the
 * current audit against it and fails only on NEW risky files, so an
 * existing project can adopt the gate without fixing history first.
 * `diff` compares two baseline files.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { FileEvidence, Verdict } from "./verdict.js";
import { isRisky } from "./verdict.js";

export const SIGNALS_VERSION = 1;

export interface BaselineEntry {
  verdict: Verdict;
  humanRatio: number;
  signals: string[];
}

export interface Baseline {
  tool: "owncode";
  version: string;
  signalsVersion: number;
  checkedAt: string;
  files: Record<string, BaselineEntry>;
}

export function toBaseline(results: FileEvidence[], version: string): Baseline {
  const files: Record<string, BaselineEntry> = {};
  for (const r of results) {
    files[r.file] = {
      verdict: r.verdict,
      humanRatio: r.humanRatio,
      signals: [
        ...r.agents.map((a) => `agent:${a}`),
        ...r.markers.map((m) => `marker:${m.pattern}`),
        ...(r.agentPath ? ["agent-path"] : []),
        ...(r.vendorPath ? ["vendor-path"] : []),
        ...(r.headerPresent ? [] : ["no-licence-header"]),
      ],
    };
  }
  return {
    tool: "owncode",
    version,
    signalsVersion: SIGNALS_VERSION,
    checkedAt: new Date().toISOString(),
    files,
  };
}

export function saveBaseline(path: string, baseline: Baseline): void {
  writeFileSync(path, JSON.stringify(baseline, null, 2) + "\n", "utf8");
}

export function loadBaseline(path: string): Baseline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`cannot read baseline file: ${path}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Baseline).tool !== "owncode" ||
    typeof (parsed as Baseline).files !== "object"
  ) {
    throw new Error(`not an owncode baseline file: ${path}`);
  }
  return parsed as Baseline;
}

/** Risky now but not risky (or absent) in the baseline. */
export function newRiskyFiles(
  current: FileEvidence[],
  baseline: Baseline,
): FileEvidence[] {
  return current.filter((r) => {
    if (!isRisky(r.verdict)) return false;
    const prev = baseline.files[r.file];
    return !prev || !isRisky(prev.verdict);
  });
}

/** Risky in the baseline, no longer risky now (fixed, not failed). */
export function fixedRiskyFiles(
  current: FileEvidence[],
  baseline: Baseline,
): string[] {
  const now = new Map(current.map((r) => [r.file, r.verdict]));
  return Object.entries(baseline.files)
    .filter(
      ([file, entry]) =>
        isRisky(entry.verdict) && !isRisky(now.get(file) ?? "UNKNOWN"),
    )
    .map(([file]) => file);
}

export interface BaselineDiff {
  added: string[]; // new files, risky now
  worsened: string[]; // clean in A, risky in B
  fixed: string[]; // risky in A, clean in B
  unchanged: string[]; // same risky verdict in both
}

export function diffBaselines(a: Baseline, b: Baseline): BaselineDiff {
  const added: string[] = [];
  const worsened: string[] = [];
  const fixed: string[] = [];
  const unchanged: string[] = [];
  for (const [file, entry] of Object.entries(b.files)) {
    const prev = a.files[file];
    if (!prev) {
      if (isRisky(entry.verdict)) added.push(file);
      continue;
    }
    if (isRisky(entry.verdict) && !isRisky(prev.verdict)) worsened.push(file);
    else if (!isRisky(entry.verdict) && isRisky(prev.verdict)) fixed.push(file);
    else if (isRisky(entry.verdict)) unchanged.push(file);
  }
  // Files deleted between A and B are reported by neither side: a
  // deletion is not a fix, and counting it as one would flatter the diff.
  return {
    added: [...new Set(added)].sort(),
    worsened: [...new Set(worsened)].sort(),
    fixed: [...new Set(fixed)].sort(),
    unchanged: [...new Set(unchanged)].sort(),
  };
}
