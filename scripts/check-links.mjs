// Maintainer tool: reports starter games that don't answer normally. npm run check-links
import { readFileSync } from 'node:fs';

const games = JSON.parse(readFileSync(new URL('../data/starter-games.json', import.meta.url)));
const queue = [...games];
const problems = [];

async function worker() {
  while (queue.length) {
    const g = queue.shift();
    try {
      const res = await fetch(g.url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 Chrome/130' } });
      res.body?.cancel();
      if (res.status !== 200) problems.push(`${res.status} ${g.title} ${g.url}`);
    } catch (err) {
      problems.push(`${err.cause?.code || err.name} ${g.title} ${g.url}`);
    }
  }
}

await Promise.all(Array.from({ length: 10 }, worker));
console.log(`${games.length - problems.length} of ${games.length} answered 200.`);
console.log(problems.sort().join('\n'));
