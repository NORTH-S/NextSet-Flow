import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleLocalApi } from './worker/index.js';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(projectRoot, 'dist');
const port = Number(process.env.PORT || 4178);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);
    if (url.pathname.startsWith('/api/')) {
      req.resume();
      const request = new Request(url, { method: req.method });
      const response = handleLocalApi(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    const pathname = decodeURIComponent(url.pathname);
    const assetPath = pathname === '/' ? '/index.html' : pathname;
    if (!/^\/[^/\\\0]+$/.test(assetPath) || assetPath.startsWith('/.')) { res.writeHead(404); return res.end('Not found'); }
    const path = resolve(root, assetPath.slice(1));
    const content = await readFile(path);
    if (!types[extname(path)]) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`NextSet Flow preview: http://127.0.0.1:${server.address().port} (trained model runs in browser; no external API)`));
