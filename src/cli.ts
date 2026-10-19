#!/usr/bin/env node
import { analyzeImpact, formatReport } from './index.js';
import type { AnalyzeOptions } from './types.js';
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: zof-change-impact [--root PATH] [--base REF] [--head REF] [--changed FILE ...] [--exclude GLOB ...] [--json] [--require-complete]\nOffline static analysis; never executes repository source. Default: HEAD against working tree. Exit 2: input/operational error; exit 3: incomplete with --require-complete.');
} else {
  try {
    const options: AnalyzeOptions = { root:process.cwd() };
    let json=false; let requireComplete=false;
    for(let i=0;i<args.length;i++) {
      const flag=args[i]!;
      if(flag==='--json') { json=true; continue; }
      if(flag==='--require-complete') { requireComplete=true; continue; }
      if(!['--root','--base','--head','--changed','--exclude'].includes(flag) || !args[i+1]) throw new Error('Invalid arguments');
      const value=args[++i]!;
      if(flag==='--root') options.root=value;
      else if(flag==='--base') options.base=value;
      else if(flag==='--head') options.head=value;
      else if(flag==='--changed') (options.changedFiles ??= []).push(value);
      else (options.exclude ??= []).push(value);
    }
    const report=await analyzeImpact(options);
    console.log(json ? JSON.stringify(report,null,2) : formatReport(report));
    if(requireComplete && !report.complete) process.exitCode=3;
  } catch { console.error('Change-impact analysis failed. Check arguments, input limits, revisions, and repository access. No source content is included in errors.'); process.exitCode=2; }
}
