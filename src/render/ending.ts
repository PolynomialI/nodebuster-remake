// The godvirus ending (res://Scripts/Ending.gd, res://Scenes/Ending.tscn).
// start_ending() is a chain of MyTimer waits, one 10 s tween and the "Credits"
// animation. They are replayed here with the same frame semantics: a timer made
// inside a timer or tween callback starts counting on the next frame, a tween
// steps in the frame it was made, and an AnimationPlayer started mid-frame is
// first processed on the next frame (SceneTree copies its process list), with
// delta 0.
// Screen-level effects (glitch shader, BGM, the freeze-frame capture) go
// through hooks.
import { Container, Sprite, type Texture } from 'pixi.js';
import { content, t } from '../data/content';
import { MarginBox, Root, VBox, EXPAND, FILL, SHRINK_CENTER } from '../ui/control';
import { tex } from '../ui/ctx';
import { Label, Panel, RichLabel, solid, TextButton, TextureRect } from '../ui/widgets';

export interface EndingHooks {
  sfx: (name: string) => void;
  /** AudioStreamPlayer.play(): no pitch variation, optional looping stream. */
  player: (name: string, volume: number) => void;
  setPlayerVolume: (name: string, volume: number) => void;
  stopPlayer: (name: string) => void;
  streamed: (name: string) => void;
  bgmFade: (volume: number, lowpassHz: number, sec: number) => void;
  glitch: (visible: boolean, shakePower: number) => void;
  /** The window image as last drawn (Refs.main_scn.get_viewport().get_texture()). */
  snapshot: () => Texture;
  achievement: () => void;
  done: () => void;
}

interface EndingDef {
  deployingSec: number;
  deployedSec: number;
  fadeDelaySec: number;
  bgmFade: { volume: number; lowpassHz: number; sec: number };
  staticRampSec: number;
  glitchShakeTo: number;
  freezeSec: number;
  blackSec: number;
  noiseLeadSec: number;
  credits: { textKey: string; from: number; to: number; pos: [number, number] }[];
  creditsSec: number;
  afterCreditsSec: number;
  loadingSpinDegPerSec: number;
  backdropAlpha: number;
}

export class Ending {
  readonly view = new Container();
  private readonly def = content.lab.ending as unknown as EndingDef;
  private loading: Panel;
  private deployed: Panel;
  private spinner: Sprite;
  private freeze = new Sprite();
  private credits = new Container();
  private creditLabels: Label[] = [];
  readonly ok: TextButton;
  private root = new Root(480, 270);
  /** MyTimer.wait: seconds left and what runs when it reaches 0. */
  private timer: { left: number; then: () => void } | null = null;
  /** The static/glitch tween: elapsed seconds, or -1. */
  private ramp = -1;
  /** AnimationPlayer "Credits": position in seconds, or -1. */
  private anim = -1;
  /** play() was called; processing starts next frame. */
  private animQueued = false;
  /** Frames since start (for tests). */
  frames = 0;

  constructor(private hooks: EndingHooks) {
    const L = this.def;
    this.view.addChild(solid(0, 0, 480, 270, 0x000000, L.backdropAlpha));
    // LoadingBox: FilledPanel (172,115)-(308,155), margins 2, VBox sep 4.
    this.loading = this.root.add(new Panel('filled'));
    this.loading.place(172, 115, 308, 155);
    const lm = this.loading.add(new MarginBox(2, 2, 2, 2));
    const lv = lm.add(new VBox(4));
    lv.add(new RichLabel(t('ending.deploying')));
    // VirusDeployedBox: (172,103)-(308,167).
    this.deployed = this.root.add(new Panel('filled'));
    this.deployed.place(172, 103, 308, 167);
    const dm = this.deployed.add(new MarginBox(2, 2, 2, 2));
    const dv = dm.add(new VBox(4));
    dv.add(new RichLabel(t('ending.deployed')));
    const smile = dv.add(new TextureRect(tex('ui/smile'), 'keep_centered'));
    smile.flagsH = SHRINK_CENTER;
    // "Yes" is never connected in Ending.gd (and the mouse is locked): it only shows.
    this.ok = dv.add(new TextButton(t('ending.ok')));
    this.ok.customMin = { w: 0, h: 18 };
    this.ok.flagsH = EXPAND | FILL;
    this.deployed.setVisible(false);
    this.root.layout();
    this.view.addChild(this.root.view);
    // Loading circle: Sprite2D child of LoadingBox at (65, 27), centred.
    this.spinner = new Sprite(tex('ui/loading'));
    this.spinner.anchor.set(0.5);
    this.spinner.position.set(65, 27);
    this.loading.view.addChild(this.spinner);
    // TextureRect (0,0)-(480,270) with expand_mode KEEP_SIZE: the capture is drawn 1:1.
    this.freeze.visible = false;
    this.view.addChild(this.freeze);
    // Credits: black ColorRect with four 22 px labels.
    this.credits.addChild(solid(0, 0, 480, 270, 0x000000));
    for (const c of L.credits) {
      const l = new Label(t(c.textKey), 0xdcdcdc, 22);
      l.setRect({ x: c.pos[0], y: c.pos[1], w: 0, h: 27 });
      l.setRect({ x: c.pos[0], y: c.pos[1], w: l.minSize().w, h: 27 });
      l.setVisible(false);
      this.credits.addChild(l.view);
      this.creditLabels.push(l);
    }
    this.credits.visible = false;
    this.view.addChild(this.credits);
  }

  private wait(sec: number, then: () => void): void {
    this.timer = { left: sec, then };
  }

  /** start_ending(), up to its first await. */
  start(): void {
    const L = this.def;
    const h = this.hooks;
    this.loading.setVisible(true);
    h.sfx('DEPLOYING');
    this.wait(L.deployingSec, () => {
      this.loading.setVisible(false);
      this.deployed.setVisible(true);
      h.sfx('DEPLOYED');
      h.achievement();
      this.wait(L.deployedSec, () => {
        h.glitch(true, 0);
        h.bgmFade(L.bgmFade.volume, L.bgmFade.lowpassHz, L.bgmFade.sec);
        this.wait(L.fadeDelaySec, () => {
          h.player('STATIC', 0);
          this.ramp = 0;
        });
      });
    });
  }

  private afterRamp(): void {
    const L = this.def;
    const h = this.hooks;
    h.stopPlayer('STATIC');
    h.player('VOICE_LOOP', 1);
    h.player('VCR', 1);
    this.freeze.texture = h.snapshot();
    this.freeze.visible = true;
    h.glitch(false, L.glitchShakeTo);
    this.wait(L.freezeSec, () => {
      h.stopPlayer('VOICE_LOOP');
      this.credits.visible = true;
      this.wait(L.blackSec, () => {
        h.streamed('BACKGROUND_NOISE');
        this.wait(L.noiseLeadSec, () => (this.animQueued = true));
      });
    });
  }

  update(dt: number): void {
    const L = this.def;
    this.frames++;
    const animStarting = this.animQueued;
    this.animQueued = false;
    // MyTimer._process (an autoload, so first in the frame).
    const tm = this.timer;
    if (tm) {
      tm.left -= dt;
      if (tm.left <= 0) {
        this.timer = null;
        tm.then();
      }
    }
    // Ending._process
    this.spinner.angle += L.loadingSpinDegPerSec * dt;
    // AnimationPlayer (Credits): discrete visibility keys; the first frame has delta 0.
    if (animStarting) this.anim = 0;
    else if (this.anim >= 0) this.anim += dt;
    if (this.anim >= 0) {
      const pos = Math.min(this.anim, L.creditsSec);
      L.credits.forEach((c, i) => this.creditLabels[i].setVisible(pos >= c.from && pos < c.to));
      if (this.anim >= L.creditsSec) {
        this.anim = -1;
        this.wait(L.afterCreditsSec, () => this.hooks.done());
      }
    }
    // SceneTree.process_tweens: the static volume and glitch shake ramp (linear, parallel).
    if (this.ramp >= 0) {
      this.ramp += dt;
      const k = Math.min(this.ramp / L.staticRampSec, 1);
      this.hooks.setPlayerVolume('STATIC', k);
      this.hooks.glitch(true, L.glitchShakeTo * k);
      if (this.ramp >= L.staticRampSec) {
        this.ramp = -1;
        this.afterRamp();
      }
    }
    this.ok.update(dt);
  }
}
