import { DIALECT, own, isObject, equalJSON, stableJSON, schemaChildren, pointer } from './artifact.mjs';

export const METADATA = new Set(['title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly', '$comment', '$id']);
const SUPPORTED = new Set([...METADATA, '$schema', 'type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'uniqueItems']);
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? Number.isInteger(value) ? 'integer' : 'number' : typeof value;
function types(schema) {
  if (typeof schema === 'boolean' || !schema.type) return new Set(['null', 'boolean', 'object', 'array', 'integer', 'number', 'string']);
  const result = new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (result.has('number')) result.add('integer');
  return result;
}
function fractional(value) {
  if (typeof value === 'number') return !Number.isSafeInteger(value);
  return value !== null && typeof value === 'object' && Object.values(value).some(fractional);
}

export function schemaUnknowns(schema, path = '', inheritedDialect = DIALECT) {
  const findings = [];
  function walk(item, location, inherited) {
    if (typeof item === 'boolean' || findings.length >= 2000) return;
    const dialect = item.$schema ?? inherited;
    if (![DIALECT, DIALECT + '#'].includes(dialect)) findings.push({ path: location + '/$schema', code: 'UNSUPPORTED_DIALECT', message: 'Only the JSON Schema 2020-12 comparison fragment is supported.' });
    for (const key of Object.keys(item)) {
      if (findings.length >= 2000) break;
      if (!SUPPORTED.has(key)) findings.push({ path: location + '/' + pointer(key), code: 'UNSUPPORTED_KEYWORD', message: 'Schema keyword is outside the supported comparison fragment; no references or expressions are executed.' });
      if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'enum', 'const'].includes(key) && fractional(item[key])) findings.push({ path: location + '/' + pointer(key), code: 'NUMERIC_PRECISION_UNKNOWN', message: 'Constraint numbers must be safe integers for compatibility proof; fractional numeric constraints are unknown.' });
    }
    for (const [suffix, child] of schemaChildren(item)) walk(child, location + suffix, dialect);
  }
  walk(schema, path, inheritedDialect);
  if (findings.length >= 2000) findings.push({ path, code: 'SCHEMA_LINT_LIMIT', message: 'Schema lint finding limit reached; unsupported details may be omitted.' });
  return findings;
}

export function metadata(schema, path = '') {
  const values = new Map();
  values.truncated = false;
  function walk(item, location) {
    if (typeof item === 'boolean' || values.truncated) return;
    for (const key of METADATA) if (own(item, key)) {
      if (values.size >= 2000) { values.truncated = true; return; }
      values.set(location + '/' + pointer(key), item[key]);
    }
    for (const [suffix, child] of schemaChildren(item)) walk(child, location + suffix);
  }
  walk(schema, path);
  return values;
}

export class WorkLimit extends Error {}
export function workBudget(limit = 500000) {
  let remaining = limit;
  return () => { if (--remaining < 0) throw new WorkLimit('Comparison work limit reached.'); };
}

export function matches(value, schema, tick = () => {}) {
  tick();
  if (typeof schema === 'boolean') return schema;
  if (!types(schema).has(typeOf(value))) return false;
  if (own(schema, 'const') && !equalJSON(value, schema.const)) return false;
  if (schema.enum && !schema.enum.some(item => equalJSON(item, value))) return false;
  if (typeof value === 'number') {
    if (own(schema, 'minimum') && value < schema.minimum) return false;
    if (own(schema, 'maximum') && value > schema.maximum) return false;
    if (own(schema, 'exclusiveMinimum') && value <= schema.exclusiveMinimum) return false;
    if (own(schema, 'exclusiveMaximum') && value >= schema.exclusiveMaximum) return false;
  } else if (typeof value === 'string') {
    const length = [...value].length;
    if (length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity)) return false;
  } else if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.uniqueItems && new Set(value.map(stableJSON)).size !== value.length) return false;
    if (!value.every(item => matches(item, schema.items ?? true, tick))) return false;
  } else if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length < (schema.minProperties ?? 0) || keys.length > (schema.maxProperties ?? Infinity)) return false;
    if ((schema.required ?? []).some(key => !own(value, key))) return false;
    const properties = schema.properties ?? {};
    for (const key of keys) if (!matches(value[key], own(properties, key) ? properties[key] : schema.additionalProperties ?? true, tick)) return false;
  }
  return true;
}

function range(schema, integer) {
  let low = schema.minimum ?? -Infinity; let lowOpen = false;
  let high = schema.maximum ?? Infinity; let highOpen = false;
  if (own(schema, 'exclusiveMinimum') && schema.exclusiveMinimum >= low) { low = schema.exclusiveMinimum; lowOpen = true; }
  if (own(schema, 'exclusiveMaximum') && schema.exclusiveMaximum <= high) { high = schema.exclusiveMaximum; highOpen = true; }
  if (integer) {
    low = Number.isFinite(low) ? (lowOpen ? Math.floor(low) + 1 : Math.ceil(low)) : low;
    high = Number.isFinite(high) ? (highOpen ? Math.ceil(high) - 1 : Math.floor(high)) : high;
    lowOpen = false; highOpen = false;
  }
  return { low, high, lowOpen, highOpen };
}
function boundSubset(source, target, lower, upper) {
  return (source[lower] ?? 0) >= (target[lower] ?? 0) && (source[upper] ?? Infinity) <= (target[upper] ?? Infinity);
}
function numericSubset(source, target, integer) {
  const s = range(source, integer); const t = range(target, integer);
  if (s.low > s.high || (s.low === s.high && (s.lowOpen || s.highOpen))) return true;
  return (s.low > t.low || (s.low === t.low && (s.lowOpen || !t.lowOpen))) && (s.high < t.high || (s.high === t.high && (s.highOpen || !t.highOpen)));
}

// A sufficient inclusion proof, not a complete schema solver. A failed proof
// alone never becomes "breaking"; a supported-fragment witness must validate.
export function proveSubset(source, target, tick) {
  tick();
  if (source === false || target === true) return true;
  if (target === false) return source === false;
  if (source === true) source = {};
  const finite = own(source, 'const') ? [source.const] : source.enum;
  if (finite) return finite.every(value => !matches(value, source, tick) || matches(value, target, tick));
  if (own(target, 'const') || target.enum) return false;
  const sourceTypes = types(source); const targetTypes = types(target);
  if ([...sourceTypes].some(type => !targetTypes.has(type))) return false;
  for (const type of sourceTypes) {
    if (['integer', 'number'].includes(type) && !numericSubset(source, target, type === 'integer')) return false;
    if (type === 'string' && !boundSubset(source, target, 'minLength', 'maxLength')) return false;
    if (type === 'array') {
      if (!boundSubset(source, target, 'minItems', 'maxItems')) return false;
      if (target.uniqueItems && !source.uniqueItems && (source.maxItems ?? Infinity) > 1) return false;
      if ((source.maxItems ?? Infinity) > 0 && !proveSubset(source.items ?? true, target.items ?? true, tick)) return false;
    }
    if (type === 'object') {
      if (!boundSubset(source, target, 'minProperties', 'maxProperties')) return false;
      const required = new Set(source.required ?? []);
      if ((target.required ?? []).some(key => !required.has(key))) return false;
      const sProperties = source.properties ?? {}; const tProperties = target.properties ?? {};
      for (const key of new Set([...Object.keys(sProperties), ...Object.keys(tProperties)])) {
        const s = own(sProperties, key) ? sProperties[key] : source.additionalProperties ?? true;
        const t = own(tProperties, key) ? tProperties[key] : target.additionalProperties ?? true;
        if (!proveSubset(s, t, tick)) return false;
      }
      if (!proveSubset(source.additionalProperties ?? true, target.additionalProperties ?? true, tick)) return false;
    }
  }
  return true;
}

function candidates(source, target, tick, depth = 0) {
  tick();
  if (typeof source === 'boolean') return [null, false, true, 0, 1, -1, 0.5, '', 'x', {}, [], [0]];
  if (depth > 16) return [null, false, 0, '', {}, []];
  const s = isObject(source) ? source : {}; const t = isObject(target) ? target : {};
  const result = [];
  const add = value => { if (result.length < 128) result.push(value); };
  // proveSubset already checks every finite source value; try the ones the
  // target rejects first so a removed value late in a long enum is a witness.
  const finite = own(s, 'const') ? [s.const] : s.enum ?? [];
  for (const value of finite) if (!matches(value, typeof target === 'boolean' ? target : t, tick)) add(value);
  for (const schema of [s, t]) {
    if (own(schema, 'const')) add(schema.const);
    for (const value of (schema.enum ?? []).slice(0, 32)) add(value);
  }
  if (types(s).has('object')) {
    const properties = s.properties ?? {};
    const entries = [];
    let possible = true;
    for (const key of s.required ?? []) {
      const child = own(properties, key) ? properties[key] : s.additionalProperties ?? true;
      const value = candidates(child, own(t.properties ?? {}, key) ? t.properties[key] : true, tick, depth + 1).find(value => matches(value, child, tick));
      if (value === undefined) { possible = false; break; }
      entries.push([key, value]);
    }
    if (possible) {
      const base = Object.fromEntries(entries);
      add(base);
      const keys = [...new Set([...Object.keys(properties), ...Object.keys(t.properties ?? {})])];
      let extra = '__mcp_surface_extra__';
      while (keys.includes(extra)) extra += '_';
      keys.push(extra);
      for (const key of keys) {
        if (result.length >= 128) break;
        const child = own(properties, key) ? properties[key] : s.additionalProperties ?? true;
        const other = own(t.properties ?? {}, key) ? t.properties[key] : t.additionalProperties ?? true;
        const choices = candidates(child, other, tick, depth + 1);
        const counterexample = choices.find(value => matches(value, child, tick) && !matches(value, other, tick));
        const prioritized = counterexample === undefined ? choices.slice(0, 8) : [counterexample, ...choices.slice(0, 8)];
        for (const value of prioritized) add(Object.fromEntries([...Object.entries(base).filter(([name]) => name !== key), [key, value]]));
      }
    }
  }
  if (types(s).has('array')) {
    const child = s.items ?? true;
    const choices = candidates(child, t.items ?? true, tick, depth + 1).filter(value => matches(value, child, tick)).slice(0, 8);
    const sizes = new Set([0, 1, 2, s.minItems ?? 0, t.minItems ?? 0, (t.maxItems ?? 0) + 1, s.maxItems ?? 0]);
    for (const length of sizes) if (length >= 0 && length <= 32) {
      if (!length) add([]);
      else for (const choice of choices) add(Array(length).fill(choice));
      if (choices.length >= length) add(choices.slice(0, length));
    }
  }
  for (const schema of [s, t]) {
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) if (own(schema, key)) for (const number of [schema[key], schema[key] - 1, schema[key] + 1, schema[key] - 0.5, schema[key] + 0.5]) if (Number.isFinite(number)) add(number);
    for (const key of ['minLength', 'maxLength']) if (own(schema, key)) for (const length of [schema[key], schema[key] - 1, schema[key] + 1]) if (length >= 0 && length <= 1024) add('x'.repeat(length));
  }
  for (const value of [null, false, true, 0, 1, -1, 0.5, '', 'x', {}, [], [0]]) add(value);
  return result;
}

export function compareSchemas(source, target, tick) {
  if (proveSubset(source, target, tick)) return 'compatible';
  for (const candidate of candidates(source, target, tick)) if (matches(candidate, source, tick) && !matches(candidate, target, tick)) return 'breaking';
  return 'unknown';
}
