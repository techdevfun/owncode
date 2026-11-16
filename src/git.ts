/**
 * Git access: two passes over `git log`, no per-file processes.
 *
 * Pass 1 lists every commit (SHA, author, date, full message body).
 * Pass 2 lists every commit with the files it touched.
 * Joining on SHA gives per-file history in O(commits) git calls,
 * which keeps a 2,000-file audit fast (blueprint risk R6).
 */
import { execFileSync } from "node:child_process";

export class GitError extends Error {}

export interface Commit {
  sha: string;
  authorName: string;
  authorEmail: string;
  date: string;
  /** Full message (subject + body), newest commit first. */
  message: string;
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: unknown; message?: string };
    const detail =
      typeof e.stderr === "string" && e.stderr.trim()
        ? e.stderr.trim().split("\n")[0]
        : (e.message ?? "git failed");
    throw new GitError(`git ${args[0]} failed: ${detail}`);
  }
}

export function isGitRepo(path: string): boolean {
  try {
    runGit(path, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

/** Tracked files (respects .gitignore), sorted. */
export function listFiles(cwd: string): string[] {
  const out = runGit(cwd, ["ls-files"]);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

/**
 * All commits in range, newest first, with the files each commit touched.
 * `since` is a git revision (tag, branch, SHA); the range is `<since>..HEAD`.
 * Returns a map from file path to its commits (newest first) plus the
 * full commit list for callers that need it.
 */
export function fileHistories(
  cwd: string,
  since?: string,
): Map<string, Commit[]> {
  const range = since ? [`${since}..HEAD`] : [];
  // Pass 1: commits with full bodies. %x1f separates fields, %x1e ends
  // each commit record (bodies may contain newlines, never \x1e).
  const raw = runGit(cwd, [
    "log",
    ...range,
    "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e",
  ]);
  const commits = new Map<string, Commit>();
  for (const rec of raw.split("\x1e")) {
    const trimmed = rec.replace(/^\n+/, "");
    if (!trimmed.trim()) continue;
    const [head, ...rest] = trimmed.split("\x1f");
    if (!head || rest.length < 3) continue;
    const sha = head.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    commits.set(sha, {
      sha,
      authorName: rest[0],
      authorEmail: rest[1],
      date: rest[2],
      message: rest.slice(3).join("\x1f").replace(/\n$/, ""),
    });
  }
  // Pass 2: files per commit. Format line is the bare SHA; the lines
  // after it (until the next SHA or a blank line) are the touched files.
  const filesRaw = runGit(cwd, ["log", ...range, "--format=%H", "--name-only"]);
  const byFile = new Map<string, Commit[]>();
  let current: Commit | null = null;
  for (const line of filesRaw.split("\n")) {
    if (/^[0-9a-f]{40}$/.test(line)) {
      current = commits.get(line) ?? null;
      continue;
    }
    if (!line.trim() || !current) continue;
    const list = byFile.get(line) ?? [];
    list.push(current);
    byFile.set(line, list);
  }
  return byFile;
}

/** Short SHA for display. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
