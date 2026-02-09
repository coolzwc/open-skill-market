/**
 * Output optimization utilities for skills.json
 *
 * Compact mode removes redundant/derivable fields to reduce file size.
 * Fields that can be derived client-side are omitted.
 *
 * Optimizations:
 * 1. Extract shared repository info to a separate `repositories` object
 * 2. Remove derivable fields (displayName, author.url, author.avatar, etc.)
 * 3. Compact file paths to be relative to skill directory
 *
 * Derivation rules (for client-side reconstruction):
 * - displayName: capitalize each word of name, replace - with space
 * - author.url: `https://github.com/${author}`
 * - author.avatar: `https://github.com/${author}.png`
 * - repository.downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`
 * - details: `https://github.com/${owner}/${repo}/blob/${branch}/${path}/SKILL.md`
 */

import { CONFIG } from "./config.js";

/**
 * Extract repository ID from repository URL
 * @param {string} url - Repository URL like "https://github.com/owner/repo"
 * @returns {string} - Repository ID like "owner/repo"
 */
function getRepoId(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1] : url;
}

/**
 * Compact a single skill manifest by removing derivable fields
 * @param {Object} skill - Full skill manifest
 * @param {Map<string, Object>} reposMap - Map to collect repository info
 * @returns {Object} - Compacted skill manifest
 */
export function compactSkill(skill, reposMap = null) {
  const repoId = getRepoId(skill.repository.url);

  // Collect repository info if map is provided
  if (reposMap && !reposMap.has(repoId)) {
    reposMap.set(repoId, {
      url: skill.repository.url,
      branch: skill.repository.branch,
      stars: skill.stats.stars,
      forks: skill.stats.forks,
      lastUpdated: skill.stats.lastUpdated,
    });
  }

  const compacted = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    categories: skill.categories,
    author: skill.author.name || skill.author, // Flatten to just the name
    repo: repoId, // Reference to repository
    path: skill.repository.path, // Skill path within repo
  };

  // Only include commitHash if present and not empty
  if (skill.commitHash && skill.commitHash !== "local") {
    compacted.commitHash = skill.commitHash;
  }

  // Only include version if it's not the default "0.0.0"
  if (skill.version && skill.version !== "0.0.0") {
    compacted.version = skill.version;
  }

  // Only include tags if not empty
  if (skill.tags && skill.tags.length > 0) {
    compacted.tags = skill.tags;
  }

  // Only include compatibility if present
  if (skill.compatibility) {
    compacted.compatibility = skill.compatibility;
  }

  // Compact files: remove the skill path prefix from each file
  // e.g., "skills/pdf/SKILL.md" -> "SKILL.md"
  if (skill.files && skill.files.length > 0) {
    const skillPath = skill.repository.path;
    compacted.files = skill.files.map((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (skillPath && normalized.startsWith(skillPath + "/")) {
        return normalized.substring(skillPath.length + 1);
      }
      return normalized;
    });
  }

  // Include skillZipUrl if present (keep full URL for direct access)
  if (skill.skillZipUrl) {
    compacted.skillZipUrl = skill.skillZipUrl;
  }

  return compacted;
}

/**
 * Expand a compacted skill back to full format
 * Useful for client-side reconstruction
 * @param {Object} compact - Compacted skill manifest
 * @param {Object} repositories - Repository info map from compacted output
 * @param {string} zipBaseUrl - Base URL for zip files
 * @returns {Object} - Full skill manifest
 */
export function expandSkill(compact, repositories = {}, zipBaseUrl = CONFIG.zips.baseUrl) {
  // Get repository info from the repositories map or use inline data
  const repoInfo = repositories[compact.repo] || compact.repository || {};
  const repoUrl = repoInfo.url || `https://github.com/${compact.repo}`;
  const branch = repoInfo.branch || "main";
  const path = compact.path || compact.repository?.path || "";

  // Extract owner/repo
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  const [, owner, repo] = match || compact.repo?.split("/") || ["", ""];

  const authorName = typeof compact.author === "string" ? compact.author : compact.author?.name || owner;

  const expanded = {
    id: compact.id,
    name: compact.name,
    displayName: generateDisplayName(compact.name),
    description: compact.description,
    categories: compact.categories,
    details: `https://github.com/${owner}/${repo}/blob/${branch}/${path}/SKILL.md`,
    author: {
      name: authorName,
      url: `https://github.com/${authorName}`,
      avatar: `https://github.com/${authorName}.png`,
    },
    version: compact.version || "0.0.0",
    commitHash: compact.commitHash || "",
    tags: compact.tags || [],
    repository: {
      url: repoUrl,
      branch: branch,
      path: path,
      downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
    },
    files: (compact.files || []).map((f) =>
      f.startsWith(path) ? f : `${path}/${f}`
    ),
    stats: {
      stars: repoInfo.stars || 0,
      forks: repoInfo.forks || 0,
      lastUpdated: repoInfo.lastUpdated || null,
    },
  };

  if (compact.compatibility) {
    expanded.compatibility = compact.compatibility;
  }

  if (compact.skillZipUrl) {
    expanded.skillZipUrl = compact.skillZipUrl;
  }

  return expanded;
}

/**
 * Generate display name from skill name
 * @param {string} name
 * @returns {string}
 */
function generateDisplayName(name) {
  if (!name) return "Unknown Skill";
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Compact the entire output object
 * Extracts shared repository info to reduce duplication
 * @param {Object} output - Full output with meta and skills
 * @returns {Object} - Compacted output with repositories extracted
 */
export function compactOutput(output) {
  const reposMap = new Map();

  // Compact skills and collect repository info
  const compactedSkills = output.skills.map((skill) =>
    compactSkill(skill, reposMap)
  );

  // Convert repos map to object
  const repositories = Object.fromEntries(reposMap);

  return {
    meta: {
      ...output.meta,
      compact: true, // Flag to indicate compact format
    },
    repositories, // Shared repository info
    skills: compactedSkills,
  };
}

/**
 * Split compacted output into chunks by complete repository boundaries.
 * Same repo's skills are never split across chunks.
 *
 * When totalSkills <= chunkSize, returns a single chunk (no splitting).
 *
 * @param {Object} compactedOutput - Output from compactOutput()
 * @param {number} chunkSize - Max skills per chunk (default 500)
 * @returns {{ main: Object, chunks: Object[] }}
 *   main: first chunk with meta (including meta.chunks list if split)
 *   chunks: remaining chunks (may be empty)
 */
export function splitByRepo(compactedOutput, chunkSize = 500) {
  const { meta, repositories, skills } = compactedOutput;

  // No splitting needed
  if (!chunkSize || skills.length <= chunkSize) {
    return { main: compactedOutput, chunks: [] };
  }

  // Group skills by repo while preserving original order
  const repoGroups = [];
  const repoGroupMap = new Map();

  for (const skill of skills) {
    const repoId = skill.repo;
    if (!repoGroupMap.has(repoId)) {
      const group = { repoId, skills: [] };
      repoGroupMap.set(repoId, group);
      repoGroups.push(group);
    }
    repoGroupMap.get(repoId).skills.push(skill);
  }

  // Fill chunks by adding complete repo groups
  const allChunkSkills = [];
  let currentChunk = [];

  for (const group of repoGroups) {
    if (currentChunk.length > 0 && currentChunk.length + group.skills.length > chunkSize) {
      allChunkSkills.push(currentChunk);
      currentChunk = [];
    }
    currentChunk.push(...group.skills);
  }
  if (currentChunk.length > 0) {
    allChunkSkills.push(currentChunk);
  }

  // Build chunk objects, each with only its referenced repositories
  const chunkNames = allChunkSkills.slice(1).map((_, i) => `skills-${i + 1}.json`);

  function buildRepositories(chunkSkills) {
    const repos = {};
    for (const skill of chunkSkills) {
      if (repositories[skill.repo] && !repos[skill.repo]) {
        repos[skill.repo] = repositories[skill.repo];
      }
    }
    return repos;
  }

  // Main chunk (first)
  const main = {
    meta: {
      ...meta,
      ...(chunkNames.length > 0 ? { chunks: chunkNames } : {}),
    },
    repositories: buildRepositories(allChunkSkills[0]),
    skills: allChunkSkills[0],
  };

  // Remaining chunks
  const chunks = allChunkSkills.slice(1).map((chunkSkills) => ({
    repositories: buildRepositories(chunkSkills),
    skills: chunkSkills,
  }));

  return { main, chunks };
}

/**
 * Calculate size savings from compaction
 * @param {Object} original - Original output
 * @param {Object} compacted - Compacted output
 * @returns {Object} - Size statistics
 */
export function calculateSizeSavings(original, compacted) {
  const originalSize = JSON.stringify(original).length;
  const compactedSize = JSON.stringify(compacted).length;
  const saved = originalSize - compactedSize;
  const percentage = ((saved / originalSize) * 100).toFixed(1);

  return {
    originalSize,
    compactedSize,
    saved,
    percentage: `${percentage}%`,
  };
}
