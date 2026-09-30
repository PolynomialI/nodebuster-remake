// res://Scripts/Popups/PopupManager.gd and the popups the game uses:
// PrestigePicker, GameMenu, ConfirmationPopup, plus the remake's achievements list.
// Popups sit above the scene inside the 480x270 image; the darkened backdrop
// blocks the mouse for everything below.
import { Container } from 'pixi.js';
import { color, content, t } from '../data/content';
import type { Input } from '../core/input';
import { easeOutQuad } from '../sim/geometry';
import { Control, HBox, MarginBox, Root, VBox, EXPAND, FILL, SHRINK_CENTER, SHRINK_END } from './control';
import { lockMouse, Pointer, unlockMouse } from './pointer';
import { Label, Panel, RichLabel, solid, TextButton, type Interactive, BG, WHITE } from './widgets';

export interface Popup {
  panel: Control;
  buttons: TextButton[];
  extraTargets?: Interactive[];
  onBack?: () => void;
  update?(dt: number): void;
  onFocus?(): void;
  /** Called when the popup is removed (close anything it opened). */
  onClose?(): void;
}

const SW = 480;
const SH = 270;
const f32 = Math.fround;

/**
 * The popup's height after PopupManager.focus_curr's slide. Every tween step sets
 * position.y, and Control recomputes size = (y + size) - y in float32, so the
 * height drifts just below the integer (121 -> 120.99998); containers inside then
 * truncate it (MarginContainer: int(size - margins)), losing a pixel.
 */
export function slideHeight(h: number): number {
  const top = f32(f32(SH * 0.5) - f32(h / 2));
  let s = f32(f32(f32(SH * 0.5) + f32(h / 2)) - top);
  const end = Math.sign(top) * Math.round(Math.abs(top));
  s = f32(f32(end + s) - end);
  const va = f32(end + SH);
  s = f32(f32(va + s) - va);
  const d = f32(0.15);
  let elapsed = 0;
  for (;;) {
    elapsed += 1 / 60;
    const time = Math.min(elapsed, 0.15);
    // Tween.interpolate_variant: the TRANS_QUAD/EASE_OUT weight in real_t, then a double lerp.
    const y = time < 0.15 ? f32(va + (end - va) * f32(f32(-f32(f32(time) / d)) * f32(f32(f32(time) / d) - 2))) : f32(end);
    s = f32(f32(y + s) - y);
    if (time >= 0.15) return s;
  }
}

export class PopupManager {
  readonly view = new Container();
  private readonly darken = solid(0, 0, SW, SH, 0x000000, 0.47451);
  private readonly root = new Root(SW, SH);
  private stack: Popup[] = [];
  private slide: { p: Popup; t: number; y: number } | null = null;
  readonly pointer = new Pointer();

  constructor() {
    this.darken.visible = false;
    this.view.addChild(this.darken, this.root.view);
  }

  hasPopup(): boolean {
    return this.stack.length > 0;
  }

  depth(): number {
    return this.stack.length;
  }

  get current(): Popup | undefined {
    return this.stack[this.stack.length - 1];
  }

  add(p: Popup): void {
    const cur = this.current;
    if (cur) cur.panel.setVisible(false);
    this.stack.push(p);
    this.root.add(p.panel);
    this.darken.visible = true;
    p.panel.setVisible(false);
    this.focus();
  }

  /** focus_curr: centre, then slide up from 270 px below over 0.15 s (mouse locked meanwhile). */
  focus(): void {
    const p = this.current;
    if (!p) return;
    p.panel.setVisible(true);
    const m = p.panel.minSize();
    const w = Math.max(m.w, p.panel.customMin.w);
    const h = m.h;
    const x = Math.round(SW / 2 - w / 2);
    const y = Math.round(SH / 2 - h / 2);
    p.panel.setRect({ x, y: y + SH, w, h: slideHeight(h) });
    this.slide = { p, t: 0, y };
    this.pointer.clear();
    for (const b of p.buttons) this.pointer.register(b);
    for (const b of p.extraTargets ?? []) this.pointer.register(b);
    lockMouse(this);
    p.onFocus?.();
  }

  pop(): void {
    const p = this.stack.pop();
    if (!p) return;
    p.onClose?.();
    this.root.remove(p.panel);
    p.panel.view.destroy({ children: true });
    if (this.slide?.p === p) {
      this.slide = null;
      unlockMouse(this);
    }
    if (this.stack.length) this.focus();
    else {
      this.darken.visible = false;
      this.pointer.clear();
    }
  }

  clear(): void {
    while (this.stack.length) this.pop();
  }

  update(dt: number, input: Input): void {
    if (this.slide) {
      const s = this.slide;
      s.t = Math.min(s.t + dt / 0.15, 1);
      const r = s.p.panel.rect;
      s.p.panel.setRect({ ...r, y: s.y + SH * (1 - easeOutQuad(s.t)) });
      if (s.t >= 1) {
        this.slide = null;
        unlockMouse(this);
      }
    }
    if (this.hasPopup()) this.pointer.update(input);
    for (const p of this.stack) {
      for (const b of p.buttons) b.update(dt);
      p.update?.(dt);
    }
  }
}

function button(text: string, main?: number, w = 0, h = 16): TextButton {
  const b = new TextButton(text, main);
  b.customMin = { w, h };
  return b;
}

/** res://Scenes/Popups/PrestigePicker.tscn */
export function prestigePicker(opts: { get: () => { curr: number; max: number }; set: (v: number) => void; onStart: () => void; onBack: () => void; showInfo: (b: TextButton) => void; hideInfo: () => void }): Popup {
  const panel = new Panel('filled');
  panel.customMin = { w: 160, h: 138 };
  const v = panel.add(new VBox());
  const tag = v.add(new Label(t('prestige.choose')));
  tag.hAlign = 'center';
  tag.vAlign = 'center';
  const space = v.add(new Control());
  space.customMin = { w: 0, h: 14 };
  const text = v.add(new Label(''));
  text.hAlign = 'center';
  text.vAlign = 'center';
  text.flagsV = 0;
  const controls = v.add(new HBox());
  controls.alignment = 'center';
  const down = controls.add(button('-', undefined, 14, 14));
  const up = controls.add(button('+', undefined, 14, 14));
  const info = v.add(button('?', BG, 16, 16));
  info.flagsH = SHRINK_END;
  info.flagsV = EXPAND | SHRINK_END;
  const start = v.add(button(t('prestige.start')));
  start.flagsV = EXPAND | SHRINK_END;
  const back = v.add(button(t('common.back'), color('RED')));
  back.flagsV = SHRINK_END;
  const refresh = () => {
    const { curr, max } = opts.get();
    text.setText(t('prestige.value', curr));
    up.setEnabled(curr < max && curr < content.prestige.max);
    down.setEnabled(curr > 0);
  };
  down.onPressed = () => {
    opts.set(opts.get().curr - 1);
    refresh();
  };
  up.onPressed = () => {
    opts.set(opts.get().curr + 1);
    refresh();
  };
  start.onPressed = opts.onStart;
  back.onPressed = opts.onBack;
  info.onHover = () => opts.showInfo(info);
  info.onUnhover = opts.hideInfo;
  refresh();
  return { panel, buttons: [down, up, info, start, back], onBack: opts.onBack };
}

/** res://Scenes/Popups/GameMenu.tscn (Escape in the shop). */
export function gameMenu(opts: { onOptions: () => void; onMainMenu: () => void; onBack: () => void }): Popup {
  const panel = new Panel('filled');
  panel.customMin = { w: 166, h: 77 };
  const m = panel.add(new MarginBox(2, 2, 2, 2));
  const v = m.add(new VBox(1));
  const options = v.add(button(t('gameMenu.options')));
  const main = v.add(button(t('gameMenu.mainMenu')));
  const back = v.add(button(t('common.back'), color('RED')));
  back.flagsV = EXPAND | SHRINK_END;
  options.onPressed = opts.onOptions;
  main.onPressed = opts.onMainMenu;
  back.onPressed = opts.onBack;
  return { panel, buttons: [options, main, back], onBack: opts.onBack };
}

/** res://Scenes/Popups/ConfirmationPopup.tscn */
export function confirmation(message: string, onChoice: (yes: boolean) => void, noText = t('common.no'), yesText = t('common.yes')): Popup {
  const panel = new Panel('filled');
  panel.customMin = { w: 246, h: 0 };
  const m = panel.add(new MarginBox(2, 2, 2, 2));
  const v = m.add(new VBox(4));
  v.add(new RichLabel(`[center]${message}[/center]`));
  const h = v.add(new HBox(2));
  const no = h.add(button(noText, color('RED'), 0, 18));
  no.flagsH = EXPAND | FILL;
  const yes = h.add(button(yesText, undefined, 0, 18));
  yes.flagsH = EXPAND | FILL;
  no.onPressed = () => onChoice(false);
  yes.onPressed = () => onChoice(true);
  return { panel, buttons: [no, yes] };
}

/** res://Scenes/Popups/CreditsPopup.tscn: two CreditEntry blocks (label + URL button), back. */
export function creditsPopup(openUrl: (url: string) => void, onBack: () => void): Popup {
  const panel = new Panel('filled');
  panel.customMin = { w: 166, h: 121 };
  const m = panel.add(new MarginBox(2, 2, 2, 2));
  const v = m.add(new VBox(3));
  const buttons: TextButton[] = [];
  for (const [title, name, url] of [
    ['credits.developer', 'credits.developerName', 'credits.developerUrl'],
    ['credits.music', 'credits.musicName', 'credits.musicUrl'],
  ]) {
    const entry = v.add(new VBox(1));
    entry.add(new Label(t(title)));
    const grid = entry.add(new VBox(4));
    const b = grid.add(button(t(name), undefined, 60, 18));
    b.flagsH = 0;
    b.onPressed = () => openUrl(t(url));
    buttons.push(b);
  }
  const back = v.add(button(t('common.back'), color('RED')));
  back.flagsV = EXPAND | SHRINK_END;
  back.onPressed = onBack;
  buttons.push(back);
  return { panel, buttons, onBack };
}

/** The remake's achievements list (names and descriptions from Steam). */
export function achievementsList(unlocked: Record<string, boolean>, onBack: () => void): Popup {
  const panel = new Panel('filled');
  panel.customMin = { w: 300, h: 0 };
  const m = panel.add(new MarginBox(4, 3, 4, 3));
  const v = m.add(new VBox(2));
  const all = content.achievements.achievements;
  const got = all.filter((a) => unlocked[a.id]).length;
  const head = v.add(new RichLabel(`[center]${t('options.achievements')} [color=#eed345]${got}/${all.length}[/color][/center]`));
  head.autowrap = true;
  for (const a of all) {
    const row = v.add(new HBox(4));
    const ok = unlocked[a.id];
    const mark = row.add(new Label(ok ? '+' : '-', ok ? color('GREEN') : 0x6c6c6c));
    mark.customMin = { w: 6, h: 0 };
    const name = row.add(new Label(a.name, ok ? color('YELLOW') : 0x6c6c6c));
    name.customMin = { w: 84, h: 0 };
    const desc = row.add(new Label(a.description, ok ? WHITE : 0x6c6c6c));
    desc.flagsH = EXPAND | FILL;
  }
  const back = v.add(button(t('common.back'), color('RED')));
  back.onPressed = onBack;
  back.flagsH = FILL;
  void SHRINK_CENTER;
  return { panel, buttons: [back], onBack };
}
