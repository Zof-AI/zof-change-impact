import { safeGit } from '@zof-ai/evidence-spec';
import { safePath } from './security.js';
export async function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  try { return await safeGit(root, args, maxBuffer); }
  catch { throw new Error('Git operation failed for the approved workspace or exceeded secure snapshot limits; use a local repository without external metadata'); }
}
export async function revision(root: string, value: string): Promise<string> {
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_][A-Za-z0-9_./~^{}-]*$/.test(value)) throw new Error('Invalid Git revision');
  const sha = (await git(root, ['rev-parse','--verify','--end-of-options',`${value}^{commit}`], 1024)).trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error('Invalid Git commit object');
  return sha;
}
export async function untracked(root: string): Promise<string[]> {
  return (await git(root, ['ls-files','--others','--exclude-standard','-z'], 2 * 1024 * 1024)).split('\0').filter(Boolean).map(safePath);
}
