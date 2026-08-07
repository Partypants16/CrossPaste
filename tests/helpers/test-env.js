import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Every test gets its own temporary data directory and a fresh env, set BEFORE any
 * server module is imported (config.js reads process.env once, at import time), so
 * tests never touch the real ./data directory and never share state with each other.
 */
export async function setupTestEnvironment(overrides = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crosspaste-test-'));

  process.env.NODE_ENV = 'test';
  process.env.DATA_DIRECTORY = tempDir;
  process.env.UPLOAD_DIRECTORY = path.join(tempDir, 'uploads');
  process.env.THUMBNAIL_DIRECTORY = path.join(tempDir, 'thumbnails');
  process.env.FILES_DIRECTORY = path.join(tempDir, 'files');
  process.env.LOG_LEVEL = 'error';
  process.env.OPTIONAL_ACCESS_TOKEN = '';
  process.env.CONTENT_EXPIRY_HOURS = '0';

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = String(value);
  }

  return tempDir;
}

export async function teardownTestEnvironment(tempDir) {
  await fs.rm(tempDir, { recursive: true, force: true });
}
