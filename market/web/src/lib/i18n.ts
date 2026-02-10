export type Lang = "en" | "zh";

type Messages = {
  siteName: string;
  siteDescription: string;
  navHome: string;
  heroTitle: string;
  heroSubtitle: string;
  searchPlaceholder: string;
  categoryLabel: string;
  noResults: string;
  loadMore: string;
  loading: string;
  installTitle: string;
  installWithNpx: string;
  sourceRepo: string;
  stars: string;
  forks: string;
  language: string;
  backToMarket: string;
  updatedAt: string;
  allCategories: string;
  tabCursor: string;
  tabClaude: string;
  tabCodex: string;
  tabCopilot: string;
  installHintCursor: string;
  installHintClaude: string;
  installHintCodex: string;
  installHintCopilot: string;
  viewSkillMd: string;
  commit: string;
  files: string;
  compatibility: string;
  tags: string;
  lastUpdated: string;
  copyCommand: string;
  copied: string;
  quickInstall: string;
  navGuide: string;
  cliGetStarted: string;
  cliGetStartedDesc: string;
  viewFullGuide: string;
  guideTitle: string;
  guideDesc: string;
  guideIntro: string;
  guideRequirements: string;
  guideRequirementsDesc: string;
  guideCommands: string;
  guideCmdList: string;
  guideCmdListDesc: string;
  guideCmdSearch: string;
  guideCmdSearchDesc: string;
  guideCmdInstall: string;
  guideCmdInstallDesc: string;
  guideCmdUpdate: string;
  guideCmdUpdateDesc: string;
  guideFlags: string;
  guideFlagTool: string;
  guideFlagToolDesc: string;
  guideFlagDir: string;
  guideFlagDirDesc: string;
  guideFlagCheck: string;
  guideFlagCheckDesc: string;
  guideFlagJson: string;
  guideFlagJsonDesc: string;
  guideFlagLimit: string;
  guideFlagLimitDesc: string;
  guideFlagYes: string;
  guideFlagYesDesc: string;
  guideFlagAll: string;
  guideFlagAllDesc: string;
  guideExamples: string;
  guideExampleComment1: string;
  guideExampleComment2: string;
  guideExampleComment3: string;
  guideExampleComment4: string;
  guideExampleComment5: string;
  guideExampleComment6: string;
  guideToolPaths: string;
  guideToolPathsDesc: string;
  downloadZip: string;
};

export const MESSAGES: Record<Lang, Messages> = {
  en: {
    siteName: "Open Skill Market",
    siteDescription:
      "Discover and install AI agent skills for Cursor, Claude Code, Codex CLI, and GitHub Copilot.",
    navHome: "Market",
    heroTitle: "Open Skill Market",
    heroSubtitle:
      "Discover, install, and manage AI agent skills for every major coding assistant -- all in one place.",
    searchPlaceholder: "Search by skill name, description, author, tag...",
    categoryLabel: "Category",
    noResults: "No skills found.",
    loadMore: "Load more",
    loading: "Loading...",
    installTitle: "Install",
    installWithNpx: "Install with npx",
    sourceRepo: "Repository",
    stars: "Stars",
    forks: "Forks",
    language: "Language",
    backToMarket: "Back to market",
    updatedAt: "Updated at",
    allCategories: "All categories",
    tabCursor: "Cursor",
    tabClaude: "Claude Code",
    tabCodex: "Codex CLI",
    tabCopilot: "Copilot",
    installHintCursor: "Installs to ~/.cursor/skills/",
    installHintClaude: "Installs to ~/.claude/skills/",
    installHintCodex: "Installs to ~/.codex/skills/",
    installHintCopilot: "Installs to ~/.config/github-copilot/skills/",
    viewSkillMd: "View SKILL.md",
    commit: "Commit",
    files: "Files",
    compatibility: "Compatible with",
    tags: "Tags",
    lastUpdated: "Last updated",
    copyCommand: "Copy",
    copied: "Copied!",
    quickInstall: "Quick Install",
    navGuide: "Guide",
    cliGetStarted: "Get Started with CLI",
    cliGetStartedDesc:
      "Install any skill to your favourite AI tool with a single command.",
    viewFullGuide: "View full guide",
    guideTitle: "CLI Guide",
    guideDesc: "Complete reference for the skill-market command-line tool.",
    guideIntro:
      "skill-market is a zero-install CLI tool powered by npx. It lets you search, install, and update AI agent skills for Cursor, Claude Code, Codex CLI, and GitHub Copilot directly from your terminal.",
    guideRequirements: "Requirements",
    guideRequirementsDesc: "Node.js 18+ (npx is included with npm).",
    guideCommands: "Commands",
    guideCmdList: "List skills",
    guideCmdListDesc:
      "Browse all available skills, optionally filtered by tool.",
    guideCmdSearch: "Search skills",
    guideCmdSearchDesc:
      "Find skills by keyword across names, descriptions, and tags.",
    guideCmdInstall: "Install a skill",
    guideCmdInstallDesc:
      "Download and install a skill to the target tool's skill directory.",
    guideCmdUpdate: "Update skills",
    guideCmdUpdateDesc:
      "Check for and apply updates. Supports single skill or --all.",
    guideFlags: "Flags",
    guideFlagTool: "--tool <name>",
    guideFlagToolDesc:
      "Target tool: cursor, claude, codex, or copilot. Default: cursor.",
    guideFlagDir: "--dir <path>",
    guideFlagDirDesc: "Override the install directory.",
    guideFlagCheck: "--check",
    guideFlagCheckDesc: "Dry-run: check update status without writing files.",
    guideFlagJson: "--json",
    guideFlagJsonDesc: "Output structured JSON for scripting and automation.",
    guideFlagLimit: "--limit <n>",
    guideFlagLimitDesc: "Limit the number of results for list and search.",
    guideFlagYes: "--yes",
    guideFlagYesDesc:
      "Auto-select the first match when multiple skills are found.",
    guideFlagAll: "--all",
    guideFlagAllDesc:
      "Update all installed skills at once (update command only).",
    guideExamples: "Examples",
    guideExampleComment1: "# List top 20 skills for Cursor",
    guideExampleComment2: "# Search for React-related skills",
    guideExampleComment3: "# Install a skill for Claude Code",
    guideExampleComment4: "# Check if an update is available",
    guideExampleComment5: "# Update all skills for Codex CLI",
    guideExampleComment6: "# Output JSON for automation",
    guideToolPaths: "Default Install Paths",
    guideToolPathsDesc:
      "Each tool has a default directory. You can override it with --dir.",
    downloadZip: "Download"
  },
  zh: {
    siteName: "Open Skill Market",
    siteDescription:
      "发现并安装适用于 Cursor、Claude Code、Codex CLI 与 GitHub Copilot 的 AI 技能。",
    navHome: "技能市场",
    heroTitle: "Open Skill Market",
    heroSubtitle: "一站式发现、安装和管理适用于主流 AI 编程助手的开源技能。",
    searchPlaceholder: "按技能名、描述、作者、标签搜索...",
    categoryLabel: "分类",
    noResults: "未找到匹配技能。",
    loadMore: "加载更多",
    loading: "加载中...",
    installTitle: "安装",
    installWithNpx: "使用 npx 安装",
    sourceRepo: "代码仓库",
    stars: "Star",
    forks: "Fork",
    language: "语言",
    backToMarket: "返回市场",
    updatedAt: "更新时间",
    allCategories: "全部分类",
    tabCursor: "Cursor",
    tabClaude: "Claude Code",
    tabCodex: "Codex CLI",
    tabCopilot: "Copilot",
    installHintCursor: "安装到 ~/.cursor/skills/",
    installHintClaude: "安装到 ~/.claude/skills/",
    installHintCodex: "安装到 ~/.codex/skills/",
    installHintCopilot: "安装到 ~/.config/github-copilot/skills/",
    viewSkillMd: "查看 SKILL.md",
    commit: "提交",
    files: "文件",
    compatibility: "兼容工具",
    tags: "标签",
    lastUpdated: "最后更新",
    copyCommand: "复制",
    copied: "已复制!",
    quickInstall: "快速安装",
    navGuide: "使用指南",
    cliGetStarted: "CLI 快速上手",
    cliGetStartedDesc: "一行命令，即可将任意技能安装到你喜欢的 AI 工具中。",
    viewFullGuide: "查看完整指南",
    guideTitle: "CLI 使用指南",
    guideDesc: "skill-market 命令行工具完整参考文档。",
    guideIntro:
      "skill-market 是一个基于 npx 的零安装 CLI 工具。你可以直接在终端搜索、安装和更新适用于 Cursor、Claude Code、Codex CLI 和 GitHub Copilot 的 AI 技能。",
    guideRequirements: "环境要求",
    guideRequirementsDesc: "Node.js 18+（npm 自带 npx）。",
    guideCommands: "命令",
    guideCmdList: "列出技能",
    guideCmdListDesc: "浏览所有可用技能，可按工具筛选。",
    guideCmdSearch: "搜索技能",
    guideCmdSearchDesc: "通过关键词在名称、描述和标签中查找技能。",
    guideCmdInstall: "安装技能",
    guideCmdInstallDesc: "下载并安装技能到目标工具的技能目录。",
    guideCmdUpdate: "更新技能",
    guideCmdUpdateDesc: "检查并应用更新。支持单个技能或 --all 批量更新。",
    guideFlags: "参数",
    guideFlagTool: "--tool <名称>",
    guideFlagToolDesc:
      "目标工具：cursor、claude、codex 或 copilot。默认：cursor。",
    guideFlagDir: "--dir <路径>",
    guideFlagDirDesc: "覆盖默认安装目录。",
    guideFlagCheck: "--check",
    guideFlagCheckDesc: "仅检查更新状态，不写入文件。",
    guideFlagJson: "--json",
    guideFlagJsonDesc: "输出结构化 JSON，便于脚本和自动化。",
    guideFlagLimit: "--limit <n>",
    guideFlagLimitDesc: "限制 list 和 search 的返回结果数量。",
    guideFlagYes: "--yes",
    guideFlagYesDesc: "匹配到多个技能时自动选择第一个。",
    guideFlagAll: "--all",
    guideFlagAllDesc: "一次性更新所有已安装的技能（仅 update 命令）。",
    guideExamples: "示例",
    guideExampleComment1: "# 列出 Cursor 的前 20 个技能",
    guideExampleComment2: "# 搜索 React 相关技能",
    guideExampleComment3: "# 为 Claude Code 安装技能",
    guideExampleComment4: "# 检查是否有可用更新",
    guideExampleComment5: "# 批量更新 Codex CLI 的所有技能",
    guideExampleComment6: "# 以 JSON 格式输出结果",
    guideToolPaths: "默认安装路径",
    guideToolPathsDesc: "每个工具有默认目录，可通过 --dir 覆盖。",
    downloadZip: "下载"
  },
};

export function getLang(input: string | undefined): Lang {
  return input === "zh" ? "zh" : "en";
}
