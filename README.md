# Bug Hunter Plugin for Claude Code + Babysitter

Scan any repo for bugs, verify with 5-judge majority vote, fix in batches, and re-scan until clean.

## Install

```bash
mkdir -p ~/.claude/skills/bh ~/.a5c/processes
curl -o ~/.claude/skills/bh/SKILL.md https://raw.githubusercontent.com/deedeeharris/bug-hunter-plugin/main/skill.md
curl -o ~/.a5c/processes/bug-hunter.js https://raw.githubusercontent.com/deedeeharris/bug-hunter-plugin/main/process/bug-hunter.js
```

Requires: [Claude Code](https://claude.ai/claude-code) + [Babysitter SDK](https://github.com/a5c-ai/babysitter) (`npm i -g @a5c-ai/babysitter-sdk`)

## Usage

```
/bh                 # yolo mode — fully autonomous
/bh interactive     # interactive — breakpoints before each fix + commit
```

## What It Does

```
DETECT → SCAN (6 categories) → DEDUP → VERIFY (5-judge vote)
→ PROVE → FIX (batches of 8) → REGRESSION CHECK → BUILD
→ COMMIT (with bug IDs) → RE-SCAN → LOOP until clean → REPORT
```

## Bug Categories

| Category | Examples |
|----------|---------|
| Logic | Dead code, null derefs, off-by-one, wrong conditionals |
| Security | Leaked secrets, injection, insecure storage |
| Memory/Lifecycle | Leaks, unclosed resources, missing cleanup |
| Error Handling | Swallowed exceptions, missing fallbacks |
| Performance | Blocking UI thread, unnecessary allocations |
| Thread Safety | Race conditions, missing synchronization |

## Options

Pass via inputs JSON:

| Option | Default | Description |
|--------|---------|-------------|
| `maxIterations` | 3 | Scan-fix-rescan cycles |
| `maxBatchSize` | 8 | Bugs per fix batch |
| `autoFix` | true | false = breakpoints before fix/commit |
| `categories` | all 6 | Filter to specific categories |
| `buildCmd` | auto | Override build command |
| `testCmd` | auto | Override test command |
