import path from "path";
import { CONFIG } from "./config.js";
import {
  sleep,
  generateSkillId,
  generateDisplayName,
  determineSkillPath,
} from "./utils.js";
import {
  rateLimitState,
  shouldStopForTimeout,
  updateRateLimitFromResponse,
  handleRateLimitError,
  logRateLimitWait,
} from "./rate-limit.js";
import { parseSkillContent, categorizeSkill } from "./skill-parser.js";
import { crawlerCache, CrawlerCache } from "./cache.js";

/**
 * Get the latest commit hash for a repository's default branch
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{commitHash: string, pushedAt: string}|null>}
 */
export async function getRepoLatestCommit(workerPool, owner, repo) {
  while (workerPool.allClientsLimited()) {
    if (shouldStopForTimeout()) return null;
    const nextReset = workerPool.getNextResetTime();
    const waitTime = nextReset - Date.now();
    if (waitTime > 0) {
      await sleep(Math.min(waitTime + 1000, 30000));
    } else {
      await sleep(1000);
    }
  }

  const client = workerPool.getClient();

  try {
    const response = await client.octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });
    workerPool.updateClientRateLimit(client, response);

    if (response.data.length > 0) {
      return {
        commitHash: response.data[0].sha.substring(0, 12),
        pushedAt: response.data[0].commit.committer?.date || new Date().toISOString(),
      };
    }
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      client.isLimited = true;
      if (error.response?.headers?.["x-ratelimit-reset"]) {
        client.rateLimitReset =
          parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
      }
    }
  }

  return null;
}

/**
 * Process a repository with cache optimization
 * Returns cached skills if repo hasn't changed, otherwise crawls the repo
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @param {Object} repoDetails
 * @param {string} source - 'priority' or 'github'
 * @returns {Promise<Object[]>}
 */
export async function processRepoWithCache(workerPool, owner, repo, repoDetails, source) {
  const repoFullName = `${owner}/${repo}`;

  // Get repo's latest commit
  const latestCommit = await getRepoLatestCommit(workerPool, owner, repo);
  if (!latestCommit) {
    console.log(`  Could not get latest commit for ${repoFullName}`);
    return [];
  }

  // Check repo cache
  const cachedRepo = crawlerCache.getRepo(owner, repo);
  if (cachedRepo && cachedRepo.commitHash === latestCommit.commitHash) {
    // Repo hasn't changed, use cached data
    const cachedSkills = cachedRepo.skills || [];
    
    if (cachedSkills.length === 0) {
      // Cached as empty repo (no SKILL.md files) - skip scanning
      // console.log(`  Skipping ${repoFullName} (cached: no skills)`);
      return [];
    }
    
    console.log(`  Using cached ${cachedSkills.length} skill(s) for ${repoFullName} (no changes)`);
    // Update stats from current repoDetails
    for (const skill of cachedSkills) {
      skill.source = source;
      skill.stats = {
        stars: repoDetails?.stargazers_count || 0,
        forks: repoDetails?.forks_count || 0,
        lastUpdated: repoDetails?.pushed_at || latestCommit.pushedAt,
      };
    }
    return cachedSkills;
  }

  // Repo has changed or not in cache, crawl it
  console.log(`  Scanning ${repoFullName} for SKILL.md files...`);

  const skillFiles = await findSkillFilesInRepoWithPool(workerPool, owner, repo);

  if (skillFiles.length === 0) {
    // Cache empty result to avoid re-scanning
    crawlerCache.setRepo(owner, repo, {
      commitHash: latestCommit.commitHash,
      skills: [],
      fetchedAt: new Date().toISOString(),
    });
    return [];
  }

  console.log(`  Found ${skillFiles.length} SKILL.md file(s) in ${repoFullName}`);

  const repoSkills = [];
  for (const filePath of skillFiles) {
    if (shouldStopForTimeout()) break;

    // Wait for rate limit reset if all clients are limited
    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) break;
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        await sleep(Math.min(waitTime + 1000, 30000));
      } else {
        await sleep(1000);
      }
    }

    if (shouldStopForTimeout()) break;

    const fileInfo = { path: filePath };
    const repoInfo = { owner: { login: owner }, name: repo };

    const manifest = await processSkillFileWithPool(
      workerPool,
      repoInfo,
      fileInfo,
      repoDetails,
      latestCommit.commitHash  // Pass repo commit hash
    );
    if (manifest) {
      manifest.source = source;
      repoSkills.push(manifest);
    }
  }

  // Update repo cache
  crawlerCache.setRepo(owner, repo, {
    commitHash: latestCommit.commitHash,
    skills: repoSkills,
    fetchedAt: new Date().toISOString(),
  });

  return repoSkills;
}

/**
 * Search for repositories by topic using worker pool
 * @param {WorkerPool} workerPool
 * @param {string} topic
 * @returns {Promise<Array>}
 */
export async function searchRepositoriesByTopic(workerPool, topic) {
  const repos = [];

  for (let page = 1; page <= CONFIG.maxPages; page++) {
    if (shouldStopForTimeout()) {
      break;
    }

    // Wait for rate limit reset if all clients are limited
    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) {
        return repos;
      }
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        logRateLimitWait(Math.ceil(waitTime / 1000));
        await sleep(Math.min(waitTime + 1000, 60000));
      } else {
        await sleep(5000);
      }
    }

    const client = workerPool.getClient();

    try {
      const response = await client.octokit.rest.search.repos({
        q: `topic:${topic}`,
        sort: "stars",
        order: "desc",
        per_page: CONFIG.perPage,
        page,
      });

      workerPool.updateClientRateLimit(client, response);
      repos.push(...response.data.items);

      console.log(
        `    Page ${page}: Found ${response.data.items.length} repos (Total: ${repos.length})`,
      );

      if (response.data.items.length < CONFIG.perPage) {
        break;
      }

      await sleep(2000);
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        client.isLimited = true;
        if (error.response?.headers?.["x-ratelimit-reset"]) {
          client.rateLimitReset =
            parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
        }
        // Don't break, continue with next iteration which will wait for reset
        page--; // Retry this page
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
 * @param {WorkerPool} workerPool
 * @returns {Promise<Map>}
 */
export async function searchSkillRepositories(workerPool) {
  console.log("Searching for skill repositories by topic...");
  const allRepos = new Map();

  for (let i = 0; i < CONFIG.searchTopics.length; i++) {
    const topic = CONFIG.searchTopics[i];

    if (shouldStopForTimeout()) {
      console.log("  Stopping search due to execution timeout.");
      break;
    }

    // Wait for rate limit reset if all clients are limited
    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) {
        console.log("  Stopping search due to execution timeout.");
        break;
      }
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        logRateLimitWait(Math.ceil(waitTime / 1000));
        await sleep(Math.min(waitTime + 1000, 60000));
      } else {
        await sleep(5000);
      }
    }

    console.log(`\n  Topic ${i + 1}/${CONFIG.searchTopics.length}: "${topic}"`);

    const repos = await searchRepositoriesByTopic(workerPool, topic);

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
 * @returns {Promise<string[]>}
 */
export async function findSkillFilesInRepo(
  octokit,
  owner,
  repo,
  treePath = "",
) {
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

    // Skip common build/dependency directories and well-known hidden directories
    // But allow custom hidden directories like .claude-plugin, .cursor, etc.
    const skipDirs = new Set([
      // Build and dependency directories
      "node_modules",
      "dist",
      "build",
      "coverage",
      "__pycache__",
      ".pnp",
      // Common hidden directories to skip
      ".git",
      ".github",
      ".vscode",
      ".idea",
      ".vs",
      ".svn",
      ".hg",
      ".cache",
      ".npm",
      ".yarn",
      ".pnpm",
      ".next",
      ".nuxt",
      ".output",
      ".turbo",
      ".vercel",
      ".netlify",
      ".parcel-cache",
      ".pytest_cache",
      ".mypy_cache",
      ".tox",
      ".nox",
      ".eggs",
      ".venv",
      ".env",
      ".direnv",
    ]);

    for (const item of response.data) {
      if (item.type === "file" && item.name === CONFIG.skillFilename) {
        skillFiles.push(item.path);
      } else if (item.type === "dir" && !skipDirs.has(item.name)) {
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
 * Find SKILL.md files using worker pool
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @param {string} treePath
 * @returns {Promise<string[]>}
 */
export async function findSkillFilesInRepoWithPool(
  workerPool,
  owner,
  repo,
  treePath = "",
) {
  const skillFiles = [];

  while (workerPool.allClientsLimited()) {
    if (shouldStopForTimeout()) {
      return skillFiles;
    }
    const nextReset = workerPool.getNextResetTime();
    const waitTime = nextReset - Date.now();
    if (waitTime > 0) {
      // Only log if wait time is significant (deduped)
      if (waitTime > 10000) {
        logRateLimitWait(Math.ceil(waitTime / 1000));
      }
      await sleep(Math.min(waitTime, 30000));
    } else {
      await sleep(1000);
    }
  }

  const client = workerPool.getClient();

  try {
    const response = await client.octokit.rest.repos.getContent({
      owner,
      repo,
      path: treePath,
    });

    workerPool.updateClientRateLimit(client, response);

    if (!Array.isArray(response.data)) {
      return skillFiles;
    }

    // Skip common build/dependency directories and well-known hidden directories
    // But allow custom hidden directories like .claude-plugin, .cursor, etc.
    const skipDirs = new Set([
      // Build and dependency directories
      "node_modules",
      "dist",
      "build",
      "coverage",
      "__pycache__",
      ".pnp",
      // Common hidden directories to skip
      ".git",
      ".github",
      ".vscode",
      ".idea",
      ".vs",
      ".svn",
      ".hg",
      ".cache",
      ".npm",
      ".yarn",
      ".pnpm",
      ".next",
      ".nuxt",
      ".output",
      ".turbo",
      ".vercel",
      ".netlify",
      ".parcel-cache",
      ".pytest_cache",
      ".mypy_cache",
      ".tox",
      ".nox",
      ".eggs",
      ".venv",
      ".env",
      ".direnv",
    ]);

    for (const item of response.data) {
      if (item.type === "file" && item.name === CONFIG.skillFilename) {
        skillFiles.push(item.path);
      } else if (item.type === "dir" && !skipDirs.has(item.name)) {
        const subFiles = await findSkillFilesInRepoWithPool(
          workerPool,
          owner,
          repo,
          item.path,
        );
        skillFiles.push(...subFiles);
      }
    }
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      client.isLimited = true;
      if (error.response?.headers?.["x-ratelimit-reset"]) {
        client.rateLimitReset =
          parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
      }
    }
  }

  return skillFiles;
}

/**
 * Fetch file content from GitHub
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
export async function fetchFileContent(octokit, owner, repo, filePath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    updateRateLimitFromResponse(response);

    if (!response.data.content) {
      return null;
    }

    return Buffer.from(response.data.content, "base64").toString("utf-8");
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      await handleRateLimitError(error);
    }
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
export async function fetchRepoDetails(octokit, owner, repo) {
  try {
    const response = await octokit.rest.repos.get({ owner, repo });
    updateRateLimitFromResponse(response);
    return response.data;
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      await handleRateLimitError(error);
    }
    return null;
  }
}

/**
 * Get latest commit hash for a file
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function getLatestCommitHash(octokit, owner, repo, filePath) {
  try {
    const response = await octokit.rest.repos.listCommits({
      owner,
      repo,
      path: filePath,
      per_page: 1,
    });
    updateRateLimitFromResponse(response);
    return response.data.length > 0
      ? response.data[0].sha.substring(0, 12)
      : "";
  } catch {
    return "";
  }
}

/**
 * List files in a skill directory
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} skillPath
 * @returns {Promise<string[]>}
 */
export async function listSkillFiles(octokit, owner, repo, skillPath) {
  if (!skillPath || skillPath === ".") {
    return [];
  }

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: skillPath,
    });

    updateRateLimitFromResponse(response);

    if (Array.isArray(response.data)) {
      return response.data
        .filter((f) => f.type === "file" || f.type === "dir")
        .map((f) => f.path);
    }
  } catch {
    // Return empty on error
  }

  return [];
}

/**
 * Process a SKILL.md file and create manifest
 * @param {Octokit} octokit
 * @param {Object} repoInfo
 * @param {Object} fileInfo
 * @param {Object} repoDetails
 * @returns {Promise<Object|null>}
 */
export async function processSkillFile(
  octokit,
  repoInfo,
  fileInfo,
  repoDetails,
) {
  const owner = repoInfo.owner.login;
  const repo = repoInfo.name;
  const filePath = fileInfo.path;

  if (!filePath.endsWith(CONFIG.skillFilename)) {
    return null;
  }

  // 1. Get commit hash first
  const commitHash = await getLatestCommitHash(octokit, owner, repo, filePath);

  // 2. Check cache
  const cacheKey = CrawlerCache.generateSkillKey(owner, repo, filePath);
  const cached = crawlerCache.getSkill(cacheKey);

  if (cached && commitHash && cached.commitHash === commitHash) {
    console.log(`  Using cached skill for ${owner}/${repo}/${filePath}`);
    const manifest = cached.manifest;
    // Update stats from current repoDetails
    manifest.stats = {
      stars: repoDetails?.stargazers_count || 0,
      forks: repoDetails?.forks_count || 0,
      lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
    };
    return manifest;
  }

  // 3. Fetch and process (Cache Miss)
  const content = await fetchFileContent(octokit, owner, repo, filePath);
  if (!content) return null;

  const parsed = parseSkillContent(content);
  if (!parsed.isValid) {
    return null;
  }

  const skillPath = determineSkillPath(filePath);
  const id = generateSkillId(owner, repo, skillPath);
  const branch = repoDetails?.default_branch || "main";
  const detailsUrl = `https://github.com/${owner}/${repo}/${branch}/${filePath}`;

  const files = await listSkillFiles(octokit, owner, repo, skillPath);
  // commitHash is already fetched

  const skillName = parsed.name || path.basename(skillPath) || repo;
  const skillDescription = parsed.description || `Skill from ${owner}/${repo}`;

  const manifest = {
    id,
    name: skillName,
    displayName: generateDisplayName(skillName),
    description: skillDescription,
    categories: categorizeSkill(skillName, skillDescription),
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
      latestCommitHash: commitHash,
      downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
    },
    files: files.length > 0 ? files.slice(0, 20) : [filePath],
    stats: {
      stars: repoDetails?.stargazers_count || 0,
      forks: repoDetails?.forks_count || 0,
      lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
    },
  };

  if (parsed.version) {
    manifest.compatibility = { minAgentVersion: "0.1.0" };
  }

  // 4. Save to cache (only if we have a valid commit hash)
  if (commitHash) {
    crawlerCache.setSkill(cacheKey, {
      commitHash,
      manifest,
      fetchedAt: new Date().toISOString(),
    });
  }

  return manifest;
}

/**
 * Process SKILL.md file using worker pool
 * @param {WorkerPool} workerPool
 * @param {Object} repoInfo
 * @param {Object} fileInfo
 * @param {Object} repoDetails
 * @param {string} repoCommitHash - The repository's latest commit hash
 * @returns {Promise<Object|null>}
 */
export async function processSkillFileWithPool(
  workerPool,
  repoInfo,
  fileInfo,
  repoDetails,
  repoCommitHash = "",
) {
  while (workerPool.allClientsLimited()) {
    if (shouldStopForTimeout()) {
      return null;
    }
    const nextReset = workerPool.getNextResetTime();
    const waitTime = nextReset - Date.now();
    if (waitTime > 0) {
      if (waitTime > 10000) {
        logRateLimitWait(Math.ceil(waitTime / 1000));
      }
      await sleep(Math.min(waitTime, 30000));
    } else {
      await sleep(1000);
    }
  }

  const client = workerPool.getClient();
  const owner = repoInfo.owner.login;
  const repo = repoInfo.name;
  const filePath = fileInfo.path;

  try {
    if (!filePath.endsWith(CONFIG.skillFilename)) {
      return null;
    }

    // Calculate skill directory path (e.g., "skills/doc-coauthoring" from "skills/doc-coauthoring/SKILL.md")
    const skillDirPath = path.dirname(filePath);

    // 1. Get skill directory's latest commit hash (not just SKILL.md)
    let skillDirCommitHash = "";
    try {
      const commitsResponse = await client.octokit.rest.repos.listCommits({
        owner,
        repo,
        path: skillDirPath,  // Use directory path to detect any file changes in skill folder
        per_page: 1,
      });
      workerPool.updateClientRateLimit(client, commitsResponse);

      if (commitsResponse.data.length > 0) {
        skillDirCommitHash = commitsResponse.data[0].sha.substring(0, 12);
      }
    } catch {
      // Ignore
    }

    // 2. Check cache using skill directory path
    const cacheKey = CrawlerCache.generateSkillKey(owner, repo, skillDirPath);
    const cached = crawlerCache.getSkill(cacheKey);

    if (cached && skillDirCommitHash && cached.commitHash === skillDirCommitHash) {
      // console.log(`  Using cached skill for ${owner}/${repo}/${skillDirPath}`); // Optional: reduce noise
      const manifest = cached.manifest;
      // Update stats from current repoDetails
      manifest.stats = {
        stars: repoDetails?.stargazers_count || 0,
        forks: repoDetails?.forks_count || 0,
        lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
      };
      // Update repository.latestCommitHash if repoCommitHash is provided
      if (repoCommitHash && manifest.repository) {
        manifest.repository.latestCommitHash = repoCommitHash;
      }
      return manifest;
    }

    // 3. Fetch and process (Cache Miss)
    const response = await client.octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    workerPool.updateClientRateLimit(client, response);

    if (!response.data.content) {
      return null;
    }

    const content = Buffer.from(response.data.content, "base64").toString(
      "utf-8",
    );
    const parsed = parseSkillContent(content);

    if (!parsed.isValid) {
      return null;
    }

    const skillPath = determineSkillPath(filePath);
    const id = generateSkillId(owner, repo, skillPath);
    const branch = repoDetails?.default_branch || "main";
    const detailsUrl = `https://github.com/${owner}/${repo}/${branch}/${filePath}`;

    // Get files in skill directory (reuse skillDirPath)
    let files = [filePath];

    if (skillDirPath !== ".") {
      try {
        const dirResponse = await client.octokit.rest.repos.getContent({
          owner,
          repo,
          path: skillDirPath,
        });
        workerPool.updateClientRateLimit(client, dirResponse);

        if (Array.isArray(dirResponse.data)) {
          files = dirResponse.data
            .filter((f) => f.type === "file" || f.type === "dir")
            .map((f) => f.path);
        }
      } catch {
        // Use just the SKILL.md file
      }
    }

    // commitHash is already fetched

    const skillName = parsed.name || path.basename(skillPath) || repo;
    const skillDescription =
      parsed.description || `Skill from ${owner}/${repo}`;

    const manifest = {
      id,
      name: skillName,
      displayName: generateDisplayName(skillName),
      description: skillDescription,
      categories: categorizeSkill(skillName, skillDescription),
      details: detailsUrl,
      author: {
        name: owner,
        url: `https://github.com/${owner}`,
        avatar: `https://github.com/${owner}.png`,
      },
      version: parsed.version || "0.0.0",
      commitHash: skillDirCommitHash,  // Skill directory commit hash
      tags: parsed.tags,
      repository: {
        url: `https://github.com/${owner}/${repo}`,
        branch,
        path: skillPath,
        latestCommitHash: repoCommitHash || skillDirCommitHash,  // Repo commit hash (fallback to skill dir hash)
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
      manifest.compatibility = { minAgentVersion: "0.1.0" };
    }

    // 4. Save to cache (only if we have a valid commit hash)
    if (skillDirCommitHash) {
      crawlerCache.setSkill(cacheKey, {
        commitHash: skillDirCommitHash,
        manifest,
        fetchedAt: new Date().toISOString(),
      });
    }

    return manifest;
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      client.isLimited = true;
    }
    return null;
  }
}

/**
 * Crawl priority repositories with repo-level caching
 * @param {WorkerPool} workerPool
 * @param {string[]} priorityRepos
 * @returns {Promise<Object[]>}
 */
export async function crawlPriorityRepos(workerPool, priorityRepos) {
  const prioritySkills = [];

  if (!priorityRepos || priorityRepos.length === 0) {
    console.log("No priority repositories configured.");
    return prioritySkills;
  }

  console.log(`Crawling ${priorityRepos.length} priority repositories (parallel with caching)...`);

  const tasks = priorityRepos.map((repoFullName) => async () => {
    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) return null;
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        if (waitTime > 10000) {
          logRateLimitWait(Math.ceil(waitTime / 1000));
        }
        await sleep(Math.min(waitTime, 30000));
      } else {
        await sleep(1000);
      }
    }

    if (shouldStopForTimeout()) return null;

    const [owner, repo] = repoFullName.split("/");
    if (!owner || repo === undefined) {
      console.log(`  Invalid repository format: ${repoFullName}`);
      return null;
    }

    if (repoFullName === `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`) {
      console.log(`  Skipping ${repoFullName}: This is our own repository`);
      return null;
    }

    console.log(`\n  Repository: ${repoFullName}`);

    try {
      // Fetch repository details with retry on rate limit
      let repoDetails = null;
      while (!repoDetails) {
        if (shouldStopForTimeout()) return null;

        while (workerPool.allClientsLimited()) {
          if (shouldStopForTimeout()) return null;
          const nextReset = workerPool.getNextResetTime();
          const waitTime = nextReset - Date.now();
          if (waitTime > 0) {
            await sleep(Math.min(waitTime + 1000, 30000));
          } else {
            await sleep(1000);
          }
        }

        const client = workerPool.getClient();
        try {
          const response = await client.octokit.rest.repos.get({ owner, repo });
          workerPool.updateClientRateLimit(client, response);
          repoDetails = response.data;
        } catch (error) {
          if (error.status === 403 || error.status === 429) {
            client.isLimited = true;
            if (error.response?.headers?.["x-ratelimit-reset"]) {
              client.rateLimitReset =
                parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
            }
          } else if (error.status === 404) {
            console.log(`  Repository ${repoFullName} not found`);
            return null;
          } else {
            console.error(`  Error fetching ${repoFullName}: ${error.message}`);
            return null;
          }
        }
      }

      // Use processRepoWithCache for repo-level caching
      const repoSkills = await processRepoWithCache(
        workerPool,
        owner,
        repo,
        repoDetails,
        "priority"
      );

      return repoSkills;
    } catch (error) {
      console.error(`  Error processing ${repoFullName}: ${error.message}`);
      return null;
    }
  });

  const taskResults = await workerPool.addTasks(tasks);

  for (const repoSkills of taskResults) {
    if (repoSkills && repoSkills.length > 0) {
      prioritySkills.push(...repoSkills);
    }
  }

  return prioritySkills;
}
