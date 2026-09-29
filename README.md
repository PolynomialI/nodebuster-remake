# nodebuster-remake

A browser remake of *Nodebuster* (Goblobin, 2024) that runs as a private Claude artifact.
Plan: [PLAN.md](PLAN.md). Values and behaviour: [research/](research/README.md).

## Build

Needs Node 22+, ffmpeg with libopus, and the recovered game in `reference/extracted/`
(see research/README.md; `reference/` is never committed). On the dev machine, portable
copies of Node and ffmpeg live in `.tools/` (gitignored).

```
npm install
npm run build      # assets-gen/ from reference/, then dist/ (artifact form)
npm test           # Vitest: values, timings, logic
npm run e2e        # Playwright against dist/ (Chrome)
node scripts/serve.mjs 4173   # play dist/ locally at http://127.0.0.1:4173/
```

`dist/` is the whole build: `index.html` (code, images, font and sound effects inlined)
plus `music/*.ogg` and `sfx/BACKGROUND_NOISE.ogg`, streamed after the game starts. The
game's art and audio only ever go into `assets-gen/` and `dist/`, both gitignored.

Game values and text live in `content/*.json`; new nodes, enemies or bosses are added
there without code changes.
