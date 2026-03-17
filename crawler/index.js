import fs from "fs/promises";
import path from "path";
import * as prettier from "prettier";
import "dotenv/config";

import { CONFIG } from "./config.js";
import { loadPriorityRepos, parseRepoUrl, safeZipName } from "./utils.js";
import { WorkerPool } from "./worker-pool.js";
import {
  executionState,
  startExecutionTimer,
  shouldStopForTimeout,
} from "./rate-limit.js";
import {
  searchSkillRepositories,
  crawlPriorityRepos,
  processReposInParallel,
  discoverSkillReposGlobally,
  fetchReposDetailsBatch,
} from "./github-api.js";
import { scanLocalSkills } from "./local-scanner.js";

import { crawlerCache } from "./cache.js";
import {
  generateSkillZip,
  isNoFilesFetchedError,
  isRetryableZipError,
} from "./zip-generator.js";
import { compactOutput, calculateSizeSavings, splitByRepo } from "./output-optimizer.js";
import { uploadToR2, buildR2Key, isR2Configured } from "./r2-uploader.js";
import { removeExtractDir, cleanupAllExtracts } from "./github/archive.js";

/** Minimum zip size in bytes; below this we skip upload and re-queue for regeneration. Empty zip is ~22 bytes. */
const MIN_ZIP_SIZE_BYTES = 50;

/**
 * If the zip at localPath exists and has valid size, returns true. If missing, too small, or error, returns false.
 * When too small: unlinks file, clears cache zip info, optionally adds to pending zip list for next run.
 * @param {string} localPath
 * @param {string} cacheKey
 * @param {string} zipLabel - For log message
 * @param {{ addPendingZip?: boolean }} options - addPendingZip: when true (default), add cacheKey to pending zips when deleting
 * @returns {Promise<boolean>}
 */
async function ensureZipValidSize(localPath, cacheKey, zipLabel, options = {}) {
  const { addPendingZip = true } = options;
  try {
    await fs.access(localPath);
    const stat = await fs.stat(localPath);
    if (stat.size < MIN_ZIP_SIZE_BYTES) {
      await fs.unlink(localPath);
      crawlerCache.setZipInfo(cacheKey, null);
      if (addPendingZip) crawlerCache.addPendingZip(cacheKey);
      console.log(
        `  ⚠ ${zipLabel} too small (${stat.size} bytes), deleted; will regenerate.`,
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resume mode: process only pending zips / R2 uploads from a previous interrupted run.
 * After completion, exits without doing a full crawl. Next run will start fresh.
 */
async function processPendingItems() {
  // Snapshot pending items as arrays (originals will be cleared/modified)
  const pendingZipList = [...crawlerCache.getPendingZips()];
  const pendingR2List = [...crawlerCache.getPendingR2Uploads()];

  console.log(`\n${"━".repeat(50)}`);
  console.log("Resume Mode: Processing pending items from previous run");
  console.log("━".repeat(50));
  if (pendingZipList.length > 0) console.log(`  Pending zips:       ${pendingZipList.length}`);
  if (pendingR2List.length > 0) console.log(`  Pending R2 uploads: ${pendingR2List.length}`);
  console.log("");

  startExecutionTimer();

  // Initialize worker pool (needed for GitHub API calls when fetching skill files)
  const workerPool = new WorkerPool();
  await workerPool.fetchRateLimits();

  const r2Enabled = isR2Configured();
  const r2Bucket = CONFIG.zips.r2.bucket || "skill-market";
  const r2Prefix = CONFIG.zips.r2.prefix || "zips/";

  let zipGenerated = 0, zipOnDisk = 0, zipErrors = 0;
  let r2Uploaded = 0, r2Skipped = 0, r2Errors = 0;

  // ── Step 1: Generate pending zips ──────────────────────────────────
  if (pendingZipList.length > 0 && CONFIG.zips.enabled) {
    console.log("--- Generating pending zips ---\n");
    await fs.mkdir(CONFIG.zips.outputDir, { recursive: true });
    crawlerCache.clearPendingZips(); // will re-add on failure/timeout

    for (let i = 0; i < pendingZipList.length; i++) {
      const key = pendingZipList[i];

      if (shouldStopForTimeout()) {
        // Re-add remaining (including current) as pending for next run
        for (let j = i; j < pendingZipList.length; j++) {
          crawlerCache.addPendingZip(pendingZipList[j]);
          if (r2Enabled) crawlerCache.addPendingR2Upload(pendingZipList[j]);
        }
        console.log(`\n  Timeout: ${pendingZipList.length - i} zip(s) deferred to next run.`);
        break;
      }

      // Reconstruct skill manifest from cache
      const cached = crawlerCache.getSkillExpanded(key);
      if (!cached?.manifest) {
        console.log(`  ⚠ No cached manifest for ${key}, skipping`);
        crawlerCache.removePendingZip(key);
        continue;
      }
      const skill = cached.manifest;

      const parsed = parseRepoUrl(skill.repository?.url || skill.repo);
      if (!parsed) {
        console.log(`  ⚠ Invalid repo URL for ${key}, skipping`);
        crawlerCache.removePendingZip(key);
        continue;
      }
      const { owner, repo } = parsed;

      // Check if zip already exists on disk (filename must match CDN/frontend safe name)
      const zipFilename = `${owner}-${repo}-${safeZipName(skill.name)}.zip`;
      const localZipPath = path.join(CONFIG.zips.outputDir, zipFilename);
      const valid = await ensureZipValidSize(localZipPath, key, `${skill.name} zip on disk`, {
        addPendingZip: false,
      });
      if (valid) {
        const zipPath = path.relative(path.join(CONFIG.zips.outputDir, ".."), localZipPath);
        crawlerCache.setZipInfo(key, zipPath);
        console.log(`  ✓ ${skill.name} (already on disk)`);
        zipOnDisk++;
        crawlerCache.removePendingZip(key);
        continue;
      }
      // Invalid or missing: fall through to generate below

      if (crawlerCache.isZipUnreachable(key, skill.commitHash)) {
        console.log(`  Skipping ${skill.name} (previously unreachable at this commit).`);
        crawlerCache.removePendingZip(key);
        continue;
      }

      try {
        // Wait for available client if rate limited
        if (workerPool.allClientsLimited()) {
          const available = await workerPool.waitForAvailableClient(shouldStopForTimeout);
          if (!available) {
            for (let j = i; j < pendingZipList.length; j++) {
              crawlerCache.addPendingZip(pendingZipList[j]);
              if (r2Enabled) crawlerCache.addPendingR2Upload(pendingZipList[j]);
            }
            console.log("  Rate limited, deferring remaining to next run.");
            break;
          }
        }

        console.log(`  Generating zip for ${skill.name}...`);
        const { zipPath } = await generateSkillZip(skill, CONFIG.zips.outputDir, workerPool);
        crawlerCache.setZipInfo(key, zipPath);
        crawlerCache.removePendingZip(key);
        zipGenerated++;
      } catch (error) {
        console.error(`  ✗ ${skill.name}: ${error.message}`);
        if (isNoFilesFetchedError(error)) {
          crawlerCache.setZipUnreachable(key, skill.commitHash);
          crawlerCache.removePendingZip(key);
        } else {
          // For other errors: check if zip file exists on disk
          // If file doesn't exist or is too small, delete it and remove from pending
          // Otherwise keep as pending to retry next time
          const zipFilename = `${owner}-${repo}-${safeZipName(skill.name)}.zip`;
          const localZipPath = path.join(CONFIG.zips.outputDir, zipFilename);
          const isValid = await ensureZipValidSize(localZipPath, key, zipFilename, {
            addPendingZip: false,
          });
          if (!isValid) {
            // Zip missing or too small - remove from pending to avoid infinite loops
            crawlerCache.removePendingZip(key);
            console.log(`  → Removed from pending (no valid zip file).`);
          } else {
            // Zip exists and is valid - retry next time
            crawlerCache.addPendingZip(key);
          }
        }
        zipErrors++;
      }
    }

    console.log(`\nZip Summary: ${zipGenerated} generated, ${zipOnDisk} already on disk, ${zipErrors} errors`);
  }

  // ── Step 2: R2 uploads ─────────────────────────────────────────────
  if (r2Enabled) {
    // Combine: all pending zips (need R2 too) + previously pending R2 uploads
    const allR2Candidates = new Set([...pendingZipList, ...pendingR2List]);
    crawlerCache.clearPendingR2Uploads();

    const tasks = [];
    for (const key of allR2Candidates) {
      const cached = crawlerCache.getSkill(key);
      if (!cached?.manifest?.name) continue;

      // Skip if already uploaded with same commit hash
      if (crawlerCache.isR2Uploaded(key, cached.commitHash)) {
        r2Skipped++;
        continue;
      }

      const parsed = parseRepoUrl(cached.manifest.repository?.url || cached.manifest.repo);
      if (!parsed) continue;
      const { owner, repo } = parsed;
      const skillName = safeZipName(cached.manifest.name);
      const zipFilename = `${owner}-${repo}-${skillName}.zip`;
      tasks.push({ key, commitHash: cached.commitHash, owner, repo, skillName, zipFilename });
    }

    if (tasks.length > 0) {
      console.log(`\n--- Uploading ${tasks.length} zip(s) to R2 ---\n`);
      let r2TimedOut = false;
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];

        // Check timeout before each upload — save remaining to cache for next run
        if (shouldStopForTimeout()) {
          for (let j = i; j < tasks.length; j++) {
            crawlerCache.addPendingR2Upload(tasks[j].key);
          }
          r2TimedOut = true;
          console.log(
            `\n  Timeout: ${tasks.length - i} zip(s) deferred to next run.`,
          );
          break;
        }

        const localPath = path.join(CONFIG.zips.outputDir, t.zipFilename);
        const r2Key = buildR2Key(r2Prefix, t.owner, t.repo, t.skillName);
        try {
          if (!(await ensureZipValidSize(localPath, t.key, t.zipFilename))) {
            // Zip missing or too small - remove from pending to avoid infinite loops
            crawlerCache.removePendingZip(t.key);
            crawlerCache.removePendingR2Upload(t.key);
            console.log(`  ⚠ ${t.zipFilename}: removed from pending (no valid zip file).`);
            continue;
          }
          await uploadToR2(localPath, r2Key, r2Bucket);
          crawlerCache.setR2Uploaded(t.key, t.commitHash);
          crawlerCache.removePendingZip(t.key);
          crawlerCache.removePendingR2Upload(t.key);
          r2Uploaded++;
          if (CONFIG.zips.deleteLocalAfterR2Upload) {
            try {
              await fs.unlink(localPath);
            } catch (unlinkErr) {
              console.warn(`  Could not delete local zip ${t.zipFilename}: ${unlinkErr.message}`);
            }
          }
          console.log(`  ✓ ${t.zipFilename}`);
        } catch (error) {
          console.error(`  ✗ ${t.zipFilename}: ${error.message}`);
          // Zip missing on disk: queue zip regeneration next run instead of retrying upload forever
          if (error.code === "ENOENT") {
            crawlerCache.addPendingZip(t.key);
            crawlerCache.removePendingR2Upload(t.key);
            console.log(`  → ${t.zipFilename} missing, will regenerate zip next run.`);
          } else {
            crawlerCache.addPendingR2Upload(t.key);
          }
          r2Errors++;
        }
      }
      if (r2TimedOut) {
        console.log(
          `  R2 upload stopped due to timeout. Remaining saved as pending.`,
        );
      }
    }

    if (r2Uploaded > 0 || r2Skipped > 0 || r2Errors > 0) {
      console.log(`\nR2 Summary: ${r2Uploaded} uploaded, ${r2Skipped} already done, ${r2Errors} errors`);
    }
  }

  // Save cache
  await crawlerCache.save();

  const elapsedMs = Date.now() - executionState.startTime;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  console.log(`\n${"━".repeat(50)}`);
  console.log(`Resume complete (${elapsedSec}s). Next run will perform a full crawl.`);
  console.log("━".repeat(50));
}

/**
 * Main crawler function
 */
async function main() {
  console.log("=== Open Skill Market Crawler ===\n");

  // Test mode
  if (CONFIG.testMode.enabled) {
    console.log("*** TEST MODE ENABLED ***");
    console.log(`Test repos: ${CONFIG.testMode.repos.join(", ")}`);
    console.log("");
  }

  // Load cache
  await crawlerCache.load();

  // ─── Resume Mode: if previous run left pending work, finish it and exit ───
  // Next run (with no pending items) will do a full crawl from scratch.
  const hasPendingWork =
    crawlerCache.getPendingZips().size > 0 ||
    crawlerCache.getPendingR2Uploads().size > 0;

  if (hasPendingWork) {
    await processPendingItems();
    return;
  }

  // ─── Full Crawl Mode ───
  startExecutionTimer();

  // Initialize worker pool
  const workerPool = new WorkerPool();

  // Fetch actual rate limits from GitHub API
  await workerPool.fetchRateLimits();

  // Show total capacity
  const totalRemaining = workerPool.getTotalRemaining();
  console.log(`\nTotal remaining capacity: ${totalRemaining.core} (Core), ${totalRemaining.search} (Search), ${totalRemaining.codeSearch} (CodeSearch)`);
  console.log(`Parallel concurrency: ${CONFIG.parallel.concurrency}`);
  console.log("");

  const allSkills = [];
  const processedRepos = new Set();
  let prioritySkills = [];

  // Load priority repositories
  const priorityRepos = await loadPriorityRepos();
  if (priorityRepos.length > 0) {
    console.log(
      `Loaded ${priorityRepos.length} priority repository(s) from repositories.yml`,
    );
  }

  // Wait for available client if all are rate limited
  if (workerPool.allClientsLimited()) {
    console.log("All clients rate limited at startup, waiting for reset...");
    const available = await workerPool.waitForAvailableClient(shouldStopForTimeout, {
      maxWaitPerCycle: CONFIG.rateLimit.maxWaitForReset,
      logWait: true,
    });
    if (!available) {
      console.log("Could not get available client, exiting...");
      return;
    }
  }

  // Select best client for main operations
  const activeClient = workerPool.getClient();
  console.log(`Using client ${activeClient.label} for main operations.`);

  // Phase 1: Local Skills
  console.log("\n--- Phase 1: Local Skills (PR-submitted) ---\n");
  const localSkills = await scanLocalSkills();
  allSkills.push(...localSkills);

  // Phase 2: Priority/Test Repositories
  const reposToScan = CONFIG.testMode.enabled
    ? CONFIG.testMode.repos
    : priorityRepos;
  const phaseLabel = CONFIG.testMode.enabled
    ? "Test Repositories"
    : "Priority Repositories";

  if (!shouldStopForTimeout()) {
    console.log(`\n--- Phase 2: ${phaseLabel} ---\n`);
    prioritySkills = await crawlPriorityRepos(workerPool, reposToScan);
  } else {
    console.log(`\n--- Phase 2: ${phaseLabel} (SKIPPED - timeout) ---\n`);
  }
  allSkills.push(...prioritySkills);

  // Track repos to skip in search phase
  for (const repoFullName of reposToScan) {
    processedRepos.add(repoFullName);
  }
  processedRepos.add(`${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}`);

  // Phase 3: GitHub Topic Search (Parallel) - Skip in test mode
  if (CONFIG.testMode.enabled) {
    console.log(
      "\n--- Phase 3: GitHub Topic Search (SKIPPED - test mode) ---\n",
    );
  } else if (shouldStopForTimeout()) {
    console.log("Skipping GitHub search due to execution timeout.");
  } else {
    // Wait for rate limit to reset if all clients are limited
    const available = await workerPool.waitForAvailableClient(shouldStopForTimeout, {
      maxWaitPerCycle: CONFIG.rateLimit.maxWaitForReset,
      logWait: true,
    });

    if (!available) {
      console.log("Skipping GitHub search due to execution timeout.");
    } else {
      // Search repositories using worker pool
      const reposMap = await searchSkillRepositories(workerPool);

      if (reposMap.size > 0 && !shouldStopForTimeout()) {
        console.log("\nScanning repositories for SKILL.md files (parallel)...");
        console.log(`Queue concurrency: ${CONFIG.parallel.concurrency}`);

        // Filter repos and sort by stars desc so we process high-star repos first
        const reposToProcess = [];
        for (const [repoFullName, repo] of reposMap) {
          if (processedRepos.has(repoFullName)) continue;
          if (repo.fork && repo.stargazers_count < 10) continue;
          reposToProcess.push({ repoFullName, repo });
          processedRepos.add(repoFullName);
        }
        reposToProcess.sort(
          (a, b) => (b.repo.stargazers_count || 0) - (a.repo.stargazers_count || 0),
        );

        console.log(`Repositories to scan: ${reposToProcess.length}`);

        // Use shared function for parallel processing
        const results = await processReposInParallel(
          workerPool,
          reposToProcess,
          "github",
          { fetchRepoDetails: false },
        );

        allSkills.push(...results);
        console.log(`\nPhase 3 complete: ${results.length} skills from ${reposToProcess.length} repos`);
      } else if (reposMap.size === 0) {
        console.log("No repositories found via topic search.");
      }
    }
  }

  // Phase 4: Global SKILL.md Discovery (optional supplementary search)
  if (CONFIG.testMode.enabled) {
    console.log(
      "\n--- Phase 4: Global SKILL.md Discovery (SKIPPED - test mode) ---\n",
    );
  } else if (!CONFIG.globalDiscovery.enabled) {
    console.log(
      "\n--- Phase 4: Global SKILL.md Discovery (SKIPPED - disabled) ---\n",
    );
  } else if (shouldStopForTimeout()) {
    console.log(
      "\n--- Phase 4: Global SKILL.md Discovery (SKIPPED - timeout) ---\n",
    );
  } else {
    console.log("\n--- Phase 4: Global SKILL.md Discovery ---\n");

    // Discover repos with SKILL.md that weren't found via topic search
    const globalRepos = await discoverSkillReposGlobally(
      workerPool,
      processedRepos,
    );

    if (globalRepos.size > 0 && !shouldStopForTimeout()) {
      console.log(`\nFetching repo details to prioritize by stars (${globalRepos.size} repos)...`);
      const detailsMap = await fetchReposDetailsBatch(workerPool, globalRepos);

      const reposToProcess = [];
      for (const [repoFullName, repo] of globalRepos) {
        const fullRepo = detailsMap.get(repoFullName) || repo;
        reposToProcess.push({ repoFullName, repo: fullRepo });
        processedRepos.add(repoFullName);
      }
      reposToProcess.sort(
        (a, b) => (b.repo.stargazers_count || 0) - (a.repo.stargazers_count || 0),
      );
      console.log(`Processing ${reposToProcess.length} newly discovered repos (high-star first)...`);

      // Repo details already fetched; no need to fetch again
      const results = await processReposInParallel(
        workerPool,
        reposToProcess,
        "github",
        { fetchRepoDetails: false },
      );

      allSkills.push(...results);
      console.log(`\nPhase 4 complete: ${results.length} skills from ${reposToProcess.length} repos`);
    } else if (globalRepos.size === 0) {
      console.log("No additional repositories discovered via global search.");
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

  // Deduplicate by name + description
  const seenSignatures = new Set();
  const dedupedSkills = [];
  let duplicateCount = 0;

  for (const skill of allSkills) {
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
    console.log(
      `\nRemoved ${duplicateCount} duplicate skill(s) by name+description`,
    );
  }

  // Replace with deduplicated list
  allSkills.length = 0;
  allSkills.push(...dedupedSkills);


  // Generate zip packages for skills (if enabled)
  let zipTimedOut = false;
  if (CONFIG.zips.enabled) {
    console.log(`\n${"=".repeat(50)}`);
    console.log("Generating Skill Zip Packages");
    console.log("=".repeat(50));

    // Ensure output directory exists early — avoids "directory not found" when
    // GitHub Actions zip cache is expired but .crawler-cache.json still has entries
    await fs.mkdir(CONFIG.zips.outputDir, { recursive: true });

    const pendingZipKeys = crawlerCache.getPendingZips();
    let zipProcessOrder = allSkills;
    if (pendingZipKeys.size > 0) {
      console.log(
        `Found ${pendingZipKeys.size} pending zip(s) from previous run`,
      );
      const pendingSkills = [];
      const otherSkills = [];
      for (const skill of allSkills) {
        const parsed = parseRepoUrl(skill.repository?.url);
        if (parsed) {
          const cacheKey = `${parsed.owner}/${parsed.repo}/${skill.repository.path}`;
          if (pendingZipKeys.has(cacheKey)) {
            pendingSkills.push(skill);
          } else {
            otherSkills.push(skill);
          }
        } else {
          otherSkills.push(skill);
        }
      }
      zipProcessOrder = [...pendingSkills, ...otherSkills];
    }
    crawlerCache.clearPendingZips();

    // Group by (owner, repo) so we can clear archive extract after last skill of each repo
    const repoOrder = [];
    const byRepo = new Map();
    for (const skill of zipProcessOrder) {
      const parsed = parseRepoUrl(skill.repository?.url);
      if (!parsed) continue;
      const rk = `${parsed.owner}/${parsed.repo}`;
      if (!byRepo.has(rk)) {
        repoOrder.push(rk);
        byRepo.set(rk, []);
      }
      byRepo.get(rk).push(skill);
    }
    const zipProcessOrderByRepo = repoOrder.flatMap((rk) => byRepo.get(rk) || []);

    const r2Enabled = isR2Configured();
    const r2Bucket = CONFIG.zips.r2.bucket || "skill-market";
    const r2Prefix = CONFIG.zips.r2.prefix || "zips/";

    // Also process pending R2 uploads from last run
    const pendingR2Keys = r2Enabled ? crawlerCache.getPendingR2Uploads() : new Set();
    if (r2Enabled) crawlerCache.clearPendingR2Uploads();

    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let r2UploadedCount = 0;
    let r2SkippedCount = 0;
    let r2ErrorCount = 0;

    // In-flight R2 uploads (fire-and-forget, settled at end)
    const r2Uploads = [];

    /**
     * Schedule an R2 upload for a skill if needed (non-blocking).
     * If isLastInRepo, after upload clears archive extract for that repo and removes extract dir.
     */
    function scheduleR2Upload(cacheKey, skill, owner, repo, isLastInRepo = false) {
      if (!r2Enabled) return;

      if (crawlerCache.isR2Uploaded(cacheKey, skill.commitHash)) {
        r2SkippedCount++;
        if (isLastInRepo && skill.commitHash) {
          const extractRoot = crawlerCache.getArchiveExtractPath(owner, repo, skill.commitHash);
          if (extractRoot) {
            crawlerCache.clearArchiveExtractPath(owner, repo, skill.commitHash);
            removeExtractDir(path.dirname(extractRoot));
          }
        }
        return;
      }

      const zipFilename = `${owner}-${repo}-${safeZipName(skill.name)}.zip`;
      const localPath = path.join(CONFIG.zips.outputDir, zipFilename);
      const r2Key = buildR2Key(r2Prefix, owner, repo, safeZipName(skill.name));

      const uploadPromise = (async () => {
        try {
          if (!(await ensureZipValidSize(localPath, cacheKey, zipFilename))) return;
          await uploadToR2(localPath, r2Key, r2Bucket);
          crawlerCache.setR2Uploaded(cacheKey, skill.commitHash);
          r2UploadedCount++;
          if (CONFIG.zips.deleteLocalAfterR2Upload) {
            try {
              await fs.unlink(localPath);
            } catch (unlinkErr) {
              console.warn(`  Could not delete local zip ${zipFilename}: ${unlinkErr.message}`);
            }
          }
          if (isLastInRepo && skill.commitHash) {
            const extractRoot = crawlerCache.getArchiveExtractPath(owner, repo, skill.commitHash);
            if (extractRoot) {
              crawlerCache.clearArchiveExtractPath(owner, repo, skill.commitHash);
              removeExtractDir(path.dirname(extractRoot));
            }
          }
        } catch (err) {
          console.error(`  ✗ R2 upload failed for ${zipFilename}: ${err.message}`);
          crawlerCache.addPendingR2Upload(cacheKey);
          r2ErrorCount++;
        }
      })();

      r2Uploads.push(uploadPromise);
    }

    for (let i = 0; i < zipProcessOrderByRepo.length; i++) {
      const skill = zipProcessOrderByRepo[i];
      const nextSkill = zipProcessOrderByRepo[i + 1];
      const parsed = parseRepoUrl(skill.repository?.url);
      const nextParsed = nextSkill ? parseRepoUrl(nextSkill?.repository?.url) : null;
      const isLastInRepo =
        !nextParsed ||
        parsed?.owner !== nextParsed?.owner ||
        parsed?.repo !== nextParsed?.repo;
      let cacheKey = "";
      let owner = "";
      let repo = "";

      if (shouldStopForTimeout()) {
        for (let j = i; j < zipProcessOrderByRepo.length; j++) {
          const s = zipProcessOrderByRepo[j];
          const p = parseRepoUrl(s.repository?.url);
          if (p) {
            const cacheKey = `${p.owner}/${p.repo}/${s.repository.path}`;
            crawlerCache.addPendingZip(cacheKey);
            if (r2Enabled && !crawlerCache.isR2Uploaded(cacheKey, s.commitHash)) {
              crawlerCache.addPendingR2Upload(cacheKey);
            }
          }
        }
        zipTimedOut = true;
        console.log(
          `\nZip generation stopped due to timeout. ${zipProcessOrderByRepo.length - i} skill(s) saved as pending for next run.`,
        );
        break;
      }

      try {
        if (!parsed) {
          console.log(`  ⚠ Skipping ${skill.name}: Invalid repository URL`);
          skippedCount++;
          continue;
        }
        owner = parsed.owner;
        repo = parsed.repo;
        cacheKey = `${owner}/${repo}/${skill.repository.path}`;

        const needsRegeneration = crawlerCache.needsZipRegeneration(
          cacheKey,
          skill.commitHash,
        );

        if (!needsRegeneration) {
          const zipInfo = crawlerCache.getZipInfo(cacheKey);
          if (zipInfo) {
            const zipFilename = `${owner}-${repo}-${safeZipName(skill.name)}.zip`;
            const localZipPath = path.join(CONFIG.zips.outputDir, zipFilename);
            const valid = await ensureZipValidSize(localZipPath, cacheKey, `Cached zip ${zipFilename}`);
            if (valid) {
              skippedCount++;
              scheduleR2Upload(cacheKey, skill, owner, repo, isLastInRepo);
              continue;
            }
          }
        }

        if (crawlerCache.isZipUnreachable(cacheKey, skill.commitHash)) {
          console.log(`  Skipping zip for ${skill.name} (previously unreachable at this commit).`);
          skippedCount++;
          continue;
        }

        const { zipPath } = await generateSkillZip(
          skill,
          CONFIG.zips.outputDir,
          workerPool,
        );
        crawlerCache.setZipInfo(cacheKey, zipPath);
        generatedCount++;
        scheduleR2Upload(cacheKey, skill, owner, repo, isLastInRepo);
      } catch (error) {
        console.error(
          `  ✗ Error generating zip for ${skill.name}: ${error.message}`,
        );
        errorCount++;
        if (isNoFilesFetchedError(error)) {
          crawlerCache.setZipUnreachable(cacheKey, skill.commitHash);
        } else if (executionState.isTimedOut || isRetryableZipError(error)) {
          crawlerCache.addPendingZip(cacheKey);
          if (r2Enabled && !crawlerCache.isR2Uploaded(cacheKey, skill.commitHash)) {
            crawlerCache.addPendingR2Upload(cacheKey);
          }
        }
        // Permanent non-retryable errors: don't add to pending
      }
    }

    if (r2Uploads.length > 0) {
      console.log(`\n  Waiting for ${r2Uploads.length} R2 upload(s) to finish...`);
      await Promise.allSettled(r2Uploads);
    }

    crawlerCache.clearArchiveExtracts();
    await cleanupAllExtracts();

    console.log(`\nZip Generation Summary:`);
    console.log(`  Generated: ${generatedCount}`);
    console.log(`  Cached: ${skippedCount}`);
    if (errorCount > 0) {
      console.log(`  Errors: ${errorCount}`);
    }
    if (zipTimedOut) {
      console.log(
        `  Zip generation timed out; remaining skills saved as pending.`,
      );
    }
    if (r2Enabled) {
      console.log(`\nR2 Upload Summary:`);
      console.log(`  Uploaded: ${r2UploadedCount}`);
      console.log(`  Skipped (already in R2): ${r2SkippedCount}`);
      if (r2ErrorCount > 0) {
        console.log(`  Errors: ${r2ErrorCount}`);
      }
    }
  }

  // Check if any clients ended up rate limited (for incomplete status)
  const anyClientLimited = workerPool.allClientsLimited();

  // Generate output
  const priorityCount = allSkills.filter((s) => s.source === "priority").length;
  const githubCount = allSkills.filter((s) => s.source === "github").length;
  const elapsedMs = Date.now() - executionState.startTime;
  const elapsedMin = Math.floor(elapsedMs / 60000);
  const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
  const isIncomplete = anyClientLimited || executionState.isTimedOut;

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalSkills: allSkills.length,
      localSkills: localSkills.length,
      prioritySkills: priorityCount,
      remoteSkills: githubCount,
      apiVersion: CONFIG.apiVersion,
      rateLimited: anyClientLimited,
      timedOut: executionState.isTimedOut,
      zipTimedOut,
      executionTimeMs: elapsedMs,
    },
    skills: allSkills,
  };

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("Summary");
  console.log("=".repeat(50));
  console.log(`  Execution time:        ${elapsedMin}m ${elapsedSec}s`);
  console.log(`  Local skills (PR):     ${localSkills.length}`);
  console.log(`  Priority repo skills:  ${priorityCount}`);
  console.log(`  GitHub search skills:  ${githubCount}`);
  console.log(`  ${"─".repeat(30)}`);
  console.log(`  Total skills:          ${allSkills.length}`);

  if (isIncomplete || zipTimedOut) {
    console.log("");
    if (anyClientLimited) {
      console.log(`  ⚠ Crawl incomplete: GitHub API rate limit reached.`);
    }
    if (executionState.isTimedOut) {
      console.log(`  ⚠ Crawl incomplete: Execution timeout reached.`);
    }
    if (zipTimedOut) {
      console.log(
        `  ⚠ Zip generation incomplete: Some skills saved as pending for next run.`,
      );
    }
    console.log(`    Run again later to collect more skills.`);
  }

  // Save output (with optional compaction and chunking)
  console.log(`\nSaving to ${CONFIG.outputPath}...`);

  let finalOutput = output;

  if (CONFIG.output.compact) {
    const compacted = compactOutput(output);
    const savings = calculateSizeSavings(output, compacted);
    console.log(
      `  Compact mode: ${savings.percentage} size reduction ` +
        `(${Math.round(savings.originalSize / 1024)}KB → ${Math.round(savings.compactedSize / 1024)}KB)`,
    );
    finalOutput = compacted;
  }

  // Split into chunks by repo boundaries if needed
  const { main, chunks } = splitByRepo(finalOutput, CONFIG.output.chunkSize);

  // Write main file (skills.json)
  const mainJson = await prettier.format(JSON.stringify(main), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });
  await fs.writeFile(CONFIG.outputPath, mainJson, "utf-8");

  // Write chunk files and clean up old ones
  const outputDir = path.dirname(CONFIG.outputPath);

  if (chunks.length > 0) {
    console.log(`  Split into ${chunks.length + 1} chunks (${main.skills.length} + ${chunks.map(c => c.skills.length).join(" + ")} skills)`);
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = path.join(outputDir, `skills-${i + 1}.json`);
      const chunkJson = await prettier.format(JSON.stringify(chunks[i]), {
        parser: "json",
        printWidth: 100,
        tabWidth: 2,
      });
      await fs.writeFile(chunkPath, chunkJson, "utf-8");
    }
  }

  // Clean up stale chunk files from previous runs
  try {
    const files = await fs.readdir(outputDir);
    for (const file of files) {
      const match = file.match(/^skills-(\d+)\.json$/);
      if (match) {
        const chunkIndex = parseInt(match[1], 10);
        if (chunkIndex > chunks.length) {
          await fs.unlink(path.join(outputDir, file));
          console.log(`  Removed stale chunk: ${file}`);
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  // Registry (skills.json + chunks) is not uploaded to CDN by crawler; only commit to git.
  // CDN upload is done after skill-scan completes (see .github/workflows/skill-scan.yml).

  // Ensure archive extracts are cleared and temp dir removed (e.g. if zip phase was skipped)
  crawlerCache.clearArchiveExtracts();
  await cleanupAllExtracts();

  // Save cache
  await crawlerCache.save();

  console.log("Done!");
}

// Run — save cache even on crash to preserve partial progress
main().catch(async (error) => {
  console.error("Crawler failed:", error);
  try {
    console.log("Attempting to save cache before exit...");
    crawlerCache.isDirty = true; // Force save
    await crawlerCache.save();
    console.log("Cache saved.");
  } catch (saveError) {
    console.error("Failed to save cache on crash:", saveError.message);
  }
  process.exit(1);
});
