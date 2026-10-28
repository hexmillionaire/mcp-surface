import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/mcp-surface.mjs', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const example = name => fileURLToPath(new URL('../examples/' + name + '.json', import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { windowsHide: true });
    child.stdin.end();
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timed out.')); }, 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
test('CLI normalization, reports, policy and usage have distinct exit meanings', async () => {
  assert.equal((await run(['--version'])).stdout.trim(), version);
  const normalized = await run(['normalize', example('baseline')]);
  assert.equal(normalized.code, 0);
  assert.equal(JSON.parse(normalized.stdout).tools[0].name, 'fetch_record');
  const compatible = await run(['compare', example('baseline'), example('compatible')]);
  assert.equal(compatible.code, 0, compatible.stderr);
  assert.equal(JSON.parse(compatible.stdout).counts.compatible, 2);
  const breaking = await run(['compare', example('baseline'), example('breaking'), '--format', 'markdown']);
  assert.equal(breaking.code, 1);
  assert.match(breaking.stdout, /Behavior verification: not performed/);
  const unknown = await run(['lint', example('unknown')]);
  assert.equal(unknown.code, 1);
  assert.equal(JSON.parse(unknown.stdout).counts.unknown, 1);
  assert.equal((await run(['lint', example('unknown'), '--fail-on', 'never'])).code, 0);
  for (const args of [['compare', example('baseline')], ['lint', example('baseline'), '--format', 'html'], ['lint', example('baseline'), '--fail-on', 'safe'], ['normalize', example('baseline'), '--format', 'json']]) assert.equal((await run(args)).code, 2);
});

test('CLI accepts paths containing spaces and keeps malformed input details out of errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'surface cli space-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface cli space-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const file = join(root, 'private file name.json');
  await writeFile(file, 'secret-content-that-is-not-json');
  const result = await run(['lint', file]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /secret-content|private file|surface cli space/);
});

test('remote schema references are unknown and cause no HTTP request', async t => {
  let requests = 0;
  const trap = createServer((request, response) => { requests++; response.end('{}'); });
  await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => trap.close(resolve)));
  const root = await mkdtemp(join(tmpdir(), 'surface no-fetch-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface no-fetch-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const file = join(root, 'remote.json');
  await writeFile(file, JSON.stringify({ tools: [{ name: 'read_record', description: 'Read record.', inputSchema: { type: 'object', properties: { record: { $ref: 'http://127.0.0.1:' + trap.address().port + '/never-fetch' } } }, annotations: { readOnlyHint: true } }] }));
  const result = await run(['lint', file]);
  assert.equal(result.code, 1);
  assert.ok(JSON.parse(result.stdout).counts.unknown > 0);
  assert.equal(requests, 0);
});

test('saved control characters remain data in JSON and are escaped in Markdown and errors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'surface controls-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface controls-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const file = join(root, 'controls.json');
  const key = String.fromCharCode(27) + 'c' + String.fromCharCode(127);
  const artifact = { tools: [{ name: 'x', inputSchema: { type: 'object', [key]: true } }] };
  await writeFile(file, JSON.stringify(artifact));
  const markdown = await run(['lint', file, '--format', 'markdown']);
  assert.equal(markdown.code, 1);
  assert.doesNotMatch(markdown.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  const json = await run(['lint', file]);
  assert.doesNotMatch(json.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.equal(JSON.parse(json.stdout).findings.some(finding => finding.path.includes(key)), true);
  artifact.tools[0].inputSchema = { type: 'object', properties: { [key]: { type: 'invalid' } } };
  await writeFile(file, JSON.stringify(artifact));
  const invalid = await run(['lint', file]);
  assert.equal(invalid.code, 2);
  assert.doesNotMatch(invalid.stderr, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.match(invalid.stderr, /\\u001b/);
});

test('file comparison rejects numeric rounding aliases before they can appear unchanged', async t => {
  const root = await mkdtemp(join(tmpdir(), 'surface precision-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface precision-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const baseline = join(root, 'baseline.json');
  const current = join(root, 'current.json');
  await writeFile(baseline, '{"tools":[{"name":"x","inputSchema":{"type":"object"},"outputSchema":{"enum":[1.0000000000000001]}}]}');
  await writeFile(current, '{"tools":[{"name":"x","inputSchema":{"type":"object"},"outputSchema":{"enum":[1]}}]}');
  const result = await run(['compare', baseline, current]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /loses precision/);
});
