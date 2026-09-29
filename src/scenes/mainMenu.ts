// res://GameScenes/MainMenu.tscn + Scripts/MainMenu/MainMenu.gd: the typed title
// with its blinking cursor, new game / continue / options / quit, and credits.
import { Container, Graphics } from 'pixi.js';
import { color, t } from '../data/content';
import type { Game } from '../game';
import { HBox, Root, SHRINK_CENTER } from '../ui/control';
import { ui } from '../ui/ctx';
import { Pointer } from '../ui/pointer';
import { BG, Label, solid, TextButton } from '../ui/widgets';
import type { Scene } from './scene';

const TITLE_SIZE = 22;

export class MainMenuScene implements Scene {
  readonly name = 'menu';
  readonly root = new Container();
  readonly pointer = new Pointer();
  private ui = new Root(480, 270);
  private title: Label;
  private cursor: Graphics;
  private typing = false;
  private typingT = 0;
  /** MyTimer.create_repeating(0.5, 1, -1): seconds left, or -1 before typing ends. */
  private blink = -1;
  private buttons: TextButton[] = [];

  constructor(private game: Game) {
    this.root.addChild(solid(-95, -84, 776, 476, BG));
    // GameTitle: centred, offsets (-58,-51)-(58,-24), grow both; characters hidden after shaping.
    this.title = new Label(t('menu.title'), 0xdcdcdc, TITLE_SIZE);
    this.title.setAnchorsPreset('center').place(-58, -51, 58, -24);
    this.title.growH = this.title.growV = 'both';
    this.title.hAlign = 'center';
    this.title.vAlign = 'center';
    this.title.visibleChars = 0;
    // Buttons: HBox (-82,178)-(564,208), separation 16, centred.
    const row = this.ui.add(new HBox(16));
    row.place(-82, 178, 564, 208);
    row.alignment = 'center';
    const mk = (text: string, c: number | undefined, h: number) => {
      const b = row.add(new TextButton(text, c));
      b.customMin = { w: 78, h };
      this.buttons.push(b);
      this.pointer.register(b);
      return b;
    };
    const newGame = mk(t('menu.newGame'), undefined, 30);
    const cont = mk(t('menu.continue'), 0x279b3a, 30);
    const options = mk(t('menu.options'), 0xed4eac, 22);
    options.flagsV = SHRINK_CENTER;
    const quit = mk(t('menu.quit'), color('RED'), 22);
    quit.flagsV = SHRINK_CENTER;
    cont.setVisible(game.hasSave);
    // CreditsBtn: bottom-left anchors, (4,-24)-(57,-4).
    const credits = this.ui.add(new TextButton(t('menu.credits'), 0x2b2b2b));
    credits.setAnchorsPreset('bottomleft').place(4, -24, 57, -4);
    credits.growV = 'begin';
    this.buttons.push(credits);
    this.pointer.register(credits);
    newGame.onPressed = () => game.newGame();
    cont.onPressed = () => game.continueGame();
    options.onPressed = () => game.openOptions();
    quit.onPressed = () => game.quitToBoot();
    credits.onPressed = () => game.openCredits();
    this.ui.add(this.title);
    this.ui.layout();
    // RedSquare: 32x32 ColorRect behind the title, centred on it, rotated 45 degrees.
    const tr = this.title.rect;
    const square = new Graphics().rect(-16, -16, 32, 32).fill(color('RED'));
    square.angle = 45;
    square.position.set(tr.x + tr.w / 2, tr.y + tr.h / 2);
    this.ui.view.addChildAt(square, this.ui.view.getChildIndex(this.title.view));
    this.root.addChild(this.ui.view);
    // TypeCursor: ColorRect (299,87)-(301,107).
    this.cursor = new Graphics().rect(0, 0, 2, 20).fill(0xdcdcdc);
    this.cursor.position.set(299, 87);
    this.root.addChild(this.cursor);
  }

  /** MainMenu.setup(): start typing the title (called once the scene is shown). */
  setup(): void {
    this.title.visibleChars = 0;
    this.title.redraw();
    this.typing = true;
  }

  update(dt: number): void {
    // MyTimer._process runs first: the blink timer resets to 0.5 s each time it fires.
    if (this.blink >= 0) {
      this.blink -= dt;
      if (this.blink <= 0) {
        this.blink = 0.5;
        this.cursor.visible = !this.cursor.visible;
      }
    }
    if (this.typing) {
      this.typingT += dt;
      if (this.typingT >= 0.1) {
        this.typingT -= 0.1;
        this.title.visibleChars++;
        this.title.redraw();
        this.game.sfx('TYPE', { pitchRange: 0.1 });
        if (this.title.visibleChars >= [...this.title.text].length) {
          this.typing = false;
          this.blink = 0.5;
        }
      }
    }
    // type_cursor.global_position.x = game_title.global_position.x + width + 2
    const typed = [...this.title.text].slice(0, this.title.visibleChars).join('');
    this.cursor.x = this.title.rect.x + ui.font.measure(typed, TITLE_SIZE) + 2;
    this.pointer.update(this.game.input, this.game.popups.hasPopup());
    for (const b of this.buttons) b.update(dt);
  }
}
