/**
 * Self-test: scan cache get/set/remove and load/save.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { ScanCache } from "../scan-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("ScanCache get/set: miss returns skip false", () => {
  const cache = new ScanCache();
  const out = cache.get("owner/repo/path", "abc123");
  assert.strictEqual(out.skip, false);
  assert.strictEqual(out.result, undefined);
});

test("ScanCache get/set: set then get same commitHash returns skip true", () => {
  const cache = new ScanCache();
  cache.set("id1", "hash1", {
    securityScore: 80,
    riskLevel: "low",
    scanTags: ["safe"],
  });
  const out = cache.get("id1", "hash1");
  assert.strictEqual(out.skip, true);
  assert.strictEqual(out.result.securityScore, 80);
  assert.strictEqual(out.result.riskLevel, "low");
  assert.deepStrictEqual(out.result.scanTags, ["safe"]);
});

test("ScanCache get: different commitHash is miss", () => {
  const cache = new ScanCache();
  cache.set("id1", "hash1", { securityScore: 80, riskLevel: "low", scanTags: ["safe"] });
  assert.strictEqual(cache.get("id1", "hash2").skip, false);
  assert.strictEqual(cache.get("id1", "hash1").skip, true);
});

test("ScanCache remove: entry is gone", () => {
  const cache = new ScanCache();
  cache.set("id1", "hash1", { securityScore: 80, riskLevel: "low", scanTags: ["safe"] });
  cache.remove("id1");
  assert.strictEqual(cache.get("id1", "hash1").skip, false);
});

test("ScanCache load/save: roundtrip with temp file", async () => {
  const tmp = path.join(os.tmpdir(), `scan-cache-test-${Date.now()}.json`);
  const orig = process.env.SCAN_CACHE_FILE;
  process.env.SCAN_CACHE_FILE = tmp;
  try {
    const cache = new ScanCache();
    cache.set("a/b/c", "commit1", {
      securityScore: 70,
      riskLevel: "medium",
      scanTags: ["network-call"],
    });
    cache.set("d/e/f", "commit2", {
      securityScore: 100,
      riskLevel: "low",
      scanTags: ["safe"],
    });
    await cache.save();
    assert.strictEqual(cache.isDirty, false);

    const cache2 = new ScanCache();
    await cache2.load();
    const r1 = cache2.get("a/b/c", "commit1");
    const r2 = cache2.get("d/e/f", "commit2");
    assert.strictEqual(r1.skip, true);
    assert.strictEqual(r1.result.securityScore, 70);
    assert.strictEqual(r2.skip, true);
    assert.strictEqual(r2.result.securityScore, 100);
  } finally {
    if (orig !== undefined) process.env.SCAN_CACHE_FILE = orig;
    else delete process.env.SCAN_CACHE_FILE;
    await fs.unlink(tmp).catch(() => {});
  }
});
