import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Crawler configuration
 */
export const CONFIG = {
  // Topics to search for skill-related repositories
  searchTopics: [
    "cursor-skill",
    "cursor-skills",
    "claude-skill",
    "claude-skills",
    "codex-skills",
    "ai-skill",
    "ai-skills",
    "ai-agent-tools",
    "agent-skills",
    "langchain-tools",
  ],

  // Standard skill filename (only SKILL.md is valid per spec)
  skillFilename: "SKILL.md",

  // Maximum number of repos per topic search
  perPage: 50,

  // Maximum pages to fetch per topic
  maxPages: 2,

  // Output file path
  outputPath: path.join(__dirname, "..", "market", "skills.json"),

  // Local skills directory (for PR-submitted skills)
  localSkillsPath: path.join(__dirname, "..", "skills"),

  // This repository info (for local skills)
  thisRepo: {
    owner: "coolzwc",
    name: "open-skill-market",
    url: "https://github.com/coolzwc/open-skill-market",
  },

  // Repositories config file path
  repositoriesPath: path.join(__dirname, "repositories.yml"),

  // API version
  apiVersion: "1.1",

  // Rate limit settings
  rateLimit: {
    maxRetries: 3,
    baseDelay: 500,
    rateLimitCheckDelay: 60000,
    maxRateLimitWait: 300000,
  },

  // Execution timeout settings
  execution: {
    maxExecutionTime: 5 * 60 * 60 * 1000, // 5 hours
    saveBuffer: 2 * 60 * 1000, // 2 minutes
  },

  // Parallel processing settings
  parallel: {
    concurrency: 5,
    intervalCap: 10,
    interval: 1000,
  },

  // Test mode: only scan specified repos, skip GitHub topic search
  testMode: {
    enabled: process.env.TEST_MODE === "true",
    // Test repos can be specified via TEST_REPOS env var (comma-separated)
    // e.g. TEST_REPOS="anthropics/skills,vercel-labs/agent-skills"
    repos: process.env.TEST_REPOS
      ? process.env.TEST_REPOS.split(",").map((r) => r.trim())
      : ["anthropics/skills", "huggingface/skills"],
  },
};

export const __crawlerDirname = __dirname;
