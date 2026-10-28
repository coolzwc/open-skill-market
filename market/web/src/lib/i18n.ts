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
  tabOpenclaw: string;
  tabGemini: string;
  installHintCursor: string;
  installHintClaude: string;
  installHintCodex: string;
  installHintCopilot: string;
  installHintOpenclaw: string;
  installHintGemini: string;
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
  guideCmdScan: string;
  guideCmdScanDesc: string;
  guideCmdRemove: string;
  guideCmdRemoveDesc: string;
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
  guideFlagForce: string;
  guideFlagForceDesc: string;
  guideFlagInstalled: string;
  guideFlagInstalledDesc: string;
  guideExamples: string;
  guideExampleComment1: string;
  guideExampleComment2: string;
  guideExampleComment3: string;
  guideExampleComment4: string;
  guideExampleComment5: string;
  guideExampleComment6: string;
  guideExampleComment7: string;
  guideExampleComment8: string;
  guideExampleComment9: string;
  guideSecurity: string;
  guideSecurityDesc: string;
  guideToolPaths: string;
  guideToolPathsDesc: string;
  downloadZip: string;
  securityTitle: string;
  securityScoreLabel: string;
  riskLevelLabel: string;
  scanTagsLabel: string;
  scannedAtLabel: string;
  securityNotScanned: string;
  riskLow: string;
  riskMedium: string;
  riskHigh: string;
  riskCritical: string;
  qualityTitle: string;
  qualityScoreLabel: string;
  qualityGradeLabel: string;
  qualityExcellent: string;
  qualityGood: string;
  qualityAverage: string;
  qualityFair: string;
  adLabel: string;
  navAbout: string;
  navContact: string;
  aboutTitle: string;
  aboutDesc: string;
  aboutIntro: string;
  aboutMission: string;
  aboutMissionDesc: string;
  aboutWhatWeDo: string;
  aboutWhatWeDoDesc: string;
  aboutCardDiscover: string;
  aboutCardDiscoverDesc: string;
  aboutCardInstall: string;
  aboutCardInstallDesc: string;
  aboutCardScan: string;
  aboutCardScanDesc: string;
  aboutCardUniversal: string;
  aboutCardUniversalDesc: string;
  aboutHowItWorks: string;
  aboutHowItWorksDesc: string;
  aboutOpenSource: string;
  aboutOpenSourceDesc: string;
  aboutOpenSourceCta: string;
  contactTitle: string;
  contactDesc: string;
  contactIntro: string;
  contactEmail: string;
  contactEmailDesc: string;
  contactGithub: string;
  contactGithubDesc: string;
  contactIssues: string;
  contactIssuesDesc: string;
  contactResponse: string;
  contactResponseDesc: string;
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
    tabOpenclaw: "OpenClaw",
    tabGemini: "Gemini CLI",
    installHintCursor: "Installs to ~/.cursor/skills/",
    installHintClaude: "Installs to ~/.claude/skills/",
    installHintCodex: "Installs to ~/.codex/skills/",
    installHintCopilot: "Installs to ~/.config/github-copilot/skills/",
    installHintOpenclaw: "Installs to ~/.openclaw/skills/",
    installHintGemini: "Installs to ~/.gemini/skills/",
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
    guideCmdScan: "Scan skills",
    guideCmdScanDesc:
      "Check security and quality of skills without installing.",
    guideCmdRemove: "Remove a skill",
    guideCmdRemoveDesc: "Uninstall a skill from the target tool.",
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
    guideFlagForce: "--force",
    guideFlagForceDesc:
      "Skip security prompts and proceed with installation.",
    guideFlagInstalled: "--installed",
    guideFlagInstalledDesc:
      "For scan: check already-installed skills instead of registry.",
    guideExamples: "Examples",
    guideExampleComment1: "# List top 20 skills for Cursor",
    guideExampleComment2: "# Search for React-related skills",
    guideExampleComment3: "# Install a skill for Claude Code",
    guideExampleComment4: "# Check if an update is available",
    guideExampleComment5: "# Update all skills for Codex CLI",
    guideExampleComment6: "# Output JSON for automation",
    guideExampleComment7: "# Scan installed skills for security issues",
    guideExampleComment8: "# Remove a skill safely",
    guideExampleComment9: "# Scan with security details (JSON)",
    guideSecurity: "Security & Quality Checks",
    guideSecurityDesc:
      "During installation, the CLI automatically scans skills for security risks (dangerous code, credential access) and quality metrics (documentation, structure). Use --force to skip prompts.",
    guideToolPaths: "Tool Paths",
    guideToolPathsDesc:
      "Each tool has a default directory. You can override it with --dir.",
    downloadZip: "Download",
    securityTitle: "Security",
    securityScoreLabel: "Security score",
    riskLevelLabel: "Risk level",
    scanTagsLabel: "Scan tags",
    scannedAtLabel: "Last scanned",
    securityNotScanned: "Not scanned yet",
    riskLow: "Low",
    riskMedium: "Medium",
    riskHigh: "High",
    riskCritical: "Critical",
    qualityTitle: "Quality",
    qualityScoreLabel: "Quality score",
    qualityGradeLabel: "Quality grade",
    qualityExcellent: "Excellent",
    qualityGood: "Good",
    qualityAverage: "Average",
    qualityFair: "Fair",
    adLabel: "Advertisement",
    navAbout: "About",
    navContact: "Contact",
    aboutTitle: "About Us",
    aboutDesc:
      "Learn about Open Skill Market — an open, community-driven registry of AI agent skills.",
    aboutIntro:
      "Open Skill Market is an open, community-driven registry of AI agent skills. We index SKILL.md packages published across GitHub and make them easy to discover, install, and manage for every major AI coding assistant.",
    aboutMission: "Our Mission",
    aboutMissionDesc:
      "Skill definitions are scattered across thousands of repositories and locked into individual tools. We believe a good skill should be written once and work everywhere — so we built one open index that any tool can read from.",
    aboutWhatWeDo: "What We Do",
    aboutWhatWeDoDesc:
      "We continuously crawl public repositories for SKILL.md files, validate and categorise each skill, then publish a single open registry.",
    aboutCardDiscover: "Discover",
    aboutCardDiscoverDesc:
      "Search thousands of skills by name, description, author, or tag.",
    aboutCardInstall: "Install",
    aboutCardInstallDesc:
      "Install any skill with a single npx command — no global setup required.",
    aboutCardScan: "Scan",
    aboutCardScanDesc:
      "Every skill is checked for security risks and documentation quality.",
    aboutCardUniversal: "Universal",
    aboutCardUniversalDesc:
      "One registry for Cursor, Claude Code, Codex CLI, GitHub Copilot, and more.",
    aboutHowItWorks: "How It Works",
    aboutHowItWorksDesc:
      "A scheduled crawler scans public GitHub repositories for SKILL.md files, parses each manifest, and stores the results in an open JSON registry. The website and the CLI both read from that same registry, so what you see here is always in sync with what you can install.",
    aboutOpenSource: "Open Source",
    aboutOpenSourceDesc:
      "Open Skill Market is MIT licensed and built in the open. New skills, contributions, and bug reports are all welcome.",
    aboutOpenSourceCta: "Star us on GitHub",
    contactTitle: "Contact Us",
    contactDesc: "Get in touch with the Open Skill Market team.",
    contactIntro:
      "Questions, feedback, a skill you would like removed, or an idea for a new feature? We would love to hear from you.",
    contactEmail: "Email",
    contactEmailDesc: "The fastest way to reach us — we read every message.",
    contactGithub: "GitHub",
    contactGithubDesc:
      "Open an issue for bugs, skill submissions, or feature requests.",
    contactIssues: "Report an issue",
    contactIssuesDesc:
      "Found a broken skill, a security concern, or incorrect metadata? Open an issue and we will take a look.",
    contactResponse: "Response Time",
    contactResponseDesc:
      "We usually reply within a few business days. For security reports, please say so in the subject so we can prioritise them.",
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
    tabOpenclaw: "OpenClaw",
    tabGemini: "Gemini CLI",
    installHintCursor: "安装到 ~/.cursor/skills/",
    installHintClaude: "安装到 ~/.claude/skills/",
    installHintCodex: "安装到 ~/.codex/skills/",
    installHintCopilot: "安装到 ~/.config/github-copilot/skills/",
    installHintOpenclaw: "安装到 ~/.openclaw/skills/",
    installHintGemini: "安装到 ~/.gemini/skills/",
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
    guideCmdScan: "扫描技能",
    guideCmdScanDesc: "检查技能的安全性和质量，无需安装。",
    guideCmdRemove: "移除技能",
    guideCmdRemoveDesc: "从目标工具中卸载技能。",
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
    guideFlagForce: "--force",
    guideFlagForceDesc: "跳过安全检查提示，直接进行安装。",
    guideFlagInstalled: "--installed",
    guideFlagInstalledDesc: "对于 scan 命令：检查已安装的技能而非仓库。",
    guideExamples: "示例",
    guideExampleComment1: "# 列出 Cursor 的前 20 个技能",
    guideExampleComment2: "# 搜索 React 相关技能",
    guideExampleComment3: "# 为 Claude Code 安装技能",
    guideExampleComment4: "# 检查是否有可用更新",
    guideExampleComment5: "# 批量更新 Codex CLI 的所有技能",
    guideExampleComment6: "# 以 JSON 格式输出结果",
    guideExampleComment7: "# 扫描已安装技能的安全问题",
    guideExampleComment8: "# 安全移除技能",
    guideExampleComment9: "# 以 JSON 格式输出扫描的安全详情",
    guideSecurity: "安全与质量检测",
    guideSecurityDesc:
      "安装过程中，CLI 会自动扫描技能的安全风险（危险代码、凭证访问）和质量指标（文档、结构）。使用 --force 可跳过提示。",
    guideToolPaths: "工具路径",
    guideToolPathsDesc: "每个工具有默认目录，可通过 --dir 覆盖。",
    downloadZip: "下载",
    securityTitle: "安全信息",
    securityScoreLabel: "安全评分",
    riskLevelLabel: "风险等级",
    scanTagsLabel: "扫描标签",
    scannedAtLabel: "最近扫描",
    securityNotScanned: "尚未扫描",
    riskLow: "低",
    riskMedium: "中",
    riskHigh: "高",
    riskCritical: "高（严重）",
    qualityTitle: "质量",
    qualityScoreLabel: "质量评分",
    qualityGradeLabel: "质量等级",
    qualityExcellent: "优秀",
    qualityGood: "良好",
    qualityAverage: "一般",
    qualityFair: "差",
    adLabel: "广告",
    navAbout: "关于我们",
    navContact: "联系我们",
    aboutTitle: "关于我们",
    aboutDesc: "了解 Open Skill Market —— 一个开放、社区驱动的 AI 技能注册表。",
    aboutIntro:
      "Open Skill Market 是一个开放、社区驱动的 AI 技能注册表。我们收录散落在 GitHub 上的 SKILL.md 技能包，让你能轻松地发现、安装和管理适用于主流 AI 编程助手的技能。",
    aboutMission: "我们的使命",
    aboutMissionDesc:
      "技能定义分散在成千上万个仓库里，并被各个工具锁定。我们相信，一个好的技能应该「编写一次，处处可用」——因此我们构建了一个任何工具都能读取的开放索引。",
    aboutWhatWeDo: "我们做什么",
    aboutWhatWeDoDesc:
      "我们持续爬取公开仓库中的 SKILL.md 文件，对每项技能进行校验与分类，并发布为统一的开放注册表。",
    aboutCardDiscover: "发现",
    aboutCardDiscoverDesc: "按名称、描述、作者或标签搜索数千个技能。",
    aboutCardInstall: "安装",
    aboutCardInstallDesc: "一条 npx 命令即可安装任意技能，无需全局配置。",
    aboutCardScan: "扫描",
    aboutCardScanDesc: "每项技能都会经过安全风险与文档质量检查。",
    aboutCardUniversal: "通用",
    aboutCardUniversalDesc:
      "一个注册表同时支持 Cursor、Claude Code、Codex CLI、GitHub Copilot 等。",
    aboutHowItWorks: "运作方式",
    aboutHowItWorksDesc:
      "定时任务会扫描公开 GitHub 仓库中的 SKILL.md 文件，解析每份清单，并将结果存入开放的 JSON 注册表。网站与 CLI 都读取同一份注册表，因此你在这里看到的内容始终与可安装的内容保持同步。",
    aboutOpenSource: "开源",
    aboutOpenSourceDesc:
      "Open Skill Market 采用 MIT 许可，完全开源共建。欢迎提交技能、贡献代码或反馈问题。",
    aboutOpenSourceCta: "在 GitHub 上为我们点星",
    contactTitle: "联系我们",
    contactDesc: "与 Open Skill Market 团队取得联系。",
    contactIntro:
      "有问题、建议、希望下架某个技能，或有新功能的想法？欢迎随时与我们联系。",
    contactEmail: "邮箱",
    contactEmailDesc: "联系我们最快的方式，每一封邮件我们都会阅读。",
    contactGithub: "GitHub",
    contactGithubDesc: "提交 issue 反馈缺陷、推荐技能或提出功能需求。",
    contactIssues: "提交问题",
    contactIssuesDesc:
      "发现失效的技能、安全隐患或元数据错误？提交 issue，我们会及时处理。",
    contactResponse: "响应时间",
    contactResponseDesc:
      "我们通常在几个工作日内回复。若为安全问题，请在标题中注明，以便我们优先处理。",
  },
};

export function getLang(input: string | undefined): Lang {
  return input === "zh" ? "zh" : "en";
}
