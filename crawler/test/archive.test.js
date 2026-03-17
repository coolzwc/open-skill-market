/**
 * Tests for github/archive.js: extractZipToTemp and cleanup.
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { extractZipToTemp, removeExtractDir, cleanupAllExtracts } from "../github/archive.js";

test("extractZipToTemp: returns extractRoot with single top-level dir", async () => {
  const zip = new AdmZip();
  zip.addFile("owner-repo-abc123def/SKILL.md", Buffer.from("# Test\n", "utf-8"));
  const buffer = zip.toBuffer();

  const { extractRoot, extractDir } = await extractZipToTemp(buffer);
  assert.ok(extractRoot, "extractRoot is set");
  assert.ok(extractDir, "extractDir is set");
  assert.ok(extractRoot.startsWith(extractDir), "extractRoot is under extractDir");

  const skillPath = path.join(extractRoot, "SKILL.md");
  const content = await fs.readFile(skillPath, "utf-8");
  assert.strictEqual(content, "# Test\n");

  await removeExtractDir(extractDir);
  await fs.access(extractDir).then(
    () => assert.fail("extractDir should be removed"),
    (err) => assert.strictEqual(err.code, "ENOENT"),
  );
});

test("cleanupAllExtracts: does not throw", async () => {
  await cleanupAllExtracts();
});
