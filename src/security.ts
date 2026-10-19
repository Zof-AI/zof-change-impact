import { safeReadFile } from '@zof-ai/evidence-spec';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
export function safePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Invalid repository-relative path');
  return value;
}
export { redactText as redact } from '@zof-ai/evidence-spec';

export async function boundedRead(root: string, relative: string, maxBytes: number): Promise<string> {
  const buffer = await safeReadFile(root, relative, maxBytes);
  if (buffer.includes(0)) throw new Error('Binary input is not supported');
  return buffer.toString('utf8');
}
