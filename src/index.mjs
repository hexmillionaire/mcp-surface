import { ArtifactError, LIMITS, DIALECT, normalizeArtifact, readArtifact, parseArtifactJSON, own, equalJSON, pointer } from './artifact.mjs';
import { schemaUnknowns, metadata, workBudget, WorkLimit, compareSchemas } from './schema.mjs';

export { ArtifactError, LIMITS, DIALECT, normalizeArtifact, readArtifact, parseArtifactJSON };
export const VERSION = '0.1.1';
export const REPORT_VERSION = 1;
const LEVELS = ['breaking', 'unknown', 'review', 'compatible'];
function collector(kind) {
  const findings = [];
  let omitted = 0;
  return { add(finding) { if (findings.length < 2000) findings.push(finding); else omitted++; },
    finish() {
      if (omitted) findings.push({ level: 'unknown', code: 'FINDING_LIMIT', path: '', message: 'Finding limit reached; additional findings were omitted.' });
      findings.sort((a, b) => [a.tool ?? '', a.path, a.level, a.code, a.artifact ?? ''].join('\0').localeCompare([b.tool ?? '', b.path, b.level, b.code, b.artifact ?? ''].join('\0'), 'en'));
      const counts = Object.fromEntries(LEVELS.map(level => [level, findings.filter(item => item.level === level).length]));
      return { reportVersion: REPORT_VERSION, kind, toolShapeScope: '2026-07-28', schemaDialect: DIALECT, validationScope: 'supported-schema-fragment', behaviorVerification: 'not-performed', counts, omittedFindings: omitted, findings };
    } };
}
function lintInto(artifact, output, artifactLabel) {
  for (const tool of artifact.tools) {
    const add = finding => output.add({ ...finding, tool: tool.name, ...(artifactLabel ? { artifact: artifactLabel } : {}) });
    if (!tool.description?.trim()) add({ level: 'review', code: 'DESCRIPTION_MISSING', path: '/description', message: 'No tool description is provided; review the model-visible contract.' });
    if (!own(tool, 'outputSchema')) add({ level: 'review', code: 'OUTPUT_UNDECLARED', path: '/outputSchema', message: 'No output schema is declared; response shape is unverified.' });
    if (!own(tool, 'annotations')) add({ level: 'review', code: 'ANNOTATIONS_MISSING', path: '/annotations', message: 'Behavior hints are absent. This checker does not verify behavior.' });
    if (tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === true) add({ level: 'review', code: 'ANNOTATIONS_CONFLICT', path: '/annotations', message: 'Read-only and destructive hints are both true; review the claimed behavior.' });
    for (const key of ['inputSchema', 'outputSchema']) if (own(tool, key)) for (const finding of schemaUnknowns(tool[key], '/' + key)) add({ ...finding, level: 'unknown' });
  }
}
export function lintArtifact(value) {
  const artifact = normalizeArtifact(value);
  const output = collector('lint');
  lintInto(artifact, output);
  return output.finish();
}

export function compareArtifacts(baselineValue, currentValue) {
  const baseline = normalizeArtifact(baselineValue); const current = normalizeArtifact(currentValue);
  const output = collector('compare');
  lintInto(baseline, output, 'baseline'); lintInto(current, output, 'current');
  const before = new Map(baseline.tools.map(tool => [tool.name, tool]));
  const after = new Map(current.tools.map(tool => [tool.name, tool]));
  const tick = workBudget();
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(name); const fresh = after.get(name);
    const add = finding => output.add({ ...finding, tool: name });
    if (!old) { add({ level: 'compatible', code: 'TOOL_ADDED', path: '', message: 'A tool was added; existing tool names remain available. Behavior is unverified.' }); continue; }
    if (!fresh) { add({ level: 'breaking', code: 'TOOL_REMOVED', path: '', message: 'A baseline tool name is no longer available.' }); continue; }
    for (const key of ['inputSchema', 'outputSchema']) {
      if (own(old, key) && own(fresh, key)) {
        const oldMetadata = metadata(old[key]); const newMetadata = metadata(fresh[key]);
        if (oldMetadata.truncated || newMetadata.truncated) add({ level: 'unknown', code: 'METADATA_LIMIT', path: '/' + key, message: 'Schema metadata comparison limit reached; some metadata changes may be omitted.' });
        for (const path of [...new Set([...oldMetadata.keys(), ...newMetadata.keys()])].sort()) if (!equalJSON(oldMetadata.get(path), newMetadata.get(path))) add({ level: 'review', code: 'SCHEMA_METADATA_CHANGED', path: '/' + key + path, message: 'Schema metadata changed; review model-visible text and hints.' });
        if (equalJSON(old[key], fresh[key])) continue;
        if (schemaUnknowns(old[key]).length || schemaUnknowns(fresh[key]).length) continue;
        try {
          const source = key === 'inputSchema' ? old[key] : fresh[key];
          const target = key === 'inputSchema' ? fresh[key] : old[key];
          const level = compareSchemas(source, target, tick);
          add({ level, code: level === 'compatible' ? 'SCHEMA_COMPATIBLE' : level === 'breaking' ? 'SCHEMA_REJECTS_WITNESS' : 'SCHEMA_INCLUSION_UNKNOWN', path: '/' + key,
            message: level === 'compatible' ? 'Directional schema inclusion was proved within the supported fragment.' : level === 'breaking' ? 'A supported-fragment counterexample violates directional schema inclusion; no tool was invoked.' : 'Inclusion was not proved and no bounded counterexample was found; compatibility is unknown.' });
        } catch (error) {
          if (!(error instanceof WorkLimit)) throw error;
          add({ level: 'unknown', code: 'COMPARISON_WORK_LIMIT', path: '/' + key, message: 'Comparison work limit reached; compatibility is unknown.' });
        }
      } else if (key === 'outputSchema' && own(old, key) !== own(fresh, key)) add({ level: own(fresh, key) ? 'compatible' : 'unknown', code: own(fresh, key) ? 'OUTPUT_DECLARED' : 'OUTPUT_GUARANTEE_REMOVED', path: '/' + key, message: own(fresh, key) ? 'An output schema was added where the baseline declared no output constraint; behavior remains unverified.' : 'The baseline output guarantee is no longer declared; actual response shape is unknown.' });
    }
    for (const key of [...new Set([...Object.keys(old), ...Object.keys(fresh)])].sort()) if (!['name', 'inputSchema', 'outputSchema'].includes(key) && !equalJSON(old[key], fresh[key])) add({ level: 'review', code: key === 'annotations' ? 'ANNOTATIONS_CHANGED' : 'TOOL_METADATA_CHANGED', path: '/' + pointer(key), message: 'Tool metadata or a behavior claim changed; review is required to assess its effect.' });
  }
  for (const key of [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort()) if (key !== 'tools' && !equalJSON(baseline[key], current[key])) output.add({ level: 'review', code: 'RESULT_METADATA_CHANGED', path: '/' + pointer(key), message: 'Discovery result metadata changed; server identity and behavior are not verified.' });
  return output.finish();
}

export function reportExitCode(report, failOn = ['breaking', 'unknown']) {
  if (!Array.isArray(failOn) || failOn.some(level => !['breaking', 'unknown', 'review'].includes(level)) || new Set(failOn).size !== failOn.length) throw new ArtifactError('Fail levels must be unique breaking, unknown, or review values.');
  return failOn.some(level => report.counts[level] > 0) ? 1 : 0;
}
export const escapeTerminal = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const escapeMarkdown = value => escapeTerminal(String(value).replaceAll('\n', ' ').replaceAll('\r', ' ')).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll(String.fromCharCode(96), '&#96;').replaceAll('[', '&#91;').replaceAll(']', '&#93;').replaceAll('\\', '&#92;');
export function renderMarkdown(report) {
  const lines = ['MCP Surface ' + report.kind, '', 'Behavior verification: not performed. This report describes saved contracts, not tool execution or client interoperability.', '',
    '| Level | Tool | Pointer | Finding |', '| --- | --- | --- | --- |'];
  for (const finding of report.findings) lines.push('| ' + [finding.level, finding.tool ?? '(result)', finding.path || '(tool)', finding.message].map(escapeMarkdown).join(' | ') + ' |');
  if (!report.findings.length) lines.push('| compatible | — | — | No structural changes or lint findings. |');
  lines.push('', 'Counts: ' + Object.entries(report.counts).map(([key, count]) => key + '=' + count).join(', ') + '.');
  if (report.omittedFindings) lines.push('Omitted findings: ' + report.omittedFindings + '; see FINDING_LIMIT.');
  return lines.join('\n') + '\n';
}
