// Save export/import (a remake addition in the options popup). A canvas can't
// offer text selection or pasting, so this is a small DOM dialog over the game,
// drawn in the game's colours and pixel font.
import * as assets from '../assets';
import { t } from '../data/content';

let fontReady: Promise<void> | null = null;

function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    try {
      const face = new FontFace('NodebusterPixel', `url(${assets.fonts.main})`);
      await face.load();
      document.fonts.add(face);
    } catch {
      // The system monospace font stands in.
    }
  })();
  return fontReady;
}

const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);

function button(label: string, fill: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  css(b, {
    font: '22px NodebusterPixel, monospace',
    color: '#dcdcdc',
    background: fill,
    border: '2px solid #dcdcdc',
    outline: '2px solid #1f1f1f',
    outlineOffset: '-4px',
    padding: '4px 14px',
    cursor: 'pointer',
    textShadow: '0 2px 0 #1f1f1f',
  });
  return b;
}

export interface SaveDialogOptions {
  /** The save string to show (export). */
  text?: string;
  /** Import the pasted string; returns an error message or null. */
  onImport?: (s: string) => string | null;
  onClose: () => void;
}

export function openSaveDialog(mode: 'export' | 'import', o: SaveDialogOptions): void {
  void loadFont();
  const overlay = document.createElement('div');
  css(overlay, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10', padding: '16px' });
  const panel = document.createElement('div');
  css(panel, {
    background: '#1f1f1f',
    border: '2px solid #dcdcdc',
    padding: '14px',
    width: 'min(560px, 100%)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    color: '#dcdcdc',
    font: '22px NodebusterPixel, monospace',
  });
  const title = document.createElement('div');
  title.textContent = t(mode === 'export' ? 'options.export' : 'options.import');
  const hint = document.createElement('div');
  hint.textContent = t(mode === 'export' ? 'options.exportHint' : 'options.importHint');
  css(hint, { color: '#8f8f8f' });
  const area = document.createElement('textarea');
  area.rows = 5;
  area.spellcheck = false;
  area.value = o.text ?? '';
  area.readOnly = mode === 'export';
  css(area, { width: '100%', boxSizing: 'border-box', background: '#0f0f0f', color: '#dcdcdc', border: '2px solid #6c6c6c', font: '14px ui-monospace, monospace', padding: '6px', resize: 'vertical', wordBreak: 'break-all' });
  const status = document.createElement('div');
  css(status, { minHeight: '26px', color: '#4ff264' });
  const row = document.createElement('div');
  css(row, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' });
  const close = () => {
    overlay.remove();
    o.onClose();
  };
  const back = button(t('common.back'), '#f03a3f');
  back.onclick = close;
  if (mode === 'export') {
    const copy = button(t('options.copy'), '#457af6');
    copy.onclick = () => {
      area.select();
      navigator.clipboard?.writeText(area.value).then(
        () => (status.textContent = t('options.exportDone')),
        () => (status.textContent = t('options.exportHint')),
      );
    };
    row.append(copy, back);
  } else {
    const imp = button(t('options.import'), '#1d8c38');
    imp.onclick = () => {
      const err = o.onImport?.(area.value.trim()) ?? null;
      css(status, { color: err ? '#f03a3f' : '#4ff264' });
      status.textContent = err ?? t('options.importDone');
      if (!err) setTimeout(close, 700);
    };
    row.append(imp, back);
  }
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  });
  panel.append(title, hint, area, status, row);
  overlay.append(panel);
  document.body.append(overlay);
  if (mode === 'export') area.select();
  else area.focus();
}
