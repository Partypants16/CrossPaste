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
import { eventsRouter } from './routes/events.js';
import { accessRouter } from './routes/access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIRECTORY = path.join(__dirname, '..', 'public');

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
    eventsRouter
  );
  app.use('/api', imagesRouter);

  app.use(
    express.static(PUBLIC_DIRECTORY, {
      dotfiles: 'ignore',
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use('/api', notFoundHandler);
  app.use(errorHandler);

  return app;
}
