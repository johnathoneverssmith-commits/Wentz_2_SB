import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  throw new Error('Non-JSON value');
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const schemas = Object.fromEntries(['backlog','plan','review','implementation','event','state'].map(kind =>
  [kind, JSON.parse(readFileSync(new URL(`../../.agent-loop/schemas/${kind}.schema.json`, import.meta.url), 'utf8'))]));

// Only the small, explicitly supported schema vocabulary used by our contracts.
export function checkSchema(schema, value, path = '$') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { checkSchema(s,value,path); return true; } catch { return false; } })) throw new Error(`${path}: no valid variant`);
    return;
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type === 'integer' ? !Number.isSafeInteger(value) : schema.type !== type) throw new Error(`${path}: wrong type`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: invalid enum`);
  if (schema.const !== undefined && value !== schema.const) throw new Error(`${path}: invalid constant`);
  if (type === 'string' && (value.length > (schema.maxLength ?? 10000) || value.length < (schema.minLength ?? 0) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) throw new Error(`${path}: invalid string`);
  if (type === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) throw new Error(`${path}: invalid number`);
  if (type === 'array') {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 1000)) throw new Error(`${path}: invalid array size`);
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) throw new Error(`${path}: duplicates`);
    value.forEach((v,i) => checkSchema(schema.items,v,`${path}[${i}]`));
  }
  if (type === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${path}: invalid object`);
    for (const k of schema.required ?? []) if (!Object.hasOwn(value,k)) throw new Error(`${path}: missing ${k}`);
    for (const [k,v] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(k)) throw new Error(`${path}: unsafe key`);
      const child = schema.properties?.[k] ?? schema.additionalProperties;
      if (!child || child === true) throw new Error(`${path}: unknown ${k}`);
      checkSchema(child,v,`${path}.${k}`);
    }
  }
}
export function validate(kind, value) {
  if (!Object.hasOwn(schemas,kind)) throw new Error('Unknown contract');
  checkSchema(schemas[kind],value);
  if (kind === 'backlog') {
    const ids = value.tasks.map(t => t.id);
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate task');
    for (const t of value.tasks) {
      if (new Set(t.requirements.map(r=>r.id)).size !== t.requirements.length) throw new Error('Duplicate requirement');
      if (t.dependencies.some(id=>!ids.includes(id) || id===t.id)) throw new Error('Unknown/self dependency');
    }
    const visiting=new Set(), done=new Set();
    function visit(id) { if(visiting.has(id))throw new Error('Dependency cycle');if(done.has(id))return;visiting.add(id);value.tasks.find(t=>t.id===id).dependencies.forEach(visit);visiting.delete(id);done.add(id); }
    ids.forEach(visit);
  }
  if (kind === 'review' && value.verdict === 'accept' && value.findings.length) throw new Error('Accepted review has findings');
  if (kind === 'review' && new Set(value.findings.map(f=>f.id)).size !== value.findings.length) throw new Error('Duplicate finding');
  return value;
}
