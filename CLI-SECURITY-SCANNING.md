# CLI Security & Quality Scanning Implementation

## Overview

Enhanced the skill-market CLI with comprehensive security and quality scanning capabilities. Users can now install skills with confidence, knowing the security risks and quality metrics upfront. The implementation includes:

- **Automatic security checks** during install/update with smart prompts
- **Full directory scanning** (not just SKILL.md): detects issues in scripts, configs, and docs
- **Independent `scan` command** for pre-installation auditing
- **Safe removal** with confirmation prompts
- **Risk-based workflows**: Low (info) → Medium (warning) → High/Critical (confirm)

## What Changed

### 1. Extended Security Detection (`detector/rules.js`)

**Changes:**
- Added `options` parameter to `runRules()` with `detailLevel` support
- New `analyzeContentForRisks()` helper for per-file risk tracking
- When `detailLevel: 'detailed'`, returns `detectedRisks` array with file locations

**Usage:**
```javascript
const result = runRules(skillMd, filesMap, { detailLevel: 'detailed' });
// result.detectedRisks = [{ tag, riskLevel, match, file }, ...]
```

### 2. Directory Scanning Adapter (`market/cli/src/detector-adapter.js`)

**Key Functions:**
- `scanSkillDirectory(skillDir, options)`: Recursively scans all files, identifies:
  - Scripts (`.js`, `.py`, `.sh`, `.rb`, `.ts`, `.go`, etc.)
  - Config files (`.env*`, `config.*`, `*.conf`, etc.)
  - Documentation (SKILL.md, README.md)
  - Returns: `{ securityScore, riskLevel, qualityScore, scanTags, detectedRisks }`

- `scanRemoteSkillExtracted(skillZipPath, options)`: Alias for remote skills

- `getRiskLevelDisplay()`, `getQualityGrade()`: Display helpers

- `formatDetectedRisks()`: Groups and formats risks for console output

### 3. Output Formatting (`market/cli/src/utils/formatting.js`)

**Key Functions:**
- `formatScanTable()`: Renders TTY-friendly table with 5 columns (name, security, quality, risk, tags)
- `formatSecurityPrompt()`: Interactive prompt for risky installations
- `formatQualityWarning()`: Quality score warnings
- `formatSecurityInfo()`: Safe installation confirmations
- `formatRemovalPrompt()`: Removal confirmation
- `formatScanResultsJson()`: JSON output for automation

### 4. Enhanced CLI (`market/cli/src/cli.js`)

**New/Modified Functions:**

#### `installOrUpdate()` - Enhanced
- Now calls `scanSkillDirectory()` on extracted skill before deciding
- `needsUserConfirmation()` logic:
  - High/Critical risk: requires confirmation
  - Quality < 60: requires confirmation
  - Otherwise: proceed or show info
- Respects `args.force` flag to skip all prompts
- Includes `scanResult` in returned object (JSON mode)

#### `runScan(registry, args)` - New
Three modes:
1. **scan --installed [--tool cursor]**: Scan your already-installed skills
2. **scan --all**: Scan entire registry (slower, comprehensive)
3. **scan <skill>**: Scan specific skill from registry

Output: formatted table (TTY) or JSON (--json flag)

#### `runRemove(registry, args)` - New
- Removes installed skill from disk
- Prompts for confirmation in TTY mode
- Supports `--yes` flag for non-interactive removal

#### `printHelp()` - Updated
- Added new commands and flags
- Updated examples for scan/remove

**New Imports:**
```javascript
import { scanSkillDirectory, ... } from "./detector-adapter.js";
import { formatScanTable, formatSecurityPrompt, ... } from "./utils/formatting.js";
```

### 5. Documentation Update (`market/cli/README.md`)

**New Sections:**
- **Security & Quality Checks**: Full explanation of:
  - Risk levels (Low → Critical)
  - Behavior matrix (Security × Quality → Action)
  - Examples with output
  - --force flag usage

- **Manual Scanning**: `scan` command examples and output

- **Example Workflows**: Common user scenarios

**Command Examples Added:**
- `npx skill-market install brainstorming --tool cursor --force`
- `npx skill-market scan agent-browser --json`
- `npx skill-market scan --installed --tool cursor`
- `npx skill-market remove brainstorming --tool cursor --yes`

## Design Decisions

### 1. **Full Directory Scanning vs. SKILL.md Only**
- **Why**: Users need to know if there are risky scripts, hardcoded secrets in .env files, etc.
- **Implementation**: Recursive traversal with file type filtering (scripts, configs, docs)
- **Limits**: 10MB total scan, 1MB per file, skip binary files gracefully

### 2. **Risk-Based Interaction Model**
- **Low**: Just show info (non-blocking)
- **Medium**: Show warning but continue (awareness)
- **High/Critical**: Require confirm (interactive) or --force (batch)
- **Why**: Respects user intent while protecting against dangerous installs

### 3. **Three Scan Modes**
- **Single skill**: For ad-hoc checking
- **Installed**: Find risky things already on your machine
- **All registry**: Comprehensive audit (slower but complete)
- **Why**: Flexibility for different user workflows

### 4. **Separate Adapter Layer**
- `detector-adapter.js` vs. direct detector calls
- **Why**: Isolates file I/O from scanning logic; detector/rules.js stays pure
- **Benefits**: Easy to reuse in other contexts (web UI, CI/CD)

## Usage Examples

### Safe Installation
```bash
$ npx skill-market install brainstorming --tool cursor
✓ [brainstorming] Security check passed
  Security: 95/100 | Quality: 85/100
[brainstorming] Installed to ~/.cursor/skills/brainstorming
```

### Risky Installation (Interactive)
```bash
$ npx skill-market install agent-browser --tool cursor

⚠️  Security Check for "agent-browser"
═══════════════════════════════════════
Security Score: 65/100 ([MEDIUM])
Quality Score:  72/100
Risk Level:     medium

Detected Issues:
  • network-call
  • file-system-write

Continue with installation? (y/n, or use --force to skip this prompt)
y
[agent-browser] Installed to ~/.cursor/skills/agent-browser
```

### Pre-Check Before Installing
```bash
$ npx skill-market scan agent-browser

Scan Results for "agent-browser"
═══════════════════════════════════════
Security Score: 65/100 (🟡 Medium)
Quality Score:  72/100 (Good)
Risk Level:     medium
Tags:           network-call, file-system-write

Detected Risks:
  • network-call [medium]
  • file-system-write [medium]
```

### Audit Your Installed Skills
```bash
$ npx skill-market scan --installed --tool cursor

Skill Name              Security  Quality  Risk Level  Tags
─────────────────────  ────────  ───────  ──────────  ─────────────────
brainstorming          95        85       [LOW]       [safe]
agent-browser          65        72       [MEDIUM]    [network-call, file-system-write]
...

Scanned 5 skill(s).
```

### Batch Install with --force
```bash
$ npx skill-market install risky-skill --tool cursor --force
[warn] Security check skipped due to --force: High risk detected
[risky-skill] Installed to ~/.cursor/skills/risky-skill
```

### Safe Removal
```bash
$ npx skill-market remove agent-browser --tool cursor

❓ Remove skill "agent-browser" from ~/.cursor/skills/agent-browser? (y/n)
y
✓ Skill "agent-browser" removed successfully.
```

## Testing Recommendations

1. **Security Detection**: Install a skill with known issues, verify prompts
   ```bash
   npx skill-market scan --all --json | jq '.[] | select(.riskLevel=="high")'
   ```

2. **Interactive Mode**: Install a high-risk skill in TTY, verify y/n prompt
   ```bash
   npx skill-market install <risky-skill> --tool cursor
   # Press 'n' to cancel, check it doesn't install
   ```

3. **Batch Mode**: Non-TTY install should fail without --force
   ```bash
   echo "" | npx skill-market install <risky-skill> --tool cursor
   # Should error about --force
   ```

4. **Removal**: Verify `--yes` flag skips prompt in batch
   ```bash
   npx skill-market remove <skill> --tool cursor --yes
   # Should remove without prompt
   ```

5. **Scan Output**: JSON format should be parseable
   ```bash
   npx skill-market scan --all --json | jq '.count'
   ```

## Future Enhancements

1. **Color output**: Use chalk/ansi-colors for risk badges
2. **Risk severity export**: Output SARIF format for CI/CD integration
3. **Custom risk rules**: Allow users to define organization-specific policies
4. **Caching**: Cache scan results per version to speed up repeated checks
5. **Telemetry**: Optional analytics on common risk patterns
