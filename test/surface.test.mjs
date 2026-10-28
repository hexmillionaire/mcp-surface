import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIALECT, ArtifactError, parseArtifactJSON, normalizeArtifact, readArtifact, compareArtifacts, lintArtifact, reportExitCode, renderMarkdown } from '../src/index.mjs';
import { compareSchemas, matches, workBudget } from '../src/schema.mjs';
import Ajv2020 from 'ajv/dist/2020.js';

const input = { type: 'object', additionalProperties: false };
function artifact(schema = input, role = 'outputSchema') {
  return { tools: [{ name: 'fetch_record', description: 'Fetch a record.', inputSchema: role === 'inputSchema' ? schema : input, ...(role === 'outputSchema' ? { outputSchema: schema } : { outputSchema: input }), annotations: { readOnlyHint: true, destructiveHint: false } }] };
}
function property(schema, required = ['value']) { return { type: 'object', properties: { value: schema }, required, additionalProperties: false }; }
function level(before, after, role = 'inputSchema') {
  const report = compareArtifacts(artifact(before, role), artifact(after, role));
  return report.findings.find(item => item.path === '/' + role && item.code.startsWith('SCHEMA_'))?.level;
}

test('normalization sorts tool/object keys, preserves data arrays and accepts result envelopes', () => {
  const raw = { tools: [{ ...artifact().tools[0], name: 'z' }, { ...artifact().tools[0], name: 'A' }], _meta: { z: 0, a: 1 } };
  const normalized = normalizeArtifact({ jsonrpc: '2.0', id: 1, result: raw });
  assert.deepEqual(normalized.tools.map(tool => tool.name), ['A', 'z']);
  assert.deepEqual(Object.keys(normalized._meta), ['a', 'z']);
  assert.deepEqual(normalizeArtifact(normalized), normalized);
  assert.equal(JSON.stringify(normalized).includes('jsonrpc'), false);
  const schema = property({ enum: ['b', 'a'] });
  assert.deepEqual(normalizeArtifact(artifact(schema)).tools[0].outputSchema.properties.value.enum, ['b', 'a']);
});

test('input widening and output narrowing have opposite compatibility directions', () => {
  const narrow = property({ type: 'string', enum: ['ok'] });
  const wide = property({ type: 'string', enum: ['ok', 'queued'] });
  assert.equal(level(narrow, wide), 'compatible');
  assert.equal(level(wide, narrow), 'breaking');
  assert.equal(level(narrow, wide, 'outputSchema'), 'breaking');
  assert.equal(level(wide, narrow, 'outputSchema'), 'compatible');
});

test('required fields, strict properties, and nested outputs are compared directionally', () => {
  const optional = property({ type: 'string' }, []);
  const required = property({ type: 'string' });
  assert.equal(level(optional, required), 'breaking');
  assert.equal(level(required, optional), 'compatible');
  assert.equal(level(required, optional, 'outputSchema'), 'breaking');
  assert.equal(level(optional, required, 'outputSchema'), 'compatible');
  const extra = { ...required, properties: { ...required.properties, extra: { type: 'integer' } } };
  assert.equal(level(required, extra), 'compatible');
  assert.equal(level(required, extra, 'outputSchema'), 'breaking');
  const nested = property(property({ type: 'string', enum: ['a', 'b'] }));
  const narrowed = property(property({ type: 'string', enum: ['a'] }));
  assert.equal(level(nested, narrowed), 'breaking');
  assert.equal(level(narrowed, nested, 'outputSchema'), 'breaking');
});

test('adding a constrained optional property to an open input can be breaking', () => {
  const before = { type: 'object' };
  const after = { type: 'object', properties: { value: { type: 'string' } } };
  assert.equal(level(before, after), 'breaking');
});

test('integer/number, safe integer bounds, strings and arrays are supported', () => {
  assert.equal(level(property({ type: 'integer' }), property({ type: 'number' })), 'compatible');
  assert.equal(level(property({ type: 'number' }), property({ type: 'integer' })), 'breaking');
  assert.equal(level(property({ type: 'integer', minimum: 0, maximum: 10 }), property({ type: 'integer', minimum: 0, maximum: 9 })), 'breaking');
  assert.equal(level(property({ type: 'string', maxLength: 10 }), property({ type: 'string', maxLength: 20 })), 'compatible');
  assert.equal(level(property({ type: 'array', items: { type: 'integer' } }), property({ type: 'array', items: { type: 'string' } })), 'breaking');
  assert.equal(level(property({ type: 'array', items: true }), property({ type: 'array', items: true, uniqueItems: true })), 'breaking');
});

test('a value removed from late in a long enum is a breaking witness in both directions', () => {
  const values = Array.from({ length: 256 }, (_, i) => 'v' + String(i).padStart(3, '0'));
  const all = { type: 'string', enum: values };
  const withoutLast = { type: 'string', enum: values.slice(0, 255) };
  // Input narrowing: the removed old value is still a valid old argument.
  assert.equal(level(property(all), property(withoutLast)), 'breaking');
  // Output widening: the new value was never promised by the old output schema.
  assert.equal(level(property(withoutLast), property(all), 'outputSchema'), 'breaking');
  assert.equal(level(property(withoutLast), property(all)), 'compatible');
  assert.equal(compareSchemas(all, withoutLast, workBudget()), 'breaking');
});

test('empty or constrained-away finite source values never produce a false breaking claim', () => {
  const before = property({ type: 'string', enum: ['a'], minLength: 2 });
  const after = property({ type: 'string', enum: ['a'], minLength: 3 });
  assert.equal(level(before, after), 'compatible');
  assert.equal(compareSchemas(false, { type: 'object' }, workBudget()), 'compatible');
});

test('unsupported refs, composition, patterns, dialects and precision remain unknown without fetching', () => {
  for (const schema of [
    property({ $ref: 'https://example.invalid/never-fetch.json' }),
    property({ anyOf: [{ type: 'string' }, { type: 'number' }] }),
    property({ type: 'string', pattern: '(a+)+$' }),
    { ...input, $schema: 'http://json-schema.org/draft-07/schema#' },
    property({ type: 'number', minimum: 0.1 }),
  ]) {
    const report = compareArtifacts(artifact(schema), artifact(schema));
    assert.ok(report.counts.unknown > 0);
    assert.equal(reportExitCode(report), 1);
    assert.equal(report.behaviorVerification, 'not-performed');
  }
  assert.equal(level(property({ type: 'string', minLength: 2000 }), property({ type: 'string', minLength: 2001 })), 'unknown', 'No bounded witness is not a proof of compatibility.');
});

test('description/default/annotation changes require review; claims are never behavior verification', () => {
  const before = artifact(property({ type: 'string', default: 'a' }));
  const after = structuredClone(before);
  after.tools[0].description = 'Different description.';
  after.tools[0].annotations.readOnlyHint = false;
  after.tools[0].outputSchema.properties.value.default = 'b';
  const report = compareArtifacts(before, after);
  assert.ok(report.findings.some(item => item.code === 'ANNOTATIONS_CHANGED'));
  assert.ok(report.findings.some(item => item.path === '/outputSchema/properties/value/default' && item.level === 'review'));
  assert.equal(reportExitCode(report), 0);
  assert.equal(reportExitCode(report, ['review']), 1);
  assert.equal(report.behaviorVerification, 'not-performed');
  assert.throws(() => reportExitCode(report, ['safe']), ArtifactError);
});

test('tool removal breaks, addition retains old names, output guarantee removal is unknown', () => {
  const before = artifact();
  assert.equal(compareArtifacts(before, { tools: [] }).counts.breaking, 1);
  assert.equal(compareArtifacts({ tools: [] }, before).counts.compatible, 1);
  const after = structuredClone(before);
  delete after.tools[0].outputSchema;
  assert.ok(compareArtifacts(before, after).findings.some(item => item.code === 'OUTPUT_GUARANTEE_REMOVED' && item.level === 'unknown'));
});

test('semantic set reorder is compatible and reports are deterministic', () => {
  const before = artifact(property({ type: ['string', 'integer'], enum: ['b', 'a', 0] }));
  const after = artifact(property({ type: ['integer', 'string'], enum: [0, 'a', 'b'] }));
  const report = compareArtifacts(before, after);
  assert.equal(report.counts.breaking, 0);
  assert.equal(report.counts.unknown, 0);
  assert.deepEqual(compareArtifacts(before, after), report);
});

test('rejects malformed keywords, duplicate names, partial pages, invalid UTF-8 and duplicate JSON keys', async t => {
  assert.throws(() => normalizeArtifact({ tools: [artifact().tools[0], artifact().tools[0]] }), /unique/);
  for (const nextCursor of ['next', '', null]) assert.throws(() => normalizeArtifact({ ...artifact(), nextCursor }), /Paginated/);
  assert.throws(() => normalizeArtifact(artifact(property({ type: 'mystery' }))), /invalid keyword/);
  assert.throws(() => normalizeArtifact(artifact(property({ enum: ['a', 'a'] }))), /invalid keyword/);
  assert.throws(() => normalizeArtifact(artifact(property({ maxLength: -1 }))), /invalid keyword/);
  assert.throws(() => normalizeArtifact(artifact(property({ items: [] }))), /invalid keyword/);
  assert.throws(() => normalizeArtifact({ tools: [{ ...artifact().tools[0], name: '../unsafe name' }] }), /Tool names/);
  assert.throws(() => parseArtifactJSON('{"tools":[],"t\\u006fols":[]}'), /Duplicate/);
  assert.throws(() => parseArtifactJSON('{"tools":[],"bad":1e400}'), /finite/);
  assert.throws(() => parseArtifactJSON('not-json-private-fragment'), error => !error.message.includes('private-fragment'));
  const root = await mkdtemp(join(tmpdir(), 'surface-files-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface-files-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const file = join(root, 'invalid.json');
  await writeFile(file, Buffer.from([0xff]));
  await assert.rejects(readArtifact(file), /UTF-8/);
});

test('bounds depth, size, node count, tool count, accessors and cycles before normalization', () => {
  assert.throws(() => parseArtifactJSON('['.repeat(65) + '0' + ']'.repeat(65)), /depth/);
  assert.throws(() => parseArtifactJSON(' '.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  assert.throws(() => normalizeArtifact({ tools: [], extra: Array(100001).fill(0) }), /node/);
  assert.throws(() => normalizeArtifact({ tools: Array.from({ length: 501 }, (_, i) => ({ ...artifact().tools[0], name: 't' + i })) }), /500 tools/);
  const getter = {}; Object.defineProperty(getter, 'tools', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => normalizeArtifact(getter), /accessors/);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => normalizeArtifact(cycle), /Cyclic/);
  assert.throws(() => normalizeArtifact({ tools: [], ['k'.repeat(257)]: 0 }), /256 characters/);
  let longPath = 0;
  for (let i = 0; i < 20; i++) longPath = { ['k'.repeat(256)]: longPath };
  assert.throws(() => normalizeArtifact({ tools: [], data: longPath }), /Pointer limit/);
});

test('text parsing rejects fractional or underflowing literals rounded into safe integers', () => {
  for (const literal of ['1.0000000000000001', '9007199254740991.1', '1e-400', '-1e-400']) {
    assert.throws(() => parseArtifactJSON('{"tools":[],"number":' + literal + '}'), /precision|round/i, literal);
  }
  for (const literal of ['1.0', '1e0', '10e-1', '0e-400', '-0.0', '9007199254740991']) {
    const value = parseArtifactJSON('{"tools":[],"number":' + literal + '}');
    assert.equal(value.number, Number(literal));
  }
});

test('reads regular files only and keeps file errors path-free', async t => {
  const root = await mkdtemp(join(tmpdir(), 'surface-regular-'));
  t.after(() => { assert.equal(root.startsWith(join(tmpdir(), 'surface-regular-')), true); return rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  const file = join(root, 'tools.json');
  await writeFile(file, JSON.stringify(artifact()));
  assert.deepEqual(await readArtifact(file), normalizeArtifact(artifact()));
  const directory = join(root, 'directory'); await mkdir(directory);
  await assert.rejects(readArtifact(directory), /regular file/);
  await assert.rejects(readArtifact(join(root, 'private-secret-file')), error => !error.message.includes(root) && !error.message.includes('private-secret-file'));
  if (process.platform !== 'win32') {
    const link = join(root, 'link.json'); await symlink(file, link);
    await assert.rejects(readArtifact(link), /symbolic link/);
  }
});

test('modern arbitrary output roots are explicit and inherited legacy tuple dialect remains unknown', () => {
  for (const schema of [true, false, { type: 'string' }]) assert.equal(lintArtifact(artifact(schema)).counts.unknown, 0);
  assert.equal(lintArtifact(artifact(true)).toolShapeScope, '2026-07-28');
  const legacy = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { value: { type: 'array', items: [{ type: 'string' }] } } };
  assert.ok(lintArtifact(artifact(legacy)).counts.unknown > 0);
});

test('finding and metadata truncation cannot silently pass default policy', () => {
  function largeSchema(unsupported) {
    return { type: 'object', properties: Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['group' + i, { type: 'object', properties: Object.fromEntries(Array.from({ length: 128 }, (_, j) => ['field' + j, { type: 'string', description: 'Fictional field', ...(unsupported ? { format: 'uuid' } : {}) }])) }])) };
  }
  const lint = lintArtifact(artifact(largeSchema(true)));
  assert.ok(lint.findings.length <= 2001);
  assert.ok(lint.omittedFindings > 0);
  assert.ok(lint.findings.some(finding => finding.code === 'FINDING_LIMIT'));
  assert.equal(reportExitCode(lint), 1);
  const before = artifact(largeSchema(false));
  const after = structuredClone(before);
  after.tools[0].outputSchema.properties.group16.properties.field127.description = 'Different fictional field';
  const report = compareArtifacts(before, after);
  assert.ok(report.findings.some(finding => finding.code === 'METADATA_LIMIT'));
  assert.equal(reportExitCode(report), 1);
});

test('schema property names cannot pollute prototypes and Markdown treats saved text literally', () => {
  const value = parseArtifactJSON('{"tools":[{"name":"x","inputSchema":{"type":"object","properties":{"__proto__":{"type":"string"}}},"description":"<script>evil</script>","annotations":{"readOnlyHint":true}}]}');
  const normalized = normalizeArtifact(value);
  assert.equal(Object.hasOwn(normalized.tools[0].inputSchema.properties, '__proto__'), true);
  assert.equal({}.polluted, undefined);
  const report = lintArtifact(value);
  report.findings[0].message = '<script>|[click](https://example.invalid)\nnext';
  assert.doesNotMatch(renderMarkdown(report), /<script>|\[click\]/);
});

test('independent Ajv2020 finite oracle checks matcher semantics and representative inclusion proofs', () => {
  const schemas = [true, false, {}, { type: 'string' }, { type: 'integer' }, { type: 'number' }, { type: 'integer', minimum: 0, maximum: 1 }, { enum: [0, 1] }, { type: 'array', items: { type: 'integer' }, maxItems: 2 }, { type: 'array', items: true, uniqueItems: true }, { type: 'object', additionalProperties: false }, property({ type: 'integer' }), property({ enum: [0, 1] }, []), { type: 'object', properties: { value: { type: 'integer' } } }];
  const values = [null, false, true, -1, 0, 1, 2, 0.5, '', 'a', [], [0], [0, 0], [0, 1], ['a'], {}, { value: 0 }, { value: 2 }, { value: 'a' }, { extra: 0 }, { value: 0, extra: 1 }];
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validators = schemas.map(schema => ajv.compile(schema));
  for (let i = 0; i < schemas.length; i++) for (const value of values) assert.equal(matches(value, schemas[i]), validators[i](value), JSON.stringify({ schema: schemas[i], value }));
  for (let i = 0; i < schemas.length; i++) for (let j = 0; j < schemas.length; j++) {
    const source = schemas[i]; const target = schemas[j];
    const result = compareSchemas(source, target, workBudget());
    if (result === 'compatible') assert.ok(values.every(value => !validators[i](value) || validators[j](value)), JSON.stringify({ source, target }));
  }
});
