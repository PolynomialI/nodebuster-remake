import { Container } from 'pixi.js';
import type { Game } from '../game';
import { BattleView } from '../render/battleView';
import { Battle } from '../sim/battle';
import { computeStats } from '../sim/stats';
import { Pointer } from '../ui/pointer';
import type { Scene } from './scene';

export class BattleScene implements Scene {
  readonly name = 'battle';
  readonly root = new Container();
  readonly sim: Battle;
  readonly view: BattleView;
  readonly pointer = new Pointer();
  /** Tableau mode for visual tests: the simulation does not advance. */
  frozen = false;

  constructor(
    private game: Game,
    seed = (Math.random() * 2 ** 32) >>> 0,
  ) {
    const profile = game.profile;
    this.sim = new Battle({ profile, stats: computeStats(profile.upgrades), seed, cursor: game.input.mouse });
    this.view = new BattleView(this.sim, this.pointer);
    this.applyOptions();
    this.view.onHome = () => game.enterShop();
    this.view.onRestart = () => game.enterBattle();
    this.root.addChild(this.view.root);
    game.setCursorHidden(true);
  }

  /** Globals.flashing and Globals.screenshake_intensity. */
  applyOptions(): void {
    this.view.flashing = this.game.options.flashing_fx === 0;
    this.view.shake.intensity = this.game.options.screenshake / 100;
  }

  update(dt: number): void {
    if (!this.frozen) {
      this.sim.step(dt, this.game.input.mouse);
      this.view.handle(this.sim.events);
      for (const e of this.sim.events) {
        if (e.type === 'sfx') this.game.sfx(e.name, { pitchRange: e.pitchRange, volumeDb: e.volumeDb });
        else if (e.type === 'achievement') this.game.checkAchievements(e.stat === 'level' ? 'levelUp' : 'sessionEnd');
        else if (e.type === 'end') {
          this.game.setCursorHidden(false);
          this.game.save();
        }
      }
    }
    this.view.update(dt);
    this.view.particles.update(dt);
    this.pointer.update(this.game.input, this.game.popups.hasPopup());
  }

  destroy(): void {
    this.view.destroy();
    this.game.setCursorHidden(false);
  }
}
