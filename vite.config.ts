import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One self-contained index.html (code, images, fonts and sound effects inlined).
// Music is streamed after start from dist/music/, copied from assets-gen/public.
export default defineConfig({
  base: './',
  publicDir: 'assets-gen/public',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 20_000,
    reportCompressedSize: false,
    modulePreload: false,
  },
});
