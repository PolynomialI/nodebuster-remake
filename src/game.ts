// Game shell: display, fixed-step loop, input, audio, saves, profile, options
// and the current scene.
import * as assets from './assets';
import { GameAudio } from './audio/audio';
import { Input } from './core/input';
import { FixedLoop } from './core/loop';
import { exportSaveString, importSaveString, openSaveStore, type SaveStore } from './core/save';
import { content } from './data/content';
import { PixelFont } from './render/pixelfont';
import { Screen } from './render/screen';
import { loadTextures, type TextureMap } from './render/textures';
import { BattleScene } from './scenes/battleScene';
import { BootScene } from './scenes/boot';
import type { Scene } from './scenes/scene';
import { newProfile, profileFromJson, profileToJson, type Profile } from './sim/profile';
import { features } from './sim/stats';
import { ui, type SfxOptions } from './ui/ctx';
import type { BattleInitScenario } from './tableau';
import { applyTableau } from './tableau';

export type Options = Record<string, number>;

export class Game {
  readonly input = new Input();
  readonly loop: FixedLoop;
  scene!: Scene;
  audio: GameAudio | null = null;
  profile: Profile = newProfile();
  hasSave = false;
  options: Options = {};

  private constructor(
    readonly screen: Screen,
    readonly font: PixelFont,
    readonly textures: TextureMap,
    readonly store: SaveStore,
  ) {
    ui.font = font;
    ui.textures = textures;
    ui.playSfx = (name, opts) => this.sfx(name, opts);
    for (const o of content.settings.options) this.options[o.id] = o.default;
    this.loop = new FixedLoop(
      (dt) => {
        ui.time += dt;
        this.scene.update(dt);
        this.audio?.step();
        this.input.endStep();
      },
      () => {
        this.scene.draw?.();
        this.screen.render();
      },
    );
  }

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const [screen, font, textures, store] = await Promise.all([Screen.create(canvas), PixelFont.load(assets.fonts.main), loadTextures(assets.images), openSaveStore()]);
    const game = new Game(screen, font, textures, store);
    game.input.attach(screen);
    new ResizeObserver(() => screen.resize()).observe(canvas);
    window.addEventListener('resize', () => screen.resize());
    await game.loadSave();
    return game;
  }

  // ---- saves ------------------------------------------------------------------------

  private async loadSave(): Promise<void> {
    const opts = await this.store.get('options');
    if (opts) {
      try {
        Object.assign(this.options, JSON.parse(opts));
      } catch {
        // Keep defaults.
      }
    }
    const save = await this.store.get('save');
    if (save) {
      try {
        this.profile = profileFromJson(save);
        this.hasSave = true;
      } catch {
        this.profile = newProfile();
      }
    }
  }

  save(): void {
    this.hasSave = true;
    void this.store.set('save', profileToJson(this.profile));
  }

  saveOptions(): void {
    void this.store.set('options', JSON.stringify(this.options));
  }

  exportSave(): string {
    return exportSaveString(profileToJson(this.profile));
  }

  /** Throws with a readable message if the string is not a valid save. */
  importSave(text: string): void {
    this.profile = profileFromJson(importSaveString(text));
    this.save();
  }

  // ---- achievements -----------------------------------------------------------------

  /** Unlock achievements whose condition holds for this kind of event. */
  checkAchievements(event: 'sessionStart' | 'sessionEnd' | 'levelUp' | 'feature' | 'godvirus'): string[] {
    const p = this.profile;
    const f = features(p.upgrades);
    const got: string[] = [];
    for (const a of content.achievements.achievements) {
      if (p.achievements[a.id] || a.when.event !== event) continue;
      const w = a.when;
      let ok = false;
      if (w.event === 'feature') ok = f.has(w.feature as never);
      else if (w.event === 'godvirus') ok = p.virus_deployed;
      else if (w.stat) ok = ((p as unknown as Record<string, number>)[w.stat] ?? 0) >= (w.atLeast ?? 0);
      if (ok) {
        p.achievements[a.id] = true;
        got.push(a.id);
      }
    }
    return got;
  }

  // ---- audio / cursor -----------------------------------------------------------------

  sfx(name: string, opts?: SfxOptions): void {
    this.audio?.play(name, opts);
  }

  setCursorHidden(hidden: boolean): void {
    this.screen.canvas.classList.toggle('hide-cursor', hidden);
  }

  applyAudioOptions(): void {
    this.audio?.setVolumes(this.options.master_volume, this.options.sfx_volume, this.options.bgm_volume);
  }

  // ---- scenes -----------------------------------------------------------------------

  setScene(scene: Scene): void {
    const old = this.scene;
    this.scene = scene;
    this.screen.gameRoot.removeChildren();
    this.screen.gameRoot.addChild(scene.root);
    old?.destroy?.();
    old?.root.destroy({ children: true });
  }

  startBattle(): void {
    this.save();
    this.setScene(new BattleScene(this));
    this.profile.sessions += 1;
    this.checkAchievements('sessionStart');
    this.audio?.bgm(content.audio.bgmProfiles.battle as never);
  }

  /** Until the shop exists (phase 4), "go to home" starts another session. */
  goHome(): void {
    this.startBattle();
  }

  start(): void {
    const boot = new BootScene(this.font);
    this.setScene(boot);
    this.input.onFirstGesture = () => {
      // Audio can only start inside the gesture.
      try {
        const ctx = new AudioContext();
        void ctx.resume();
        const audio = new GameAudio(ctx);
        this.audio = audio;
        this.applyAudioOptions();
        audio.bgm(content.audio.bgmProfiles.boot as never, 0);
        void audio.load().then(() => audio.startMusic());
      } catch {
        this.audio = null;
      }
      this.startBattle();
    };
    this.loop.start();
  }

  /** Test hooks (Playwright reads these through window.__nb). */
  debugApi() {
    return {
      scene: () => this.scene.name,
      saveBackend: () => this.store.primary,
      audioState: () => this.audio?.ctx.state ?? 'none',
      raw: () => Array.from(this.screen.readRaw()),
      size: () => ({ w: this.screen.width, h: this.screen.height, scale: this.screen.scale }),
      tableau: (s: BattleInitScenario) => applyTableau(this, s),
      profile: () => JSON.parse(profileToJson(this.profile)),
      battle: () => {
        const s = this.scene as Partial<BattleScene>;
        if (!s.sim) return null;
        const b = s.sim;
        return { enemies: b.enemies.length, hp: b.hp, elapsed: b.elapsed, status: b.status, cursor: { ...b.cursor }, kills: this.profile.nums.enemies_killed };
      },
    };
  }
}
