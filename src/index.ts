export { analyzeImpact, isTestFile } from './analyze.js';
export { parseDiff } from './diff.js';
export type { AnalyzeOptions, AnalysisLimits, ImpactReport, DiffChange, ChangedSymbol, Limitation, DiffRange } from './types.js';
import { redact } from './security.js';
import type { ImpactReport } from './types.js';
export function formatReport(report: ImpactReport): string {
  return redact([`Change impact: ${report.impactedFiles.length} potentially affected file(s)`, `Confidence: ${report.confidence}; static analysis ${report.complete ? 'complete within documented model' : 'incomplete'}`, 'Affected files:', ...report.impactedFiles.map(f => `  ${f}`),'Potentially affected tests:',...report.affectedTests.map(f => `  ${f}`),...report.limitations.map(l => `Limitation [${l.code}]: ${l.message}${l.file ? ` (${l.file})` : ''}`),'Static impact is advisory and does not verify tests or guarantee regression coverage.'].join('\n'));
}
