import fs from "fs/promises";
import * as prettier from "prettier";
import "dotenv/config";

import { CONFIG } from "./config.js";
import { loadPriorityRepos, sleep } from "./utils.js";
import { WorkerPool } from "./worker-pool.js";
import {
  rateLimitState,
  executionState,
  startExecutionTimer,
  shouldStopForTimeout,
  logRateLimitWait,
} from "./rate-limit.js";
import {
  searchSkillRepositories,
  crawlPriorityRepos,
  processRepoWithCache,
} from "./github-api.js";
import { scanLocalSkills } from "./local-scanner.js";

import { crawlerCache } from "./cache.js";
import { generateSkillZip, generateZipUrl } from "./zip-generator.js";

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

  console.log("GitHub API Rate Limits:");
  console.log("  - REST API: 5000 req/hour (authenticated), 60 req/hour (unauthenticated)");
  console.log("  - Search API: 30 req/minute (authenticated), 10 req/minute (unauthenticated)");
  console.log("");

  // Initialize worker pool
  const workerPool = new WorkerPool();

  console.log(`Parallel concurrency: ${CONFIG.parallel.concurrency}`);
  console.log(`Total capacity: ${workerPool.clients.length * 5000} req/hour`);
  console.log("");

  const allSkills = [];
  const processedRepos = new Set();
  let prioritySkills = [];

  // Load priority repositories
  const priorityRepos = await loadPriorityRepos();
  if (priorityRepos.length > 0) {
    console.log(`Loaded ${priorityRepos.length} priority repository(s) from repositories.yml`);
  }

  // Check rate limit and select best client
  console.log("Checking rate limit status for all clients...");
  let activeClient = null;
  
  while (!activeClient) {
    let bestClient = null;
    let minReset = Infinity;
    let allLimited = true;
    
    for (const client of workerPool.clients) {
      try {
        const response = await client.octokit.rest.rateLimit.get();
        const { core, search } = response.data.resources;
        
        client.rateLimitRemaining = core.remaining;
        client.rateLimitReset = core.reset * 1000;
        
        console.log(`  Client ${client.label}: ${core.remaining}/${core.limit} (Core), ${search.remaining}/${search.limit} (Search)`);
        
        if (core.remaining > 100) {
            allLimited = false;
            // Prefer client with most remaining requests
            if (!bestClient || core.remaining > bestClient.rateLimitRemaining) {
                bestClient = client;
            }
        } else {
            minReset = Math.min(minReset, client.rateLimitReset);
        }
      } catch (e) {
        console.error(`  Client ${client.label} check failed: ${e.message}`);
      }
    }
    
    if (bestClient) {
        activeClient = bestClient;
        console.log(`Using client ${activeClient.label} for main operations.`);
        break;
    } else {
        const waitTime = minReset - Date.now();
        if (waitTime > 0) {
             console.log(`All clients rate limited. Waiting ${Math.ceil(waitTime/1000)}s...`);
             await sleep(Math.min(waitTime + 1000, 60000)); // Check again in 1 min or wait time
        } else {
             console.log("Waiting for rate limit reset...");
             await sleep(10000);
        }
    }
  }

  // Phase 1: Local Skills
  console.log("\n--- Phase 1: Local Skills (PR-submitted) ---\n");
  const localSkills = await scanLocalSkills();
  allSkills.push(...localSkills);

  // Phase 2: Priority/Test Repositories
  // In test mode, use test repos; otherwise use priority repos
  const reposToScan = CONFIG.testMode.enabled ? CONFIG.testMode.repos : priorityRepos;
  const phaseLabel = CONFIG.testMode.enabled ? "Test Repositories" : "Priority Repositories";

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
    console.log("\n--- Phase 3: GitHub Topic Search (SKIPPED - test mode) ---\n");
  } else {
    console.log("\n--- Phase 3: GitHub Topic Search (Parallel) ---\n");
  }

  if (CONFIG.testMode.enabled) {
    // Skip Phase 3 in test mode
  } else if (shouldStopForTimeout()) {
    console.log("Skipping GitHub search due to execution timeout.");
  } else {
    // Wait for rate limit to reset if all clients are limited
    while (workerPool.allClientsLimited()) {
      if (shouldStopForTimeout()) {
        console.log("Skipping GitHub search due to execution timeout.");
        break;
      }
      const nextReset = workerPool.getNextResetTime();
      const waitTime = nextReset - Date.now();
      if (waitTime > 0) {
        console.log(
          `All clients rate limited. Waiting ${Math.ceil(waitTime / 1000)}s for reset...`,
        );
        await sleep(Math.min(waitTime + 1000, 60000));
      } else {
        await sleep(5000);
      }
      // Reset the global rate limit state since we're using workerPool now
      rateLimitState.isLimited = false;
    }

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

      const results = [];
      let processedCount = 0;

      // Create parallel tasks using processRepoWithCache
      const tasks = reposToProcess.map(({ repoFullName, repo }) => async () => {
        while (workerPool.allClientsLimited()) {
          if (shouldStopForTimeout()) return null;
          const nextReset = workerPool.getNextResetTime();
          const waitTime = nextReset - Date.now();
          if (waitTime > 0) {
            logRateLimitWait(Math.ceil(waitTime / 1000));
            await sleep(Math.min(waitTime, 30000));
          } else {
            await sleep(1000);
          }
        }

        if (shouldStopForTimeout()) return null;

        try {
          // Use processRepoWithCache for repo-level caching
          const repoSkills = await processRepoWithCache(
            workerPool,
            repo.owner.login,
            repo.name,
            repo,
            "github"
          );

          processedCount++;
          if (processedCount % 10 === 0) {
            const stats = workerPool.getStats();
            console.log(
              `  Progress: ${processedCount}/${reposToProcess.length} repos, ` +
              `${results.length + repoSkills.length} skills found, ` +
              `${stats.activeClients}/${stats.totalClients} clients active`
            );
          }

          return repoSkills;
        } catch (error) {
          console.error(`  Error processing ${repoFullName}: ${error.message}`);
          return null;
        }
      });

      // Execute parallel tasks
      const taskResults = await workerPool.addTasks(tasks);

      for (const repoSkills of taskResults) {
        if (repoSkills && repoSkills.length > 0) {
          results.push(...repoSkills);
        }
      }

      allSkills.push(...results);
      console.log(`\nPhase 3 complete: ${results.length} skills from ${processedCount} repos`);
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
    console.log(`\nRemoved ${duplicateCount} duplicate skill(s) by name+description`);
  }

  // Replace with deduplicated list
  allSkills.length = 0;
  allSkills.push(...dedupedSkills);

  // Generate zip packages for skills (if enabled)
  if (CONFIG.zips.enabled) {
    console.log(`\n${"=".repeat(50)}`);
    console.log("Generating Skill Zip Packages");
    console.log("=".repeat(50));
    
    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const skill of allSkills) {
      try {
        // Extract owner and repo from repository URL
        const match = skill.repository.url.match(/github\.com\/([^/]+)\/([^/]+)/);
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
          skill.repository.latestCommitHash
        );

        if (!needsRegeneration) {
          // Use cached zip info
          const zipInfo = crawlerCache.getZipInfo(cacheKey);
          if (zipInfo) {
            skill.skillZipUrl = generateZipUrl(
              CONFIG.zips.baseUrl,
              owner,
              repo,
              skill.name
            );
            skippedCount++;
            continue;
          }
        }

        // Generate new zip
        console.log(`  Generating zip for ${skill.name}...`);
        const { zipPath, zipHash } = await generateSkillZip(
          skill,
          CONFIG.zips.outputDir,
          activeClient?.octokit
        );

        // Update skill manifest with zip URL
        skill.skillZipUrl = generateZipUrl(
          CONFIG.zips.baseUrl,
          owner,
          repo,
          skill.name
        );

        // Update cache
        crawlerCache.setZipInfo(cacheKey, { zipHash, zipPath });
        
        generatedCount++;
      } catch (error) {
        console.error(`  ✗ Error generating zip for ${skill.name}: ${error.message}`);
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
  }

  // Generate output
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

  // Save output
  console.log(`\nSaving to ${CONFIG.outputPath}...`);

  const formattedJson = await prettier.format(JSON.stringify(output), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });

  await fs.writeFile(CONFIG.outputPath, formattedJson, "utf-8");
  
  // Save cache
  await crawlerCache.save();
  
  console.log("Done!");
}

// Run
main().catch((error) => {
  console.error("Crawler failed:", error);
  process.exit(1);
});
