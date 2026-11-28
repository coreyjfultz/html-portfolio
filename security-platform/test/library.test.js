// Training library, support contacts and the optional help assistant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secureops-lib-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { openDb } = await import('../server/db.js');
const { createServer } = await import('../server/server.js');
const { rankLibrary } = await import('../server/library.js');

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie, 'X-Requested-With': 'SecureOps', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    let data = null;
    try { data = JSON.parse(buf.toString()); } catch { /* file */ }
    return { status: res.status, data, buf, res };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const owner = client(), tech = client(), sales = client();
const ids = {};
const PDF = Buffer.from('%PDF-1.4\n% IQ4 installer manual\n').toString('base64');

test('setup', async () => {
  await owner.post('/api/auth/setup', { name: 'Olivia Owner', email: 'owner@example.com', password: 'password123', company_name: 'Lib Co' });
  for (const [c, name, email, role] of [[tech, 'Tess Tech', 'tess@example.com', 'technician'], [sales, 'Sal Sales', 'sal@example.com', 'sales']]) {
    ids[name] = (await owner.post('/api/users', { name, email, password: 'password123', role })).data.id;
    await c.post('/api/auth/login', { email, password: 'password123' });
  }
});

test('library: managers add items, everyone reads, techs cannot edit', async () => {
  const a = await owner.post('/api/r/training_resources', { title: 'Qolsys IQ4 installer guide', kind: 'manual', category: 'alarm panels', manufacturer: 'Qolsys', model: 'IQ4 NS, IQ4 Hub', tags: 'zone programming, installer code, reset', body: 'To enter installer mode: Settings > Advanced > Installer/Dealer code.' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  ids.iq4 = a.data.id;
  ids.vid = (await owner.post('/api/r/training_resources', { title: 'Terminating Cat6 RJ45', kind: 'video', category: 'networking', url: 'https://www.youtube.com/watch?v=abc123XYZ_0', tags: 'crimp, T568B' })).data.id;
  ids.policy = (await owner.post('/api/r/training_resources', { title: 'Ladder safety', kind: 'article', category: 'safety', body: 'Three points of contact. Never stand on the top two rungs.' })).data.id;
  const list = await tech.get('/api/r/training_resources');
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 3);
  assert.equal((await tech.post('/api/r/training_resources', { title: 'Nope' })).status, 403);
  const found = await tech.get('/api/r/training_resources?q=installer');
  assert.ok(found.data.some(r => r.id === ids.iq4));
});

test('library files: upload, read, replace and remove', async () => {
  assert.equal((await tech.post(`/api/library/${ids.iq4}/file`, { data: PDF, file_name: 'iq4.pdf' })).status, 403);
  assert.equal((await owner.post(`/api/library/${ids.iq4}/file`, { data: Buffer.from('MZ not a pdf').toString('base64'), file_name: 'x.exe' })).status, 400);
  const up = await owner.post(`/api/library/${ids.iq4}/file`, { data: PDF, file_name: 'iq4.pdf' });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const f = await tech.get(`/api/library/${ids.iq4}/file`);
  assert.equal(f.status, 200);
  assert.equal(f.res.headers.get('content-type'), 'application/pdf');
  assert.match(f.buf.toString(), /IQ4 installer manual/);
  const row = db.prepare('SELECT file_key, file_name FROM training_resources WHERE id = ?').get(ids.iq4);
  assert.equal(row.file_name, 'iq4.pdf');
  assert.ok(fs.existsSync(path.join(tmp, 'library', row.file_key)));
  // Replacing removes the old file
  await owner.post(`/api/library/${ids.iq4}/file`, { data: PDF, file_name: 'iq4-v2.pdf' });
  assert.ok(!fs.existsSync(path.join(tmp, 'library', row.file_key)));
  // file_key can't be set through the normal form
  await owner.put(`/api/r/training_resources/${ids.iq4}`, { title: 'Qolsys IQ4 installer guide', file_key: '../../etc/passwd' });
  assert.notEqual(db.prepare('SELECT file_key FROM training_resources WHERE id = ?').get(ids.iq4).file_key, '../../etc/passwd');
  // Deleting the item removes its file
  const tmpItem = (await owner.post('/api/r/training_resources', { title: 'Old handout', kind: 'manual' })).data.id;
  await owner.post(`/api/library/${tmpItem}/file`, { data: PDF, file_name: 'old.pdf' });
  const key = db.prepare('SELECT file_key FROM training_resources WHERE id = ?').get(tmpItem).file_key;
  assert.equal((await owner.del(`/api/r/training_resources/${tmpItem}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(tmp, 'library', key)));
});

test('support contacts: staff add, techs read', async () => {
  const c = await sales.post('/api/r/vendor_contacts', { company: 'Qolsys', department: 'tech support', products: 'IQ panels', phone: '855-421-2222', hours: 'M–F 8–8 ET', account_number: 'D-4471' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal((await tech.get('/api/r/vendor_contacts')).data.length, 1);
  assert.equal((await tech.post('/api/r/vendor_contacts', { company: 'X' })).status, 403);
});

test('ranking finds the right library items', () => {
  const r = rankLibrary(db, 'how do I get into installer mode on a qolsys IQ4?');
  assert.equal(r[0].id, ids.iq4);
  assert.ok(!r.some(x => x.id === ids.policy));
  assert.deepEqual(rankLibrary(db, 'the and of'), []);
});

test('assistant: off by default, needs a key, then answers with library context', async () => {
  assert.equal((await tech.get('/api/assistant/status')).data.enabled, false);
  assert.equal((await tech.post('/api/assistant/ask', { question: 'installer code qolsys?' })).status, 404);
  await owner.put('/api/settings', { assistant_enabled: '1', assistant_daily_limit: '2' });
  const noKey = await tech.post('/api/assistant/ask', { question: 'installer code qolsys?' });
  assert.equal(noKey.status, 503);
  assert.match(noKey.data.error, /API key/);

  let seen;
  const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      seen = { url: req.url, headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Go to Settings > Advanced and enter the dealer code [Qolsys IQ4 installer guide].' }], usage: { input_tokens: 900, output_tokens: 40 } }));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  try {
    const a = await tech.post('/api/assistant/ask', { question: 'How do I get into installer mode on a Qolsys IQ4?' });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.match(a.data.answer, /dealer code/);
    assert.equal(a.data.sources[0].id, ids.iq4);
    assert.equal(seen.url.split('?')[0], '/v1/messages');
    assert.equal(seen.body.model, 'claude-opus-5-5');
    assert.equal(seen.body.fallbacks, 'default');
    assert.match(String(seen.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.output_config.effort, 'medium');
    assert.equal(seen.body.thinking, undefined);
    assert.equal(seen.body.system[0].cache_control.type, 'ephemeral');
    const content = seen.body.messages[0].content;
    assert.equal(content[0].type, 'document');
    assert.equal(content[0].source.media_type, 'application/pdf');
    const text = content.at(-1).text;
    assert.match(text, /Qolsys IQ4 installer guide/);
    assert.match(text, /855-421-2222/); // support contacts go along
    assert.doesNotMatch(text, /Ladder safety/);
    assert.match(text, /Question: How do I get into installer mode/);
    // Feedback and log
    assert.equal((await tech.post(`/api/assistant/${a.data.id}/feedback`, { helpful: true })).status, 200);
    assert.equal((await sales.post(`/api/assistant/${a.data.id}/feedback`, { helpful: false })).status, 404);
    const log = await owner.get('/api/assistant/log');
    assert.equal(log.data[0].helpful, 1);
    assert.equal((await tech.get('/api/assistant/log')).status, 403);
    // Follow-up uses the earlier exchange
    await tech.post('/api/assistant/ask', { question: 'And to reset it?', history: [{ q: 'installer mode qolsys', a: 'Go to Settings' }] });
    assert.match(seen.body.messages[0].content.at(-1).text, /Earlier in this conversation/);
    // Daily limit
    const over = await tech.post('/api/assistant/ask', { question: 'One more about qolsys?' });
    assert.equal(over.status, 429);
    assert.equal((await sales.post('/api/assistant/ask', { question: 'Cat6 crimp order?' })).status, 200);
    assert.equal(seen.body.messages[0].content[0].type, 'text'); // no PDF for the video question
  } finally {
    fake.close();
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_API_KEY;
  }
});
