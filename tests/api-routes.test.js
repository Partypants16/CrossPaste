import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';
import { createPngBuffer } from './helpers/fixtures.js';

const tempDir = await setupTestEnvironment({ WRITE_RATE_LIMIT_MAX: 3, WRITE_RATE_LIMIT_WINDOW_MS: 60000 });

const { createApp } = await import('../server/app.js');
const { closeDatabase } = await import('../server/database.js');

const app = await createApp();

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

test('GET /api/health reports ok status without leaking internal details', async () => {
  const response = await request(app).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.databaseReachable, true);
  assert.equal(response.body.dataDirectoryWritable, true);
  assert.ok(response.body.serverTime);
  assert.equal(response.body.environmentVariables, undefined);
});

test('GET /api/state returns the clipboard, images, and limits', async () => {
  const response = await request(app).get('/api/state');
  assert.equal(response.status, 200);
  assert.equal(response.body.clipboard.revision, 0);
  assert.deepEqual(response.body.images, []);
  assert.equal(typeof response.body.limits.textCharacterLimit, 'number');
});

test('PUT /api/clipboard saves content and returns the new revision', async () => {
  const response = await request(app)
    .put('/api/clipboard')
    .send({ html: '<p>hello there</p>', baseRevision: 0 });

  assert.equal(response.status, 200);
  assert.equal(response.body.clipboard.revision, 1);
  assert.equal(response.body.clipboard.contentPlain, 'hello there');
});

test('PUT /api/clipboard with a stale baseRevision returns 409 with the current server state', async () => {
  const response = await request(app)
    .put('/api/clipboard')
    .send({ html: '<p>stale</p>', baseRevision: 0 });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'REVISION_CONFLICT');
  assert.equal(response.body.error.current.revision, 1);
});

test('PUT /api/clipboard rejects unexpected fields', async () => {
  const response = await request(app)
    .put('/api/clipboard')
    .send({ html: '<p>x</p>', baseRevision: 1, extraField: true });

  assert.equal(response.status, 400);
});

test('POST /api/images without a file returns 400', async () => {
  const response = await request(app).post('/api/images');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'MISSING_FILE');
});

test('POST /api/images accepts a PNG upload and GET /api/images lists it', async () => {
  const buffer = await createPngBuffer();
  const uploadResponse = await request(app)
    .post('/api/images')
    .attach('image', buffer, 'test.png');

  assert.equal(uploadResponse.status, 201);
  assert.equal(uploadResponse.body.image.mimeType, 'image/png');

  const listResponse = await request(app).get('/api/images');
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.body.images.length, 1);
});

test('GET /api/images/:id/thumbnail returns image bytes for a stored image', async () => {
  const listResponse = await request(app).get('/api/images');
  const imageId = listResponse.body.images[0].id;

  const thumbnailResponse = await request(app).get(`/api/images/${imageId}/thumbnail`);
  assert.equal(thumbnailResponse.status, 200);
  assert.ok(thumbnailResponse.body.length > 0);
});

test('GET /api/images/:id for a missing id returns 404', async () => {
  const response = await request(app).get('/api/images/999999');
  assert.equal(response.status, 404);
});

test('DELETE /api/images/:id removes the image', async () => {
  const listResponse = await request(app).get('/api/images');
  const imageId = listResponse.body.images[0].id;

  const deleteResponse = await request(app).delete(`/api/images/${imageId}`);
  assert.equal(deleteResponse.status, 200);

  const afterResponse = await request(app).get('/api/images');
  assert.equal(afterResponse.body.images.length, 0);
});

test('write rate limiting rejects requests beyond the configured maximum', async () => {
  let lastStatus = 200;
  for (let i = 0; i < 5; i += 1) {
    const response = await request(app).post('/api/clipboard/clear');
    lastStatus = response.status;
    if (response.status === 429) break;
  }
  assert.equal(lastStatus, 429);
});
