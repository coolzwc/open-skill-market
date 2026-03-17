/**
 * Rule-based detection for skill content.
 * Outputs: scanTags[], riskLevel, securityScore (0-100), qualityScore (0-100).
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
 * Supports detailed risk tracking for CLI display.
 * @param {string} skillMd - SKILL.md content
 * @param {Map<string, Buffer>} [files] - Optional other files (key = path)
 * @param {Object} [options] - Options object
 * @param {boolean} [options.detailLevel='basic'] - 'basic' (default) or 'detailed' (includes per-file risks)
 * @returns {{ scanTags: string[], riskLevel: string, securityScore: number, qualityScore: number, detectedRisks?: Object[] }}
 */
export function runRules(skillMd, files = new Map(), options = {}) {
  const { detailLevel = 'basic' } = options;
  const text = typeof skillMd === "string" ? skillMd : "";
  let content = text.slice(0, SKILL_MD_MAX_LENGTH);
  
  // Track per-file risks when detail level is set to 'detailed'
  const fileRisks = new Map(); // fileName -> { tags: Set, risks: Object[] }

  if (files.size > 0) {
    for (const [filePath, buf] of files) {
      if (content.length >= SKILL_MD_MAX_LENGTH && detailLevel !== 'detailed') break;
      try {
        const fileContent = buf.toString("utf-8");
        const fileSlice = fileContent.slice(0, 50000);
        content += "\n" + fileSlice;
        
        // Track per-file risks if detail level is detailed
        if (detailLevel === 'detailed') {
          if (!fileRisks.has(filePath)) {
            fileRisks.set(filePath, { tags: new Set(), risks: [] });
          }
          const fileData = fileRisks.get(filePath);
          analyzeContentForRisks(fileSlice, filePath, fileData);
        }
      } catch {
        // skip binary
      }
    }
  }

  const scanTags = new Set();
  let totalPenalty = 0;
  let maxRiskRank = 0; // 0 low, 1 medium, 2 high, 3 critical
  const detectedRisks = [];

  const levelRank = { low: 0, medium: 1, high: 2, critical: 3 };

  for (const { tag, riskLevel, scorePenalty, regex } of PATTERNS) {
    regex.lastIndex = 0; // reset global regex so test() is correct when reused across skills
    if (regex.test(content)) {
      scanTags.add(tag);
      totalPenalty += scorePenalty;
      const rank = levelRank[riskLevel] ?? 0;
      if (rank > maxRiskRank) maxRiskRank = rank;
      
      // Collect risk details if detailed mode
      if (detailLevel === 'detailed') {
        detectedRisks.push({ tag, riskLevel, scorePenalty });
      }
    }
  }

  if (scanTags.size === 0) {
    scanTags.add("safe");
  }

  const cappedPenalty = Math.min(totalPenalty, MAX_TOTAL_PENALTY);
  const securityScore = Math.max(0, Math.min(100, 100 - cappedPenalty));
  const riskLevel =
    maxRiskRank >= 3 ? "critical" : maxRiskRank >= 2 ? "high" : maxRiskRank >= 1 ? "medium" : "low";

  const qualityScore = computeQualityScore(text, files);

  const result = {
    scanTags: Array.from(scanTags),
    riskLevel,
    securityScore,
    qualityScore,
  };
  
  // Add detailed risks if requested
  if (detailLevel === 'detailed' && detectedRisks.length > 0) {
    result.detectedRisks = detectedRisks;
  }

  return result;
}

/**
 * Analyze file content for risks and track them per-file
 * @private
 */
function analyzeContentForRisks(fileContent, filePath, fileData) {
  for (const { tag, riskLevel, regex } of PATTERNS) {
    regex.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = regex.exec(fileContent)) !== null) {
      matches.push({
        tag,
        riskLevel,
        match: match[0],
        index: match.index,
      });
    }
    if (matches.length > 0) {
      fileData.tags.add(tag);
      for (const m of matches) {
        fileData.risks.push({
          file: filePath,
          tag: m.tag,
          riskLevel: m.riskLevel,
          match: m.match,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Quality score (0-100): aligned with skill-creator eval-viewer/generate_review.py
// and references/schemas.md — structure, description, content, organization, testability.
// Evals schema: evals/evals.json with evals[].expectations; grader outputs expectations[].text, passed, evidence.
// ---------------------------------------------------------------------------

const QUALITY_BODY_MAX = 100 * 1024;
const QUALITY_WEIGHTS = {
  structure: 0.25,
  description: 0.25,
  content: 0.25,
  organization: 0.15,
  testability: 0.1,
};

/** Check for evals.json in files and validate evals[].expectations (schemas.md evals.json). */
function parseEvalsFromFiles(files) {
  if (!files || typeof files.get !== "function") return null;
  const evalsPaths = ["evals/evals.json", "evals.json"];
  for (const key of files.keys()) {
    const normalized = key.replace(/\\/g, "/");
    if (evalsPaths.some((p) => normalized === p || normalized.endsWith("/" + p))) {
      try {
        const buf = files.get(key);
        const json = JSON.parse(buf.toString("utf-8"));
        if (Array.isArray(json.evals) && json.evals.length > 0) {
          const withExpectations = json.evals.filter(
            (e) => Array.isArray(e.expectations) && e.expectations.length > 0
          );
          return { count: json.evals.length, withExpectations: withExpectations.length };
        }
      } catch {
        // ignore parse errors
      }
      break;
    }
  }
  return null;
}

function getStructureScore(body) {
  const hasFrontmatter = /^---\s*\n[\s\S]*?\n---/.test(body);
  const hasName = /^name:\s*[\w-]+/m.test(body) || /\nname:\s*[\w-]+/m.test(body);
  const hasDesc =
    /^description:\s*.+/m.test(body) || /\ndescription:\s*(?:[\w\s]|\|[^\n]+)/m.test(body);
  const descMatch = body.match(/\ndescription:\s*(?:\|\s*\n)?([\s\S]*?)(?=\n\w+:|\n---|$)/);
  const descLen = descMatch ? descMatch[1].replace(/\s+/g, " ").trim().length : 0;
  const descOkLen =
    descLen > 0 && descLen <= 1024 && !/<|>/.test(descMatch ? descMatch[1] : "");
  const lineCount = (body.match(/\n/g) || []).length + 1;
  const lineScore = lineCount <= 500 ? 0.2 : lineCount <= 800 ? 0.1 : 0;
  const score =
    (hasFrontmatter ? 0.4 : 0) +
    (hasName ? 0.2 : 0) +
    (hasDesc ? 0.2 : 0) +
    (descOkLen ? 0.2 : 0) +
    lineScore;
  return Math.min(1, score);
}

function getDescriptionScore(body) {
  const descMatch = body.match(/\ndescription:\s*(?:\|\s*\n)?([\s\S]*?)(?=\n\w+:|\n---|$)/);
  const descText = (descMatch && descMatch[1]) || "";
  const triggerHint =
    /\b(when|use when|trigger|triggers on|when to use)\b/i.test(descText) ||
    /,.*(?:or|and)\s+/.test(descText);
  return 0.5 + (triggerHint ? 0.5 : 0);
}

function getContentScore(body) {
  const hasExample = /\b(example|Example|Input:|Output:)\b/.test(body);
  const hasTemplate = /\b(template|structure|format)\b/i.test(body);
  const mustCount = (body.match(/\b(MUST|ALWAYS|NEVER)\b/g) || []).length;
  const mustScore = mustCount <= 3 ? 0.5 : mustCount <= 8 ? 0.25 : 0;
  return (hasExample ? 0.25 : 0) + (hasTemplate ? 0.25 : 0) + mustScore;
}

function getOrganizationScore(body, filePaths) {
  const hasRefsInBody = /\breferences?\b/i.test(body);
  const hasRefsPath =
    filePaths && filePaths.some((p) => p.replace(/\\/g, "/").includes("references"));
  return hasRefsInBody || hasRefsPath ? 1 : 0.5;
}

/** Testability: evals/evals.json with expectations (schemas) or mentions in body (generate_review uses grading.json expectations). */
function getTestabilityScore(body, files) {
  const evalsData = parseEvalsFromFiles(files);
  if (evalsData && evalsData.withExpectations > 0) return 1;
  if (evalsData && evalsData.count > 0) return 0.7;
  const hasMention =
    /\b(evals?|expectations?|assertions?)\b/i.test(body) ||
    (files && [...files.keys()].some((p) => p.includes("evals")));
  return hasMention ? 0.5 : 0.3;
}

/**
 * Quality score 0-100 from skill-creator rules. Static heuristics only; no agent.
 * Aligned with skill-creator/eval-viewer/generate_review.py and references/schemas.md.
 */
function computeQualityScore(skillMd, files) {
  const raw = typeof skillMd === "string" ? skillMd : "";
  const body = raw.slice(0, QUALITY_BODY_MAX);
  const filePaths = files ? [...files.keys()] : [];

  const structure = getStructureScore(body);
  const description = getDescriptionScore(body);
  const content = getContentScore(body);
  const organization = getOrganizationScore(body, filePaths);
  const testability = getTestabilityScore(body, files);

  const quality =
    QUALITY_WEIGHTS.structure * structure +
    QUALITY_WEIGHTS.description * description +
    QUALITY_WEIGHTS.content * content +
    QUALITY_WEIGHTS.organization * organization +
    QUALITY_WEIGHTS.testability * testability;
  return Math.round(Math.max(0, Math.min(100, quality * 100)));
}
