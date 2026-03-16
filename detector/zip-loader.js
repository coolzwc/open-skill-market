/**
 * Load skill content from local zip cache or CDN.
 * Zip layout from crawler: skillName/SKILL.md (and other files).
 * All extraction is in-memory (no temp dirs), so no directory conflict for same-name skills from different repos.
 * Caller identifies skills by skill.id (owner/repo/path), which is globally unique.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILL_FILENAME = "SKILL.md";
const ZIPS_DIR = path.join(__dirname, "..", "market", "zips");
const ZIP_BASE_URL = process.env.ZIP_BASE_URL || "https://cdn.skillmarket.cc/zips";

/**
 * Get owner and repo from skill (compact format: skill.repo is "owner/repo").
 * @param {object} skill - Compact skill { id, name, repo, path }
 * @returns {{ owner: string, repo: string } | null}
 */
export function getOwnerRepo(skill) {
  const repo = skill.repo;
  if (!repo || typeof repo !== "string") return null;
  const parts = repo.split("/");
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Zip filename for a skill (matches crawler/r2-uploader).
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillName
 * @returns {string}
 */
export function zipFilename(owner, repo, skillName) {
  return `${owner}-${repo}-${skillName}.zip`;
}

/**
 * Try to read skill content from local zip or CDN.
 * @param {object} skill - Compact skill { id, name, repo, path }
 * @returns {Promise<{ skillMd: string, files: Map<string, Buffer> } | null>}
 *   - null if no zip available (local and CDN both failed)
 */
export async function loadSkillContent(skill) {
  const parsed = getOwnerRepo(skill);
  if (!parsed) return null;
  const { owner, repo } = parsed;
  const skillName = skill.name;
  const filename = zipFilename(owner, repo, skillName);

  // 1. Local zip cache
  const localPath = path.join(ZIPS_DIR, filename);
  try {
    await fs.access(localPath);
    return extractSkillFromZipPath(localPath, skillName);
  } catch {
    // not found locally
  }

  // 2. CDN download
  const url = `${ZIP_BASE_URL.replace(/\/$/, "")}/${filename}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return extractSkillFromZipBuffer(buf, skillName);
  } catch {
    return null;
  }
}

/**
 * Extract SKILL.md and other files from a zip file path.
 * @param {string} zipPath
 * @param {string} skillName
 * @returns {Promise<{ skillMd: string, files: Map<string, Buffer> } | null>}
 */
async function extractSkillFromZipPath(zipPath, skillName) {
  const zip = new AdmZip(zipPath);
  return extractSkillFromZip(zip, skillName);
}

/**
 * Extract from zip buffer.
 * @param {Buffer} buf
 * @param {string} skillName
 * @returns {{ skillMd: string, files: Map<string, Buffer> } | null}
 */
function extractSkillFromZipBuffer(buf, skillName) {
  const zip = new AdmZip(buf);
  return extractSkillFromZip(zip, skillName);
}

/**
 * Zip entries may be "skillName/SKILL.md" or "owner-repo-hash/skill/path/SKILL.md".
 * Find SKILL.md and read content; collect other text files for rules.
 */
function extractSkillFromZip(zip, skillName) {
  const entries = zip.getEntries();
  let skillMdContent = null;
  const files = new Map();

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, "/");
    const data = entry.getData();
    if (!Buffer.isBuffer(data)) continue;
    const basename = path.basename(name);
    if (basename === SKILL_FILENAME) {
      skillMdContent = data.toString("utf-8");
      files.set(name, data);
    } else {
      files.set(name, data);
    }
  }

  if (!skillMdContent) return null;
  return { skillMd: skillMdContent, files };
}
