import matter from "gray-matter";

/**
 * Category definitions with keywords for matching
 */
const CATEGORY_DEFINITIONS = {
  development: {
    keywords: [
      "code", "coding", "developer", "programming", "debug", "debugging",
      "git", "commit", "repository", "refactor", "test", "testing",
      "api", "sdk", "library", "framework", "typescript", "javascript",
      "python", "rust", "react", "vue", "node", "npm", "build", "compile",
      "lint", "format", "changelog", "version", "deploy", "ci/cd",
    ],
    label: "Development",
  },
  design: {
    keywords: [
      "design", "visual", "ui", "ux", "interface", "layout", "style",
      "color", "font", "typography", "brand", "logo", "icon", "image",
      "graphic", "canvas", "art", "creative", "aesthetic", "css",
      "tailwind", "figma", "sketch", "prototype", "wireframe",
    ],
    label: "Design",
  },
  writing: {
    keywords: [
      "write", "writing", "content", "blog", "article", "copy", "copywriting",
      "documentation", "docs", "readme", "text", "edit", "editing", "grammar",
      "proofread", "translate", "translation", "summary", "summarize",
    ],
    label: "Writing",
  },
  productivity: {
    keywords: [
      "productivity", "automation", "automate", "workflow", "task", "todo",
      "schedule", "calendar", "reminder", "organize", "manage", "project",
      "time", "efficiency", "template", "generate", "generator",
    ],
    label: "Productivity",
  },
  data: {
    keywords: [
      "data", "database", "sql", "csv", "json", "excel", "spreadsheet",
      "analysis", "analytics", "chart", "graph", "visualization", "report",
      "metrics", "statistics", "etl", "pipeline", "transform",
    ],
    label: "Data & Analytics",
  },
  documents: {
    keywords: [
      "document", "pdf", "docx", "word", "powerpoint", "ppt", "slide",
      "presentation", "spreadsheet", "excel", "file", "export", "import",
      "convert", "merge", "split", "form", "table",
    ],
    label: "Documents",
  },
  integration: {
    keywords: [
      "connect", "integration", "api", "webhook", "slack", "discord",
      "gmail", "email", "github", "notion", "jira", "trello", "zapier",
      "service", "external", "third-party", "oauth", "sync",
    ],
    label: "Integration",
  },
  marketing: {
    keywords: [
      "marketing", "seo", "ads", "advertising", "campaign", "social",
      "facebook", "twitter", "linkedin", "instagram", "analytics",
      "conversion", "funnel", "lead", "growth", "engagement", "audience",
    ],
    label: "Marketing",
  },
  research: {
    keywords: [
      "research", "search", "find", "discover", "explore", "investigate",
      "analyze", "study", "learn", "knowledge", "information", "source",
      "citation", "reference", "web", "scrape", "crawl",
    ],
    label: "Research",
  },
  ai: {
    keywords: [
      "ai", "machine learning", "ml", "llm", "gpt", "claude", "prompt",
      "embedding", "vector", "rag", "agent", "assistant", "chatbot",
      "natural language", "nlp", "model", "inference",
    ],
    label: "AI & ML",
  },
};

/**
 * Categorize a skill based on its description and name
 * @param {string} name
 * @param {string} description
 * @returns {string[]} Array of category labels
 */
export function categorizeSkill(name, description) {
  const categories = [];
  const textToAnalyze = `${name || ""} ${description || ""}`.toLowerCase();

  for (const [, categoryDef] of Object.entries(CATEGORY_DEFINITIONS)) {
    const matchCount = categoryDef.keywords.filter((keyword) =>
      textToAnalyze.includes(keyword.toLowerCase())
    ).length;

    if (matchCount >= 2) {
      categories.push(categoryDef.label);
    }
  }

  if (categories.length === 0) {
    categories.push("Other");
  }

  return categories;
}

/**
 * Validate skill quality based on content
 * @param {Object} parsed
 * @param {string} body
 * @returns {{ isValid: boolean, reason: string }}
 */
export function validateSkillQuality(parsed, body) {
  if (!parsed.name || parsed.name.length < 2) {
    return { isValid: false, reason: "Missing or invalid name in frontmatter" };
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(parsed.name)) {
    return { isValid: false, reason: "Name must be lowercase with hyphens" };
  }

  if (!parsed.description || parsed.description.length < 20) {
    return {
      isValid: false,
      reason: "Missing or too short description (min 20 chars)",
    };
  }

  const bodyLength = body ? body.replace(/\s+/g, " ").trim().length : 0;
  if (bodyLength < 500) {
    return {
      isValid: false,
      reason: `Body content is too short (min 500 chars), current length: ${bodyLength}`,
    };
  }

  return { isValid: true, reason: "" };
}

/**
 * Try to extract frontmatter manually when gray-matter fails
 * @param {string} content
 * @returns {Object}
 */
function extractFrontmatterManually(content) {
  const result = {
    name: null,
    description: null,
    version: null,
    tags: [],
    body: content,
  };

  // Check if content starts with frontmatter delimiter
  if (!content.startsWith("---")) {
    return result;
  }

  // Find the closing delimiter
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return result;
  }

  const frontmatterStr = content.substring(4, endIndex);
  result.body = content.substring(endIndex + 4).trim();

  // Parse each line manually
  const lines = frontmatterStr.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Match name: value pattern (handle values with colons)
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
    let value = trimmed.substring(colonIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case "name":
        result.name = value;
        break;
      case "description":
        result.description = value;
        break;
      case "version":
        result.version = value;
        break;
      case "tags":
        // Try to parse as array
        if (value.startsWith("[") && value.endsWith("]")) {
          try {
            result.tags = JSON.parse(value.replace(/'/g, '"'));
          } catch {
            result.tags = [];
          }
        }
        break;
    }
  }

  return result;
}

/**
 * Extract name and description from markdown content (no frontmatter)
 * @param {string} content
 * @returns {Object}
 */
function extractFromMarkdown(content) {
  const result = {
    name: null,
    description: null,
    version: null,
    tags: [],
    body: content,
  };

  const lines = content.split("\n");

  // Look for first H1 heading as name
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      let name = trimmed.substring(2).trim();
      // Clean up name - remove special characters, convert to lowercase with hyphens
      name = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (name.length >= 2) {
        result.name = name;
      }
      break;
    }
  }

  // Look for first paragraph as description
  let foundHeading = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      foundHeading = true;
      continue;
    }
    if (foundHeading && trimmed.length > 20 && !trimmed.startsWith("-") && !trimmed.startsWith("*")) {
      result.description = trimmed.substring(0, 500);
      break;
    }
  }

  return result;
}

/**
 * Parse SKILL.md content and extract metadata
 * @param {string} content
 * @returns {Object}
 */
export function parseSkillContent(content) {
  let frontmatter = {};
  let body = content;

  // Try gray-matter first
  try {
    const parsed = matter(content);
    frontmatter = parsed.data;
    body = parsed.content;
  } catch {
    // gray-matter failed, try manual extraction
    const manual = extractFrontmatterManually(content);
    if (manual.name || manual.description) {
      frontmatter = {
        name: manual.name,
        description: manual.description,
        version: manual.version,
        tags: manual.tags,
      };
      body = manual.body;
    } else {
      // No frontmatter, try extracting from markdown
      const extracted = extractFromMarkdown(content);
      frontmatter = {
        name: extracted.name,
        description: extracted.description,
        version: null,
        tags: [],
      };
      body = content;
    }
  }

  const name = frontmatter.name || null;
  const description = frontmatter.description || null;
  const version = frontmatter.version || null;
  const tags = frontmatter.tags || [];

  let extractedDescription = description;
  if (!extractedDescription && body) {
    const lines = body.split("\n").filter((line) => line.trim());
    for (const line of lines) {
      if (!line.startsWith("#") && line.trim().length > 20) {
        extractedDescription = line.trim().substring(0, 500);
        break;
      }
    }
  }

  const parsed = {
    name,
    description: extractedDescription,
    version,
    tags: Array.isArray(tags) ? tags : [],
  };

  const validation = validateSkillQuality(parsed, body);
  parsed.isValid = validation.isValid;
  parsed.invalidReason = validation.reason;

  return parsed;
}
