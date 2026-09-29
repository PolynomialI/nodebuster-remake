// Pixi compiles shaders without eval (the artifact page's CSP may forbid it).
import 'pixi.js/unsafe-eval';
// The display: the game draws into a 480x270 render texture (nearest filtering),
// which is shown integer-scaled and centred on the canvas, like the original's
// SubViewport in a window with stretch mode canvas_items / scale mode integer.
// Post-processing (glow, CRT) runs on the full canvas afterwards.
import { Application, Container, Filter, RenderTexture, Sprite, TextureSource, type Texture } from 'pixi.js';

export const W = 480;
export const H = 270;

TextureSource.defaultOptions.scaleMode = 'nearest';

export class Screen {
  readonly gameRoot = new Container();
  /** Drawn over the scaled game at window resolution (CRT and friends attach here). */
  readonly post = new Container();
  readonly rt: RenderTexture;
  readonly view: Sprite;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;

  private constructor(
    readonly app: Application,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.rt = RenderTexture.create({ width: W, height: H, scaleMode: 'nearest', resolution: 1, antialias: false });
    this.view = new Sprite(this.rt);
    this.post.addChild(this.view);
    app.stage.addChild(this.post);
  }

  static async create(canvas: HTMLCanvasElement): Promise<Screen> {
    const app = new Application();
    await app.init({
      canvas,
      preference: 'webgl',
      antialias: false,
      background: '#000000',
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
      powerPreference: 'high-performance',
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
    });
    app.ticker.stop();
    const s = new Screen(app, canvas);
    s.resize();
    return s;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (cw !== this.width || ch !== this.height) this.app.renderer.resize(cw, ch);
    this.width = cw;
    this.height = ch;
    const fit = Math.min(cw / W, ch / H);
    // Integer scale like the original; a screen smaller than 480x270 falls back to a fractional fit.
    this.scale = fit >= 1 ? Math.floor(fit) : fit;
    this.offsetX = Math.floor((cw - W * this.scale) / 2);
    this.offsetY = Math.floor((ch - H * this.scale) / 2);
    this.view.scale.set(this.scale);
    this.view.position.set(this.offsetX, this.offsetY);
    for (const f of (this.post.filters ?? []) as Filter[]) (f as Filter & { onResize?: (s: Screen) => void }).onResize?.(this);
  }

  /** Client (CSS pixel) coordinates to game coordinates. */
  toGame(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.width / Math.max(1, r.width);
    return {
      x: ((clientX - r.left) * dpr - this.offsetX) / this.scale,
      y: ((clientY - r.top) * dpr - this.offsetY) / this.scale,
    };
  }

  render(): void {
    const r = this.app.renderer;
    r.render({ container: this.gameRoot, target: this.rt, clear: true, clearColor: [0, 0, 0, 1] });
    r.render({ container: this.app.stage, clear: true, clearColor: [0, 0, 0, 1] });
  }

  /** The window image at window resolution (the original's root viewport texture). */
  snapshot(): Texture {
    const rt = RenderTexture.create({ width: this.width, height: this.height, scaleMode: 'nearest', resolution: 1, antialias: false });
    this.app.renderer.render({ container: this.app.stage, target: rt, clear: true, clearColor: [0, 0, 0, 1] });
    return rt;
  }

  /** The 480x270 game image as RGBA bytes (tests compare it with the original's viewport). */
  readRaw(): Uint8ClampedArray {
    return this.app.renderer.extract.pixels({ target: this.rt }).pixels as Uint8ClampedArray;
  }
}
