import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Crawler configuration
 */
export const CONFIG = {
  // Topics to search for skill-related repositories
  // Focused on actual skill/agent skill repos, avoiding overly broad terms
  searchTopics: [
    // Cursor/Claude specific (most precise)
    "cursor-skill",
    "cursor-skills",
    "cursor-rules",
    "claude-skill",
    "claude-skills",
    // Codex/Agent specific
    "codex-skills",
    "agent-skills",
    "agentic-skills",
    // MCP (Model Context Protocol) related
    "mcp-server",
    "mcp-tools",
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
    waitAfterSearch: 2000, // Delay after search API call
    waitAfterTopicSearch: 1000, // Delay between topic searches
    waitOnLimitedFallback: 5000, // Wait when all clients are limited
    maxWaitPerCycle: 30000, // Max wait time per rate limit cycle
    maxWaitForReset: 60000, // Max wait for rate limit reset
  },

  // File limits
  fileLimits: {
    maxFilesPerSkill: 20, // Maximum files to include per skill
    maxDescriptionLength: 500, // Maximum description length
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
      : ["vuejs-ai/skills"],
  },

  // Phase 4: Global SKILL.md discovery (optional supplementary search)
  // Discovers repos that have SKILL.md but aren't tagged with searchTopics
  // Note: GitHub Code Search limits results to 1000 total
  globalDiscovery: {
    enabled: process.env.GLOBAL_DISCOVERY !== "false", // Enabled by default
  },

  // Zip package generation settings
  zips: {
    enabled: process.env.GENERATE_ZIPS !== "false", // Allow disabling zip generation
    outputDir: path.join(__dirname, "..", "market", "zips"),
    baseUrl:
      process.env.ZIP_BASE_URL ||
      "https://raw.githubusercontent.com/coolzwc/open-skill-market/main/market/zips",
  },

  // Output optimization settings
  output: {
    // Compact mode removes redundant/derivable fields to reduce file size
    // Set COMPACT_OUTPUT=false to generate full output with all fields
    compact: process.env.COMPACT_OUTPUT !== "false",
    // Max skills per chunk. When totalSkills > chunkSize, output is split into
    // multiple files by complete repository boundaries.
    // Set CHUNK_SIZE=0 to disable chunking entirely.
    chunkSize: parseInt(process.env.CHUNK_SIZE || "500", 10),
  },
};

export const __crawlerDirname = __dirname;
