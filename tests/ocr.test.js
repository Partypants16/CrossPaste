import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

// The only test that runs the real OCR model (bundled, no download), so it is slower.
const tempDir = await setupTestEnvironment({ OCR_ENABLED: 1 });

const { createApp } = await import('../server/app.js');
const { closeDatabase } = await import('../server/database.js');
const { shutdownOcr } = await import('../server/services/ocr-service.js');

const app = await createApp();

test.after(async () => {
  await shutdownOcr();
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

function textImage(lines) {
  const body = lines
    .map((line, index) => `<text x="30" y="${70 + index * 60}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#000">${line}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${100 + lines.length * 60}"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('text in an uploaded image is read on the server and can be searched', { timeout: 180_000 }, async () => {
  const upload = await request(app)
    .post('/api/images')
    .attach('image', await textImage(['Meeting room 42', 'Password hint: blue whale']), 'whiteboard.png');
  assert.equal(upload.status, 201);
  assert.equal(upload.body.image.textStatus, 'pending');

  const text = await request(app).get(`/api/images/${upload.body.image.id}/text`);
  assert.equal(text.status, 200);
  assert.equal(text.body.status, 'done');
  assert.match(text.body.text, /Meeting room 42/i);
  assert.match(text.body.text, /blue whale/i);

  const listed = (await request(app).get('/api/images')).body.images[0];
  assert.equal(listed.textStatus, 'done');
  assert.equal(listed.hasText, true);

  const found = await request(app).get('/api/search').query({ q: 'whale' });
  assert.equal(found.body.images[0].id, upload.body.image.id);
});
