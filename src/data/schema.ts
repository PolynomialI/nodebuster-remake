// Tiny runtime validator for the content/*.json files. Each checker returns the
// value typed, or throws a SchemaError naming the JSON path that is wrong, so a
// typo in a data file fails loudly at load (and in the unit tests).

export class SchemaError extends Error {}

export type Check<T> = (v: unknown, path: string) => T;

const fail = (path: string, msg: string): never => {
  throw new SchemaError(`${path}: ${msg}`);
};

export const num: Check<number> = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? v : fail(p, `expected a number, got ${JSON.stringify(v)}`));
export const int: Check<number> = (v, p) => (Number.isInteger(v) ? (v as number) : fail(p, `expected an integer, got ${JSON.stringify(v)}`));
export const str: Check<string> = (v, p) => (typeof v === 'string' ? v : fail(p, `expected a string, got ${JSON.stringify(v)}`));
export const bool: Check<boolean> = (v, p) => (typeof v === 'boolean' ? v : fail(p, `expected true/false, got ${JSON.stringify(v)}`));
export const any: Check<unknown> = (v) => v;

export function oneOf<T extends string | number>(...options: T[]): Check<T> {
  return (v, p) => (options.includes(v as T) ? (v as T) : fail(p, `expected one of ${options.join(', ')}, got ${JSON.stringify(v)}`));
}

export function optional<T>(c: Check<T>): Check<T | undefined> {
  return (v, p) => (v === undefined ? undefined : c(v, p));
}

export function nullable<T>(c: Check<T>): Check<T | null> {
  return (v, p) => (v === null ? null : c(v, p));
}

export function arr<T>(c: Check<T>, opts: { min?: number; len?: number } = {}): Check<T[]> {
  return (v, p) => {
    if (!Array.isArray(v)) return fail(p, 'expected an array');
    if (opts.len !== undefined && v.length !== opts.len) fail(p, `expected ${opts.len} items, got ${v.length}`);
    if (opts.min !== undefined && v.length < opts.min) fail(p, `expected at least ${opts.min} items`);
    return v.map((x, i) => c(x, `${p}[${i}]`));
  };
}

export function record<T>(c: Check<T>): Check<Record<string, T>> {
  return (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'expected an object');
    const out: Record<string, T> = {};
    for (const [k, x] of Object.entries(v)) out[k] = c(x, `${p}.${k}`);
    return out;
  };
}

type Shape = Record<string, Check<unknown>>;
type FromShape<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> };

/** Object with known keys. Unknown keys are allowed (e.g. "src" provenance notes). */
export function obj<S extends Shape>(shape: S): Check<FromShape<S>> {
  return (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(p, 'expected an object');
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = { ...src };
    for (const [k, c] of Object.entries(shape)) out[k] = c(src[k], `${p}.${k}`);
    return out as FromShape<S>;
  };
}

/** A pair [x, y] of numbers. */
export const vec2: Check<[number, number]> = (v, p) => arr(num, { len: 2 })(v, p) as [number, number];
