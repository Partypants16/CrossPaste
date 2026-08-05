import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utilities/logger.js';
import { closeDatabase } from './database.js';
import { startHeartbeat, closeAllConnections } from './services/realtime-service.js';
import { runExpiryCleanup, startExpiryScheduler, stopExpiryScheduler } from './services/cleanup-service.js';

async function main() {
  const app = await createApp();

  const server = app.listen(config.appPort, config.appHost, () => {
    logger.info('CrossPaste server started', {
      host: config.appHost,
      port: config.appPort,
      nodeEnv: config.nodeEnv,
    });
  });

  const heartbeatTimer = startHeartbeat();
  startExpiryScheduler();
  await runExpiryCleanup();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down CrossPaste server', { signal });

    clearInterval(heartbeatTimer);
    stopExpiryScheduler();
    closeAllConnections();

    server.close(() => {
      closeDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start CrossPaste server', { message: error.message });
  process.exitCode = 1;
});
