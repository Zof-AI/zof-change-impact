# @zof-ai/change-impact

Local static change-impact analysis for TypeScript, JavaScript and Python. It identifies changed files, conventional import edges, transitive consumers and likely affected tests. It never executes analyzed source, sends telemetry, uploads code or contacts hosted services.

This is an unreleased candidate. Registry namespace, repository URLs and Apache-2.0 licensing require owner approval. The links in package metadata are intended release locations; they do not establish publication.

## Start locally

Requires Node.js 22 or 24 and Git for revision analysis.

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --root examples/javascript --changed src/math.ts --json
```

The JavaScript example reports `src/math.ts`, `src/checkout.ts` and `tests/checkout.test.ts`. After an approved registry release, the executable name will be `zof-change-impact` and the candidate install command is `npm install --save-dev @zof-ai/change-impact`. Publication has not occurred.

## Three examples

```sh
# Known local TS imports: dependency-complete within the static model.
node dist/cli.js --root examples/javascript --changed src/math.ts
# Python local imports: useful edges, with an explicit lexical-analysis limitation.
node dist/cli.js --root examples/python --changed pkg/math.py --json
# Computed imports: incomplete; CI can demand completeness (exit 3).
node dist/cli.js --root examples/dynamic --changed loader.ts --json --require-complete
```

Use `--root . --base HEAD~1 --head HEAD` for a clean checkout comparison, or `--root .` to compare `HEAD` against the working tree, including untracked source files. `--base` may be a branch, tag or commit. A supplied head must match a clean checkout for complete dependency analysis. Git helpers, external diff, textconv, hooks and filesystem monitoring are disabled for subprocess operations. No shell is invoked. Paths with spaces are supported when quoted by the calling shell.

## API

```js
import { analyzeImpact, formatReport, parseDiff } from '@zof-ai/change-impact';
const report = await analyzeImpact({
  root: '/absolute/path/to/synthetic-repository',
  changedFiles: ['src/math.ts'],
  exclude: ['generated/**']
});
console.log(formatReport(report));
```

`analyzeImpact` returns `impact/v1`: `changes`, `files`, `dependencies`, `impactedFiles`, `affectedTests`, `changedSymbols`, `confidence`, `complete` and `limitations`. Entries and paths are sorted. `parseDiff(text)` accepts bounded Git unified diff strings and returns file changes with added/deleted counts and new-side line ranges. It does not retain source lines. `isTestFile(path)` exposes the conventional filename detector. Type declarations are included.

TypeScript's public AST recognizes static imports, re-exports, literal `require` and literal dynamic imports. Relative `.js` imports can resolve to `.ts`. Function/class/method declarations and function-valued variables intersecting changed lines are reported as changed symbols. Deleted symbols are not reconstructed. `changedFiles` bypasses Git and lacks line counts and symbol locations. Python uses a documented lexical import subset and always marks the report incomplete because full Python syntax and import-loader behavior are not validated.

`complete` describes completeness within the documented static model. It is never a test result. A successful CLI exit does not mean verification passed. No report guarantees regression coverage.

## Safety, configuration and limits

Default exclusions include `.git`, `node_modules`, `.venv`, `venv`, `dist`, `build` and `__pycache__`. Repeat `--exclude GLOB` for directory-prefix patterns supporting `*`, `?` and `**`. An excluded changed path triggers an incomplete report. Programmatic limits default to 5,000 files, 1 MiB per source, 32 MiB total source, 8 MiB Git diff output and depth 32; configured limits have hard ceilings. Python lexical lines have a fixed 8,192-character ceiling checked before pattern matching. An oversized line stops analysis of that file and produces `PYTHON_IMPORT_SIZE_LIMIT`, `complete: false` and a full-suite fallback warning. Git subprocesses time out after 15 seconds. XML and archives are never parsed; external artifact URLs are never fetched.

Escaping, absolute, control-character and Windows-style relative inputs are rejected. Symlinks and special files are not read. Errors and reports omit source snippets, raw logs, arbitrary environment values and Git stderr. Recognizable credentials and URL metadata are redacted. Redaction cannot identify every arbitrary secret; do not put secrets in paths or symbols. Operate on a stable checkout: filesystem changes by another process during a scan are outside this local tool's isolation boundary.

Unresolved imports, package aliases, computed imports, syntax errors, removed/renamed sources, unsupported changed files, resource limits and Python lexical analysis trigger `complete: false`. Package resolution supports conventional source extensions/index files; TypeScript path aliases, custom bundler loaders, Python search-path mutation, reflection, frameworks, runtime registries and implicit framework dependencies require a full-suite fallback. Declared npm packages and `node:` built-ins are external edges. Changes to configuration or dependency manifests are conservatively incomplete.

Exit codes: `0` report generated, `2` invalid input or operational failure, `3` incomplete report when `--require-complete` is requested. No tests are executed. Empty `affectedTests` means no test relationship was identified, not that no tests are needed.

## Development and release

```sh
npm test
npm pack --ignore-scripts
```

Tests include a real synthetic Git history, shared-function impact, cycles, Python dependencies, ambiguous imports, malicious paths, symlinks, bounds, redaction, and disabled Git helpers. Cross-platform CI is configured, but platform support is verified only by completed runs. See [security guidance](SECURITY.md) and [release procedure](docs/RELEASE.md). Release workflows build candidates only. Public release, maintained reporting channels, registry ownership and live installation checks remain external approval gates.
