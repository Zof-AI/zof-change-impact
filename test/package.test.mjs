import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const repo=resolve('.');
const execute=(args,options={})=>execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,...options});
test('documented examples report expected outcomes',()=>{
 const ts=JSON.parse(execute(['dist/cli.js','--root','examples/javascript','--changed','src/math.ts','--json'])); assert.deepEqual(ts.affectedTests,['tests/checkout.test.ts']); assert.equal(ts.complete,true);
 const py=JSON.parse(execute(['dist/cli.js','--root','examples/python','--changed','pkg/math.py','--json']));assert.deepEqual(py.affectedTests,['tests/test_math.py']);assert.equal(py.complete,false);
 assert.throws(()=>execute(['dist/cli.js','--root','examples/dynamic','--changed','loader.ts','--json','--require-complete']),e=>e.status===3 && JSON.parse(e.stdout).complete===false);
 assert.match(execute(['dist/cli.js','--help']),/Usage:/);
});
test('packed package installs cleanly, exposes import types and executable, runs real impact example',async()=>{
 assert.ok(process.env.npm_execpath,'Run this test through npm test');
 const root=await mkdtemp(join(tmpdir(),'zof-impact-package-'));
 try {
  const packed=JSON.parse(execute([process.env.npm_execpath,'pack','--ignore-scripts','--json','--pack-destination',root],{cwd:repo}))[0];
  assert.ok(packed.files.some(f=>f.path==='dist/index.d.ts'));assert.ok(packed.files.some(f=>f.path==='dist/cli.js'));
  assert.ok(packed.files.every(f=>!(/^(?:test|src|\.git|node_modules|orchestration)(?:\/|$)|\.map$|\.env/.test(f.path))));
  const project=join(root,'clean');await mkdir(project);await writeFile(join(project,'package.json'),' {"private":true,"type":"module"} ');
  const candidates=[];const evidence=resolve('../../orchestration/artifacts/zof-ai-evidence-spec-0.1.0.tgz');try{await access(evidence);candidates.push(evidence);}catch{}
  execute([process.env.npm_execpath,'install','--ignore-scripts','--no-audit','--no-fund',...candidates,join(root,packed.filename)],{cwd:project});
  const pkg=JSON.parse(await readFile(join(project,'node_modules/@zof-ai/change-impact/package.json'),'utf8'));assert.equal(pkg.bin['zof-change-impact'],'./dist/cli.js');
  const result=execute(['--input-type=module','-e',"import {analyzeImpact} from '@zof-ai/change-impact'; const r=await analyzeImpact({root:'node_modules/@zof-ai/change-impact/examples/javascript',changedFiles:['src/math.ts']}); console.log(JSON.stringify(r));"],{cwd:project});
  assert.deepEqual(JSON.parse(result).affectedTests,['tests/checkout.test.ts']);
  const bin=JSON.parse(execute([process.env.npm_execpath,'exec','--offline','--','zof-change-impact','--root','node_modules/@zof-ai/change-impact/examples/javascript','--changed','src/math.ts','--json'],{cwd:project}));assert.equal(bin.complete,true);
 } finally { await rm(root,{recursive:true,force:true}); }
});
