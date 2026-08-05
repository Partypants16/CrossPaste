import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger(minLevel) {
  const threshold = LEVELS[minLevel] ?? LEVELS.info;

  function write(level, message, meta) {
    if (LEVELS[level] < threshold) return;
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export const logger = createLogger(config.logLevel);
