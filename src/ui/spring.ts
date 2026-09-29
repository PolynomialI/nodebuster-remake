// Port of the original's Spring.gd / Springer.gd (damped springs used for every
// "squash", "pop" and wobble in the UI and effects).
import { content } from '../data/content';

export class Spring {
  v = 0;
  killed = false;
  min = -999999;
  max = 999999;

  constructor(
    public x: number,
    public stiffness: number,
    public damping: number,
    public target = x,
  ) {}

  update(dt: number): void {
    dt = Math.min(content.effects.springs.maxDt, dt);
    const a = -this.stiffness * (this.x - this.target) - this.damping * this.v;
    this.v += a * dt;
    this.x = Math.min(Math.max(this.x + this.v * dt, this.min), this.max);
    if (Math.abs(a) <= 0.0001) this.killed = true;
  }

  pull(force: number): this {
    this.x += force;
    return this;
  }

  range(min: number, max: number): this {
    this.min = min;
    this.max = max;
    return this;
  }
}

/** A value that can be sprung: reuses its spring like Springer does per target+property. */
export class SpringValue {
  private spring: Spring | null = null;

  constructor(readonly rest: number) {}

  get value(): number {
    return this.spring ? this.spring.x : this.rest;
  }

  /** Springer.scale / spring_property: pull by force towards rest. */
  pull(force: number, stiffness: number, damping: number, rest = this.rest): Spring {
    if (!this.spring) this.spring = new Spring(rest, stiffness, damping);
    const s = this.spring;
    s.target = rest;
    s.stiffness = stiffness;
    s.damping = damping;
    s.killed = false;
    s.min = -999999;
    s.max = 999999;
    return s.pull(force);
  }

  update(dt: number): void {
    const s = this.spring;
    if (!s) return;
    s.update(dt);
    if (s.killed) this.spring = null;
  }
}
