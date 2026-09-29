// Mouse dispatch for widgets: hover goes to the topmost registered target under
// the pointer; a click fires on release over the target that was pressed
// (Godot Button, action mode "release"). A lock count stands in for the
// original's MouseBlocker (transitions, popups sliding in).
import { LMB, type Input } from '../core/input';
import type { Interactive } from './widgets';

export class Pointer {
  private targets: Interactive[] = [];
  hovered: Interactive | null = null;
  private pressed: Interactive | null = null;
  private locks = 0;

  register<T extends Interactive>(t: T): T {
    this.targets.push(t);
    return t;
  }

  unregister(t: Interactive): void {
    this.targets = this.targets.filter((x) => x !== t);
    if (this.hovered === t) this.hovered = null;
    if (this.pressed === t) this.pressed = null;
  }

  clear(): void {
    this.targets = [];
    this.hovered = null;
    this.pressed = null;
  }

  lock(): void {
    this.locks++;
  }

  unlock(): void {
    this.locks = Math.max(0, this.locks - 1);
  }

  get locked(): boolean {
    return this.locks > 0;
  }

  update(input: Input): void {
    const { x, y } = input.mouse;
    let top: Interactive | null = null;
    if (!this.locked && input.hasPointer) {
      for (let i = this.targets.length - 1; i >= 0; i--) {
        if (this.targets[i].contains(x, y)) {
          top = this.targets[i];
          break;
        }
      }
    }
    if (top !== this.hovered) {
      this.hovered?.onExit();
      this.hovered = top;
      top?.onEnter();
    }
    if (input.pressed.has(LMB) && this.hovered && !this.locked) {
      this.pressed = this.hovered;
      this.hovered.onDown();
    }
    if (input.released.has(LMB) && this.pressed) {
      const p = this.pressed;
      this.pressed = null;
      p.onUp();
      if (this.hovered === p) p.onClick();
    }
  }
}
