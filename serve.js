// Reach — tiny local server, zero dependencies.
//   node serve.js            -> http://127.0.0.1:4477
//   node serve.js 5000       -> another port
// Serves this folder only. Binds to localhost, so nothing on your network can reach it.
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname;
const port = Number(process.argv[2]) || 4477;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Reach: http://127.0.0.1:${port}`));
