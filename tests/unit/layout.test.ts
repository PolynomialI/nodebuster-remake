// The Godot container rules the UI transcription relies on (box_container.cpp,
// grid_container.cpp, margin_container.cpp in Godot 4.2).
import { describe, expect, it } from 'vitest';
import { Control, EXPAND, FILL, Grid, HBox, MarginBox, Root, SHRINK_CENTER, SHRINK_END } from '../../src/ui/control';

const fixed = (w: number, h: number, flagsH = FILL, flagsV = FILL): Control => {
  const c = new Control();
  c.customMin = { w, h };
  c.flagsH = flagsH;
  c.flagsV = flagsV;
  return c;
};

describe('BoxContainer', () => {
  it('splits the whole stretch area evenly, not the leftover space (StatEntry rows)', () => {
    const root = new Root(480, 270);
    const row = root.add(new HBox());
    row.place(0, 0, 183, 12);
    const name = row.add(fixed(88, 12, EXPAND | FILL));
    const value = row.add(fixed(47, 12, EXPAND | FILL));
    root.layout();
    // stretch_avail = 88 + 47 + (179 - 135) = 179 -> 89.5 each; the error pixel goes to the second.
    expect([name.rect.x, name.rect.w]).toEqual([0, 89]);
    expect([value.rect.x, value.rect.w]).toEqual([93, 90]);
  });

  it('keeps a child that does not fit its share at its minimum and gives the rest to the others', () => {
    const root = new Root(480, 270);
    const row = root.add(new HBox());
    row.place(0, 0, 150, 12);
    const a = row.add(fixed(100, 12, EXPAND | FILL));
    const b = row.add(fixed(10, 12, EXPAND | FILL));
    root.layout();
    expect([a.rect.x, a.rect.w]).toEqual([0, 100]);
    expect([b.rect.x, b.rect.w]).toEqual([104, 46]);
  });

  it('centres non-expanding children with integer division (main menu buttons)', () => {
    const root = new Root(480, 270);
    const row = root.add(new HBox(16));
    row.place(-82, 178, 564, 208);
    row.alignment = 'center';
    const kids = [fixed(78, 30), fixed(78, 22, FILL, SHRINK_CENTER), fixed(78, 22, FILL, SHRINK_CENTER)];
    for (const k of kids) row.add(k);
    root.layout();
    // 646 wide, 266 used: offset 190.
    expect(kids.map((k) => [k.rect.x, k.rect.y, k.rect.h])).toEqual([
      [190, 0, 30],
      [284, 4, 22],
      [378, 4, 22],
    ]);
  });
});

describe('GridContainer', () => {
  it('shares expanded columns in whole pixels, the spare pixel going left (Crypto Mine deposits)', () => {
    const root = new Root(480, 270);
    const g = root.add(new Grid(3));
    g.hSep = g.vSep = 1;
    g.place(0, 0, 183, 41);
    const cells = Array.from({ length: 6 }, () => g.add(fixed(46, 20, EXPAND | FILL)));
    root.layout();
    expect(cells.map((c) => [c.rect.x, c.rect.w])).toEqual([
      [0, 61],
      [62, 60],
      [123, 60],
      [0, 61],
      [62, 60],
      [123, 60],
    ]);
    expect(cells[3].rect.y).toBe(21);
  });
});

describe('MarginContainer and fit_child_in_rect', () => {
  it('truncates the inner size and places shrink-flagged children', () => {
    const root = new Root(480, 270);
    const m = root.add(new MarginBox(2, 2, 2, 2));
    m.place(0, 0, 100.5, 50.5);
    const end = m.add(fixed(10, 10, SHRINK_END, SHRINK_CENTER));
    root.layout();
    // Inner rect is int(96.5) x int(46.5) = 96 x 46.
    expect(end.rect).toEqual({ x: 2 + 96 - 10, y: 2 + 18, w: 10, h: 10 });
  });
});
