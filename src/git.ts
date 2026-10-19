import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safePath } from './security.js';
const execute = promisify(execFile);
export async function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  try {
    const { stdout } = await execute('git', ['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','diff.external=','-c','core.quotePath=true','-C',root,...args], {
      encoding: 'utf8', timeout: 15000, maxBuffer,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    });
    return stdout;
  } catch { throw new Error('Git operation failed or exceeded resource limits; verify revisions and repository access'); }
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
