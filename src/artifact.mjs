import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export const LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, depth: 64, nodes: 100000, tools: 500, string: 65536, key: 256, pointer: 4096, enum: 256, properties: 256 });
export const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export class ArtifactError extends Error { constructor(message) { super(message); this.name = 'ArtifactError'; } }
export const own = (object, key) => Object.hasOwn(object, key);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const pointer = key => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
export const sortJSON = value => Array.isArray(value) ? value.map(sortJSON) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJSON(value[key])])) : value;
export const stableJSON = value => JSON.stringify(sortJSON(value));
export const equalJSON = (a, b) => stableJSON(a) === stableJSON(b);

function boundTree(value) {
  let nodes = 0;
  const seen = new Set();
  function visit(item, depth, pathLength = 0) {
    if (++nodes > LIMITS.nodes) throw new ArtifactError('Artifact exceeds the 100000-node limit.');
    if (depth > LIMITS.depth) throw new ArtifactError('Artifact exceeds the 64-level depth limit.');
    if (pathLength > LIMITS.pointer) throw new ArtifactError('Artifact exceeds the 4096-character JSON Pointer limit.');
    if (typeof item === 'string' && item.length > LIMITS.string) throw new ArtifactError('A string exceeds the 65536-character limit.');
    if (typeof item === 'number' && (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))) throw new ArtifactError('Numbers must be finite; integer values must be within the safe integer range.');
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return;
    if (typeof item !== 'object') throw new ArtifactError('Artifacts must contain only JSON values.');
    if (seen.has(item)) throw new ArtifactError('Cyclic object references are not JSON artifacts.');
    seen.add(item);
    if (Reflect.ownKeys(item).some(key => typeof key === 'symbol')) throw new ArtifactError('Artifact objects cannot contain symbol keys.');
    if (Array.isArray(item) && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) throw new ArtifactError('Artifact arrays must be dense and contain no extra properties.');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new ArtifactError('Artifact objects must be plain JSON objects.');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue;
      if (descriptor.get || descriptor.set) throw new ArtifactError('Artifact accessors are not supported.');
      if (!descriptor.enumerable) throw new ArtifactError('Artifact properties must be enumerable JSON data.');
      if (key.length > LIMITS.key) throw new ArtifactError('Object keys must be at most 256 characters.');
      visit(descriptor.value, depth + 1, pathLength + 1 + pointer(key).length);
    }
    seen.delete(item);
  }
  visit(value, 1);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > LIMITS.bytes) throw new ArtifactError('Artifact exceeds the 2 MiB limit.');
}

// Scan before JSON.parse to bound nesting and reject duplicate object keys,
// including escaped aliases. Syntax itself remains the native parser's job.
function exactSafeInteger(token, number) {
  const parts = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!parts) return true; // The native parser reports invalid number syntax.
  const fraction = parts[3] ?? '';
  let digits = (parts[2] + fraction).replace(/^0+/, '');
  if (!digits) return number === 0;
  let scale = Number(parts[4] ?? 0) - fraction.length;
  const trimmed = digits.replace(/0+$/, '');
  scale += digits.length - trimmed.length;
  digits = trimmed;
  if (!Number.isSafeInteger(scale) || scale < 0) return false;
  const expected = String(Math.abs(number));
  if (digits.length + scale !== expected.length || (parts[1] === '-') !== (number < 0)) return false;
  return digits + '0'.repeat(scale) === expected;
}
export function parseArtifactJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > LIMITS.bytes) throw new ArtifactError('Artifact exceeds the 2 MiB limit.');
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '"') break;
      }
      const context = stack.at(-1);
      if (context?.object && context.key) {
        let key;
        try { key = JSON.parse(text.slice(start, i + 1)); } catch { throw new ArtifactError('Artifact is not valid JSON.'); }
        if (context.keys.has(key)) throw new ArtifactError('Duplicate JSON object keys are not supported.');
        context.keys.add(key);
        context.key = false;
      }
    } else if (char === '{' || char === '[') {
      stack.push({ object: char === '{', key: char === '{', keys: new Set() });
      if (stack.length > LIMITS.depth) throw new ArtifactError('Artifact exceeds the 64-level depth limit.');
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (char === '-' || (char >= '0' && char <= '9')) {
      const start = i;
      while (i + 1 < text.length && /[0-9eE+.-]/.test(text[i + 1])) i++;
      const token = text.slice(start, i + 1);
      const number = Number(token);
      if (Number.isSafeInteger(number) && !exactSafeInteger(token, number)) throw new ArtifactError('JSON number loses precision by rounding into a safe integer. Use exact safe integer constraints.');
    }
  }
  let value;
  try { value = JSON.parse(text); } catch { throw new ArtifactError('Artifact is not valid JSON.'); }
  boundTree(value);
  return value;
}

export async function readArtifact(file) {
  let handle;
  try {
    if (typeof file !== 'string' || /^(?:\\\\|\/\/)/.test(file)) throw new ArtifactError('Use a local filesystem path; network-share paths are not supported.');
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink()) throw new ArtifactError('Artifact must be a regular file, not a symbolic link.');
    if (before.size > LIMITS.bytes) throw new ArtifactError('Artifact exceeds the 2 MiB limit.');
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new ArtifactError('Artifact changed while being opened. Retry with a stable regular file.');
    const chunks = [];
    let total = 0;
    while (total <= LIMITS.bytes) {
      const chunk = Buffer.alloc(Math.min(65536, LIMITS.bytes + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total > LIMITS.bytes) throw new ArtifactError('Artifact exceeds the 2 MiB limit.');
    const after = await handle.stat();
    const finalPath = await lstat(file);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || finalPath.isSymbolicLink() || finalPath.dev !== opened.dev || finalPath.ino !== opened.ino) throw new ArtifactError('Artifact changed while being read. Retry with a stable regular file.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new ArtifactError('Artifact must be valid UTF-8.'); }
    return normalizeArtifact(parseArtifactJSON(text));
  } catch (error) {
    if (error instanceof ArtifactError) throw error;
    throw new ArtifactError('Artifact could not be read. Check the file path and permissions.');
  } finally { await handle?.close(); }
}

const TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
const COUNTS = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains'];
const NUMBERS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
const MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SINGLES = ['items', 'additionalProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems'];
const ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
export function schemaChildren(schema) {
  if (!isObject(schema)) return [];
  const children = [];
  for (const key of MAPS) if (isObject(schema[key])) for (const [name, value] of Object.entries(schema[key])) children.push(['/' + pointer(key) + '/' + pointer(name), value]);
  for (const key of SINGLES) if (own(schema, key) && (isObject(schema[key]) || typeof schema[key] === 'boolean')) children.push(['/' + key, schema[key]]);
  for (const key of ARRAYS) if (Array.isArray(schema[key])) schema[key].forEach((value, i) => children.push(['/' + key + '/' + i, value]));
  return children;
}
function schemaShape(schema, path, inheritedModern = true) {
  if (typeof schema === 'boolean') return;
  if (!isObject(schema)) throw new ArtifactError(path + ' must be a schema object or boolean.');
  const invalid = key => { throw new ArtifactError(path + '/' + pointer(key) + ' has an invalid keyword value.'); };
  const modern = schema.$schema ? [DIALECT, DIALECT + '#'].includes(schema.$schema) : inheritedModern;
  if (own(schema, 'type')) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.length || types.some(type => !TYPES.has(type)) || new Set(types).size !== types.length) invalid('type');
  }
  if (own(schema, 'enum') && (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > LIMITS.enum || new Set(schema.enum.map(stableJSON)).size !== schema.enum.length)) invalid('enum');
  if (own(schema, 'required') && (!Array.isArray(schema.required) || schema.required.some(key => typeof key !== 'string') || new Set(schema.required).size !== schema.required.length)) invalid('required');
  for (const key of COUNTS) if (own(schema, key) && (!Number.isSafeInteger(schema[key]) || schema[key] < 0)) invalid(key);
  for (const key of NUMBERS) if (own(schema, key) && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || (key === 'multipleOf' && schema[key] <= 0))) invalid(key);
  for (const key of ['$schema', '$id', '$ref', '$dynamicRef', '$anchor', '$dynamicAnchor', 'title', 'description', 'pattern', 'format', 'contentEncoding', 'contentMediaType']) if (own(schema, key) && typeof schema[key] !== 'string') invalid(key);
  for (const key of ['uniqueItems', 'readOnly', 'writeOnly', 'deprecated']) if (own(schema, key) && typeof schema[key] !== 'boolean') invalid(key);
  for (const key of MAPS) if (own(schema, key) && (!isObject(schema[key]) || Object.keys(schema[key]).length > LIMITS.properties)) invalid(key);
  for (const key of ARRAYS) if (own(schema, key) && (!Array.isArray(schema[key]) || (key !== 'prefixItems' && !schema[key].length))) invalid(key);
  // Unknown dialects may use tuple "items"; lint reports them as unknown without
  // pretending that draft-07 syntax is invalid under its own declared dialect.
  for (const key of SINGLES) if (own(schema, key) && !isObject(schema[key]) && typeof schema[key] !== 'boolean' && !(key === 'items' && !modern && Array.isArray(schema[key]))) invalid(key);
  for (const [suffix, child] of schemaChildren(schema)) schemaShape(child, path + suffix, modern);
}

export function normalizeArtifact(value) {
  boundTree(value);
  if (!isObject(value) || own(value, 'error')) throw new ArtifactError('Expected a complete tools/list result object.');
  const result = own(value, 'tools') ? value : value.result;
  if (!isObject(result) || !Array.isArray(result.tools)) throw new ArtifactError('Expected {tools:[...]} or a result envelope containing it.');
  if (own(result, 'nextCursor')) throw new ArtifactError('Paginated artifacts are incomplete. Collect every page and omit nextCursor from the merged result.');
  if (result.tools.length > LIMITS.tools) throw new ArtifactError('At most 500 tools are supported.');
  const names = new Set();
  for (const tool of result.tools) {
    if (!isObject(tool) || typeof tool.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) throw new ArtifactError('Tool names must use 1-128 ASCII letters, numbers, underscores, periods, or hyphens.');
    if (names.has(tool.name)) throw new ArtifactError('Tool names must be unique and case-sensitive.');
    names.add(tool.name);
    for (const key of ['title', 'description']) if (own(tool, key) && typeof tool[key] !== 'string') throw new ArtifactError('Tool ' + key + ' must be a string.');
    if (!isObject(tool.inputSchema) || tool.inputSchema.type !== 'object') throw new ArtifactError('Each inputSchema must be an object schema with type object.');
    schemaShape(tool.inputSchema, '/inputSchema');
    if (own(tool, 'outputSchema')) schemaShape(tool.outputSchema, '/outputSchema');
    if (own(tool, 'annotations')) {
      if (!isObject(tool.annotations)) throw new ArtifactError('Tool annotations must be an object.');
      for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) if (own(tool.annotations, key) && typeof tool.annotations[key] !== 'boolean') throw new ArtifactError('Tool annotation hints must be booleans.');
      if (own(tool.annotations, 'title') && typeof tool.annotations.title !== 'string') throw new ArtifactError('Tool annotation title must be a string.');
    }
  }
  return sortJSON({ ...result, tools: [...result.tools].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) });
}
