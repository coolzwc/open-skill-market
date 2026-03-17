#!/usr/bin/env node
/**
 * Skill scan: load skills from market/skills.json (+ chunks), run rule-based detection in parallel
 * (queue + concurrency limit). Write back scan fields or remove skills with no zip.
 * Cache key is skill.id (owner/repo/path), so same-name skills from different repos do not conflict.
 *
 * Timeout (like crawler): stop before GHA job is killed, write partial results + scan cache, exit 1
 * so the workflow can re-trigger and continue until scan completes.
 *
 * Env:
 *   SCAN_TIMEOUT_MS   - stop starting new work after this many ms (should be < GHA job timeout)
 *   SCAN_SAVE_BUFFER_MS - reserve this many ms at the end to write files (default 5 min)
 *   CHUNK_SIZE        - same as crawler (default 2500)
 *   SCAN_CONCURRENCY  - max parallel scan tasks (default 10)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as prettier from "prettier";
import pLimit from "p-limit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MARKET_DIR = path.join(__dirname, "..", "market");
const SKILLS_JSON = path.join(MARKET_DIR, "skills.json");
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "2500", 10);
const SCAN_CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY || "10", 10));
// Leave room before GHA job timeout; workflow should set SCAN_TIMEOUT_MS to e.g. (timeout-minutes - 10) * 60 * 1000
const SCAN_TIMEOUT_MS = process.env.SCAN_TIMEOUT_MS
  ? parseInt(process.env.SCAN_TIMEOUT_MS, 10)
  : 5 * 60 * 60 * 1000; // 5h default
const SCAN_SAVE_BUFFER_MS = process.env.SCAN_SAVE_BUFFER_MS
  ? parseInt(process.env.SCAN_SAVE_BUFFER_MS, 10)
  : 5 * 60 * 1000; // 5 min to write skills.json + cache before job is killed

import { scanCache } from "./scan-cache.js";
import { loadSkillContent } from "./zip-loader.js";
import { runRules } from "./rules.js";
import { splitByRepo } from "../crawler/output-optimizer.js";

async function loadAllSkills() {
  const mainPath = SKILLS_JSON;
  const mainJson = await fs.readFile(mainPath, "utf-8");
  const main = JSON.parse(mainJson);
  const meta = { ...main.meta };
  const repositories = { ...(main.repositories || {}) };
  let skills = [...(main.skills || [])];
  const chunkNames = meta.chunks || [];
  for (const name of chunkNames) {
    const chunkPath = path.join(MARKET_DIR, name);
    try {
      const chunkJson = await fs.readFile(chunkPath, "utf-8");
      const chunk = JSON.parse(chunkJson);
      skills = skills.concat(chunk.skills || []);
      if (chunk.repositories) {
        for (const [k, v] of Object.entries(chunk.repositories)) {
          if (!repositories[k]) repositories[k] = v;
        }
      }
    } catch (err) {
      console.warn(`Warning: could not load ${name}: ${err.message}`);
    }
  }
  return { meta, repositories, skills };
}

/**
 * Process one skill: load zip (in-memory, no temp dir — no name conflict), run rules.
 * Cache key is skill.id (unique per owner/repo/path).
 */
async function processOneSkill({ i, skill }) {
  const skillId = skill.id;
  const commitHash = skill.commitHash || "";

  const content = await loadSkillContent(skill);
  if (!content) {
    scanCache.remove(skillId);
    return { i, removed: true };
  }

  const { scanTags, riskLevel, securityScore, qualityScore } = runRules(content.skillMd, content.files);
  const scannedAt = new Date().toISOString();
  scanCache.set(skillId, commitHash, {
    securityScore,
    riskLevel,
    scanTags,
    scannedAt,
    qualityScore,
  });
  return {
    i,
    skill: {
      ...skill,
      securityScore,
      riskLevel,
      scanTags,
      scannedAt,
      qualityScore,
    },
  };
}

async function run() {
  const startTime = Date.now();
  const deadline = startTime + SCAN_TIMEOUT_MS;
  const stopStartTime = deadline - SCAN_SAVE_BUFFER_MS; // stop starting new work so we have time to write
  console.log("Skill scan starting...");
  console.log(`  Timeout: ${SCAN_TIMEOUT_MS / 60000} min (stop starting work before job kill)`);
  console.log(`  Save buffer: ${SCAN_SAVE_BUFFER_MS / 60000} min`);
  console.log(`  Chunk size: ${CHUNK_SIZE}`);
  console.log(`  Concurrency: ${SCAN_CONCURRENCY}`);

  await scanCache.load();
  const { meta, repositories, skills: initialSkills } = await loadAllSkills();
  console.log(`  Loaded ${initialSkills.length} skills`);

  const limit = pLimit(SCAN_CONCURRENCY);
  const results = new Array(initialSkills.length);
  const toProcess = [];
  let skipped = 0;

  for (let i = 0; i < initialSkills.length; i++) {
    const skill = initialSkills[i];
    const skillId = skill.id;
    const commitHash = skill.commitHash || "";

    const cached = scanCache.get(skillId, commitHash);
    if (cached.skip && cached.result) {
      results[i] = {
        ...skill,
        securityScore: cached.result.securityScore,
        riskLevel: cached.result.riskLevel,
        scanTags: cached.result.scanTags,
        scannedAt: cached.result.scannedAt || new Date().toISOString(),
        qualityScore: cached.result.qualityScore ?? null,
      };
      skipped++;
    } else {
      toProcess.push({ i, skill });
    }
  }

  let scanned = 0;
  let removedNoZip = 0;
  let deferred = 0;

  // Process in batches so we can stop before GHA job timeout and write cache + results (like crawler)
  while (toProcess.length > 0) {
    if (Date.now() >= stopStartTime) {
      deferred = toProcess.length;
      console.log(`\nTimeout approaching (save buffer). Deferring ${deferred} skills; writing cache and re-trigger.`);
      for (const { i, skill } of toProcess) {
        results[i] = { ...skill };
      }
      break;
    }

    const batch = toProcess.splice(0, SCAN_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(({ i, skill }) => limit(() => processOneSkill({ i, skill })))
    );

    for (const out of outcomes) {
      if (out.removed) {
        results[out.i] = null;
        removedNoZip++;
      } else {
        results[out.i] = out.skill;
        scanned++;
      }
    }
  }

  const finalResults = results.filter((r) => r != null);
  const timedOut = deferred > 0;
  if (timedOut) {
    console.log(`  Deferred: ${deferred} (will be scanned on next run).`);
  }

  const newMeta = {
    ...meta,
    totalSkills: finalResults.length,
    scanIncomplete: timedOut,
    scanCompletedAt: timedOut ? undefined : new Date().toISOString(),
  };

  const compacted = {
    meta: newMeta,
    repositories,
    skills: finalResults,
  };

  const { main, chunks } = splitByRepo(compacted, CHUNK_SIZE);

  const mainFormatted = await prettier.format(JSON.stringify(main), {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
  });
  await fs.writeFile(SKILLS_JSON, mainFormatted, "utf-8");

  const outputDir = MARKET_DIR;
  if (chunks.length > 0) {
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

  try {
    const files = await fs.readdir(outputDir);
    for (const file of files) {
      const match = file.match(/^skills-(\d+)\.json$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > chunks.length) {
          await fs.unlink(path.join(outputDir, file));
          console.log(`  Removed stale chunk: ${file}`);
        }
      }
    }
  } catch {
    // ignore
  }

  await scanCache.save();

  console.log("\nScan summary:");
  console.log(`  Cached (skipped): ${skipped}`);
  console.log(`  Scanned:          ${scanned}`);
  console.log(`  Removed (no zip): ${removedNoZip}`);
  console.log(`  Deferred (timeout): ${deferred}`);
  console.log(`  Total in output:  ${finalResults.length}`);
  console.log(`  Incomplete:       ${timedOut}`);

  process.exit(timedOut ? 1 : 0);
}

run().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});
