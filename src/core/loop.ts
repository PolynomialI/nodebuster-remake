// Fixed 60 Hz simulation, rendering once per animation frame.
// The original runs gameplay in Godot's _process/_physics_process at 60 Hz, so a
// fixed 1/60 s step reproduces its timings independently of the display rate.

export const HZ = 60;
export const STEP = 1 / HZ;

export class FixedLoop {
  private acc = 0;
  private last = -1;
  private raf = 0;
  /** Simulation seconds elapsed since start. */
  time = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
    private readonly maxStepsPerFrame = 8,
  ) {}

  start(): void {
    const frame = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.last = -1;
  }

  /** Advance by wall-clock time (ms timestamp). Exposed for tests. */
  frame(nowMs: number): number {
    if (this.last < 0) this.last = nowMs;
    // Clamp long pauses (tab in background) so the game doesn't fast-forward.
    this.acc += Math.min((nowMs - this.last) / 1000, 0.25);
    this.last = nowMs;
    let steps = 0;
    while (this.acc >= STEP - 1e-9 && steps < this.maxStepsPerFrame) {
      this.update(STEP);
      this.time += STEP;
      this.acc -= STEP;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.acc = 0;
    this.render();
    return steps;
  }

  /** Run the simulation for a number of seconds without rendering (headless tests). */
  run(seconds: number): void {
    const n = Math.round(seconds * HZ);
    for (let i = 0; i < n; i++) {
      this.update(STEP);
      this.time += STEP;
    }
  }
}
