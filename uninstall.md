# Bug Hunter — Uninstallation

## Steps

### 1. Remove the skill

```bash
rm -rf ~/.claude/skills/bh
```

### 2. Remove the process file

```bash
rm ~/.a5c/processes/bug-hunter.js
```

### 3. Verify removal

Start a new Claude Code session. `/bh` should no longer appear in the skill list.

## What Gets Removed

| File | Description |
|------|-------------|
| `~/.claude/skills/bh/SKILL.md` | The /bh slash command |
| `~/.a5c/processes/bug-hunter.js` | The babysitter process definition |

**Not removed:** Project-level `.a5c/processes/bug-hunter.js` copies or `.a5c/processes/bug-hunter-inputs.json` files created during runs. Remove those manually if desired.
