import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { spawnSync } from "child_process";
import { CONFIG } from "./config.js";
import {
  pathExists,
  listFilesRecursive,
  generateDisplayName,
} from "./utils.js";
import { parseSkillContent, categorizeSkill } from "./skill-parser.js";

/**
 * Get git commit hash for a local directory
 * Uses spawnSync with argument array to avoid shell injection
 * @param {string} dirPath - Directory path (relative to localSkillsPath)
 * @returns {string} - Short commit hash or empty string
 */
function getLocalDirCommitHash(dirPath) {
  try {
    // Use spawnSync with argument array to safely pass the path
    const result = spawnSync(
      "git",
      ["log", "-1", "--format=%H", "--", dirPath],
      {
        cwd: CONFIG.localSkillsPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    
    if (result.status !== 0 || !result.stdout) {
      return "";
    }
    
    const hash = result.stdout.trim();
    return hash ? hash.substring(0, 12) : "";
  } catch {
    return "";
  }
}

/**
 * Scan local skills directory for PR-submitted skills
 * @returns {Promise<Object[]>}
 */
export async function scanLocalSkills() {
  const localSkills = [];

  if (!(await pathExists(CONFIG.localSkillsPath))) {
    console.log("Local skills directory not found.");
    return localSkills;
  }

  console.log(`Scanning local skills in ${CONFIG.localSkillsPath}...`);

  const entries = await fs.readdir(CONFIG.localSkillsPath, {
    withFileTypes: true,
  });
  const skillDirs = entries.filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith("."),
  );

  for (const skillDir of skillDirs) {
    const skillPath = path.join(CONFIG.localSkillsPath, skillDir.name);
    const skillMdPath = path.join(skillPath, CONFIG.skillFilename);

    if (!(await pathExists(skillMdPath))) {
      continue;
    }

    try {
      const content = await fs.readFile(skillMdPath, "utf-8");
      const parsed = parseSkillContent(content);

      if (!parsed.isValid) {
        console.log(`  Skipped ${skillDir.name}: ${parsed.invalidReason}`);
        continue;
      }

      // Get all files in skill directory
      const allFiles = await listFilesRecursive(skillPath);
      const relativeFiles = allFiles.map((f) =>
        path.relative(CONFIG.localSkillsPath, f),
      );

      const { data: frontmatter } = matter(content);
      const authorName = frontmatter.author?.name || CONFIG.thisRepo.owner;
      const authorUrl =
        frontmatter.author?.url || `https://github.com/${authorName}`;

      const detailsUrl = `${CONFIG.thisRepo.url}/blob/main/skills/${skillDir.name}/${CONFIG.skillFilename}`;

      const skillName = parsed.name || skillDir.name;
      const skillDescription =
        parsed.description || `Local skill: ${skillDir.name}`;

      // Get commit hash for this skill directory
      const localCommitHash = getLocalDirCommitHash(skillDir.name);

      const manifest = {
        id: `${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}/skills/${skillDir.name}`,
        name: skillName,
        displayName: generateDisplayName(skillName),
        description: skillDescription,
        categories: categorizeSkill(skillName, skillDescription),
        details: detailsUrl,
        author: {
          name: authorName,
          url: authorUrl,
          avatar: `https://github.com/${authorName}.png`,
        },
        version: parsed.version || "0.0.0",
        commitHash: localCommitHash || "local",
        tags: parsed.tags,
        repository: {
          url: CONFIG.thisRepo.url,
          branch: "main",
          path: `skills/${skillDir.name}`,
          downloadUrl: `https://api.github.com/repos/${CONFIG.thisRepo.owner}/${CONFIG.thisRepo.name}/zipball/main`,
        },
        files: relativeFiles.slice(0, CONFIG.fileLimits?.maxFilesPerSkill || 20),
        stats: {
          stars: 0,
          forks: 0,
          lastUpdated: new Date().toISOString(),
        },
        source: "local",
      };

      if (parsed.version) {
        manifest.compatibility = {
          minAgentVersion: "0.1.0",
        };
      }

      localSkills.push(manifest);
    } catch (error) {
      console.error(`  Error processing ${skillDir.name}: ${error.message}`);
    }
  }

  console.log(`  Total local skills found: ${localSkills.length}`);
  return localSkills;
}
