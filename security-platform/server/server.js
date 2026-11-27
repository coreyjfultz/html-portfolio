import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { sessionUser, purgeSessions } from './security.js';
import { HttpError, list, get, create, update, remove, reveal, getDef, canRead } from './resources.js';
import { buildRoutes } from './routes.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (pathname === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(PUBLIC, 'index.html');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(file).pipe(res);
}

export function createServer(db) {
  const routes = buildRoutes();
  const secureCookies = process.env.COOKIE_SECURE === '1';

  return http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, pathname);
    }

    try {
      // CSRF defence: state-changing API calls must come from our own JS (custom
      // header cannot be sent cross-site without a CORS preflight, which we never allow).
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'SecureOps') throw new HttpError(403, 'Missing request header');

      const cookies = parseCookies(req.headers.cookie);
      const token = cookies.sid;
      const user = sessionUser(db, token);
      const query = Object.fromEntries(url.searchParams);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const https = secureCookies || req.headers['x-forwarded-proto'] === 'https';
      const setCookie = t => res.setHeader('Set-Cookie', t
        ? `sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${14 * 86400}${https ? '; Secure' : ''}`
        : `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${https ? '; Secure' : ''}`);
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

      for (const rt of routes) {
        if (rt.method !== req.method) continue;
        const m = pathname.match(rt.re);
        if (!m) continue;
        if (rt.roles) {
          if (!user) throw new HttpError(401, 'Please sign in');
          if (!rt.roles.includes(user.role)) throw new HttpError(403, 'Your role does not have access to this');
        }
        const params = Object.fromEntries(rt.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = await rt.handler({ db, user, params, query, body, req, res, token, setCookie, ip });
        if (out !== undefined) sendJson(res, 200, out);
        return;
      }

      // Generic CRUD: /api/r/:resource[/:id[/reveal]]
      const m = pathname.match(/^\/api\/r\/([a-z_]+)(?:\/(\d+))?(?:\/(reveal))?$/);
      if (!m) throw new HttpError(404, 'Not found');
      if (!user) throw new HttpError(401, 'Please sign in');
      const [, name, id, action] = m;
      const def = getDef(name);
      if (!canRead(def, user)) throw new HttpError(403, 'Your role does not have access to this');
      let out;
      if (action === 'reveal' && req.method === 'POST') out = reveal(db, name, id, body.field, user);
      else if (req.method === 'GET' && !id) out = list(db, name, query, user);
      else if (req.method === 'GET') out = get(db, name, id);
      else if (req.method === 'POST' && !id) out = create(db, name, body, user);
      else if (req.method === 'PUT' && id) out = update(db, name, id, body, user);
      else if (req.method === 'DELETE' && id) out = remove(db, name, id, user);
      else throw new HttpError(405, 'Method not allowed');
      sendJson(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server' : e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  purgeSessions(db);
  setInterval(() => purgeSessions(db), 6 * 3600e3).unref();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  createServer(db).listen(port, host, () => console.log(`SecureOps running at http://localhost:${port}`));
}
