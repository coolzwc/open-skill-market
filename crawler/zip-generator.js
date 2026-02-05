import fs from "fs/promises";
import path from "path";
import archiver from "archiver";
import crypto from "crypto";
import { createWriteStream } from "fs";

/**
 * Generate a zip package for a skill
 * @param {Object} skillManifest - Skill manifest object
 * @param {string} outputDir - Output directory for zip files
 * @param {Object} octokit - Octokit instance for fetching files
 * @returns {Promise<{zipPath: string, zipHash: string}>}
 */
export async function generateSkillZip(skillManifest, outputDir, octokit) {
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
  const fileContents = await fetchSkillFiles(owner, repo, branch, files, skillPath, octokit);

  // Create zip file
  await createZipFile(zipPath, fileContents, name, skillPath);

  // Calculate hash of zip file
  const zipHash = await calculateFileHash(zipPath);

  console.log(`✓ Generated ${zipFilename} (hash: ${zipHash.substring(0, 8)})`);

  return {
    zipPath: path.relative(path.join(outputDir, ".."), zipPath),
    zipHash,
  };
}

/**
 * Fetch skill files from GitHub or local filesystem
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name
 * @param {Array<string>} files - List of file paths
 * @param {string} skillPath - Skill directory path
 * @param {Object} octokit - Octokit instance
 * @returns {Promise<Array<{path: string, content: Buffer}>>}
 */
async function fetchSkillFiles(owner, repo, branch, files, skillPath, octokit) {
  const fileContents = [];

  for (const filePath of files) {
    try {
      // Check if it's a local file (for PR-submitted skills)
      const localPath = path.join(process.cwd(), filePath);
      try {
        const stats = await fs.stat(localPath);
        if (stats.isFile()) {
          // Read local file
          const content = await fs.readFile(localPath);
          fileContents.push({ path: filePath, content });
          continue;
        } else if (stats.isDirectory()) {
          // Read directory contents recursively
          const dirFiles = await readDirectoryRecursive(localPath, filePath);
          fileContents.push(...dirFiles);
          continue;
        }
      } catch (err) {
        // Not a local file, fetch from GitHub
      }

      // Fetch from GitHub
      if (octokit) {
        // Recursive function to fetch directory contents from GitHub
        async function fetchGitHubDirectoryRecursive(dirPath) {
          try {
            const { data } = await octokit.rest.repos.getContent({
              owner,
              repo,
              path: dirPath,
              ref: branch,
            });

            if (Array.isArray(data)) {
              // It's a directory, fetch all files recursively
              for (const item of data) {
                if (item.type === "file") {
                  const fileData = await octokit.rest.repos.getContent({
                    owner,
                    repo,
                    path: item.path,
                    ref: branch,
                  });
                  const content = Buffer.from(fileData.data.content, "base64");
                  fileContents.push({ path: item.path, content });
                } else if (item.type === "dir") {
                  // Recursively fetch subdirectory contents
                  await fetchGitHubDirectoryRecursive(item.path);
                }
              }
            } else if (data.type === "file") {
              // Single file
              const content = Buffer.from(data.content, "base64");
              fileContents.push({ path: dirPath, content });
            }
          } catch (error) {
            console.warn(`Warning: Failed to fetch ${dirPath}: ${error.message}`);
          }
        }

        await fetchGitHubDirectoryRecursive(filePath);
      }
    } catch (error) {
      console.warn(`Warning: Error processing ${filePath}: ${error.message}`);
    }
  }

  return fileContents;
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
      // Preserve directory structure: remove parent paths but keep skill directory name
      // Example: skills/canvas-design/SKILL.md -> canvas-design/SKILL.md
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
  // Remove everything before the skill name, but keep the skill name as top-level directory
  // Example: skills/canvas-design/SKILL.md -> canvas-design/SKILL.md
  // Example: skills/canvas-design/fonts/font.ttf -> canvas-design/fonts/font.ttf
  
  // Normalize paths
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const normalizedSkillPath = skillPath.replace(/\\/g, "/");
  
  // If the file path starts with the skill path, remove the parent part
  if (normalizedFilePath.startsWith(normalizedSkillPath + "/")) {
    return normalizedFilePath.substring(normalizedSkillPath.length + 1 - skillName.length - 1);
  }
  
  // Otherwise, try to find the skill name in the path and keep everything from there
  const skillNameIndex = normalizedFilePath.indexOf(`/${skillName}/`);
  if (skillNameIndex !== -1) {
    return normalizedFilePath.substring(skillNameIndex + 1);
  }
  
  // If skill name is at the start
  if (normalizedFilePath.startsWith(`${skillName}/`)) {
    return normalizedFilePath;
  }
  
  // Fallback: prepend skill name
  return `${skillName}/${path.basename(normalizedFilePath)}`;
}

/**
 * Calculate SHA-256 hash of a file
 * @param {string} filePath - File path
 * @returns {Promise<string>} - Hex hash string
 */
async function calculateFileHash(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
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
