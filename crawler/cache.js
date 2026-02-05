import fs from "fs/promises";
import path from "path";
import { __crawlerDirname } from "./config.js";

const CACHE_FILE = path.join(__crawlerDirname, ".crawler-cache.json");

/**
 * Cache version history:
 * - v1: Initial version with commitHash field in skill manifest, skill directory commit hash tracking
 * 
 * When making breaking changes to cache format, increment version and add migration logic.
 */
const CACHE_VERSION = 1;

/**
 * Cache migration strategies
 */
const MIGRATION_STRATEGY = {
  DISCARD: "discard",   // Discard old cache, start fresh
  MIGRATE: "migrate",   // Try to migrate old cache data
};

// Default strategy when cache version mismatch
const DEFAULT_MIGRATION_STRATEGY = MIGRATION_STRATEGY.MIGRATE;

export class CrawlerCache {
  constructor() {
    this.version = CACHE_VERSION;
    this.skills = new Map();      // skill-level cache: owner/repo/path -> { commitHash, manifest, zipHash, zipPath }
    this.repos = new Map();       // repo-level cache: owner/repo -> { commitHash, skills: [...] }
    this.isDirty = false;
  }

  /**
   * Load cache from file with version checking
   */
  async load() {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const json = JSON.parse(data);
      
      const cacheVersion = json.version || 1; // Default to v1 if no version field
      
      if (cacheVersion !== CACHE_VERSION) {
        console.log(`Cache version mismatch: found v${cacheVersion}, expected v${CACHE_VERSION}`);
        await this._handleVersionMismatch(json, cacheVersion);
      } else {
        // Version matches, load directly
        this._loadFromJson(json);
        console.log(`Loaded cache v${CACHE_VERSION}: ${this.skills.size} skills, ${this.repos.size} repos.`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to load cache:", error.message);
      }
      this._initEmpty();
    }
  }

  /**
   * Handle cache version mismatch
   * @param {Object} json - Loaded cache data
   * @param {number} oldVersion - Old cache version
   */
  async _handleVersionMismatch(json, oldVersion) {
    const strategy = process.env.CACHE_MIGRATION_STRATEGY || DEFAULT_MIGRATION_STRATEGY;
    
    if (strategy === MIGRATION_STRATEGY.DISCARD) {
      console.log(`Discarding old cache (strategy: discard)`);
      this._initEmpty();
      this.isDirty = true; // Mark dirty to save new version
      return;
    }
    
    // Try to migrate
    console.log(`Migrating cache from v${oldVersion} to v${CACHE_VERSION}...`);
    
    try {
      await this._migrateCache(json, oldVersion);
      console.log(`Migration complete: ${this.skills.size} skills, ${this.repos.size} repos.`);
      this.isDirty = true; // Mark dirty to save migrated data
    } catch (error) {
      console.warn(`Migration failed: ${error.message}. Starting with empty cache.`);
      this._initEmpty();
      this.isDirty = true;
    }
  }

  /**
   * Migrate cache from old version to current version
   * @param {Object} json - Old cache data
   * @param {number} fromVersion - Old version number
   */
  async _migrateCache(json, fromVersion) {
    // Load basic structure
    this._loadFromJson(json);
    
    // Apply migrations based on version
    // Example: if (fromVersion < 2) { this._migrateV1ToV2(); }
    
    // Currently no migrations needed (v1 is the initial version)
  }

  // Migration methods template:
  // _migrateV1ToV2() {
  //   console.log("  Migrating v1 -> v2: ...");
  //   // Add migration logic here
  // }

  /**
   * Load data from JSON object
   * @param {Object} json - Cache data
   */
  _loadFromJson(json) {
    if (json.skills) {
      this.skills = new Map(Object.entries(json.skills));
    } else {
      this.skills = new Map();
    }
    
    if (json.repos) {
      this.repos = new Map(Object.entries(json.repos));
    } else {
      this.repos = new Map();
    }
  }

  /**
   * Initialize empty cache
   */
  _initEmpty() {
    this.skills = new Map();
    this.repos = new Map();
  }

  /**
   * Save cache to file with version
   */
  async save() {
    if (!this.isDirty) return;
    
    try {
      const json = {
        version: CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        skills: Object.fromEntries(this.skills),
        repos: Object.fromEntries(this.repos),
      };
      await fs.writeFile(CACHE_FILE, JSON.stringify(json, null, 2), "utf-8");
      console.log(`Saved cache v${CACHE_VERSION}: ${this.skills.size} skills, ${this.repos.size} repos.`);
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

  setSkill(key, data) {
    this.skills.set(key, data);
    this.isDirty = true;
  }

  // Repo-level cache methods
  getRepo(owner, repo) {
    return this.repos.get(`${owner}/${repo}`);
  }

  setRepo(owner, repo, data) {
    this.repos.set(`${owner}/${repo}`, data);
    this.isDirty = true;
  }

  /**
   * Check if zip needs to be regenerated
   * @param {string} key - Skill cache key
   * @param {string} currentCommitHash - Current commit hash
   * @returns {boolean}
   */
  needsZipRegeneration(key, currentCommitHash) {
    const cached = this.skills.get(key);
    if (!cached) return true;
    if (!cached.zipHash) return true;
    if (cached.commitHash !== currentCommitHash) return true;
    return false;
  }

  /**
   * Set zip information for a skill
   * @param {string} key - Skill cache key
   * @param {Object} zipInfo - { zipHash, zipPath }
   */
  setZipInfo(key, zipInfo) {
    const cached = this.skills.get(key);
    if (cached) {
      cached.zipHash = zipInfo.zipHash;
      cached.zipPath = zipInfo.zipPath;
      this.isDirty = true;
    }
  }

  /**
   * Get zip information for a skill
   * @param {string} key - Skill cache key
   * @returns {Object|null} - { zipHash, zipPath } or null
   */
  getZipInfo(key) {
    const cached = this.skills.get(key);
    if (cached && cached.zipHash && cached.zipPath) {
      return {
        zipHash: cached.zipHash,
        zipPath: cached.zipPath,
      };
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
}

export const crawlerCache = new CrawlerCache();
