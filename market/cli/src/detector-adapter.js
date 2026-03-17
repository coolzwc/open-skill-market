/**
 * Detector adapter for CLI: scan skill directories and remote skills.
 * Handles full directory traversal and invokes detector/rules.js for comprehensive scanning.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runRules } from "../../detector/rules.js";

const SCRIPT_EXTENSIONS = [".js", ".py", ".sh", ".rb", ".ts", ".go", ".java", ".c", ".cpp", ".rs"];
const CONFIG_PATTERNS = [/^\.env/, /^config/, /\.conf$/, /\.json$/, /\.yaml$/, /\.yml$/];
const MAX_SCAN_SIZE = 10 * 1024 * 1024; // 10MB total scan limit
const MAX_FILE_SIZE = 1024 * 1024; // 1MB per file limit

/**
 * Get file extensions for a path
 * @param {string} filePath
 * @returns {string}
 */
function getFileExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * Determine if a file should be scanned for security risks
 * @param {string} filePath - Relative path within skill directory
 * @returns {boolean}
 */
function shouldScanFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  
  // Always scan SKILL.md, README
  if (normalized === "SKILL.md" || normalized === "README.md") return true;
  
  // Scan scripts
  const ext = getFileExtension(normalized);
  if (SCRIPT_EXTENSIONS.includes(ext)) return true;
  
  // Scan config files
  const basename = path.basename(normalized);
  if (CONFIG_PATTERNS.some(p => p.test(basename))) return true;
  
  return false;
}

/**
 * Scan a local skill directory for security and quality issues
 * @param {string} skillDir - Absolute path to skill directory
 * @param {Object} [options] - Options
 * @param {boolean} [options.detailed] - Return detailed per-file risks
 * @returns {Promise<{ securityScore: number, riskLevel: string, qualityScore: number, scanTags: string[], detectedRisks?: Object[] }>}
 */
export async function scanSkillDirectory(skillDir, options = {}) {
  const { detailed = false } = options;
  
  try {
    // Verify directory exists
    await fs.access(skillDir);
  } catch {
    throw new Error(`Skill directory not found: ${skillDir}`);
  }

  const files = new Map();
  let totalSize = 0;
  let skillMdContent = "";

  // Recursively collect files
  async function traverse(dir, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (totalSize >= MAX_SCAN_SIZE) break;
      
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if ([".git", ".next", "node_modules", "dist", "build"].includes(entry.name)) {
          continue;
        }
        await traverse(fullPath, relPath);
      } else if (entry.isFile()) {
        if (shouldScanFile(relPath)) {
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > MAX_FILE_SIZE) {
              // Skip very large files
              continue;
            }
            
            const content = await fs.readFile(fullPath);
            totalSize += content.length;
            
            // Extract SKILL.md for quality analysis
            if (relPath === "SKILL.md") {
              skillMdContent = content.toString("utf-8");
            }
            
            files.set(relPath, content);
          } catch {
            // Skip files we can't read
          }
        }
      }
    }
  }

  await traverse(skillDir);

  if (!skillMdContent && files.size === 0) {
    throw new Error(`No SKILL.md or scannable files found in ${skillDir}`);
  }

  // Run detection with detail level
  const detailLevel = detailed ? "detailed" : "basic";
  const result = runRules(skillMdContent, files, { detailLevel });

  return result;
}

/**
 * Scan a remote skill (from registry) by downloading and extracting
 * This is called by the CLI's remote skill installation flow
 * @param {Object} skill - Skill object from registry
 * @param {string} skillZipPath - Path to extracted skill directory
 * @param {Object} [options] - Options
 * @returns {Promise<{ securityScore: number, riskLevel: string, qualityScore: number, scanTags: string[], detectedRisks?: Object[] }>}
 */
export async function scanRemoteSkillExtracted(skillZipPath, options = {}) {
  return scanSkillDirectory(skillZipPath, options);
}

/**
 * Get human-readable description of risk level with icon/marker
 * @param {string} riskLevel - 'low', 'medium', 'high', 'critical'
 * @returns {string}
 */
export function getRiskLevelDisplay(riskLevel) {
  switch (riskLevel) {
    case "critical":
      return "🔴 Critical";
    case "high":
      return "🟠 High";
    case "medium":
      return "🟡 Medium";
    case "low":
    default:
      return "🟢 Low";
  }
}

/**
 * Get human-readable description of quality score grade
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
 * Format detected risks for console output
 * @param {Object[]} detectedRisks - Array of detected risks
 * @returns {string}
 */
export function formatDetectedRisks(detectedRisks) {
  if (!detectedRisks || detectedRisks.length === 0) {
    return "";
  }

  const grouped = {};
  for (const risk of detectedRisks) {
    if (!grouped[risk.tag]) {
      grouped[risk.tag] = {
        riskLevel: risk.riskLevel,
        count: 0,
        files: new Set(),
      };
    }
    grouped[risk.tag].count++;
    if (risk.file) {
      grouped[risk.tag].files.add(risk.file);
    }
  }

  const lines = [];
  for (const [tag, info] of Object.entries(grouped)) {
    const fileStr = info.files.size > 0 ? ` (in ${Array.from(info.files).join(", ")})` : "";
    lines.push(`  - ${tag} [${info.riskLevel}]${fileStr}`);
  }

  return lines.join("\n");
}
