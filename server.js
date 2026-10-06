// Blood Donor Registry - zero-dependency Node server.
// Data is stored in a JSON file (DATA_DIR/donors.json).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'donors.json');
const PASSWORD = process.env.APP_PASSWORD || '';          // set this when hosting!
const TOKEN = PASSWORD
  ? crypto.createHash('sha256').update('donor-registry:' + PASSWORD).digest('hex')
  : '';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

fs.mkdirSync(DATA_DIR, { recursive: true });
let donors = [];
try { donors = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { donors = []; }

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(donors, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

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
    mobile: String(b.mobile || '').trim(),
    email: String(b.email || '').trim(),
    bloodGroup: String(b.bloodGroup || '').trim().toUpperCase(),
    lastDonated: String(b.lastDonated || '').trim() || null,
  };
  if (!d.name) return { error: 'Name is required.' };
  if (!(d.age >= 16 && d.age <= 100)) return { error: 'Enter a valid age.' };
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
      if (p === '/api/config') return send(res, 200, { passwordRequired: !!PASSWORD });
      if (PASSWORD && req.headers['x-auth'] !== TOKEN) return send(res, 401, { error: 'Login required.' });

      if (p === '/api/donors' && req.method === 'GET') return send(res, 200, donors);

      if (p === '/api/donors' && req.method === 'POST') {
        const { value, error } = validate(await readBody(req));
        if (error) return send(res, 400, { error });
        const donor = { id: crypto.randomUUID(), ...value, createdAt: new Date().toISOString() };
        donors.push(donor); save();
        return send(res, 201, donor);
      }

      const m = p.match(/^\/api\/donors\/([\w-]+)$/);
      if (m) {
        const i = donors.findIndex(d => d.id === m[1]);
        if (i < 0) return send(res, 404, { error: 'Donor not found.' });
        if (req.method === 'PUT') {
          const { value, error } = validate(await readBody(req));
          if (error) return send(res, 400, { error });
          donors[i] = { ...donors[i], ...value }; save();
          return send(res, 200, donors[i]);
        }
        if (req.method === 'DELETE') { donors.splice(i, 1); save(); return send(res, 200, { ok: true }); }
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
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Donor registry running on port ${PORT}${PASSWORD ? ' (password protected)' : ' (NO PASSWORD SET)'}`));
