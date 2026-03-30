/**
 * @process generic/bug-hunter
 * @description Generic bug hunter: scan any repo with parallel agents, 5-judge majority-vote verification, dedup, prove, fix (max 8/batch), regression check, commit with bug IDs, re-scan modified files only until done.
 * @inputs { projectDir: string, buildCmd?: string, testCmd?: string, maxIterations?: number, categories?: string[], maxBatchSize?: number, autoFix?: boolean }
 * @outputs { success: boolean, totalFound: number, falsePositives: number, verified: number, fixed: number, remaining: number, iterations: number }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const ALL_CATEGORIES = ['logic', 'security', 'memory-lifecycle', 'error-handling', 'performance', 'thread-safety'];
const DEFAULT_MAX_BATCH = 8;

// ==========================================================================
// MAIN PROCESS
// ==========================================================================

export async function process(inputs, ctx) {
  const {
    projectDir,
    buildCmd: buildCmdOverride,
    testCmd: testCmdOverride,
    maxIterations = 5,
    categories = ALL_CATEGORIES,
    maxBatchSize = DEFAULT_MAX_BATCH,
    autoFix = true,
  } = inputs;

  if (!projectDir) throw new Error('projectDir is required');

  // --- Phase 1: Detect project ---
  const projectInfo = await ctx.task(detectProjectTask, { projectDir, buildCmdOverride, testCmdOverride });
  const { buildCmd, testCmd, srcDirs } = projectInfo;

  let allFixedBugs = [];
  let allFalsePositives = [];
  let totalFound = 0;
  let iteration = 0;
  let modifiedFiles = []; // Track files changed by fixes for scoped re-scan

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    // --- Phase 2: Scan for bugs ---
    const scanResults = [];
    for (const category of categories) {
      const result = await ctx.task(scanBugsTask, {
        projectDir, srcDirs, category, iteration,
        // Improvement #5: Re-scan scoped to modified files only (after iteration 1)
        scopeToFiles: iteration > 1 ? modifiedFiles : null,
      });
      scanResults.push(result);
    }

    const rawFindings = scanResults.flat();
    if (rawFindings.length === 0) break;

    // --- Phase 2.5: Deduplicate findings by file+line --- (Improvement #2)
    const dedupResult = await ctx.task(deduplicateFindingsTask, { findings: rawFindings });
    const allFindings = dedupResult.unique || rawFindings;
    const duplicatesRemoved = dedupResult.duplicatesRemoved || 0;

    totalFound += allFindings.length;

    // --- Phase 3: Verify all findings with 5-judge majority vote (batched) ---
    const verificationResult = await ctx.task(verifyAllFindingsTask, { projectDir, findings: allFindings });
    const verifiedFindings = verificationResult.verified || [];
    const falsePositives = verificationResult.falsePositives || [];

    allFalsePositives.push(...falsePositives);

    if (verifiedFindings.length === 0) break;

    // --- Phase 4: Triage — sort by severity ---
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    verifiedFindings.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

    // --- Phase 5: Prove all bugs (batched) ---
    const proveResult = await ctx.task(proveAllBugsTask, { projectDir, bugs: verifiedFindings, testCmd });
    const provenBugs = proveResult.proven || [];
    const unproven = proveResult.unproven || [];
    allFalsePositives.push(...unproven.map(b => ({ ...b, reason: 'could not prove' })));

    if (provenBugs.length === 0) break;

    // --- Breakpoint: Review findings before fixing (interactive mode) ---
    if (!autoFix) {
      const reviewSummary = provenBugs.map(b => `[${b.severity}] ${b.id}: ${b.file} — ${b.title}`).join('\n');
      await ctx.breakpoint(`Found ${provenBugs.length} verified bugs to fix:\n\n${reviewSummary}\n\nProceed with fixes?`);
    }

    // --- Phase 6: Fix in batches by severity, max N per batch --- (Improvement #4)
    const batches = groupBySeverity(provenBugs, maxBatchSize);
    modifiedFiles = []; // Reset for this iteration

    for (const batch of batches) {
      // Breakpoint: Review each batch before fixing (interactive mode)
      if (!autoFix) {
        const batchSummary = batch.bugs.map(b => `  ${b.id}: ${b.file}:${b.line} — ${b.title}`).join('\n');
        await ctx.breakpoint(`About to fix ${batch.bugs.length} ${batch.severity}-severity bugs:\n\n${batchSummary}\n\nProceed?`);
      }

      // Fix
      const fixResult = await ctx.task(fixBatchTask, { projectDir, bugs: batch.bugs, severity: batch.severity });

      // Improvement #6: Regression check on the diff before building
      const regressionResult = await ctx.task(regressionCheckTask, {
        projectDir,
        filesModified: fixResult.filesModified || [],
        bugsFixed: fixResult.bugsFixed || [],
      });

      // If regressions found, fix them before building
      if (regressionResult.regressionsFound && regressionResult.regressions?.length > 0) {
        await ctx.task(fixRegressionTask, {
          projectDir,
          regressions: regressionResult.regressions,
          originalFixes: fixResult.bugsFixed || [],
        });
      }

      // Build + test
      const buildResult = await ctx.task(buildTestTask, { projectDir, buildCmd, testCmd, batchName: `${batch.severity} fixes` });

      // If build failed, attempt correction
      if (!buildResult.buildSuccess) {
        await ctx.task(fixBuildErrorsTask, { projectDir, errors: buildResult.errors, buildCmd, testCmd });
        const retryBuild = await ctx.task(buildTestTask, { projectDir, buildCmd, testCmd, batchName: `${batch.severity} fixes (retry)` });
        if (!retryBuild.buildSuccess) {
          await ctx.breakpoint(`Build failed after fixing ${batch.severity} bugs. Errors: ${JSON.stringify(retryBuild.errors)}. Continue?`);
        }
      }

      // Breakpoint: Review changes before committing (interactive mode)
      if (!autoFix) {
        await ctx.breakpoint(`Build passed for ${batch.severity} fixes. Commit these changes?`);
      }

      // Improvement #7: Commit with bug IDs
      const bugIds = (fixResult.bugsFixed || batch.bugs.map(b => b.id));
      await ctx.task(commitBatchTask, { projectDir, severity: batch.severity, fixResult, bugIds });

      // Track modified files for scoped re-scan
      modifiedFiles.push(...(fixResult.filesModified || []));
      allFixedBugs.push(...batch.bugs);
    }

    // Deduplicate modified files list
    modifiedFiles = [...new Set(modifiedFiles)];
  }

  // --- Final report ---
  const report = await ctx.task(finalReportTask, {
    projectDir,
    totalFound,
    falsePositives: allFalsePositives.length,
    verified: totalFound - allFalsePositives.length,
    fixed: allFixedBugs.length,
    remaining: (totalFound - allFalsePositives.length) - allFixedBugs.length,
    iterations: iteration,
    fixedBugs: allFixedBugs,
    falsePositivesList: allFalsePositives,
  });

  return {
    success: true,
    totalFound,
    falsePositives: allFalsePositives.length,
    verified: totalFound - allFalsePositives.length,
    fixed: allFixedBugs.length,
    remaining: (totalFound - allFalsePositives.length) - allFixedBugs.length,
    iterations: iteration,
  };
}

// ==========================================================================
// HELPERS
// ==========================================================================

// Improvement #4: Split large batches into chunks of maxBatchSize, grouped by file affinity
function groupBySeverity(bugs, maxBatchSize) {
  const groups = {};
  for (const bug of bugs) {
    const sev = bug.severity || 'medium';
    if (!groups[sev]) groups[sev] = [];
    groups[sev].push(bug);
  }
  const order = ['critical', 'high', 'medium', 'low'];
  const batches = [];
  for (const sev of order) {
    if (!groups[sev]?.length) continue;
    // Sort by file to group related fixes together
    const sorted = groups[sev].sort((a, b) => (a.file || '').localeCompare(b.file || ''));
    // Split into chunks of maxBatchSize
    for (let i = 0; i < sorted.length; i += maxBatchSize) {
      batches.push({ severity: sev, bugs: sorted.slice(i, i + maxBatchSize) });
    }
  }
  return batches;
}

// ==========================================================================
// TASK DEFINITIONS
// ==========================================================================

export const detectProjectTask = defineTask('detect-project', (args) => ({
  kind: 'agent',
  title: 'Detect project language, build, and test commands',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'DevOps engineer analyzing a repository',
      task: `Detect the project type, language, framework, build command, test command, and source directories for the repo at ${args.projectDir}.`,
      instructions: [
        `Read the repo root at ${args.projectDir}. Look for:`,
        '- package.json (Node.js/JS/TS) → npm/yarn/pnpm build/test',
        '- build.gradle or build.gradle.kts (Android/Java/Kotlin) → ./gradlew assembleDebug / ./gradlew test',
        '- Cargo.toml (Rust) → cargo build / cargo test',
        '- go.mod (Go) → go build ./... / go test ./...',
        '- pyproject.toml or setup.py (Python) → pip install / pytest',
        '- Makefile → make / make test',
        '- CMakeLists.txt (C/C++) → cmake --build / ctest',
        '',
        'Also identify the main source directories (e.g., src/, app/src/main/, lib/).',
        '',
        args.buildCmdOverride ? `User override for buildCmd: ${args.buildCmdOverride}` : 'No buildCmd override — auto-detect.',
        args.testCmdOverride ? `User override for testCmd: ${args.testCmdOverride}` : 'No testCmd override — auto-detect. If no test framework found, set testCmd to null.',
        '',
        'Return ONLY JSON:',
        '{"language": "...", "framework": "...", "buildCmd": "...", "testCmd": "..." or null, "srcDirs": ["..."], "testDirs": ["..."]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

const CATEGORY_PROMPTS = {
  'logic': {
    title: 'Logic bugs',
    description: 'Dead code paths, unreachable branches, off-by-one errors, null pointer dereferences, incorrect conditionals, missing return values, wrong operator usage, infinite loops, incorrect type coercions',
  },
  'security': {
    title: 'Security vulnerabilities',
    description: 'Injection (SQL, command, XSS), leaked secrets/API keys in code or logs, insecure storage, missing input validation, missing auth checks, insecure crypto, hardcoded credentials, path traversal',
  },
  'memory-lifecycle': {
    title: 'Memory and lifecycle bugs',
    description: 'Memory leaks, unclosed resources (streams, connections, cursors), missing cleanup in destructors/dispose/onDestroy, context leaks (Android), dangling references, circular references preventing GC',
  },
  'error-handling': {
    title: 'Error handling bugs',
    description: 'Swallowed exceptions (empty catch blocks), missing error propagation, missing fallbacks for nullable returns, unhandled promise rejections, crash paths from uncaught exceptions, incorrect error types',
  },
  'performance': {
    title: 'Performance bugs',
    description: 'Unnecessary object allocations in hot paths, blocking main/UI thread with IO or computation, N+1 query patterns, redundant re-renders, missing caching for expensive operations, unbounded collection growth',
  },
  'thread-safety': {
    title: 'Thread safety bugs',
    description: 'Missing synchronization on shared mutable state, race conditions, non-atomic check-then-act patterns, unsafe lazy initialization, deadlock potential, incorrect volatile/atomic usage, thread-unsafe collections',
  },
};

export const scanBugsTask = defineTask('scan-bugs', (args) => ({
  kind: 'agent',
  title: `Scan: ${CATEGORY_PROMPTS[args.category]?.title || args.category} (iteration ${args.iteration})`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: `Senior software engineer specializing in ${CATEGORY_PROMPTS[args.category]?.title || args.category} detection`,
      task: `Scan the codebase at ${args.projectDir} for ${CATEGORY_PROMPTS[args.category]?.title || args.category}.`,
      instructions: [
        `You are scanning for: ${CATEGORY_PROMPTS[args.category]?.description || args.category}`,
        '',
        `Source directories to scan: ${JSON.stringify(args.srcDirs || [])}`,
        `Project root: ${args.projectDir}`,
        '',
        // Improvement #5: Scoped re-scan
        ...(args.scopeToFiles?.length > 0 ? [
          'IMPORTANT: This is a RE-SCAN after fixes. Only scan these modified files for NEW bugs or regressions:',
          JSON.stringify(args.scopeToFiles),
          'Do NOT re-report previously fixed bugs. Focus on bugs introduced by recent changes.',
          '',
        ] : []),
        'INSTRUCTIONS:',
        args.scopeToFiles?.length > 0
          ? '1. Read only the modified files listed above.'
          : '1. Read every source file in the source directories.',
        '2. For each potential bug, record it with exact file path and line number.',
        '3. Assign severity: critical, high, medium, or low.',
        '4. Be thorough but precise — report only things that are actually likely bugs, not style preferences.',
        '5. Do NOT report: style issues, naming conventions, missing comments, missing types/annotations, formatting.',
        '6. DO report: actual bugs that could cause crashes, data loss, security issues, or incorrect behavior.',
        '',
        'Return ONLY a JSON array:',
        '[{"id": "category-N", "file": "path/to/file.ext", "line": N, "category": "' + args.category + '", "severity": "critical|high|medium|low", "title": "short title", "description": "detailed description of the bug and why it matters"}]',
        '',
        'Return [] if no bugs found.',
      ],
      outputFormat: 'JSON array',
    },
  },
}));

// Improvement #2: Deduplication task
export const deduplicateFindingsTask = defineTask('deduplicate-findings', (args) => ({
  kind: 'agent',
  title: `Deduplicate ${args.findings.length} findings`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior engineer deduplicating bug reports',
      task: `Deduplicate ${args.findings.length} bug findings. Merge findings that refer to the same underlying issue (same file+line or same root cause).`,
      instructions: [
        'You have findings from multiple category scanners that may overlap.',
        'Two findings are duplicates if they:',
        '- Point to the same file and same/adjacent lines AND describe the same underlying issue',
        '- Describe the same root cause from different category perspectives (e.g., a race condition reported as both "logic" and "thread-safety")',
        '',
        'When merging duplicates:',
        '- Keep the one with the highest severity',
        '- Combine categories into a comma-separated list (e.g., "logic, thread-safety")',
        '- Use the most descriptive title and description',
        '',
        'FINDINGS:',
        JSON.stringify(args.findings, null, 2),
        '',
        'Return ONLY JSON:',
        '{"unique": [<deduplicated findings array>], "duplicatesRemoved": <count of duplicates removed>, "mergeLog": [<"merged X into Y" descriptions>]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

export const verifyAllFindingsTask = defineTask('verify-all-findings', (args) => ({
  kind: 'agent',
  title: `Verify ${args.findings.length} findings with 5-judge majority vote`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Panel of 5 independent senior code reviewers performing majority-vote bug verification',
      task: `For each of the ${args.findings.length} reported bugs, simulate 5 independent judges. Each judge independently evaluates whether the bug is real. A finding passes if 3+ judges vote "real".`,
      instructions: [
        'You are simulating a panel of 5 independent code reviewers.',
        '',
        'FOR EACH FINDING:',
        '1. Read the actual source file at the reported location',
        '2. Evaluate from 5 different perspectives (optimistic, pessimistic, practical, security-focused, architecture-focused)',
        '3. Each perspective votes independently: is this a real bug?',
        '4. Count votes: ≥3 "real" = verified bug, <3 = false positive',
        '',
        `Project root: ${args.projectDir}`,
        '',
        'BE SKEPTICAL. Many findings are false positives because:',
        '- The issue is handled by a caller or wrapper',
        '- The code path is unreachable in practice',
        '- The framework/language provides built-in safety',
        '- The "bug" is actually intentional behavior',
        '',
        'FINDINGS TO VERIFY:',
        JSON.stringify(args.findings, null, 2),
        '',
        'For each finding, read the source file and evaluate.',
        '',
        'Return ONLY JSON (no markdown):',
        '{"verified": [<findings that got >=3/5 votes, with added "votes" field>], "falsePositives": [<findings that got <3/5 votes, with added "votes" and "reason" fields>]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

export const proveAllBugsTask = defineTask('prove-all-bugs', (args) => ({
  kind: 'agent',
  title: `Prove ${args.bugs.length} verified bugs`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'QA engineer creating concrete proof for verified bugs',
      task: `For each of the ${args.bugs.length} verified bugs, determine if it can be proven with a concrete reproduction scenario.`,
      instructions: [
        `Project: ${args.projectDir}`,
        args.testCmd ? `Test command: ${args.testCmd}` : 'No test framework detected.',
        '',
        'For each bug, read the source file and determine:',
        '1. Can you trace a concrete code path that triggers this bug?',
        '2. What is the exact scenario (input/state) that causes the problem?',
        '3. What is the expected vs actual behavior?',
        '',
        'If after investigation a bug turns out NOT to be real, mark it as unproven.',
        '',
        'BUGS TO PROVE:',
        JSON.stringify(args.bugs, null, 2),
        '',
        'Return ONLY JSON (no markdown):',
        '{"proven": [<bugs that were proven with added "proof" field describing the repro scenario>], "unproven": [<bugs that could not be proven with added "reason" field>]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

export const fixBatchTask = defineTask('fix-batch', (args) => ({
  kind: 'agent',
  title: `Fix ${args.severity} bugs (${args.bugs.length} issues)`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior software engineer fixing verified bugs',
      task: `Fix all ${args.severity}-severity verified bugs in ${args.projectDir}.`,
      instructions: [
        `Fix ALL ${args.bugs.length} bugs listed below. Read each file FULLY before editing. Make surgical edits — do not rewrite entire files.`,
        '',
        'BUGS TO FIX:',
        ...args.bugs.map((b, i) =>
          `${i + 1}. [${b.id}] [${b.category}] ${b.file}:${b.line} — ${b.title}\n   ${b.description}`
        ),
        '',
        'RULES:',
        '- Fix only the reported bug, do not refactor surrounding code',
        '- Preserve existing code style and conventions',
        '- If a fix requires adding an import, add it',
        '- If a fix could break callers, note it in the response',
        '',
        'Return ONLY JSON:',
        '{"filesModified": ["..."], "fixesMade": ["short description per fix"], "bugsFixed": ["bug ids"]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

// Improvement #6: Regression check after each fix batch
export const regressionCheckTask = defineTask('regression-check', (args) => ({
  kind: 'agent',
  title: `Regression check on ${args.filesModified?.length || 0} modified files`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior code reviewer checking for regressions introduced by bug fixes',
      task: 'Review the diff of recently modified files to check if the bug fixes introduced any new issues.',
      instructions: [
        `Project: ${args.projectDir}`,
        '',
        'FILES MODIFIED BY RECENT FIXES:',
        JSON.stringify(args.filesModified),
        '',
        'BUGS THAT WERE FIXED:',
        JSON.stringify(args.bugsFixed),
        '',
        'YOUR TASK:',
        '1. Read each modified file',
        '2. Look for issues INTRODUCED by the fixes:',
        '   - Missing null checks added by the fix',
        '   - Resource leaks in new code paths (e.g., recycle() added in one path but missed in another)',
        '   - Changed method signatures that break callers',
        '   - Logic errors in the fix itself (e.g., wrong condition, off-by-one)',
        '   - Thread safety issues in new synchronization code',
        '3. Do NOT re-report the original bugs that were just fixed',
        '4. Only report issues that are clearly caused by the fix changes',
        '',
        'Return ONLY JSON:',
        '{"regressionsFound": true/false, "regressions": [{"file": "...", "line": N, "title": "...", "description": "...", "causedBy": "which bug fix caused this"}]}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

// Fix regressions found by the regression check
export const fixRegressionTask = defineTask('fix-regression', (args) => ({
  kind: 'agent',
  title: `Fix ${args.regressions.length} regressions`,
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior developer fixing regressions introduced by bug fixes',
      task: `Fix regressions found in the recent bug fix batch.`,
      instructions: [
        `Project: ${args.projectDir}`,
        '',
        'REGRESSIONS TO FIX:',
        JSON.stringify(args.regressions, null, 2),
        '',
        'These were introduced by fixes for: ' + JSON.stringify(args.originalFixes),
        '',
        'Fix each regression without reverting the original bug fix.',
        'Make surgical edits only.',
        '',
        'Return ONLY JSON:',
        '{"filesModified": ["..."], "fixesMade": ["..."], "regressionsFixed": true}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

export const buildTestTask = defineTask('build-test', (args) => ({
  kind: 'shell',
  title: `Build + Test: ${args.batchName}`,
  shell: {
    command: [
      args.buildCmd,
      args.testCmd ? `&& ${args.testCmd}` : '',
    ].filter(Boolean).join(' '),
    cwd: args.projectDir,
    timeout: 600000,
  },
}));

export const fixBuildErrorsTask = defineTask('fix-build-errors', (args) => ({
  kind: 'agent',
  title: 'Fix build/test errors',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Senior developer fixing build errors',
      task: `The build or tests failed after applying bug fixes. Fix the errors.`,
      instructions: [
        `Project: ${args.projectDir}`,
        '',
        'BUILD/TEST ERRORS:',
        JSON.stringify(args.errors),
        '',
        'Fix the compilation or test errors caused by the bug fixes.',
        'Do NOT revert the bug fixes — fix them so they compile and tests pass.',
        '',
        `Verify with: ${args.buildCmd}`,
        args.testCmd ? `Then run: ${args.testCmd}` : '',
        '',
        'Return ONLY JSON:',
        '{"filesModified": ["..."], "fixesMade": ["..."], "buildSuccess": true/false}',
      ],
      outputFormat: 'JSON',
    },
  },
}));

// Improvement #7: Commit with bug IDs
export const commitBatchTask = defineTask('commit-batch', (args) => ({
  kind: 'shell',
  title: `Commit: ${args.severity} fixes`,
  shell: {
    command: [
      `cd ${args.projectDir}`,
      `&& git add -A`,
      `&& git commit -m "fix(${args.severity}): [${(args.bugIds || []).join(', ')}] ${(args.fixResult?.fixesMade || []).slice(0, 3).join(', ')}"`,
    ].join(' '),
    cwd: args.projectDir,
    timeout: 30000,
  },
}));

export const finalReportTask = defineTask('final-report', (args) => ({
  kind: 'agent',
  title: 'Generate final bug hunt report',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'Technical writer summarizing a bug hunting session',
      task: 'Generate a concise final report of the bug hunting session.',
      instructions: [
        `Project: ${args.projectDir}`,
        `Iterations: ${args.iterations}`,
        `Total findings: ${args.totalFound}`,
        `False positives removed: ${args.falsePositives}`,
        `Verified bugs: ${args.verified}`,
        `Fixed: ${args.fixed}`,
        `Remaining: ${args.remaining}`,
        '',
        'FIXED BUGS:',
        JSON.stringify(args.fixedBugs?.map(b => ({ id: b.id, title: b.title, file: b.file, severity: b.severity, category: b.category })) || []),
        '',
        'FALSE POSITIVES (discarded):',
        JSON.stringify(args.falsePositivesList?.map(b => ({ id: b.id, title: b.title, file: b.file, votes: b.votes, reason: b.reason })) || []),
        '',
        'Write a clean markdown report with:',
        '1. Summary stats table',
        '2. Fixed bugs grouped by severity with bug IDs',
        '3. False positives that were correctly filtered',
        '4. Any remaining issues',
        '5. Recommendations',
        '',
        'Save the report to: ' + args.projectDir + '/BUG-HUNT-REPORT.md',
        '',
        'Return ONLY JSON: {"reportPath": "...", "summary": "one-line summary"}',
      ],
      outputFormat: 'JSON',
    },
  },
}));
