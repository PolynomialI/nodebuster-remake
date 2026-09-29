import { ImageSource, Texture } from 'pixi.js';

export type TextureMap = Map<string, Texture>;

/** Decode every inlined image into a nearest-filtered Pixi texture, keyed by asset id. */
export async function loadTextures(images: Record<string, string>): Promise<TextureMap> {
  const entries = await Promise.all(
    Object.entries(images).map(async ([id, url]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const source = new ImageSource({ resource: img, scaleMode: 'nearest' });
      return [id, new Texture({ source })] as const;
    }),
  );
  return new Map(entries);
}
