// Shared UI context (font, textures, sound hook), set once at startup.
import type { Texture } from 'pixi.js';
import type { PixelFont } from '../render/pixelfont';

export interface SfxOptions {
  pitchRange?: number;
  volumeDb?: number;
  pitchOffset?: number;
  cooldownSteps?: number;
}

export const ui = {
  font: null as unknown as PixelFont,
  textures: new Map<string, Texture>(),
  playSfx: (_name: string, _opts?: SfxOptions): void => {},
  /** Game time in seconds (drives rainbow text and blinking). */
  time: 0,
};

export function tex(id: string): Texture {
  const t = ui.textures.get(id);
  if (!t) throw new Error(`Missing texture ${id}`);
  return t;
}

/** res://Sprites/UI/Red.png style paths used in the original's [img] tags → asset ids. */
export const IMG_PATHS: Record<string, string> = {
  'Sprites/UI/Red.png': 'icon/bits',
  'Sprites/UI/Blue.png': 'icon/nodes',
  'Sprites/UI/Purple.png': 'icon/cores',
  'Sprites/UI/SP.png': 'icon/sp',
  'Sprites/UI/Netcoin.png': 'icon/netcoin',
  'Sprites/UI/Processors.png': 'icon/processors',
};
