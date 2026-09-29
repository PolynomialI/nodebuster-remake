// Game shell: owns the display, the fixed-step loop, input, saves and the
// current scene. Scenes are swapped with setScene().
import * as assets from './assets';
import { Input } from './core/input';
import { FixedLoop } from './core/loop';
import { openSaveStore, type SaveStore } from './core/save';
import { PixelFont } from './render/pixelfont';
import { Screen } from './render/screen';
import { loadTextures, type TextureMap } from './render/textures';
import { BootScene } from './scenes/boot';
import type { Scene } from './scenes/scene';

export class Game {
  readonly input = new Input();
  readonly loop: FixedLoop;
  scene!: Scene;
  audioContext: AudioContext | null = null;

  private constructor(
    readonly screen: Screen,
    readonly font: PixelFont,
    readonly textures: TextureMap,
    readonly store: SaveStore,
  ) {
    this.loop = new FixedLoop(
      (dt) => {
        this.scene.update(dt);
        this.input.endStep();
      },
      () => {
        this.scene.draw?.();
        this.screen.render();
      },
    );
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const [screen, font, textures, store] = await Promise.all([
      Screen.create(canvas),
      PixelFont.load(assets.fonts.main),
      loadTextures(assets.images),
      openSaveStore(),
    ]);
    const game = new Game(screen, font, textures, store);
    game.input.attach(screen);
    new ResizeObserver(() => screen.resize()).observe(canvas);
    window.addEventListener('resize', () => screen.resize());
    return game;
  }

  setScene(scene: Scene): void {
    const old = this.scene;
    this.scene = scene;
    this.screen.gameRoot.removeChildren();
    this.screen.gameRoot.addChild(scene.root);
    old?.destroy?.();
    old?.root.destroy({ children: true });
  }

  start(): void {
    const boot = new BootScene(this.font);
    boot.status = `save: ${this.store.primary}`;
    this.setScene(boot);
    this.input.onFirstGesture = () => {
      // Audio can only start inside the gesture.
      try {
        this.audioContext = new AudioContext();
        void this.audioContext.resume();
      } catch {
        this.audioContext = null;
      }
      boot.status = 'started';
    };
    this.loop.start();
  }

  /** Test hooks (Playwright reads these through window.__nb). */
  debugApi() {
    return {
      scene: () => this.scene.name,
      saveBackend: () => this.store.primary,
      audioState: () => this.audioContext?.state ?? 'none',
      raw: () => Array.from(this.screen.readRaw()),
      size: () => ({ w: this.screen.width, h: this.screen.height, scale: this.screen.scale }),
    };
  }
}
