import type { Container } from 'pixi.js';

/** A screen of the game (boot, main menu, shop, battle). Updated at a fixed 60 Hz. */
export interface Scene {
  readonly name: string;
  readonly root: Container;
  update(dt: number): void;
  /** Called once per rendered frame before drawing (optional visual sync). */
  draw?(): void;
  destroy?(): void;
  /** BaseScene.setup(): called once the transition into the scene has finished. */
  setup?(): void;
}
