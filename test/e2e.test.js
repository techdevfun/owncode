/**
 * E2E tests: real git repos built in tmp with real commits.
 * Exercises the CLI end to end: audit exit codes, --json shape,
 * check/diff flows, explain output, init.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const HEADER = "// SPDX-License-Identifier: MIT\n// Copyright 2026 Example\n";

function git(dir, ...args) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

function commit(dir, message, name, email) {
  git(dir, "add", "-A");
  execFileSync(
    "git",
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "commit",
      "-q",
      "-m",
      message,
    ],
    { cwd: dir, stdio: "pipe" },
  );
}

function runCli(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

/** The seeded demo-shape repo: OWNABLE + AT-RISK + UNPROTECTED + vendor gap. */
function seedMixedRepo() {
  const dir = mkdtempSync(join(tmpdir(), "owncode-e2e-"));
  git(dir, "init", "-q");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "vendor"), { recursive: true });
  writeFileSync(
    join(dir, "src", "handwritten.ts"),
    HEADER +
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  );
  commit(dir, "Add handwritten helper", "Ada Lovelace", "ada@example.com");
  writeFileSync(
    join(dir, "src", "handwritten.ts"),
    HEADER +
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n",
  );
  commit(dir, "Extend handwritten helper", "Ada Lovelace", "ada@example.com");
  writeFileSync(
    join(dir, "src", "helper.ts"),
    HEADER +
      "export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n",
  );
  commit(
    dir,
    "Add helper\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>",
    "Ada Lovelace",
    "ada@example.com",
  );
  writeFileSync(
    join(dir, "src", "pure-ai.ts"),
    "export function fib(n: number): number {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n",
  );
  commit(
    dir,
    "Generate fib module\n\nGenerated-By: Claude Code",
    "Claude",
    "noreply@anthropic.com",
  );
  writeFileSync(
    join(dir, "vendor", "legacy.js"),
    HEADER + "module.exports = { legacy: true };\n",
  );
  commit(dir, "Vendor legacy lib", "Ada Lovelace", "ada@example.com");
  return dir;
}

function seedCleanRepo() {
  const dir = mkdtempSync(join(tmpdir(), "owncode-e2e-"));
  git(dir, "init", "-q");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), HEADER + "export const x = 1;\n");
  commit(dir, "Add a", "Ada Lovelace", "ada@example.com");
  writeFileSync(
    join(dir, "src", "a.ts"),
    HEADER + "export const x = 1;\nexport const y = 2;\n",
  );
  commit(dir, "Extend a", "Ada Lovelace", "ada@example.com");
  return dir;
}

test("e2e: mixed repo audit exits 1 with all four verdicts", () => {
  const dir = seedMixedRepo();
  const r = runCli(dir, "audit", ".");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /src\/handwritten\.ts\s+OWNABLE/);
  assert.match(r.stdout, /src\/helper\.ts\s+AT-RISK/);
  assert.match(r.stdout, /src\/pure-ai\.ts\s+UNPROTECTED/);
  assert.match(r.stdout, /vendor\/legacy\.js\s+AT-RISK/);
  assert.match(r.stdout, /attributable 100%/);
  assert.match(r.stdout, /Not legal advice/);
});

test("e2e: clean repo audit exits 0", () => {
  const dir = seedCleanRepo();
  const r = runCli(dir, "audit", ".");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OWNABLE 1/);
});

test("e2e: not a git repo exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "owncode-e2e-"));
  const r = runCli(dir, "audit", ".");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a git repository/);
});

test("e2e: --json shape carries evidence with commit SHAs", () => {
  const dir = seedMixedRepo();
  const r = runCli(dir, "audit", ".", "--json");
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.tool, "owncode");
  assert.equal(j.signalsVersion, 1);
  assert.equal(j.summary.total, 4);
  assert.equal(j.summary.unprotected, 1);
  const pure = j.files.find((f) => f.file === "src/pure-ai.ts");
  assert.equal(pure.verdict, "UNPROTECTED");
  assert.equal(pure.commitShas.length, 1);
  assert.match(pure.commitShas[0], /^[0-9a-f]{40}$/);
  assert.match(j.legalNote, /Not legal advice/);
});

test("e2e: check passes on a saved baseline, fails on a new risky file", () => {
  const dir = seedMixedRepo();
  const baseline = join(dir, "baseline.json");
  const save = runCli(dir, "audit", ".", "--save-baseline", baseline);
  assert.equal(save.status, 1);
  assert.ok(existsSync(baseline));
  const ok = runCli(dir, "check", "--baseline", baseline, "--path", dir);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS/);
  // Add a new pure-AI file: check must now fail on the NEW file only.
  writeFileSync(join(dir, "src", "new-ai.ts"), "export const z = 1;\n");
  commit(
    dir,
    "Generate z\n\nGenerated-By: Claude Code",
    "Claude",
    "noreply@anthropic.com",
  );
  const fail = runCli(dir, "check", "--baseline", baseline, "--path", dir);
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /new-ai\.ts/);
  assert.doesNotMatch(fail.stdout, /pure-ai\.ts/);
});

test("e2e: diff reports added and fixed findings", () => {
  const dir = seedMixedRepo();
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  runCli(dir, "audit", ".", "--save-baseline", a);
  // Fix the pure-AI file with a human rewrite + header, then re-baseline.
  writeFileSync(
    join(dir, "src", "pure-ai.ts"),
    HEADER +
      "export function fib(n: number): number {\n  let a = 0;\n  let b = 1;\n  for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; }\n  return a;\n}\n",
  );
  commit(dir, "Rewrite fib by hand", "Ada Lovelace", "ada@example.com");
  runCli(dir, "audit", ".", "--save-baseline", b);
  const r = runCli(dir, "diff", a, b);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /fixed 1/);
  assert.match(r.stdout, /fixed: src\/pure-ai\.ts/);
  assert.match(r.stdout, /unchanged 2/);
});

test("e2e: explain shows the evidence chain for the UNPROTECTED file", () => {
  const dir = seedMixedRepo();
  const r = runCli(dir, "explain", "src/pure-ai.ts", "--path", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verdict: UNPROTECTED/);
  assert.match(r.stdout, /human ratio: 0%/);
  assert.match(r.stdout, /Generated-By: Claude Code/);
  assert.match(r.stdout, /licence header: no/);
  assert.match(r.stdout, /Not legal advice/);
});

test("e2e: init writes a valid config and refuses a second time", () => {
  const dir = mkdtempSync(join(tmpdir(), "owncode-e2e-"));
  const first = runCli(dir, "init");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const cfg = JSON.parse(
    readFileSync(join(dir, "owncode.config.json"), "utf8"),
  );
  assert.equal(cfg.version, 1);
  assert.equal(cfg.maxFiles, 2000);
  const second = runCli(dir, "init");
  assert.equal(second.status, 2);
  assert.match(second.stderr, /already exists/);
});

test("e2e: --since limits history to the given range", () => {
  const dir = seedMixedRepo();
  // Range from the first commit: only the handwritten file's first commit
  // is in range, so it becomes UNKNOWN (single commit, no header? it HAS
  // a header, so it stays OWNABLE) - use the pure-ai file instead: with
  // --since at the helper commit, pure-ai has no commits in range.
  const firstSha = execFileSync(
    "git",
    ["rev-list", "--max-parents=0", "HEAD"],
    { cwd: dir, encoding: "utf8" },
  ).trim();
  const r = runCli(dir, "audit", ".", "--json", "--since", firstSha);
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  const pure = j.files.find((f) => f.file === "src/pure-ai.ts");
  assert.equal(pure.totalCommits, 1); // only its own commit is in range
  assert.equal(pure.verdict, "UNPROTECTED");
});

test("e2e: unknown command and missing baseline exit 2", () => {
  const dir = seedCleanRepo();
  const bad = runCli(dir, "frobnicate");
  assert.equal(bad.status, 2);
  const missing = runCli(
    dir,
    "check",
    "--baseline",
    join(dir, "nope.json"),
    "--path",
    dir,
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read baseline/);
});
