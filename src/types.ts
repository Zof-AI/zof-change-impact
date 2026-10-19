export interface DiffRange { start: number; end: number }
export interface DiffChange { path: string; previousPath?: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; addedLines: number; deletedLines: number; ranges: DiffRange[] }
export interface Limitation { code: string; message: string; file?: string }
export interface ChangedSymbol { file: string; name: string; kind: string; startLine: number; endLine: number; confidence: 'high' | 'medium' }
export interface ImpactReport {
  schemaVersion: 'impact/v1'; changes: DiffChange[]; files: string[];
  dependencies: { file: string; imports: string[] }[]; impactedFiles: string[];
  affectedTests: string[]; changedSymbols: ChangedSymbol[];
  confidence: 'high' | 'medium' | 'low'; complete: boolean; limitations: Limitation[];
}
export interface AnalysisLimits { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number; maxDiffBytes?: number; maxDepth?: number }
export interface AnalyzeOptions { root: string; base?: string; head?: string; changedFiles?: string[]; exclude?: string[]; limits?: AnalysisLimits }
