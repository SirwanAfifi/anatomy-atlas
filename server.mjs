import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat, realpath} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const production = process.argv.includes('--production');
const root = resolve(projectRoot, production ? 'dist' : 'public');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveAsset(req, res, pathname) {
  try {
    if (pathname.includes('\\') || pathname.includes('\0')) throw new Error('Invalid path');
    const requested = resolve(root, '.' + pathname);
    if (!requested.startsWith(root + sep)) throw new Error('Outside static root');
    const file = await realpath(requested);
    const realRoot = await realpath(root);
    if (!file.startsWith(realRoot + sep)) throw new Error('Outside static root');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': /[-.][\w-]{8,}\.(js|css)$/.test(pathname) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function staticRequest(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow: 'GET, HEAD'});
    return res.end('Method not allowed');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Invalid URL');
  }
  const isIndex = production && (pathname === '/' || pathname === '/index.html');
  const assetPrefixes = production ? ['/assets/'] : ['/assets/anatomy/', '/assets/exercises/'];
  const isAsset = assetPrefixes.some(prefix => pathname.startsWith(prefix)) && Object.hasOwn(types, extname(pathname));
  if (isIndex || isAsset) return void serveAsset(req, res, isIndex ? '/index.html' : pathname);
  if (next) {
    // Vite needs source modules and its own client, not arbitrary repository files.
    const devModule = /^\/src\/[\w./-]+\.(js|css)$/.test(pathname) || pathname.startsWith('/node_modules/.vite/') || pathname.startsWith('/node_modules/vite/dist/client/') || pathname.startsWith('/@vite/') || pathname.startsWith('/@id/');
    if (pathname === '/' || pathname === '/index.html' || devModule) return next();
  }
  res.writeHead(404);
  res.end('Not found');
}

if (production) {
  http.createServer((req, res) => staticRequest(req, res)).listen(port, '127.0.0.1', () => {
    console.log(`Anatomy Atlas ready at http://localhost:${port} (production)`);
  });
} else {
  const {createServer} = await import('vite');
  const server = await createServer({
    root: projectRoot,
    plugins: [{name: 'atlas-local-anatomy', configureServer(devServer) { devServer.middlewares.use(staticRequest); }}],
  });
  await server.listen();
  server.printUrls();
}
