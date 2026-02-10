import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import AdmZip from "adm-zip";

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/coolzwc/open-skill-market/main/market/skills.json";
const ZIP_BASE_URL =
  process.env.SKILL_MARKET_ZIP_URL || "https://cdn.skillmarket.cc/zips";
const META_FILENAME = ".skill-market-meta.json";
const SKILL_FILENAME = "SKILL.md";

const TOOL_KEYS = ["cursor", "claude", "codex", "copilot"];

function printHelp() {
  console.log(`skill-market

Usage:
  npx skill-market list [--tool <cursor|claude|codex|copilot>]
  npx skill-market search <keyword>
  npx skill-market install <skill-id-or-name> [--tool <...>] [--dir <path>] [--check]
  npx skill-market update <skill-id-or-name|--all> [--tool <...>] [--dir <path>] [--check]

Flags:
  --registry <url>  Override registry URL
  --tool <name>     Target tool: cursor|claude|codex|copilot
  --dir <path>      Override install base directory
  --limit <n>       Limit number of rows for list/search
  --check           Check status only, no write
  --json            Output JSON results
  --yes             Auto-select first candidate on ambiguous matches
  --help            Show help
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function normalizeTool(toolName) {
  const key = String(toolName || "").toLowerCase();
  if (key === "claude-code") return "claude";
  if (key === "codex-cli") return "codex";
  if (key === "github-copilot") return "copilot";
  if (TOOL_KEYS.includes(key)) return key;
  return "";
}

function defaultInstallBase(tool) {
  const home = os.homedir();
  switch (tool) {
    case "cursor":
      return path.join(home, ".cursor", "skills");
    case "claude":
      return path.join(home, ".claude", "skills");
    case "codex":
      return path.join(home, ".codex", "skills");
    case "copilot":
      return path.join(home, ".config", "github-copilot", "skills");
    default:
      return path.join(home, ".cursor", "skills");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Request failed ${response.status}: ${url}`);
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${url}`);
  const ab = await response.arrayBuffer();
  return Buffer.from(ab);
}

async function loadRegistry(registryUrl) {
  const main = await fetchJson(registryUrl);
  main.repositories = main.repositories || {};
  const allSkills = [...(main.skills || [])];
  const chunks = main.meta?.chunks || [];

  if (chunks.length > 0) {
    const base = new URL(".", registryUrl).toString();
    const chunkResults = await Promise.all(
      chunks.map((chunkFile) => fetchJson(new URL(chunkFile, base).toString())),
    );
    for (const chunk of chunkResults) {
      allSkills.push(...(chunk.skills || []));
      Object.assign(main.repositories, chunk.repositories || {});
    }
  }

  return { ...main, allSkills };
}

function expandSkill(skill, repositories) {
  const repoInfo = repositories[skill.repo] || {};
  const repoUrl = repoInfo.url || `https://github.com/${skill.repo}`;
  const branch = repoInfo.branch || "main";
  const pathInRepo = skill.path || "";
  const [owner, repo] = skill.repo.split("/");
  return {
    ...skill,
    repoUrl,
    branch,
    skillZipUrl: `${ZIP_BASE_URL}/${owner}-${repo}-${skill.name}.zip`,
    downloadUrl: `https://api.github.com/repos/${owner}/${repo}/zipball/${branch}`,
    detailsUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${pathInRepo}/SKILL.md`,
    stars: Number(repoInfo.stars || 0),
  };
}

function getSkillMatches(skills, selector) {
  const exactById = skills.find((item) => item.id === selector);
  if (exactById)
    return { selected: exactById, matches: [exactById], exact: true };
  const exactByName = skills.find((item) => item.name === selector);
  if (exactByName)
    return { selected: exactByName, matches: [exactByName], exact: true };
  const q = selector.toLowerCase();
  const hits = skills.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q),
  );
  if (hits.length === 1)
    return { selected: hits[0], matches: hits, exact: false };
  if (hits.length === 0) return { selected: null, matches: [], exact: false };
  return { selected: null, matches: hits, exact: false };
}

async function chooseSkillInteractively(selector, matches, jsonMode) {
  const top = matches.slice(0, 12);
  if (jsonMode) {
    throw new Error(
      JSON.stringify({
        error: "ambiguous-skill",
        message: `Multiple skills matched "${selector}"`,
        candidates: top.map((item) => ({ id: item.id, name: item.name })),
      }),
    );
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error(
      `Multiple skills matched "${selector}". Use exact id/name. Top matches: ${top
        .map((item) => item.name)
        .join(", ")}`,
    );
  }

  console.log(`Multiple skills matched "${selector}". Select one:`);
  top.forEach((item, idx) => {
    console.log(`  ${idx + 1}) ${item.name}  [${item.id}]`);
  });

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Choose number (empty to cancel): ");
    const index = Number(answer.trim());
    if (!Number.isInteger(index) || index < 1 || index > top.length) {
      throw new Error("Selection cancelled.");
    }
    return top[index - 1];
  } finally {
    rl.close();
  }
}

function printAsJson(payload, enabled) {
  if (!enabled) return false;
  console.log(JSON.stringify(payload, null, 2));
  return true;
}

function resolveLimit(args, fallback, max = 500) {
  if (args.limit === undefined) return fallback;
  const parsed = Number(args.limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${args.limit}`);
  }
  return Math.min(parsed, max);
}

function shortSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    repo: skill.repo,
    stars: skill.stars,
  };
}

function skillSupportsTool(skill, tool) {
  const agents = skill.compatibility?.agents;
  if (!agents || agents.length === 0) return true;
  const normalized = agents.map((agent) => String(agent).toLowerCase());
  if (tool === "claude") return normalized.some((x) => x.includes("claude"));
  if (tool === "codex") return normalized.some((x) => x.includes("codex"));
  if (tool === "copilot") return normalized.some((x) => x.includes("copilot"));
  if (tool === "cursor") return normalized.some((x) => x.includes("cursor"));
  return true;
}

async function listDirRecursive(root) {
  const out = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await visit(root);
  return out;
}

async function hashFile(file) {
  const content = await fs.readFile(file);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function fingerprintDirectory(root) {
  const map = {};
  const files = await listDirRecursive(root);
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    if (rel === META_FILENAME) continue;
    map[rel] = await hashFile(file);
  }
  return map;
}

function sameFingerprint(a, b) {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (a[aKeys[i]] !== b[bKeys[i]]) return false;
  }
  return true;
}

async function ensureEmptyDir(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

async function findCandidateSkillDir(root, skill) {
  const preferredSuffix = skill.path?.replaceAll("\\", "/");
  let firstSkillMdDir = null; // Fallback: first dir with SKILL.md

  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      const norm = full.replaceAll("\\", "/");

      // Priority 1: exact path suffix match
      if (preferredSuffix && norm.endsWith(`/${preferredSuffix}`)) return full;

      const skillFile = path.join(full, SKILL_FILENAME);
      try {
        await fs.access(skillFile);
        // Priority 2: directory name matches skill name
        if (entry.name === skill.name) return full;
        // Track first SKILL.md dir as fallback
        if (!firstSkillMdDir) firstSkillMdDir = full;
      } catch {
        // No SKILL.md here, keep searching
      }

      const deep = await visit(full);
      if (deep) return deep;
    }
    return null;
  }

  const result = await visit(root);
  return result || firstSkillMdDir || "";
}

async function extractRemoteSkill(skill, tmpBase) {
  // Try skill-specific zip first, fall back to full repo zipball
  const urls = [skill.skillZipUrl, skill.downloadUrl].filter(Boolean);
  let lastError;
  for (const sourceUrl of urls) {
    try {
      const zipBuffer = await fetchBuffer(sourceUrl);

      const zipFile = path.join(tmpBase, "skill.zip");
      await fs.writeFile(zipFile, zipBuffer);

      const extractDir = path.join(tmpBase, "extract");
      await ensureEmptyDir(extractDir);

      const zip = new AdmZip(zipFile);

      // For repo zipball fallback: try to extract only the skill directory
      const isRepoZipball = sourceUrl === skill.downloadUrl;
      if (isRepoZipball && skill.path) {
        const extracted = await extractSkillDirOnly(zip, extractDir, skill);
        if (extracted) return { sourceUrl, extractedSkillDir: extracted };
        // Partial extraction failed — clean up before full extraction
        await ensureEmptyDir(extractDir);
      }

      // Full extraction (for skill-specific zips or if partial extraction failed)
      zip.extractAllTo(extractDir, true);

      const candidate = await findCandidateSkillDir(extractDir, skill);
      if (!candidate) {
        throw new Error(
          `Cannot locate skill directory in archive for ${skill.name}. Source: ${sourceUrl}`,
        );
      }
      return { sourceUrl, extractedSkillDir: candidate };
    } catch (err) {
      lastError = err;
      // If skill zip failed, try next URL (repo zipball fallback)
    }
  }
  throw lastError || new Error(`Failed to download skill ${skill.name}`);
}

/**
 * Extract only the skill directory from a repo zipball.
 * GitHub zipball entries are prefixed with "{owner}-{repo}-{hash}/".
 * We match entries whose path contains "/{skill.path}/" and extract them.
 *
 * @param {AdmZip} zip - Opened zip archive
 * @param {string} extractDir - Temp extraction directory
 * @param {Object} skill - Skill manifest with .path and .name
 * @returns {Promise<string|null>} - Path to extracted skill dir, or null if not found
 */
async function extractSkillDirOnly(zip, extractDir, skill) {
  const skillPath = skill.path.replace(/\\/g, "/");
  const entries = zip.getEntries();

  // Find entries that belong to this skill's directory
  // GitHub zipball format: "owner-repo-commitsha/skill/path/file.md"
  const matchingEntries = [];
  let skillDirPrefix = null;

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, "/");
    // Match: <any-prefix>/<skill.path>/ or <any-prefix>/<skill.path>/...
    const idx = entryName.indexOf(`/${skillPath}/`);
    if (idx !== -1) {
      if (!skillDirPrefix) {
        skillDirPrefix = entryName.substring(0, idx + 1 + skillPath.length + 1);
      }
      matchingEntries.push(entry);
    }
    // Also match exact directory entry
    if (entryName.endsWith(`/${skillPath}/`) || entryName === `${skillPath}/`) {
      if (!skillDirPrefix) {
        skillDirPrefix = entryName;
      }
    }
  }

  if (matchingEntries.length === 0 || !skillDirPrefix) return null;

  // Extract matching entries, remapping paths to skill.name/
  const skillOutputDir = path.join(extractDir, skill.name);
  try {
    for (const entry of matchingEntries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, "/");
      const relativePath = entryName.substring(skillDirPrefix.length);
      if (!relativePath) continue;
      const targetPath = path.join(skillOutputDir, relativePath);
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, entry.getData());
    }
  } catch {
    return null; // Fall back to full extraction
  }

  return skillOutputDir;
}

/**
 * Scan local install directory and match installed skills against registry.
 * Returns only expanded skills that have a local installation.
 */
async function findInstalledSkills(baseDir, expandedSkills) {
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch {
    return []; // Directory doesn't exist — nothing installed
  }

  // Build lookup: skill name -> expanded skill
  const byName = new Map();
  const byId = new Map();
  for (const skill of expandedSkills) {
    byName.set(skill.name, skill);
    byId.set(skill.id, skill);
  }

  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const skillDir = path.join(baseDir, dirName);

    // Try to read install metadata first (has skill ID)
    const meta = await readInstallMeta(skillDir);
    if (meta?.skillId && byId.has(meta.skillId)) {
      installed.push(byId.get(meta.skillId));
      continue;
    }

    // Fallback: match by directory name (= skill.name)
    if (byName.has(dirName)) {
      installed.push(byName.get(dirName));
    }
  }
  return installed;
}

async function readInstallMeta(skillDir) {
  const metaPath = path.join(skillDir, META_FILENAME);
  try {
    const content = await fs.readFile(metaPath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeInstallMeta(skillDir, skill, tool, sourceUrl) {
  const metaPath = path.join(skillDir, META_FILENAME);
  const payload = {
    skillId: skill.id,
    name: skill.name,
    tool,
    installedAt: new Date().toISOString(),
    installedCommitHash: skill.commitHash || "",
    source: sourceUrl,
  };
  await fs.writeFile(metaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function resolveStatus(localSkillDir, skill, remoteExtractedDir) {
  let localExists = true;
  try {
    await fs.access(localSkillDir);
  } catch {
    localExists = false;
  }

  if (!localExists)
    return { code: "not-installed", message: "Not installed yet." };

  const meta = await readInstallMeta(localSkillDir);
  if (meta?.installedCommitHash && skill.commitHash) {
    if (meta.installedCommitHash === skill.commitHash) {
      return {
        code: "up-to-date",
        message: "No updates (commit hash matched).",
      };
    }
    return {
      code: "update-available",
      message: `Update available (${meta.installedCommitHash} -> ${skill.commitHash}).`,
    };
  }

  const localFingerprint = await fingerprintDirectory(localSkillDir);
  const remoteFingerprint = await fingerprintDirectory(remoteExtractedDir);
  if (sameFingerprint(localFingerprint, remoteFingerprint)) {
    return {
      code: "up-to-date-legacy",
      message: "Legacy install is identical (file compare).",
    };
  }
  return {
    code: "update-available-legacy",
    message: "Legacy install differs from latest package (file compare).",
  };
}

async function installOrUpdate({ skill, tool, baseDir, checkOnly, jsonMode }) {
  await fs.mkdir(baseDir, { recursive: true });
  if (!skillSupportsTool(skill, tool)) {
    console.warn(`[warn] ${skill.name} may not support tool "${tool}"`);
  }

  const localSkillDir = path.join(baseDir, skill.name);

  // Fast path: if local meta has matching commit hash, skip expensive download
  if (skill.commitHash) {
    const localMeta = await readInstallMeta(localSkillDir);
    if (
      localMeta?.installedCommitHash &&
      localMeta.installedCommitHash === skill.commitHash
    ) {
      const msg = "No updates (commit hash matched).";
      if (!jsonMode) console.log(`[${skill.name}] ${msg}`);
      return {
        skill: shortSkill(skill),
        tool,
        baseDir,
        localSkillDir,
        status: "up-to-date",
        message: msg,
        checkOnly,
      };
    }
  }

  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-"));

  try {
    const { sourceUrl, extractedSkillDir } = await extractRemoteSkill(
      skill,
      tmpBase,
    );
    const status = await resolveStatus(localSkillDir, skill, extractedSkillDir);
    if (!jsonMode) {
      console.log(`[${skill.name}] ${status.message}`);
    }

    if (checkOnly) {
      return {
        skill: shortSkill(skill),
        tool,
        baseDir,
        localSkillDir,
        status: status.code,
        message: status.message,
        checkOnly: true,
      };
    }
    if (status.code === "up-to-date") {
      return {
        skill: shortSkill(skill),
        tool,
        baseDir,
        localSkillDir,
        status: status.code,
        message: status.message,
        checkOnly: false,
      };
    }
    if (status.code === "up-to-date-legacy") {
      // Legacy installs get migrated to commit-based tracking without forcing file rewrite.
      await writeInstallMeta(localSkillDir, skill, tool, sourceUrl);
      if (!jsonMode) {
        console.log(
          `[${skill.name}] Metadata written for commit-hash tracking.`,
        );
      }
      return {
        skill: shortSkill(skill),
        tool,
        baseDir,
        localSkillDir,
        status: status.code,
        message: status.message,
        checkOnly: false,
        metadataMigrated: true,
      };
    }

    await ensureEmptyDir(localSkillDir);
    await fs.cp(extractedSkillDir, localSkillDir, { recursive: true });
    await writeInstallMeta(localSkillDir, skill, tool, sourceUrl);
    if (!jsonMode) {
      console.log(`[${skill.name}] Installed to ${localSkillDir}`);
    }
    return {
      skill: shortSkill(skill),
      tool,
      baseDir,
      localSkillDir,
      status: "installed",
      message: `Installed to ${localSkillDir}`,
      checkOnly: false,
      sourceUrl,
    };
  } finally {
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
}

function selectSkillsForList(allSkills, repositories, tool) {
  return allSkills
    .map((skill) => expandSkill(skill, repositories))
    .filter((skill) => (tool ? skillSupportsTool(skill, tool) : true))
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
}

async function runList(registry, args) {
  const jsonMode = Boolean(args.json);
  const tool = args.tool ? normalizeTool(args.tool) : "";
  if (args.tool && !tool) throw new Error(`Unsupported tool: ${args.tool}`);
  const limit = resolveLimit(args, 100);
  const rows = selectSkillsForList(
    registry.allSkills,
    registry.repositories,
    tool,
  ).slice(0, limit);
  if (
    printAsJson(
      {
        command: "list",
        tool: tool || null,
        limit,
        count: rows.length,
        skills: rows.map(shortSkill),
      },
      jsonMode,
    )
  ) {
    return;
  }
  for (const skill of rows) {
    console.log(`${skill.name}  [${skill.id}]  stars:${skill.stars}`);
  }
  console.log(`Total shown: ${rows.length}`);
}

async function runSearch(registry, args) {
  const jsonMode = Boolean(args.json);
  const keyword = args._[1];
  if (!keyword) throw new Error("Usage: search <keyword>");
  const limit = resolveLimit(args, 50);
  const q = keyword.toLowerCase();
  const rows = registry.allSkills
    .map((skill) => expandSkill(skill, registry.repositories))
    .filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.id.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q),
    )
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name))
    .slice(0, limit);
  if (rows.length === 0) {
    if (
      !printAsJson(
        { command: "search", keyword, limit, count: 0, skills: [] },
        jsonMode,
      )
    ) {
      console.log("No skills matched.");
    }
    return;
  }
  if (
    printAsJson(
      {
        command: "search",
        keyword,
        limit,
        count: rows.length,
        skills: rows.map(shortSkill),
      },
      jsonMode,
    )
  ) {
    return;
  }
  for (const skill of rows) {
    console.log(`${skill.name}  [${skill.id}]  stars:${skill.stars}`);
  }
}

async function runInstall(registry, args, mode = "install") {
  const jsonMode = Boolean(args.json);
  const selector = args._[1] || (args.all ? "--all" : "");
  if (!selector) {
    throw new Error(`${mode} requires <skill-id-or-name>`);
  }

  const tool = normalizeTool(args.tool || "cursor");
  if (!tool) throw new Error(`Unsupported tool: ${args.tool}`);
  const baseDir = args.dir ? path.resolve(args.dir) : defaultInstallBase(tool);

  const expanded = registry.allSkills.map((item) =>
    expandSkill(item, registry.repositories),
  );
  if (selector === "--all") {
    if (mode !== "update") throw new Error("--all is only valid for update");

    // Only update skills that are already installed locally
    const installedSkills = await findInstalledSkills(baseDir, expanded);
    if (installedSkills.length === 0) {
      if (jsonMode) {
        printAsJson(
          { command: mode, selector, tool, baseDir, count: 0, results: [] },
          true,
        );
      } else {
        console.log("No installed skills found.");
      }
      return;
    }
    if (!jsonMode) {
      console.log(
        `Found ${installedSkills.length} installed skill(s). Checking for updates...`,
      );
    }

    const results = [];
    for (const skill of installedSkills) {
      const result = await installOrUpdate({
        skill,
        tool,
        baseDir,
        checkOnly: Boolean(args.check),
        jsonMode,
      });
      results.push(result);
    }
    if (jsonMode) {
      printAsJson(
        {
          command: mode,
          selector,
          tool,
          baseDir,
          count: results.length,
          results,
        },
        true,
      );
    }
    return;
  }

  const match = getSkillMatches(expanded, selector);
  let skill = match.selected;
  if (!skill && match.matches.length > 1) {
    if (args.yes) {
      skill = match.matches[0];
    } else {
      skill = await chooseSkillInteractively(selector, match.matches, jsonMode);
    }
  }
  if (!skill) throw new Error(`Skill not found: ${selector}`);

  const result = await installOrUpdate({
    skill,
    tool,
    baseDir,
    checkOnly: Boolean(args.check),
    jsonMode,
  });
  printAsJson(
    {
      command: mode,
      selector,
      tool,
      baseDir,
      result,
    },
    jsonMode,
  );
}

export async function run(argv) {
  const args = parseArgs(argv);
  const command = args._[0];

  if (!command || args.help) {
    printHelp();
    return;
  }

  const registryUrl = String(args.registry || DEFAULT_REGISTRY_URL);
  const registry = await loadRegistry(registryUrl);

  if (command === "list") {
    await runList(registry, args);
    return;
  }
  if (command === "search") {
    await runSearch(registry, args);
    return;
  }
  if (command === "install") {
    await runInstall(registry, args, "install");
    return;
  }
  if (command === "update") {
    await runInstall(registry, args, "update");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
