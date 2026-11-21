import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { securityHeaders, permissionsPolicy, accessTokenGate } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.js';
import { stateRouter } from './routes/state.js';
import { clipboardRouter } from './routes/clipboard.js';
import { imagesRouter } from './routes/images.js';
import { filesRouter } from './routes/files.js';
import { eventsRouter } from './routes/events.js';
import { accessRouter } from './routes/access.js';
import { historyRouter } from './routes/history.js';
import { searchRouter } from './routes/search.js';
import { shareRouter } from './routes/share.js';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIRECTORY = path.join(__dirname, '..', 'public');
const require = createRequire(import.meta.url);
// The QR code library is served straight from node_modules, so there is no copy to keep in step.
const QRCODE_MODULE_PATH = path.join(path.dirname(require.resolve('qrcode-generator')), 'qrcode.mjs');

export async function createApp() {
  await openDatabase();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(permissionsPolicy);
  app.use(cookieParser());
  app.use(accessTokenGate);

  app.use('/api/access', express.json({ limit: '2kb' }), accessRouter);

  app.use(
    '/api',
    express.json({ limit: '2mb' }),
    healthRouter,
    stateRouter,
    clipboardRouter,
    historyRouter,
    searchRouter,
    eventsRouter
  );
  app.use('/api', imagesRouter);
  app.use('/api', filesRouter);
  app.use(shareRouter);

  app.get('/vendor/qrcode.mjs', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('text/javascript').sendFile(QRCODE_MODULE_PATH);
  });

  app.use(
    express.static(PUBLIC_DIRECTORY, {
      dotfiles: 'ignore',
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
        if (filePath.endsWith('.webmanifest')) {
          res.setHeader('Content-Type', 'application/manifest+json');
        }
      },
    })
  );

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
