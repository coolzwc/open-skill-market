import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CompactSkill = {
  id: string;
  name: string;
  description: string;
  categories: string[];
  author: string;
  repo: string;
  path: string;
  commitHash?: string;
  version?: string;
  tags?: string[];
  compatibility?: {
    agents?: string[];
    minAgentVersion?: string;
  };
  files?: string[];
};

export type RepoInfo = {
  url: string;
  branch?: string;
  stars?: number;
  forks?: number;
  lastUpdated?: string | null;
};

export type MarketFile = {
  meta: {
    generatedAt: string;
    totalSkills: number;
    chunks?: string[];
  };
  repositories: Record<string, RepoInfo>;
  skills: CompactSkill[];
};

export type ExpandedSkill = CompactSkill & {
  detailsUrl: string;
  repoUrl: string;
  skillZipUrl: string;
  branch: string;
  stars: number;
  forks: number;
  lastUpdated: string | null;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../public/data");
const pageSize = 24;

let cache: {
  loadedAt: number;
  main: MarketFile;
  allSkills: CompactSkill[];
} | null = null;

function displayBranch(repo: RepoInfo): string {
  return repo.branch || "main";
}

function buildDetailsUrl(
  repoId: string,
  repo: RepoInfo,
  skillPath: string,
): string {
  const [owner, repository] = repoId.split("/");
  return `https://github.com/${owner}/${repository}/blob/${displayBranch(repo)}/${skillPath}/SKILL.md`;
}

export const CDN_BASE_URL = "https://cdn.skillmarket.cc";

const ZIP_BASE_URL = `${CDN_BASE_URL}/zips`;

function buildSkillZipUrl(repoId: string, skillName: string): string {
  const [owner, repository] = repoId.split("/");
  return `${ZIP_BASE_URL}/${owner}-${repository}-${skillName}.zip`;
}

function expandSkill(
  skill: CompactSkill,
  repositories: Record<string, RepoInfo>,
): ExpandedSkill {
  const repo = repositories[skill.repo] || {
    url: `https://github.com/${skill.repo}`,
  };
  return {
    ...skill,
    repoUrl: repo.url || `https://github.com/${skill.repo}`,
    branch: displayBranch(repo),
    detailsUrl: buildDetailsUrl(skill.repo, repo, skill.path),
    skillZipUrl: buildSkillZipUrl(skill.repo, skill.name),
    stars: repo.stars || 0,
    forks: repo.forks || 0,
    lastUpdated: repo.lastUpdated || null,
  };
}

async function readJsonFile<T>(filename: string): Promise<T> {
  const target = path.join(dataDir, filename);
  const content = await fs.readFile(target, "utf-8");
  return JSON.parse(content) as T;
}

export async function loadMainMarketData(): Promise<MarketFile> {
  const main = await readJsonFile<MarketFile>("skills.json");
  return main;
}

/**
 * Return the top N skills sorted by stars (descending) along with
 * only the repository entries those skills reference.
 * Used at build time to embed a small static payload in the HTML.
 */
export function getTopStaticSkills(
  market: MarketFile,
  count = 100,
): { skills: CompactSkill[]; repositories: Record<string, RepoInfo> } {
  const sorted = [...market.skills].sort((a, b) => {
    const starsA = market.repositories[a.repo]?.stars || 0;
    const starsB = market.repositories[b.repo]?.stars || 0;
    return starsB - starsA || a.name.localeCompare(b.name);
  });
  const top = sorted.slice(0, count);
  const repos: Record<string, RepoInfo> = {};
  for (const s of top) {
    if (market.repositories[s.repo]) {
      repos[s.repo] = market.repositories[s.repo];
    }
  }
  return { skills: top, repositories: repos };
}

export async function loadAllSkills(): Promise<{
  main: MarketFile;
  allSkills: CompactSkill[];
}> {
  if (cache && Date.now() - cache.loadedAt < 5 * 60_000) {
    return { main: cache.main, allSkills: cache.allSkills };
  }

  const main = await loadMainMarketData();
  const allSkills = [...main.skills];
  const chunks = main.meta.chunks || [];
  for (const chunkFile of chunks) {
    const chunk = await readJsonFile<MarketFile>(chunkFile);
    allSkills.push(...chunk.skills);
  }

  cache = {
    loadedAt: Date.now(),
    main,
    allSkills,
  };
  return { main, allSkills };
}

export function sortSkills(skills: ExpandedSkill[]): ExpandedSkill[] {
  return [...skills].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    return a.name.localeCompare(b.name);
  });
}

export async function getExpandedSkills(): Promise<ExpandedSkill[]> {
  const { main, allSkills } = await loadAllSkills();
  return allSkills.map((skill) => expandSkill(skill, main.repositories));
}

export async function getSkillById(
  skillId: string,
): Promise<ExpandedSkill | null> {
  const { main, allSkills } = await loadAllSkills();
  const hit = allSkills.find((item) => item.id === skillId);
  if (!hit) return null;
  return expandSkill(hit, main.repositories);
}

export async function getCategoryList(): Promise<string[]> {
  const skills = await getExpandedSkills();
  const categories = new Set<string>();
  for (const skill of skills) {
    for (const category of skill.categories || []) {
      categories.add(category);
    }
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b));
}

export function buildPage(totalItems: number, currentPage: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return { totalPages, safePage, start, end, pageSize };
}

export { pageSize };
