# Bug Hunter Plugin for Claude Code + Babysitter

Scan any repo for bugs, verify with 5-judge majority vote, score fix confidence, and re-scan until clean.

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
-> PROVE -> FIX (batches of 8) -> SCORE FIX CONFIDENCE (4-dimension, convergence loop)
-> REGRESSION CHECK + COMPILE GATE (parallel) -> BUILD+TEST (hard shell gate)
-> COMMIT (with bug IDs) -> RE-SCAN (modified files only)
-> LOOP until clean -> REPORT (with confidence scores)
```

Every arrow is a separate babysitter task. Babysitter drives ALL phases — no short-circuiting.

## Fix Confidence Scoring

After each fix batch, every fix is scored across 4 weighted dimensions:

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Root Cause Match | 40% | Fix addresses the proven root cause, not just a symptom |
| Completeness | 25% | All code paths where the bug manifests are covered |
| Correctness | 20% | Fix itself is correct, no new logic errors |
| Safety | 15% | Fix doesn't break callers or change public API |

If overall confidence < target, low-confidence fixes get specific feedback and the fixer re-attempts (up to `maxFixAttempts`). Plateau detection prevents wasted iterations.

### Score Target Guide

| Target | When to Use |
|--------|-------------|
| **70** | Quick scans, internal tools |
| **80** | Standard development |
| **85** | **Default** — production code |
| **90** | Security-critical, compliance |
| **95** | Rarely — beware plateaus |

## Changelog

### v1.2.0
- **Fix confidence scoring** — 4-dimension weighted scoring after each fix batch
- **Convergence loop** — low-confidence fixes get re-attempted with specific feedback
- **Plateau detection** — stops re-fixing when improvement stalls (< 5 points)
- **Report includes confidence** — per-bug scores, convergence history, manual review flags

### v1.1.0
- Parallel category scanning, 2-signal evidence gate, hard compile gate
- Anti-short-circuit enforcement, one-task-per-session rule

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

| Option | Default | Description |
|--------|---------|-------------|
| `maxIterations` | 3 | Scan-fix-rescan cycles |
| `maxBatchSize` | 8 | Bugs per fix batch |
| `autoFix` | true | false = breakpoints before fix/commit |
| `fixConfidenceTarget` | 85 | Target confidence score for fix correctness (0-100) |
| `maxFixAttempts` | 3 | Max re-fix attempts per batch if below target |
| `categories` | all 6 | Filter to specific categories |
| `buildCmd` | auto | Override build command |
| `testCmd` | auto | Override test command |
