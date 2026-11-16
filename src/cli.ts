#!/usr/bin/env node
/**
 * owncode - audit a repository for AI-code ownership and licence provenance.
 *
 * Usage:
 *   owncode audit [path] [--json] [--since <ref>] [--config <file>]
 *           [--save-baseline <file>] [--all]
 *   owncode check --baseline <file> [--path <dir>] [--json]
 *   owncode diff <baseline-a> <baseline-b>
 *   owncode explain <file> [--path <dir>] [--json]
 *   owncode init
 *   owncode --help | --version
 *
 * Exit codes: 0 = no AT-RISK / UNPROTECTED file; 1 = >=1 risky file
 * (audit/check); 2 = usage error / not a git repo.
 * Verdicts are heuristics under US Copyright Office guidance
 * (Part 2, 29 Jan 2025). Not legal advice.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  diffBaselines,
  fixedRiskyFiles,
  loadBaseline,
  newRiskyFiles,
  saveBaseline,
  toBaseline,
} from "./baseline.js";
import {
  CONFIG_FILE,
  loadConfig,
  matchesIgnore,
  writeDefaultConfig,
  type OwncodeConfig,
} from "./config.js";
import { fileHistories, isGitRepo, listFiles, shortSha } from "./git.js";
import { parseTrailers } from "./signals.js";
import { renderHuman, renderJson, LEGAL_FOOTER } from "./report.js";
import { analyseFile, summarize, type FileEvidence } from "./verdict.js";

export const VERSION = "0.1.0";

function usage(): string {
  return [
    `owncode ${VERSION} - audit AI-code ownership and licence provenance`,
    "",
    "Usage:",
    "  owncode audit [path] [--json] [--since <ref>] [--config <file>]",
    "          [--save-baseline <file>] [--all]",
    "  owncode check --baseline <file> [--path <dir>] [--json]",
    "  owncode diff <baseline-a> <baseline-b>",
    "  owncode explain <file> [--path <dir>] [--json]",
    "  owncode init",
    "  owncode --help | --version",
    "",
    "Exit codes: 0 = no AT-RISK / UNPROTECTED file, 1 = >=1 risky file,",
    "  2 = usage error or not a git repo.",
    LEGAL_FOOTER,
    "See https://github.com/techdevfun/owncode for the verdict rules.",
  ].join("\n");
}

function failUsage(message: string): never {
  console.error(`error: ${message}`);
  console.error(usage());
  process.exit(2);
}

interface Flags {
  positional: string[];
  json: boolean;
  all: boolean;
  since?: string;
  config?: string;
  saveBaseline?: string;
  baseline?: string;
  path?: string;
}

function parseFlags(args: string[], allowed: Set<string>): Flags {
  const f: Flags = { positional: [], json: false, all: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") f.json = true;
    else if (a === "--all") f.all = true;
    else if (
      a === "--since" ||
      a === "--config" ||
      a === "--save-baseline" ||
      a === "--baseline" ||
      a === "--path"
    ) {
      if (!allowed.has(a)) failUsage(`flag ${a} is not valid here`);
      const v = args[++i];
      if (v === undefined || v.startsWith("--"))
        failUsage(`flag ${a} needs a value`);
      if (a === "--since") f.since = v;
      else if (a === "--config") f.config = v;
      else if (a === "--save-baseline") f.saveBaseline = v;
      else if (a === "--baseline") f.baseline = v;
      else if (a === "--path") f.path = v;
    } else if (a.startsWith("--")) {
      failUsage(`unknown flag: ${a}`);
    } else {
      f.positional.push(a);
    }
  }
  return f;
}

/** Read a file as text, or null when binary / unreadable. */
function readTextOrNull(abs: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(abs);
  } catch {
    return null;
  }
  if (buf.length === 0) return "";
  if (buf.subarray(0, 8192).includes(0)) return null; // binary
  return buf.toString("utf8");
}

interface AuditOutcome {
  results: FileEvidence[];
  capped: boolean;
  scanned: number;
  total: number;
}

function runAudit(
  root: string,
  config: OwncodeConfig,
  since?: string,
  all = false,
): AuditOutcome {
  if (!isGitRepo(root)) {
    console.error(`error: not a git repository: ${root}`);
    process.exit(2);
  }
  let files = listFiles(root).filter((f) => !matchesIgnore(f, config.ignore));
  const total = files.length;
  let capped = false;
  if (!all && config.maxFiles > 0 && files.length > config.maxFiles) {
    files = files.slice(0, config.maxFiles);
    capped = true;
  }
  const histories = fileHistories(root, since);
  const results = files.map((file) =>
    analyseFile({
      file,
      commits: histories.get(file) ?? [],
      content: readTextOrNull(join(root, file)),
      root,
      extraMarkers: config.extraMarkers,
    }),
  );
  return { results, capped, scanned: files.length, total };
}

function capNote(o: AuditOutcome): string {
  return `note: scanned ${o.scanned} of ${o.total} tracked files (cap ${o.scanned}; re-run with --all to scan all files)`;
}

function cmdAudit(args: string[]): void {
  const f = parseFlags(
    args,
    new Set(["--json", "--since", "--config", "--save-baseline", "--all"]),
  );
  if (f.positional.length > 1) failUsage("audit takes at most one path");
  const root = resolve(f.positional[0] ?? ".");
  let config: OwncodeConfig;
  try {
    config = loadConfig(root, f.config).config;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  let outcome: AuditOutcome;
  try {
    outcome = runAudit(root, config, f.since, f.all);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  const summary = summarize(outcome.results);
  if (f.saveBaseline) {
    saveBaseline(f.saveBaseline, toBaseline(outcome.results, VERSION));
  }
  if (f.json) {
    if (outcome.capped) console.error(capNote(outcome));
    process.stdout.write(renderJson(outcome.results, summary, VERSION, root));
  } else {
    let out = renderHuman(outcome.results, summary);
    if (outcome.capped) out += `\n${capNote(outcome)}`;
    console.log(out);
  }
  process.exit(summary.atRisk + summary.unprotected > 0 ? 1 : 0);
}

function cmdCheck(args: string[]): void {
  const f = parseFlags(args, new Set(["--json", "--baseline", "--path"]));
  if (!f.baseline) failUsage("check requires --baseline <file>");
  if (f.positional.length > 0) failUsage("check takes no positional argument");
  const root = resolve(f.path ?? ".");
  let baseline;
  try {
    baseline = loadBaseline(f.baseline);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  let config: OwncodeConfig;
  try {
    config = loadConfig(root, f.config).config;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  let outcome: AuditOutcome;
  try {
    outcome = runAudit(root, config, undefined, f.all);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  const fresh = newRiskyFiles(outcome.results, baseline);
  const fixed = fixedRiskyFiles(outcome.results, baseline);
  if (f.json) {
    process.stdout.write(
      JSON.stringify({ newRisky: fresh, fixed }, null, 2) + "\n",
    );
  } else if (fresh.length === 0) {
    console.log(
      "check: PASS - no new AT-RISK / UNPROTECTED files vs baseline.",
    );
    if (fixed.length > 0) {
      console.log(`fixed since baseline (${fixed.length}):`);
      for (const file of fixed) console.log(`  fixed: ${file}`);
    }
    console.log(LEGAL_FOOTER);
  } else {
    console.log(`check: FAIL - ${fresh.length} new risky file(s) vs baseline:`);
    for (const r of fresh) {
      console.log(
        `  ${r.verdict} ${r.file} (${r.reasons[0] ?? "no reason recorded"})`,
      );
    }
    if (fixed.length > 0) {
      console.log(`fixed since baseline (${fixed.length}):`);
      for (const file of fixed) console.log(`  fixed: ${file}`);
    }
    console.log(LEGAL_FOOTER);
  }
  process.exit(fresh.length > 0 ? 1 : 0);
}

function cmdDiff(args: string[]): void {
  const f = parseFlags(args, new Set());
  if (f.positional.length !== 2) failUsage("diff needs two baseline files");
  let a;
  let b;
  try {
    a = loadBaseline(f.positional[0]);
    b = loadBaseline(f.positional[1]);
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  const d = diffBaselines(a, b);
  console.log(
    `diff: added ${d.added.length} | worsened ${d.worsened.length} | fixed ${d.fixed.length} | unchanged ${d.unchanged.length}`,
  );
  for (const file of d.added) console.log(`  added: ${file}`);
  for (const file of d.worsened) console.log(`  worsened: ${file}`);
  for (const file of d.fixed) console.log(`  fixed: ${file}`);
  for (const file of d.unchanged) console.log(`  unchanged: ${file}`);
  process.exit(0);
}

function repoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    console.error(`error: not a git repository: ${cwd}`);
    process.exit(2);
  }
}

function cmdExplain(args: string[]): void {
  const f = parseFlags(args, new Set(["--json", "--path"]));
  if (f.positional.length !== 1) failUsage("explain needs one file");
  const root = resolve(f.path ?? process.cwd());
  const top = repoRoot(root);
  let config: OwncodeConfig;
  try {
    config = loadConfig(top, f.config).config;
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }
  // Resolve the file relative to the repo root, then relative to --path.
  let rel = f.positional[0];
  if (!existsSync(join(top, rel)) && existsSync(resolve(root, rel))) {
    rel = resolve(root, rel).slice(top.length + 1);
  }
  const histories = fileHistories(top);
  const evidence = analyseFile({
    file: rel,
    commits: histories.get(rel) ?? [],
    content: readTextOrNull(join(top, rel)),
    root: top,
    extraMarkers: config.extraMarkers,
  });
  if (f.json) {
    process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
    process.exit(0);
  }
  const lines: string[] = [];
  lines.push(`file: ${evidence.file}`);
  lines.push(`verdict: ${evidence.verdict}`);
  lines.push(
    `human ratio: ${Math.round(evidence.humanRatio * 100)}% (${evidence.humanCommits} human / ${evidence.totalCommits} commits, ${evidence.aiCommits} AI-attributed)`,
  );
  lines.push(`agents: ${evidence.agents.join(", ") || "none"}`);
  lines.push(
    `licence header: ${evidence.headerPresent ? "yes" : "no"}${evidence.spdx ? ` (SPDX: ${evidence.spdx})` : ""}`,
  );
  lines.push(`agent path: ${evidence.agentPath ? "yes" : "no"}`);
  lines.push(
    `vendored: ${evidence.vendorPath ? "yes" : "no"}${evidence.attributionGap ? " - attribution gap" : ""}`,
  );
  lines.push(`human edit after AI: ${evidence.humanAfterAi ? "yes" : "no"}`);
  lines.push("reasons:");
  for (const r of evidence.reasons) lines.push(`  - ${r}`);
  lines.push("evidence commits (newest first):");
  const commits = histories.get(rel) ?? [];
  if (commits.length === 0) {
    lines.push("  (no commits touch this file)");
  } else {
    for (const c of commits.slice(0, 10)) {
      const subject = c.message.split("\n")[0];
      lines.push(
        `  ${shortSha(c.sha)} ${c.authorName} <${c.authorEmail}> - ${subject}`,
      );
      for (const t of parseTrailers(c.message)) {
        if (t.agent !== null) lines.push(`    ${t.key}: ${t.value}`);
      }
    }
  }
  if (evidence.markers.length > 0) {
    lines.push("markers:");
    for (const m of evidence.markers) {
      lines.push(`  line ${m.line} [${m.pattern}]: ${m.text}`);
    }
  }
  lines.push(LEGAL_FOOTER);
  console.log(lines.join("\n"));
  process.exit(0);
}

function cmdInit(): void {
  const root = process.cwd();
  if (writeDefaultConfig(root)) {
    console.log(`wrote ${CONFIG_FILE} with default policy.`);
    process.exit(0);
  }
  console.error(`error: ${CONFIG_FILE} already exists in ${root}`);
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    process.exit(0);
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`owncode ${VERSION}`);
    process.exit(0);
  }
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "audit":
      cmdAudit(rest);
      break;
    case "check":
      cmdCheck(rest);
      break;
    case "diff":
      cmdDiff(rest);
      break;
    case "explain":
      cmdExplain(rest);
      break;
    case "init":
      if (rest.length > 0) failUsage("init takes no arguments");
      cmdInit();
      break;
    default:
      failUsage(`unknown command: ${cmd}`);
  }
}

main();
