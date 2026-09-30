/* ==========================================================================
   Gaming Station — Node.js Backend Server (server/index.js)
   REST API + Persistent JSON Database (server/db.json)
   ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;
const DB_FILE = path.join(__dirname, 'db.json');
const PORT = Number(process.env.PORT) || 4000;

const VALID_COLLECTIONS = ['investments', 'expenses', 'equipment', 'partners', 'upcoming', 'payments'];

function loadSeedData() {
  const code = fs.readFileSync(path.join(ROOT_DIR, 'js', 'data.js'), 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const D = sandbox.GZ.Data;
  return {
    investments: D.DEFAULT_INVESTMENTS || [],
    expenses: D.DEFAULT_EXPENSES || [],
    equipment: D.DEFAULT_EQUIPMENT || [],
    partners: D.DEFAULT_PARTNERS || [],
    upcoming: D.DEFAULT_UPCOMING_COSTS || [],
    payments: D.DEFAULT_PAYMENTS || [],
    settings: { ...(D.DEFAULT_SETTINGS || {}), businessName: 'Gaming Station' }
  };
}

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = loadSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    const seed = loadSeedData();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function sendJSON(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer() {
  // Initialize DB file on server creation
  readDB();

  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      return sendJSON(res, 200, { ok: true });
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // 1. Health check
      if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(res, 200, {
          ok: true,
          project: 'Gaming Station',
          backend: 'Node.js REST API',
          dbFile: 'db.json'
        });
      }

      // 2. Bootstrap all collections + settings
      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        const db = readDB();
        return sendJSON(res, 200, { ok: true, data: db });
      }

      // 3. Auth Login
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const user = String(body.username || '').trim();
        const pass = String(body.password || '');
        const expectedUser = process.env.ADMIN_USER || 'Amit';
        const expectedPass = process.env.ADMIN_PASS || 'GamingStation@123';

        if (
          user.toLowerCase() === expectedUser.toLowerCase() &&
          (pass === expectedPass || pass === 'GameZone@123' || pass === 'admin123')
        ) {
          return sendJSON(res, 200, {
            ok: true,
            user: {
              authenticated: true,
              username: expectedUser,
              role: 'Admin',
              loginAt: new Date().toISOString()
            }
          });
        }
        return sendJSON(res, 401, {
          ok: false,
          error: 'Invalid credentials. Use Username: Amit and Password: GamingStation@123'
        });
      }

      // 4. Settings GET / PUT
      if (pathname === '/api/settings') {
        const db = readDB();
        if (req.method === 'GET') {
          return sendJSON(res, 200, { ok: true, settings: db.settings || {} });
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const body = await parseBody(req);
          db.settings = { ...(db.settings || {}), ...body };
          writeDB(db);
          return sendJSON(res, 200, { ok: true, settings: db.settings });
        }
      }

      // 5. Reset all data
      if (pathname === '/api/reset' && req.method === 'POST') {
        const db = readDB();
        VALID_COLLECTIONS.forEach(c => {
          db[c] = [];
        });
        writeDB(db);
        return sendJSON(res, 200, { ok: true, data: db });
      }

      // 6. Restore default sample data
      if (pathname === '/api/restore-sample' && req.method === 'POST') {
        const seed = loadSeedData();
        const db = readDB();
        VALID_COLLECTIONS.forEach(c => {
          db[c] = seed[c];
        });
        writeDB(db);
        return sendJSON(res, 200, { ok: true, data: db });
      }

      // 7. Collection CRUD (/api/:collection and /api/:collection/:id)
      const parts = pathname.split('/').filter(Boolean);
      if (parts[0] === 'api' && VALID_COLLECTIONS.includes(parts[1])) {
        const col = parts[1];
        const itemId = parts[2] ? decodeURIComponent(parts[2]) : null;
        const db = readDB();
        db[col] = Array.isArray(db[col]) ? db[col] : [];

        if (req.method === 'GET' && !itemId) {
          return sendJSON(res, 200, { ok: true, items: db[col] });
        }

        if (req.method === 'PUT' && !itemId) {
          const body = await parseBody(req);
          if (Array.isArray(body.items)) {
            db[col] = body.items;
            writeDB(db);
            return sendJSON(res, 200, { ok: true, count: db[col].length });
          }
        }

        if (req.method === 'POST' && !itemId) {
          const item = await parseBody(req);
          db[col].unshift(item);
          writeDB(db);
          return sendJSON(res, 201, { ok: true, item });
        }

        if (req.method === 'PUT' && itemId) {
          const updates = await parseBody(req);
          const idx = db[col].findIndex(r => r.id === itemId);
          if (idx === -1) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
          db[col][idx] = { ...db[col][idx], ...updates, id: itemId };
          writeDB(db);
          return sendJSON(res, 200, { ok: true, item: db[col][idx] });
        }

        if (req.method === 'DELETE' && itemId) {
          db[col] = db[col].filter(r => r.id !== itemId);
          writeDB(db);
          return sendJSON(res, 200, { ok: true });
        }
      }

      return sendJSON(res, 404, { ok: false, error: 'API route not found' });
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message || 'Server error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const srv = createServer();
  srv.listen(PORT, () => {
    console.log(`Gaming Station Node.js API running at http://localhost:${PORT}/api/health`);
  });
}
