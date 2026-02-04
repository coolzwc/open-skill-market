# Open Skill Market

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
│   ├── index.js              # GitHub crawler script
│   └── repositories.yml      # Priority repositories config
├── market/
│   └── skills.json           # Generated skills registry
├── .github/
│   └── workflows/
│       └── crawl.yml         # Scheduled GitHub Action
├── package.json
└── README.md
```

## Skills Registry Format

The `market/skills.json` file contains all discovered skills in the following format:

```json
{
  "meta": {
    "generatedAt": "2026-02-04T10:00:00Z",
    "totalSkills": 125,
    "localSkills": 10,
    "remoteSkills": 115,
    "apiVersion": "1.1"
  },
  "skills": [
    {
      "id": "owner/repo/path-to-skill",
      "name": "skill-name",
      "displayName": "Skill Name",
      "description": "What this skill does...",
      "author": {
        "name": "owner",
        "url": "https://github.com/owner",
        "avatar": "https://github.com/owner.png"
      },
      "version": "1.0.0",
      "tags": ["tag1", "tag2"],
      "repository": {
        "url": "https://github.com/owner/repo",
        "branch": "main",
        "path": "skills/skill-name",
        "latestCommitHash": "abc123...",
        "downloadUrl": "https://api.github.com/repos/owner/repo/zipball/main"
      },
      "files": ["SKILL.md", "reference.md"],
      "stats": {
        "stars": 100,
        "forks": 10,
        "lastUpdated": "2026-02-01T00:00:00Z"
      },
      "source": "local | github"
    }
  ]
}
```

The `source` field indicates where the skill came from:
- `local`: Submitted via PR to this repository's `skills/` directory
- `priority`: From a priority repository configured in the crawler
- `github`: Discovered by the crawler via GitHub search

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

| API | Authenticated | Unauthenticated |
|-----|--------------|-----------------|
| REST API | 5,000 req/hour | 60 req/hour |
| Search API | 30 req/minute | 10 req/minute |

**Important**: Always set `GITHUB_TOKEN` for production use. Without it, you'll hit rate limits very quickly.

When rate limits are reached, the crawler will:
1. Wait for the reset time (up to 5 minutes)
2. Resume crawling after the wait
3. If the wait would be too long, save partial results and exit

### Execution Timeout

The crawler has built-in execution timeout handling to work within GitHub Actions limits:

| Repository Type | Job Timeout Limit |
|-----------------|-------------------|
| Public repos | 6 hours (360 min) |
| Private repos (Free/Pro) | 35 minutes |
| Private repos (Team/Enterprise) | 6 hours |

The workflow is configured with a 30-minute timeout, and the crawler will automatically stop after 25 minutes to ensure results are saved before the job is terminated.

You can adjust these settings in `crawler/index.js`:

```javascript
execution: {
  maxExecutionTime: 25 * 60 * 1000, // 25 minutes
  saveBuffer: 2 * 60 * 1000,        // 2 minutes buffer for saving
},
```

The `meta.timedOut` and `meta.rateLimited` fields in `skills.json` indicate if the crawl was incomplete.

### GitHub Actions (Automated)

The crawler runs automatically via GitHub Actions:

- **Schedule**: Daily at 00:00 UTC
- **Manual**: Can be triggered manually from the Actions tab
- **On Push**: Runs when crawler code changes

The workflow automatically commits and pushes changes to `market/skills.json`.

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

## API

The `skills.json` file can be consumed by:

- **Web applications**: Display and search skills
- **Desktop tools**: Download and manage skills locally
- **CLI tools**: Install skills from the command line

### Example: Fetching Skills

```javascript
const response = await fetch(
  "https://raw.githubusercontent.com/coolzwc/open-skill-market/main/market/skills.json"
);
const { skills } = await response.json();

// Filter by tag
const gitSkills = skills.filter((s) => s.tags.includes("git"));

// Sort by popularity
const popular = skills.sort((a, b) => b.stats.stars - a.stats.stars);
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is open source. See [LICENSE](LICENSE) for details.
