import { Game } from './game';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const fallback = document.getElementById('fallback') as HTMLDivElement;

Game.create(canvas)
  .then((game) => {
    game.start();
    (window as unknown as { __nb: unknown }).__nb = game.debugApi();
  })
  .catch((err: unknown) => {
    console.error(err);
    fallback.textContent = 'The game could not start. It needs WebGL, which this browser or device has turned off. Try Chrome with hardware acceleration on.';
    fallback.hidden = false;
  });
