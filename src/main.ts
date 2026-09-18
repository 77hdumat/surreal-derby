import { Game } from './game/Game';

const gl = document.getElementById('gl') as HTMLCanvasElement;
const fx = document.getElementById('fx') as HTMLCanvasElement;

const game = new Game(gl, fx);
game.start();

// 디버그용
(window as unknown as { game: Game }).game = game;
