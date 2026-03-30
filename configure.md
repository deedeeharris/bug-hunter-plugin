# Bug Hunter — Configuration

## Configurable Options

The bug-hunter process accepts these inputs which can be set per-run or as defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `maxIterations` | 3 | Max scan-fix-rescan cycles before stopping |
| `maxBatchSize` | 8 | Max bugs fixed per batch (smaller = more reliable) |
| `categories` | all 6 | Which categories to scan: logic, security, memory-lifecycle, error-handling, performance, thread-safety |
| `buildCmd` | auto-detect | Override the build command |
| `testCmd` | auto-detect | Override the test command |

## Changing Defaults

Edit `~/.a5c/processes/bug-hunter.js` and modify the defaults at the top of the `process` function:

```javascript
const {
  maxIterations = 5,        // change from 3 to 5
  maxBatchSize = DEFAULT_MAX_BATCH,  // change DEFAULT_MAX_BATCH constant
  categories = ALL_CATEGORIES,
} = inputs;
```

## Per-Project Overrides

Create a project-specific inputs file at `.a5c/processes/bug-hunter-inputs.json`:

```json
{
  "projectDir": "/path/to/repo",
  "buildCmd": "make build",
  "testCmd": "make test",
  "maxIterations": 5,
  "maxBatchSize": 5,
  "categories": ["logic", "security", "thread-safety"]
}
```

## Disabling Categories

To skip certain scan categories, set `categories` to only the ones you want:

```json
{
  "categories": ["logic", "security"]
}
```
