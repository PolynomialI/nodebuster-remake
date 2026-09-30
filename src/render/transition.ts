// The scene transition (res://Scripts/Effects/SceneTransition.gd, MainScene.tscn
// "Transition" layer). A white splat (Transition2.png, 16 frames at 28 fps) wipes
// in over the old scene while the text types in and blinks; behind it the scene is
// swapped; then the inverse splat (Transition2Inverse.png) is used as a clip mask
// that opens from the centre. Timers follow MyTimer's per-frame countdown, the
// typing is a 0.3 s tween, and the sprites advance like AnimatedSprite2D.
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { color } from '../data/content';
import { tex } from '../ui/ctx';
import { BG, Label } from '../ui/widgets';

const FRAMES = 16;
const FPS = 28;
const FRAME_W = 500;
const FRAME_H = 290;

/** AnimatedSprite2D playback: frame_progress in frames, advancing at FPS. */
export class Anim {
  frame = 0;
  progress = 0;
  playing = false;
  finished = false;

  play(): void {
    this.frame = 0;
    this.progress = 0;
    this.playing = true;
    this.finished = false;
  }

  /** One process step; returns true when the animation finishes in it. */
  step(dt: number): boolean {
    if (!this.playing) return false;
    let remaining = dt;
    for (let i = 0; remaining > 0 && i <= FRAMES; i++) {
      if (this.progress >= 1) {
        if (this.frame >= FRAMES - 1) {
          this.playing = false;
          this.finished = true;
          return true;
        }
        this.frame++;
        this.progress = 0;
      }
      const t = Math.min((1 - this.progress) / FPS, remaining);
      this.progress += t * FPS;
      remaining -= t;
    }
    return false;
  }
}

function frames(id: string): Texture[] {
  const t = tex(id);
  return Array.from({ length: FRAMES }, (_, i) => new Texture({ source: t.source, frame: new Rectangle(i * FRAME_W, 0, FRAME_W, FRAME_H) }));
}

/** Godot's round(): halves away from zero. */
const roundAway = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

export interface TransitionHooks {
  sfx: (name: string, opts?: { pitchRange?: number; cooldownSteps?: number }) => void;
  lockMouse: (on: boolean) => void;
  bgmDuck: () => void;
}

export class Transition {
  readonly view = new Container();
  private readonly wipe = new Container();
  private readonly mask: Sprite;
  private readonly inSprite: Sprite;
  private readonly text: Label;
  private readonly inFrames = frames('ui/transition_in');
  private readonly maskFrames = frames('ui/transition_out');
  private readonly inAnim = new Anim();
  private readonly maskAnim = new Anim();
  /** MyTimer waits of transition_in, in the order MyTimer holds them. */
  private wait: { left: number; then: () => void } | null = null;
  private blink: { left: number; repeats: number } | null = null;
  private typing: { t: number } | null = null;
  private typedShown = 0;
  private outStarting = false;
  private onDone: (() => void) | null = null;
  active = false;

  constructor(private hooks: TransitionHooks) {
    // Transition (clip_children only): its frame masks TransitionIn and the text.
    this.mask = new Sprite(this.maskFrames[0]);
    this.mask.anchor.set(0.5);
    this.mask.position.set(240, 135);
    this.inSprite = new Sprite(this.inFrames[0]);
    this.inSprite.anchor.set(0.5);
    this.inSprite.position.set(240, 135);
    this.text = new Label('', BG);
    this.wipe.addChild(this.inSprite, this.text.view);
    this.wipe.mask = this.mask;
    this.view.addChild(this.mask, this.wipe);
    this.view.visible = false;
    this.setColor(0);
  }

  /** transition_color: WHITE, or #8f8f8f for "dark". */
  setColor(option: number): void {
    this.inSprite.tint = option === 0 ? color('WHITE') : 0x8f8f8f;
  }

  /** transition_in(text): calls `covered` when the wipe has held for 0.4 s after typing. */
  in(text: string, covered: () => void): void {
    const h = this.hooks;
    this.active = true;
    this.view.visible = true;
    h.lockMouse(true);
    h.sfx('TRANSITION_IN', { pitchRange: 0 });
    h.bgmDuck();
    this.maskAnim.playing = false;
    this.maskAnim.frame = 0;
    this.inAnim.play();
    this.outStarting = false;
    // Label centred on the Transition node, then position = round(position).
    this.text.text = text;
    const m = this.text.intrinsicMin();
    this.text.setRect({ x: 240 + roundAway(-m.w / 2), y: 135 + roundAway(-m.h / 2), w: m.w, h: m.h });
    this.text.visibleChars = 0;
    this.typedShown = 0;
    this.text.setVisible(true);
    this.text.redraw();
    this.blink = null;
    this.typing = null;
    this.wait = {
      left: 0.2,
      then: () => {
        this.typing = { t: 0 };
        this.blink = { left: 0.04, repeats: 0 };
      },
    };
    this.pendingCovered = covered;
  }

  private pendingCovered: (() => void) | null = null;

  /** transition_out(): the mask opens; `done` runs when its animation finishes. */
  out(done: () => void): void {
    this.onDone = done;
    this.outStarting = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    // transition_out() runs at the start of the frame after the scene swap.
    if (this.outStarting) {
      this.outStarting = false;
      this.inAnim.playing = false;
      this.inAnim.frame = FRAMES - 1;
      this.maskAnim.play();
      this.hooks.sfx('TRANSITION_OUT', { pitchRange: 0 });
    }
    // MyTimer._process: the 0.2 s / 0.4 s waits and the blink timer.
    const w = this.wait;
    const blink = this.blink;
    if (w) {
      w.left -= dt;
      if (w.left <= 0) {
        this.wait = null;
        w.then();
      }
    }
    if (blink && blink === this.blink) {
      blink.left -= dt;
      if (blink.left <= 0) {
        if (blink.repeats >= 14) this.blink = null;
        else {
          blink.left = 0.04;
          blink.repeats++;
          this.text.setVisible(!this.text.visible);
        }
      }
    }
    // AnimatedSprite2D internal process.
    this.inAnim.step(dt);
    if (this.maskAnim.step(dt)) {
      this.active = false;
      this.view.visible = false;
      this.hooks.lockMouse(false);
      const d = this.onDone;
      this.onDone = null;
      d?.();
    }
    this.inSprite.texture = this.inFrames[this.inAnim.frame];
    this.mask.texture = this.maskFrames[this.maskAnim.frame];
    // TypingLabel._process: a type sound when more characters show than last frame.
    const vc = this.text.visibleChars;
    if (vc > this.typedShown) this.hooks.sfx('TYPE', { pitchRange: 0.1, cooldownSteps: 3 });
    this.typedShown = vc;
    // process_tweens: visible_ratio 0 -> 1 over 0.3 s, then wait 0.4 s.
    const ty = this.typing;
    if (ty) {
      ty.t += dt;
      const n = [...this.text.text].length;
      const ratio = Math.min(ty.t / 0.3, 1);
      // Label.set_visible_ratio: int(total * ratio), or -1 (all) at 1.
      this.text.visibleChars = ratio >= 1 ? -1 : Math.floor(n * ratio);
      this.text.redraw();
      if (ty.t >= 0.3) {
        this.typing = null;
        this.wait = {
          left: 0.4,
          then: () => {
            const c = this.pendingCovered;
            this.pendingCovered = null;
            c?.();
          },
        };
      }
    }
  }
}
