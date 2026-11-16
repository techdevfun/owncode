/**
 * Provenance signals (blueprint section 5, S1/S2/S3/S5/S6).
 *
 * All detection is local and heuristic: git trailers, in-file markers,
 * file paths, licence headers. No network, no LLM, no snippet database.
 * A marker in prose ("this function generates a report") is NOT an
 * AI marker - every pattern below requires an explicit AI attribution
 * phrase, a generation banner, or a trailer line.
 */

/** Agent names recognised in trailers, author identities and markers. */
export const AGENT_NAMES = [
  "claude",
  "chatgpt",
  "copilot",
  "codex",
  "gemini",
  "cursor",
  "openai",
  "gpt-4",
  "gpt-5",
  "anthropic",
  "windsurf",
  "aider",
  "continue",
  "codeium",
  "tabnine",
  "amazon q",
  "devin",
  "qwen",
  "deepseek",
  "grok",
  "llama",
  "mistral",
] as const;

/** Bot / agent mailboxes that mark a commit author as non-human. */
const AGENT_EMAILS = [
  "noreply@anthropic.com",
  "copilot@github.com",
  "noreply@openai.com",
  "noreply@github.com",
  "bot@",
  "[bot]",
];

export interface Trailer {
  key: string;
  value: string;
  /** Agent name found in the value, or null when it is not an AI trailer. */
  agent: string | null;
}

const TRAILER_KEYS = new Set(["co-authored-by", "generated-by"]);

/** Find the agent name inside a free-text value, or null. */
export function findAgentName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const name of AGENT_NAMES) {
    if (lower.includes(name)) return name;
  }
  if (lower.includes("noreply@anthropic.com")) return "claude";
  if (lower.includes("copilot@github.com")) return "copilot";
  return null;
}

/**
 * Parse commit-message trailers (S1). Only Co-Authored-By / Generated-By
 * lines count; Signed-off-by, Reviewed-by and human co-authors are ignored.
 * A trailer is AI-attributed only when its value names a known agent.
 */
export function parseTrailers(message: string): Trailer[] {
  const out: Trailer[] = [];
  for (const raw of message.split("\n")) {
    const m = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!TRAILER_KEYS.has(key)) continue;
    out.push({ key: m[1], value: m[2], agent: findAgentName(m[2]) });
  }
  return out;
}

/** True when a commit author identity is an agent/bot, not a person. */
export function isAiAuthor(name: string, email: string): boolean {
  const hay = `${name} <${email}>`.toLowerCase();
  if (findAgentName(hay)) return true;
  for (const e of AGENT_EMAILS) {
    if (hay.includes(e)) return true;
  }
  // Bare agent names used as the git author name (fixture + autonomous agents).
  const bare = name.trim().toLowerCase();
  return (AGENT_NAMES as readonly string[]).includes(bare);
}

export interface Marker {
  /** Short pattern id, stable across versions (used in JSON output). */
  pattern: string;
  line: number;
  text: string;
  /** True when the marker sits in the file header (first 40 lines). */
  inHeader: boolean;
}

interface MarkerRule {
  pattern: string;
  re: RegExp;
}

/**
 * In-file AI markers (S2). Each rule requires an explicit AI phrase or a
 * generation banner; the bare word "generated" never matches on its own,
 * so normal prose ("generates a report", "regenerated the cache") is safe.
 */
const MARKER_RULES: MarkerRule[] = [
  {
    pattern: "generated-by-agent",
    re: /generated\s+by\s+(an?\s+)?(ai|claude|chatgpt|copilot|codex|gemini|cursor|openai|llm)\b/i,
  },
  {
    pattern: "generated-with-agent",
    re: /generated\s+with\s+(claude|chatgpt|copilot|codex|gemini|cursor|openai|ai|llm)\b/i,
  },
  { pattern: "ai-generated", re: /\bai-?generated\b/i },
  { pattern: "co-authored-by", re: /co-authored-by\s*:/i },
  { pattern: "generated-by-trailer", re: /generated-by\s*:/i },
  { pattern: "do-not-edit-generated", re: /do not edit[^\n]{0,60}generated/i },
  { pattern: "generated-do-not-edit", re: /generated[^\n]{0,60}do not edit/i },
  {
    pattern: "file-was-generated",
    re: /this file (was|is|has been) generated/i,
  },
  { pattern: "auto-generated", re: /\bauto-?generated\b/i },
  { pattern: "machine-generated", re: /\bmachine-?generated\b/i },
  { pattern: "created-by-ai", re: /created\s+(by|with)\s+(an?\s+)?ai\b/i },
  { pattern: "written-by-ai", re: /written\s+by\s+(an?\s+)?ai\b/i },
];

/**
 * Scan file content for AI markers. `extraPatterns` are user-supplied
 * regex strings from owncode.config.json (invalid ones are skipped).
 * Returns one hit per matching line per rule, in file order.
 */
export function detectMarkers(
  content: string,
  extraPatterns: string[] = [],
): Marker[] {
  const rules = [...MARKER_RULES];
  for (const p of extraPatterns) {
    try {
      rules.push({ pattern: `config:${p}`, re: new RegExp(p, "i") });
    } catch {
      // Invalid user regex: skip it, never fail the audit.
    }
  }
  const lines = content.split("\n");
  const out: Marker[] = [];
  lines.forEach((line, i) => {
    for (const rule of rules) {
      if (rule.re.test(line)) {
        out.push({
          pattern: rule.pattern,
          line: i + 1,
          text: line.trim().slice(0, 120),
          inHeader: i < 40,
        });
        break; // one hit per line: the strongest rule wins
      }
    }
  });
  return out;
}

/** SPDX identifier and/or copyright line in the first 40 lines (S5). */
export function detectLicenceHeader(content: string): {
  spdx: string | null;
  hasCopyright: boolean;
} {
  const head = content.split("\n").slice(0, 40).join("\n");
  const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+-]+)/.exec(head);
  const hasCopyright =
    /copyright\s+(\u00a9|\(c\))?\s*\d{4}/i.test(head) ||
    /copyright\s+\u00a9/i.test(head);
  return { spdx: spdx ? spdx[1] : null, hasCopyright };
}

/** Agent-output paths (S3): .ai/ or agent/ dirs, .gen. / .ai. infixes. */
export function isAgentPath(path: string): boolean {
  const parts = path.split("/");
  if (
    parts.includes(".ai") ||
    parts.includes("agent") ||
    parts.includes("agents")
  ) {
    return true;
  }
  if (parts.includes("ai-generated") || parts.includes("generated"))
    return true;
  const base = parts[parts.length - 1];
  return (
    base.includes(".gen.") || base.includes(".ai.") || base.startsWith("gen-")
  );
}

/** Vendored / third-party paths (S6). */
export function isVendorPath(path: string): boolean {
  const parts = path.split("/");
  return parts.some((p) =>
    [
      "vendor",
      "third_party",
      "third-party",
      "thirdparty",
      "external",
      "deps",
    ].includes(p),
  );
}

/** Directory segments that own a vendored subtree, for the NOTICE check. */
export function vendorDirOf(path: string): string | null {
  const parts = path.split("/");
  const idx = parts.findIndex((p) =>
    [
      "vendor",
      "third_party",
      "third-party",
      "thirdparty",
      "external",
      "deps",
    ].includes(p),
  );
  if (idx < 0) return null;
  return parts.slice(0, idx + 1).join("/");
}
