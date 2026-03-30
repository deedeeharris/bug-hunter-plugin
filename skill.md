---
name: bh
description: Use when asked to hunt bugs, find and fix bugs, audit code quality, or run /bh. Launches the generic/bug-hunter babysitter process on the current repo. Supports yolo (auto-fix) and interactive (breakpoints) modes.
---

# Bug Hunter

Scan any repo for bugs across 6 categories, verify with 5-judge majority vote, deduplicate, prove, fix in batches, regression-check, commit, and re-scan until clean.

## CRITICAL RULES

**You MUST use babysitter orchestration. This is NON-NEGOTIABLE.**

- Do NOT execute the bug hunt yourself
- Do NOT skip babysitter because "it's simpler to just do it"
- Do NOT rationalize bypassing orchestration for any reason
- If babysitter setup fails, fix the setup — do NOT fall back to manual execution

| Rationalization | Reality |
|----------------|---------|
| "I can just scan and fix directly" | The process has 5-judge verification, dedup, regression checks. You will skip them. |
| "Babysitter is overkill for this" | The user explicitly requires babysitter. Use it. |
| "Let me just do a quick scan first" | That IS the babysitter process. Launch it. |
| "The session is too short" | Yolo mode runs autonomously. Launch it. |

## Modes

| Mode | Command | autoFix | Breakpoints | Description |
|------|---------|---------|-------------|-------------|
| **Yolo** (default) | `/bh` or `/bh yolo` | true | None | Fully autonomous, fixes everything |
| **Interactive** | `/bh interactive` | false | Before each fix batch + before each commit | User reviews and approves each step |

## How to Run

**Yolo mode** (default) — invoke `babysitter:yolo`:
```
/babysitter:yolo Run the generic/bug-hunter process.
  Process file: ~/.a5c/processes/bug-hunter.js
  Inputs: projectDir=<CWD>, autoFix=true, maxIterations=3
```

**Interactive mode** — invoke `babysitter:call`:
```
/babysitter:call Run the generic/bug-hunter process.
  Process file: ~/.a5c/processes/bug-hunter.js
  Inputs: projectDir=<CWD>, autoFix=false, maxIterations=3
```

## Process Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `projectDir` | CWD | Path to the repo root |
| `buildCmd` | auto-detect | Override build command |
| `testCmd` | auto-detect | Override test command |
| `maxIterations` | 3 | Max scan-fix-rescan cycles |
| `maxBatchSize` | 8 | Max bugs per fix batch |
| `categories` | all 6 | Which bug categories to scan |
| `autoFix` | true | true=yolo (no breakpoints), false=interactive (breakpoints before fix/commit) |

## Steps

1. Detect the current project's `projectDir`, `buildCmd` (check CLAUDE.md, build.gradle, package.json, etc.)
2. Parse mode from user args: "interactive" → autoFix=false, otherwise autoFix=true
3. Create inputs JSON at `.a5c/processes/bug-hunter-inputs.json`
4. Invoke `babysitter:yolo` (autoFix=true) or `babysitter:call` (autoFix=false)
5. Let babysitter drive the entire flow

## What the Process Does

```
DETECT → SCAN (6 categories) → DEDUP → VERIFY (5-judge vote)
→ PROVE → [BREAKPOINT if interactive] → FIX (batches of 8, by severity)
→ REGRESSION CHECK → BUILD → [BREAKPOINT if interactive] → COMMIT (with bug IDs)
→ RE-SCAN (modified files only) → LOOP until clean or maxIterations → REPORT
```
