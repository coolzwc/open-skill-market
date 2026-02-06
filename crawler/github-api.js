import path from "path";
import { CONFIG } from "./config.js";
import {
  sleep,
  generateSkillId,
  generateDisplayName,
  determineSkillPath,
} from "./utils.js";
import { shouldStopForTimeout, logRateLimitWait } from "./rate-limit.js";
import { parseSkillContent, categorizeSkill } from "./skill-parser.js";
import { crawlerCache, CrawlerCache } from "./cache.js";

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Directories to skip when recursively scanning repos for SKILL.md files.
 * Build artifacts, dependency dirs, and well-known hidden dirs are skipped,
 * but custom hidden dirs like .claude-plugin, .cursor are allowed.
 */
const SKIP_DIRS = new Set([
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

// ─── Core API helpers ───────────────────────────────────────────────────────

/**
 * Get the latest commit hash for a repository's default branch.
 * Retries with other clients on rate limit.
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{commitHash: string, pushedAt: string}|null>}
 */
export async function getRepoLatestCommit(workerPool, owner, repo) {
  const maxAttempts = workerPool.clients.length + 1; // try each client at most once, plus one retry cycle

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
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
          pushedAt:
            response.data[0].commit.committer?.date || new Date().toISOString(),
        };
      }
      return null;
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        client.core.isLimited = true;
        if (error.response?.headers?.["x-ratelimit-reset"]) {
          client.core.resetTime =
            parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
        }
        // Retry with another client
        continue;
      }
      // Non-rate-limit error → give up
      return null;
    }
  }

  return null;
}

// ─── Repo processing with cache ─────────────────────────────────────────────

/**
 * Process a repository with cache optimization.
 * Returns cached skills if repo hasn't changed, otherwise crawls the repo.
 * When using cache, avoids API calls for repo details (stars/forks) - uses cached stats.
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @param {Object} repoDetails - Only used when cache miss (can be null for cache-first approach)
 * @param {string} source - 'priority' or 'github'
 * @returns {Promise<Object[]>}
 */
export async function processRepoWithCache(
  workerPool,
  owner,
  repo,
  repoDetails,
  source,
) {
  const repoFullName = `${owner}/${repo}`;

  // Get repo's latest commit (lightweight API call)
  const latestCommit = await getRepoLatestCommit(workerPool, owner, repo);
  if (!latestCommit) {
    console.log(`  Could not get latest commit for ${repoFullName}`);
    return [];
  }

  // Check cache: repo commitHash unchanged → use cached data (including cached stats)
  // No need to pass repoStats - cache stores stats internally to avoid extra API calls
  const cachedRepo = crawlerCache.getRepo(owner, repo);
  if (cachedRepo && cachedRepo.commitHash === latestCommit.commitHash) {
    const cachedSkills = cachedRepo.skills || [];

    if (cachedSkills.length === 0) {
      return [];
    }

    console.log(
      `  Using cached ${cachedSkills.length} skill(s) for ${repoFullName} (no changes, using cached stats)`,
    );
    for (const skill of cachedSkills) {
      skill.source = source;
    }
    return cachedSkills;
  }

  // Repo has changed or not in cache → crawl it
  console.log(`  Scanning ${repoFullName} for SKILL.md files...`);

  const skillFiles = await findSkillFilesInRepoSmart(workerPool, owner, repo);

  // Build repo info for cache (stats from repoDetails or default)
  const repoStats = {
    stars: repoDetails?.stargazers_count || 0,
    forks: repoDetails?.forks_count || 0,
    lastUpdated: repoDetails?.pushed_at || latestCommit.pushedAt,
  };
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const branch = repoDetails?.default_branch || "main";

  if (skillFiles.length === 0) {
    crawlerCache.setRepo(owner, repo, {
      commitHash: latestCommit.commitHash,
      skillKeys: [],
      url: repoUrl,
      branch,
      stats: repoStats,
      fetchedAt: new Date().toISOString(),
    });
    return [];
  }

  console.log(
    `  Found ${skillFiles.length} SKILL.md file(s) in ${repoFullName}`,
  );

  const repoSkills = [];
  let timedOut = false;
  for (const filePath of skillFiles) {
    if (shouldStopForTimeout()) {
      timedOut = true;
      break;
    }

    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) {
        timedOut = true;
        break;
      }
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        await sleep(Math.min(waitTime + 1000, 30000));
      } else {
        await sleep(1000);
      }
    }
    if (timedOut) break;

    if (shouldStopForTimeout()) {
      timedOut = true;
      break;
    }

    const fileInfo = { path: filePath };
    const repoInfo = { owner: { login: owner }, name: repo };

    const manifest = await processSkillFileWithPool(
      workerPool,
      repoInfo,
      fileInfo,
      repoDetails,
      latestCommit.commitHash,
    );
    if (manifest) {
      manifest.source = source;
      repoSkills.push(manifest);
    }
  }

  // Only update repo cache when ALL skills were processed.
  // If timed out mid-way, skip setRepo so next run re-scans this repo.
  if (!timedOut) {
    const skillKeys = repoSkills.map((s) =>
      CrawlerCache.generateSkillKey(owner, repo, s.repository.path),
    );
    crawlerCache.setRepo(owner, repo, {
      commitHash: latestCommit.commitHash,
      skillKeys,
      url: repoUrl,
      branch,
      stats: repoStats,
      fetchedAt: new Date().toISOString(),
    });
  } else {
    console.log(
      `  ⚠ Timeout during ${repoFullName}: processed ${repoSkills.length}/${skillFiles.length} skill(s), repo cache NOT updated (will re-scan next run)`,
    );
  }

  return repoSkills;
}

// ─── Topic search (Search API) ──────────────────────────────────────────────

/**
 * Search for repositories by topic using worker pool.
 * Uses Search API (10 req/min) — tracked via search bucket.
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

    // Wait for Search API rate limit reset if all clients are limited
    while (workerPool.allSearchClientsLimited()) {
      if (shouldStopForTimeout()) {
        return repos;
      }
      const nextReset = workerPool.getNextSearchResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        logRateLimitWait(Math.ceil(waitTime / 1000));
        await sleep(Math.min(waitTime + 1000, 60000));
      } else {
        await sleep(5000);
      }
    }

    const client = workerPool.getSearchClient();
    if (!client) {
      // All search clients limited — shouldn't happen after the wait loop, but be safe
      break;
    }

    try {
      const response = await client.octokit.rest.search.repos({
        q: `topic:${topic}`,
        sort: "stars",
        order: "desc",
        per_page: CONFIG.perPage,
        page,
      });

      workerPool.updateSearchRateLimit(client, response);
      repos.push(...response.data.items);

      console.log(
        `    Page ${page}: Found ${response.data.items.length} repos (Total: ${repos.length})`,
      );

      if (response.data.items.length < CONFIG.perPage) {
        break;
      }

      await sleep(CONFIG.rateLimit.waitAfterSearch);
    } catch (error) {
      if (error.status === 403 || error.status === 429) {
        const resetTime = error.response?.headers?.["x-ratelimit-reset"]
          ? parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000
          : null;
        workerPool.markSearchLimited(client, resetTime);
        // Retry this page with next available client
        page--;
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

    // Wait for Search API rate limit reset
    while (workerPool.allSearchClientsLimited()) {
      if (shouldStopForTimeout()) {
        console.log("  Stopping search due to execution timeout.");
        break;
      }
      const nextReset = workerPool.getNextSearchResetTime();
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

    await sleep(CONFIG.rateLimit.waitAfterTopicSearch);
  }

  console.log(`\nTotal unique repositories found: ${allRepos.size}`);
  return allRepos;
}

// ─── SKILL.md file discovery ────────────────────────────────────────────────

/**
 * Find SKILL.md files using recursive directory traversal (worker pool).
 * Fallback when Search API is exhausted.
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

    for (const item of response.data) {
      if (item.type === "file" && item.name === CONFIG.skillFilename) {
        skillFiles.push(item.path);
      } else if (item.type === "dir" && !SKIP_DIRS.has(item.name)) {
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
      client.core.isLimited = true;
      if (error.response?.headers?.["x-ratelimit-reset"]) {
        client.core.resetTime =
          parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
      }
    }
  }

  return skillFiles;
}

/**
 * Find SKILL.md files using GitHub Code Search API (search.code).
 * Uses Search API quota (10 req/min) — shared with search.repos.
 *
 * Each client has its own quota; round-robin switches clients on limit.
 * Returns null only when ALL clients are search-limited (caller should fallback).
 *
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string[]|null>} Array of file paths, or null if all clients limited
 */
export async function findSkillFilesWithCodeSearch(workerPool, owner, repo) {
  // Use CodeSearch bucket (separate from Search bucket for repos)
  const client = workerPool.getCodeSearchClient();
  if (!client || client.codeSearch.isLimited) {
    return null; // All clients code-search-limited → caller should fallback
  }

  const query = `filename:${CONFIG.skillFilename} repo:${owner}/${repo}`;

  try {
    const items = await client.octokit.paginate(
      client.octokit.rest.search.code,
      {
        q: query,
        per_page: 100,
      },
      (response) => {
        workerPool.updateCodeSearchRateLimit(client, response);
        return response.data;
      },
    );

    const paths = items.map((item) => item.path);
    console.log(
      `  Code Search (${client.label}) found ${paths.length} SKILL.md file(s) in ${owner}/${repo}`,
    );
    return paths;
  } catch (error) {
    if (error.status === 403 || error.status === 422 || error.status === 429) {
      const resetTime = error.response?.headers?.["x-ratelimit-reset"]
        ? parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000
        : null;
      // Mark codeSearch bucket as limited
      client.codeSearch.isLimited = true;
      if (resetTime) client.codeSearch.resetTime = resetTime;
      return null;
    }
    console.warn(`  Code Search error for ${owner}/${repo}: ${error.message}`);
    return [];
  }
}

/**
 * Smart SKILL.md finder — Code Search with client round-robin, falls back to recursive.
 *
 * Strategy:
 * 1. Try Code Search (1 API call vs potentially dozens for recursive)
 * 2. If client gets limited, try another client
 * 3. Only fall back to recursive when ALL clients' Search quota is exhausted
 *
 * @param {WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string[]>}
 */
export async function findSkillFilesInRepoSmart(workerPool, owner, repo) {
  const codeSearchResult = await findSkillFilesWithCodeSearch(
    workerPool,
    owner,
    repo,
  );

  if (codeSearchResult !== null) {
    return codeSearchResult;
  }

  // Client got limited — another client might be available
  if (!workerPool.allSearchClientsLimited()) {
    const retryResult = await findSkillFilesWithCodeSearch(
      workerPool,
      owner,
      repo,
    );
    if (retryResult !== null) {
      return retryResult;
    }
  }

  // All Search clients exhausted → fall back to recursive directory traversal
  console.log(
    `  All Search clients limited, falling back to recursive scan for ${owner}/${repo}`,
  );
  return await findSkillFilesInRepoWithPool(workerPool, owner, repo);
}

// ─── Skill file processing ──────────────────────────────────────────────────

/**
 * Process a SKILL.md file and create manifest (worker pool version).
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

    // Calculate skill directory path
    const skillDirPath = path.dirname(filePath);

    // 1. Get skill directory's latest commit hash
    let skillDirCommitHash = "";
    try {
      const commitsResponse = await client.octokit.rest.repos.listCommits({
        owner,
        repo,
        path: skillDirPath,
        per_page: 1,
      });
      workerPool.updateClientRateLimit(client, commitsResponse);

      if (commitsResponse.data.length > 0) {
        skillDirCommitHash = commitsResponse.data[0].sha.substring(0, 12);
      }
    } catch (error) {
      // Failed to get commit hash, will use empty string
      // This is non-critical - skill will still be processed
      if (process.env.DEBUG) {
        console.debug(`  Could not get commit hash for ${skillDirPath}: ${error.message}`);
      }
    }

    // 2. Determine skill path
    const skillPath = determineSkillPath(filePath);

    // 3. Check cache
    const cacheKey = CrawlerCache.generateSkillKey(owner, repo, skillPath);
    const cached = crawlerCache.getSkill(cacheKey);

    if (
      cached &&
      skillDirCommitHash &&
      cached.commitHash === skillDirCommitHash
    ) {
      const manifest = cached.manifest;
      manifest.commitHash = skillDirCommitHash;
      manifest.stats = {
        stars: repoDetails?.stargazers_count || 0,
        forks: repoDetails?.forks_count || 0,
        lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
      };
      return manifest;
    }

    // 4. Fetch and process (cache miss)
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

    const id = generateSkillId(owner, repo, skillPath);
    const branch = repoDetails?.default_branch || "main";
    const detailsUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;

    // Get files in skill directory
    let files = [filePath];

    if (skillPath !== "") {
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
      } catch (error) {
        // Failed to list directory, use just the SKILL.md file
        if (process.env.DEBUG) {
          console.debug(`  Could not list directory ${skillDirPath}: ${error.message}`);
        }
      }
    }

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
      commitHash: skillDirCommitHash,
      tags: parsed.tags,
      repository: {
        url: `https://github.com/${owner}/${repo}`,
        branch,
        path: skillPath,
        downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
      },
      files: files.slice(0, CONFIG.fileLimits.maxFilesPerSkill),
      stats: {
        stars: repoDetails?.stargazers_count || 0,
        forks: repoDetails?.forks_count || 0,
        lastUpdated: repoDetails?.pushed_at || new Date().toISOString(),
      },
    };

    if (parsed.version) {
      manifest.compatibility = { minAgentVersion: "0.1.0" };
    }

    // 5. Save to cache
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
      client.core.isLimited = true;
    }
    return null;
  }
}

// ─── Global SKILL.md discovery (Phase 4) ────────────────────────────────────

/**
 * Discover repositories containing SKILL.md files using global Code Search.
 * This is a supplementary discovery mechanism to find repos that:
 * - Have SKILL.md files but aren't tagged with any searchTopics
 * - Were missed by topic-based search
 *
 * Note: GitHub Code Search has a hard limit of 1000 results total.
 *
 * @param {WorkerPool} workerPool
 * @param {Set<string>} excludeRepos - Repos to exclude (already processed)
 * @returns {Promise<Map<string, Object>>} Map of repoFullName → repo info object
 */
export async function discoverSkillReposGlobally(workerPool, excludeRepos) {
  console.log("Searching globally for SKILL.md files...");
  const discoveredRepos = new Map();

  // Wait for Code Search API to be available (separate bucket from search.repos)
  while (workerPool.allCodeSearchClientsLimited()) {
    if (shouldStopForTimeout()) {
      console.log("  Stopping global search due to timeout.");
      return discoveredRepos;
    }
    const nextReset = workerPool.getNextCodeSearchResetTime();
    const waitTime = nextReset - Date.now();
    if (waitTime > 0) {
      logRateLimitWait(Math.ceil(waitTime / 1000));
      await sleep(Math.min(waitTime + 1000, 60000));
    } else {
      await sleep(5000);
    }
  }

  const client = workerPool.getCodeSearchClient();
  if (!client) {
    console.log("  No CodeSearch client available for global discovery.");
    return discoveredRepos;
  }

  const query = `filename:${CONFIG.skillFilename}`;

  try {
    // Use pagination but GitHub limits to 1000 total results
    let page = 1;
    let hasMore = true;
    let totalFetched = 0;

    while (hasMore && totalFetched < 1000) {
      if (shouldStopForTimeout()) {
        console.log("  Stopping global search due to timeout.");
        break;
      }

      // Check/wait for Code Search API availability
      while (workerPool.allCodeSearchClientsLimited()) {
        if (shouldStopForTimeout()) {
          return discoveredRepos;
        }
        const nextReset = workerPool.getNextCodeSearchResetTime();
        const waitTime = nextReset - Date.now();
        if (waitTime > 0) {
          logRateLimitWait(Math.ceil(waitTime / 1000));
          await sleep(Math.min(waitTime + 1000, 60000));
      } else {
        await sleep(CONFIG.rateLimit.waitOnLimitedFallback);
      }
    }

    const searchClient = workerPool.getCodeSearchClient();

      try {
        const response = await searchClient.octokit.rest.search.code({
          q: query,
          per_page: 100,
          page,
        });

        workerPool.updateCodeSearchRateLimit(searchClient, response);

        const items = response.data.items;
        totalFetched += items.length;

        // Group by repository
        for (const item of items) {
          const repoFullName = item.repository.full_name;

          // Skip already processed repos
          if (excludeRepos.has(repoFullName)) {
            continue;
          }

          // Skip our own repo
          if (
            repoFullName ===
            `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`
          ) {
            continue;
          }

          if (!discoveredRepos.has(repoFullName)) {
            discoveredRepos.set(repoFullName, {
              full_name: repoFullName,
              owner: { login: item.repository.owner.login },
              name: item.repository.name,
              // These fields will be populated when we fetch repo details
              stargazers_count: 0,
              forks_count: 0,
              default_branch: "main",
              pushed_at: null,
              fork: false,
            });
          }
        }

        console.log(
          `    Page ${page}: ${items.length} results, ${discoveredRepos.size} new repos discovered`,
        );

        if (items.length < 100 || totalFetched >= 1000) {
          hasMore = false;
        } else {
          page++;
          await sleep(CONFIG.rateLimit.waitAfterSearch);
        }
      } catch (error) {
        if (error.status === 403 || error.status === 422 || error.status === 429) {
          const resetTime = error.response?.headers?.["x-ratelimit-reset"]
            ? parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000
            : null;
          // Mark codeSearch bucket as limited
          searchClient.codeSearch.isLimited = true;
          if (resetTime) searchClient.codeSearch.resetTime = resetTime;
          // Try to continue with another client
          if (workerPool.allCodeSearchClientsLimited()) {
            console.log("  All CodeSearch clients limited, stopping global search.");
            break;
          }
          // Retry same page with next client
        } else {
          console.error(`  Global search error: ${error.message}`);
          break;
        }
      }
    }

    console.log(
      `\nGlobal discovery complete: ${discoveredRepos.size} new repos found (${totalFetched} total results)`,
    );
  } catch (error) {
    console.error(`  Global search failed: ${error.message}`);
  }

  return discoveredRepos;
}

// ─── Batch repo processing ──────────────────────────────────────────────────

/**
 * Process a batch of repositories in parallel with rate limit handling.
 * Used by Phase 3 (topic search) and Phase 4 (global discovery).
 *
 * @param {WorkerPool} workerPool
 * @param {Array<{repoFullName: string, repo: Object}>} reposToProcess
 * @param {string} source - 'github' or other source identifier
 * @param {Object} options
 * @param {boolean} options.fetchRepoDetails - Whether to fetch full repo details first
 * @returns {Promise<Object[]>} Array of skill manifests
 */
export async function processReposInParallel(
  workerPool,
  reposToProcess,
  source,
  options = {}
) {
  const { fetchRepoDetails = false } = options;
  const results = [];
  let processedCount = 0;

  const tasks = reposToProcess.map(({ repoFullName, repo }) => async () => {
    // Wait for available client
    const available = await workerPool.waitForAvailableClient(shouldStopForTimeout);
    if (!available) return null;

    if (shouldStopForTimeout()) return null;

    try {
      let repoDetails = repo;

      // Optionally fetch full repo details (for global discovery where we only have partial info)
      if (fetchRepoDetails) {
        const client = workerPool.getClient();
        try {
          const response = await client.octokit.rest.repos.get({
            owner: repo.owner.login,
            repo: repo.name,
          });
          workerPool.updateClientRateLimit(client, response);
          repoDetails = response.data;
        } catch (error) {
          if (error.status === 403 || error.status === 429) {
            client.core.isLimited = true;
          }
          // Use partial info if full fetch fails
        }
      }

      const repoSkills = await processRepoWithCache(
        workerPool,
        repo.owner.login,
        repo.name,
        repoDetails,
        source,
      );

      processedCount++;
      if (processedCount % 10 === 0) {
        const stats = workerPool.getStats();
        const skillCount = results.reduce((sum, s) => sum + (s?.length || 0), 0) + repoSkills.length;
        console.log(
          `  Progress: ${processedCount}/${reposToProcess.length} repos, ` +
            `${skillCount} skills found, ` +
            `${stats.activeClients}/${stats.totalClients} clients active`,
        );
      }

      return repoSkills;
    } catch (error) {
      console.error(`  Error processing ${repoFullName}: ${error.message}`);
      return null;
    }
  });

  const taskResults = await workerPool.addTasks(tasks);

  for (const repoSkills of taskResults) {
    if (repoSkills && repoSkills.length > 0) {
      results.push(...repoSkills);
    }
  }

  return results;
}

// ─── Priority repositories ─────────────────────────────────────────────────

/**
 * Crawl priority repositories with repo-level caching.
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

  console.log(
    `Crawling ${priorityRepos.length} priority repositories (parallel with caching)...`,
  );

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
    if (!owner || !repo) {
      console.log(`  Invalid repository format: ${repoFullName}`);
      return null;
    }

    if (repoFullName === `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`) {
      console.log(`  Skipping ${repoFullName}: This is our own repository`);
      return null;
    }

    console.log(`\n  Repository: ${repoFullName}`);

    try {
      // Fetch repository details with retry (max 3 attempts to avoid infinite loop)
      let repoDetails = null;
      const maxRetries = 3;

      for (let attempt = 0; attempt < maxRetries && !repoDetails; attempt++) {
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
            client.core.isLimited = true;
            if (error.response?.headers?.["x-ratelimit-reset"]) {
              client.core.resetTime =
                parseInt(error.response.headers["x-ratelimit-reset"], 10) *
                1000;
            }
            // Will retry with another client on next iteration
          } else if (error.status === 404) {
            console.log(`  Repository ${repoFullName} not found`);
            return null;
          } else {
            console.error(`  Error fetching ${repoFullName}: ${error.message}`);
            return null;
          }
        }
      }

      if (!repoDetails) {
        console.log(
          `  Failed to fetch ${repoFullName} after ${maxRetries} attempts`,
        );
        return null;
      }

      const repoSkills = await processRepoWithCache(
        workerPool,
        owner,
        repo,
        repoDetails,
        "priority",
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
