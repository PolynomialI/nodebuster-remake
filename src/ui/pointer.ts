// Mouse dispatch for widgets: hover goes to the topmost registered target under
// the pointer; a click fires on release over the target that was pressed
// (Godot Button, action mode "release"). Mouse locks are global, like the
// original's Globals.mouse_locks + MouseBlocker (transitions, popups sliding in,
// right-drag panning, the ending): while any is held nothing can be hovered.
import { LMB, type Input } from '../core/input';
import type { Interactive } from './widgets';

const mouseLocks = new Set<unknown>();

export function lockMouse(holder: unknown): void {
  mouseLocks.add(holder);
}

export function unlockMouse(holder: unknown): void {
  mouseLocks.delete(holder);
}

export function isMouseLocked(): boolean {
  return mouseLocks.size > 0;
}

export function clearMouseLocks(): void {
  mouseLocks.clear();
}

export class Pointer {
  private targets: Interactive[] = [];
  hovered: Interactive | null = null;
  private pressed: Interactive | null = null;

  register<T extends Interactive>(t: T): T {
    this.targets.push(t);
    return t;
  }

  /** Register below everything registered so far (lowest hover priority). */
  registerFirst(...ts: Interactive[]): void {
    this.targets.unshift(...ts);
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

  get locked(): boolean {
    return isMouseLocked();
  }

  update(input: Input, blocked = false): void {
    const { x, y } = input.mouse;
    let top: Interactive | null = null;
    if (!this.locked && !blocked && input.hasPointer) {
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
    if (input.pressed.has(LMB) && this.hovered && !this.locked && !blocked) {
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
