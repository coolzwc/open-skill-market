import fs from "fs/promises";
import path from "path";
import { __crawlerDirname } from "./config.js";

const CACHE_FILE = path.join(__crawlerDirname, ".crawler-cache.json");
const CACHE_VERSION = 1;

export class CrawlerCache {
  constructor() {
    this.version = CACHE_VERSION;
    this.skills = new Map(); // skill-level cache: owner/repo/path -> { commitHash, manifest, zipPath }
    this.repos = new Map(); // repo-level cache: owner/repo -> { commitHash, skillKeys, url, branch, stats, fetchedAt }
    this.pendingZips = new Set(); // cache keys of skills that still need zip generation (from timeout)
    this.isDirty = false;
  }

  /**
   * Load cache from file
   */
  async load() {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const json = JSON.parse(data);

      // Version mismatch - discard old cache
      if (json.version !== CACHE_VERSION) {
        console.log(
          `Cache version mismatch: found v${json.version}, expected v${CACHE_VERSION}. Starting fresh.`,
        );
        this._initEmpty();
        this.isDirty = true;
        return;
      }

      // Load data
      this.skills = json.skills
        ? new Map(Object.entries(json.skills))
        : new Map();
      this.repos = json.repos ? new Map(Object.entries(json.repos)) : new Map();
      this.pendingZips = Array.isArray(json.pendingZips)
        ? new Set(json.pendingZips)
        : new Set();

      console.log(
        `Loaded cache: ${this.skills.size} skills, ${this.repos.size} repos.`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to load cache:", error.message);
      }
      this._initEmpty();
    }
  }

  /**
   * Initialize empty cache
   */
  _initEmpty() {
    this.skills = new Map();
    this.repos = new Map();
    this.pendingZips = new Set();
  }

  /**
   * Save cache to file with version
   * Format unified with output-optimizer.js
   */
  async save() {
    if (!this.isDirty) return;

    try {
      // Serialize repos - unified format with output-optimizer.js
      // stats are flattened (stars, forks, lastUpdated at top level)
      const reposSerialized = Object.fromEntries(
        [...this.repos.entries()].map(([k, v]) => [
          k,
          {
            commitHash: v.commitHash,
            skillKeys: v.skillKeys ?? [],
            url: v.url,
            branch: v.branch || "main",
            stars: v.stats?.stars ?? 0,
            forks: v.stats?.forks ?? 0,
            lastUpdated: v.stats?.lastUpdated ?? null,
            fetchedAt: v.fetchedAt,
          },
        ]),
      );
      const json = {
        version: CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        repos: reposSerialized,
        skills: Object.fromEntries(this.skills),
        pendingZips: Array.from(this.pendingZips),
      };
      await fs.writeFile(CACHE_FILE, JSON.stringify(json, null, 2), "utf-8");
      console.log(
        `Saved cache v${CACHE_VERSION}: ${this.skills.size} skills, ${this.repos.size} repos.`,
      );
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to save cache:", error.message);
    }
  }

  /**
   * Clear all cache data
   */
  clear() {
    this.skills = new Map();
    this.repos = new Map();
    this.pendingZips = new Set();
    this.isDirty = true;
  }

  /**
   * Add a skill cache key to the pending zip queue (for next run priority)
   * @param {string} key - Skill cache key (owner/repo/path)
   */
  addPendingZip(key) {
    this.pendingZips.add(key);
    this.isDirty = true;
  }

  /**
   * Get all pending zip cache keys
   * @returns {Set<string>}
   */
  getPendingZips() {
    return this.pendingZips;
  }

  /**
   * Clear the pending zip queue
   */
  clearPendingZips() {
    this.pendingZips.clear();
    this.isDirty = true;
  }

  /**
   * Remove a single key from pending after successful processing
   * @param {string} key - Skill cache key
   */
  removePendingZip(key) {
    this.pendingZips.delete(key);
    this.isDirty = true;
  }

  /**
   * Get current cache version
   * @returns {number}
   */
  static getVersion() {
    return CACHE_VERSION;
  }

  // Skill-level cache methods
  getSkill(key) {
    return this.skills.get(key);
  }

  /**
   * Get skill with expanded manifest
   * @param {string} key - Skill cache key
   * @param {Object} repoStats - Optional stats to inject
   * @returns {Object|undefined}
   */
  getSkillExpanded(key, repoStats = null) {
    const cached = this.skills.get(key);
    if (!cached || !cached.manifest) return undefined;

    return {
      ...cached,
      manifest: CrawlerCache.expandManifest(cached.manifest, repoStats),
    };
  }

  /**
   * Set skill with compacted manifest
   * @param {string} key - Skill cache key
   * @param {Object} data - { commitHash, manifest, ... }
   */
  setSkill(key, data) {
    // Compact the manifest before storing
    const compactedData = {
      ...data,
      manifest: data.manifest
        ? CrawlerCache.compactManifest(data.manifest)
        : undefined,
    };
    this.skills.set(key, compactedData);
    this.isDirty = true;
  }

  // Repo-level cache methods
  // Returns { commitHash, skills: manifest[], stats, fetchedAt }. Skills are resolved from skillKeys via this.skills.
  // If we have skillKeys but some fail to resolve (missing from skills map), returns undefined so caller will re-crawl.
  // Manifests are expanded back to full format with stats injected from cached repo data.
  getRepo(owner, repo) {
    const key = `${owner}/${repo}`;
    const data = this.repos.get(key);
    if (!data) return undefined;

    // Use cached stats (flattened format, unified with output-optimizer.js)
    // Support both flattened (v3) and nested (migration) formats
    const repoStats = data.stats || {
      stars: data.stars ?? 0,
      forks: data.forks ?? 0,
      lastUpdated: data.lastUpdated ?? null,
    };
    const repoInfo = { url: data.url, branch: data.branch };

    if (Array.isArray(data.skillKeys)) {
      const skills = data.skillKeys
        .map((k) => {
          const cached = this.skills.get(k);
          if (!cached?.manifest) return null;
          // Expand manifest with cached stats and repo info
          return CrawlerCache.expandManifest(
            cached.manifest,
            repoStats,
            repoInfo,
          );
        })
        .filter(Boolean);
      // Cache valid only if we resolved all skillKeys (repo "has skills" or "has no skills" is reliable)
      if (skills.length !== data.skillKeys.length) return undefined;
      return {
        commitHash: data.commitHash,
        skills,
        stats: repoStats,
        url: data.url,
        branch: data.branch,
        fetchedAt: data.fetchedAt,
      };
    }
    return {
      commitHash: data.commitHash,
      skills: data.skills ?? [],
      stats: repoStats,
      url: data.url,
      branch: data.branch,
      fetchedAt: data.fetchedAt,
    };
  }

  /**
   * Set repo cache with stats for avoiding future API calls
   * Format unified with output-optimizer.js
   * @param {string} owner
   * @param {string} repo
   * @param {Object} data - { commitHash, skillKeys, url, branch, stats: { stars, forks, lastUpdated }, fetchedAt }
   */
  setRepo(owner, repo, data) {
    const key = `${owner}/${repo}`;
    const existing = this.repos.get(key) || {};

    // Normalize stats - support both nested and flattened formats
    const stats = data.stats || {
      stars: data.stars ?? existing.stats?.stars ?? 0,
      forks: data.forks ?? existing.stats?.forks ?? 0,
      lastUpdated: data.lastUpdated ?? existing.stats?.lastUpdated ?? null,
    };

    this.repos.set(key, {
      ...existing,
      ...data,
      stats,
    });
    this.isDirty = true;
  }

  /**
   * Check if zip needs to be regenerated (based on commitHash change)
   * @param {string} key - Skill cache key
   * @param {string} currentCommitHash - Current commit hash
   * @returns {boolean}
   */
  needsZipRegeneration(key, currentCommitHash) {
    const cached = this.skills.get(key);
    if (!cached) return true;
    if (!cached.zipPath) return true;
    if (cached.commitHash !== currentCommitHash) return true;
    return false;
  }

  /**
   * Set zip path for a skill
   * @param {string} key - Skill cache key
   * @param {string} zipPath - Path to the zip file
   */
  setZipInfo(key, zipPath) {
    const cached = this.skills.get(key);
    if (cached) {
      cached.zipPath = zipPath;
      this.isDirty = true;
    }
  }

  /**
   * Get zip path for a skill
   * @param {string} key - Skill cache key
   * @returns {string|null} - zipPath or null
   */
  getZipInfo(key) {
    const cached = this.skills.get(key);
    if (cached && cached.zipPath) {
      return cached.zipPath;
    }
    return null;
  }

  /**
   * Generate a cache key for a skill file
   * @param {string} owner
   * @param {string} repo
   * @param {string} filePath
   * @returns {string}
   */
  static generateSkillKey(owner, repo, filePath) {
    return `${owner}/${repo}/${filePath}`;
  }

  /**
   * Compact a manifest for cache storage - unified format with output-optimizer.js
   * Uses repoId (owner/repo) instead of full repository object, stats stored in repos map
   * @param {Object} manifest - Full manifest
   * @returns {Object} - Compacted manifest
   */
  static compactManifest(manifest) {
    // Extract repoId from repository URL
    const match = manifest.repository?.url?.match(
      /github\.com\/([^/]+\/[^/]+)/,
    );
    const repoId = match ? match[1] : "";

    const compacted = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      categories: manifest.categories,
      // Flatten author to just name
      author:
        typeof manifest.author === "string"
          ? manifest.author
          : manifest.author?.name,
      // Use repoId instead of full repository object (unified with output-optimizer.js)
      repo: repoId,
      path: manifest.repository?.path,
    };

    // Only include commitHash if present
    if (manifest.commitHash) {
      compacted.commitHash = manifest.commitHash;
    }

    // Only include version if not default
    if (manifest.version && manifest.version !== "0.0.0") {
      compacted.version = manifest.version;
    }

    // Only include tags if not empty
    if (manifest.tags && manifest.tags.length > 0) {
      compacted.tags = manifest.tags;
    }

    // Only include compatibility if present
    if (manifest.compatibility) {
      compacted.compatibility = manifest.compatibility;
    }

    // Compact files: remove the skill path prefix
    if (manifest.files && manifest.files.length > 0) {
      const skillPath = manifest.repository?.path;
      compacted.files = manifest.files.map((file) => {
        const normalized = file.replace(/\\/g, "/");
        if (skillPath && normalized.startsWith(skillPath + "/")) {
          return normalized.substring(skillPath.length + 1);
        }
        return normalized;
      });
    }

    // Keep skillZipUrl if present
    if (manifest.skillZipUrl) {
      compacted.skillZipUrl = manifest.skillZipUrl;
    }

    return compacted;
  }

  /**
   * Expand a compacted manifest back to full format
   * @param {Object} compact - Compacted manifest
   * @param {Object} repoStats - Stats { stars, forks, lastUpdated } from repo cache
   * @param {Object} repoInfo - Optional repo info { url, branch } from repo cache
   * @returns {Object} - Full manifest
   */
  static expandManifest(compact, repoStats = null, repoInfo = null) {
    const authorName =
      typeof compact.author === "string"
        ? compact.author
        : compact.author?.name || "";
    const skillPath = compact.path;

    // repo is "owner/repo" string
    const [owner, repo] = (compact.repo || "").split("/");
    const repoUrl = repoInfo?.url || `https://github.com/${compact.repo}`;
    const branch = repoInfo?.branch || "main";

    const expanded = {
      id: compact.id,
      name: compact.name,
      displayName: CrawlerCache.generateDisplayName(compact.name),
      description: compact.description,
      categories: compact.categories,
      details: `https://github.com/${owner}/${repo}/blob/${branch}/${skillPath}/SKILL.md`,
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
        branch,
        path: skillPath,
        downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
      },
      files: (compact.files || []).map((f) =>
        f.includes("/") || f.startsWith(skillPath) ? f : `${skillPath}/${f}`,
      ),
      stats: repoStats || { stars: 0, forks: 0, lastUpdated: null },
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
  static generateDisplayName(name) {
    if (!name) return "Unknown Skill";
    return name
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }
}

export const crawlerCache = new CrawlerCache();
