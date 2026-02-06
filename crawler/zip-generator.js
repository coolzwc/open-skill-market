import fs from "fs/promises";
import path from "path";
import archiver from "archiver";
import { createWriteStream } from "fs";
import { shouldStopForTimeout } from "./rate-limit.js";
import { sleep } from "./utils.js";

/**
 * Generate a zip package for a skill
 * @param {Object} skillManifest - Skill manifest object
 * @param {string} outputDir - Output directory for zip files
 * @param {import('./worker-pool.js').WorkerPool} workerPool - Worker pool for rate-limited API calls
 * @returns {Promise<{zipPath: string}>}
 */
export async function generateSkillZip(skillManifest, outputDir, workerPool) {
  const { name, repository, files } = skillManifest;
  const { url, branch, path: skillPath } = repository;
  
  // Extract owner and repo from URL
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    throw new Error(`Invalid repository URL: ${url}`);
  }
  const [, owner, repo] = match;

  // Generate zip filename: owner-repo-skillName.zip
  const zipFilename = `${owner}-${repo}-${name}.zip`;
  const zipPath = path.join(outputDir, zipFilename);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Fetch skill files
  console.log(`Generating zip for ${name}...`);
  const fileContents = await fetchSkillFiles(owner, repo, branch, files, skillPath, workerPool);

  // Create zip file
  await createZipFile(zipPath, fileContents, name, skillPath);

  console.log(`✓ Generated ${zipFilename}`);

  return {
    zipPath: path.relative(path.join(outputDir, ".."), zipPath),
  };
}

/**
 * Fetch skill files from GitHub or local filesystem.
 * Uses workerPool for rate-limited GitHub API calls.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name
 * @param {Array<string>} files - List of file paths
 * @param {string} skillPath - Skill directory path
 * @param {import('./worker-pool.js').WorkerPool} workerPool - Worker pool for API calls
 * @returns {Promise<Array<{path: string, content: Buffer}>>}
 */
async function fetchSkillFiles(owner, repo, branch, files, skillPath, workerPool) {
  const fileContents = [];

  for (const filePath of files) {
    try {
      // Check if it's a local file (for PR-submitted skills)
      const localPath = path.join(process.cwd(), filePath);
      try {
        const stats = await fs.stat(localPath);
        if (stats.isFile()) {
          const content = await fs.readFile(localPath);
          fileContents.push({ path: filePath, content });
          continue;
        } else if (stats.isDirectory()) {
          const dirFiles = await readDirectoryRecursive(localPath, filePath);
          fileContents.push(...dirFiles);
          continue;
        }
      } catch (err) {
        // Not a local file, fetch from GitHub
      }

      // Fetch from GitHub using workerPool for rate limit protection
      if (workerPool) {
        await fetchGitHubPathWithPool(workerPool, owner, repo, branch, filePath, fileContents);
      }
    } catch (error) {
      console.warn(`Warning: Error processing ${filePath}: ${error.message}`);
    }
  }

  return fileContents;
}

/**
 * Fetch a file or directory from GitHub recursively, using workerPool for rate limiting.
 * @param {import('./worker-pool.js').WorkerPool} workerPool
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} dirPath
 * @param {Array<{path: string, content: Buffer}>} fileContents - accumulator
 */
async function fetchGitHubPathWithPool(workerPool, owner, repo, branch, dirPath, fileContents) {
  // Wait for rate limit reset if all clients are limited
  while (workerPool.allClientsLimited()) {
    if (shouldStopForTimeout()) return;
    const nextReset = workerPool.getNextResetTime();
    const waitTime = nextReset - Date.now();
    if (waitTime > 0) {
      await sleep(Math.min(waitTime + 1000, 30000));
    } else {
      await sleep(1000);
    }
  }

  const client = workerPool.getClient();

  try {
    const response = await client.octokit.rest.repos.getContent({
      owner,
      repo,
      path: dirPath,
      ref: branch,
    });
    workerPool.updateClientRateLimit(client, response);

    const { data } = response;

    if (Array.isArray(data)) {
      // It's a directory — fetch all files recursively
      for (const item of data) {
        if (item.type === "file") {
          // Wait for rate limit
          while (workerPool.allClientsLimited()) {
            if (shouldStopForTimeout()) return;
            const nextReset = workerPool.getNextResetTime();
            const waitTime = nextReset - Date.now();
            if (waitTime > 0) {
              await sleep(Math.min(waitTime + 1000, 30000));
            } else {
              await sleep(1000);
            }
          }

          const fileClient = workerPool.getClient();
          try {
            const fileResponse = await fileClient.octokit.rest.repos.getContent({
              owner,
              repo,
              path: item.path,
              ref: branch,
            });
            workerPool.updateClientRateLimit(fileClient, fileResponse);
            const content = Buffer.from(fileResponse.data.content, "base64");
            fileContents.push({ path: item.path, content });
          } catch (error) {
            if (error.status === 403 || error.status === 429) {
              fileClient.core.isLimited = true;
              if (error.response?.headers?.["x-ratelimit-reset"]) {
                fileClient.core.resetTime =
                  parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
              }
            }
            console.warn(`Warning: Failed to fetch file ${item.path}: ${error.message}`);
          }
        } else if (item.type === "dir") {
          await fetchGitHubPathWithPool(workerPool, owner, repo, branch, item.path, fileContents);
        }
      }
    } else if (data.type === "file") {
      const content = Buffer.from(data.content, "base64");
      fileContents.push({ path: dirPath, content });
    }
  } catch (error) {
    if (error.status === 403 || error.status === 429) {
      client.core.isLimited = true;
      if (error.response?.headers?.["x-ratelimit-reset"]) {
        client.core.resetTime =
          parseInt(error.response.headers["x-ratelimit-reset"], 10) * 1000;
      }
    }
    console.warn(`Warning: Failed to fetch ${dirPath}: ${error.message}`);
  }
}

/**
 * Read directory contents recursively
 * @param {string} dirPath - Directory path
 * @param {string} relativePath - Relative path for zip
 * @returns {Promise<Array<{path: string, content: Buffer}>>}
 */
async function readDirectoryRecursive(dirPath, relativePath) {
  const files = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await readDirectoryRecursive(fullPath, relPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const content = await fs.readFile(fullPath);
      files.push({ path: relPath, content });
    }
  }

  return files;
}

/**
 * Create zip file with skill contents
 * Preserves the skill directory structure (e.g., canvas-design/SKILL.md)
 * @param {string} zipPath - Output zip file path
 * @param {Array<{path: string, content: Buffer}>} files - Files to include
 * @param {string} skillName - Skill name (used as top-level directory)
 * @param {string} skillPath - Original skill path (e.g., "skills/canvas-design")
 */
async function createZipFile(zipPath, files, skillName, skillPath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Maximum compression
    });

    output.on("close", () => {
      resolve();
    });

    archive.on("error", (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add files to archive with preserved directory structure
    for (const file of files) {
      const zipEntryPath = preserveDirectoryStructure(file.path, skillPath, skillName);
      archive.append(file.content, { name: zipEntryPath });
    }

    archive.finalize();
  });
}

/**
 * Preserve directory structure in zip file
 * Removes parent paths but keeps the skill directory name as the top-level directory
 * @param {string} filePath - Original file path (e.g., "skills/canvas-design/SKILL.md")
 * @param {string} skillPath - Skill directory path (e.g., "skills/canvas-design")
 * @param {string} skillName - Skill name (e.g., "canvas-design")
 * @returns {string} - Path in zip file (e.g., "canvas-design/SKILL.md")
 */
function preserveDirectoryStructure(filePath, skillPath, skillName) {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedSkillPath = skillPath.replace(/\\/g, "/");
  
  // Case 1: File path starts with the skill path
  // e.g., "skills/canvas-design/SKILL.md" -> "canvas-design/SKILL.md"
  if (normalizedSkillPath && normalizedFilePath.startsWith(normalizedSkillPath + "/")) {
    const relativePath = normalizedFilePath.substring(normalizedSkillPath.length + 1);
    return `${skillName}/${relativePath}`;
  }
  
  // Case 2: File path exactly matches skill path (root file)
  if (normalizedFilePath === normalizedSkillPath) {
    return skillName;
  }
  
  // Case 3: Skill name appears in the path
  // e.g., "some/path/canvas-design/file.md" -> "canvas-design/file.md"
  const skillNameIndex = normalizedFilePath.indexOf(`/${skillName}/`);
  if (skillNameIndex !== -1) {
    return normalizedFilePath.substring(skillNameIndex + 1);
  }
  
  // Case 4: Path already starts with skill name
  if (normalizedFilePath.startsWith(`${skillName}/`)) {
    return normalizedFilePath;
  }
  
  // Case 5: Fallback - put file under skill name directory
  return `${skillName}/${path.basename(normalizedFilePath)}`;
}

/**
 * Generate zip URL for a skill
 * @param {string} baseUrl - Base URL for zip files
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} skillName - Skill name
 * @returns {string} - Full URL to zip file
 */
export function generateZipUrl(baseUrl, owner, repo, skillName) {
  const zipFilename = `${owner}-${repo}-${skillName}.zip`;
  return `${baseUrl}/${zipFilename}`;
}
