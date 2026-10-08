const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'change-this-secret-salt-before-production';
const TRUST_PROXY = String(process.env.TRUST_PROXY || '').toLowerCase() === 'true';

const dataDir = path.join(__dirname, 'data');
const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'survey.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL UNIQUE,
    other_text TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS submission_options (
    submission_id INTEGER NOT NULL,
    option_key TEXT NOT NULL,
    PRIMARY KEY (submission_id, option_key),
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_submission_options_key
    ON submission_options(option_key);
`);

const OPTIONS = [
  { key: 'view_without_colour', label: 'View – Without colour' },
  { key: 'view_with_colour', label: 'View – With colour' },
  { key: 'sound', label: 'Sound' },
  { key: 'smell', label: 'Smell' },
  { key: 'taste', label: 'Taste' },
  { key: 'touch_wetness', label: 'Touch – Wetness' },
  { key: 'touch_temperature', label: 'Touch – Temperature' },
  { key: 'touch_roughness', label: 'Touch – Roughness' },
  { key: 'other', label: 'Other' }
];
const VALID_OPTION_KEYS = new Set(OPTIONS.map((o) => o.key));
const WORD_RE = /\S+/g;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(`${IP_HASH_SALT}:${ip}`).digest('hex');
}

function countWords(text) {
  return (text || '').match(WORD_RE)?.length || 0;
}

const statements = {
  findByIp: db.prepare('SELECT id FROM submissions WHERE ip_hash = ? LIMIT 1'),
  countOptions: db.prepare('SELECT option_key, COUNT(*) AS count FROM submission_options GROUP BY option_key'),
  listOther: db.prepare(`SELECT other_text AS text, created_at AS createdAt FROM submissions WHERE other_text IS NOT NULL AND TRIM(other_text) <> '' ORDER BY id DESC`),
  total: db.prepare('SELECT COUNT(*) AS count FROM submissions'),
  insertSubmission: db.prepare('INSERT INTO submissions (ip_hash, other_text, created_at) VALUES (?, ?, ?)'),
  insertOption: db.prepare('INSERT INTO submission_options (submission_id, option_key) VALUES (?, ?)')
};

function getResults() {
  const rows = statements.countOptions.all();
  const byKey = new Map(rows.map((r) => [r.option_key, Number(r.count)]));
  return {
    counts: OPTIONS.map((option) => ({ ...option, count: byKey.get(option.key) || 0 })),
    otherResponses: statements.listOther.all(),
    totalResponses: Number(statements.total.get().count)
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const absolute = path.resolve(publicDir, `.${requested}`);
  if (!absolute.startsWith(`${path.resolve(publicDir)}${path.sep}`)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  let file;
  try { file = fs.readFileSync(absolute); } catch {
    res.writeHead(404); return res.end('Not found');
  }
  const ext = path.extname(absolute).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  res.end(file);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 32 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const ipHash = hashIp(getClientIp(req));
      return sendJson(res, 200, { submitted: Boolean(statements.findByIp.get(ipHash)) });
    }

    if (req.method === 'GET' && url.pathname === '/api/results') {
      return sendJson(res, 200, getResults());
    }

    if (req.method === 'POST' && url.pathname === '/api/submit') {
      const ipHash = hashIp(getClientIp(req));
      if (statements.findByIp.get(ipHash)) {
        return sendJson(res, 409, { error: 'This IP address has already submitted a response. Only one submission is allowed per visitor.' });
      }

      const rawBody = await readRequestBody(req);
      let body;
      try { body = JSON.parse(rawBody || '{}'); }
      catch { return sendJson(res, 400, { error: 'Invalid request body.' }); }

      const rawOptions = Array.isArray(body.options) ? body.options : [];
      const options = [...new Set(rawOptions.map(String).filter((key) => VALID_OPTION_KEYS.has(key)))];
      let otherText = typeof body.otherText === 'string' ? body.otherText.trim() : '';

      if (options.length === 0) return sendJson(res, 400, { error: 'Please select at least one option.' });

      if (options.includes('other')) {
        const words = countWords(otherText);
        if (words === 0) return sendJson(res, 400, { error: 'Please enter text for “Other”.' });
        if (words > 100) return sendJson(res, 400, { error: `The “Other” response is limited to 100 words. You entered ${words} words.` });
      } else {
        otherText = '';
      }

      try {
        db.exec('BEGIN IMMEDIATE');
        const result = statements.insertSubmission.run(ipHash, otherText || null, new Date().toISOString());
        for (const key of options) statements.insertOption.run(Number(result.lastInsertRowid), key);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        if (String(error.message).includes('UNIQUE constraint failed: submissions.ip_hash')) {
          return sendJson(res, 409, { error: 'This IP address has already submitted a response. Only one submission is allowed per visitor.' });
        }
        console.error(error);
        return sendJson(res, 500, { error: 'Unable to save your response. Please try again.' });
      }

      return sendJson(res, 201, { message: 'Response submitted successfully.', results: getResults() });
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname);
    res.writeHead(405, { 'Allow': 'GET, POST' });
    res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Dream experience survey running at http://localhost:${PORT}`);
  console.log(`IP hashing salt source: ${process.env.IP_HASH_SALT ? 'environment variable' : 'development fallback'}`);
  console.log(`Trust proxy: ${TRUST_PROXY}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
