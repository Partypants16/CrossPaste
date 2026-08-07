import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

const originalEnvironment = { ...process.env };
const tempDir = await setupTestEnvironment({ FILE_COUNT_LIMIT: 3, FILE_SIZE_LIMIT_MB: 1 });

const { openDatabase, closeDatabase, getDatabase } = await import('../server/database.js');
const { config } = await import('../server/config.js');
const {
  storeFile,
  listFiles,
  getFileById,
  getFileRowById,
  deleteFile,
  getRemainingCapacity,
  expireOldFiles,
  FileTooLargeError,
  FileLimitReachedError,
  FileNotFoundError,
} = await import('../server/services/file-service.js');

async function clearStoredFiles() {
  getDatabase().prepare('DELETE FROM files').run();
  const entries = await fs.readdir(config.filesDirectory, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(config.filesDirectory, entry.name), { recursive: true, force: true })
    )
  );
}

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
}

test.before(async () => {
  await openDatabase();
});

test.afterEach(async () => {
  await clearStoredFiles();
});

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
  restoreEnvironment();
});

test('storeFile writes the bytes to disk and persists sanitised metadata', async () => {
  const buffer = Buffer.from('quarterly report contents');
  const file = await storeFile({
    buffer,
    originalFilename: '../quarterly<script>.txt',
    mimeType: 'text/plain',
  });

  assert.deepEqual(file, {
    id: file.id,
    originalFilename: 'quarterlyscript.txt',
    mimeType: 'text/plain',
    sizeBytes: buffer.length,
    sortOrder: 0,
    createdAt: file.createdAt,
  });
  assert.match(file.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  const row = getFileRowById(file.id);
  assert.equal(row.original_filename, 'quarterlyscript.txt');
  assert.equal(row.mime_type, 'text/plain');
  assert.equal(row.size_bytes, buffer.length);
  assert.equal(row.sort_order, 0);
  assert.match(row.stored_filename, /^[0-9a-f-]{36}\.txt$/);
  assert.deepEqual(
    await fs.readFile(path.join(config.filesDirectory, row.stored_filename)),
    buffer
  );
});

test('listFiles returns a deterministic ascending sort order without private disk names', async () => {
  const alpha = await storeFile({ buffer: Buffer.from('a'), originalFilename: 'alpha.txt' });
  const bravo = await storeFile({ buffer: Buffer.from('b'), originalFilename: 'bravo.txt' });
  const charlie = await storeFile({ buffer: Buffer.from('c'), originalFilename: 'charlie.txt' });

  const updateOrder = getDatabase().prepare('UPDATE files SET sort_order = ? WHERE id = ?');
  updateOrder.run(2, alpha.id);
  updateOrder.run(0, bravo.id);
  updateOrder.run(1, charlie.id);

  const firstListing = listFiles();
  const secondListing = listFiles();
  assert.deepEqual(firstListing.map((file) => file.id), [bravo.id, charlie.id, alpha.id]);
  assert.deepEqual(secondListing, firstListing);
  assert.deepEqual(firstListing.map((file) => file.sortOrder), [0, 1, 2]);
  assert.equal(firstListing.every((file) => !('storedFilename' in file)), true);
});

test('getRemainingCapacity reflects stored files and never becomes negative', async () => {
  assert.equal(getRemainingCapacity(), 3);
  await storeFile({ buffer: Buffer.from('one'), originalFilename: 'one.bin' });
  assert.equal(getRemainingCapacity(), 2);
  await storeFile({ buffer: Buffer.from('two'), originalFilename: 'two.bin' });
  assert.equal(getRemainingCapacity(), 1);
  await storeFile({ buffer: Buffer.from('three'), originalFilename: 'three.bin' });
  assert.equal(getRemainingCapacity(), 0);
});

test('storeFile rejects content above the configured size limit without side effects', async () => {
  const oversized = Buffer.alloc(config.fileSizeLimitBytes + 1);

  await assert.rejects(
    () => storeFile({ buffer: oversized, originalFilename: 'oversized.bin' }),
    (error) => error instanceof FileTooLargeError && error.sizeBytes === oversized.length
  );

  assert.deepEqual(listFiles(), []);
  assert.deepEqual(await fs.readdir(config.filesDirectory), []);
});

test('storeFile rejects a file above the configured count limit without side effects', async () => {
  await storeFile({ buffer: Buffer.from('one'), originalFilename: 'one.bin' });
  await storeFile({ buffer: Buffer.from('two'), originalFilename: 'two.bin' });
  await storeFile({ buffer: Buffer.from('three'), originalFilename: 'three.bin' });
  const diskEntriesBefore = await fs.readdir(config.filesDirectory);

  await assert.rejects(
    () => storeFile({ buffer: Buffer.from('four'), originalFilename: 'four.bin' }),
    FileLimitReachedError
  );

  assert.equal(listFiles().length, config.fileCountLimit);
  assert.deepEqual(await fs.readdir(config.filesDirectory), diskEntriesBefore);
});

test('file lookup returns public and database shapes and reports missing IDs', async () => {
  const stored = await storeFile({
    buffer: Buffer.from('lookup'),
    originalFilename: 'lookup.dat',
    mimeType: 'application/x-lookup',
  });

  assert.deepEqual(getFileById(stored.id), stored);
  const row = getFileRowById(stored.id);
  assert.equal(row.id, stored.id);
  assert.equal(row.original_filename, stored.originalFilename);
  assert.equal(typeof row.stored_filename, 'string');

  assert.throws(() => getFileById(999999), FileNotFoundError);
  assert.throws(() => getFileRowById(999999), FileNotFoundError);
  await assert.rejects(() => deleteFile(999999), FileNotFoundError);
});

test('deleteFile removes both disk content and its database record', async () => {
  const stored = await storeFile({ buffer: Buffer.from('delete me'), originalFilename: 'delete.txt' });
  const row = getFileRowById(stored.id);
  const diskPath = path.join(config.filesDirectory, row.stored_filename);
  await fs.access(diskPath);

  assert.deepEqual(await deleteFile(stored.id), { id: stored.id });

  assert.throws(() => getFileById(stored.id), FileNotFoundError);
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM files WHERE id = ?').get(stored.id).total, 0);
  await assert.rejects(fs.access(diskPath), { code: 'ENOENT' });
});

test('expireOldFiles removes only expired disk content and database records', async () => {
  const expired = await storeFile({ buffer: Buffer.from('old'), originalFilename: 'old.txt' });
  const current = await storeFile({ buffer: Buffer.from('new'), originalFilename: 'new.txt' });
  const expiredRow = getFileRowById(expired.id);
  const currentRow = getFileRowById(current.id);
  const setCreatedAt = getDatabase().prepare('UPDATE files SET created_at = ? WHERE id = ?');
  setCreatedAt.run('2000-01-01T00:00:00.000Z', expired.id);
  setCreatedAt.run('2030-01-01T00:00:00.000Z', current.id);

  assert.equal(await expireOldFiles('2020-01-01T00:00:00.000Z'), 1);

  assert.throws(() => getFileById(expired.id), FileNotFoundError);
  assert.equal(getFileById(current.id).id, current.id);
  await assert.rejects(
    fs.access(path.join(config.filesDirectory, expiredRow.stored_filename)),
    { code: 'ENOENT' }
  );
  await fs.access(path.join(config.filesDirectory, currentRow.stored_filename));
  assert.equal(await expireOldFiles('1990-01-01T00:00:00.000Z'), 0);
});
