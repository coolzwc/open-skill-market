import fs from "fs/promises";
import path from "path";
import { __crawlerDirname } from "./config.js";

const CACHE_FILE = path.join(__crawlerDirname, ".crawler-cache.json");

export class CrawlerCache {
  constructor() {
    this.cache = new Map();
    this.isDirty = false;
  }

  async load() {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const json = JSON.parse(data);
      this.cache = new Map(Object.entries(json));
      console.log(`Loaded ${this.cache.size} entries from cache.`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to load cache:", error.message);
      }
      this.cache = new Map();
    }
  }

  async save() {
    if (!this.isDirty) return;
    
    try {
      const json = Object.fromEntries(this.cache);
      await fs.writeFile(CACHE_FILE, JSON.stringify(json, null, 2), "utf-8");
      console.log(`Saved ${this.cache.size} entries to cache.`);
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to save cache:", error.message);
    }
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, data) {
    this.cache.set(key, data);
    this.isDirty = true;
  }

  /**
   * Generate a cache key for a skill file
   * @param {string} owner 
   * @param {string} repo 
   * @param {string} filePath 
   * @returns {string}
   */
  static generateKey(owner, repo, filePath) {
    return `${owner}/${repo}/${filePath}`;
  }
}

export const skillCache = new CrawlerCache();
