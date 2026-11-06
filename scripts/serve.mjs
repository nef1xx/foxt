import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ttf':'font/ttf','.webm':'video/webm','.txt':'text/plain; charset=utf-8'};
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    const allowed = ['/index.html','/styles.css','/app.js','/data.js','/assets/'];
    if (!allowed.some(item => item.endsWith('/') ? path.startsWith(item) : path === item)) { response.writeHead(404).end('Not found'); return; }
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + (root.endsWith(sep) ? '' : sep))) { response.writeHead(403).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    const headers = {'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'};
    if (request.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!match) { response.writeHead(416, {'Content-Range':`bytes */${info.size}`}).end(); return; }
      const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (start > end || start >= info.size) { response.writeHead(416, {'Content-Range':`bytes */${info.size}`}).end(); return; }
      response.writeHead(206, {...headers,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});
      if (request.method === 'HEAD') response.end(); else createReadStream(file, {start,end}).pipe(response); return;
    }
    response.writeHead(200, {...headers,'Content-Length':info.size});
    if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`BRATKI preview: http://127.0.0.1:${port}`));
