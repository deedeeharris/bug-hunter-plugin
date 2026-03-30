# Bug Hunter — Installation

## Prerequisites

- Claude Code CLI installed
- Babysitter SDK installed globally (`npm i -g @a5c-ai/babysitter-sdk`)
- Git available

## Installation Steps

### 1. Create skill directory

```bash
mkdir -p ~/.claude/skills/bh
```

### 2. Create the /bh skill file

Write the following content to `~/.claude/skills/bh/SKILL.md`:

```markdown
---
name: bh
description: Use when asked to hunt bugs, find and fix bugs, audit code quality, or run /bh. Launches the generic/bug-hunter babysitter process in yolo mode on the current repo.
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

## How to Run

Invoke the `babysitter:yolo` skill with the bug-hunter process:

    /babysitter:yolo Run the generic/bug-hunter process.
      Process file: ~/.a5c/processes/bug-hunter.js
      Inputs: projectDir=<current working directory>,
      buildCmd=<auto-detect or from CLAUDE.md>,
      maxIterations=3

## Process Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `projectDir` | CWD | Path to the repo root |
| `buildCmd` | auto-detect | Override build command |
| `testCmd` | auto-detect | Override test command |
| `maxIterations` | 3 | Max scan-fix-rescan cycles |
| `maxBatchSize` | 8 | Max bugs per fix batch |
| `categories` | all 6 | Which bug categories to scan |

## Steps

1. Detect the current project's `projectDir`, `buildCmd` (check CLAUDE.md, build.gradle, package.json, etc.)
2. Create inputs JSON at `.a5c/processes/bug-hunter-inputs.json`
3. Invoke `babysitter:yolo` with the process entry and inputs
4. Let babysitter drive the entire flow autonomously

## What the Process Does

    DETECT → SCAN (6 categories) → DEDUP → VERIFY (5-judge vote)
    → PROVE → FIX (batches of 8, by severity) → REGRESSION CHECK
    → BUILD → COMMIT (with bug IDs) → RE-SCAN (modified files only)
    → LOOP until clean or maxIterations → REPORT
```

### 3. Create process directory

```bash
mkdir -p ~/.a5c/processes
```

### 4. Create the bug-hunter process file

Write the content of `bug-hunter.js` to `~/.a5c/processes/bug-hunter.js`.

The process file is bundled with this plugin at `process/bug-hunter.js`. Copy it:

```bash
cp <plugin-package-dir>/process/bug-hunter.js ~/.a5c/processes/bug-hunter.js
```

### 5. Install babysitter SDK in any project that will use it

For each project where you'll run /bh, ensure the SDK is available:

```bash
cd <project-dir>
mkdir -p .a5c
npm i --prefix .a5c @a5c-ai/babysitter-sdk@latest
```

### 6. Verify installation

1. Start a new Claude Code session in any git repo
2. Type `/bh`
3. The skill should appear and launch the bug-hunter babysitter process in yolo mode

## What Gets Installed

| File | Purpose |
|------|---------|
| `~/.claude/skills/bh/SKILL.md` | Registers `/bh` slash command in Claude Code |
| `~/.a5c/processes/bug-hunter.js` | Babysitter process definition (generic, works on any repo) |
