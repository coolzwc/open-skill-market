import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { __crawlerDirname } from "./config.js";

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a path exists
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List files recursively in a directory
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listFilesRecursive(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Load priority repositories from repositories.yml
 * @returns {Promise<string[]>} Array of repository full names (owner/repo)
 */
export async function loadPriorityRepos() {
  const reposPath = path.join(__crawlerDirname, "repositories.yml");
  try {
    const content = await fs.readFile(reposPath, "utf-8");
    const data = yaml.load(content);
    const repos = data?.priority || [];
    return repos.filter((r) => r && typeof r === "string" && r.includes("/"));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("Note: repositories.yml not found, skipping priority repos.");
      return [];
    }
    console.error(`Error loading repositories.yml: ${error.message}`);
    return [];
  }
}

/**
 * Generate display name from skill name
 * @param {string} name
 * @returns {string}
 */
export function generateDisplayName(name) {
  if (!name) return "Unknown Skill";
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Generate unique skill ID
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillPath
 * @returns {string}
 */
export function generateSkillId(owner, repo, skillPath) {
  if (skillPath && skillPath !== ".") {
    return `${owner}/${repo}/${skillPath}`;
  }
  return `${owner}/${repo}`;
}

/**
 * Determine the skill path from file path
 * @param {string} filePath
 * @returns {string}
 */
export function determineSkillPath(filePath) {
  const dir = path.dirname(filePath);
  return dir === "." ? "" : dir;
}

/**
 * Group search results by repository
 * @param {Array} searchResults
 * @returns {Map}
 */
export function groupByRepository(searchResults) {
  const repoGroups = new Map();

  for (const result of searchResults) {
    const repoFullName = result.repository.full_name;
    if (!repoGroups.has(repoFullName)) {
      repoGroups.set(repoFullName, {
        repository: result.repository,
        files: [],
      });
    }
    repoGroups.get(repoFullName).files.push(result);
  }

  return repoGroups;
}
