'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDocument, ExtractError } = require('../server/lib/extract');
const { createApp } = require('../server/index');

test('extract: pasted text is normalized; empty and too-short input rejected with clear codes', async () => {
  const ok = await extractDocument({ text: 'Hello world.\r\n\r\n\r\nThis is a sufficiently long pasted document for analysis.' });
  assert.equal(ok.source, 'text');
  assert.ok(!ok.text.includes('\r'));
  await assert.rejects(() => extractDocument({ text: '   ' }), (e) => e instanceof ExtractError && e.code === 'NO_INPUT');
  await assert.rejects(() => extractDocument({ text: 'too short' }), (e) => e.code === 'TOO_SHORT');
});

test('extract: unsupported, legacy and corrupted files are reported clearly', async () => {
  await assert.rejects(() => extractDocument({ file: { originalname: 'a.exe', buffer: Buffer.from('MZ\x90\x00') } }), (e) => e.code === 'UNSUPPORTED_TYPE' && /Unsupported file type/.test(e.message));
  await assert.rejects(() => extractDocument({ file: { originalname: 'a.doc', buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) } }), (e) => e.code === 'UNSUPPORTED_TYPE' && /\.doc/.test(e.message));
  await assert.rejects(() => extractDocument({ file: { originalname: 'bad.pdf', buffer: Buffer.from('%PDF-1.4 this is not a real pdf') } }), (e) => e.code === 'PDF_UNREADABLE' || e.code === 'PDF_NO_TEXT');
  await assert.rejects(() => extractDocument({ file: { originalname: 'bad.docx', buffer: Buffer.from('PK\x03\x04garbage') } }), (e) => e.code === 'DOCX_UNREADABLE');
});

test('API: analyze returns formatting issues, claims and references; errors are JSON', async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const text = require('fs').readFileSync(__dirname + '/fixtures/sample-apa.txt', 'utf8');
    const fd = new FormData();
    fd.append('style', 'apa');
    fd.append('text', text);
    const r = await fetch(base + '/api/analyze', { method: 'POST', body: fd });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.issues.some((i) => i.type === 'doi_url'));
    assert.equal(j.claims.length, 6);
    assert.equal(j.references.length, 4);
    assert.ok(!('_cites' in j));

    const bad = new FormData();
    bad.append('style', 'apa');
    bad.append('file', new Blob([Buffer.from('MZ binary')]), 'malware.exe');
    const rb = await fetch(base + '/api/analyze', { method: 'POST', body: bad });
    assert.equal(rb.status, 422);
    assert.equal((await rb.json()).error.code, 'UNSUPPORTED_TYPE');

    const rs = await fetch(base + '/api/analyze', { method: 'POST', body: (() => { const f = new FormData(); f.append('style', 'harvard'); f.append('text', text); return f; })() });
    assert.equal(rs.status, 400);

    const rv = await fetch(base + '/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim: 'A claim about nothing in particular.', citation: '(X, 2000)', reference: null }) });
    assert.equal(rv.status, 200);
    assert.equal((await rv.json()).verdict, 'Unverifiable');

    const rc = await (await fetch(base + '/api/config')).json();
    assert.ok(Array.isArray(rc.styles));
    assert.ok(!JSON.stringify(rc).includes('KEY'));
  } finally {
    server.close();
  }
});
