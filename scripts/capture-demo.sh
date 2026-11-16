#!/usr/bin/env bash
# Capture the demo transcript from the REAL CLI (no hand-edited output).
# The fixture repo is SYNTHETIC, built here with real git commits, and
# labelled as such in the transcript and the README:
#   - src/handwritten.ts: human, SPDX header, 2 commits -> OWNABLE
#   - src/helper.ts: human author + Co-Authored-By: Claude trailer -> AT-RISK
#   - src/pure-ai.ts: author Claude + Generated-By trailer, no header -> UNPROTECTED
#   - vendor/legacy.js: vendored, no NOTICE file nearby -> AT-RISK
# Part 3 saves a baseline, adds one new pure-AI file, and shows the
# `check` CI gate failing (exit 1) on the NEW file only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH=/tmp/owncode-demo
BIN="$SCRATCH/bin"
rm -rf "$SCRATCH"
mkdir -p "$BIN" "$ROOT/demo"
ln -sf "$ROOT/dist/cli.js" "$BIN/owncode"
chmod +x "$ROOT/dist/cli.js"
export PATH="$BIN:$PATH"

WORK="$SCRATCH/fixture"
mkdir -p "$WORK/src" "$WORK/vendor"
cd "$WORK"
git init -q
git config user.name "Ada Lovelace"
git config user.email "ada@example.com"

HEADER='// SPDX-License-Identifier: MIT
// Copyright 2026 Example'

printf '%s\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n' "$HEADER" > src/handwritten.ts
git add -A
git -c user.name="Ada Lovelace" -c user.email="ada@example.com" commit -q -m "Add handwritten helper"
printf '%s\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a - b;\n}\n' "$HEADER" > src/handwritten.ts
git add -A
git -c user.name="Ada Lovelace" -c user.email="ada@example.com" commit -q -m "Extend handwritten helper"
printf '%s\nexport function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n' "$HEADER" > src/helper.ts
git add -A
git -c user.name="Ada Lovelace" -c user.email="ada@example.com" commit -q -m "Add helper

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
printf 'export function fib(n: number): number {\n  return n < 2 ? n : fib(n - 1) + fib(n - 2);\n}\n' > src/pure-ai.ts
git add -A
git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "Generate fib module

Generated-By: Claude Code"
printf '%s\nmodule.exports = { legacy: true };\n' "$HEADER" > vendor/legacy.js
git add -A
git -c user.name="Ada Lovelace" -c user.email="ada@example.com" commit -q -m "Vendor legacy lib"

OUT="$ROOT/demo/transcript.txt"
{
  echo "# owncode demo - real CLI output on a SYNTHETIC fixture repo"
  echo "# (fixture built with real git commits in this script; the repo"
  echo "#  is labelled synthetic - it is not a real project)"
  echo ""
  echo "\$ owncode audit ."
  owncode audit . || echo "exit: $?"
  echo ""
  echo "\$ owncode explain src/pure-ai.ts"
  owncode explain src/pure-ai.ts
  echo ""
  echo "# CI gate: save a baseline, add one new pure-AI file, re-check"
  echo "\$ owncode audit . --save-baseline baseline.json"
  owncode audit . --save-baseline "$SCRATCH/baseline.json" >/dev/null || true
  printf 'export const z = 1;\n' > src/new-ai.ts
  git add -A
  git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -q -m "Generate z

Generated-By: Claude Code"
  echo "\$ owncode check --baseline baseline.json"
  owncode check --baseline "$SCRATCH/baseline.json" || echo "exit: $?"
} > "$OUT" 2>&1

echo "transcript written: $OUT ($(wc -l < "$OUT") lines)"
