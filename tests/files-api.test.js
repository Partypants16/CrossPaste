import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

const ONE_MIB = 1024 * 1024;
const tempDir = await setupTestEnvironment({ FILE_COUNT_LIMIT: 2, FILE_SIZE_LIMIT_MB: 1 });
const { createApp } = await import('../server/app.js');
const { closeDatabase, getDatabase } = await import('../server/database.js');
const { config } = await import('../server/config.js');
const { registerClient, removeClient } = await import('../server/services/realtime-service.js');

const app = await createApp();

async function upload(name, contents = Buffer.from('shared file contents')) {
  return request(app).post('/api/files').attach('file', contents, name);
}

async function readBinary(response, callback) {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function clearFileStorage() {
  getDatabase().prepare('DELETE FROM files').run();
  await fs.rm(config.filesDirectory, { recursive: true, force: true });
  await fs.mkdir(config.filesDirectory, { recursive: true });
}

function captureRealtimeEvents() {
  const writes = [];
  const client = { write: (payload) => writes.push(payload) };
  registerClient(client);

  return {
    events() {
      return writes.map((payload) => {
        const event = payload.match(/^event: (.+)$/m)?.[1];
        const data = JSON.parse(payload.match(/^data: (.+)$/m)?.[1] ?? '{}');
        return { event, data };
      });
    },
    close() {
      removeClient(client);
    },
  };
}

test.beforeEach(clearFileStorage);

test.after(async () => {
  await clearFileStorage();
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

test('GET /api/files starts empty and POST /api/files returns public metadata', async () => {
  const empty = await request(app).get('/api/files');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { files: [] });

  const contents = Buffer.from('first document');
  const uploaded = await upload('../unsafe<script>.txt', contents);

  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.file.originalFilename, 'unsafescript.txt');
  assert.equal(uploaded.body.file.mimeType, 'text/plain');
  assert.equal(uploaded.body.file.sizeBytes, contents.length);
  assert.equal(uploaded.body.file.sortOrder, 0);
  assert.equal(typeof uploaded.body.file.id, 'number');
  assert.ok(!Number.isNaN(Date.parse(uploaded.body.file.createdAt)));
  assert.equal(uploaded.body.file.storedFilename, undefined);

  const second = await upload('second.bin', Buffer.from([0, 1, 2]));
  assert.equal(second.status, 201);
  assert.equal(second.body.file.sortOrder, 1);

  const listed = await request(app).get('/api/files');
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.files.map(({ id, originalFilename, sizeBytes, sortOrder }) => ({
      id,
      originalFilename,
      sizeBytes,
      sortOrder,
    })),
    [
      {
        id: uploaded.body.file.id,
        originalFilename: 'unsafescript.txt',
        sizeBytes: contents.length,
        sortOrder: 0,
      },
      {
        id: second.body.file.id,
        originalFilename: 'second.bin',
        sizeBytes: 3,
        sortOrder: 1,
      },
    ]
  );
});

test('GET /api/files/:id returns metadata without exposing the stored filename', async () => {
  const uploaded = await upload('notes.txt', Buffer.from('hello'));
  const response = await request(app).get(`/api/files/${uploaded.body.file.id}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.file, uploaded.body.file);
  assert.equal(response.body.file.storedFilename, undefined);
});

test('GET /api/files/:id/download returns the original bytes as an attachment', async () => {
  const contents = Buffer.from([0, 1, 2, 3, 254, 255]);
  const uploaded = await upload('report final.bin', contents);

  const downloaded = await request(app)
    .get(`/api/files/${uploaded.body.file.id}/download`)
    .buffer(true)
    .parse(readBinary);

  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers['content-disposition'], /^attachment;/i);
  assert.match(downloaded.headers['content-disposition'], /report final\.bin/i);
  assert.equal(downloaded.headers['content-type'], 'application/octet-stream');
  assert.equal(Number(downloaded.headers['content-length']), contents.length);
  assert.equal(downloaded.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.deepEqual(downloaded.body, contents);
});

test('DELETE /api/files/:id removes database metadata and the stored bytes', async () => {
  const uploaded = await upload('delete-me.txt', Buffer.from('temporary'));
  const id = uploaded.body.file.id;
  const row = getDatabase().prepare('SELECT stored_filename FROM files WHERE id = ?').get(id);
  const storedPath = path.join(config.filesDirectory, row.stored_filename);
  await fs.access(storedPath);

  const removed = await request(app).delete(`/api/files/${id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true, id });

  assert.deepEqual((await request(app).get('/api/files')).body.files, []);
  assert.equal((await request(app).get(`/api/files/${id}`)).status, 404);
  await assert.rejects(fs.access(storedPath), { code: 'ENOENT' });
});

test('file routes return FILE_NOT_FOUND for unknown ids without changing state', async () => {
  const uploaded = await upload('still-here.txt', Buffer.from('preserve me'));
  const id = uploaded.body.file.id;

  for (const response of [
    await request(app).get('/api/files/999999'),
    await request(app).get('/api/files/999999/download'),
    await request(app).delete('/api/files/999999'),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'FILE_NOT_FOUND');
  }

  const listed = await request(app).get('/api/files');
  assert.deepEqual(listed.body.files.map((file) => file.id), [id]);
});

test('POST /api/files enforces count and size limits without persisting rejected files', async () => {
  assert.equal((await upload('one.bin', Buffer.from([1]))).status, 201);
  assert.equal((await upload('two.bin', Buffer.from([2]))).status, 201);

  const countLimited = await upload('three.bin', Buffer.from([3]));
  assert.equal(countLimited.status, 409);
  assert.equal(countLimited.body.error.code, 'FILE_LIMIT_REACHED');
  assert.equal((await request(app).get('/api/files')).body.files.length, 2);
  assert.equal((await fs.readdir(config.filesDirectory)).length, 2);

  await clearFileStorage();
  const tooLarge = await upload('huge.bin', Buffer.alloc(ONE_MIB + 1));
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, 'FILE_TOO_LARGE');
  assert.deepEqual((await request(app).get('/api/files')).body.files, []);
  assert.deepEqual(await fs.readdir(config.filesDirectory), []);
});

test('POST requires the multipart file field', async () => {
  const response = await request(app).post('/api/files').field('description', 'missing file');
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'MISSING_FILE');
  assert.deepEqual((await request(app).get('/api/files')).body.files, []);
});

test('successful uploads and deletes broadcast files-changed, while failures do not', async () => {
  const realtime = captureRealtimeEvents();
  try {
    const uploaded = await upload('event.txt', Buffer.from('event payload'));
    assert.equal(uploaded.status, 201);
    const id = uploaded.body.file.id;
    assert.deepEqual(realtime.events(), [
      { event: 'files-changed', data: { reason: 'uploaded', fileId: id } },
    ]);

    const missingDelete = await request(app).delete('/api/files/999999');
    assert.equal(missingDelete.status, 404);
    assert.equal(realtime.events().length, 1);

    const oversized = await upload('oversized.bin', Buffer.alloc(ONE_MIB + 1));
    assert.equal(oversized.status, 413);
    assert.equal(realtime.events().length, 1);

    const removed = await request(app).delete(`/api/files/${id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(realtime.events(), [
      { event: 'files-changed', data: { reason: 'uploaded', fileId: id } },
      { event: 'files-changed', data: { reason: 'deleted', fileId: id } },
    ]);
  } finally {
    realtime.close();
  }
});
