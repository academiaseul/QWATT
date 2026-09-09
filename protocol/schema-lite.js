/**
 * QWATT — minimal JSON Schema checker
 * ---------------------------------------------------------------------------
 * Enough of draft 2020-12 to validate protocol/interval.schema.json without a
 * dependency: type, required, properties, additionalProperties, enum, minimum,
 * minLength, pattern, format:date-time, oneOf, $ref into $defs.
 * Zero dependencies so it runs on a bare Pi and in CI without an install step.
 */

'use strict';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === 'number') return t === 'number' || t === 'integer';
  if (want === 'integer') return t === 'integer';
  return t === want;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error('only local $ref supported: ' + ref);
  return ref.slice(2).split('/').reduce((o, k) => o[k], root);
}

/** @returns {string[]} list of errors, empty when valid */
function validate(value, schema, root = schema, path = '$') {
  const errs = [];
  if (schema.$ref) return validate(value, resolveRef(schema.$ref, root), root, path);

  if (schema.oneOf) {
    const hits = schema.oneOf.filter((s) => validate(value, s, root, path).length === 0).length;
    if (hits !== 1) errs.push(`${path}: matches ${hits} of oneOf, expected exactly 1`);
    return errs;
  }

  if (schema.type && !typeMatches(schema.type, value)) {
    errs.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errs.push(`${path}: not finite`);
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: ${value} < minimum ${schema.minimum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: does not match /${schema.pattern}/`);
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) errs.push(`${path}: not a date-time`);
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}: missing required "${k}"`);
    const props = schema.properties || {};
    for (const k of Object.keys(value)) {
      if (props[k]) errs.push(...validate(value[k], props[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unexpected property "${k}"`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  }
  return errs;
}

module.exports = { validate };
