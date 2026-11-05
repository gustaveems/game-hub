import { readFileSync } from 'node:fs';
import './fake-chrome.js';

const starter = readFileSync(new URL('../data/starter-games.json', import.meta.url), 'utf8');

export function freshChrome() {
  globalThis.chrome = globalThis.makeFakeChrome();
  globalThis.fetch = async () => new Response(starter);
  return globalThis.chrome;
}
