# Open Skill Market

**[skillmarket.cc](https://skillmarket.cc)** — Discover, install, and manage AI agent skills for every major coding assistant.

[![Website](https://img.shields.io/badge/Website-skillmarket.cc-blue?style=flat-square)](https://skillmarket.cc)
[![npm](https://img.shields.io/npm/v/skill-market?style=flat-square&label=npx%20skill-market)](https://www.npmjs.com/package/skill-market)

---

An open marketplace for AI agent skills. This project collects skills from two sources:

1. **PR Submissions**: Users can submit skills directly to this repository via Pull Request
2. **GitHub Crawler**: Automatically discovers `SKILL.md` files across public GitHub repositories

All skills are indexed in a central `skills.json` registry.

## What are Skills?

Skills are markdown files (`SKILL.md`) that teach AI agents how to perform specific tasks. They include:

- **Name**: Unique identifier for the skill
- **Description**: What the skill does and when to use it
- **Instructions**: Step-by-step guidance for the agent
- **Examples**: Concrete usage examples

Skills can be stored individually in repositories or as collections in a single repository.

## Project Structure

```
open-skill-market/
├── skills/                   # PR-submitted skills (local)
│   ├── .example/             # Example skill template
│   │   └── SKILL.md
│   └── your-skill/           # Your skill here!
│       └── SKILL.md
├── crawler/
│   ├── index.js              # Main entry point and orchestrator
│   ├── config.js             # Configuration and constants
│   ├── worker-pool.js        # Multi-token GitHub client pool
│   ├── rate-limit.js         # Rate limit and timeout handling
│   ├── github-api.js         # GitHub API interactions
│   ├── skill-parser.js       # SKILL.md parsing and categorization
│   ├── local-scanner.js      # Local skills directory scanner
│   ├── cache.js              # Two-level caching (repo + skill directory)
│   ├── zip-generator.js      # Skill zip package generator
│   ├── utils.js              # Utility functions
│   └── repositories.yml      # Priority repositories config
├── market/
│   ├── skills.json           # Generated skills registry
│   ├── skills-*.json         # Optional chunk files for progressive loading
│   └── zips/                 # Generated skill zip packages
│   ├── web/                  # Astro + Cloudflare website (independent project)
│   └── cli/                  # npx installer CLI (independent project)
├── .github/
│   └── workflows/
│       └── crawl.yml         # Scheduled GitHub Action
├── package.json
└── README.md
```

### Crawler Modules

| Module             | Description                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `index.js`         | Main orchestrator: initializes worker pool, runs 3-phase crawl, deduplicates, and saves output         |
| `config.js`        | Centralized configuration (search topics, paths, rate limits, timeouts)                                |
| `worker-pool.js`   | Manages multiple GitHub tokens and Octokit clients for parallel processing                             |
| `rate-limit.js`    | Handles GitHub API rate limits and execution timeouts                                                  |
| `github-api.js`    | All GitHub API calls (search, fetch content, get repo details)                                         |
| `skill-parser.js`  | Parses SKILL.md frontmatter, validates quality, assigns categories                                     |
| `local-scanner.js` | Scans local `skills/` directory for PR-submitted skills                                                |
| `cache.js`         | Two-level caching: repo-level (skip unchanged repos) and skill-directory-level (skip unchanged skills) |
| `zip-generator.js` | Generates individual skill zip packages for direct download                                            |
| `utils.js`         | Helper functions (sleep, path checks, ID generation, etc.)                                             |

## Skills Registry Format

The registry uses a **compact format** to minimize file size. Shared repository info is extracted into a top-level `repositories` object, and derivable fields (displayName, author URL, avatar, downloadUrl, etc.) are omitted — clients reconstruct them at runtime.

When the total skill count exceeds the chunk size (default 2500), the output is split into multiple files by repository boundaries (e.g., `skills.json` + `skills-1.json`).

```json
{
  "meta": {
    "generatedAt": "2026-02-09T14:00:00Z",
    "totalSkills": 3477,
    "localSkills": 0,
    "prioritySkills": 13,
    "remoteSkills": 3464,
    "apiVersion": "1.1",
    "rateLimited": false,
    "timedOut": false,
    "zipTimedOut": false,
    "executionTimeMs": 180000,
    "compact": true,
    "chunks": ["skills-1.json"]
  },
  "repositories": {
    "owner/repo": {
      "url": "https://github.com/owner/repo",
      "branch": "main",
      "stars": 100,
      "forks": 10,
      "lastUpdated": "2026-02-01T00:00:00Z"
    }
  },
  "skills": [
    {
      "id": "owner/repo/path-to-skill",
      "name": "skill-name",
      "description": "What this skill does...",
      "categories": ["Development", "Design"],
      "author": "owner",
      "repo": "owner/repo",
      "path": "skills/skill-name",
      "commitHash": "a5343bd997c4",
      "files": ["SKILL.md", "reference.md"],
      "version": "1.0.0",
      "tags": ["tag1", "tag2"],
      "compatibility": { "minAgentVersion": "0.1.0" }
    }
  ]
}
```

#### Compact Format Details

| Stored Field  | Description                                     |
| ------------- | ----------------------------------------------- |
| `id`          | Unique identifier: `owner/repo/path`            |
| `name`        | Skill name (lowercase, hyphens)                 |
| `description` | What the skill does                             |
| `categories`  | Auto-assigned category labels                   |
| `author`      | GitHub username (string, not object)            |
| `repo`        | Reference to `repositories` map key             |
| `path`        | Skill directory path within the repo            |
| `commitHash`  | Skill directory's latest commit hash (12 chars) |
| `files`       | File paths relative to skill directory          |

Optional fields (omitted when empty/default):

| Field           | Included When               |
| --------------- | --------------------------- |
| `version`       | Not `"0.0.0"`               |
| `tags`          | Non-empty array             |
| `compatibility` | Present in frontmatter      |
| `commitHash`    | Not empty and not `"local"` |

### Automatic Categorization

Skills are automatically categorized based on keywords in their name and description. Available categories:

| Category      | Keywords                                                              |
| ------------- | --------------------------------------------------------------------- |
| Development   | code, coding, programming, developer, ide, editor, debug, refactor... |
| AI & LLM      | ai, llm, gpt, claude, openai, langchain, prompt, agent...             |
| DevOps        | docker, kubernetes, ci/cd, deploy, infrastructure, terraform...       |
| Database      | database, sql, postgres, mongodb, redis, query...                     |
| Web           | web, frontend, backend, react, vue, html, css, api...                 |
| Mobile        | mobile, ios, android, react-native, flutter, swift...                 |
| Documentation | docs, documentation, readme, markdown, writing...                     |
| Testing       | test, testing, unit test, integration, jest, pytest...                |
| Security      | security, auth, encryption, vulnerability, oauth...                   |
| Data          | data, analytics, visualization, pandas, etl, pipeline...              |
| Automation    | automation, workflow, script, task, cron, scheduler...                |
| Design        | design, ui, ux, figma, css, styling, theme...                         |

A skill receives a category tag if at least 2 keywords from that category appear in its name or description.

## Usage

### Running the Crawler Locally

1. Clone this repository:

   ```bash
   git clone https://github.com/coolzwc/open-skill-market.git
   cd open-skill-market
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up your GitHub token:

   ```bash
   cp .env.example .env
   # Edit .env and add your GitHub token
   ```

   To create a token, go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens) and create a token with `public_repo` scope.

4. Run the crawler:

   ```bash
   npm run crawl
   ```

   The crawler will automatically generate zip packages for each skill in the `market/zips/` directory.

## Skill Market Website

The website project lives in `market/web` and is intentionally independent from the repository root `package.json`.

```bash
cd market/web
npm install
npm run dev
```

Build command automatically syncs `market/skills.json` and `market/skills-*.json` into `market/web/public/data`.

## npx Installer CLI

The installer project lives in `market/cli` and is also independent.

```bash
cd market/cli
npm install
npm run check
```

Usage examples:

```bash
npx skill-market search react
npx skill-market install vercel-react-native-skills --tool cursor
npx skill-market update vercel-react-native-skills --tool cursor
```

Update checks:

- If installed by `npx`, compare `installedCommitHash` with latest registry `commitHash`
- If legacy install (no metadata), compare local files with latest package
- After update, metadata with commit hash is persisted for future checks

5. (Optional) Run in test mode to scan only specific repos:

   ```bash
   # Use default test repos (anthropics/skills, huggingface/skills)
   npm run crawl:test

   # Or specify custom repos
   TEST_MODE=true TEST_REPOS="owner1/repo1,owner2/repo2" npm run crawl
   ```

### Configuring Priority Repositories

You can configure specific repositories to be crawled with priority (before topic-based search). Edit `crawler/repositories.yml`:

```yaml
# Priority Repositories
# Format: owner/repo

priority:
  - cursor-ai/cursor-skills
  - anthropics/claude-skills
  - your-org/your-skills-repo
```

Priority repositories are:

- Crawled first, before the topic-based GitHub search
- Scanned recursively for all `SKILL.md` files
- Not subject to GitHub search result limits
- Ideal for official or curated skill collections

### Rate Limiting

The crawler respects GitHub API rate limits:

| API        | Authenticated  | Unauthenticated |
| ---------- | -------------- | --------------- |
| REST API   | 5,000 req/hour | 60 req/hour     |
| Search API | 30 req/minute  | 10 req/minute   |

**Important**: Always set `GITHUB_TOKEN` for production use. Without it, you'll hit rate limits very quickly.

When rate limits are reached, the crawler will:

1. Wait for the reset time (up to 5 minutes)
2. Resume crawling after the wait
3. If the wait would be too long, save partial results and exit

### Caching

The crawler uses a two-level caching system to minimize GitHub API calls:

| Cache Level         | What it tracks             | Benefit                                    |
| ------------------- | -------------------------- | ------------------------------------------ |
| **Repository**      | Repo's latest commit hash  | Skip entire repo if unchanged (1 API call) |
| **Skill Directory** | Skill folder's commit hash | Skip individual skill if unchanged         |

How it works:

1. First check if the **repository** has any new commits since last crawl
2. If no changes → use cached skills for the entire repo (saves many API calls)
3. If changed → check each **skill directory** for changes
4. Only fetch/parse skills whose directories have new commits

The cache is stored in `crawler/.crawler-cache.json` and persisted across GitHub Actions runs.

#### Cache Version Control

The cache includes a version number to handle format changes across code updates:

- **Current version**: v1
- When a version mismatch is detected, the crawler will:
  - **migrate** (default): Attempt to migrate old cache data to the new format
  - **discard**: Clear the cache and start fresh

You can control the migration strategy via environment variable:

```bash
# Use migration (default)
CACHE_MIGRATION_STRATEGY=migrate npm run crawl

# Discard old cache
CACHE_MIGRATION_STRATEGY=discard npm run crawl
```

### Multi-Token Parallel Processing

To increase API capacity and speed, the crawler supports multiple GitHub tokens from different accounts. Each token provides an independent rate limit quota:

```bash
# .env file
GITHUB_TOKEN=ghp_main_token          # Required: Primary token
EXTRA_TOKEN_1=ghp_token_from_acc1    # Optional: Additional token
EXTRA_TOKEN_2=ghp_token_from_acc2    # Optional: Additional token
EXTRA_TOKEN_3=ghp_token_from_acc3    # Optional: Additional token
EXTRA_TOKEN_4=ghp_token_from_acc4    # Optional: Additional token
EXTRA_TOKEN_5=ghp_token_from_acc5    # Optional: Additional token
```

**Note**: Using `EXTRA_TOKEN_` prefix because GitHub Actions reserves the `GITHUB_` prefix for system variables.

**Important**: Tokens must be from _different_ GitHub accounts to get independent rate limits. Multiple tokens from the same account share the same quota.

Benefits:

- **6x API capacity**: With 6 tokens, you get 30,000 REST API requests/hour
- **Parallel processing**: Repositories are processed concurrently using a task queue
- **Automatic failover**: If one token hits its limit, others continue working

The crawler automatically detects available tokens (checking `EXTRA_TOKEN_1` through `EXTRA_TOKEN_5` sequentially) and creates a worker pool.

### Execution Timeout

The crawler has built-in execution timeout handling to work within GitHub Actions limits:

| Repository Type                 | Job Timeout Limit |
| ------------------------------- | ----------------- |
| Public repos                    | 6 hours (360 min) |
| Private repos (Free/Pro)        | 35 minutes        |
| Private repos (Team/Enterprise) | 6 hours           |

The crawler is configured to run for up to 5 hours, which works well for public repositories (6-hour limit) or Team/Enterprise private repos. For Free/Pro private repos with a 35-minute limit, you may need to adjust the timeout.

You can adjust these settings in `crawler/config.js`:

```javascript
execution: {
  maxExecutionTime: 5 * 60 * 60 * 1000, // 5 hours
  saveBuffer: 2 * 60 * 1000,            // 2 minutes buffer for saving
},
```

The `meta.timedOut` and `meta.rateLimited` fields in `skills.json` indicate if the crawl was incomplete.

### Crawl Phases

The crawler operates in three phases:

1. **Phase 1: Local Skills** - Scans the `skills/` directory for PR-submitted skills
2. **Phase 2: Priority Repositories** - Crawls repositories listed in `repositories.yml`
3. **Phase 3: GitHub Topic Search** - Searches GitHub for repositories with relevant topics (claude-skill, ai-skill, langchain-tools, etc.)

Skills are deduplicated by name + description, with priority: local > priority > github (higher stars preferred).

### GitHub Actions (Automated)

The crawler runs automatically via GitHub Actions:

- **Schedule**: Daily at 00:00 UTC
- **Manual**: Can be triggered manually from the Actions tab
- **On Push**: Runs when crawler code changes

The workflow automatically commits and pushes changes to `market/skills.json`.

#### Configuring Multi-Token in GitHub Actions

To use multiple tokens in the workflow, add them as repository secrets:

1. Go to **Settings > Secrets and variables > Actions**
2. Add secrets: `PAT_TOKEN` (or use default `GITHUB_TOKEN`), `EXTRA_TOKEN_1`, `EXTRA_TOKEN_2`, etc.
3. The workflow automatically passes these to the crawler

```yaml
# .github/workflows/crawl.yml (excerpt)
env:
  GITHUB_TOKEN: ${{ secrets.PAT_TOKEN || secrets.GITHUB_TOKEN }}
  EXTRA_TOKEN_1: ${{ secrets.EXTRA_TOKEN_1 }}
  EXTRA_TOKEN_2: ${{ secrets.EXTRA_TOKEN_2 }}
  # ... up to EXTRA_TOKEN_5
```

## For Skill Authors

There are two ways to publish your skill:

### Option 1: Submit via Pull Request

Submit your skill directly to this repository:

1. Fork this repository
2. Create a new directory under `skills/` with your skill name:
   ```
   skills/
   └── my-awesome-skill/
       ├── SKILL.md        # Required
       ├── reference.md    # Optional
       └── scripts/        # Optional
   ```
3. Create your `SKILL.md` with YAML frontmatter:

   ```markdown
   ---
   name: my-awesome-skill
   description: What this skill does. Use when the user asks about X.
   version: 1.0.0
   tags:
     - category1
     - category2
   author:
     name: your-github-username
     url: https://github.com/your-github-username
   ---

   # My Awesome Skill

   ## Instructions

   Your instructions here...
   ```

4. Submit a Pull Request
5. Once merged, your skill will be included in the next crawler run

See `skills/.example/SKILL.md` for a complete template.

### Option 2: Add Your Repository to Priority List

If you prefer to maintain your skill in your own repository:

1. Create a `SKILL.md` file in your repository (see format above)
2. Fork this repository
3. Add your repository to `crawler/repositories.yml`:
   ```yaml
   priority:
     - your-username/your-skill-repo
   ```
4. Submit a Pull Request

**For multiple skills in one repository**, place them in a `skills/` directory:

```
my-skills-repo/
├── skills/
│   ├── skill-one/
│   │   └── SKILL.md
│   └── skill-two/
│       └── SKILL.md
└── README.md
```

Each skill will be indexed with its path (e.g., `owner/repo/skills/skill-one`).

### Skill Structure Best Practices

- **name**: Use lowercase letters, numbers, and hyphens (max 64 chars)
- **description**: Be specific, include trigger terms (min 20 chars)
- **version**: Use semantic versioning (e.g., `1.0.0`)
- **tags**: Add relevant categories for filtering
- **body**: Include detailed instructions (min 500 chars)

## 🙏 Help Us Scale - Contribute Your GitHub Token

Our crawler relies on GitHub API to discover skills across thousands of repositories. Unfortunately, GitHub's API rate limits are strict:

| API        | Per Token Limit     |
| ---------- | ------------------- |
| REST API   | 5,000 requests/hour |
| Search API | 30 requests/minute  |

**Why we need your help**: With more tokens from different accounts, we can:

- Crawl more repositories in each run
- Discover skills faster and more comprehensively
- Keep the skill registry up-to-date more frequently
- Avoid incomplete crawls due to rate limiting

**If you don't use GitHub API**: Every GitHub account comes with a free API quota (5,000 requests/hour), but most users never use it! If you're not using the GitHub API for your own projects, your quota is sitting idle. By contributing a token, you're donating unused resources to help the open-source community discover more AI skills.

### How to Contribute a Token

1. **Create a GitHub Personal Access Token**:
   - Go to [GitHub Settings > Developer settings > Personal access tokens > Tokens (classic)](https://github.com/settings/tokens)
   - Click **"Generate new token (classic)"**
   - Give it a descriptive name (e.g., "Open Skill Market Crawler")
   - Set expiration (recommend: 90 days or longer)
   - Select scope: **`public_repo`** (only this scope is needed - read-only access to public repos)
   - Click **"Generate token"**
   - Copy the token (starts with `ghp_`)

2. **Send the token to us**:
   - Email your token to: **coolzwc@gmail.com**
   - Subject: `[Open Skill Market] GitHub Token Contribution`
   - Include your GitHub username (optional, for attribution)

### Security Notes

- The token only needs `public_repo` scope (read-only access to public repositories)
- We will only use the token for crawling public SKILL.md files
- You can revoke your token anytime from [GitHub Settings](https://github.com/settings/tokens)
- We recommend setting an expiration date and renewing periodically

**Thank you for helping make the Open Skill Market more comprehensive!** 🚀

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is open source. See [LICENSE](LICENSE) for details.
