/**
 * Rule-based detection for skill content.
 * Outputs: scanTags[], riskLevel, securityScore (0-100).
 *
 * Optimizations:
 * - Total penalty is capped (MAX_TOTAL_PENALTY) so a few medium-risk tags don't push score to 0.
 * - riskLevel is driven by the single highest-severity tag, not by score.
 * - Patterns that often appear in docs (e.g. fetch, writeFile) use lower penalties to reduce false positives.
 * - Global regex lastIndex is reset per run so rules are safe to reuse across many skills.
 */

const SKILL_MD_MAX_LENGTH = 500 * 1024; // 500KB max to scan
const MAX_TOTAL_PENALTY = 50; // cap so securityScore stays in [50, 100] when any finding

// Patterns: tag, riskLevel (for riskLevel output), scorePenalty (capped sum for securityScore).
// Order does not matter; each pattern contributes at most once per run.
const PATTERNS = [
  {
    tag: "prompt-injection",
    riskLevel: "high",
    scorePenalty: 28,
    regex: /\b(ignore\s+(all\s+)?(previous|above|prior)\s+instructions?|disregard\s+instructions?|override\s+system\s+prompt|jailbreak|bypass\s+safety)\b/gi,
  },
  {
    tag: "dangerous-shell",
    riskLevel: "high",
    scorePenalty: 30,
    regex: /\b(rm\s+-rf\s+[\w/.-]+|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh|eval\s*\(|exec\s*\(|child_process|spawn\s*\(|\.exec\s*\(|subprocess\.run|os\.system)\b/gi,
  },
  {
    tag: "file-system-write",
    riskLevel: "medium",
    scorePenalty: 10,
    regex: /\b(writeFile|writeFileSync|fs\.write|appendFile|createWriteStream|open\s*\([^)]*["']w|\.env|\.ssh|passwd|shadow|sudo)\b/gi,
  },
  {
    tag: "network-call",
    riskLevel: "medium",
    scorePenalty: 6,
    regex: /\b(fetch\s*\(|axios\.|http\.request|https\.request|WebSocket|sendBeacon|navigator\.sendBeacon)\b/gi,
  },
  {
    tag: "obfuscation",
    riskLevel: "medium",
    scorePenalty: 20,
    regex: /\b(eval\s*\(\s*atob|Function\s*\(\s*["']|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|charCodeAt\s*\(\s*\)\s*\.map)\b/gi,
  },
  {
    tag: "credential-access",
    riskLevel: "high",
    scorePenalty: 25,
    regex: /\b(process\.env\.|getenv|AWS_SECRET|API_KEY|password\s*=\s*|token\s*=\s*|\.pem|privateKey|PRIVATE_KEY)\b/gi,
  },
];

/**
 * Run rules on skill markdown (and optionally other file contents).
 * @param {string} skillMd - SKILL.md content
 * @param {Map<string, Buffer>} [files] - Optional other files (key = path)
 * @returns {{ scanTags: string[], riskLevel: string, securityScore: number }}
 */
export function runRules(skillMd, files = new Map()) {
  const text = typeof skillMd === "string" ? skillMd : "";
  let content = text.slice(0, SKILL_MD_MAX_LENGTH);
  if (files.size > 0) {
    for (const [, buf] of files) {
      if (content.length >= SKILL_MD_MAX_LENGTH) break;
      try {
        content += "\n" + buf.toString("utf-8").slice(0, 50000);
      } catch {
        // skip binary
      }
    }
  }

  const scanTags = new Set();
  let totalPenalty = 0;
  let maxRiskRank = 0; // 0 low, 1 medium, 2 high, 3 critical

  const levelRank = { low: 0, medium: 1, high: 2, critical: 3 };

  for (const { tag, riskLevel, scorePenalty, regex } of PATTERNS) {
    regex.lastIndex = 0; // reset global regex so test() is correct when reused across skills
    if (regex.test(content)) {
      scanTags.add(tag);
      totalPenalty += scorePenalty;
      const rank = levelRank[riskLevel] ?? 0;
      if (rank > maxRiskRank) maxRiskRank = rank;
    }
  }

  if (scanTags.size === 0) {
    scanTags.add("safe");
  }

  const cappedPenalty = Math.min(totalPenalty, MAX_TOTAL_PENALTY);
  const securityScore = Math.max(0, Math.min(100, 100 - cappedPenalty));
  const riskLevel =
    maxRiskRank >= 3 ? "critical" : maxRiskRank >= 2 ? "high" : maxRiskRank >= 1 ? "medium" : "low";

  return {
    scanTags: Array.from(scanTags),
    riskLevel,
    securityScore,
  };
}
