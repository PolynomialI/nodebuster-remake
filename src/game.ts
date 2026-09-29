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
import { ShopScene } from './scenes/shopScene';
import { MainMenuScene } from './scenes/mainMenu';
import { processMine } from './sim/meta';
import { achievementsList, confirmation, gameMenu, PopupManager, prestigePicker } from './ui/popups';
import { t } from './data/content';
import type { Control } from './ui/control';
import { Tooltip } from './ui/tooltip';
import type { EndingHooks } from './render/ending';
import type { Scene } from './scenes/scene';
import { newProfile, profileFromJson, profileToJson, type Profile } from './sim/profile';
import { features } from './sim/stats';
import { ui, type SfxOptions } from './ui/ctx';
import type { Scenario } from './tableau';
import { applyTableau } from './tableau';

export type Options = Record<string, number>;

export class Game {
  readonly input = new Input();
  readonly loop: FixedLoop;
  scene!: Scene;
  private pendingScene: Scene | null = null;
  audio: GameAudio | null = null;
  readonly popups = new PopupManager();
  /** MainScene Tooltip: one for the whole game, above popups. */
  readonly tooltip = new Tooltip();
  /** Tests: stop stepping the simulation (the image stays as built). */
  frozen = false;
  /** Tests: CryptoMine.processing = false (the harness freezes the mine too). */
  mineFrozen = false;
  /** Refs.glitch: shown during the ending, with its shake_power (drawn by the post pass). */
  glitch = { visible: false, shake: 0 };
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
      (dt) => this.tick(dt),
      () => {
        this.scene.draw?.();
        this.screen.render();
      },
    );
  }

  /** One fixed step of the loop. */
  tick(dt: number): void {
    if (!this.frozen) this.step(dt);
    this.audio?.step();
    this.input.endStep();
    this.applyPendingScene();
  }

  /** One 60 Hz frame of game logic (State._process, the scene, popups, tooltip). */
  step(dt: number): void {
    ui.time += dt;
    // CryptoMine runs from State._process: every frame, in every scene.
    if (!this.mineFrozen && !(this.scene instanceof BootScene)) processMine(this.profile, dt);
    this.scene.update(dt);
    this.popups.update(dt, this.input);
    this.tooltip.update(dt);
  }

  showTooltip(markup: string, target: Control): void {
    const p = target.view.getGlobalPosition();
    const piv = target.view.pivot;
    this.tooltip.setText(markup);
    this.tooltip.centerAboveOrBelow({ x: p.x - piv.x, y: p.y - piv.y, w: target.rect.w, h: target.rect.h });
  }

  hideTooltip(): void {
    this.tooltip.hide();
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

  /** Switch scenes at the end of the current step (a scene may request it mid-update). */
  setScene(scene: Scene): void {
    if (!this.scene) this.swapScene(scene);
    else this.pendingScene = scene;
  }

  private applyPendingScene(): void {
    const s = this.pendingScene;
    if (!s) return;
    this.pendingScene = null;
    this.swapScene(s);
  }

  /** Immediate switch (tests and startup). */
  swapScene(scene: Scene): void {
    this.pendingScene = null;
    const old = this.scene;
    this.scene = scene;
    this.screen.gameRoot.removeChildren();
    this.screen.gameRoot.addChild(scene.root, this.popups.view, this.tooltip.root.view);
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

  /** "go to home": save and enter the shop (the transition comes in the look phase). */
  goHome(): void {
    this.save();
    this.setScene(new ShopScene(this));
    this.audio?.bgm(content.audio.bgmProfiles.shop as never);
  }

  /** Breach: with a prestige unlocked, choose the level first (PrestigePicker). */
  breach(): void {
    const p = this.profile;
    if (p.max_prestige <= 0) {
      this.startBattle();
      return;
    }
    // PrestigePicker.setup: its own value starts at clampi(curr_prestige, 0, 25).
    let curr = Math.min(Math.max(p.curr_prestige, 0), content.prestige.max);
    this.popups.add(
      prestigePicker({
        get: () => ({ curr, max: this.profile.max_prestige }),
        set: (v) => {
          curr = v;
          this.profile.curr_prestige = v;
        },
        onStart: () => {
          this.popups.pop();
          this.startBattle();
        },
        onBack: () => this.popups.pop(),
        showInfo: (b) => this.showTooltip(t('prestige.info'), b),
        hideInfo: () => this.hideTooltip(),
      }),
    );
  }

  /** Escape in the shop: GameMenu (options, main menu, back). */
  openGameMenu(): void {
    this.popups.add(
      gameMenu({
        onOptions: () => this.openOptions(),
        onMainMenu: () => {
          this.popups.clear();
          this.save();
          this.enterMainMenu();
        },
        onBack: () => this.popups.pop(),
      }),
    );
  }

  openAchievements(): void {
    this.popups.add(achievementsList(this.profile.achievements, () => this.popups.pop()));
  }

  /** The options popup arrives with the settings phase; achievements are reachable meanwhile. */
  openOptions(): void {
    this.openAchievements();
  }

  openCredits(): void {}

  /** What the godvirus ending asks of the rest of the game. */
  endingHooks(): EndingHooks {
    return {
      sfx: (n) => this.sfx(n, { pitchRange: 0 }),
      player: (n, v) => void this.audio?.loop(n, v),
      setPlayerVolume: (n, v) => this.audio?.setLoopVolume(n, v),
      stopPlayer: (n) => this.audio?.stopLoop(n),
      streamed: (n) => void this.audio?.playStreamed(n),
      bgmFade: (volume, lowpassHz, sec) => this.audio?.bgm({ volume, lowpassHz, sec }),
      glitch: (visible, shake) => (this.glitch = { visible, shake }),
      snapshot: () => this.screen.snapshot(),
      achievement: () => void this.checkAchievements('godvirus'),
      done: () => {
        this.glitch = { visible: false, shake: 0 };
        this.enterMainMenu();
      },
    };
  }

  enterMainMenu(): void {
    const menu = new MainMenuScene(this);
    this.setScene(menu);
    menu.setup();
    this.audio?.bgm(content.audio.bgmProfiles.menu as never);
  }

  newGame(): void {
    const start = () => {
      this.profile = newProfile();
      this.save();
      this.goHome();
    };
    if (!this.hasSave) {
      start();
      return;
    }
    this.popups.add(
      confirmation(t('menu.newSaveConfirm'), (yes) => {
        this.popups.pop();
        if (yes) start();
      }),
    );
  }

  continueGame(): void {
    if (this.hasSave) this.goHome();
  }

  /** The browser can't close the tab: "quit" returns to the click-to-start screen. */
  quitToBoot(): void {
    this.save();
    this.audio?.bgm({ volume: 0, lowpassHz: 1000, sec: 0.5 });
    this.start(false);
  }

  start(firstTime = true): void {
    const boot = new BootScene(this.font);
    this.setScene(boot);
    if (!firstTime) {
      this.input.onFirstGesture = () => this.enterMainMenu();
      return;
    }
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
      this.enterMainMenu();
    };
    if (firstTime) this.loop.start();
  }

  /** Test hooks (Playwright reads these through window.__nb). */
  debugApi() {
    return {
      scene: () => this.scene.name,
      saveBackend: () => this.store.primary,
      audioState: () => this.audio?.ctx.state ?? 'none',
      raw: () => Array.from(this.screen.readRaw()),
      size: () => ({ w: this.screen.width, h: this.screen.height, scale: this.screen.scale }),
      tableau: (s: Scenario, frame?: number) => applyTableau(this, s, frame),
      /** Let a tableau run live again (interactive tests). */
      resume: () => {
        this.frozen = false;
        this.mineFrozen = false;
      },
      /** Run n fixed steps right now (skips waiting through long sequences). */
      advance: (n: number) => {
        for (let i = 0; i < n; i++) this.tick(1 / 60);
      },
      popups: () => this.popups.depth(),
      endingFrames: () => (this.scene as Partial<ShopScene>).ending?.frames ?? -1,
      profile: () => JSON.parse(profileToJson(this.profile)),
      shop: () => {
        const s = this.scene as Partial<ShopScene>;
        if (!s.tree) return null;
        return { treePos: { ...s.tree.pos }, scale: s.tree.scale, visible: s.tree.nodes.filter((n) => n.visible).map((n) => n.node.id), page: s.page, dot: s.notificationDot };
      },
      battle: () => {
        const s = this.scene as Partial<BattleScene>;
        if (!s.sim) return null;
        const b = s.sim;
        return { enemies: b.enemies.length, hp: b.hp, elapsed: b.elapsed, status: b.status, cursor: { ...b.cursor }, kills: this.profile.nums.enemies_killed };
      },
    };
  }
}
