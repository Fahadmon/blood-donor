// Blood Donor Registry - zero-dependency Node server.
// Storage: Supabase (free Postgres) when SUPABASE_URL + SUPABASE_KEY are set,
// otherwise a local JSON file (good for running on your own computer).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';          // set this when hosting!
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const TOKEN = PASSWORD
  ? crypto.createHash('sha256').update('donor-registry:' + PASSWORD).digest('hex')
  : '';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* ---------------- storage ---------------- */
function fileStore() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, 'donors.json');
  fs.mkdirSync(dir, { recursive: true });
  let donors = [];
  try { donors = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { donors = []; }
  const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(donors, null, 2)); fs.renameSync(file + '.tmp', file); };
  return {
    name: 'local file',
    async list() { return donors; },
    async create(v) { const d = { id: crypto.randomUUID(), ...v, createdAt: new Date().toISOString() }; donors.push(d); save(); return d; },
    async update(id, v) { const i = donors.findIndex(d => d.id === id); if (i < 0) return null; donors[i] = { ...donors[i], ...v }; save(); return donors[i]; },
    async remove(id) { const i = donors.findIndex(d => d.id === id); if (i < 0) return false; donors.splice(i, 1); save(); return true; },
  };
}

function supabaseStore() {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SUPABASE_KEY; // legacy JWT-style keys
  const toRow = v => ({ name: v.name, age: v.age, location: v.location, mobile: v.mobile, email: v.email, blood_group: v.bloodGroup, last_donated: v.lastDonated });
  const fromRow = r => ({ id: r.id, name: r.name, age: r.age, location: r.location, mobile: r.mobile, email: r.email, bloodGroup: r.blood_group, lastDonated: r.last_donated, createdAt: r.created_at });

  async function call(method, query, body, prefer) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/donors${query}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('Supabase error', res.status, text);
      const e = new Error('Database error. Please try again.'); e.code = 502; throw e;
    }
    return text ? JSON.parse(text) : [];
  }
  return {
    name: 'Supabase',
    async list() {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const rows = await call('GET', `?select=*&order=created_at.asc&limit=1000&offset=${offset}`);
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out.map(fromRow);
    },
    async create(v) { return fromRow((await call('POST', '', toRow(v), 'return=representation'))[0]); },
    async update(id, v) { const r = await call('PATCH', `?id=eq.${encodeURIComponent(id)}`, toRow(v), 'return=representation'); return r[0] ? fromRow(r[0]) : null; },
    async remove(id) { const r = await call('DELETE', `?id=eq.${encodeURIComponent(id)}`, null, 'return=representation'); return r.length > 0; },
  };
}

const store = SUPABASE_URL && SUPABASE_KEY ? supabaseStore() : fileStore();

/* ---------------- helpers ---------------- */
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 100000) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}

function validate(b) {
  const d = {
    name: String(b.name || '').trim(),
    age: parseInt(b.age, 10),
    location: String(b.location || '').trim(),
    mobile: String(b.mobile || '').trim(),
    email: String(b.email || '').trim(),
    bloodGroup: String(b.bloodGroup || '').trim().toUpperCase(),
    lastDonated: String(b.lastDonated || '').trim() || null,
  };
  if (!d.name) return { error: 'Name is required.' };
  if (!(d.age >= 16 && d.age <= 100)) return { error: 'Enter a valid age.' };
  if (!d.location) return { error: 'Location / place is required.' };
  if (d.location.length > 100) return { error: 'Location is too long (max 100 characters).' };
  if (!/^\+?[0-9 \-]{7,15}$/.test(d.mobile)) return { error: 'Enter a valid mobile number (7-15 digits).' };
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return { error: 'Enter a valid email address.' };
  if (!GROUPS.includes(d.bloodGroup)) return { error: 'Choose a blood group.' };
  if (d.lastDonated) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.lastDonated) || isNaN(Date.parse(d.lastDonated))) return { error: 'Enter a valid last donated date.' };
    if (d.lastDonated > new Date().toISOString().slice(0, 10)) return { error: 'Last donated date cannot be in the future.' };
  }
  return { value: d };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      if (p === '/api/login' && req.method === 'POST') {
        const b = await readBody(req);
        if (!PASSWORD || b.password === PASSWORD) return send(res, 200, { token: TOKEN });
        return send(res, 401, { error: 'Wrong password.' });
      }
      if (p === '/api/config') return send(res, 200, { passwordRequired: !!PASSWORD, storage: store.name });
      if (PASSWORD && req.headers['x-auth'] !== TOKEN) return send(res, 401, { error: 'Login required.' });

      if (p === '/api/donors' && req.method === 'GET') return send(res, 200, await store.list());

      if (p === '/api/donors' && req.method === 'POST') {
        const { value, error } = validate(await readBody(req));
        if (error) return send(res, 400, { error });
        return send(res, 201, await store.create(value));
      }

      const m = p.match(/^\/api\/donors\/([\w-]+)$/);
      if (m) {
        if (req.method === 'PUT') {
          const { value, error } = validate(await readBody(req));
          if (error) return send(res, 400, { error });
          const d = await store.update(m[1], value);
          return d ? send(res, 200, d) : send(res, 404, { error: 'Donor not found.' });
        }
        if (req.method === 'DELETE') {
          return (await store.remove(m[1])) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Donor not found.' });
        }
      }
      return send(res, 404, { error: 'Not found.' });
    }

    // static files
    const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    send(res, e.code || 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Donor registry running on port ${PORT} | storage: ${store.name} | ${PASSWORD ? 'password protected' : 'NO PASSWORD SET'}`));
