// Pointer, wheel and keyboard state in game coordinates (480x270).
// Edges (pressed/released/wheel/motion) accumulate between simulation steps and
// are cleared after each step, so a click is seen by exactly one step.
import type { Screen } from '../render/screen';

export const LMB = 0;
export const RMB = 2;

export class Input {
  mouse = { x: 240, y: 135 };
  /** Whether the pointer has ever been over the game (the reticle waits for it). */
  hasPointer = false;
  readonly down = new Set<number>();
  readonly pressed = new Set<number>();
  readonly released = new Set<number>();
  readonly keys = new Set<string>();
  readonly keysPressed = new Set<string>();
  wheel = 0;
  motion = { x: 0, y: 0 };
  /** Set by the first pointer press anywhere (used to unlock audio). */
  onFirstGesture: (() => void) | null = null;

  attach(screen: Screen): void {
    const c = screen.canvas;
    const move = (e: PointerEvent) => {
      const p = screen.toGame(e.clientX, e.clientY);
      if (this.hasPointer) {
        this.motion.x += p.x - this.mouse.x;
        this.motion.y += p.y - this.mouse.y;
      }
      this.mouse = p;
      this.hasPointer = true;
    };
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerdown', (e) => {
      move(e);
      c.focus();
      if (e.pointerType !== 'mouse') this.motion = { x: 0, y: 0 };
      this.down.add(e.button);
      this.pressed.add(e.button);
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // Not all pointers can be captured.
      }
      const g = this.onFirstGesture;
      if (g) {
        this.onFirstGesture = null;
        g();
      }
      e.preventDefault();
    });
    const up = (e: PointerEvent) => {
      move(e);
      if (this.down.delete(e.button)) this.released.add(e.button);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      // Typing in the save dialog is not game input.
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      for (const b of this.down) this.released.add(b);
      this.down.clear();
    });
  }

  endStep(): void {
    this.pressed.clear();
    this.released.clear();
    this.keysPressed.clear();
    this.wheel = 0;
    this.motion.x = this.motion.y = 0;
  }
}
