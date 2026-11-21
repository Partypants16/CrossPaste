import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import { getDatabase } from '../database.js';
import { config } from '../config.js';
import { logger } from '../utilities/logger.js';
import { broadcast } from './realtime-service.js';
import { ImageNotFoundError } from './image-service.js';

/**
 * Reads the text in shared images (screenshots, photos of notes) on this server with
 * tesseract.js, so phones don't have to. The English model ships inside the
 * @tesseract.js-data/eng package, so nothing is downloaded and no image leaves the box.
 *
 * Images are read one at a time in the background after upload; the text is stored
 * with the image so it can be copied straight away and found by search. The OCR
 * worker uses ~100 MB, so it is shut down after a minute with nothing to read.
 */

const require = createRequire(import.meta.url);
const LANGUAGE_PATH = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
const WORKER_IDLE_MS = 60 * 1000;
const RECOGNISE_TIMEOUT_MS = 90 * 1000;
const MAX_TEXT_LENGTH = 100_000;

let workerPromise = null;
let idleTimer = null;
let queue = Promise.resolve();
const inFlight = new Map();

function getWorker() {
  clearTimeout(idleTimer);
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
      langPath: LANGUAGE_PATH,
      gzip: true,
      cacheMethod: 'none',
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function scheduleWorkerShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    shutdownOcr();
  }, WORKER_IDLE_MS);
  idleTimer.unref?.();
}

export async function shutdownOcr() {
  clearTimeout(idleTimer);
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker never started or already gone.
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Reading the image took too long')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function cleanText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function readImage(id) {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) return null;
  if (row.ocr_status === 'done' || row.ocr_status === 'failed') return row;

  try {
    const original = await fs.readFile(path.join(config.uploadDirectory, row.stored_filename));
    // Greyscale PNG of the first frame: tesseract reads it reliably whatever the source format.
    const prepared = await sharp(original, { animated: false }).rotate().greyscale().png().toBuffer();
    const worker = await getWorker();
    const { data } = await withTimeout(worker.recognize(prepared), RECOGNISE_TIMEOUT_MS);
    const text = cleanText(data?.text);
    db.prepare("UPDATE images SET ocr_status = 'done', ocr_text = ? WHERE id = ?").run(text, id);
    logger.info('Read text from image', { imageId: id, characters: text.length });
  } catch (error) {
    db.prepare("UPDATE images SET ocr_status = 'failed', ocr_text = NULL WHERE id = ?").run(id);
    logger.warn('Could not read text from image', { imageId: id, message: error.message });
    // A stuck or crashed worker is replaced on the next image.
    await shutdownOcr();
  }

  broadcast('images-changed', { reason: 'text-read', imageId: id });
  return db.prepare('SELECT * FROM images WHERE id = ?').get(id);
}

/** Adds one image to the background queue. Returns a promise for its finished row. */
export function queueImageText(id) {
  if (!config.ocrEnabled) return Promise.resolve(null);
  if (inFlight.has(id)) return inFlight.get(id);

  const job = queue
    .then(() => readImage(id))
    .finally(() => {
      inFlight.delete(id);
      if (inFlight.size === 0) scheduleWorkerShutdown();
    });
  inFlight.set(id, job);
  // A failed job must not stop the ones queued after it.
  queue = job.catch(() => null);
  return job;
}

/** On start-up: read any images still waiting (uploaded before this feature, or before a restart). */
export function queuePendingImages() {
  if (!config.ocrEnabled) return 0;
  const rows = getDatabase().prepare("SELECT id FROM images WHERE ocr_status = 'pending' ORDER BY id").all();
  for (const row of rows) queueImageText(row.id);
  return rows.length;
}

/**
 * The text read from one image. Waits for it if the image is still in the queue;
 * `retry` reads a failed image again.
 */
export async function getImageText(id, { retry = false } = {}) {
  const db = getDatabase();
  let row = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
  if (!row) throw new ImageNotFoundError();

  if (!config.ocrEnabled) return { status: 'disabled', text: '' };

  if (retry && row.ocr_status === 'failed') {
    db.prepare("UPDATE images SET ocr_status = 'pending' WHERE id = ?").run(id);
    row = { ...row, ocr_status: 'pending' };
  }
  if (row.ocr_status === 'pending' || row.ocr_status === 'skipped') {
    if (row.ocr_status === 'skipped') db.prepare("UPDATE images SET ocr_status = 'pending' WHERE id = ?").run(id);
    row = (await queueImageText(id)) || row;
  }
  if (!row) throw new ImageNotFoundError();
  return { status: row.ocr_status, text: row.ocr_text || '' };
}
