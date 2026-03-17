# CLI Security Scanning - Quick Reference

## New Commands

### Scan Skills
```bash
# Scan specific skill from registry
npx skill-market scan brainstorming

# Scan with JSON output (for automation)
npx skill-market scan brainstorming --json

# Scan all installed skills
npx skill-market scan --installed --tool cursor

# Scan entire registry (slower)
npx skill-market scan --all
```

### Remove Skills
```bash
# Remove with confirmation prompt
npx skill-market remove brainstorming --tool cursor

# Remove without prompt
npx skill-market remove brainstorming --tool cursor --yes
```

## Install/Update Behavior

### Automatic Security Checks
All `install` and `update` commands now scan the skill:

```bash
# Shows info if safe
npx skill-market install brainstorming --tool cursor

# Prompts if risky (interactive mode)
npx skill-market install agent-browser --tool cursor

# Skips prompts (--force flag)
npx skill-market install agent-browser --tool cursor --force
```

## Risk Levels

| Level | Badge | Security Score | Action |
|-------|-------|-----------------|--------|
| **Low** | 🟢 | > 80 | ✓ Auto-continue |
| **Medium** | 🟡 | 65-80 | ⚠️ Show warning, continue |
| **High** | 🟠 | 50-65 | ❌ Ask user (or --force) |
| **Critical** | 🔴 | < 50 | ❌ Requires confirm (or --force) |

## Quality Grades

| Grade | Score | Meaning |
|-------|-------|---------|
| **Excellent** | ≥ 80 | Well-structured, documented, tested |
| **Good** | ≥ 70 | Good structure, clear description |
| **Average** | ≥ 60 | Basic structure, functional |
| **Fair** | ≥ 50 | Minimal documentation |
| **Poor** | < 50 | Lacks documentation, structure |

## Flags

- `--force`: Skip all security prompts during install/update
- `--tool <name>`: Target tool (cursor, claude, codex, copilot, openclaw, gemini)
- `--dir <path>`: Override install directory
- `--json`: JSON output (for automation)
- `--yes`: Skip confirmation prompts
- `--all`: For scan, process all registry / For update, all installed
- `--installed`: For scan, check already-installed skills

## Workflow Examples

### Audit Your Skills
```bash
npx skill-market scan --installed --tool cursor | grep -E "\[HIGH\]|\[CRITICAL\]"
```

### Pre-Check Before Installing
```bash
npx skill-market scan new-skill --json | jq '.riskLevel, .qualityScore'
```

### Batch Install (CI/CD)
```bash
# Automated install with forced security skip
npx skill-market install my-skill --tool cursor --force --json
```

### Safe Cleanup
```bash
# Remove all risky installed skills
for skill in $(npx skill-market scan --installed --tool cursor --json | jq -r '.results[] | select(.riskLevel=="high") | .name'); do
  npx skill-market remove "$skill" --tool cursor --yes
done
```

## What Gets Scanned?

### Files Analyzed
- ✅ SKILL.md (quality + security)
- ✅ Scripts (.js, .py, .sh, .rb, .ts, .go, etc.)
- ✅ Config files (.env*, config.*, *.conf, *.json, *.yaml)
- ✅ README.md and other docs
- ❌ Binary files (skipped)
- ❌ node_modules, .git, dist, build (skipped)

### Security Checks
- 🔍 **Credential access**: API keys, passwords, private keys
- 🔍 **Shell execution**: eval, exec, subprocess, shell injection
- 🔍 **File operations**: writeFile, filesystem access to sensitive paths
- 🔍 **Network calls**: fetch, HTTP requests, data exfiltration
- 🔍 **Obfuscation**: Code obfuscation, binary encoding
- 🔍 **Prompt injection**: Jailbreaks, instruction override

### Quality Checks
- 📋 **Structure**: Frontmatter, metadata, appropriate length
- 📋 **Description**: Clear usage hints, when to use
- 📋 **Content**: Examples, templates, clear instructions
- 📋 **Organization**: References, related files
- 📋 **Testability**: evals.json, test cases

## Interactive Mode Example

```
$ npx skill-market install risky-skill --tool cursor

⚠️  Security Check for "risky-skill"
═══════════════════════════════════════
Security Score: 45/100 ([CRITICAL])
Quality Score:  55/100
Risk Level:     critical

Detected Issues:
  • credential-access
  • dangerous-shell

Continue with installation? (y/n, or use --force to skip this prompt)
```

Press `y` to continue, `n` to cancel, or rerun with `--force` to skip prompt.

## Output Formats

### Table (TTY)
```
Skill Name              Security  Quality  Risk Level  Tags
─────────────────────  ────────  ───────  ──────────  ─────────────────
brainstorming          95        85       [LOW]       [safe]
agent-browser          65        72       [MEDIUM]    [network-call, file-system-write]
```

### JSON
```json
{
  "name": "brainstorming",
  "id": "brainstorming",
  "securityScore": 95,
  "qualityScore": 85,
  "riskLevel": "low",
  "scanTags": ["safe"],
  "detectedRisks": null
}
```
