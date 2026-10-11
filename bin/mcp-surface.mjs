#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readArtifact, normalizeArtifact, lintArtifact, compareArtifacts, reportExitCode, renderMarkdown, escapeTerminal, VERSION } from '../src/index.mjs';

const printJSON = value => JSON.stringify(value, null, 2).replace(/[\u007f-\u009f]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';

const help = 'MCP Surface ' + VERSION + '\n'
  + 'Usage: mcp-surface normalize FILE\n'
  + '       mcp-surface lint FILE [--format json|markdown] [--fail-on breaking,unknown,review|never]\n'
  + '       mcp-surface compare BASELINE CURRENT [--format json|markdown] [--fail-on breaking,unknown,review|never]\n'
  + 'Default fail levels: breaking,unknown. Exit 0 passes policy; 1 findings fail policy; 2 invalid input or usage.\n'
  + 'Only complete local tools/list JSON artifacts. No server launch, network, tool invocation, or behavior verification.\n';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: { format: { type: 'string' }, 'fail-on': { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' } } });
  if (values.help) process.stdout.write(help);
  else if (values.version) process.stdout.write(VERSION + '\n');
  else {
    const [command, ...files] = positionals;
    if (!['normalize', 'lint', 'compare'].includes(command) || files.length !== (command === 'compare' ? 2 : 1)) throw new Error('Expected normalize FILE, lint FILE, or compare BASELINE CURRENT. Use --help.');
    if (values.format && !['json', 'markdown'].includes(values.format)) throw new Error('--format must be json or markdown.');
    if (command === 'normalize' && (values.format || values['fail-on'])) throw new Error('normalize accepts no report format or fail policy.');
    const failOn = values['fail-on'] === 'never' ? [] : (values['fail-on'] ?? 'breaking,unknown').split(',');
    reportExitCode({ counts: {} }, failOn);
    // Sequential reads keep memory bounded; all output is stdout for explicit redirection.
    const first = await readArtifact(files[0]);
    if (command === 'normalize') process.stdout.write(printJSON(normalizeArtifact(first)));
    else {
      const report = command === 'lint' ? lintArtifact(first) : compareArtifacts(first, await readArtifact(files[1]));
      process.stdout.write(values.format === 'markdown' ? renderMarkdown(report) : printJSON(report));
      process.exitCode = reportExitCode(report, failOn);
    }
  }
} catch (error) {
  process.stderr.write('MCP Surface: ' + escapeTerminal(error.message) + '\n');
  process.exitCode = 2;
}
