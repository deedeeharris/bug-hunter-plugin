---
name: bh
description: Use when asked to hunt bugs, find and fix bugs, audit code quality, or run /bh. Launches the generic/bug-hunter babysitter process on the current repo. Supports yolo (auto-fix) and interactive (breakpoints) modes.
---

# Bug Hunter

Scan any repo for bugs across 6 categories, verify with 5-judge majority vote, deduplicate, prove, fix in batches, regression-check, commit, and re-scan until clean.

## CRITICAL RULES — BABYSITTER ENFORCEMENT

**You MUST use babysitter orchestration for the ENTIRE run. This is NON-NEGOTIABLE.**

- Do NOT execute any bug hunting phase yourself — not scan, not verify, not fix, not commit
- Do NOT skip babysitter because "it's simpler to just do it"
- Do NOT rationalize bypassing orchestration for any reason
- Do NOT execute agent tasks directly after receiving scan results — post them back via task:post and let babysitter dispatch the next phase
- If babysitter setup fails, fix the setup — do NOT fall back to manual execution
- After EVERY task:post, STOP the session. The hook will call you back for the next phase.

### Short-Circuit Detection

If you find yourself doing ANY of these, you are short-circuiting babysitter. STOP and correct course:

| What you're doing | What you SHOULD do |
|---|---|
| Running an Agent to scan AND then running another Agent to verify in the same session | Post scan results via task:post, STOP. Babysitter dispatches verify on next iteration. |
| Fixing bugs directly after seeing scan results | Post scan results via task:post, STOP. Let babysitter drive dedup -> verify -> prove -> fix pipeline. |
| Calling run:iterate, performing the task, AND calling run:iterate again in the same session | Perform ONE task, post result, STOP. Hook triggers next iteration. |
| Deciding "the remaining phases aren't needed" | ALL phases exist for a reason. The 5-judge vote catches false positives. Regression checks catch broken fixes. You cannot skip them. |
| "I'll just do the fixes quickly since I already have the results" | The process has dedup, 5-judge verify, prove, regression check, and build gates between scan and fix. Skipping them defeats the entire purpose. |

### The Rule: One Task Per Session

```
Session N:   run:iterate → get pending task → execute task → task:post → STOP
Session N+1: (hook calls you) → run:iterate → get pending task → execute task → task:post → STOP
Session N+2: (hook calls you) → run:iterate → ...
```

You NEVER execute more than one process phase per session. The babysitter journal records every phase transition. If a phase is missing from the journal, the process is broken.

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
| `fixConfidenceTarget` | 85 | Target confidence score (0-100) for fix correctness. See scoring guide below. |
| `maxFixAttempts` | 3 | Max re-fix attempts per batch if confidence is below target |

## Steps

1. Detect the current project's `projectDir`, `buildCmd` (check CLAUDE.md, build.gradle, package.json, etc.)
2. Parse mode from user args: "interactive" -> autoFix=false, otherwise autoFix=true
3. Create inputs JSON at `.a5c/processes/bug-hunter-inputs.json`
4. Invoke `babysitter:yolo` (autoFix=true) or `babysitter:call` (autoFix=false)
5. Let babysitter drive the ENTIRE flow — every phase is a separate babysitter task

## What the Process Does

```
DETECT -> SCAN (6 categories IN PARALLEL) -> DEDUP -> VERIFY (5-judge vote)
-> PROVE -> [BREAKPOINT if interactive]
-> FIX (batches of 8, by severity) -> SCORE FIX CONFIDENCE (4-dimension)
   -> [if confidence < target: RE-FIX with feedback, up to maxFixAttempts]
   -> [if plateau detected: accept or breakpoint]
-> REGRESSION CHECK + COMPILE GATE (parallel)
-> BUILD+TEST (hard shell gate) -> [BREAKPOINT if interactive]
-> COMMIT (with bug IDs) -> RE-SCAN (modified files only)
-> LOOP until clean or maxIterations -> REPORT (with confidence scores)
```

Each arrow (`->`) is a separate babysitter task. Each task is dispatched by babysitter, executed by you, and posted back via `task:post`. You never skip ahead.

## Fix Confidence Scoring

After each fix batch, an agent scores every fix across 4 dimensions:

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Root Cause Match | 40% | Does the fix address the exact proven root cause, not just a symptom? |
| Completeness | 25% | Are all code paths where the bug manifests covered? |
| Correctness | 20% | Is the fix itself correct? No new logic errors? |
| Safety | 15% | Could the fix break callers or change public API? |

### When to Use Which Target

| Target | When | Use Case |
|--------|------|----------|
| **70** | Quick scans, low-risk internal tools | "Fix the obvious stuff" |
| **80** | Standard development, most repos | "Good enough for a PR" |
| **85** | **Default** — production code, typical audits | "Confident the fixes are correct" |
| **90** | Security-critical, payment systems, compliance | "High assurance" |
| **95** | Rarely — beware of plateaus and diminishing returns | Only if every fix MUST be perfect |

### Convergence Behavior

- If overall confidence >= target after first attempt: move on (no re-fix needed)
- If below target: low-confidence fixes are fed back as specific feedback to the next attempt
- If improvement plateaus (< 5 points between attempts): accept and move on (yolo) or breakpoint (interactive)
- Max attempts prevents infinite loops (default: 3)
