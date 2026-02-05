import fs from "fs/promises";
import path from "path";
import { __crawlerDirname } from "./config.js";

const CACHE_FILE = path.join(__crawlerDirname, ".crawler-cache.json");

export class CrawlerCache {
  constructor() {
    this.skills = new Map();      // skill-level cache: owner/repo/path -> { commitHash, manifest }
    this.repos = new Map();       // repo-level cache: owner/repo -> { commitHash, skills: [...] }
    this.isDirty = false;
  }

  async load() {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const json = JSON.parse(data);
      
      // Load skills cache
      if (json.skills) {
        this.skills = new Map(Object.entries(json.skills));
      }
      
      // Load repos cache
      if (json.repos) {
        this.repos = new Map(Object.entries(json.repos));
      }
      
      console.log(`Loaded cache: ${this.skills.size} skills, ${this.repos.size} repos.`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn("Failed to load cache:", error.message);
      }
      this.skills = new Map();
      this.repos = new Map();
    }
  }

  async save() {
    if (!this.isDirty) return;
    
    try {
      const json = {
        skills: Object.fromEntries(this.skills),
        repos: Object.fromEntries(this.repos),
      };
      await fs.writeFile(CACHE_FILE, JSON.stringify(json, null, 2), "utf-8");
      console.log(`Saved cache: ${this.skills.size} skills, ${this.repos.size} repos.`);
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to save cache:", error.message);
    }
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
