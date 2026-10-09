import type { JsonObject, JsonValue } from './model.js';

/** Shared lossless JSON and in-memory validation budget. */
export const JSON_LIMITS = Object.freeze({ depth: 64, nodes: 1_000_000, containerEntries: 100_000, stringLength: 1_048_576, textUnits: 16_777_216 });

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Iterative, cycle-aware inspection; never invokes getters or toJSON. */
export function jsonProblem(value: unknown): string | undefined {
  const stack: Array<{ value: unknown; depth: number; leave?: boolean }> = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let nodes = 0;
  let textUnits = 0;
  while (stack.length > 0) {
    const item = stack.pop()!;
    const current = item.value;
    if (item.leave) { ancestors.delete(current as object); continue; }
    if (++nodes > JSON_LIMITS.nodes || item.depth > JSON_LIMITS.depth) return 'JSON depth or node budget exceeded.';
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      textUnits += current.length;
      if (textUnits > JSON_LIMITS.textUnits) return 'JSON cumulative text budget exceeded.';
      if (current.length > JSON_LIMITS.stringLength) return 'JSON string budget exceeded.';
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'JSON numbers must be finite.';
      continue;
    }
    if (typeof current !== 'object') return 'Values must be lossless JSON (no undefined, bigint, functions or symbols).';
    if (!Array.isArray(current) && !isPlainRecord(current)) return 'JSON objects must have a plain or null prototype.';
    if (ancestors.has(current)) return 'JSON cycles are not supported.';
    const keys = Reflect.ownKeys(current);
    if (keys.length > JSON_LIMITS.containerEntries + (Array.isArray(current) ? 1 : 0)) return 'JSON container budget exceeded.';
    if (Array.isArray(current) && (current.length > JSON_LIMITS.containerEntries || keys.length !== current.length + 1)) {
      return 'JSON arrays must be dense and have no extra properties.';
    }
    ancestors.add(current);
    stack.push({ value: current, depth: item.depth, leave: true });
    for (const key of keys) {
      if (Array.isArray(current) && key === 'length') continue;
      if (typeof key !== 'string' || key.length > JSON_LIMITS.stringLength) return 'JSON property names must be bounded strings.';
      textUnits += key.length;
      if (textUnits > JSON_LIMITS.textUnits) return 'JSON cumulative text budget exceeded.';
      if (Array.isArray(current) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= current.length)) return 'JSON arrays must have only indexed elements.';
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) return 'JSON properties must be enumerable data properties.';
      stack.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
  return undefined;
}

export function isJsonValue(value: unknown): value is JsonValue { return jsonProblem(value) === undefined; }
export function isJsonObject(value: unknown): value is JsonObject { return isPlainRecord(value) && isJsonValue(value); }
export function ownValue(values: Record<string, any>, key: string): any {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}
