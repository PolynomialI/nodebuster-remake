// Pixi compiles shaders without eval (the artifact page's CSP may forbid it).
import 'pixi.js/unsafe-eval';
// The display: Pixi draws the game into a 480x270 render texture (nearest
// filtering) on an offscreen canvas, like the original's SubViewport. The visible
// canvas belongs to Post, which shows it integer-scaled and centred with the
// original's glow, CRT and glitch passes.
import { Application, BufferImageSource, Container, RenderTexture, Sprite, Texture, TextureSource } from 'pixi.js';
import { Post, type PostFrame } from './post';

export const W = 480;
export const H = 270;

TextureSource.defaultOptions.scaleMode = 'nearest';

export class Screen {
  readonly gameRoot = new Container();
  readonly rt: RenderTexture;
  private readonly blit: Sprite;
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  width = 0;
  height = 0;
  /** Largest integer scale allowed (the window_size option), 0 = fit the window. */
  maxScale = 0;
  readonly frame: PostFrame = { crt: true, glowIntensity: 1.8, time: 0, glitch: { visible: false, shake: 0 } };

  private constructor(
    readonly app: Application,
    readonly canvas: HTMLCanvasElement,
    readonly post: Post,
  ) {
    this.rt = RenderTexture.create({ width: W, height: H, scaleMode: 'nearest', resolution: 1, antialias: false });
    this.blit = new Sprite(this.rt);
  }

  static async create(canvas: HTMLCanvasElement): Promise<Screen> {
    const post = new Post(canvas);
    const offscreen = document.createElement('canvas');
    offscreen.width = W;
    offscreen.height = H;
    const app = new Application();
    await app.init({
      canvas: offscreen,
      preference: 'webgl',
      antialias: false,
      background: '#000000',
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
      preserveDrawingBuffer: true,
      width: W,
      height: H,
    });
    app.ticker.stop();
    const s = new Screen(app, canvas, post);
    s.resize();
    return s;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    this.width = cw;
    this.height = ch;
    const fit = Math.min(cw / W, ch / H);
    // Integer scale like the original; a screen smaller than 480x270 falls back to a fractional fit.
    let scale = fit >= 1 ? Math.floor(fit) : fit;
    if (this.maxScale > 0 && scale > this.maxScale) scale = this.maxScale;
    this.scale = scale;
    this.post.resize(cw, ch, scale);
    this.offsetX = this.post.offsetX;
    this.offsetY = this.post.offsetY;
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
    r.render({ container: this.blit, clear: true, clearColor: [0, 0, 0, 1] });
    this.post.render(this.app.canvas as HTMLCanvasElement, this.frame);
  }

  /** The 480x270 game image before glow, as RGBA bytes (compared with the original's .rawng.png). */
  readRaw(): Uint8ClampedArray {
    return this.app.renderer.extract.pixels({ target: this.rt }).pixels as Uint8ClampedArray;
  }

  /** The window image as last drawn (Refs.main_scn.get_viewport().get_texture()), as a Pixi texture. */
  snapshot(): Texture {
    const { w, h, data } = this.post.readWindow();
    return new Texture({ source: new BufferImageSource({ resource: data, width: w, height: h, scaleMode: 'nearest' }) });
  }
}
