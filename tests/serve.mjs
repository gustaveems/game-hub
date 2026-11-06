// Serves the extension over http with fake chrome.* APIs, so its pages run in a normal browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 8765;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    let body = await readFile(join(ROOT, path === '/' ? 'library.html' : path));
    if (extname(path) === '.html' || path === '/') {
      body = String(body).replace('<script type="module"', '<script src="/tests/fake-chrome.js"></script>\n  <script type="module"');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/library.html`));
