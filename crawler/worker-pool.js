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
 * Worker pool for parallel GitHub API requests with multiple tokens
 */
export class WorkerPool {
  constructor() {
    this.tokens = collectGitHubTokens();
    this.clients = [];
    this.clientIndex = 0;
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
      this.clients.push({
        octokit: new Octokit(),
        rateLimitRemaining: 60,
        rateLimitReset: null,
        isLimited: false,
        label: "unauthenticated",
      });
    } else {
      console.log(`Initializing ${this.tokens.length} GitHub client(s)...`);
      for (let i = 0; i < this.tokens.length; i++) {
        const token = this.tokens[i];
        const label = i === 0 ? "GITHUB_TOKEN" : `EXTRA_TOKEN_${i}`;
        console.log(`  - Client ${i + 1}: ${label}`);
        this.clients.push({
          octokit: new Octokit({ auth: token }),
          rateLimitRemaining: 5000,
          rateLimitReset: null,
          isLimited: false,
          label,
        });
      }
    }
  }

  _initQueue() {
    this.queue = new PQueue({
      concurrency: CONFIG.parallel.concurrency,
      intervalCap: CONFIG.parallel.intervalCap,
      interval: CONFIG.parallel.interval,
    });
  }

  /**
   * Get the next available client (round-robin with rate limit awareness)
   * @returns {Object} Client object with octokit instance
   */
  getClient() {
    for (let i = 0; i < this.clients.length; i++) {
      const idx = (this.clientIndex + i) % this.clients.length;
      const client = this.clients[idx];

      if (client.isLimited && client.rateLimitReset && Date.now() >= client.rateLimitReset) {
        client.isLimited = false;
        client.rateLimitRemaining = 5000;
        console.log(`  ${client.label} rate limit reset, resuming...`);
      }

      if (!client.isLimited) {
        this.clientIndex = (idx + 1) % this.clients.length;
        return client;
      }
    }

    const sortedClients = [...this.clients].sort((a, b) => {
      if (!a.rateLimitReset) return 1;
      if (!b.rateLimitReset) return -1;
      return a.rateLimitReset - b.rateLimitReset;
    });

    return sortedClients[0];
  }

  /**
   * Update client rate limit state from response
   * @param {Object} client
   * @param {Object} response
   */
  updateClientRateLimit(client, response) {
    const headers = response?.headers;
    if (!headers) return;

    if (headers["x-ratelimit-remaining"] !== undefined) {
      client.rateLimitRemaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      client.rateLimitReset = parseInt(headers["x-ratelimit-reset"], 10) * 1000;
    }

    if (client.rateLimitRemaining <= 10 && !client.isLimited) {
      client.isLimited = true;
      const resetIn = client.rateLimitReset
        ? Math.ceil((client.rateLimitReset - Date.now()) / 1000)
        : 60;
      console.log(`  ${client.label} rate limited, resets in ${resetIn}s`);
    }
  }

  /**
   * Check if all clients are rate limited
   * Also refreshes rate limit status for clients whose reset time has passed
   * @returns {boolean}
   */
  allClientsLimited() {
    // First, check if any client's rate limit has reset
    const now = Date.now();
    for (const client of this.clients) {
      if (client.isLimited && client.rateLimitReset && now >= client.rateLimitReset) {
        client.isLimited = false;
        client.rateLimitRemaining = 5000;
        console.log(`  ${client.label} rate limit reset, resuming...`);
      }
    }
    return this.clients.every((c) => c.isLimited);
  }

  /**
   * Get count of active (non-limited) clients
   * @returns {number}
   */
  getActiveClientCount() {
    return this.clients.filter((c) => !c.isLimited).length;
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
      queueSize: this.queue.size,
      queuePending: this.queue.pending,
    };
  }

  /**
   * Get the earliest reset time among all clients
   * @returns {number} Timestamp in ms
   */
  getNextResetTime() {
    let minReset = Infinity;
    for (const client of this.clients) {
      if (client.rateLimitReset) {
        minReset = Math.min(minReset, client.rateLimitReset);
      }
    }
    return minReset === Infinity ? Date.now() + 60000 : minReset;
  }
}

/**
 * Create a single Octokit instance (legacy compatibility)
 * @returns {Octokit}
 */
export function createOctokit() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "Warning: GITHUB_TOKEN not set. API rate limits will be severely restricted.",
    );
  }
  return new Octokit({ auth: token });
}
