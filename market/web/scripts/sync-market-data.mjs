import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const marketRoot = path.resolve(projectRoot, "..");
const sourceMain = path.join(marketRoot, "skills.json");
const sourceChunkGlobPrefix = "skills-";
const sourceDir = marketRoot;
const targetDir = path.join(projectRoot, "public", "data");

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function copyRequiredFiles() {
  await ensureDir(targetDir);

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        name === "skills.json" ||
        (name.startsWith(sourceChunkGlobPrefix) && name.endsWith(".json")),
    );

  if (!files.includes("skills.json")) {
    throw new Error(`Missing source file: ${sourceMain}`);
  }

  await Promise.all(
    files.map((file) =>
      fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file)),
    ),
  );

  console.log(`Synced ${files.length} market JSON files -> ${targetDir}`);
}

copyRequiredFiles().catch((error) => {
  console.error(error);
  process.exit(1);
});
