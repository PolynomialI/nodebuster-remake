// res://Scenes/Effects/BgParticles.tscn: a GPUParticles2D of grey (0.17) circles.
// No velocity or gravity; each particle respawns at a random point of a 960x540
// box around the emitter every 10 s, lives 10 s x (1 - 0.4 x random), and its
// scale (0.1-0.2 of the 32 px circle) follows the scale curve (a rise and fall).
// Preprocess 10 s: the field starts in its steady state.
import { Container, Sprite } from 'pixi.js';
import { tex } from '../ui/ctx';

const LIFETIME = 10;
const RANDOMNESS = 0.4;
const EXTENTS = { x: 480, y: 270 };
const SCALE = [0.1, 0.2];
const TINT = 0x2b2b2b; // self_modulate 0.17

/** Curve_skmwi: (0,0) t+2.55165, (0.52381,1) t0, (1,0) t-3.22178, Godot's Bezier segments. */
export function scaleCurve(x: number): number {
  const seg = (ax: number, ay: number, at: number, bx: number, by: number, bt: number, u: number) => {
    const d = (bx - ax) / 3;
    const c1 = ay + d * at;
    const c2 = by - d * bt;
    const s = 1 - u;
    return s * s * s * ay + 3 * s * s * u * c1 + 3 * s * u * u * c2 + u * u * u * by;
  };
  if (x <= 0) return 0;
  if (x >= 1) return 0;
  if (x < 0.52381) return seg(0, 0, 2.55165, 0.52381, 1, 0, x / 0.52381);
  return seg(0.52381, 1, 0, 1, 0, -3.22178, (x - 0.52381) / (1 - 0.52381));
}

/** A small deterministic hash -> [0,1) for (particle, cycle, channel). */
function rand(i: number, cycle: number, k: number, seed: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(cycle + 7, 0x85ebca77) ^ Math.imul(k + 13, 0xc2b2ae3d) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class BgParticles {
  readonly view = new Container();
  private sprites: Sprite[] = [];
  private cycles: number[] = [];
  private time = LIFETIME;

  constructor(
    readonly amount = 96,
    private seed = (Math.random() * 2 ** 32) | 0,
  ) {
    const t = tex('particle/circle');
    for (let i = 0; i < amount; i++) {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.tint = TINT;
      s.visible = false;
      this.view.addChild(s);
      this.sprites.push(s);
      this.cycles.push(-1);
    }
    this.view.position.set(240, 135);
    this.update(0);
  }

  /** Emitter position (local_coords: the particles move with it). */
  setPosition(x: number, y: number): void {
    this.view.position.set(x, y);
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = 0; i < this.amount; i++) {
      const s = this.sprites[i];
      const phase = (i / this.amount) * LIFETIME;
      const since = this.time - phase;
      if (since < 0) {
        s.visible = false;
        continue;
      }
      const cycle = Math.floor(since / LIFETIME);
      const age = since - cycle * LIFETIME;
      if (cycle !== this.cycles[i]) {
        this.cycles[i] = cycle;
        s.position.set((rand(i, cycle, 0, this.seed) * 2 - 1) * EXTENTS.x, (rand(i, cycle, 1, this.seed) * 2 - 1) * EXTENTS.y);
      }
      const life = LIFETIME * (1 - rand(i, cycle, 2, this.seed) * RANDOMNESS);
      if (age >= life) {
        s.visible = false;
        continue;
      }
      const base = SCALE[0] + (SCALE[1] - SCALE[0]) * rand(i, cycle, 3, this.seed);
      const k = base * scaleCurve(age / life);
      s.visible = k > 0;
      s.scale.set(k);
    }
  }
}
