// Timing and curves of the look layer that can be checked without a GPU.
import { describe, expect, it } from 'vitest';
import { scaleCurve } from '../../src/render/bgParticles';
import { Anim } from '../../src/render/transition';

describe('scene transition sprite (AnimatedSprite2D, 16 frames at 28 fps)', () => {
  it('shows each frame for 2-3 steps at 60 Hz and finishes on the 35th step', () => {
    const a = new Anim();
    a.play();
    const frames: number[] = [];
    let finished = -1;
    for (let step = 1; step <= 40 && finished < 0; step++) {
      if (a.step(1 / 60)) finished = step;
      else frames.push(a.frame);
    }
    expect(frames.slice(0, 8)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(frames[frames.length - 1]).toBe(15);
    expect(finished).toBe(35);
  });
});

describe('background particle scale curve (BgParticles.tscn Curve_skmwi)', () => {
  it('rises from 0 to 1 at 0.52381 and falls back to 0', () => {
    expect(scaleCurve(0)).toBe(0);
    expect(scaleCurve(0.52381)).toBeCloseTo(1, 6);
    expect(scaleCurve(1)).toBe(0);
    expect(scaleCurve(0.25)).toBeGreaterThan(0.5);
    expect(scaleCurve(0.8)).toBeGreaterThan(0.3);
    for (let x = 0.01; x < 0.52; x += 0.01) expect(scaleCurve(x + 0.01)).toBeGreaterThanOrEqual(scaleCurve(x) - 1e-9);
  });
});
