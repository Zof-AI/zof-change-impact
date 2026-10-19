import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
export function safePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Invalid repository-relative path');
  return value;
}
export function redact(value: string): string {
  return value.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[REDACTED_URL]')
    .replace(/\b(?:password|passwd|token|secret|api[_-]?key|authorization)[=:][^\s/]+/gi, '[REDACTED]');
}
export async function boundedRead(root: string, relative: string, maxBytes: number): Promise<string> {
  safePath(relative);
  const segments = relative.split('/');
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const s = await lstat(current);
    if (s.isSymbolicLink()) throw new Error('Symlink input is not permitted');
  }
  const resolved = await realpath(current);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Input escapes the repository root');
  const handle = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Input exceeds file size limit or is not a regular file');
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset <= maxBytes) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) throw new Error('Input exceeds file size limit');
    if (buffer.subarray(0, offset).includes(0)) throw new Error('Binary input is not supported');
    return buffer.subarray(0, offset).toString('utf8');
  } finally { await handle.close(); }
}
