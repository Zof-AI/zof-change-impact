import type { DiffChange } from './types.js';
import { safePath } from './security.js';

function decodePath(raw: string): string {
  if (raw.startsWith('"')) {
    if (!raw.endsWith('"')) throw new Error('Malformed quoted diff path');
    const bytes: number[] = [];
    const body = raw.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== '\\') { const code = body.codePointAt(i)!; bytes.push(...Buffer.from(String.fromCodePoint(code))); if (code > 0xffff) i++; continue; }
      const octal = body.slice(i + 1).match(/^[0-7]{3}/)?.[0];
      if (octal) { bytes.push(parseInt(octal, 8)); i += 3; continue; }
      const escape = body[++i];
      const mapping: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, '\\': 92, '"': 34 };
      if (escape === undefined || mapping[escape] === undefined) throw new Error('Malformed diff path escape');
      bytes.push(mapping[escape]!);
    }
    return Buffer.from(bytes).toString('utf8');
  }
  return raw;
}
function filePath(raw: string, stripPrefix = true): string | undefined {
  let decoded = decodePath(raw);
  if (decoded === '/dev/null') return undefined;
  if (stripPrefix && /^(a|b)\//.test(decoded)) decoded = decoded.slice(2);
  return safePath(decoded);
}
export function parseDiff(text: string): DiffChange[] {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024 || text.includes('\0')) throw new Error('Diff exceeds supported input limits');
  const changes: DiffChange[] = [];
  let current: DiffChange | undefined;
  let hunkOld = 0; let hunkNew = 0;
  const finish = () => { if (hunkOld || hunkNew) throw new Error('Incomplete diff hunk'); if (current) changes.push(current); };
  for (const line of text.split('\n')) {
    if (hunkOld || hunkNew) {
      if (line.startsWith('\\ No newline at end of file')) continue;
      if (line.startsWith('+')) { if (hunkNew <= 0) throw new Error('Malformed diff hunk'); hunkNew--; current!.addedLines++; }
      else if (line.startsWith('-')) { if (hunkOld <= 0) throw new Error('Malformed diff hunk'); hunkOld--; current!.deletedLines++; }
      else if (line.startsWith(' ')) { if (hunkNew <= 0 || hunkOld <= 0) throw new Error('Malformed diff hunk'); hunkNew--; hunkOld--; }
      else throw new Error('Malformed diff hunk');
      continue;
    }
    if (line.startsWith('diff --git ')) {
      finish();
      if (changes.length >= 10000) throw new Error('Diff exceeds change count limit');
      const paths = line.slice(11).match(/^("(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/);
      if (!paths) throw new Error('Malformed Git diff header');
      const p = filePath(paths[2]!); if (!p) throw new Error('Malformed Git diff path');
      current = { path: p, status: 'modified', addedLines: 0, deletedLines: 0, ranges: [] }; continue;
    }
    if (!current) { if (line.trim()) throw new Error('Expected Git unified diff'); continue; }
    if (line.startsWith('new file mode ')) current.status = 'added';
    else if (line.startsWith('deleted file mode ')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) { current.previousPath = filePath(line.slice(12), false)!; current.status = 'renamed'; }
    else if (line.startsWith('rename to ')) current.path = filePath(line.slice(10), false)!;
    else if (line.startsWith('--- ')) { const previous = filePath(line.slice(4)); if (!previous) current.status = 'added'; else if (current.status === 'deleted') current.path = previous; }
    else if (line.startsWith('+++ ')) { const next = filePath(line.slice(4)); if (!next) current.status = 'deleted'; else current.path = next; }
    else if (line.startsWith('@@')) {
      const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!h) throw new Error('Malformed diff hunk header');
      hunkOld = Number(h[2] ?? 1); hunkNew = Number(h[4] ?? 1);
      const start = Number(h[3]);
      if ([hunkOld, hunkNew, start].some(n => !Number.isSafeInteger(n) || n > 10000000)) throw new Error('Diff range exceeds limits');
      current.ranges.push({ start: Math.max(1, start), end: Math.max(1, start + Math.max(1, hunkNew) - 1) });
    }
  }
  finish();
  return changes.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
