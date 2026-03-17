/**
 * Formatting utilities for CLI output: tables, prompts, and risk information display.
 */

/**
 * Format scan results as a console table (TTY-friendly)
 * @param {Object[]} results - Array of scan result objects
 * @returns {string}
 */
export function formatScanTable(results) {
  if (!results || results.length === 0) {
    return "No skills found.";
  }

  // Calculate column widths (use max, not min)
  const cols = {
    name: Math.max(15, Math.min(25, Math.max(...results.map(r => (r.name || "").length), 15))),
    security: 10,
    quality: 8,
    risk: 12,
    tags: 30,
  };

  const lines = [];

  // Header
  const header = `${padRight("Skill Name", cols.name)} │ ${padRight("Security", cols.security)} │ ${padRight("Quality", cols.quality)} │ ${padRight("Risk Level", cols.risk)} │ ${padRight("Tags", cols.tags)}`;
  lines.push(header);
  lines.push("─".repeat(header.length));

  // Rows
  for (const result of results) {
    const name = truncate(result.name || "unknown", cols.name);
    const security = `${result.securityScore ?? "?"}/100`;
    const quality = `${result.qualityScore ?? "?"}/100`;
    const risk = getRiskBadge(result.riskLevel || "unknown");
    const tags = (result.scanTags || []).join(", ").slice(0, cols.tags);

    const row = `${padRight(name, cols.name)} │ ${padRight(security, cols.security)} │ ${padRight(quality, cols.quality)} │ ${padRight(risk, cols.risk)} │ ${tags}`;
    lines.push(row);
  }

  return lines.join("\n");
}

/**
 * Pad string to the right
 * @private
 */
function padRight(str, width) {
  const s = String(str).slice(0, width);
  return s + " ".repeat(Math.max(0, width - s.length));
}

/**
 * Truncate string to width with ellipsis
 * @private
 */
function truncate(str, width) {
  if (str.length <= width) return str;
  return str.slice(0, width - 3) + "...";
}

/**
 * Get colored/formatted risk level badge
 * @private
 */
function getRiskBadge(riskLevel) {
  switch (riskLevel) {
    case "critical":
      return "[CRITICAL]";
    case "high":
      return "[HIGH]";
    case "medium":
      return "[MEDIUM]";
    case "low":
    default:
      return "[LOW]";
  }
}

/**
 * Format security check prompt for interactive mode
 * @param {Object} result - Scan result object
 * @param {string} skillName - Skill name for display
 * @returns {string}
 */
export function formatSecurityPrompt(result, skillName) {
  const lines = [];
  lines.push(`\n⚠️  Security Check for "${skillName}"`);
  lines.push(`═══════════════════════════════════════`);
  lines.push(`Security Score: ${result.securityScore}/100 (${getRiskBadge(result.riskLevel)})`);
  lines.push(`Quality Score:  ${result.qualityScore}/100`);
  lines.push(`Risk Level:     ${result.riskLevel}`);

  if (result.scanTags && result.scanTags.length > 0) {
    lines.push(`\nDetected Issues:`);
    for (const tag of result.scanTags) {
      if (tag !== "safe") {
        lines.push(`  • ${tag}`);
      }
    }
  }

  lines.push(
    `\nContinue with installation? (y/n, or use --force to skip this prompt)`
  );

  return lines.join("\n");
}

/**
 * Format quality warning message
 * @param {Object} result - Scan result object
 * @param {string} skillName - Skill name for display
 * @returns {string}
 */
export function formatQualityWarning(result, skillName) {
  const grade = getQualityGrade(result.qualityScore);
  return `⚠️  [${skillName}] Quality score is ${grade} (${result.qualityScore}/100). Consider reviewing the skill before use.`;
}

/**
 * Get quality grade from score
 * @param {number} qualityScore - 0-100
 * @returns {string}
 */
export function getQualityGrade(qualityScore) {
  if (qualityScore >= 80) return "Excellent";
  if (qualityScore >= 70) return "Good";
  if (qualityScore >= 60) return "Average";
  if (qualityScore >= 50) return "Fair";
  return "Poor";
}

/**
 * Format summary info message (safe to install)
 * @param {Object} result - Scan result object
 * @param {string} skillName - Skill name for display
 * @returns {string}
 */
export function formatSecurityInfo(result, skillName) {
  const lines = [];
  lines.push(`✓ [${skillName}] Security check passed`);
  lines.push(`  Security: ${result.securityScore}/100 | Quality: ${result.qualityScore}/100`);
  return lines.join("\n");
}

/**
 * Format removal confirmation prompt
 * @param {string} skillName - Skill name for display
 * @param {string} skillPath - Full path to skill directory
 * @returns {string}
 */
export function formatRemovalPrompt(skillName, skillPath) {
  return `\n❓ Remove skill "${skillName}" from ${skillPath}? (y/n)`;
}

/**
 * Format removal success message
 * @param {string} skillName - Skill name for display
 * @returns {string}
 */
export function formatRemovalSuccess(skillName) {
  return `✓ Skill "${skillName}" removed successfully.`;
}

/**
 * Format scan result for JSON output
 * @param {Array} results - Array of scan results
 * @returns {Object}
 */
export function formatScanResultsJson(results) {
  return {
    command: "scan",
    timestamp: new Date().toISOString(),
    count: results.length,
    results: results.map((r) => ({
      name: r.name,
      id: r.id,
      securityScore: r.securityScore,
      qualityScore: r.qualityScore,
      riskLevel: r.riskLevel,
      scanTags: r.scanTags,
      detectedRisks: r.detectedRisks || null,
    })),
  };
}
