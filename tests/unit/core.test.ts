import { describe, expect, it } from 'vitest';
import { FixedLoop, HZ, STEP } from '../../src/core/loop';
import { Rng } from '../../src/core/rng';
import { MemoryBackend, SaveStore, exportSaveString, importSaveString } from '../../src/core/save';
import { SchemaError, arr, int, num, obj, oneOf, optional, str } from '../../src/data/schema';

describe('Rng', () => {
  it('is reproducible from its seed and its saved state', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    const c = new Rng(7);
    c.next();
    const saved = c.state;
    const x = c.next();
    c.state = saved;
    expect(c.next()).toBe(x);
  });

  it('draws within the requested ranges', () => {
    const r = new Rng(1);
    for (let i = 0; i < 2000; i++) {
      const v = r.range(18, 22);
      expect(v).toBeGreaterThanOrEqual(18);
      expect(v).toBeLessThan(22);
      const n = r.int(0, 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(3);
      const p = r.inRadius(84);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(84);
      expect([-1, 1]).toContain(r.sign());
    }
  });

  it('chance(0) never fires and chance(1) always does', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });

  it('weighted picks follow the weights', () => {
    const r = new Rng(9);
    const counts = { Square: 0, SmallSquare: 0, BigSquare: 0 };
    const w = { Square: 0.86, SmallSquare: 0.1, BigSquare: 0.04 };
    for (let i = 0; i < 20000; i++) counts[r.weighted(w)]++;
    expect(counts.Square / 20000).toBeCloseTo(0.86, 1);
    expect(counts.BigSquare / 20000).toBeCloseTo(0.04, 1);
  });
});

describe('FixedLoop', () => {
  it('steps at 60 Hz regardless of frame timing', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {});
    loop.frame(0);
    for (let t = 7; t <= 1000; t += 7) loop.frame(t); // ~143 fps display
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('clamps long pauses instead of fast-forwarding', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => {}, 100);
    loop.frame(0);
    loop.frame(10_000);
    expect(steps).toBe(Math.floor(0.25 * HZ));
  });

  it('run() advances simulation time exactly', () => {
    let t = 0;
    const loop = new FixedLoop((dt) => (t += dt), () => {});
    loop.run(45);
    expect(t).toBeCloseTo(45, 9);
    expect(STEP).toBeCloseTo(1 / 60, 12);
  });
});

describe('SaveStore', () => {
  it('reads from the first backend that has the key and writes to all', async () => {
    const a = new MemoryBackend();
    const b = new MemoryBackend();
    const store = new SaveStore([a, b]);
    await b.set('save', '{"x":1}');
    expect(await store.get('save')).toBe('{"x":1}');
    await store.set('save', '{"x":2}');
    expect(await a.get('save')).toBe('{"x":2}');
    expect(await b.get('save')).toBe('{"x":2}');
  });

  it('keeps working when one backend throws', async () => {
    const broken = { name: 'db' as const, get: async () => { throw new Error('offline'); }, set: async () => { throw new Error('offline'); } };
    const mem = new MemoryBackend();
    const store = new SaveStore([broken, mem]);
    await store.set('save', 'v');
    expect(await store.get('save')).toBe('v');
  });

  it('round-trips export strings and rejects damaged ones', () => {
    const json = JSON.stringify({ version: 1, state: { bits: 12345, name: 'ünïcødé' } });
    const s = exportSaveString(json);
    expect(s.startsWith('NBR1:')).toBe(true);
    expect(importSaveString(`  ${s}\n`)).toBe(json);
    expect(() => importSaveString('hello')).toThrow(/NBR1/);
    const broken = s.slice(0, -4) + (s.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => importSaveString(broken)).toThrow(/damaged/);
  });
});

describe('schema', () => {
  const node = obj({ id: str, maxLevel: int, currency: oneOf('bits', 'nodes'), costs: arr(num, { min: 1 }), note: optional(str) });
  it('accepts valid data and keeps extra keys', () => {
    const v = node({ id: 'Damage1', maxLevel: 15, currency: 'bits', costs: [1, 2], src: 'x' }, 'nodes[0]');
    expect(v.id).toBe('Damage1');
    expect((v as Record<string, unknown>).src).toBe('x');
  });
  it('names the path of a bad value', () => {
    expect(() => node({ id: 'X', maxLevel: 1.5, currency: 'bits', costs: [1] }, 'nodes[3]')).toThrow(SchemaError);
    expect(() => node({ id: 'X', maxLevel: 1, currency: 'gold', costs: [1] }, 'nodes[3]')).toThrow(/nodes\[3\]\.currency/);
    expect(() => node({ id: 'X', maxLevel: 1, currency: 'bits', costs: [] }, 'n')).toThrow(/at least 1/);
  });
});
