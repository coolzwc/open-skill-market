/**
 * Self-test: detector batch loop and timeout deferral logic.
 * Simulates the same loop as index.js to verify we stop in time and fill deferred.
 */
import { test } from "node:test";
import assert from "node:assert";
import pLimit from "p-limit";

test("batch loop: stop before deadline and mark remaining as deferred", async () => {
  const SCAN_CONCURRENCY = 2;
  const stopStartTime = Date.now() + 25;
  const toProcess = [
    { i: 0, skill: { id: "a/b/s1", name: "s1" } },
    { i: 1, skill: { id: "a/b/s2", name: "s2" } },
    { i: 2, skill: { id: "a/b/s3", name: "s3" } },
    { i: 3, skill: { id: "a/b/s4", name: "s4" } },
    { i: 4, skill: { id: "a/b/s5", name: "s5" } },
  ];
  const results = new Array(5);

  const limit = pLimit(SCAN_CONCURRENCY);
  let processed = 0;

  while (toProcess.length > 0) {
    if (Date.now() >= stopStartTime) {
      for (const { i, skill } of toProcess) {
        results[i] = { ...skill };
      }
      break;
    }
    const batch = toProcess.splice(0, SCAN_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(({ i, skill }) =>
        limit(async () => {
          await new Promise((r) => setTimeout(r, 15));
          processed++;
          return { i, skill: { ...skill, securityScore: 80, scannedAt: new Date().toISOString() } };
        })
      )
    );
    for (const out of outcomes) {
      results[out.i] = out.skill;
    }
  }

  assert.ok(processed >= 1);
  const filled = results.filter(Boolean);
  assert.strictEqual(filled.length, 5, "all 5 skills should be in results (scanned or deferred)");
  const withScore = filled.filter((r) => r.securityScore !== undefined);
  const deferred = filled.filter((r) => r.securityScore === undefined);
  assert.ok(deferred.length >= 1, "timeout should defer at least one (no scan fields)");
  assert.ok(withScore.length >= 1, "at least one batch should complete before deadline");
});

test("result order preserved by index i", () => {
  const results = new Array(5);
  results[0] = { id: "first" };
  results[3] = { id: "fourth" };
  results[4] = { id: "fifth" };
  const finalResults = results.filter((r) => r != null);
  assert.strictEqual(finalResults[0].id, "first");
  assert.strictEqual(finalResults[1].id, "fourth");
  assert.strictEqual(finalResults[2].id, "fifth");
});
