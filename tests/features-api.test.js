import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';
import { createPngBuffer } from './helpers/fixtures.js';

const tempDir = await setupTestEnvironment({ WRITE_RATE_LIMIT_MAX: 500, UPLOAD_RATE_LIMIT_MAX: 500 });

const { createApp } = await import('../server/app.js');
const { closeDatabase, getDatabase } = await import('../server/database.js');
const { cleanDeviceName } = await import('../server/utilities/device.js');
const { combineSharedText, sharedTextToHtml } = await import('../server/routes/share.js');

const app = await createApp();
const DEVICE_COOKIE = `crosspaste_device=${encodeURIComponent('Test’s Phone')}`;

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

async function currentRevision() {
  return (await request(app).get('/api/state')).body.clipboard.revision;
}

test('cleanDeviceName trims, strips markup characters and caps the length', () => {
  assert.equal(cleanDeviceName('  Laptop  '), 'Laptop');
  assert.equal(cleanDeviceName('<b>Phone</b>'), 'bPhone/b');
  assert.equal(cleanDeviceName('x'.repeat(50)).length, 32);
  assert.equal(cleanDeviceName('   '), null);
  assert.equal(cleanDeviceName(undefined), null);
  assert.equal(cleanDeviceName('%E0%A4%'), '%E0%A4%', 'bad encoding is kept as typed');
});

test('saves record the device name from the cookie', async () => {
  const response = await request(app)
    .put('/api/clipboard')
    .set('Cookie', DEVICE_COOKIE)
    .send({ html: '<p>from my phone</p>', baseRevision: await currentRevision() });
  assert.equal(response.status, 200);
  assert.equal(response.body.clipboard.updatedBy, 'Test’s Phone');

  const listed = await request(app).get('/api/history');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].contentPlain, 'from my phone');
  assert.equal(listed.body.items[0].deviceName, 'Test’s Phone');
});

test('history: pin, restore, search, delete and clear over the API', async () => {
  await request(app).post('/api/clipboard/clear');
  await request(app).post('/api/clipboard/force').send({ html: '<p>Old address: 12 Example St</p>' });
  await request(app).post('/api/clipboard/clear');
  await request(app).post('/api/clipboard/force').send({ html: '<p>Something newer</p>' });

  const listed = (await request(app).get('/api/history')).body.items;
  const old = listed.find((item) => item.contentPlain.startsWith('Old address'));
  assert.ok(old);

  const pinned = await request(app).post(`/api/history/${old.id}/pin`).send({ pinned: true });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.entry.pinned, true);

  const badPin = await request(app).post(`/api/history/${old.id}/pin`).send({ pinned: 'yes' });
  assert.equal(badPin.status, 400);

  const restored = await request(app).post(`/api/history/${old.id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.clipboard.contentPlain, 'Old address: 12 Example St');

  const found = await request(app).get('/api/history').query({ q: 'example st' });
  assert.equal(found.body.total, 1);

  const cleared = await request(app).post('/api/history/clear');
  assert.equal(cleared.status, 200);
  const afterClear = (await request(app).get('/api/history')).body.items;
  assert.deepEqual(afterClear.map((item) => item.id), [old.id], 'only the pinned entry is left');

  assert.equal((await request(app).delete(`/api/history/${old.id}`)).status, 200);
  assert.equal((await request(app).delete(`/api/history/${old.id}`)).status, 404);
  assert.equal((await request(app).post('/api/history/abc/restore')).status, 400);
});

test('images and files can be pinned, and pins are listed', async () => {
  const image = await request(app)
    .post('/api/images')
    .set('Cookie', DEVICE_COOKIE)
    .attach('image', await createPngBuffer(), 'receipt.png');
  assert.equal(image.status, 201);
  assert.equal(image.body.image.uploadedBy, 'Test’s Phone');
  assert.equal(image.body.image.pinned, false);
  assert.equal(image.body.image.textStatus, 'skipped', 'OCR is off in tests');

  const pinnedImage = await request(app).post(`/api/images/${image.body.image.id}/pin`).send({ pinned: true });
  assert.equal(pinnedImage.status, 200);
  assert.equal(pinnedImage.body.image.pinned, true);

  const file = await request(app)
    .post('/api/files')
    .set('Cookie', DEVICE_COOKIE)
    .attach('file', Buffer.from('hello'), 'notes-for-tax.txt');
  assert.equal(file.status, 201);
  assert.equal(file.body.file.uploadedBy, 'Test’s Phone');
  const pinnedFile = await request(app).post(`/api/files/${file.body.file.id}/pin`).send({ pinned: true });
  assert.equal(pinnedFile.body.file.pinned, true);

  assert.equal((await request(app).post('/api/files/9999/pin').send({ pinned: true })).status, 404);

  const text = await request(app).get(`/api/images/${image.body.image.id}/text`);
  assert.deepEqual(text.body, { status: 'disabled', text: '' });
});

test('search covers history, image names, text read from images and file names', async () => {
  const imageId = (await request(app).get('/api/images')).body.images[0].id;
  getDatabase()
    .prepare("UPDATE images SET ocr_status = 'done', ocr_text = ? WHERE id = ?")
    .run('TOTAL $42.10 thank you for shopping', imageId);
  await request(app).post('/api/clipboard/force').send({ html: '<p>Remember the shopping bags</p>' });

  const response = await request(app).get('/api/search').query({ q: 'shopping' });
  assert.equal(response.status, 200);
  assert.equal(response.body.history[0].contentPlain, 'Remember the shopping bags');
  assert.equal(response.body.images[0].id, imageId);
  assert.match(response.body.images[0].textSnippet, /shopping/);

  const byName = await request(app).get('/api/search').query({ q: 'tax' });
  assert.equal(byName.body.files[0].originalFilename, 'notes-for-tax.txt');

  const empty = await request(app).get('/api/search').query({ q: '   ' });
  assert.deepEqual(empty.body, { query: '', history: [], images: [], files: [] });
});

test('combineSharedText keeps each shared piece once', () => {
  assert.equal(combineSharedText({ title: 'Page', text: 'Look https://a.example', url: 'https://a.example' }), 'Look https://a.example');
  assert.equal(combineSharedText({ title: 'Page', url: 'https://b.example' }), 'https://b.example');
  assert.equal(combineSharedText({ title: 'Only a title' }), 'Only a title');
  assert.equal(combineSharedText({}), '');
  assert.equal(
    sharedTextToHtml('Hi <there>\nhttps://c.example/x?a=1&b=2'),
    '<p>Hi &#60;there&#62;<br><a href="https://c.example/x?a=1&#38;b=2">https://c.example/x?a=1&#38;b=2</a></p>'
  );
});

test('the share target saves shared text and files, then redirects to the page', async () => {
  const response = await request(app)
    .post('/share')
    .set('Cookie', DEVICE_COOKIE)
    .field('title', 'A page')
    .field('text', 'Shared from Chrome https://share.example/page')
    .attach('files', await createPngBuffer({ width: 30, height: 30 }), { filename: 'photo.png', contentType: 'image/png' })
    .attach('files', Buffer.from('%PDF-1.4 fake'), { filename: 'doc.pdf', contentType: 'application/pdf' });

  assert.equal(response.status, 303);
  const location = new URL(response.headers.location, 'http://localhost');
  assert.equal(location.pathname, '/');
  assert.equal(location.searchParams.get('text'), '1');
  assert.equal(location.searchParams.get('images'), '1');
  assert.equal(location.searchParams.get('files'), '1');
  assert.equal(location.searchParams.get('failed'), '0');

  const state = (await request(app).get('/api/state')).body;
  assert.equal(state.clipboard.contentPlain, 'Shared from Chrome https://share.example/page');
  assert.equal(state.clipboard.updatedBy, 'Test’s Phone');
  assert.match(state.clipboard.contentHtml, /<a [^>]*href="https:\/\/share\.example\/page"/);
  assert.ok(state.images.some((image) => image.originalFilename === 'photo.png'));
  assert.ok(state.files.some((file) => file.originalFilename === 'doc.pdf'));
});

test('PWA files are served with the right types', async () => {
  const manifest = await request(app).get('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers['content-type'], /application\/manifest\+json/);
  const parsed = JSON.parse(manifest.text);
  assert.equal(parsed.share_target.action, '/share');

  const worker = await request(app).get('/sw.js');
  assert.equal(worker.status, 200);
  assert.match(worker.headers['cache-control'], /no-cache/);

  const qr = await request(app).get('/vendor/qrcode.mjs');
  assert.equal(qr.status, 200);
  assert.match(qr.headers['content-type'], /javascript/);
});
