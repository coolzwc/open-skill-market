# skill-market CLI

Standalone `npx` installer for Open Skill Market with integrated security and quality scanning.

## Commands

### List & Search
```bash
npx skill-market list --tool cursor
npx skill-market list --tool gemini
npx skill-market search react
npx skill-market search react --json
npx skill-market list --tool cursor --limit 20
```

### Install & Update
```bash
npx skill-market install vercel-react-native-skills --tool cursor
npx skill-market install <skill> --tool openclaw
npx skill-market install react --tool cursor --yes
npx skill-market install brainstorming --tool cursor --force
npx skill-market update vercel-react-native-skills --tool cursor
npx skill-market update --all --tool cursor
```

### Scan & Security Check
```bash
# Scan a specific skill from registry
npx skill-market scan brainstorming --json

# Scan all installed skills
npx skill-market scan --installed --tool cursor

# Scan all skills in registry (slower, comprehensive)
npx skill-market scan --all --json
```

### Remove
```bash
# Remove an installed skill (with confirmation)
npx skill-market remove brainstorming --tool cursor

# Remove without confirmation
npx skill-market remove brainstorming --tool cursor --yes
```

## Security & Quality Checks

### Automatic Checks During Install/Update

When you run `install` or `update`, the CLI automatically scans the skill for security issues and quality metrics:

- **Security Score** (0-100): Detects dangerous patterns like:
  - Credential access (API keys, passwords, private keys)
  - Dangerous shell commands (exec, subprocess, rm -rf)
  - File system writes (.env files, sensitive paths)
  - Network calls and data exfiltration risks
  - Code obfuscation

- **Quality Score** (0-100): Evaluates:
  - Proper SKILL.md structure and frontmatter
  - Clear description and usage hints
  - Examples and templates
  - Organization and references
  - Test coverage (evals.json)

### Risk Levels

- **Low** (Green): Safe to install. Security score > 80, no high-risk patterns.
- **Medium** (Yellow): Proceed with awareness. Shows warning but continues installation.
- **High** (Orange): Requires confirmation. Likely contains file/network operations.
- **Critical** (Red): Requires --force flag. Likely contains code execution or credential access.

### Behavior During Install

| Security | Quality | Behavior |
|----------|---------|----------|
| Low | Good (≥60) | ✓ Shows info, continues |
| Medium | Any | ⚠️ Shows warning, continues |
| High/Critical | Any | ❌ Requires confirmation (TTY) or --force flag |
| Any | Poor (<60) | ❌ Requires confirmation (TTY) or --force flag |

### Example: Safe Installation
```
[brainstorming] Security check passed
  Security: 95/100 | Quality: 85/100
[brainstorming] Installed to ~/.cursor/skills/brainstorming
```

### Example: Risky Installation (TTY mode)
```
⚠️  Security Check for "agent-browser"
═══════════════════════════════════════
Security Score: 65/100 ([MEDIUM])
Quality Score:  72/100
Risk Level:     medium

Detected Issues:
  • network-call
  • file-system-write

Continue with installation? (y/n, or use --force to skip this prompt)
```

### Using --force Flag

Skip all prompts and proceed with installation regardless of security or quality scores:
```bash
npx skill-market install agent-browser --tool cursor --force
```

### Manual Scanning with `scan` Command

Scan skills without installing them:

```bash
# Scan specific skill
npx skill-market scan agent-browser

# Output:
# Scan Results for "agent-browser"
# ═══════════════════════════════════════
# Security Score: 65/100 (🟡 Medium)
# Quality Score:  72/100 (Good)
# Risk Level:     medium
# Tags:           network-call, file-system-write
#
# Detected Risks:
#   • network-call [medium]
#   • file-system-write [medium]
```

Get JSON output for automation:
```bash
npx skill-market scan agent-browser --json
```

### Checking Installed Skills

Scan all your already-installed skills to find any with security issues:
```bash
npx skill-market scan --installed --tool cursor
npx skill-market scan --installed --tool gemini
```

Output is formatted as a table:
```
Skill Name              Security  Quality  Risk Level  Tags
─────────────────────  ────────  ───────  ──────────  ─────────────────
brainstorming          95        85       [LOW]       [safe]
agent-browser          65        72       [MEDIUM]    [network-call, file-system-write]
...
```

### Example Workflows

**Safe installation with confirmation:**
```bash
npx skill-market install brainstorming --tool cursor
```

**Batch update with security review:**
```bash
npx skill-market update --all --tool cursor
# Each skill scanned before update, prompts shown for risky ones
```

**Pre-check before installing:**
```bash
npx skill-market scan react --json | jq '.riskLevel'
# Returns: "low"
npx skill-market install react --tool cursor
```

## Install Paths (defaults)

- Cursor: `~/.cursor/skills`
- Claude Code: `~/.claude/skills`
- Codex CLI: `~/.codex/skills`
- GitHub Copilot: `~/.config/github-copilot/skills`
- OpenClaw: `~/.openclaw/skills`
- Gemini CLI: `~/.gemini/skills`

Use `--dir` to override. For project-level installs (e.g. Cursor or Gemini), you can use `--dir .cursor/skills` or `--dir .gemini/skills` from the project root; Gemini CLI also discovers `~/.agents/skills` if you prefer `--dir ~/.agents/skills`.

## Flags

- `--limit`: max rows for `list/search` (default: list=100, search=50)
- `--json`: structured output for automation
- `--yes`: auto-select first match when query is ambiguous
- `--force`: skip security/quality prompts during install/update
- `--check`: check status only, don't modify files
- `--all`: process all items (scan all / update all installed)
- `--installed`: for scan, check already-installed skills
- `--registry`: override registry URL
- `--tool`: target tool (cursor, claude, codex, copilot, openclaw, gemini)
- `--dir`: override install directory

## Update Detection Strategy

- New installs write `.skill-market-meta.json` into each skill directory.
- If `installedCommitHash` exists, update checks compare it with latest registry `commitHash`.
- Legacy installs without metadata use file fingerprint compare.
- After any `npx skill-market update`, metadata is persisted so next checks use commit hash.
