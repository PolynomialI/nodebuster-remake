// The original's screen pipeline (Godot 4.2 Mobile renderer), in raw WebGL2 on the
// visible canvas. Pixi draws the 480x270 game into its own canvas; per frame:
//
//   game image ─► 10-bit linear buffer ─► glow + tonemap (the SubViewport shares the
//   WorldEnvironment) ─► integer upscale into the window content ─► CRT overlay ─►
//   glitch overlay (ending) ─► glow + tonemap again at window resolution ─► canvas.
//
// Glow follows blur_raster.glsl and tonemap.glsl as extracted from the Godot 4.2.2
// binary; the buffer layout was fitted to captures of the original (tests/visual/
// probes.json): level 0's horizontal pass runs at half width and full height,
// later levels at the destination size; blur samples outside the texture read as
// black; the tonemap upsamples glow bicubically (desktop default).
import { content } from '../data/content';

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
vec3 q10(vec3 v) { return floor(clamp(v, 0.0, 1.0) * 1023.0 + 0.5) / 1023.0; }
vec3 s2l(vec3 c) { return mix(pow((c + vec3(0.055)) * (1.0 / 1.055), vec3(2.4)), c * (1.0 / 12.92), lessThan(c, vec3(0.04045))); }
vec3 l2s(vec3 c) {
  c = clamp(c, vec3(0.0), vec3(1.0));
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - vec3(0.055), 12.92 * c, lessThan(c, vec3(0.0031308)));
}
`;

/** Canvas image -> RGB10A2 linear / luminance multiplier (copy_to_fb with FLAG_LINEAR). */
const QUANTIZE = `${COMMON}
uniform sampler2D uSrc;
void main() {
  vec3 c = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).rgb;
  o = vec4(q10(s2l(c) / 2.0), 1.0);
}`;

const BILINEAR_BLACK = `
uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
vec3 fetchB(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uSrcSize.x || p.y >= uSrcSize.y) return vec3(0.0);
  return texelFetch(uSrc, p, 0).rgb;
}
vec3 bil(vec2 uv) {
  vec2 t = uv * vec2(uSrcSize) - 0.5;
  vec2 fl = floor(t);
  vec2 f = t - fl;
  ivec2 i = ivec2(fl);
  vec3 a = fetchB(i), b = fetchB(i + ivec2(1, 0)), c = fetchB(i + ivec2(0, 1)), d = fetchB(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

/** blur_raster.glsl MODE_GAUSSIAN_GLOW, horizontal (+ first-pass threshold). */
const BLUR_H = `${COMMON}${BILINEAR_BLACK}
uniform vec2 uDst;
uniform vec2 uVp;
uniform int uFirst;
uniform float uStrength, uThreshold, uScale, uCap;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  float ps = 0.5 / uVp.x;
  vec3 c = bil(uv) * 0.174938;
  float w[3] = float[3](0.165569, 0.140367, 0.106595);
  for (int k = 1; k <= 3; k++) {
    float a = uv.x + float(k) * ps;
    float b = uv.x - float(k) * ps;
    if (a <= 1.0) c += bil(vec2(a, uv.y)) * w[k - 1];
    if (b >= 0.0) c += bil(vec2(b, uv.y)) * w[k - 1];
  }
  c *= uStrength;
  if (uFirst == 1) {
    c *= 2.0;
    float lum = max(c.r, max(c.g, c.b));
    float fb = smoothstep(uThreshold, uThreshold + uScale, lum);
    c = min(c * fb, vec3(uCap)) / 2.0;
  }
  o = vec4(q10(c), 1.0);
}`;

/** blur_raster.glsl MODE_GAUSSIAN_GLOW, vertical. */
const BLUR_V = `${COMMON}${BILINEAR_BLACK}
uniform vec2 uDst;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  float ps = 1.0 / uDst.y;
  vec3 c = bil(uv) * 0.288713;
  float w[2] = float[2](0.233062, 0.122581);
  for (int k = 1; k <= 2; k++) {
    float a = uv.y + float(k) * ps;
    float b = uv.y - float(k) * ps;
    if (a <= 1.0) c += bil(vec2(uv.x, a)) * w[k - 1];
    if (b >= 0.0) c += bil(vec2(uv.x, b)) * w[k - 1];
  }
  o = vec4(q10(c), 1.0);
}`;

/** tonemap.glsl: linear tonemapper, sRGB conversion, additive glow converted separately. */
const TONEMAP = `${COMMON}
uniform sampler2D uInternal;
uniform sampler2D uL0, uL1;
uniform vec2 uS0, uS1;
uniform float uW0, uW1, uIntensity;
uniform vec2 uSize;
float w0(float a) { return (1.0 / 6.0) * (a * (a * (-a + 3.0) - 3.0) + 1.0); }
float w1(float a) { return (1.0 / 6.0) * (a * a * (3.0 * a - 6.0) + 4.0); }
float w2(float a) { return (1.0 / 6.0) * (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0); }
float w3(float a) { return (1.0 / 6.0) * (a * a * a); }
float g0(float a) { return w0(a) + w1(a); }
float g1(float a) { return w2(a) + w3(a); }
float h0(float a) { return -1.0 + w1(a) / (w0(a) + w1(a)); }
float h1(float a) { return 1.0 + w3(a) / (w2(a) + w3(a)); }
vec3 bicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 px = 1.0 / size;
  uv = uv * size + 0.5;
  vec2 iuv = floor(uv);
  vec2 f = fract(uv);
  vec2 p0 = (vec2(iuv.x + h0(f.x), iuv.y + h0(f.y)) - 0.5) * px;
  vec2 p1 = (vec2(iuv.x + h1(f.x), iuv.y + h0(f.y)) - 0.5) * px;
  vec2 p2 = (vec2(iuv.x + h0(f.x), iuv.y + h1(f.y)) - 0.5) * px;
  vec2 p3 = (vec2(iuv.x + h1(f.x), iuv.y + h1(f.y)) - 0.5) * px;
  return g0(f.y) * (g0(f.x) * textureLod(tex, p0, 0.0).rgb + g1(f.x) * textureLod(tex, p1, 0.0).rgb) +
         g1(f.y) * (g0(f.x) * textureLod(tex, p2, 0.0).rgb + g1(f.x) * textureLod(tex, p3, 0.0).rgb);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 col = l2s(texelFetch(uInternal, ivec2(gl_FragCoord.xy), 0).rgb * 2.0);
  vec3 g = bicubic(uL0, uv, uS0) * uW0 + bicubic(uL1, uv, uS1) * uW1;
  col += l2s(g * uIntensity * 2.0);
  o = vec4(col, 1.0);
}`;

/** SubViewportContainer: the game image at an integer scale (nearest). */
const UPSCALE = `${COMMON}
uniform sampler2D uSrc;
uniform float uScale;
void main() { o = texelFetch(uSrc, ivec2(floor(gl_FragCoord.xy / uScale)), 0); }`;

/** res://Shaders/CRTShader.gdshader (bloom omitted: threshold 1.0 on an 8-bit screen copy is always 0). */
const CRT = `${COMMON}
uniform sampler2D uScreen;
uniform vec2 uSize;
uniform float uTime;
uniform float wobble_speed, wobble_frequency, wobble_strength, fisheye, brighten, scanline_count,
  scanline_movespeed, horizontal_scanline_strength, vertical_scanline_strength, chromatic, ghosting, vignette;
uniform vec3 edge_color;
vec2 uv_curve(vec2 uv) {
  uv = (uv - 0.5) * 2.0;
  uv.x *= 1.0 + pow(abs(uv.y) * fisheye, 3.0);
  uv.y *= 1.0 + pow(abs(uv.x) * fisheye, 3.0);
  return uv / 2.0 + 0.5;
}
void main() {
  vec2 screen_uv = gl_FragCoord.xy / uSize;
  vec2 px = 1.0 / uSize;
  vec2 uv = uv_curve(screen_uv);
  float x = sin(wobble_speed * uTime + uv.y * wobble_frequency * 14.0) * sin(wobble_speed * 2.5 * uTime + uv.y * wobble_frequency * 20.0) * 0.004 * wobble_strength;
  vec2 cuv = uv + vec2(x, 0.0);
  float r = texture(uScreen, cuv + px.x * vec2(chromatic, chromatic)).r + 0.05;
  float g = texture(uScreen, cuv + px.x * vec2(chromatic, -chromatic)).g + 0.05;
  float b = texture(uScreen, cuv + px.x * vec2(-chromatic, -chromatic)).b + 0.05;
  vec3 col = vec3(r, g, b);
  col.r += ghosting * texture(uScreen, vec2(x + uv.x - 0.025, uv.y - 0.025)).r;
  col.g += ghosting * texture(uScreen, vec2(x + uv.x - 0.022, uv.y - 0.02)).g;
  col.b += ghosting * texture(uScreen, vec2(x + uv.x - 0.02, uv.y - 0.018)).b;
  col *= 1.0 + brighten;
  float s = sin(scanline_movespeed * uTime + uv.y * scanline_count * 3.14159265358979 * 2.0);
  s = (s * 0.2 + 0.5) * 0.9 + 0.1;
  col *= vec3(pow(s, horizontal_scanline_strength * 0.5));
  float grid_uv = mod(screen_uv.x / px.x, 3.0);
  vec3 gc;
  gc.r = clamp(1.0 - grid_uv, 0.0, 1.0) + clamp(grid_uv - 2.0, 0.0, 1.0);
  gc.g = clamp(1.0 - abs(1.0 - grid_uv), 0.0, 1.0);
  gc.b = 1.0 - gc.r - gc.g;
  col *= clamp(normalize(clamp(gc, 0.5 - vertical_scanline_strength, 1.0)), vec3(0.0), vec3(1.0));
  float vig = 20.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  col *= vec3(pow(vig, vignette));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = edge_color;
  o = vec4(col, 1.0);
}`;

/** res://Shaders/GlitchScreenShader.gdshader (Yui Kinomoto, MIT). */
const GLITCH = `${COMMON}
uniform sampler2D uScreen;
uniform vec2 uSize;
uniform float uTime;
uniform float shake_power, shake_rate, shake_speed, shake_block_size, shake_color_rate;
float random(float seed) { return fract(543.2543 * sin(dot(vec2(seed, seed), vec2(3525.46, -54.3415)))); }
void main() {
  vec2 screen_uv = gl_FragCoord.xy / uSize;
  float enable_shift = float(random(trunc(uTime * shake_speed)) < shake_rate);
  vec2 fixed_uv = screen_uv;
  fixed_uv.x += (random(trunc(screen_uv.y * shake_block_size) / shake_block_size + uTime) - 0.5) * shake_power * enable_shift;
  vec4 c = textureLod(uScreen, fixed_uv, 0.0);
  c.r = mix(c.r, textureLod(uScreen, fixed_uv + vec2(shake_color_rate, 0.0), 0.0).r, enable_shift);
  c.b = mix(c.b, textureLod(uScreen, fixed_uv + vec2(-shake_color_rate, 0.0), 0.0).b, enable_shift);
  o = c;
}`;

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

interface Glow {
  internal: Target;
  halves: Target[];
  levels: Target[];
}

export interface PostFrame {
  crt: boolean;
  glowIntensity: number;
  time: number;
  glitch: { visible: boolean; shake: number };
}

export class Post {
  readonly gl: WebGL2RenderingContext;
  private progs = new Map<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }>();
  private vao: WebGLVertexArrayObject;
  private game: WebGLTexture;
  private gameGlow: Glow;
  private gameOut: Target;
  private win: { w: number; h: number; screen: Target; crt: Target; glitch: Target; glow: Glow; final: Target } | null = null;
  canvasW = 0;
  canvasH = 0;
  scale = 1;
  offsetX = 0;
  offsetY = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    for (const [k, src] of Object.entries({ QUANTIZE, BLUR_H, BLUR_V, TONEMAP, UPSCALE, CRT, GLITCH })) this.progs.set(k, this.compile(src));
    this.game = this.texture(480, 270, gl.RGBA8, gl.NEAREST);
    this.gameGlow = this.glowTargets(480, 270);
    this.gameOut = this.target(480, 270, gl.RGBA8, gl.NEAREST);
  }

  private compile(fs: string) {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    return { p, u: new Map<string, WebGLUniformLocation | null>() };
  }

  private texture(w: number, h: number, fmt: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number, fmt: number, filter: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h, fmt, filter);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private free(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  /** Buffers for one glow computation over a w x h image (levels 0..4). */
  private glowTargets(w: number, h: number): Glow {
    const gl = this.gl;
    const internal = this.target(w, h, gl.RGB10_A2, gl.NEAREST);
    const halves: Target[] = [];
    const levels: Target[] = [];
    for (let i = 0; i < 5; i++) {
      const vw = Math.max(1, w >> (i + 1));
      const vh = Math.max(1, h >> (i + 1));
      // Level 0's horizontal pass runs at half width and full height; later ones at the level's size.
      halves.push(this.target(vw, i === 0 ? h : vh, gl.RGB10_A2, gl.NEAREST));
      levels.push(this.target(vw, vh, gl.RGB10_A2, gl.LINEAR));
    }
    return { internal, halves, levels };
  }

  private freeGlow(g: Glow): void {
    this.free(g.internal);
    for (const t of [...g.halves, ...g.levels]) this.free(t);
  }

  private uni(prog: { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }, name: string): WebGLUniformLocation | null {
    let l = prog.u.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(prog.p, name);
      prog.u.set(name, l);
    }
    return l;
  }

  /** One full-screen pass into `dst` (null: the canvas, drawn at the letterbox rect). */
  private pass(name: string, dst: Target | null, textures: Record<string, WebGLTexture>, uniforms: Record<string, number | number[]>): void {
    const gl = this.gl;
    const prog = this.progs.get(name)!;
    gl.useProgram(prog.p);
    let unit = 0;
    for (const [k, t] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(this.uni(prog, k), unit++);
    }
    for (const [k, v] of Object.entries(uniforms)) {
      const l = this.uni(prog, k);
      if (!l) continue;
      if (typeof v === 'number') {
        if (k === 'uFirst') gl.uniform1i(l, v);
        else gl.uniform1f(l, v);
      } else if (k === 'uSrcSize') gl.uniform2i(l, v[0], v[1]);
      else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
      else gl.uniform3f(l, v[0], v[1], v[2]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    if (dst) gl.viewport(0, 0, dst.w, dst.h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 10-bit linear copy, glow levels 0..4, tonemap into `out`. */
  private glow(src: WebGLTexture, g: Glow, out: Target, intensity: number): void {
    const glow = content.post.glow as unknown as { strength: number; hdrThreshold: number; hdrLuminanceCap: number; levels: number[]; normalized: boolean };
    const w = g.internal.w;
    const h = g.internal.h;
    this.pass('QUANTIZE', g.internal, { uSrc: src }, {});
    let source = g.internal;
    for (let i = 0; i < 5; i++) {
      const half = g.halves[i];
      const lvl = g.levels[i];
      this.pass('BLUR_H', half, { uSrc: source.tex }, { uSrcSize: [source.w, source.h], uDst: [half.w, half.h], uVp: [lvl.w, lvl.h], uFirst: i === 0 ? 1 : 0, uStrength: glow.strength, uThreshold: glow.hdrThreshold, uScale: 2.0, uCap: glow.hdrLuminanceCap });
      this.pass('BLUR_V', lvl, { uSrc: half.tex }, { uSrcSize: [half.w, half.h], uDst: [lvl.w, lvl.h] });
      source = lvl;
    }
    const lv = glow.levels;
    const sum = glow.normalized ? lv.reduce((a, b) => a + b, 0) : 1;
    // The game's environment enables levels 3 and 5 (indices 2 and 4).
    this.pass('TONEMAP', out, { uInternal: g.internal.tex, uL0: g.levels[2].tex, uL1: g.levels[4].tex }, { uS0: [g.levels[2].w, g.levels[2].h], uS1: [g.levels[4].w, g.levels[4].h], uW0: lv[2] / sum, uW1: lv[4] / sum, uIntensity: intensity, uSize: [w, h] });
  }

  /** Canvas size in device pixels; the content is 480x270 at an integer scale, centred. */
  resize(cw: number, ch: number, scale: number): void {
    const gl = this.gl;
    this.canvasW = cw;
    this.canvasH = ch;
    this.scale = scale;
    const w = Math.max(1, Math.round(480 * scale));
    const h = Math.max(1, Math.round(270 * scale));
    this.offsetX = Math.floor((cw - w) / 2);
    this.offsetY = Math.floor((ch - h) / 2);
    if (this.canvas.width !== cw) this.canvas.width = cw;
    if (this.canvas.height !== ch) this.canvas.height = ch;
    if (this.win && this.win.w === w && this.win.h === h) return;
    if (this.win) {
      for (const t of [this.win.screen, this.win.crt, this.win.glitch, this.win.final]) this.free(t);
      this.freeGlow(this.win.glow);
    }
    this.win = {
      w,
      h,
      screen: this.target(w, h, gl.RGBA8, gl.NEAREST),
      crt: this.target(w, h, gl.RGBA8, gl.LINEAR),
      glitch: this.target(w, h, gl.RGBA8, gl.NEAREST),
      glow: this.glowTargets(w, h),
      final: this.target(w, h, gl.RGBA8, gl.NEAREST),
    };
  }

  render(source: TexImageSource, f: PostFrame): void {
    const gl = this.gl;
    const win = this.win;
    if (!win) return;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    // The game image (row 0 = top, like every buffer here).
    gl.bindTexture(gl.TEXTURE_2D, this.game);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 480, 270, gl.RGBA, gl.UNSIGNED_BYTE, source);
    // SubViewport: glow with the same environment.
    this.glow(this.game, this.gameGlow, this.gameOut, f.glowIntensity);
    // Root viewport: the container draws the SubViewport scaled, then the CRT and glitch overlays.
    this.pass('UPSCALE', win.screen, { uSrc: this.gameOut.tex }, { uScale: this.scale });
    let screen = win.screen;
    if (f.crt) {
      const c = content.post.crt as unknown as Record<string, number | number[]>;
      const u: Record<string, number | number[]> = { uSize: [win.w, win.h], uTime: f.time };
      for (const k of ['wobble_speed', 'wobble_frequency', 'wobble_strength', 'fisheye', 'brighten', 'scanline_count', 'scanline_movespeed', 'horizontal_scanline_strength', 'vertical_scanline_strength', 'chromatic', 'ghosting', 'vignette']) u[k] = c[k] as number;
      u.edge_color = (c.edge_color as number[]).slice(0, 3);
      this.pass('CRT', win.crt, { uScreen: screen.tex }, u);
      screen = win.crt;
    }
    if (f.glitch.visible) {
      const gp = content.post.glitch as unknown as Record<string, number>;
      // The glitch reads the screen with linear filtering.
      const src = screen === win.crt ? win.crt : this.copyLinear(screen);
      this.pass('GLITCH', win.glitch, { uScreen: src.tex }, { uSize: [win.w, win.h], uTime: f.time, shake_power: f.glitch.shake, shake_rate: gp.shake_rate, shake_speed: gp.shake_speed, shake_block_size: gp.shake_block_size, shake_color_rate: gp.shake_color_rate });
      screen = win.glitch;
    }
    this.glow(screen.tex, win.glow, win.final, f.glowIntensity);
    // Present: letterbox black, content flipped into GL's bottom-up canvas.
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, win.final.fb);
    const x0 = this.offsetX;
    const y0 = this.canvasH - this.offsetY - win.h;
    gl.blitFramebuffer(0, 0, win.w, win.h, x0, y0 + win.h, x0 + win.w, y0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  }

  private linearCopy: Target | null = null;
  private copyLinear(t: Target): Target {
    const gl = this.gl;
    if (!this.linearCopy || this.linearCopy.w !== t.w || this.linearCopy.h !== t.h) {
      if (this.linearCopy) this.free(this.linearCopy);
      this.linearCopy = this.target(t.w, t.h, gl.RGBA8, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.linearCopy.fb);
    gl.blitFramebuffer(0, 0, t.w, t.h, 0, 0, t.w, t.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    return this.linearCopy;
  }

  private read(t: Target): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(t.w * t.h * 4);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  }

  /** The SubViewport image after glow (the original's .raw.png). */
  readGame(): Uint8Array {
    return this.read(this.gameOut);
  }

  /** The window content after CRT and glow (the original's .crt.png / .nocrt.png). */
  readWindow(): { w: number; h: number; data: Uint8Array } {
    const win = this.win!;
    return { w: win.w, h: win.h, data: this.read(win.final) };
  }
}
