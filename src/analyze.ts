import ts from 'typescript';
import path from 'node:path';
import { parseDiff } from './diff.js';
import { git, revision, untracked } from './git.js';
import { boundedRead, redact, safePath } from './security.js';
import type { AnalyzeOptions, ChangedSymbol, DiffChange, ImpactReport, Limitation } from './types.js';
import { safeListDirectory, redact as redactValue } from '@zofai/evidence-spec';
const source = /\.(?:[cm]?[jt]sx?|py)$/i;
const maxPythonLineCharacters = 8192;
export const isTestFile = (file: string): boolean => /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|(?:^|\/)(?:test_[^/]+\.py|[^/]+_test\.py)$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file);
function glob(pattern: string): { test: (file: string) => boolean } {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 256 || pattern.includes('..') || pattern.startsWith('/') || /[\\\x00-\x1f]/.test(pattern)) throw new Error('Invalid exclusion pattern');
  const tokens = pattern.split('/');
  // Iterative wildcard matching and memoized ** traversal avoid regex backtracking.
  const segment = (pattern: string, value: string): boolean => {
    let p=0; let v=0; let star=-1; let retry=0;
    while(v<value.length) {
      if(p<pattern.length && (pattern[p]==='?' || pattern[p]===value[v])) { p++; v++; }
      else if(pattern[p]==='*') { star=p++; retry=v; }
      else if(star>=0) { p=star+1; v=++retry; }
      else return false;
    }
    while(pattern[p]==='*') p++;
    return p===pattern.length;
  };
  return { test(file: string): boolean {
    const parts=file.split('/'); const memo=new Map<string,boolean>();
    const match=(p:number,v:number):boolean=> {
      if(p===tokens.length) return true; // Directory-prefix matches exclude descendants.
      const key=`${p}:${v}`; const cached=memo.get(key); if(cached!==undefined) return cached;
      const result=tokens[p]==='**' ? match(p+1,v) || (v<parts.length && match(p,v+1)) : v<parts.length && segment(tokens[p]!,parts[v]!) && match(p+1,v+1);
      memo.set(key,result); return result;
    };
    return match(0,0);
  }};
}
function bound(value: number | undefined, fallback: number, maximum: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid analysis resource limit'); return value; }
const unique = (values: string[]): string[] => [...new Set(values)].sort();

export async function analyzeImpact(options: AnalyzeOptions): Promise<ImpactReport> {
  if (!options || typeof options.root !== 'string') throw new Error('A repository root is required');
  const root = path.resolve(options.root);
  await safeListDirectory(root, '', 1);
  const maxFiles = bound(options.limits?.maxFiles, 5000, 20000);
  const maxFileBytes = bound(options.limits?.maxFileBytes, 1024 * 1024, 4 * 1024 * 1024);
  const maxTotalBytes = bound(options.limits?.maxTotalBytes, 32 * 1024 * 1024, 128 * 1024 * 1024);
  const maxDiffBytes = bound(options.limits?.maxDiffBytes, 8 * 1024 * 1024, 16 * 1024 * 1024);
  const maxDepth = bound(options.limits?.maxDepth, 32, 64);
  if (options.exclude && (!Array.isArray(options.exclude) || options.exclude.length > 100)) throw new Error('Too many exclusion patterns');
  const excludes = ['.git','node_modules','.venv','venv','dist','build','__pycache__',...(options.exclude ?? [])].map(glob);
  const excluded = (file: string) => file.split('/').some(s => ['.git','node_modules','.venv','__pycache__'].includes(s)) || excludes.some(re => re.test(file));
  const limitations: Limitation[] = [];
  const limitKeys = new Set<string>();
  const limit = (code: string, message: string, file?: string) => { const key = `${code}:${file ?? ''}`; if (limitKeys.has(key)) return; limitKeys.add(key); if (limitations.length < 500) limitations.push(file ? { code,message,file } : { code,message }); };
  let changes: DiffChange[];
  if (options.changedFiles !== undefined) {
    if (!Array.isArray(options.changedFiles) || options.changedFiles.length > maxFiles) throw new Error('Invalid changed file list');
    changes = unique(options.changedFiles.map(safePath)).map(file => ({ path:file,status:'modified',addedLines:0,deletedLines:0,ranges:[] }));
    limit('EXPLICIT_FILES', 'Line changes and changed symbols are unavailable for an explicit file list.');
  } else {
    const discoveredRoot = (await git(root, ['rev-parse','--show-toplevel'], 8192)).trim();
    if (discoveredRoot !== root) throw new Error('Git repository root must equal the approved workspace');
    if (options.head && !options.base) throw new Error('A base revision is required when head is provided');
    const base = await revision(root, options.base ?? 'HEAD');
    const head = options.head ? await revision(root, options.head) : undefined;
    const args = ['diff','--no-ext-diff','--no-textconv','--unified=0','--find-renames',base,...(head ? [head] : []),'--'];
    changes = parseDiff(await git(root, args, maxDiffBytes));
    if (!head) {
      for (const file of await untracked(root)) if (!changes.some(c => c.path === file)) changes.push({path:file,status:'added',addedLines:0,deletedLines:0,ranges:[]});
    } else {
      // Analyze precisely the requested tree, never silently use dependencies from a different checkout.
      const checkout = await revision(root, 'HEAD');
      if (head !== checkout || (await git(root, ['status','--porcelain','--untracked-files=normal'], 2 * 1024 * 1024)).trim()) limit('TREE_MISMATCH','Dependency analysis uses the current checkout; checkout must equal the requested head and be clean for complete revision analysis.');
    }
  }
  const files: string[] = [];
  let examined = 0; let exhausted = false;
  async function walk(directory: string, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth) { limit('DEPTH_LIMIT','Directory traversal depth limit reached.'); return; }
    try {
      const listing = await safeListDirectory(root, prefix, Math.max(1, maxFiles * 4 - examined));
      for (const entry of listing.entries) {
        if (++examined > maxFiles * 4 || files.length >= maxFiles) { exhausted = true; break; }
        const file = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (excluded(file)) continue;
        try { safePath(file); } catch { limit('UNSAFE_PATH','A filename cannot be represented safely.'); continue; }
        if (entry.kind === 'symlink') { limit('SYMLINK','Symbolic links are not followed.',file); continue; }
        if (entry.kind === 'directory') await walk(path.join(directory,entry.name),file,depth + 1);
        else if (entry.kind === 'file') files.push(file);
        else limit('SPECIAL_FILE','Special filesystem entries are not read.',file);
        if (exhausted) break;
      }
      if (listing.truncated) exhausted = true;
    } catch { limit('UNREADABLE_DIRECTORY','A directory could not be inspected.',prefix || undefined); }
  }
  await walk(root,'',0);
  if (exhausted) limit('FILE_LIMIT','Repository file-count limit reached; analysis is partial.');
  files.sort();
  const fileSet = new Set(files);
  const sourceFiles = files.filter(f => source.test(f));
  const known = new Set([...sourceFiles,...changes.flatMap(c => c.previousPath ? [c.path,c.previousPath] : [c.path]).filter(f => source.test(f))]);
  const graph = new Map<string, Set<string>>();
  const changedSymbols: ChangedSymbol[] = [];
  let totalBytes = 0;
  const declaredPackages = new Set<string>();
  if (fileSet.has('package.json')) {
    try {
      const content = await boundedRead(root,'package.json',Math.min(maxFileBytes,256 * 1024));
      const pkg: unknown = JSON.parse(content);
      if (pkg && typeof pkg === 'object') for (const group of ['dependencies','devDependencies','peerDependencies','optionalDependencies']) {
        const deps = (pkg as Record<string,unknown>)[group];
        if (deps && typeof deps === 'object' && !Array.isArray(deps)) for (const name of Object.keys(deps)) declaredPackages.add(name);
      }
    } catch { limit('PACKAGE_METADATA','Package metadata could not be parsed safely.'); }
  }
  const resolve = (base: string): string | undefined => {
    const normalized = path.posix.normalize(base);
    if (normalized.startsWith('../') || normalized.startsWith('/')) return undefined;
    const candidates = [normalized,...['.ts','.tsx','.mts','.cts','.js','.jsx','.mjs','.cjs','.py'].map(ext => normalized + ext),...['index.ts','index.tsx','index.js','index.mjs','__init__.py'].map(n => `${normalized}/${n}`)];
    if (/\.[cm]?js$/.test(normalized)) candidates.push(normalized.replace(/\.js$/,'.ts').replace(/\.mjs$/,'.mts').replace(/\.cjs$/,'.cts'));
    return candidates.find(c => known.has(c));
  };
  const dependency = (file: string, spec: string, python = false) => {
    if (spec.length > 4096) { limit('IMPORT_LIMIT','An import specifier exceeds limits.',file); return; }
    let resolved: string | undefined;
    if (python) {
      const dots = spec.match(/^\.+/)?.[0].length ?? 0;
      if (dots) {
        let parent = path.posix.dirname(file);
        for (let i=1;i<dots;i++) parent=path.posix.dirname(parent);
        resolved = resolve(path.posix.join(parent,spec.slice(dots).replace(/\./g,'/')));
      } else resolved = resolve(spec.replace(/\./g,'/'));
    } else if (spec.startsWith('.')) resolved = resolve(path.posix.join(path.posix.dirname(file),spec));
    else {
      const packageName = spec.startsWith('@') ? spec.split('/').slice(0,2).join('/') : spec.split('/')[0]!;
      if (spec.startsWith('node:') || declaredPackages.has(packageName)) return;
      // Bare module aliases are not guessed: an omitted edge must trigger a fallback.
      limit('UNRESOLVED_IMPORT','A bare import is not a declared package; aliases and built-ins without node: need review.',file); return;
    }
    if (resolved) {
      graph.get(file)!.add(resolved);
      if (python) { let parent = path.posix.dirname(resolved); while (parent !== '.') { const init = `${parent}/__init__.py`; if (known.has(init)) graph.get(file)!.add(init); parent = path.posix.dirname(parent); } }
    }
    else limit('UNRESOLVED_IMPORT','An import could not be mapped to a local source file.',file);
  };
  for (const file of sourceFiles) {
    graph.set(file,new Set());
    let content: string;
    try { content = await boundedRead(root,file,maxFileBytes); }
    catch { limit('UNREADABLE_SOURCE','Source could not be read within path and size limits.',file); continue; }
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > maxTotalBytes) { limit('TOTAL_SIZE_LIMIT','Total source-byte limit reached; analysis is partial.'); break; }
    const change = changes.find(c => c.path === file);
    if (change?.status === 'added' && change.ranges.length === 0) { change.addedLines = content ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0; change.ranges = [{start:1,end:Math.max(1,change.addedLines)}]; }
    if (file.endsWith('.py')) {
      limit('PYTHON_LEXICAL_MODEL','Python edges use a conservative lexical subset without syntax or import-loader validation; full-suite fallback is required.',file);
      // Conservative lexical subset; no Python interpreter and no source execution.
      const lines = content.split('\n');
      let triple: string | undefined;
      for (let index=0;index<lines.length;index++) {
        const line = lines[index]!;
        // Bound lexical work before any line regex: repeated import lists can
        // otherwise exhaust the regex engine's stack within the file-byte limit.
        if (line.length > maxPythonLineCharacters) {
          limit('PYTHON_IMPORT_SIZE_LIMIT','A Python lexical line exceeds 8,192 characters; file analysis requires a full-suite fallback.',file);
          break;
        }
        if (/'''|"""/.test(line)) { const quote = line.match(/'''|"""/)![0]; const count = line.split(quote).length - 1; if (count % 2) triple = triple === quote ? undefined : quote; limit('PYTHON_MULTILINE_STRING','Multiline strings require manual review of lexical Python analysis.',file); continue; }
        if (triple) continue;
        const clean = line.replace(/#.*/,'');
        if (/\b(?:__import__|import_module|exec|eval)\s*\(/.test(clean)) limit('DYNAMIC_IMPORT','Dynamic Python imports or execution cannot be resolved.',file);
        if (/^\s*(?:from\s|import\s)/.test(clean)) {
          if (/[();\\]/.test(clean) || /\*/.test(clean)) { limit('PYTHON_IMPORT_SYNTAX','Multiline, wildcard, or compound Python imports are not resolved.',file); continue; }
          const direct = clean.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*$/);
          const from = clean.match(/^\s*from\s+([\w.]+)\s+import\s+([\w]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w]+(?:\s+as\s+\w+)?)*)\s*$/);
          if (direct) for (const item of direct[1]!.split(',')) dependency(file,item.trim().split(/\s/)[0]!,true);
          else if (from) {
            const module = from[1]!;
            dependency(file,module,true);
            for (const item of from[2]!.split(',')) {
              const imported = item.trim().split(/\s/)[0]!;
              const full = module.endsWith('.') ? module + imported : `${module}.${imported}`;
              // Imported objects may be symbols; only add an additional submodule edge if it exists.
              const dots = full.match(/^\.+/)?.[0].length ?? 0;
              let parent=path.posix.dirname(file); for(let d=1;d<dots;d++) parent=path.posix.dirname(parent);
              const target=resolve(dots ? path.posix.join(parent,full.slice(dots).replace(/\./g,'/')) : full.replace(/\./g,'/'));
              if(target) graph.get(file)!.add(target);
            }
          } else limit('PYTHON_IMPORT_SYNTAX','Python import syntax is outside the supported lexical subset.',file);
        }
        if (/\b(?:sys\.path|sys\.meta_path|importlib|pkgutil)\b/.test(clean)) limit('DYNAMIC_IMPORT','Custom Python module search or loading cannot be resolved.',file);
      }
      // Symbols are deliberately omitted without an AST; impacts remain file-level.
      continue;
    }
    const kind = /\.[jt]sx$/.test(file) ? (file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX) : /\.[mc]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    let ast: ts.SourceFile;
    try { ast = ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true,kind); } catch { limit('PARSER_LIMIT','Source nesting exceeds parser limits.',file); continue; }
    if (((ast as unknown as {parseDiagnostics:unknown[]}).parseDiagnostics).length) limit('SYNTAX_ERROR','Source has parser diagnostics; dependency analysis is partial.',file);
    const ranges = change?.ranges ?? [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) dependency(file,node.moduleSpecifier.text);
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) dependency(file,node.moduleReference.expression.text);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require','eval','Function'].includes(node.expression.text)))) {
        const arg = node.arguments[0];
        if (ts.isIdentifier(node.expression) && ['eval','Function'].includes(node.expression.text)) limit('DYNAMIC_EXECUTION','Dynamic JavaScript execution cannot be analyzed.',file);
        else if (arg && ts.isStringLiteralLike(arg)) dependency(file,arg.text);
        else limit('DYNAMIC_IMPORT','Computed import or require cannot be resolved.',file);
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') limit('DYNAMIC_EXECUTION','Dynamic JavaScript execution cannot be analyzed.',file);
      if (ranges.length && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) || (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))))) {
        const name = node.name;
        if (name && ts.isIdentifier(name)) {
          const startLine = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          const endLine = ast.getLineAndCharacterOfPosition(node.end).line + 1;
          if (ranges.some(r => r.start <= endLine && r.end >= startLine)) changedSymbols.push({file,name:name.text,kind:ts.SyntaxKind[node.kind],startLine,endLine,confidence:'high'});
        }
      }
      ts.forEachChild(node,visit);
    };
    try { visit(ast); } catch { limit('PARSER_LIMIT','Source nesting exceeds parser traversal limits.',file); }
  }
  for (const change of changes) {
    if (excluded(change.path)) limit('EXCLUDED_CHANGE','A changed file is excluded from analysis.',change.path);
    else if (!source.test(change.path)) limit('UNSUPPORTED_CHANGE','A changed file is not a supported source file; configuration and dependency changes may affect the full suite.',change.path);
    else if (!fileSet.has(change.path) && change.status !== 'deleted') limit('MISSING_CHANGE','A changed file is absent or could not be read.',change.path);
    if (change.status === 'deleted' || change.status === 'renamed') limit('REMOVED_SOURCE','Removed or renamed source may have historical dependencies not present in the checkout.',change.path);
  }
  const reverse = new Map<string,Set<string>>();
  for (const [file,imports] of graph) for (const dependency of imports) { if (!reverse.has(dependency)) reverse.set(dependency,new Set()); reverse.get(dependency)!.add(file); }
  const affected = new Set(changes.flatMap(c => c.previousPath ? [c.path,c.previousPath] : [c.path]));
  const queue = [...affected];
  for (let index=0;index<queue.length;index++) for(const consumer of reverse.get(queue[index]!) ?? []) if(!affected.has(consumer)) { affected.add(consumer); queue.push(consumer); }
  // Lack of line information is advisory, not missing dependency coverage.
  const incomplete = limitations.some(l => l.code !== 'EXPLICIT_FILES');
  const report: ImpactReport = { schemaVersion:'impact/v1',changes:changes.sort((a,b)=>a.path.localeCompare(b.path,'en')),files,dependencies:[...graph].map(([file,imports])=>({file,imports:unique([...imports])})),impactedFiles:unique([...affected]),affectedTests:unique([...affected].filter(isTestFile)),changedSymbols:changedSymbols.sort((a,b)=>a.file.localeCompare(b.file,'en') || a.startLine-b.startLine),confidence:incomplete?'low':(sourceFiles.some(f=>f.endsWith('.py'))?'medium':'high'),complete:!incomplete,limitations };
  const redacted = redactValue(report);
  if (JSON.stringify(redacted) !== JSON.stringify(report)) { redacted.complete=false; redacted.confidence='low'; redacted.limitations.push({code:'REDACTED_OUTPUT',message:'Sensitive-looking metadata was redacted; use a full-suite fallback.'}); return redacted; }
  return report;
}
