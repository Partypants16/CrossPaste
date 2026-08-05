import { Router } from 'express';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { isDatabaseHealthy } from '../database.js';

export const healthRouter = Router();

async function isDirectoryWritable(directoryPath) {
  try {
    await fs.access(directoryPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

healthRouter.get('/health', async (_req, res) => {
  const databaseReachable = isDatabaseHealthy();
  const dataDirectoryWritable = await isDirectoryWritable(config.dataDirectory);
  const healthy = databaseReachable && dataDirectoryWritable;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    databaseReachable,
    dataDirectoryWritable,
    serverTime: new Date().toISOString(),
    version: config.appVersion,
  });
});
