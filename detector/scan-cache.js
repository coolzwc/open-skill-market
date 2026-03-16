/**
 * Scan cache: skip re-scanning skills when skill.id + commitHash unchanged.
 * Format: { skillId -> { commitHash, result: { securityScore, riskLevel, scanTags }, scannedAt } }
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CACHE_FILE =
  process.env.SCAN_CACHE_FILE ||
  path.join(__dirname, "..", "market", ".scan-cache.json");
const CACHE_VERSION = 1;

export class ScanCache {
  constructor() {
    this.version = CACHE_VERSION;
    /** @type {Map<string, { commitHash: string, result: object, scannedAt: string }>} */
    this.entries = new Map();
    this.isDirty = false;
  }

  /**
   * Load cache from file
   */
  async load() {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const json = JSON.parse(data);
      if (json.version !== CACHE_VERSION) {
        this.entries = new Map();
        this.isDirty = true;
        return;
      }
      this.entries = json.entries ? new Map(Object.entries(json.entries)) : new Map();
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.warn("Scan cache load failed:", err.message);
      }
      this.entries = new Map();
    }
  }

  /**
   * Save cache to file
   */
  async save() {
    if (!this.isDirty) return;
    try {
      const dir = path.dirname(CACHE_FILE);
      await fs.mkdir(dir, { recursive: true });
      const json = {
        version: CACHE_VERSION,
        generatedAt: new Date().toISOString(),
        entries: Object.fromEntries(this.entries),
      };
      const tmp = `${CACHE_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(json, null, 2), "utf-8");
      await fs.rename(tmp, CACHE_FILE);
      this.isDirty = false;
    } catch (err) {
      console.error("Scan cache save failed:", err.message);
    }
  }

  /**
   * Check if skill can be skipped (cached result for same commitHash)
   * @param {string} skillId
   * @param {string} commitHash
   * @returns {{ skip: boolean, result?: object }}
   */
  get(skillId, commitHash) {
    const entry = this.entries.get(skillId);
    if (!entry || entry.commitHash !== commitHash) {
      return { skip: false };
    }
    return { skip: true, result: entry.result };
  }

  /**
   * Store scan result for skill
   * @param {string} skillId
   * @param {string} commitHash
   * @param {object} result - { securityScore, riskLevel, scanTags, scannedAt? }
   */
  set(skillId, commitHash, result) {
    const scannedAt = result.scannedAt || new Date().toISOString();
    this.entries.set(skillId, {
      commitHash,
      result: { ...result, scannedAt },
      scannedAt,
    });
    this.isDirty = true;
  }

  /**
   * Remove skill from cache (e.g. when no zip available, so it can be re-scanned later)
   * @param {string} skillId
   */
  remove(skillId) {
    if (this.entries.delete(skillId)) {
      this.isDirty = true;
    }
  }

  static getCachePath() {
    return CACHE_FILE;
  }
}

export const scanCache = new ScanCache();
