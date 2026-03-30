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
DETECT -> SCAN (6 categories IN PARALLEL) -> DEDUP -> VERIFY (5-judge vote + 2-signal evidence)
-> PROVE -> FIX (batches of 8) -> REGRESSION CHECK + COMPILE GATE (parallel)
-> BUILD+TEST (hard shell gate) -> COMMIT (with bug IDs)
-> RE-SCAN (modified files only) -> LOOP until clean -> REPORT
```

Every arrow is a separate babysitter task. Babysitter drives ALL phases — no short-circuiting.

## v1.1.0 Changes

- **Parallel category scanning** — all 6 categories scan simultaneously via `ctx.parallel.map`
- **2-signal evidence requirement** — verification requires evidence from 2+ independent sources
- **Hard compile gate** — shell task that fails the process on non-zero exit (agents can't override)
- **Parallel post-fix checks** — regression check and compile gate run simultaneously
- **Anti-short-circuit enforcement** — every agent task prompt includes "do ONLY this task" boundary
- **Stronger skill instructions** — explicit one-task-per-session rule, short-circuit detection table
- **Build failure breakpoint in yolo mode** — even autonomous runs stop on persistent build failures

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
