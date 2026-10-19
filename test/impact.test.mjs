import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeImpact, parseDiff, formatReport } from '../dist/index.js';
const fixtures=[];
async function fixture(files) { const root=await mkdtemp(join(tmpdir(),'zof-impact-')); fixtures.push(root); for(const [file,content] of Object.entries(files)) { await mkdir(join(root,file,'..'),{recursive:true}); await writeFile(join(root,file),content); } return root; }
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
function initialize(root) { git(root,'init','-b','main'); git(root,'config','user.name','Synthetic tester'); git(root,'config','user.email','fixture@example.invalid'); git(root,'add','.'); git(root,'commit','-m','synthetic baseline'); }
test.after(async()=>{for(const f of fixtures) await rm(f,{recursive:true,force:true});});

test('git integration follows shared TS function to consumer and test, detects changed symbol',async()=>{
 const root=await fixture({'src/math.ts':'export function add(a: number,b: number) {\n return a - b;\n}\n','src/consumer.ts':"import {add} from './math.js';\nexport const result = add(1,2);\n",'tests/math.test.ts':"import '../src/consumer.js';\n",'src/unrelated.ts':'export const n=1;\n','tests/unrelated.test.ts':"import '../src/unrelated.js';\n"});
 initialize(root); await writeFile(join(root,'src/math.ts'),'export function add(a: number,b: number) {\n return a + b;\n}\n');
 const report=await analyzeImpact({root});
 assert.equal(report.complete,true); assert.equal(report.confidence,'high');
 assert.deepEqual(report.impactedFiles,['src/consumer.ts','src/math.ts','tests/math.test.ts']);
 assert.deepEqual(report.affectedTests,['tests/math.test.ts']); assert.equal(report.changedSymbols[0].name,'add');
 assert.equal(report.changes[0].addedLines,1); assert.equal(report.changes[0].deletedLines,1);
 assert.match(formatReport(report),/advisory/);
});
test('supports ES exports, CommonJS literal imports, cycles and imports with spaces',async()=>{
 const root=await fixture({'a file.js':"export const x=1;\n",'b.cjs':"const x=require('./a file.js'); require('./c.cjs');",'c.cjs':"require('./b.cjs');",'tests/b.test.js':"import '../b.cjs';"});
 const report=await analyzeImpact({root,changedFiles:['a file.js']});
 assert.equal(report.complete,true); assert.deepEqual(report.affectedTests,['tests/b.test.js']); assert.equal(report.impactedFiles.length,4);
});
test('Python local static imports map transitive tests and disclose lexical uncertainty',async()=>{
 const root=await fixture({'pkg/__init__.py':'','pkg/shared.py':'def answer():\n    return 42\n','pkg/consumer.py':'from .shared import answer\n','tests/test_consumer.py':'from pkg.consumer import answer\n'});
 const report=await analyzeImpact({root,changedFiles:['pkg/shared.py']});
 assert.deepEqual(report.affectedTests,['tests/test_consumer.py']);
 assert.equal(report.complete,false); assert.ok(report.limitations.some(l=>l.code==='PYTHON_LEXICAL_MODEL'));
 const init=await analyzeImpact({root,changedFiles:['pkg/__init__.py']}); assert.ok(init.impactedFiles.includes('tests/test_consumer.py'));
});
test('computed imports, unresolved aliases, unsupported changes and ignored paths are incomplete',async()=>{
 const root=await fixture({'main.ts':"const m=import(process.env.MODULE); import '@/unknown';",'config.json':'{}','generated/a.ts':'export const x=1'});
 const report=await analyzeImpact({root,changedFiles:['config.json','generated/a.ts'],exclude:['generated/**']});
 assert.equal(report.complete,false); for(const code of ['DYNAMIC_IMPORT','UNRESOLVED_IMPORT','UNSUPPORTED_CHANGE','EXCLUDED_CHANGE']) assert.ok(report.limitations.some(l=>l.code===code));
});
test('declared packages and node built-ins are external, not guessed local aliases',async()=>{
 const root=await fixture({'package.json':JSON.stringify({dependencies:{typescript:'5.9.3'}}),'a.ts':"import ts from 'typescript'; import path from 'node:path';"});
 assert.equal((await analyzeImpact({root,changedFiles:['a.ts']})).complete,true);
});
test('deletions conservatively disclose missing historical dependency edges',async()=>{
 const root=await fixture({'a.ts':'export const x=1;','b.ts':"import './a.js';"});initialize(root);await rm(join(root,'a.ts'));
 const report=await analyzeImpact({root});assert.equal(report.changes[0].status,'deleted');assert.ok(report.impactedFiles.includes('b.ts'));assert.equal(report.complete,false);
});
test('head/base comparison refuses to claim complete with a mismatched checkout',async()=>{
 const root=await fixture({'a.ts':'export const x=1;'});initialize(root);const base=git(root,'rev-parse','HEAD').trim();await writeFile(join(root,'a.ts'),'export const x=2;');git(root,'add','.');git(root,'commit','-m','next');const head=git(root,'rev-parse','HEAD').trim();
 assert.equal((await analyzeImpact({root,base,head})).complete,true);
 await writeFile(join(root,'a.ts'),'export const x=3;'); assert.ok((await analyzeImpact({root,base,head})).limitations.some(l=>l.code==='TREE_MISMATCH'));
});
test('Git external diff and textconv helpers never execute',async()=>{
 const root=await fixture({'a.ts':'export const x=1;','.gitattributes':'*.ts diff=unsafe\n'});initialize(root);
 const marker=join(root,'marker'); const helper=join(root,'helper.sh'); await writeFile(helper,`#!/bin/sh\ntouch '${marker}'\n`,{mode:0o700});git(root,'config','diff.unsafe.textconv',helper);git(root,'config','diff.external',helper);await writeFile(join(root,'a.ts'),'export const x=2;');
 await analyzeImpact({root});await assert.rejects(access(marker));
});
test('diff parsing handles renames and rejects traversal, malformed hunks, excessive input',()=>{
 const diff='diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n';
 assert.deepEqual(parseDiff(diff)[0],{path:'new.ts',previousPath:'old.ts',status:'renamed',addedLines:0,deletedLines:0,ranges:[]});
 assert.throws(()=>parseDiff('diff --git a/../escape b/../escape\n'),/Invalid/);
 assert.throws(()=>parseDiff('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n'),/Incomplete|Malformed/);
 assert.throws(()=>parseDiff('x'.repeat(16*1024*1024+1)),/limits/);
 assert.throws(()=>parseDiff('diff --git "a/a\\012b" "b/a\\012b"\n'),/Invalid/);
});
test('unsafe paths and symlinks cannot read external source; oversized inputs become incomplete',async(t)=>{
 const root=await fixture({'a.ts':'x'.repeat(200),'tests/a.test.ts':"import '../a.js'"});
 for(const file of ['../secret.ts','/etc/passwd','C:\\secret.ts','a\0.ts']) await assert.rejects(analyzeImpact({root,changedFiles:[file]}));
 if(process.platform!=='win32') { const other=await fixture({'external.ts':'export const secret=1;'});await symlink(join(other,'external.ts'),join(root,'link.ts')); const links=await analyzeImpact({root,changedFiles:['link.ts']});assert.equal(links.complete,false);assert.ok(!links.files.includes('link.ts')); }
 const report=await analyzeImpact({root,changedFiles:['a.ts'],limits:{maxFileBytes:20}}); assert.equal(report.complete,false);assert.ok(report.limitations.some(l=>l.code==='UNREADABLE_SOURCE'));
 const total=await analyzeImpact({root,changedFiles:['a.ts'],limits:{maxTotalBytes:10}});assert.equal(total.complete,false);
 const count=await analyzeImpact({root,changedFiles:['a.ts'],limits:{maxFiles:1}});assert.equal(count.complete,false);
});
test('synthetic credentials, URLs and arbitrary environment/source values are absent from report',async()=>{
 const secret='ghp_'+'X'.repeat(36);const file=`${secret}.ts`;
 const root=await fixture({[file]:`export const x = "password=not-for-output";\n`});
 process.env.ZOF_TEST_SYNTHETIC_SECRET='ENV_SENTINEL_123456';
 const report=await analyzeImpact({root,changedFiles:[file]});const output=JSON.stringify(report);
 assert.ok(!output.includes(secret));assert.ok(!output.includes('not-for-output'));assert.ok(!output.includes('ENV_SENTINEL_123456'));assert.equal(report.complete,false);
 delete process.env.ZOF_TEST_SYNTHETIC_SECRET;
});
test('CLI errors do not echo sensitive arguments and exit 2',async()=>{
 const secret='ghp_'+'Y'.repeat(36);let result;try { execFileSync(process.execPath,['dist/cli.js','--unknown',secret],{encoding:'utf8',stdio:['ignore','pipe','pipe']}); }catch(error){result=error;}
 assert.equal(result.status,2);assert.ok(!result.stderr.includes(secret));
});
