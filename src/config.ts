/**
 * owncode.config.json - policy for the audit (blueprint section 5).
 * `init` writes the defaults; `audit`/`check`/`explain` load them.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_NAMES } from "./signals.js";

export interface OwncodeConfig {
  version: number;
  /** Glob-ish ignore patterns (see matchesIgnore). */
  ignore: string[];
  /** Extra agent names recognised in trailers and author identities. */
  agentNames: string[];
  /** Extra regex strings scanned as AI markers in file content. */
  extraMarkers: string[];
  /** SPDX ids treated as a licence header being present (informational). */
  allowedLicences: string[];
  /** Max files scanned per audit (0 = no cap). */
  maxFiles: number;
}

export const CONFIG_FILE = "owncode.config.json";

export const DEFAULT_CONFIG: OwncodeConfig = {
  version: 1,
  ignore: [
    "node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    ".git/**",
    "*.min.js",
    "*.min.css",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ],
  agentNames: [...AGENT_NAMES],
  extraMarkers: [],
  allowedLicences: [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "CC0-1.0",
    "GPL-2.0",
    "GPL-2.0-only",
    "GPL-3.0",
    "GPL-3.0-only",
    "LGPL-2.1",
    "LGPL-3.0",
    "AGPL-3.0",
    "MPL-2.0",
    "Unlicense",
    "0BSD",
  ],
  maxFiles: 2000,
};

export function defaultConfigText(): string {
  return JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n";
}

/** Load config from `explicit` path or `<root>/owncode.config.json`. */
export function loadConfig(
  root: string,
  explicit?: string,
): { config: OwncodeConfig; path: string | null } {
  const path = explicit ?? join(root, CONFIG_FILE);
  if (!existsSync(path)) {
    return { config: structuredClone(DEFAULT_CONFIG), path: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`invalid JSON in config file: ${path}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`config file must be a JSON object: ${path}`);
  }
  const merged: OwncodeConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(parsed as Partial<OwncodeConfig>),
  };
  return { config: merged, path };
}

/** Write the default config; returns false when one already exists. */
export function writeDefaultConfig(root: string): boolean {
  const path = join(root, CONFIG_FILE);
  if (existsSync(path)) return false;
  writeFileSync(path, defaultConfigText(), "utf8");
  return true;
}

/** Minimal glob match: dir-slash-star-star, star-dot-ext, exact path. */
export function matchesIgnore(path: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) continue;
    if (p.endsWith("/**")) {
      const dir = p.slice(0, -3);
      if (path === dir || path.startsWith(dir + "/")) return true;
    } else if (p.startsWith("**/")) {
      const tail = p.slice(3);
      if (path.endsWith("/" + tail) || path === tail) return true;
    } else if (p.startsWith("*.")) {
      if (path.endsWith(p.slice(1))) return true;
    } else if (path === p) {
      return true;
    }
  }
  return false;
}
