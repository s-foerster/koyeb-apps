/**
 * Routeur multi-apps pour un seul service Koyeb.
 *
 * - Lance les 4 apps comme processus enfants, chacune sur un port interne.
 * - Expose un seul port public (PORT, 8000 sur Koyeb) et route par chemin :
 *     /maboul/...  -> Maboul du Mardoul (port 3002)
 *     /odin/...    -> Odin               (port 3003)
 *     /trio/...    -> Trio               (port 3004)
 *     tout le reste -> Kuzzle / hearts_game (port 3001), inchangé à la racine
 * - Le préfixe est retiré avant de transmettre : chaque app croit être à "/".
 * - Gère les WebSockets (socket.io pour Maboul, ws pour Odin et Trio).
 * - Redémarre une app si elle plante.
 *
 * DISABLED_APPS=odin,maboul,trio permet de désactiver une app (pour économiser la mémoire).
 *
 * Aucune dépendance npm : uniquement les modules intégrés à Node.
 */
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8000;
const APPS_DIR = process.env.APPS_DIR || path.join(__dirname, 'apps');
const DISABLED = (process.env.DISABLED_APPS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const APPS = [
  {
    name: 'hearts',
    prefix: '', // racine du domaine
    port: 3001,
    cwd: path.join(APPS_DIR, 'hearts'),
    args: ['server.js'],
    env: { NODE_ENV: 'production' },
  },
  {
    name: 'maboul',
    prefix: '/maboul',
    port: 3002,
    cwd: path.join(APPS_DIR, 'maboul'),
    args: ['src/server.js'],
    env: { NODE_ENV: 'production' },
  },
  {
    name: 'odin',
    prefix: '/odin',
    port: 3003,
    cwd: path.join(APPS_DIR, 'odin'),
    args: ['dist/index.js'],
    env: { NODE_ENV: 'production' },
  },
  {
    name: 'trio',
    prefix: '/trio',
    port: 3004,
    cwd: path.join(APPS_DIR, 'trio'),
    // Petite app sans dépendance : on plafonne sa mémoire pour laisser de la place aux autres
    args: ['--max-old-space-size=64', 'server.js'],
    env: { NODE_ENV: 'production' },
  },
].filter((app) => !DISABLED.includes(app.name));

const log = (...a) => console.log(new Date().toISOString(), '[gateway]', ...a);

// ── Supervision des processus ────────────────────────────────────────────────
let shuttingDown = false;

function startApp(app) {
  app.ready = false;
  const child = spawn(process.execPath, app.args, {
    cwd: app.cwd,
    env: { ...process.env, ...app.env, PORT: String(app.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.child = child;
  const prefixLines = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(`[${app.name}] ${line}\n`);
    });
  };
  prefixLines(child.stdout, process.stdout);
  prefixLines(child.stderr, process.stderr);

  child.on('exit', (code, signal) => {
    app.ready = false;
    if (shuttingDown) return;
    app.restarts = (app.restarts || 0) + 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(app.restarts, 5));
    log(`${app.name} s'est arrêté (code=${code}, signal=${signal}), redémarrage dans ${delay / 1000}s`);
    setTimeout(() => startApp(app), delay);
  });

  pollReady(app, child);
}

function pollReady(app, child) {
  const tryConnect = () => {
    if (app.child !== child || child.exitCode !== null) return;
    const sock = net.connect(app.port, '127.0.0.1');
    sock.once('connect', () => {
      sock.destroy();
      app.ready = true;
      app.restarts = 0;
      log(`${app.name} prêt sur le port ${app.port}`);
      (app.waiters || []).forEach((w) => w());
      app.waiters = [];
    });
    sock.once('error', () => setTimeout(tryConnect, 300));
  };
  tryConnect();
}

// Attend qu'une app soit prête (utile au réveil après la mise en veille Koyeb).
function waitReady(app, timeoutMs = 45000) {
  if (app.ready) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    app.waiters = app.waiters || [];
    app.waiters.push(() => { clearTimeout(timer); resolve(true); });
  });
}

// ── Routage ──────────────────────────────────────────────────────────────────
const rootApp = APPS.find((a) => a.prefix === '');
const prefixedApps = APPS.filter((a) => a.prefix !== '');

/** Retourne { app, url } ou { redirect } */
function route(reqUrl) {
  for (const app of prefixedApps) {
    const p = app.prefix;
    if (reqUrl === p || reqUrl.startsWith(p + '?')) {
      // "/odin" -> "/odin/" pour que les chemins relatifs fonctionnent
      return { redirect: p + '/' + reqUrl.slice(p.length) };
    }
    if (reqUrl.startsWith(p + '/')) {
      return { app, url: reqUrl.slice(p.length) || '/' };
    }
  }
  return rootApp ? { app: rootApp, url: reqUrl } : {};
}

// ── Proxy HTTP / WebSocket (modules Node natifs) ─────────────────────────────
// On transmet tel quel le X-Forwarded-For posé par Koyeb (sans y ajouter
// 127.0.0.1) pour que les apps voient la vraie IP du client.
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

function sendError(res, status, message) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
  res.end(message);
}

function proxyHttp(req, res, app, url) {
  const headers = { ...req.headers };
  if (app.prefix) headers['x-forwarded-prefix'] = app.prefix;
  const upstream = http.request({
    host: '127.0.0.1',
    port: app.port,
    method: req.method,
    path: url,
    headers,
    agent,
  }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.statusMessage, upRes.headers);
    upRes.pipe(res);
  });
  upstream.on('error', (err) => {
    log(`erreur proxy ${app.name} ${url}: ${err.code || err.message}`);
    sendError(res, 502, 'Application momentanément indisponible, réessayez dans quelques secondes.');
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, app, url) {
  const upstream = net.connect(app.port, '127.0.0.1', () => {
    let raw = `${req.method} ${url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    if (app.prefix) raw += `X-Forwarded-Prefix: ${app.prefix}\r\n`;
    raw += '\r\n';
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.setNoDelay(true);
  socket.setNoDelay(true);
  const close = () => { upstream.destroy(); socket.destroy(); };
  upstream.on('error', close);
  socket.on('error', close);
  upstream.on('close', close);
  socket.on('close', close);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/__gateway/health') {
    const status = Object.fromEntries(APPS.map((a) => [a.name, a.ready ? 'up' : 'starting']));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(status));
  }

  const r = route(req.url);
  if (r.redirect) {
    res.writeHead(301, { Location: r.redirect });
    return res.end();
  }
  if (!r.app) {
    res.writeHead(404);
    return res.end('Not found');
  }
  if (!(await waitReady(r.app))) {
    return sendError(res, 503, "L'application démarre, réessayez dans quelques secondes.");
  }
  proxyHttp(req, res, r.app, r.url);
});

server.on('upgrade', async (req, socket, head) => {
  const r = route(req.url);
  if (!r.app || !(await waitReady(r.app, 15000))) return socket.destroy();
  proxyUpgrade(req, socket, head, r.app, r.url);
});

// Garder les WebSockets ouverts longtemps (parties en cours)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// ── Démarrage / arrêt ────────────────────────────────────────────────────────
APPS.forEach(startApp);
server.listen(PORT, '0.0.0.0', () => {
  log(`écoute sur le port ${PORT} — apps : ${APPS.map((a) => `${a.name} (${a.prefix || '/'})`).join(', ')}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} reçu, arrêt des apps…`);
  APPS.forEach((a) => a.child && a.child.kill('SIGTERM'));
  server.close();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
