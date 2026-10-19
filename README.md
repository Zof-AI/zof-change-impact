# @zof-ai/change-impact

Local static change-impact analysis for TypeScript, JavaScript and Python. It identifies changed files, conventional import edges, transitive consumers and likely affected tests. It never executes analyzed source, sends telemetry, uploads code or contacts hosted services.

Version 0.1.0 is prepared under the Apache-2.0 license. Use the GitHub source installation below; npm registry publication is not claimed.

<!-- ZOF_RELEASE_INSTALL_START -->
## Install from GitHub source

Requires Node.js 22 or 24, npm, and Git. Filesystem operations require Linux or macOS with Python 3.10 or newer; Windows file operations fail closed. Clone this repository and explicitly prepare its reviewed release dependencies:

```sh
git clone https://github.com/Zof-AI/zof-change-impact.git
cd zof-change-impact
node scripts/bootstrap.mjs --allow-network
npm ci --ignore-scripts --prefer-offline
npm run build
npm test
```

The bootstrap downloads only the exact `v0.1.0` dependency assets from [GitHub Releases](https://github.com/Zof-AI/zof-change-impact/releases), as listed in `scripts/release-dependencies.json`, verifies SHA256 and byte size, and adds them to the npm cache. It does not extract archives, run package scripts, collect application data, or send credentials. Downloads require the explicit flag and follow only HTTPS GitHub asset redirects. Installation then fetches ordinary third-party dependencies from npm. Use a writable npm cache; set `npm_config_cache` consistently for both commands if needed. An unavailable asset, changed hash, or oversized response stops installation.

GitHub source and release artifacts are the initial distribution channel. These instructions do not claim that `@zof-ai` packages are published on npm or that the VS Code extension is listed in Marketplace.
<!-- ZOF_RELEASE_INSTALL_END -->

## Start locally

Requires Node.js 22 or 24 and Git for revision analysis.

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --root examples/javascript --changed src/math.ts --json
```

The JavaScript example reports `src/math.ts`, `src/checkout.ts` and `tests/checkout.test.ts`. The built executable is `zof-change-impact`; use the source installation above. npm registry publication remains separate from GitHub distribution.

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

Escaping, absolute, control-character and Windows-style relative inputs are rejected. Symlinks and special files are not read. Errors and reports omit source snippets, raw logs, arbitrary environment values and Git stderr. Recognizable credentials and URL metadata are redacted. Redaction cannot identify every arbitrary secret; do not put secrets in paths or symbols. Reads are anchored to directory descriptors. File contents can still change during capture, so reports are not atomic snapshots.

Unresolved imports, package aliases, computed imports, syntax errors, removed/renamed sources, unsupported changed files, resource limits and Python lexical analysis trigger `complete: false`. Package resolution supports conventional source extensions/index files; TypeScript path aliases, custom bundler loaders, Python search-path mutation, reflection, frameworks, runtime registries and implicit framework dependencies require a full-suite fallback. Declared npm packages and `node:` built-ins are external edges. Changes to configuration or dependency manifests are conservatively incomplete.

Exit codes: `0` report generated, `2` invalid input or operational failure, `3` incomplete report when `--require-complete` is requested. No tests are executed. Empty `affectedTests` means no test relationship was identified, not that no tests are needed.

## Development and release

```sh
npm test
npm pack --ignore-scripts
```

Tests include a real synthetic Git history, shared-function impact, cycles, Python dependencies, ambiguous imports, malicious paths, symlinks, bounds, redaction, and disabled Git helpers. Cross-platform CI is configured, but platform support is verified only by completed runs. See [security guidance](SECURITY.md) and [release procedure](docs/RELEASE.md). Release workflows build candidates only. GitHub Releases carry versioned artifacts; npm registry ownership and registry installation remain separate from source distribution.

## Filesystem and Git boundaries

Filesystem operations use bounded, directory-relative descriptors on Linux/macOS with Python 3.10 or newer. Symlinks, hard-linked inputs, special files and traversal are rejected. Open descriptors remain attached to the original directory when names change. File contents can still change during a read or snapshot; this is not an atomic filesystem snapshot. Windows filesystem operations fail closed; in-memory JSON validation and analysis do not require the file helper. Git reads use a private bounded snapshot: 256 MiB total, 32 MiB per source/object file, 50,000 entries and 64 directory levels. Repository hooks/configuration are not used; local `.git/info/exclude` and `.git/info/attributes` are preserved. External Git metadata, object alternates, grafts, sparse-checkout metadata, linked worktrees and submodules are unsupported. Limits and unsupported metadata cause an explicit error or incomplete result.
