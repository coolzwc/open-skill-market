import { CONFIG } from "./config.js";
import { sleep } from "./utils.js";

/**
 * Execution state tracking
 */
export const executionState = {
  startTime: null,
  isTimedOut: false,
};

/**
 * Rate limit log deduplication
 * Prevents multiple parallel tasks from printing the same wait message
 */
let lastRateLimitLogTime = 0;
const RATE_LIMIT_LOG_INTERVAL = 30000; // Only log once every 30 seconds

/**
 * Log rate limit wait message with deduplication
 * @param {number} waitTimeSeconds - Wait time in seconds
 * @returns {boolean} - Whether the log was printed
 */
export function logRateLimitWait(waitTimeSeconds) {
  const now = Date.now();
  if (now - lastRateLimitLogTime >= RATE_LIMIT_LOG_INTERVAL) {
    console.log(`  All clients rate limited. Waiting ${waitTimeSeconds}s for reset...`);
    lastRateLimitLogTime = now;
    return true;
  }
  return false;
}

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
