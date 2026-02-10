import matter from "gray-matter";

/**
 * Maximum description length for extracted descriptions
 */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Category definitions with keywords for matching
 */
const CATEGORY_DEFINITIONS = {
  development: {
    keywords: [
      "code", "coding", "developer", "programming", "debug", "debugging",
      "git", "commit", "repository", "refactor", "test", "testing",
      "api", "sdk", "library", "framework", "typescript", "javascript",
      "python", "rust", "java", "golang", "react", "vue", "angular",
      "svelte", "node", "npm", "build", "compile", "lint", "format",
      "changelog", "version", "monorepo", "component", "frontend",
      "backend", "fullstack", "full-stack", "architecture", "pattern",
      "best practice", "code review", "pull request",
      // zh
      "开发", "编码", "编程", "调试", "重构", "测试", "单元测试",
      "组件", "前端", "后端", "代码审查", "代码质量", "开发规范",
      "命名约定", "异常处理", "最佳实践",
      // ja
      "実装", "開発", "テスト", "コード",
    ],
    label: "Development",
  },
  devops: {
    keywords: [
      "deploy", "deployment", "ci/cd", "pipeline", "docker", "container",
      "kubernetes", "k8s", "helm", "terraform", "ansible", "infrastructure",
      "cloud", "aws", "gcp", "azure", "vercel", "netlify", "heroku",
      "monitoring", "observability", "prometheus", "grafana", "sre",
      "uptime", "incident", "postmortem", "rollback", "staging",
      "production", "server", "nginx", "dns", "ssl", "certificate",
      "load balancer", "scaling", "microservice",
      // zh
      "部署", "发布", "上线", "运维", "服务器", "容器", "集群",
      "监控", "告警", "测试环境", "生产环境",
      // ja
      "デプロイ", "サーバー", "認証",
    ],
    label: "DevOps",
  },
  security: {
    keywords: [
      "security", "secure", "vulnerability", "exploit", "threat",
      "malware", "ransomware", "phishing", "firewall", "encryption",
      "auth", "authentication", "authorization", "oauth", "jwt", "token",
      "audit", "compliance", "penetration", "pentest", "siem", "soc",
      "incident response", "forensic", "triage", "ioc", "hunt",
      "credential", "xss", "csrf", "injection", "secops",
      // zh
      "安全", "漏洞", "审计", "加密", "渗透", "威胁", "攻击",
      "防护", "风险", "权限",
    ],
    label: "Security",
  },
  design: {
    keywords: [
      "design", "visual", "ui", "ux", "interface", "layout", "style",
      "color", "font", "typography", "brand", "logo", "icon", "image",
      "graphic", "canvas", "art", "creative", "aesthetic", "css",
      "tailwind", "figma", "sketch", "prototype", "wireframe",
      "responsive", "theme", "animation", "illustration", "shadcn",
      // zh
      "设计", "界面", "交互", "用户体验", "视觉", "样式", "主题",
      "原型", "布局",
      // ja
      "デザイン",
    ],
    label: "Design",
  },
  writing: {
    keywords: [
      "write", "writing", "content", "blog", "article", "copy", "copywriting",
      "documentation", "docs", "readme", "text", "edit", "editing", "grammar",
      "proofread", "translate", "translation", "summary", "summarize",
      "publish", "author", "draft", "narrative", "storytelling",
      // zh
      "写作", "文章", "文档", "博客", "翻译", "总结", "归纳",
      "周报", "日报", "摘要", "内容创作", "文案", "邮件写作",
      // ja
      "記事", "ブログ", "文書",
    ],
    label: "Writing",
  },
  productivity: {
    keywords: [
      "productivity", "automation", "automate", "workflow", "task", "todo",
      "schedule", "calendar", "reminder", "organize", "manage", "project",
      "time", "efficiency", "template", "generate", "generator",
      "shortcut", "snippet", "boilerplate", "scaffold", "cli tool",
      "dotfile", "configuration", "setup",
      // zh
      "效率", "自动化", "工作流", "任务", "日程", "提醒",
      "模板", "生成", "配置", "脚手架",
      // ja
      "ワークフロー", "タスク", "自動",
    ],
    label: "Productivity",
  },
  data: {
    keywords: [
      "data", "database", "sql", "csv", "json", "excel", "spreadsheet",
      "analysis", "analytics", "chart", "graph", "visualization", "report",
      "metrics", "statistics", "etl", "pipeline", "transform",
      "postgres", "mysql", "mongodb", "redis", "sqlite", "prisma",
      "drizzle", "query", "schema", "migration",
      // zh
      "数据", "数据库", "报表", "统计", "分析", "可视化", "图表",
      "查询", "迁移",
      // ja
      "データ", "分析",
    ],
    label: "Data & Analytics",
  },
  documents: {
    keywords: [
      "document", "pdf", "docx", "word", "powerpoint", "ppt", "slide",
      "presentation", "spreadsheet", "excel", "file", "export", "import",
      "convert", "merge", "split", "form", "table", "xlsx", "pptx",
      "markdown", "latex", "epub", "archive", "zip", "compress",
      // zh
      "文档", "文件", "表格", "演示", "幻灯片", "导出", "导入",
      "转换", "压缩", "解压",
    ],
    label: "Documents",
  },
  integration: {
    keywords: [
      "connect", "integration", "webhook", "slack", "discord",
      "gmail", "email", "github", "notion", "jira", "trello", "zapier",
      "service", "external", "third-party", "sync", "mcp",
      "telegram", "whatsapp", "twilio", "stripe", "supabase",
      "shopify", "salesforce", "zendesk", "freshdesk",
      // zh
      "集成", "对接", "接入", "同步", "第三方", "微信", "公众号",
      "小红书", "钉钉", "飞书",
    ],
    label: "Integration",
  },
  marketing: {
    keywords: [
      "marketing", "seo", "ads", "advertising", "campaign", "social media",
      "facebook", "twitter", "linkedin", "instagram", "bluesky",
      "conversion", "funnel", "lead", "growth", "engagement", "audience",
      "outreach", "newsletter", "branding", "influencer",
      // zh
      "营销", "推广", "获客", "用户增长", "社交媒体", "广告",
    ],
    label: "Marketing",
  },
  business: {
    keywords: [
      "strategy", "roadmap", "okr", "kpi", "stakeholder", "leadership",
      "hiring", "onboarding", "interview", "candidate", "management",
      "product manager", "prd", "sprint", "agile", "scrum", "backlog",
      "prioritiz", "decision", "negotiat", "delegation", "meeting",
      "retrospective", "pitch", "startup", "founder", "enterprise",
      "pricing", "revenue", "budget", "fundrais",
      // zh
      "产品", "需求", "规划", "用户故事", "路线图", "管理",
      "决策", "团队", "招聘", "面试", "创业", "融资",
      "产品设计", "需求分析", "产品经理",
    ],
    label: "Business",
  },
  research: {
    keywords: [
      "research", "search", "find", "discover", "explore", "investigate",
      "analyze", "study", "learn", "knowledge", "information", "source",
      "citation", "reference", "web", "scrape", "crawl",
      "survey", "benchmark", "comparison", "evaluate",
      // zh
      "研究", "搜索", "调研", "分析", "探索", "评估",
    ],
    label: "Research",
  },
  finance: {
    keywords: [
      "finance", "financial", "trading", "investment", "stock", "crypto",
      "bitcoin", "ethereum", "portfolio", "market", "price", "exchange",
      "wallet", "defi", "blockchain", "token", "payment", "checkout",
      "invoice", "accounting", "tax", "revenue", "profit",
      // zh
      "金融", "交易", "投资", "股票", "基金", "理财", "支付",
      "账单", "财务", "记账", "A股", "港股",
    ],
    label: "Finance",
  },
  ai: {
    keywords: [
      "ai", "machine learning", "ml", "llm", "gpt", "claude", "gemini",
      "openai", "prompt", "embedding", "vector", "rag", "agent",
      "assistant", "chatbot", "natural language", "nlp", "model",
      "inference", "fine-tun", "training", "neural", "diffusion",
      "copilot", "deepseek", "multi-agent", "agentic",
      // zh
      "人工智能", "大模型", "智能体", "提示词", "对话",
    ],
    label: "AI & ML",
  },
  media: {
    keywords: [
      "video", "audio", "music", "sound", "speech", "voice", "transcri",
      "podcast", "stream", "recording", "camera", "photo", "ffmpeg",
      "youtube", "tiktok", "subtitle", "caption", "render", "3d",
      "game", "webgl", "three.js", "animation",
      // zh
      "视频", "音频", "音乐", "语音", "录音", "字幕", "剪辑",
      "特效", "渲染",
      // ja
      "動画", "音声",
    ],
    label: "Media",
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
      result.description = trimmed.substring(0, MAX_DESCRIPTION_LENGTH);
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
        extractedDescription = line.trim().substring(0, MAX_DESCRIPTION_LENGTH);
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
