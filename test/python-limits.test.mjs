import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeImpact } from '../dist/index.js';

for (const [form, prefix] of [['direct', 'import a'], ['from', 'from x import a']]) {
  test(`oversized ${form} Python import remains conservative within the 4 MiB file limit`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'zof-python-limit-'));
    try {
      // The invalid suffix forces the import-list regex to unwind deeply without
      // the lexical line bound. Keep this input below the configured file limit.
      const source = prefix + ',a'.repeat(2097130) + '!\nimport sentinel\n';
      const maxFileBytes = 4 * 1024 * 1024;
      assert.ok(Buffer.byteLength(source) < maxFileBytes);
      await writeFile(join(root, 'example.py'), source);
      await writeFile(join(root, 'sentinel.py'), 'answer = 42\n');
      const report = await analyzeImpact({ root, changedFiles: ['example.py'], limits: { maxFileBytes } });
      assert.equal(report.complete, false);
      assert.equal(report.confidence, 'low');
      assert.ok(report.impactedFiles.includes('example.py'));
      assert.ok(report.limitations.some(item => item.code === 'PYTHON_IMPORT_SIZE_LIMIT' && item.file === 'example.py'));
      assert.ok(!report.limitations.some(item => item.code === 'UNREADABLE_SOURCE'));
      assert.deepEqual(report.dependencies.find(item => item.file === 'example.py').imports, []);
      assert.ok(!JSON.stringify(report).includes(prefix + ',a'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('Python imports at the lexical line limit retain local dependency edges', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zof-python-boundary-'));
  try {
    const source = 'import a' + ',a'.repeat(4092);
    assert.equal(source.length, 8192);
    await writeFile(join(root, 'example.py'), source);
    await writeFile(join(root, 'a.py'), 'answer = 42\n');
    const report = await analyzeImpact({ root, changedFiles: ['a.py'] });
    assert.ok(report.impactedFiles.includes('example.py'));
    assert.deepEqual(report.dependencies.find(item => item.file === 'example.py').imports, ['a.py']);
    assert.ok(!report.limitations.some(item => item.code === 'PYTHON_IMPORT_SIZE_LIMIT'));
    assert.equal(report.complete, false); // Existing Python lexical uncertainty remains explicit.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
