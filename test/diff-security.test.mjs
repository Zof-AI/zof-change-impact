import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseDiff } from '../dist/index.js';

const change = path => ({ path, status: 'modified', addedLines: 0, deletedLines: 0, ranges: [] });

test('Git headers preserve every quoted/unquoted pairing and unquoted spaces', () => {
  for (const [left, right] of [
    ['a/old file.ts', 'b/new file.ts'],
    ['"a/old file.ts"', '"b/new file.ts"'],
    ['"a/old file.ts"', 'b/new file.ts'],
    ['a/old file.ts', '"b/new file.ts"'],
  ]) assert.deepEqual(parseDiff(`diff --git ${left} ${right}\n`), [change('new file.ts')]);
  // Keep the existing first-valid-separator interpretation of ambiguous spaces.
  assert.deepEqual(parseDiff('diff --git a/old b/name b/new.ts\n'), [change('name b/new.ts')]);
});

test('Git quoting preserves escaped quotes and octal UTF-8 in paths', () => {
  const encoded = 'dir/\\346\\226\\207\\"file.ts';
  assert.deepEqual(parseDiff(`diff --git "a/${encoded}" "b/${encoded}"\n`), [change('dir/文"file.ts')]);
  assert.deepEqual(parseDiff('diff --git a/old.ts "b/name\u2028file.ts"\n'), [change('name\u2028file.ts')]);
});

test('quoted rename metadata and following hunks preserve old and new names and line ranges', () => {
  const diff = 'diff --git "a/old\\" name.ts" "b/\\346\\226\\207 name.ts"\n'
    + 'similarity index 50%\nrename from "old\\" name.ts"\nrename to "\\346\\226\\207 name.ts"\n'
    + '--- "a/old\\" name.ts"\n+++ "b/\\346\\226\\207 name.ts"\n@@ -2,2 +2,3 @@\n same\n-old\n+new\n+extra\n';
  assert.deepEqual(parseDiff(diff), [{ path: '文 name.ts', previousPath: 'old" name.ts', status: 'renamed', addedLines: 2, deletedLines: 1, ranges: [{ start: 2, end: 4 }] }]);
});

test('fully octal-escaped UTF-8 paths retain the existing 4,096-character contract', () => {
  const encoded = '\\346\\226\\207'.repeat(4096);
  const header = `diff --git "a/${encoded}" "b/${encoded}"\n`;
  assert.ok(Buffer.byteLength(header) > 96 * 1024);
  assert.ok(Buffer.byteLength(header) < 128 * 1024);
  assert.deepEqual(parseDiff(header), [change('文'.repeat(4096))]);
  assert.throws(() => parseDiff(`diff --git a/old.ts b/${'x'.repeat(4097)}\n`), /Invalid repository-relative path/);
  assert.throws(() => parseDiff(`diff --git a/${'x'.repeat(4097)} b/new.ts\n`), /Invalid repository-relative path/);
});

test('both header paths reject unsafe names, malformed quoting and unknown escapes', () => {
  for (const raw of [
    'a/../escape b/new.ts', '"a/../escape" "b/new.ts"',
    '"a/old.ts"" "b/new.ts"', '"a/old.ts" "b/new.ts" extra',
    'a/old.ts "b/new.ts', 'a/old.ts "b/new\\q.ts"',
    'a/old.ts "b/new\\012name.ts"', 'a/old.ts b/new\rname.ts',
    'a/old.ts b/new\u2028name.ts', 'a/old.ts b/new\u2029name.ts',
  ]) assert.throws(() => parseDiff(`diff --git ${raw}\n`), /Malformed|Invalid/);
});

test('header byte ceiling is enforced independently of the whole-diff limit without echoing input', () => {
  const marker = 'SYNTHETIC_HEADER_CONTENT';
  const inputs = [
    `diff --git a/${marker} b/${'x'.repeat(128 * 1024)}\n`,
    `diff --git a/${marker} "b/${'文'.repeat(45000)}"\n`,
  ];
  assert.ok(inputs[1].length < 128 * 1024); // Byte ceiling, not only UTF-16 length.
  for (const input of inputs) {
    assert.ok(Buffer.byteLength(input) < 16 * 1024 * 1024);
    assert.throws(() => parseDiff(input), error => error.message === 'Git diff header exceeds supported input limits' && !error.message.includes(marker));
  }
});

test('malformed separator-heavy headers below the ceiling complete within a bounded child deadline', () => {
  const moduleUrl = new URL('../dist/diff.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { parseDiff } from ${JSON.stringify(moduleUrl)};
    for (const suffix of ['\\rX', '\\u2028X', '\\u2029X']) {
      const header = 'diff --git a/"" b/' + ' b/'.repeat(32000) + suffix;
      assert.ok(Buffer.byteLength(header) < 128 * 1024);
      for (let i = 0; i < 16; i++) {
        assert.throws(() => parseDiff(header), error => error.message === 'Malformed Git diff header');
      }
    }
    process.stdout.write('bounded parser passed');
  `], { encoding: 'utf8', timeout: 4000, killSignal: 'SIGKILL', maxBuffer: 2048 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'bounded parser passed');
});
