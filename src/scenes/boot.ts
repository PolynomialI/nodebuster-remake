// Click-to-start screen. Browsers only allow audio after a user gesture, and the
// artifact frame may refuse fullscreen/pointer lock, so the game waits here.
import { Container, Graphics } from 'pixi.js';
import { Label } from '../render/label';
import type { PixelFont } from '../render/pixelfont';
import { H, W } from '../render/screen';
import type { Scene } from './scene';

export class BootScene implements Scene {
  readonly name = 'boot';
  readonly root = new Container();
  private readonly prompt: Label;
  private readonly cursor = new Graphics();
  private t = 0;
  status = '';
  private readonly statusLabel: Label;

  constructor(font: PixelFont) {
    this.root.addChild(new Graphics().rect(0, 0, W, H).fill(0x1f1f1f));
    this.prompt = new Label(font, 'click to start').placeAt(W / 2, H / 2 - 6, 'center');
    this.statusLabel = new Label(font, '', 11, 0x6c6c6c);
    this.cursor.rect(0, 0, 2, 12).fill(0xdcdcdc);
    this.cursor.position.set(this.prompt.x + this.prompt.textWidth + 2, this.prompt.y);
    this.root.addChild(this.prompt, this.cursor, this.statusLabel);
  }

  update(dt: number): void {
    this.t += dt;
    // Same 0.5 s blink as the main menu's type cursor.
    this.cursor.visible = Math.floor(this.t / 0.5) % 2 === 0;
    if (this.statusLabel.text !== this.status) this.statusLabel.text = this.status;
    this.statusLabel.placeAt(W / 2, H - 20, 'center');
  }
}
