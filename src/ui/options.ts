// res://Scenes/Popups/Options/OptionsPopup.tscn with OptionLine (Label + MenuButton
// with a PopupMenu) and OptionSlider (Label + HSlider + value), styled by
// res://Themes/DefaultTheme.tres over Godot's default theme. The remake adds two
// rows at the end: the achievements list and save export/import.
import { Graphics } from 'pixi.js';
import { LMB, type Input } from '../core/input';
import { color, content, t } from '../data/content';
import { Control, EXPAND, FILL, HBox, MarginBox, SHRINK_CENTER, SHRINK_END, VBox } from './control';
import { ui } from './ctx';
import { lockMouse, unlockMouse, type Pointer } from './pointer';
import type { Popup } from './popups';
import { ScrollBox } from './scroll';
import { Label, Panel, TextButton, solid, type Interactive } from './widgets';

const grey = (v: number) => {
  const c = Math.round(v * 255);
  return (c << 16) | (c << 8) | c;
};
// Default theme: control_font_color 0.875, hover 0.95, pressed 1.0.
const FONT = grey(0.875);
const FONT_HOVER = grey(0.95);
const FONT_PRESSED = 0xffffff;
// DefaultTheme.tres: MenuButton normal 0.19 / hover 0.27 / pressed 0.0902, margins 4 left/right.
const MB_NORMAL = grey(0.19);
const MB_HOVER = grey(0.27);
const MB_PRESSED = grey(0.0901961);
// PopupMenu panel 0.18, hover 0.32; Godot's item paddings 2 / 2.
const PM_PANEL = grey(0.18);
const PM_HOVER = grey(0.32);
// HSlider: track black 0.486 (content margins 2), grabber area 0.47 (0.58 highlighted), 8x8 grabber.
const SL_TRACK = { color: 0x000000, alpha: 0.486275 };
const SL_AREA = grey(0.470588);
const SL_AREA_HL = grey(0.58);

/** A Button drawn with the MenuButton styles (text centred, content margins 4). */
export class MenuPick extends Control implements Interactive {
  hovered = false;
  down = false;
  open = false;
  onPressed: (() => void) | null = null;
  private label: Label;

  constructor(public text: string) {
    super();
    this.label = new Label(text, FONT);
    this.label.hAlign = 'center';
    this.label.vAlign = 'center';
  }

  intrinsicMin(): { w: number; h: number } {
    return { w: ui.font.measure(this.text, 11) + 8, h: 12 };
  }

  setText(text: string): void {
    this.text = text;
    this.label.setText(text);
    this.relayout();
  }

  private relayout(): void {
    let c: Control = this;
    while (c.parent && c.inContainer) c = c.parent;
    if (c.parent) c.layoutAnchored({ x: 0, y: 0, w: c.parent.rect.w, h: c.parent.rect.h });
  }

  redraw(): void {
    const { w, h } = this.rect;
    this.gfx.removeChildren();
    const pressed = this.down || this.open;
    this.gfx.addChild(solid(0, 0, w, h, pressed ? MB_PRESSED : this.hovered ? MB_HOVER : MB_NORMAL));
    this.label.color = pressed ? FONT_PRESSED : this.hovered ? FONT_HOVER : FONT;
    this.label.setRect({ x: 4, y: 0, w: w - 8, h });
    this.gfx.addChild(this.label.view);
  }

  onEnter(): void {
    this.hovered = true;
    this.redraw();
    ui.playSfx('BUTTON_HOVER', { pitchRange: 0.2 });
  }
  onExit(): void {
    this.hovered = false;
    this.redraw();
  }
  onDown(): void {
    this.down = true;
    this.redraw();
  }
  onUp(): void {
    this.down = false;
    this.redraw();
  }
  onClick(): void {
    ui.playSfx('BUTTON_CLICK');
    this.onPressed?.();
  }
}

/** HSlider 0..100, step 1: clicking jumps the grabber to the pointer, dragging moves it. */
export class Slider extends Control implements Interactive {
  value = 0;
  hovered = false;
  private grab: { x0: number; v0: number } | null = null;
  onChange: (v: number) => void = () => {};
  private readonly g = new Graphics();

  constructor() {
    super();
    this.customMin = { w: 100, h: 0 };
    this.gfx.addChild(this.g);
  }

  intrinsicMin(): { w: number; h: number } {
    return { w: 4, h: 8 };
  }

  redraw(): void {
    const { w, h } = this.rect;
    const area = w - 8;
    const ratio = this.value / 100;
    const ty = Math.trunc((h - 4) / 2);
    this.g.clear();
    this.g.rect(0, ty, w, 4).fill(SL_TRACK);
    // Highlighted while hovered; a drag shows the MouseBlocker, which ends the hover.
    this.g.rect(0, ty, Math.trunc(area * ratio + 4), 4).fill(this.hovered ? SL_AREA_HL : SL_AREA);
    // Sprites/UI/Shapes/Slider/Grabber.png: an 8x8 square of #dcdcdc.
    this.g.rect(Math.trunc(ratio * area), Math.trunc(h / 2 - 4), 8, 8).fill(0xdcdcdc);
  }

  set(v: number): void {
    this.value = Math.min(100, Math.max(0, Math.round(v)));
    this.redraw();
  }

  contains(gx: number, gy: number): boolean {
    return super.contains(gx, gy);
  }
  onEnter(): void {
    this.hovered = true;
    this.redraw();
    ui.playSfx('BUTTON_HOVER', { pitchRange: 0.2 });
  }
  onExit(): void {
    this.hovered = false;
    this.redraw();
  }
  onDown(): void {}
  onUp(): void {}
  onClick(): void {}

  /** Slider.gui_input: press sets the ratio under the pointer; motion drags relative to it. */
  handle(input: Input, hoveredByPointer: boolean): void {
    const local = this.toLocal(input.mouse.x, input.mouse.y);
    const area = this.rect.w - 8;
    if (input.pressed.has(LMB) && hoveredByPointer && !this.grab) {
      const before = this.value;
      this.set(((local.x - 4) / area) * 100);
      this.grab = { x0: local.x, v0: this.value };
      lockMouse(this);
      ui.playSfx('BUTTON_DOWN');
      if (this.value !== before) this.onChange(this.value);
    } else if (this.grab) {
      if (!input.down.has(LMB)) {
        this.grab = null;
        unlockMouse(this);
        ui.playSfx('BUTTON_UP');
        this.redraw();
        return;
      }
      const before = this.value;
      this.set(this.grab.v0 + ((local.x - this.grab.x0) / area) * 100);
      if (this.value !== before) this.onChange(this.value);
    }
  }
}

interface ChoiceDef {
  id: string;
  label: string;
  kind: 'choice' | 'slider';
  choices?: string[] | string;
  default: number;
}

export interface OptionsHooks {
  get: (id: string) => number;
  set: (id: string, v: number) => void;
  /** Labels for window_size: "fullscreen", then 480x270 multiples that fit. */
  screenScales: () => string[];
  input: () => Input;
  pointer: () => Pointer;
  achievements: () => string;
  openAchievements: () => void;
  exportSave: () => void;
  importSave: () => void;
  onBack: () => void;
  /** The remake's rows (achievements, save); tests build the original popup without them. */
  extras?: boolean;
}

/** The PopupMenu below a MenuButton. */
class Dropdown extends Control {
  readonly items: { rect: { x: number; y: number; w: number; h: number }; text: string }[] = [];
  hover = -1;
  constructor(texts: string[], minW: number) {
    super();
    const w = Math.max(minW, ...texts.map((s) => ui.font.measure(s, 11) + 4));
    texts.forEach((s, i) => this.items.push({ rect: { x: 0, y: i * 12, w, h: 12 }, text: s }));
    this.customMin = { w, h: texts.length * 12 };
  }
  redraw(): void {
    const { w, h } = this.rect;
    this.gfx.removeChildren();
    this.gfx.addChild(solid(0, 0, w, h, PM_PANEL));
    this.items.forEach((it, i) => {
      if (i === this.hover) this.gfx.addChild(solid(0, it.rect.y, w, 12, PM_HOVER));
      const l = new Label(it.text, i === this.hover ? FONT_HOVER : FONT);
      l.setRect({ x: 2, y: it.rect.y, w: w - 4, h: 12 });
      this.gfx.addChild(l.view);
    });
  }
  indexAt(gx: number, gy: number): number {
    if (!this.isVisibleInTree()) return -1;
    const p = this.toLocal(gx, gy);
    if (p.x < 0 || p.x >= this.rect.w || p.y < 0 || p.y >= this.rect.h) return -1;
    return Math.floor(p.y / 12);
  }
}

export function optionsPopup(h: OptionsHooks): Popup {
  const panel = new Panel('filled');
  // 220x172 in the original; 22 px taller for the remake's two extra rows.
  const extras = h.extras ?? true;
  panel.customMin = { w: 220, h: extras ? 194 : 172 };
  const v = panel.add(new VBox(2));
  const m = v.add(new MarginBox(2, 2, 2, 0));
  m.flagsV = EXPAND | FILL;
  const list = new VBox(1);
  list.flagsH = EXPAND | FILL;
  const scroll = m.add(new ScrollBox(list));
  scroll.flagsV = EXPAND | FILL;
  const buttons: TextButton[] = [];
  const picks: MenuPick[] = [];
  const sliders: Slider[] = [];
  let dropdown: { d: Dropdown; pick: MenuPick; def: ChoiceDef; choices: string[] } | null = null;

  const row = (label: string) => {
    const r = list.add(new HBox());
    r.add(new Label(label));
    return r;
  };
  const choicesOf = (d: ChoiceDef): string[] => (d.choices === 'screenScales' ? h.screenScales() : (d.choices as string[]));
  for (const def of content.settings.options as unknown as ChoiceDef[]) {
    if (def.id === 'master_volume') {
      const spacer = list.add(new Control());
      spacer.customMin = { w: 0, h: 16 };
    }
    const r = row(def.label);
    if (def.kind === 'choice') {
      const choices = choicesOf(def);
      const pick = r.add(new MenuPick(choices[Math.min(h.get(def.id), choices.length - 1)] ?? ''));
      pick.flagsH = EXPAND | SHRINK_END;
      pick.onPressed = () => {
        const d = new Dropdown(choices, pick.rect.w);
        dropdown = { d, pick, def, choices };
        // The PopupMenu takes the mouse: nothing below it hovers while it is open.
        lockMouse(d);
        pick.open = true;
        pick.redraw();
        panelRoot().add(d);
        const p = pick.view.getGlobalPosition();
        const piv = pick.view.pivot;
        const rootPos = panelRoot().view.getGlobalPosition();
        d.setRect({ x: p.x - piv.x - rootPos.x, y: p.y - piv.y - rootPos.y + pick.rect.h, w: d.customMin.w, h: d.customMin.h });
      };
      picks.push(pick);
    } else {
      const s = r.add(new Slider());
      s.flagsH = EXPAND | SHRINK_END;
      s.flagsV = SHRINK_CENTER;
      // SliderVal keeps its scene text "100" until value_changed fires; setting the
      // slider to its initial value 0 fires nothing, so a volume of 0 reads "100".
      const val = r.add(new Label('100'));
      val.customMin = { w: 18, h: 0 };
      val.hAlign = 'right';
      s.set(h.get(def.id));
      if (h.get(def.id) !== 0) val.setText(String(h.get(def.id)));
      s.onChange = (x) => {
        val.setText(String(x));
        h.set(def.id, x);
      };
      sliders.push(s);
    }
  }
  // Remake rows: achievements list, save export/import.
  if (extras) {
    const ach = row(t('options.achievements')).add(new MenuPick(h.achievements()));
    ach.flagsH = EXPAND | SHRINK_END;
    ach.onPressed = h.openAchievements;
    picks.push(ach);
    const saveRow = row(t('options.save'));
    const exp = saveRow.add(new MenuPick(t('options.export')));
    exp.flagsH = EXPAND | SHRINK_END;
    exp.onPressed = h.exportSave;
    const imp = saveRow.add(new MenuPick(t('options.import')));
    imp.onPressed = h.importSave;
    picks.push(exp, imp);
  }

  const back = v.add(new TextButton(t('common.back'), color('RED')));
  back.customMin = { w: 0, h: 16 };
  back.flagsV = SHRINK_END;
  back.onPressed = h.onBack;
  buttons.push(back);
  // The dropdown lives on the popup manager's root, above the panel.
  const panelRoot = (): Control => {
    let c: Control = panel;
    while (c.parent) c = c.parent;
    return c;
  };
  const closeDropdown = () => {
    if (!dropdown) return;
    unlockMouse(dropdown.d);
    dropdown.pick.open = false;
    dropdown.pick.redraw();
    dropdown.d.parent?.remove(dropdown.d);
    dropdown.d.view.destroy({ children: true });
    dropdown = null;
  };

  return {
    panel,
    buttons,
    extraTargets: [...picks, ...sliders],
    onBack: h.onBack,
    update: (dt: number) => {
      void dt;
      const input = h.input();
      const pointer = h.pointer();
      if (dropdown) {
        const dd = dropdown;
        const i = dd.d.indexAt(input.mouse.x, input.mouse.y);
        if (i !== dd.d.hover) {
          dd.d.hover = i;
          dd.d.redraw();
        }
        if (input.pressed.has(LMB)) {
          if (i >= 0) {
            dd.pick.setText(dd.choices[i]);
            h.set(dd.def.id, i);
            ui.playSfx('BUTTON_CLICK');
          }
          closeDropdown();
          input.pressed.delete(LMB);
        }
        return;
      }
      for (const s of sliders) s.handle(input, pointer.hovered === s);
    },
    onClose: closeDropdown,
  };
}

