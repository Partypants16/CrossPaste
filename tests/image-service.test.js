import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';
import { createPngBuffer, createJpegBuffer, createGifBuffer } from './helpers/fixtures.js';

const tempDir = await setupTestEnvironment({ IMAGE_COUNT_LIMIT: 2, IMAGE_SIZE_LIMIT_MB: 1 });

const { openDatabase, closeDatabase } = await import('../server/database.js');
const { config } = await import('../server/config.js');
const {
  storeImage,
  listImages,
  deleteImage,
  ImageLimitReachedError,
  ImageTooLargeError,
  UnsupportedImageTypeError,
} = await import('../server/services/image-service.js');

test.before(async () => {
  await openDatabase();
});

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

test('storeImage accepts a PNG and writes it with a random filename, not the original name', async () => {
  const buffer = await createPngBuffer();
  const image = await storeImage({ buffer, originalFilename: 'my photo.png' });

  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.originalFilename, 'my photo.png');
  assert.notEqual(image.storedFilename, 'my photo.png');
  assert.match(image.storedFilename, /^[0-9a-f-]{36}\.png$/);

  const fileExists = await fs
    .access(path.join(config.uploadDirectory, image.storedFilename))
    .then(() => true)
    .catch(() => false);
  assert.equal(fileExists, true);

  await deleteImage(image.id);
});

test('storeImage accepts JPEG and GIF, and preserves the GIF byte-for-byte', async () => {
  const jpegBuffer = await createJpegBuffer();
  const jpegImage = await storeImage({ buffer: jpegBuffer, originalFilename: 'photo.jpg' });
  assert.equal(jpegImage.mimeType, 'image/jpeg');

  const gifBuffer = await createGifBuffer();
  const gifImage = await storeImage({ buffer: gifBuffer, originalFilename: 'anim.gif' });
  assert.equal(gifImage.mimeType, 'image/gif');
  const storedGifBytes = await fs.readFile(path.join(config.uploadDirectory, gifImage.storedFilename));
  assert.deepEqual(storedGifBytes, gifBuffer);

  await deleteImage(jpegImage.id);
  await deleteImage(gifImage.id);
});

test('storeImage rejects a file whose magic bytes are not a supported image type', async () => {
  const buffer = Buffer.from('not actually an image');
  await assert.rejects(() => storeImage({ buffer, originalFilename: 'fake.png' }), UnsupportedImageTypeError);
});

test('storeImage rejects a buffer larger than the configured size limit', async () => {
  const oversized = Buffer.alloc(2 * 1024 * 1024, 0);
  await assert.rejects(() => storeImage({ buffer: oversized, originalFilename: 'big.png' }), ImageTooLargeError);
});

test('storeImage enforces the global image count limit on the server', async () => {
  const first = await storeImage({ buffer: await createPngBuffer(), originalFilename: 'a.png' });
  const second = await storeImage({ buffer: await createPngBuffer(), originalFilename: 'b.png' });

  const thirdBuffer = await createPngBuffer();
  await assert.rejects(
    () => storeImage({ buffer: thirdBuffer, originalFilename: 'c.png' }),
    ImageLimitReachedError
  );

  assert.equal(listImages().length, 2);

  await deleteImage(first.id);
  await deleteImage(second.id);
});

test('deleteImage removes both the database row and the file from disk', async () => {
  const image = await storeImage({ buffer: await createPngBuffer(), originalFilename: 'delete-me.png' });
  const filePath = path.join(config.uploadDirectory, image.storedFilename);

  await deleteImage(image.id);

  assert.equal(listImages().some((img) => img.id === image.id), false);
  const stillExists = await fs.access(filePath).then(() => true).catch(() => false);
  assert.equal(stillExists, false);
});
