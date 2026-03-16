# skill-market CLI

Standalone `npx` installer for Open Skill Market.

## Commands

```bash
npx skill-market list --tool cursor
npx skill-market list --tool gemini
npx skill-market search react
npx skill-market search react --json
npx skill-market list --tool cursor --limit 20
npx skill-market install vercel-react-native-skills --tool cursor
npx skill-market install <skill> --tool openclaw
npx skill-market install react --tool cursor --yes
npx skill-market update vercel-react-native-skills --tool cursor
npx skill-market update --all --tool cursor
```

## Update Detection Strategy

- New installs write `.skill-market-meta.json` into each skill directory.
- If `installedCommitHash` exists, update checks compare it with latest registry `commitHash`.
- Legacy installs without metadata use file fingerprint compare.
- After any `npx skill-market update`, metadata is persisted so next checks use commit hash.

## Install Paths (defaults)

- Cursor: `~/.cursor/skills`
- Claude Code: `~/.claude/skills`
- Codex CLI: `~/.codex/skills`
- GitHub Copilot: `~/.config/github-copilot/skills`
- OpenClaw: `~/.openclaw/skills`
- Gemini CLI: `~/.gemini/skills`

Use `--dir` to override. For project-level installs (e.g. Cursor or Gemini), you can use `--dir .cursor/skills` or `--dir .gemini/skills` from the project root; Gemini CLI also discovers `~/.agents/skills` if you prefer `--dir ~/.agents/skills`.

Other flags:
- `--limit`: max rows for `list/search` (default: list=100, search=50)
- `--json`: structured output for automation
- `--yes`: auto-select first match when query is ambiguous
