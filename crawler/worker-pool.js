import { Octokit } from "octokit";
import PQueue from "p-queue";
import { CONFIG } from "./config.js";

/**
 * Collect all available GitHub tokens from environment
 * Supports: GITHUB_TOKEN (primary), EXTRA_TOKEN_1 to EXTRA_TOKEN_5 (additional)
 * Stops at the first empty token
 * @returns {string[]} Array of tokens
 */
export function collectGitHubTokens() {
  const tokens = [];

  // Primary token (required)
  if (process.env.GITHUB_TOKEN) {
    tokens.push(process.env.GITHUB_TOKEN);
  }

  // Additional tokens (EXTRA_TOKEN_1 to EXTRA_TOKEN_5)
  // Using EXTRA_TOKEN_ prefix because GitHub Actions reserves GITHUB_ prefix
  for (let i = 1; i <= 5; i++) {
    const token = process.env[`EXTRA_TOKEN_${i}`];
    if (!token) {
      break;
    }
    tokens.push(token);
  }

  return tokens;
}

/**
 * Create a rate limit bucket
 * @param {number} remaining - Initial remaining requests
 * @param {number} limit - Max requests per window
 * @returns {Object} Rate limit bucket
 */
function createBucket(remaining, limit = remaining) {
  return {
    limit,         // max requests per window
    remaining,     // current remaining
    used: 0,       // used in current window
    resetTime: null,
    isLimited: false,
  };
}

/**
 * Refresh a bucket if its reset time has passed
 * @param {Object} bucket - Rate limit bucket
 * @param {string} label - Client label for logging
 * @param {string} type - 'Core' or 'Search'
 * @returns {boolean} Whether the bucket was refreshed
 */
function refreshBucket(bucket, label, type) {
  if (bucket.isLimited && bucket.resetTime && Date.now() >= bucket.resetTime) {
    bucket.isLimited = false;
    bucket.remaining = bucket.limit;
    bucket.used = 0;
    bucket.resetTime = null;
    console.log(`  ${label} ${type} API rate limit reset, resuming...`);
    return true;
  }
  return false;
}

/**
 * Update bucket from Rate Limit API response
 * @param {Object} bucket - Rate limit bucket
 * @param {Object} resourceData - { limit, remaining, reset, used }
 */
function updateBucketFromRateLimitAPI(bucket, resourceData) {
  if (!resourceData) return;
  
  bucket.limit = resourceData.limit;
  bucket.remaining = resourceData.remaining;
  bucket.used = resourceData.used;
  bucket.resetTime = resourceData.reset * 1000; // Convert to ms
  bucket.isLimited = resourceData.remaining <= (bucket.limit <= 30 ? 1 : 10);
}

/**
 * Update a bucket from API response headers
 * @param {Object} bucket - Rate limit bucket
 * @param {Object} headers - Response headers
 * @param {string} label - Client label for logging
 * @param {string} type - 'Core' or 'Search'
 */
function updateBucketFromHeaders(bucket, headers, label, type) {
  if (!headers) return;

  if (headers["x-ratelimit-remaining"] !== undefined) {
    bucket.remaining = parseInt(headers["x-ratelimit-remaining"], 10);
  }
  if (headers["x-ratelimit-limit"] !== undefined) {
    bucket.limit = parseInt(headers["x-ratelimit-limit"], 10);
  }
  if (headers["x-ratelimit-used"] !== undefined) {
    bucket.used = parseInt(headers["x-ratelimit-used"], 10);
  }
  if (headers["x-ratelimit-reset"]) {
    bucket.resetTime = parseInt(headers["x-ratelimit-reset"], 10) * 1000;
  }

  // Dynamic threshold based on limit (10 for core, 1 for search)
  const threshold = bucket.limit <= 30 ? 1 : 10;
  if (bucket.remaining <= threshold && !bucket.isLimited) {
    bucket.isLimited = true;
    const resetIn = bucket.resetTime
      ? Math.ceil((bucket.resetTime - Date.now()) / 1000)
      : 60;
    console.log(`  ${label} ${type} API rate limited (${bucket.remaining}/${bucket.limit} remaining), resets in ${resetIn}s`);
  }
}

/**
 * Mark a bucket as limited from an error response
 * @param {Object} bucket - Rate limit bucket
 * @param {Object} errorResponse - Error response object
 */
function markBucketLimited(bucket, errorResponse) {
  bucket.isLimited = true;
  if (errorResponse?.headers?.["x-ratelimit-reset"]) {
    bucket.resetTime = parseInt(errorResponse.headers["x-ratelimit-reset"], 10) * 1000;
  }
}

/**
 * Create a client object with separate rate limit buckets for each API type
 * @param {Octokit} octokit - Octokit instance
 * @param {string} label - Client label
 * @param {boolean} isAuthenticated - Whether client has auth token
 * @returns {Object} Client object
 */
function createClient(octokit, label, isAuthenticated = true) {
  // Default limits based on authentication status
  const coreLimit = isAuthenticated ? 5000 : 60;
  const searchLimit = isAuthenticated ? 30 : 10;
  const codeSearchLimit = isAuthenticated ? 30 : 10;
  
  return {
    octokit,
    label,
    isAuthenticated,
    core: createBucket(coreLimit, coreLimit),           // Core API: repos.get, repos.getContent, etc.
    search: createBucket(searchLimit, searchLimit),      // Search API: search.repos (per minute)
    codeSearch: createBucket(codeSearchLimit, codeSearchLimit), // Code Search: search.code (per minute)
    // Legacy fields for backward compatibility
    get rateLimitRemaining() { return this.core.remaining; },
    set rateLimitRemaining(v) { this.core.remaining = v; },
    get rateLimitReset() { return this.core.resetTime; },
    set rateLimitReset(v) { this.core.resetTime = v; },
    get isLimited() { return this.core.isLimited; },
    set isLimited(v) { this.core.isLimited = v; },
  };
}

/**
 * Worker pool for parallel GitHub API requests with multiple tokens.
 * Manages separate Core API and Search API rate limits per client,
 * with independent round-robin selection for each API type.
 */
export class WorkerPool {
  constructor() {
    this.tokens = collectGitHubTokens();
    this.clients = [];
    this.coreIndex = 0;        // round-robin pointer for Core API
    this.searchIndex = 0;      // round-robin pointer for Search API
    this.codeSearchIndex = 0;  // round-robin pointer for Code Search API
    this.queue = null;

    this._initClients();
    this._initQueue();
  }

  _initClients() {
    if (this.tokens.length === 0) {
      console.warn(
        "Warning: No GITHUB_TOKEN set. API rate limits will be severely restricted (60 req/hour).",
      );
      console.warn(
        "Set GITHUB_TOKEN for 5000 req/hour. See: https://github.com/settings/tokens",
      );
      const requestTimeout = CONFIG.execution?.requestTimeout ?? 30000;
      this.clients.push(
        createClient(
          new Octokit({ request: { timeout: requestTimeout } }),
          "unauthenticated",
          false,
        ),
      );
    } else {
      const requestTimeout = CONFIG.execution?.requestTimeout ?? 30000;
      console.log(`Initializing ${this.tokens.length} GitHub client(s)...`);
      for (let i = 0; i < this.tokens.length; i++) {
        const token = this.tokens[i];
        const label = i === 0 ? "GITHUB_TOKEN" : `EXTRA_TOKEN_${i}`;
        console.log(`  - Client ${i + 1}: ${label}`);
        this.clients.push(
          createClient(
            new Octokit({ auth: token, request: { timeout: requestTimeout } }),
            label,
            true,
          ),
        );
      }
    }
  }

  /**
   * Fetch and update rate limits from GitHub Rate Limit API for all clients
   * Should be called once at startup to get accurate limits
   * @returns {Promise<void>}
   */
  async fetchRateLimits() {
    console.log("Checking rate limit status for all clients...");
    
    for (const client of this.clients) {
      try {
        const response = await client.octokit.request("GET /rate_limit");
        const { resources } = response.data;
        
        // Update each bucket from API response
        updateBucketFromRateLimitAPI(client.core, resources.core);
        updateBucketFromRateLimitAPI(client.search, resources.search);
        updateBucketFromRateLimitAPI(client.codeSearch, resources.code_search);
        
        // Log status
        const coreResetIn = Math.max(0, Math.ceil((client.core.resetTime - Date.now()) / 1000));
        const searchResetIn = Math.max(0, Math.ceil((client.search.resetTime - Date.now()) / 1000));
        console.log(`  ${client.label}: ${client.core.remaining}/${client.core.limit} (Core, resets in ${coreResetIn}s), ${client.search.remaining}/${client.search.limit} (Search, resets in ${searchResetIn}s)`);
      } catch (error) {
        console.warn(`  ${client.label}: Failed to fetch rate limit - ${error.message}`);
      }
    }
  }

  /**
   * Get total remaining capacity across all clients
   * @returns {{ core: number, search: number, codeSearch: number }}
   */
  getTotalRemaining() {
    let core = 0, search = 0, codeSearch = 0;
    for (const client of this.clients) {
      core += client.core.remaining;
      search += client.search.remaining;
      codeSearch += client.codeSearch.remaining;
    }
    return { core, search, codeSearch };
  }

  _initQueue() {
    this.queue = new PQueue({
      concurrency: CONFIG.parallel.concurrency,
      intervalCap: CONFIG.parallel.intervalCap,
      interval: CONFIG.parallel.interval,
    });
  }

  // ───── Core API client selection (repos.getContent, repos.listCommits, repos.get, etc.) ─────

  /**
   * Get the next available client for Core API (round-robin with rate limit awareness)
   * @returns {Object} Client object with octokit instance
   */
  getClient() {
    // Try to find an available client starting from current index
    for (let i = 0; i < this.clients.length; i++) {
      const idx = (this.coreIndex + i) % this.clients.length;
      const client = this.clients[idx];

      refreshBucket(client.core, client.label, "Core");

      if (!client.core.isLimited) {
        this.coreIndex = (idx + 1) % this.clients.length;
        return client;
      }
    }

    // All limited, return client with earliest reset
    const sortedClients = [...this.clients].sort((a, b) => {
      if (!a.core.resetTime) return 1;
      if (!b.core.resetTime) return -1;
      return a.core.resetTime - b.core.resetTime;
    });

    return sortedClients[0];
  }

  /**
   * Update client Core API rate limit state from response
   * @param {Object} client
   * @param {Object} response
   */
  updateClientRateLimit(client, response) {
    updateBucketFromHeaders(client.core, response?.headers, client.label, "Core");
  }

  /**
   * Check if all clients are Core API rate limited
   * Also refreshes rate limit status for clients whose reset time has passed
   * @returns {boolean}
   */
  allClientsLimited() {
    for (const client of this.clients) {
      refreshBucket(client.core, client.label, "Core");
    }
    return this.clients.every((c) => c.core.isLimited);
  }

  /**
   * Get the earliest Core API reset time among all clients
   * @returns {number} Timestamp in ms
   */
  getNextResetTime() {
    let minReset = Infinity;
    for (const client of this.clients) {
      if (client.core.resetTime) {
        minReset = Math.min(minReset, client.core.resetTime);
      }
    }
    return minReset === Infinity ? Date.now() + 60000 : minReset;
  }

  // ───── Search API client selection (search.repos — separate bucket) ─────

  /**
   * Get the next available client for Search API (round-robin with rate limit awareness)
   * @returns {Object} Client object with octokit instance
   */
  getSearchClient() {
    for (let i = 0; i < this.clients.length; i++) {
      const idx = (this.searchIndex + i) % this.clients.length;
      const client = this.clients[idx];

      refreshBucket(client.search, client.label, "Search");

      if (!client.search.isLimited) {
        this.searchIndex = (idx + 1) % this.clients.length;
        return client;
      }
    }

    // All limited, return client with earliest reset
    const sortedClients = [...this.clients].sort((a, b) => {
      if (!a.search.resetTime) return 1;
      if (!b.search.resetTime) return -1;
      return a.search.resetTime - b.search.resetTime;
    });

    return sortedClients[0];
  }

  /**
   * Update client Search API rate limit state from response
   * @param {Object} client
   * @param {Object} response
   */
  updateSearchRateLimit(client, response) {
    updateBucketFromHeaders(client.search, response?.headers, client.label, "Search");
  }

  /**
   * Mark a client's Search API as rate limited
   * @param {Object} client
   * @param {number|null} resetTime - Reset timestamp in milliseconds, or null
   */
  markSearchLimited(client, resetTime = null) {
    client.search.isLimited = true;
    if (resetTime) {
      client.search.resetTime = resetTime;
    }
  }

  /**
   * Check if all clients are Search API rate limited
   * @returns {boolean}
   */
  allSearchClientsLimited() {
    for (const client of this.clients) {
      refreshBucket(client.search, client.label, "Search");
    }
    return this.clients.every((c) => c.search.isLimited);
  }

  /**
   * Get the earliest Search API reset time among all clients
   * @returns {number} Timestamp in ms
   */
  getNextSearchResetTime() {
    let minReset = Infinity;
    for (const client of this.clients) {
      if (client.search.resetTime) {
        minReset = Math.min(minReset, client.search.resetTime);
      }
    }
    return minReset === Infinity ? Date.now() + 60000 : minReset;
  }

  // ───── Code Search API client selection (search.code — separate bucket) ─────

  /**
   * Get the next available client for Code Search API
   * @returns {Object} Client object with octokit instance
   */
  getCodeSearchClient() {
    for (let i = 0; i < this.clients.length; i++) {
      const idx = (this.codeSearchIndex + i) % this.clients.length;
      const client = this.clients[idx];

      refreshBucket(client.codeSearch, client.label, "CodeSearch");

      if (!client.codeSearch.isLimited) {
        this.codeSearchIndex = (idx + 1) % this.clients.length;
        return client;
      }
    }

    // All limited, return client with earliest reset
    const sortedClients = [...this.clients].sort((a, b) => {
      if (!a.codeSearch.resetTime) return 1;
      if (!b.codeSearch.resetTime) return -1;
      return a.codeSearch.resetTime - b.codeSearch.resetTime;
    });

    return sortedClients[0];
  }

  /**
   * Update client Code Search API rate limit state from response
   * @param {Object} client
   * @param {Object} response
   */
  updateCodeSearchRateLimit(client, response) {
    updateBucketFromHeaders(client.codeSearch, response?.headers, client.label, "CodeSearch");
  }

  /**
   * Check if all clients are Code Search API rate limited
   * @returns {boolean}
   */
  allCodeSearchClientsLimited() {
    for (const client of this.clients) {
      refreshBucket(client.codeSearch, client.label, "CodeSearch");
    }
    return this.clients.every((c) => c.codeSearch.isLimited);
  }

  /**
   * Get the earliest Code Search API reset time among all clients
   * @returns {number} Timestamp in ms
   */
  getNextCodeSearchResetTime() {
    let minReset = Infinity;
    for (const client of this.clients) {
      if (client.codeSearch.resetTime) {
        minReset = Math.min(minReset, client.codeSearch.resetTime);
      }
    }
    return minReset === Infinity ? Date.now() + 60000 : minReset;
  }

  // ───── Shared utilities ─────

  /**
   * Get count of active (non-Core-limited) clients
   * @returns {number}
   */
  getActiveClientCount() {
    return this.clients.filter((c) => !c.core.isLimited).length;
  }

  /**
   * Wait for an available Core API client.
   * Returns true if a client became available, false if timed out or should stop.
   * @param {Function} shouldStop - Function that returns true if we should stop waiting
   * @param {Object} options - Optional settings
   * @param {number} options.maxWaitPerCycle - Max wait per cycle (default 30000ms)
   * @param {number} options.fallbackWait - Wait time when reset time is unknown (default 1000ms)
   * @param {boolean} options.logWait - Whether to log wait messages (default true)
   * @returns {Promise<boolean>}
   */
  async waitForAvailableClient(shouldStop, options = {}) {
    const {
      maxWaitPerCycle = 30000,
      fallbackWait = 1000,
      logWait = true,
    } = options;

    const { logRateLimitWait } = await import("./rate-limit.js");
    const { sleep } = await import("./utils.js");

    while (this.allClientsLimited()) {
      if (shouldStop && shouldStop()) {
        return false;
      }
      const nextReset = this.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        if (logWait && waitTime > 10000) {
          logRateLimitWait(Math.ceil(waitTime / 1000));
        }
        await sleep(Math.min(waitTime + 1000, maxWaitPerCycle));
      } else {
        await sleep(fallbackWait);
      }
    }
    return true;
  }

  /**
   * Wait for an available Search API client.
   * Returns true if a client became available, false if timed out or should stop.
   * @param {Function} shouldStop - Function that returns true if we should stop waiting
   * @param {Object} options - Optional settings
   * @returns {Promise<boolean>}
   */
  async waitForAvailableSearchClient(shouldStop, options = {}) {
    const {
      maxWaitPerCycle = 60000,
      fallbackWait = 5000,
      logWait = true,
    } = options;

    const { logRateLimitWait } = await import("./rate-limit.js");
    const { sleep } = await import("./utils.js");

    while (this.allSearchClientsLimited()) {
      if (shouldStop && shouldStop()) {
        return false;
      }
      const nextReset = this.getNextSearchResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        if (logWait) {
          logRateLimitWait(Math.ceil(waitTime / 1000));
        }
        await sleep(Math.min(waitTime + 1000, maxWaitPerCycle));
      } else {
        await sleep(fallbackWait);
      }
    }
    return true;
  }

  /**
   * Add multiple tasks and wait for all to complete
   * @param {Function[]} tasks
   * @returns {Promise<any[]>}
   */
  async addTasks(tasks) {
    return Promise.all(tasks.map((task) => this.queue.add(task)));
  }

  /**
   * Wait for all queued tasks to complete
   */
  async drain() {
    await this.queue.onIdle();
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalClients: this.clients.length,
      activeClients: this.getActiveClientCount(),
      activeSearchClients: this.clients.filter((c) => !c.search.isLimited).length,
      queueSize: this.queue.size,
      queuePending: this.queue.pending,
    };
  }
}
