import { safeReadFile } from '@zofai/evidence-spec';
import path from 'node:path';
export function safePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f\\]/.test(value) || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('Invalid repository-relative path');
  return value;
}
export { redactText as redact } from '@zofai/evidence-spec';

export async function boundedRead(root: string, relative: string, maxBytes: number): Promise<string> {
  const buffer = await safeReadFile(root, relative, maxBytes);
  if (buffer.includes(0)) throw new Error('Binary input is not supported');
  return buffer.toString('utf8');
}
