import { CONFIG } from "./config.js";
import { sleep } from "./utils.js";

/**
 * Rate limit state tracking
 */
export const rateLimitState = {
  remaining: null,
  reset: null,
  isLimited: false,
  searchRemaining: null,
  searchReset: null,
};

/**
 * Execution state tracking
 */
export const executionState = {
  startTime: null,
  isTimedOut: false,
};

/**
 * Initialize execution timer
 */
export function startExecutionTimer() {
  executionState.startTime = Date.now();
  executionState.isTimedOut = false;
  console.log(
    `Execution timeout set to ${CONFIG.execution.maxExecutionTime / 60000} minutes`,
  );
}

/**
 * Check if we should stop due to execution timeout
 * @returns {boolean}
 */
export function shouldStopForTimeout() {
  if (!executionState.startTime) return false;

  const elapsed = Date.now() - executionState.startTime;
  const timeRemaining = CONFIG.execution.maxExecutionTime - elapsed;

  if (timeRemaining <= CONFIG.execution.saveBuffer) {
    if (!executionState.isTimedOut) {
      executionState.isTimedOut = true;
      const elapsedMin = Math.floor(elapsed / 60000);
      console.log(
        `\nExecution timeout approaching (${elapsedMin}min elapsed). Stopping to save results...`,
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
export function getRemainingExecutionTime() {
  if (!executionState.startTime) return CONFIG.execution.maxExecutionTime;
  const elapsed = Date.now() - executionState.startTime;
  return Math.max(0, CONFIG.execution.maxExecutionTime - elapsed - CONFIG.execution.saveBuffer);
}

/**
 * Update rate limit state from API response
 * @param {Object} response
 * @param {string} type - 'core' or 'search'
 */
export function updateRateLimitFromResponse(response, type = "core") {
  const headers = response?.headers;
  if (!headers) return;

  if (type === "search") {
    if (headers["x-ratelimit-remaining"] !== undefined) {
      rateLimitState.searchRemaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      rateLimitState.searchReset = parseInt(headers["x-ratelimit-reset"], 10) * 1000;
    }
    if (rateLimitState.searchRemaining !== null && rateLimitState.searchRemaining <= 2) {
      rateLimitState.isLimited = true;
    }
  } else {
    if (headers["x-ratelimit-remaining"] !== undefined) {
      rateLimitState.remaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      rateLimitState.reset = parseInt(headers["x-ratelimit-reset"], 10) * 1000;
    }
    if (rateLimitState.remaining !== null && rateLimitState.remaining <= 10) {
      rateLimitState.isLimited = true;
    }
  }
}

/**
 * Check current rate limit status
 * @param {Octokit} octokit
 * @returns {Promise<boolean>} true if can proceed
 */
export async function checkRateLimit(octokit) {
  try {
    const response = await octokit.rest.rateLimit.get();
    const { core, search } = response.data.resources;

    rateLimitState.remaining = core.remaining;
    rateLimitState.reset = core.reset * 1000;
    rateLimitState.searchRemaining = search.remaining;
    rateLimitState.searchReset = search.reset * 1000;

    console.log(`Rate limit status:`);
    console.log(`  Core API: ${core.remaining}/${core.limit} remaining`);
    console.log(`  Search API: ${search.remaining}/${search.limit} remaining`);

    if (core.remaining < 100) {
      const resetTime = new Date(core.reset * 1000);
      console.log(`  Core API resets at: ${resetTime.toISOString()}`);

      if (core.remaining < 10) {
        const waitTime = Math.min(
          core.reset * 1000 - Date.now(),
          CONFIG.rateLimit.maxRateLimitWait,
        );

        if (waitTime > 0 && waitTime <= CONFIG.rateLimit.maxRateLimitWait) {
          console.log(`  Waiting ${Math.ceil(waitTime / 1000)}s for rate limit reset...`);
          await sleep(waitTime + 1000);
          return checkRateLimit(octokit);
        } else if (waitTime > CONFIG.rateLimit.maxRateLimitWait) {
          console.log(`  Rate limit reset too far in future. Cannot proceed.`);
          rateLimitState.isLimited = true;
          return false;
        }
      }
    }

    if (search.remaining < 5) {
      const resetTime = new Date(search.reset * 1000);
      console.log(`  Search API resets at: ${resetTime.toISOString()}`);

      const waitTime = Math.min(
        search.reset * 1000 - Date.now(),
        CONFIG.rateLimit.rateLimitCheckDelay,
      );

      if (waitTime > 0 && waitTime <= CONFIG.rateLimit.rateLimitCheckDelay) {
        console.log(`  Waiting ${Math.ceil(waitTime / 1000)}s for search rate limit...`);
        await sleep(waitTime + 1000);
      }
    }

    return true;
  } catch (error) {
    console.error(`Failed to check rate limit: ${error.message}`);
    return true;
  }
}

/**
 * Handle rate limit error with retry logic
 * @param {Error} error
 * @param {number} retryCount
 * @returns {Promise<boolean>} true if should retry
 */
export async function handleRateLimitError(error, retryCount = 0) {
  if (retryCount >= CONFIG.rateLimit.maxRetries) {
    console.log(`  Max retries (${CONFIG.rateLimit.maxRetries}) reached.`);
    rateLimitState.isLimited = true;
    return false;
  }

  const retryAfter = error.response?.headers?.["retry-after"];
  const resetTime = error.response?.headers?.["x-ratelimit-reset"];

  let waitTime = CONFIG.rateLimit.baseDelay * Math.pow(2, retryCount);

  if (retryAfter) {
    waitTime = parseInt(retryAfter, 10) * 1000;
  } else if (resetTime) {
    waitTime = parseInt(resetTime, 10) * 1000 - Date.now();
  }

  waitTime = Math.min(waitTime, CONFIG.rateLimit.maxRateLimitWait);
  const remainingExecTime = getRemainingExecutionTime();

  if (waitTime > remainingExecTime) {
    console.log(`  Rate limit wait (${Math.ceil(waitTime / 1000)}s) exceeds remaining time.`);
    rateLimitState.isLimited = true;
    return false;
  }

  if (waitTime > 0) {
    console.log(`  Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s (retry ${retryCount + 1}/${CONFIG.rateLimit.maxRetries})...`);
    await sleep(waitTime);
    return true;
  }

  return true;
}
