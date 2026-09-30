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
import { achievementsList, confirmation, creditsPopup, gameMenu, PopupManager, prestigePicker } from './ui/popups';
import { optionsPopup } from './ui/options';
import { openSaveDialog } from './ui/saveDialog';
import { t } from './data/content';
import type { Control } from './ui/control';
import { Tooltip } from './ui/tooltip';
import { Transition } from './render/transition';
import { lockMouse, unlockMouse } from './ui/pointer';
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
  /** MainScene's Transition layer (above popups and the tooltip). */
  readonly transition: Transition;
  /** Tests: stop stepping the simulation (the image stays as built). */
  frozen = false;
  /** Tests: CryptoMine.processing = false (the harness freezes the mine too). */
  mineFrozen = false;
  /** Refs.glitch: shown during the ending, with its shake_power (drawn by the post pass). */
  glitch = { visible: false, shake: 0 };
  /** Shader TIME for the CRT and glitch (tests pin it, like the harness's capture_time). */
  fixedTime: number | null = null;
  private readonly startMs = performance.now();
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
    this.transition = new Transition({
      sfx: (n, o) => this.sfx(n, o),
      lockMouse: (on) => (on ? lockMouse(this.transition) : unlockMouse(this.transition)),
      bgmDuck: () => this.audio?.bgm(content.audio.bgmProfiles.transition as never),
    });
    for (const o of content.settings.options) this.options[o.id] = o.default;
    this.loop = new FixedLoop(
      (dt) => this.tick(dt),
      () => {
        this.scene.draw?.();
        const f = this.screen.frame;
        const glow = content.post.glow as unknown as { intensity: number; intensityCrtOff: number };
        f.crt = this.options.crt_effect === 0;
        f.glowIntensity = f.crt ? glow.intensity : glow.intensityCrtOff;
        f.time = this.fixedTime ?? ((performance.now() - this.startMs) / 1000) % 3600;
        f.glitch = this.glitch;
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
    this.transition.update(dt);
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
    game.applyAllOptions();
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
    this.importedPending = true;
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
    this.screen.gameRoot.addChild(scene.root, this.popups.view, this.tooltip.root.view, this.transition.view);
    old?.destroy?.();
    old?.root.destroy({ children: true });
  }

  /**
   * MainScene's scene changes: wipe in with the text, swap scenes behind it (the
   * old scene is freed and the new one added a frame later), set the BGM, wipe
   * out, then setup().
   */
  private go(text: string, make: () => Scene, bgm: keyof typeof content.audio.bgmProfiles, after?: (s: Scene) => void): void {
    this.transition.in(text, () => {
      const scene = make();
      this.setScene(scene);
      this.audio?.bgm(content.audio.bgmProfiles[bgm] as never);
      this.transition.out(() => {
        scene.setup?.();
        after?.(scene);
      });
    });
  }

  /** enter_battle: sessions count (and the session achievements) once the wipe has opened. */
  enterBattle(): void {
    this.save();
    this.go(t('transition.session'), () => new BattleScene(this), 'battle', () => {
      this.profile.sessions += 1;
      this.checkAchievements('sessionStart');
    });
  }

  /** enter_shop */
  enterShop(): void {
    this.save();
    this.go(t('transition.home'), () => new ShopScene(this), 'shop');
  }

  /** Breach: with a prestige unlocked, choose the level first (PrestigePicker). */
  breach(): void {
    const p = this.profile;
    if (p.max_prestige <= 0) {
      this.enterBattle();
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
          this.enterBattle();
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
        // GameMenu: enter_main_menu() starts its transition, then save, then pop the menu.
        onMainMenu: () => {
          this.enterMainMenu(true);
          this.save();
          this.popups.pop();
        },
        onBack: () => this.popups.pop(),
      }),
    );
  }

  openAchievements(): void {
    this.popups.add(achievementsList(this.profile.achievements, () => this.popups.pop()));
  }

  /** OptionsPopup: every change is applied and saved at once. */
  openOptions(extras = true): void {
    const ach = content.achievements.achievements;
    this.popups.add(
      optionsPopup({
        get: (id) => this.options[id],
        set: (id, v) => {
          this.options[id] = v;
          this.saveOptions();
          this.applyOption(id);
        },
        screenScales: () => this.screenScaleLabels(),
        input: () => this.input,
        pointer: () => this.popups.pointer,
        achievements: () => `${ach.filter((a) => this.profile.achievements[a.id]).length}/${ach.length}`,
        openAchievements: () => this.openAchievements(),
        exportSave: () => {
          lockMouse(openSaveDialog);
          openSaveDialog('export', { text: this.exportSave(), onClose: () => unlockMouse(openSaveDialog) });
        },
        importSave: () => {
          lockMouse(openSaveDialog);
          openSaveDialog('import', {
            onImport: (text) => {
              try {
                this.importSave(text);
                return null;
              } catch (e) {
                return e instanceof Error ? e.message : String(e);
              }
            },
            onClose: () => {
              unlockMouse(openSaveDialog);
              if (this.importedPending) {
                this.importedPending = false;
                this.popups.clear();
                this.enterMainMenu(!(this.scene instanceof MainMenuScene));
              }
            },
          });
        },
        onBack: () => this.popups.pop(),
        extras,
      }),
    );
  }

  private importedPending = false;

  /** OptionsPopup._ready: "fullscreen", then 480x270 multiples while smaller than the screen. */
  private screenScaleLabels(): string[] {
    const out = ['fullscreen'];
    const W = this.screen.width;
    const H = this.screen.height;
    let k = 1;
    // Vector2i < compares x first, then y.
    const less = (a: number, b: number) => a * 480 < W || (a * 480 === W && b * 270 < H);
    while (less(k, k)) k++;
    for (let i = 1; i <= k; i++) out.push(`${480 * i}x${270 * i}`);
    return out;
  }

  /** OptionData.apply_option */
  applyOption(id: string): void {
    const v = this.options[id];
    switch (id) {
      case 'window_size':
        // The browser sets the window: 0 fits it, n caps the scale at n.
        this.screen.maxScale = v;
        this.screen.resize();
        break;
      case 'transition_color':
        this.transition.setColor(v);
        break;
      case 'master_volume':
      case 'sfx_volume':
      case 'bgm_volume':
        this.applyAudioOptions();
        break;
      default:
        // crt_effect is read every frame; screenshake, flashing_fx and color_palette by the scenes.
        (this.scene as Partial<BattleScene> | undefined)?.applyOptions?.();
    }
  }

  applyAllOptions(): void {
    for (const o of content.settings.options) this.applyOption(o.id);
  }

  /** URLButton: OS.shell_open(url); in a browser, a new tab. */
  openUrl(url: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }

  openCredits(): void {
    this.popups.add(creditsPopup((u) => this.openUrl(u), () => this.popups.pop()));
  }

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

  /** enter_main_menu(transition): without a transition (startup, after the ending) the menu starts typing at once. */
  enterMainMenu(transition = false): void {
    if (transition) {
      this.go(t('transition.menu'), () => new MainMenuScene(this), 'menu');
      return;
    }
    const menu = new MainMenuScene(this);
    this.setScene(menu);
    this.audio?.bgm(content.audio.bgmProfiles.menu as never);
    menu.setup();
  }

  newGame(): void {
    const start = () => {
      this.profile = newProfile();
      this.enterShop();
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
    if (this.hasSave) this.enterShop();
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
      /** A scene transition is running (the mouse is locked meanwhile). */
      busy: () => this.transition.active,
      saveBackend: () => this.store.primary,
      audioState: () => this.audio?.ctx.state ?? 'none',
      raw: () => Array.from(this.screen.readRaw()),
      /** The game image after glow (the original's .raw.png). */
      rawGlow: () => Array.from(this.screen.post.readGame()),
      /** The window content after CRT and glow (.crt.png / .nocrt.png). */
      window: () => {
        const w = this.screen.post.readWindow();
        return { w: w.w, h: w.h, data: Array.from(w.data) };
      },
      setTime: (t: number | null) => (this.fixedTime = t),
      setOption: (k: string, v: number) => (this.options[k] = v),
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
