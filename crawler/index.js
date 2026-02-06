import fs from "fs/promises";
import * as prettier from "prettier";
import "dotenv/config";

import { CONFIG } from "./config.js";
import { loadPriorityRepos, sleep } from "./utils.js";
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
} from "./github-api.js";
import { scanLocalSkills } from "./local-scanner.js";

import { crawlerCache } from "./cache.js";
import { generateSkillZip, generateZipUrl } from "./zip-generator.js";
import { compactOutput, calculateSizeSavings } from "./output-optimizer.js";

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
  } else {
    console.log("\n--- Phase 3: GitHub Topic Search (Parallel) ---\n");
  }

  if (CONFIG.testMode.enabled) {
    // Skip Phase 3 in test mode
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

        // Filter repos to process
        const reposToProcess = [];
        for (const [repoFullName, repo] of reposMap) {
          if (processedRepos.has(repoFullName)) continue;
          if (repo.fork && repo.stargazers_count < 10) continue;
          reposToProcess.push({ repoFullName, repo });
          processedRepos.add(repoFullName);
        }

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
      console.log(`\nProcessing ${globalRepos.size} newly discovered repos...`);

      const reposToProcess = [];
      for (const [repoFullName, repo] of globalRepos) {
        reposToProcess.push({ repoFullName, repo });
        processedRepos.add(repoFullName);
      }

      // Use shared function for parallel processing (with repo details fetch)
      const results = await processReposInParallel(
        workerPool,
        reposToProcess,
        "github",
        { fetchRepoDetails: true },
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

    const pendingZipKeys = crawlerCache.getPendingZips();
    let zipProcessOrder = allSkills;
    if (pendingZipKeys.size > 0) {
      console.log(
        `Found ${pendingZipKeys.size} pending zip(s) from previous run`,
      );
      const pendingSkills = [];
      const otherSkills = [];
      for (const skill of allSkills) {
        const match = skill.repository.url.match(
          /github\.com\/([^/]+)\/([^/]+)/,
        );
        if (match) {
          const cacheKey = `${match[1]}/${match[2]}/${skill.repository.path}`;
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

    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < zipProcessOrder.length; i++) {
      const skill = zipProcessOrder[i];

      if (shouldStopForTimeout()) {
        for (let j = i; j < zipProcessOrder.length; j++) {
          const s = zipProcessOrder[j];
          const m = s.repository.url.match(/github\.com\/([^/]+)\/([^/]+)/);
          if (m) {
            const cacheKey = `${m[1]}/${m[2]}/${s.repository.path}`;
            crawlerCache.addPendingZip(cacheKey);
          }
        }
        zipTimedOut = true;
        console.log(
          `\nZip generation stopped due to timeout. ${zipProcessOrder.length - i} skill(s) saved as pending for next run.`,
        );
        break;
      }

      try {
        // Extract owner and repo from repository URL
        const match = skill.repository.url.match(
          /github\.com\/([^/]+)\/([^/]+)/,
        );
        if (!match) {
          console.log(`  ⚠ Skipping ${skill.name}: Invalid repository URL`);
          skippedCount++;
          continue;
        }
        const [, owner, repo] = match;

        // Generate cache key
        const cacheKey = `${owner}/${repo}/${skill.repository.path}`;

        // Check if zip needs regeneration
        const needsRegeneration = crawlerCache.needsZipRegeneration(
          cacheKey,
          skill.commitHash,
        );

        if (!needsRegeneration) {
          // Use cached zip info
          const zipInfo = crawlerCache.getZipInfo(cacheKey);
          if (zipInfo) {
            skill.skillZipUrl = generateZipUrl(
              CONFIG.zips.baseUrl,
              owner,
              repo,
              skill.name,
            );
            skippedCount++;
            continue;
          }
        }

        // Generate new zip — using workerPool for rate-limited API calls
        console.log(`  Generating zip for ${skill.name}...`);
        const { zipPath } = await generateSkillZip(
          skill,
          CONFIG.zips.outputDir,
          workerPool,
        );

        // Update skill manifest with zip URL
        skill.skillZipUrl = generateZipUrl(
          CONFIG.zips.baseUrl,
          owner,
          repo,
          skill.name,
        );

        // Update cache with zip path
        crawlerCache.setZipInfo(cacheKey, zipPath);

        generatedCount++;
      } catch (error) {
        console.error(
          `  ✗ Error generating zip for ${skill.name}: ${error.message}`,
        );
        errorCount++;
        // Continue with other skills even if one fails
      }
    }

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

  // Save output (with optional compaction)
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

  const formattedJson = await prettier.format(JSON.stringify(finalOutput), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });

  await fs.writeFile(CONFIG.outputPath, formattedJson, "utf-8");

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
