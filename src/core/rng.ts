// Seeded RNG (mulberry32). The simulation draws every random number from one
// of these so a run is reproducible from its seed; visuals use a separate one.
// Helpers mirror the Godot calls used by the original (randf_range,
// randi_range, Utils.wflip, Utils.flipi, Utils.rand_in_radius, pull_weighted).

export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0;
  }

  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Godot randf_range(a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Godot randi_range(a, b), inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** Utils.wflip: true `chance` of the time. A chance of 0 never fires. */
  chance(chance: number): boolean {
    return chance > 0 && this.next() <= chance;
  }

  /** Utils.flipi: -1 or 1. */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Utils.rand_in_radius: uniform point in a disc. */
  inRadius(radius: number): { x: number; y: number } {
    const r = Math.sqrt(this.next()) * radius;
    const t = this.next() * Math.PI * 2;
    return { x: r * Math.cos(t), y: r * Math.sin(t) };
  }

  /** Utils.pull_weighted: a key chosen by its weight (insertion order matters). */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    const keys = Object.keys(weights) as K[];
    let sum = 0;
    for (const k of keys) sum += weights[k];
    let r = this.next() * sum;
    for (const k of keys) {
      if (r < weights[k]) return k;
      r -= weights[k];
    }
    return keys[0];
  }
}
