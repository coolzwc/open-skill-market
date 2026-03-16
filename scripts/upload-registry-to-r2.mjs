#!/usr/bin/env node
/**
 * Upload skills.json and chunk files (skills-*.json) to Cloudflare R2 (CDN).
 * Used after skill-scan completes. Requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT.
 * Optional: R2_BUCKET (default "skill-market").
 */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { uploadToR2, isR2Configured } from "../crawler/r2-uploader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const marketDir = path.join(rootDir, "market");
const mainPath = path.join(marketDir, "skills.json");

async function main() {
  if (!isR2Configured()) {
    console.error("R2 not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT.");
    process.exit(1);
  }

  const bucket = process.env.R2_BUCKET || "skill-market";

  const mainJson = await fs.readFile(mainPath, "utf-8");
  const mainData = JSON.parse(mainJson);
  const chunks = mainData.meta?.chunks || [];

  console.log("Uploading registry files to R2...");

  try {
    await uploadToR2(mainPath, "skills.json", bucket);
    console.log("  ✓ Uploaded skills.json");
  } catch (err) {
    console.error(`  ✗ Failed to upload skills.json: ${err.message}`);
    process.exit(1);
  }

  const chunkNameRe = /^skills-\d+\.json$/;
  for (const chunkFilename of chunks) {
    if (!chunkNameRe.test(chunkFilename)) {
      console.warn(`  ⚠ Skipped invalid chunk name: ${chunkFilename}`);
      continue;
    }
    const chunkPath = path.join(marketDir, chunkFilename);
    try {
      await fs.access(chunkPath);
      await uploadToR2(chunkPath, chunkFilename, bucket);
      console.log(`  ✓ Uploaded ${chunkFilename}`);
    } catch (err) {
      if (err.code === "ENOENT") {
        console.warn(`  ⚠ Skipped ${chunkFilename} (file not found)`);
      } else {
        console.error(`  ✗ Failed to upload ${chunkFilename}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
