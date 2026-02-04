import { Octokit } from "octokit";
import matter from "gray-matter";
import * as prettier from "prettier";
import yaml from "js-yaml";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load priority repositories from repositories.yml
 * @returns {Promise<string[]>} Array of repository full names (owner/repo)
 */
async function loadPriorityRepos() {
  const reposPath = path.join(__dirname, "repositories.yml");
  try {
    const content = await fs.readFile(reposPath, "utf-8");
    const data = yaml.load(content);
    const repos = data?.priority || [];
    // Filter out empty strings and ensure valid format
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

// Configuration
const CONFIG = {
  // Topics to search for skill-related repositories
  // These are searched in order, results are deduplicated
  searchTopics: [
    "cursor-skill",
    "cursor-skills",
    "claude-skill",
    "claude-skills",
    "ai-skill",
    "ai-skills",
    "ai-agent-tools",
    "llm-tools",
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
  // Priority repositories to crawl (crawled before GitHub search)
  // These repos are crawled in full, looking for all SKILL.md files
  // NOTE: Make sure these repos actually exist on GitHub!
  // Priority repos are loaded from repositories.yml
  repositoriesPath: path.join(__dirname, "repositories.yml"),
  // API version
  apiVersion: "1.1",
  // Rate limit settings
  rateLimit: {
    // GitHub REST API: 5000 requests/hour for authenticated, 60 for unauthenticated
    // GitHub Search API: 30 requests/minute for authenticated, 10 for unauthenticated
    maxRetries: 3,
    // Base delay between requests (ms)
    baseDelay: 500,
    // Delay after hitting rate limit before checking again (ms)
    rateLimitCheckDelay: 60000, // 1 minute
    // Maximum wait time for rate limit reset (ms)
    maxRateLimitWait: 300000, // 5 minutes max wait (reduced for CI timeout)
  },
  // Execution timeout settings
  // GitHub Actions limits:
  // - Public repos: 6 hours (360 min)
  // - Private repos (Free/Pro): 35 min
  // - Private repos (Team/Enterprise): 6 hours
  execution: {
    // Maximum total execution time in milliseconds
    // Set to 25 minutes to leave buffer for saving results before CI timeout (30 min)
    maxExecutionTime: 25 * 60 * 1000, // 25 minutes
    // Time buffer before timeout to ensure results are saved (ms)
    saveBuffer: 2 * 60 * 1000, // 2 minutes
  },
};

/**
 * Initialize Octokit with GitHub token
 */
function createOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "Warning: GITHUB_TOKEN not set. API rate limits will be severely restricted (60 req/hour).",
    );
    console.warn(
      "Set GITHUB_TOKEN for 5000 req/hour. See: https://github.com/settings/tokens",
    );
  }
  return new Octokit({ auth: token });
}

/**
 * Rate limit state tracking
 */
const rateLimitState = {
  remaining: null,
  reset: null,
  isLimited: false,
  searchRemaining: null,
  searchReset: null,
};

/**
 * Execution state tracking
 */
const executionState = {
  startTime: null,
  isTimedOut: false,
};

/**
 * Initialize execution timer
 */
function startExecutionTimer() {
  executionState.startTime = Date.now();
  executionState.isTimedOut = false;
  console.log(
    `Execution timeout set to ${CONFIG.execution.maxExecutionTime / 60000} minutes`,
  );
}

/**
 * Check if we should stop due to execution timeout
 * @returns {boolean} true if we should stop
 */
function shouldStopForTimeout() {
  if (!executionState.startTime) return false;

  const elapsed = Date.now() - executionState.startTime;
  const timeRemaining = CONFIG.execution.maxExecutionTime - elapsed;

  if (timeRemaining <= CONFIG.execution.saveBuffer) {
    if (!executionState.isTimedOut) {
      executionState.isTimedOut = true;
      const elapsedMin = Math.floor(elapsed / 60000);
      console.log(
        `\n⏱ Execution timeout approaching (${elapsedMin} min elapsed). Stopping to save results.`,
      );
    }
    return true;
  }

  return false;
}

/**
 * Get remaining execution time in milliseconds
 * @returns {number}
 */
function getRemainingExecutionTime() {
  if (!executionState.startTime) return CONFIG.execution.maxExecutionTime;
  const elapsed = Date.now() - executionState.startTime;
  return Math.max(
    0,
    CONFIG.execution.maxExecutionTime - elapsed - CONFIG.execution.saveBuffer,
  );
}

/**
 * Update rate limit state from response headers
 * @param {Object} response - GitHub API response
 * @param {string} type - 'core' or 'search'
 */
function updateRateLimitFromResponse(response, type = "core") {
  const headers = response?.headers || {};

  if (type === "search") {
    if (headers["x-ratelimit-remaining"]) {
      rateLimitState.searchRemaining = parseInt(
        headers["x-ratelimit-remaining"],
        10,
      );
    }
    if (headers["x-ratelimit-reset"]) {
      rateLimitState.searchReset =
        parseInt(headers["x-ratelimit-reset"], 10) * 1000;
    }
  } else {
    if (headers["x-ratelimit-remaining"]) {
      rateLimitState.remaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      rateLimitState.reset = parseInt(headers["x-ratelimit-reset"], 10) * 1000;
    }
  }
}

/**
 * Check and handle rate limit
 * @param {Octokit} octokit
 * @returns {Promise<boolean>} true if we can continue, false if we should stop
 */
async function checkRateLimit(octokit) {
  try {
    const { data } = await octokit.rest.rateLimit.get();
    const core = data.resources.core;
    const search = data.resources.search;

    rateLimitState.remaining = core.remaining;
    rateLimitState.reset = core.reset * 1000;
    rateLimitState.searchRemaining = search.remaining;
    rateLimitState.searchReset = search.reset * 1000;

    console.log(`  Rate Limit Status:`);
    console.log(`    Core API: ${core.remaining}/${core.limit} remaining`);
    console.log(
      `    Search API: ${search.remaining}/${search.limit} remaining`,
    );

    // If we're out of requests, calculate wait time
    if (core.remaining < 10 || search.remaining < 5) {
      const now = Date.now();
      const coreWait =
        core.remaining < 10 ? Math.max(0, rateLimitState.reset - now) : 0;
      const searchWait =
        search.remaining < 5
          ? Math.max(0, rateLimitState.searchReset - now)
          : 0;
      const waitTime = Math.max(coreWait, searchWait);

      if (waitTime > 0 && waitTime <= CONFIG.rateLimit.maxRateLimitWait) {
        const waitMinutes = Math.ceil(waitTime / 60000);
        console.log(
          `  Rate limit low. Waiting ${waitMinutes} minutes for reset...`,
        );
        await sleep(waitTime + 1000);
        return true;
      } else if (waitTime > CONFIG.rateLimit.maxRateLimitWait) {
        console.log(
          `  Rate limit reset too far in the future (${Math.ceil(waitTime / 60000)} min).`,
        );
        console.log(`  Stopping crawl to avoid excessive wait.`);
        rateLimitState.isLimited = true;
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error(`  Failed to check rate limit: ${error.message}`);
    return true;
  }
}

/**
 * Handle rate limit error with retry logic
 * @param {Error} error
 * @param {number} retryCount
 * @returns {Promise<boolean>} true if should retry, false if should stop
 */
async function handleRateLimitError(error, retryCount = 0) {
  // Check execution timeout first
  if (shouldStopForTimeout()) {
    return false;
  }

  if (error.status === 403 || error.status === 429) {
    const resetTime = error.response?.headers?.["x-ratelimit-reset"];
    const retryAfter = error.response?.headers?.["retry-after"];

    let waitTime = CONFIG.rateLimit.rateLimitCheckDelay;

    if (retryAfter) {
      waitTime = parseInt(retryAfter, 10) * 1000;
    } else if (resetTime) {
      waitTime = Math.max(0, parseInt(resetTime, 10) * 1000 - Date.now());
    }

    // Check if wait time exceeds our remaining execution time
    const remainingTime = getRemainingExecutionTime();
    if (waitTime > remainingTime) {
      console.log(
        `  Rate limit wait (${Math.ceil(waitTime / 60000)} min) exceeds remaining time (${Math.ceil(remainingTime / 60000)} min). Stopping.`,
      );
      rateLimitState.isLimited = true;
      return false;
    }

    if (waitTime > CONFIG.rateLimit.maxRateLimitWait) {
      console.error(
        `  Rate limit reset too far away (${Math.ceil(waitTime / 60000)} min). Stopping.`,
      );
      rateLimitState.isLimited = true;
      return false;
    }

    if (retryCount < CONFIG.rateLimit.maxRetries) {
      const waitMinutes = Math.ceil(waitTime / 60000);
      console.log(
        `  Rate limited. Waiting ${waitMinutes} minutes before retry ${retryCount + 1}/${CONFIG.rateLimit.maxRetries}...`,
      );
      await sleep(waitTime + 1000);
      return true;
    }

    console.error(`  Max retries exceeded. Stopping.`);
    rateLimitState.isLimited = true;
    return false;
  }

  return false;
}

/**
 * Search for repositories by topic
 * @param {Octokit} octokit
 * @param {string} topic
 * @returns {Promise<Array>} Array of repository objects
 */
async function searchRepositoriesByTopic(octokit, topic) {
  const repos = [];

  for (let page = 1; page <= CONFIG.maxPages; page++) {
    if (rateLimitState.isLimited || shouldStopForTimeout()) {
      break;
    }

    try {
      const response = await octokit.rest.search.repos({
        q: `topic:${topic}`,
        sort: "stars",
        order: "desc",
        per_page: CONFIG.perPage,
        page,
      });

      updateRateLimitFromResponse(response, "search");
      repos.push(...response.data.items);

      console.log(
        `    Page ${page}: Found ${response.data.items.length} repos (Total: ${repos.length})`,
      );

      if (response.data.items.length < CONFIG.perPage) {
        break;
      }

      await sleep(2000); // Rate limiting for search API
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        const shouldRetry = await handleRateLimitError(error);
        if (!shouldRetry) {
          break;
        }
      } else {
        console.error(`  Error searching topic ${topic}: ${error.message}`);
        break;
      }
    }
  }

  return repos;
}

/**
 * Search for skill repositories using topics
 * @param {Octokit} octokit
 * @returns {Promise<Map>} Map of repo full_name to repo object
 */
async function searchSkillRepositories(octokit) {
  console.log("Searching for skill repositories by topic...");
  const allRepos = new Map();

  for (let i = 0; i < CONFIG.searchTopics.length; i++) {
    const topic = CONFIG.searchTopics[i];

    if (rateLimitState.isLimited || shouldStopForTimeout()) {
      console.log("  Stopping search due to rate limit or timeout.");
      break;
    }

    console.log(
      `\n  Topic ${i + 1}/${CONFIG.searchTopics.length}: "${topic}"`,
    );

    const repos = await searchRepositoriesByTopic(octokit, topic);

    let newCount = 0;
    for (const repo of repos) {
      if (!allRepos.has(repo.full_name)) {
        allRepos.set(repo.full_name, repo);
        newCount++;
      }
    }

    if (newCount > 0) {
      console.log(`    Added ${newCount} new unique repos`);
    }

    await sleep(1000);
  }

  console.log(`\nTotal unique repositories found: ${allRepos.size}`);
  return allRepos;
}

/**
 * Find all SKILL.md files in a repository recursively
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} treePath
 * @returns {Promise<string[]>} Array of file paths
 */
async function findSkillFilesInRepo(octokit, owner, repo, treePath = "") {
  const skillFiles = [];

  if (rateLimitState.isLimited) {
    return skillFiles;
  }

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: treePath,
    });

    updateRateLimitFromResponse(response);

    if (!Array.isArray(response.data)) {
      return skillFiles;
    }

    // Directories to skip
    const skipDirs = new Set(["node_modules", "dist", "build", "coverage", "__pycache__"]);

    for (const item of response.data) {
      if (item.type === "file" && item.name === CONFIG.skillFilename) {
        skillFiles.push(item.path);
      } else if (
        item.type === "dir" &&
        !item.name.startsWith(".") && // Skip hidden directories
        !skipDirs.has(item.name)
      ) {
        await sleep(CONFIG.rateLimit.baseDelay);
        const subFiles = await findSkillFilesInRepo(
          octokit,
          owner,
          repo,
          item.path,
        );
        skillFiles.push(...subFiles);
      }
    }
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      await handleRateLimitError(error);
    } else if (error.status !== 404) {
      console.error(
        `  Error scanning ${owner}/${repo}/${treePath}: ${error.message}`,
      );
    }
  }

  return skillFiles;
}

/**
 * Crawl priority repositories for SKILL.md files
 * @param {Octokit} octokit
 * @param {string[]} priorityRepos - Array of repository full names (owner/repo)
 * @returns {Promise<Object[]>} Array of skill manifests from priority repos
 */
async function crawlPriorityRepos(octokit, priorityRepos) {
  const prioritySkills = [];

  if (!priorityRepos || priorityRepos.length === 0) {
    console.log("No priority repositories configured.");
    return prioritySkills;
  }

  console.log(`Crawling ${priorityRepos.length} priority repositories...`);

  for (const repoFullName of priorityRepos) {
    if (rateLimitState.isLimited) {
      console.log("  Stopping priority repo crawl due to rate limit.");
      break;
    }

    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      console.log(
        `  Invalid repository format: ${repoFullName} (expected: owner/repo)`,
      );
      continue;
    }

    if (repoFullName === `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`) {
      console.log(`  Skipping ${repoFullName}: This is our own repository`);
      continue;
    }

    console.log(`\n  Repository: ${repoFullName}`);

    try {
      const repoDetails = await fetchRepoDetails(octokit, owner, repo);
      if (!repoDetails) {
        console.log(`    Failed to fetch repository details`);
        continue;
      }

      await sleep(CONFIG.rateLimit.baseDelay);

      console.log(`    Scanning for SKILL.md files...`);
      const skillFiles = await findSkillFilesInRepo(octokit, owner, repo);
      console.log(`    Found ${skillFiles.length} SKILL.md file(s)`);

      for (const filePath of skillFiles) {
        if (rateLimitState.isLimited) break;

        const fileInfo = { path: filePath };
        const repoInfo = { owner: { login: owner }, name: repo };

        const manifest = await processSkillFile(
          octokit,
          repoInfo,
          fileInfo,
          repoDetails,
        );
        if (manifest) {
          manifest.source = "priority";
          prioritySkills.push(manifest);
        }

        await sleep(CONFIG.rateLimit.baseDelay);
      }
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        const shouldContinue = await handleRateLimitError(error);
        if (!shouldContinue) break;
      } else {
        console.error(`    Error processing ${repoFullName}: ${error.message}`);
      }
    }
  }

  console.log(`\n  Total skills from priority repos: ${prioritySkills.length}`);
  return prioritySkills;
}

/**
 * Group search results by repository
 * @param {Array} searchResults
 * @returns {Map<string, Array>}
 */
function groupByRepository(searchResults) {
  const repoMap = new Map();

  for (const item of searchResults) {
    const repoFullName = item.repository.full_name;
    if (!repoMap.has(repoFullName)) {
      repoMap.set(repoFullName, {
        repository: item.repository,
        files: [],
      });
    }
    repoMap.get(repoFullName).files.push(item);
  }

  console.log(`Grouped into ${repoMap.size} repositories`);
  return repoMap;
}

/**
 * Fetch the raw content of a file from GitHub
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function fetchFileContent(octokit, owner, repo, filePath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    if (response.data.type === "file" && response.data.content) {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (error) {
    console.error(
      `  Failed to fetch ${owner}/${repo}/${filePath}: ${error.message}`,
    );
    return null;
  }
}

/**
 * Fetch repository details
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Object|null>}
 */
async function fetchRepoDetails(octokit, owner, repo) {
  try {
    const response = await octokit.rest.repos.get({
      owner,
      repo,
    });
    return response.data;
  } catch (error) {
    console.error(
      `  Failed to fetch repo details for ${owner}/${repo}: ${error.message}`,
    );
    return null;
  }
}

/**
 * Get the latest commit hash for a file
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function getLatestCommitHash(octokit, owner, repo, filePath) {
  try {
    const response = await octokit.rest.repos.listCommits({
      owner,
      repo,
      path: filePath,
      per_page: 1,
    });
    return response.data[0]?.sha?.substring(0, 12) || null;
  } catch (error) {
    return null;
  }
}

/**
 * Validate skill quality based on content
 * @param {Object} parsed
 * @param {string} body
 * @returns {{ isValid: boolean, reason: string }}
 */
function validateSkillQuality(parsed, body) {
  if (!parsed.name || parsed.name.length < 2) {
    return { isValid: false, reason: "Missing or invalid name in frontmatter" };
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(parsed.name)) {
    return { isValid: false, reason: "Name must be lowercase with hyphens" };
  }

  if (!parsed.description || parsed.description.length < 20) {
    return {
      isValid: false,
      reason: "Missing or too short description (min 20 chars)",
    };
  }

  const bodyLength = body ? body.replace(/\s+/g, " ").trim().length : 0;
  if (bodyLength < 500) {
    return {
      isValid: false,
      reason: `Body content is too short (min 500 chars), current length: ${bodyLength}`,
    };
  }

  return { isValid: true, reason: "" };
}

/**
 * Parse SKILL.md content and extract metadata
 * @param {string} content
 * @returns {Object}
 */
function parseSkillContent(content) {
  try {
    const { data: frontmatter, content: body } = matter(content);

    const name = frontmatter.name || null;
    const description = frontmatter.description || null;
    const version = frontmatter.version || null;
    const tags = frontmatter.tags || [];

    let extractedDescription = description;
    if (!extractedDescription && body) {
      const lines = body.split("\n").filter((line) => line.trim());
      for (const line of lines) {
        if (!line.startsWith("#") && line.trim().length > 20) {
          extractedDescription = line.trim().substring(0, 500);
          break;
        }
      }
    }

    const parsed = {
      name,
      description: extractedDescription,
      version,
      tags: Array.isArray(tags) ? tags : [],
    };

    const validation = validateSkillQuality(parsed, body);
    parsed.isValid = validation.isValid;
    parsed.invalidReason = validation.reason;

    return parsed;
  } catch (error) {
    console.error(`  Failed to parse SKILL.md content: ${error.message}`);
    return {
      name: null,
      description: null,
      version: null,
      tags: [],
      isValid: false,
      invalidReason: "Parse error",
    };
  }
}

/**
 * Determine the skill path within the repository
 * @param {string} filePath
 * @returns {string}
 */
function getSkillPath(filePath) {
  const dir = path.dirname(filePath);
  return dir === "." ? "" : dir;
}

/**
 * Generate unique skill ID
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillPath
 * @returns {string}
 */
function generateSkillId(owner, repo, skillPath) {
  if (!skillPath || skillPath === ".") {
    return `${owner}/${repo}`;
  }
  return `${owner}/${repo}/${skillPath}`;
}

/**
 * Generate display name from skill name
 * @param {string} name
 * @returns {string}
 */
function generateDisplayName(name) {
  if (!name) return null;
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * List files in a skill directory
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillPath
 * @returns {Promise<string[]>}
 */
async function listSkillFiles(octokit, owner, repo, skillPath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: skillPath || "",
    });

    if (Array.isArray(response.data)) {
      return response.data.map((item) => item.path);
    }
    return [];
  } catch (error) {
    return [];
  }
}

/**
 * Process a single skill file and build the manifest
 * @param {Octokit} octokit
 * @param {Object} repoInfo
 * @param {Object} fileInfo
 * @param {Object} repoDetails
 * @returns {Promise<Object|null>}
 */
async function processSkillFile(octokit, repoInfo, fileInfo, repoDetails) {
  const owner = repoInfo.owner.login;
  const repo = repoInfo.name;
  const filePath = fileInfo.path;

  console.log(`  Processing: ${owner}/${repo}/${filePath}`);

  const content = await fetchFileContent(octokit, owner, repo, filePath);
  if (!content) {
    return null;
  }

  const parsed = parseSkillContent(content);

  if (!parsed.isValid) {
    console.log(`    Skipped: ${parsed.invalidReason}`);
    return null;
  }

  const skillPath = getSkillPath(filePath);
  const id = generateSkillId(owner, repo, skillPath);
  const commitHash = await getLatestCommitHash(octokit, owner, repo, filePath);
  const files = await listSkillFiles(octokit, owner, repo, skillPath);

  const branch = repoDetails?.default_branch || "main";
  const detailsUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;

  const manifest = {
    id,
    name: parsed.name || path.basename(skillPath) || repo,
    displayName: generateDisplayName(
      parsed.name || path.basename(skillPath) || repo,
    ),
    description: parsed.description || `Skill from ${owner}/${repo}`,
    details: detailsUrl,
    author: {
      name: owner,
      url: `https://github.com/${owner}`,
      avatar: `https://github.com/${owner}.png`,
    },
    version: parsed.version || "0.0.0",
    tags: parsed.tags,
    repository: {
      url: `https://github.com/${owner}/${repo}`,
      branch,
      path: skillPath,
      latestCommitHash: commitHash || "",
      downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
    },
    files: files.slice(0, 20),
    stats: {
      stars: repoDetails?.stargazers_count || 0,
      forks: repoDetails?.forks_count || 0,
      lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
    },
  };

  if (parsed.version) {
    manifest.compatibility = {
      minAgentVersion: "0.1.0",
    };
  }

  return manifest;
}

/**
 * Sleep for a specified duration
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a path exists
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively list all files in a directory
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFilesRecursive(dir) {
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
 * Scan local skills directory for SKILL.md files
 * @returns {Promise<Object[]>}
 */
async function scanLocalSkills() {
  console.log("Scanning local skills directory...");

  const localSkills = [];
  const skillsDir = CONFIG.localSkillsPath;

  if (!(await pathExists(skillsDir))) {
    console.log("  Local skills directory not found, skipping.");
    return localSkills;
  }

  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillDirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith("."),
  );

  console.log(`  Found ${skillDirs.length} skill directories`);

  for (const skillDir of skillDirs) {
    const skillPath = path.join(skillsDir, skillDir.name);
    const skillMdPath = path.join(skillPath, CONFIG.skillFilename);

    if (!(await pathExists(skillMdPath))) {
      console.log(`  Skipping ${skillDir.name}: No SKILL.md found`);
      continue;
    }

    console.log(`  Processing local skill: ${skillDir.name}`);

    try {
      const content = await fs.readFile(skillMdPath, "utf-8");
      const parsed = parseSkillContent(content);

      if (!parsed.isValid) {
        console.log(`    Skipped: ${parsed.invalidReason}`);
        continue;
      }

      const allFiles = await listFilesRecursive(skillPath);
      const relativeFiles = allFiles.map((f) =>
        path.relative(CONFIG.localSkillsPath, f),
      );

      const { data: frontmatter } = matter(content);
      const authorName = frontmatter.author?.name || CONFIG.thisRepo.owner;
      const authorUrl =
        frontmatter.author?.url || `https://github.com/${authorName}`;

      const detailsUrl = `${CONFIG.thisRepo.url}/blob/main/skills/${skillDir.name}/${CONFIG.skillFilename}`;

      const manifest = {
        id: `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}/skills/${skillDir.name}`,
        name: parsed.name || skillDir.name,
        displayName: generateDisplayName(parsed.name || skillDir.name),
        description: parsed.description || `Local skill: ${skillDir.name}`,
        details: detailsUrl,
        author: {
          name: authorName,
          url: authorUrl,
          avatar: `https://github.com/${authorName}.png`,
        },
        version: parsed.version || "0.0.0",
        tags: parsed.tags,
        repository: {
          url: CONFIG.thisRepo.url,
          branch: "main",
          path: `skills/${skillDir.name}`,
          latestCommitHash: "",
          downloadUrl: `https://api.github.com/repos/${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}/zipball/main`,
        },
        files: relativeFiles.slice(0, 20),
        stats: {
          stars: 0,
          forks: 0,
          lastUpdated: new Date().toISOString(),
        },
        source: "local",
      };

      if (parsed.version) {
        manifest.compatibility = {
          minAgentVersion: "0.1.0",
        };
      }

      localSkills.push(manifest);
    } catch (error) {
      console.error(`  Error processing ${skillDir.name}: ${error.message}`);
    }
  }

  console.log(`  Total local skills found: ${localSkills.length}`);
  return localSkills;
}

/**
 * Main crawler function
 */
async function main() {
  console.log("=== Open Skill Market Crawler ===\n");

  startExecutionTimer();

  console.log("GitHub API Rate Limits:");
  console.log(
    "  - REST API: 5000 req/hour (authenticated), 60 req/hour (unauthenticated)",
  );
  console.log(
    "  - Search API: 30 req/minute (authenticated), 10 req/minute (unauthenticated)",
  );
  console.log("");

  const octokit = createOctokit();
  const allSkills = [];
  const processedRepos = new Set();
  let prioritySkills = [];

  // Load priority repositories from YAML
  const priorityRepos = await loadPriorityRepos();
  if (priorityRepos.length > 0) {
    console.log(`Loaded ${priorityRepos.length} priority repository(s) from repositories.yml`);
  }

  console.log("Checking rate limit status...");
  const canProceed = await checkRateLimit(octokit);
  if (!canProceed) {
    console.error("Cannot proceed due to rate limits. Try again later.");
    process.exit(1);
  }

  // Phase 1: Local Skills
  console.log("\n--- Phase 1: Local Skills (PR-submitted) ---\n");
  const localSkills = await scanLocalSkills();
  allSkills.push(...localSkills);

  // Phase 2: Priority Repositories
  if (!shouldStopForTimeout()) {
    console.log("\n--- Phase 2: Priority Repositories ---\n");
    prioritySkills = await crawlPriorityRepos(octokit, priorityRepos);
  } else {
    console.log(
      "\n--- Phase 2: Priority Repositories (SKIPPED - timeout) ---\n",
    );
  }
  allSkills.push(...prioritySkills);

  // Track priority repos to skip in search phase
  for (const repoFullName of priorityRepos) {
    processedRepos.add(repoFullName);
  }
  processedRepos.add(`${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`);

  // Phase 3: GitHub Search (by topic)
  console.log("\n--- Phase 3: GitHub Topic Search ---\n");

  if (shouldStopForTimeout()) {
    console.log("Skipping GitHub search due to execution timeout.");
  } else if (rateLimitState.isLimited) {
    console.log("Skipping GitHub search due to rate limit.");
  } else {
    const reposMap = await searchSkillRepositories(octokit);

    if (reposMap.size > 0 && !rateLimitState.isLimited && !shouldStopForTimeout()) {
      console.log("\nScanning repositories for SKILL.md files...");

      for (const [repoFullName, repo] of reposMap) {
        if (shouldStopForTimeout()) {
          console.log("\nStopping due to execution timeout.");
          break;
        }
        if (rateLimitState.isLimited) {
          console.log("\nStopping due to rate limit.");
          break;
        }

        if (processedRepos.has(repoFullName)) {
          console.log(`\nRepository: ${repoFullName} - Skipped (already processed)`);
          continue;
        }

        // Skip forks with low stars
        if (repo.fork && repo.stargazers_count < 10) {
          continue;
        }

        console.log(`\nRepository: ${repoFullName} (${repo.stargazers_count} stars)`);

        // Scan the repository for SKILL.md files
        console.log(`  Scanning for SKILL.md files...`);
        const skillFiles = await findSkillFilesInRepo(
          octokit,
          repo.owner.login,
          repo.name,
        );

        if (skillFiles.length === 0) {
          console.log(`  No SKILL.md files found`);
          processedRepos.add(repoFullName);
          continue;
        }

        console.log(`  Found ${skillFiles.length} SKILL.md file(s)`);

        // Process each skill file
        for (const filePath of skillFiles) {
          if (rateLimitState.isLimited || shouldStopForTimeout()) break;

          const fileInfo = { path: filePath };
          const repoInfo = { owner: { login: repo.owner.login }, name: repo.name };

          const manifest = await processSkillFile(octokit, repoInfo, fileInfo, repo);
          if (manifest) {
            manifest.source = "github";
            allSkills.push(manifest);
          }
          await sleep(CONFIG.rateLimit.baseDelay);
        }

        processedRepos.add(repoFullName);
      }
    } else if (reposMap.size === 0) {
      console.log("No repositories found via topic search.");
    }
  }

  // Final Processing - Sort and Deduplicate
  const sourceOrder = { local: 0, priority: 1, github: 2 };
  allSkills.sort((a, b) => {
    const orderA = sourceOrder[a.source] ?? 3;
    const orderB = sourceOrder[b.source] ?? 3;
    if (orderA !== orderB) return orderA - orderB;
    return b.stats.stars - a.stats.stars;
  });

  // Deduplicate by name + description (keep the first one which has higher priority/stars)
  const seenSignatures = new Set();
  const dedupedSkills = [];
  let duplicateCount = 0;

  for (const skill of allSkills) {
    // Create a signature from normalized name and description
    const normalizedName = (skill.name || "").toLowerCase().trim();
    const normalizedDesc = (skill.description || "").toLowerCase().trim();
    const signature = `${normalizedName}::${normalizedDesc}`;

    if (seenSignatures.has(signature)) {
      console.log(`  Duplicate removed: ${skill.name} (${skill.id})`);
      duplicateCount++;
      continue;
    }

    seenSignatures.add(signature);
    dedupedSkills.push(skill);
  }

  if (duplicateCount > 0) {
    console.log(`\nRemoved ${duplicateCount} duplicate skill(s) by name+description`);
  }

  // Replace allSkills with deduplicated list
  allSkills.length = 0;
  allSkills.push(...dedupedSkills);

  const priorityCount = allSkills.filter((s) => s.source === "priority").length;
  const githubCount = allSkills.filter((s) => s.source === "github").length;
  const elapsedMs = Date.now() - executionState.startTime;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const isIncomplete = rateLimitState.isLimited || executionState.isTimedOut;

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalSkills: allSkills.length,
      localSkills: localSkills.length,
      prioritySkills: priorityCount,
      remoteSkills: githubCount,
      apiVersion: CONFIG.apiVersion,
      rateLimited: rateLimitState.isLimited,
      timedOut: executionState.isTimedOut,
      executionTimeMs: elapsedMs,
    },
    skills: allSkills,
  };

  console.log(`\n${"=".repeat(50)}`);
  console.log("Summary");
  console.log("=".repeat(50));
  console.log(`  Execution time:        ${elapsedMin}m ${elapsedSec}s`);
  console.log(`  Local skills (PR):     ${localSkills.length}`);
  console.log(`  Priority repo skills:  ${priorityCount}`);
  console.log(`  GitHub search skills:  ${githubCount}`);
  console.log(`  ${"─".repeat(30)}`);
  console.log(`  Total skills:          ${allSkills.length}`);
  if (isIncomplete) {
    console.log("");
    if (rateLimitState.isLimited) {
      console.log(`  ⚠ Crawl incomplete: GitHub API rate limit reached.`);
    }
    if (executionState.isTimedOut) {
      console.log(`  ⚠ Crawl incomplete: Execution timeout reached.`);
    }
    console.log(`    Run again later to collect more skills.`);
  }
  console.log(`\nSaving to ${CONFIG.outputPath}...`);

  const formattedJson = await prettier.format(JSON.stringify(output), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });

  await fs.writeFile(CONFIG.outputPath, formattedJson, "utf-8");

  console.log("Done!");
}

// Run the crawler
main().catch((error) => {
  console.error("Crawler failed:", error);
  process.exit(1);
});
