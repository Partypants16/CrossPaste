import path from 'node:path';

function parseIntEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value < min || value > max) {
    throw new Error(`Invalid value for ${name}: "${raw}" (expected an integer between ${min} and ${max})`);
  }
  return value;
}

function parseHost(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.trim();
}

function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'production';
  const appHost = parseHost('APP_HOST', '0.0.0.0');
  const appPort = parseIntEnv('APP_PORT', 3000, { min: 1, max: 65535 });
  const internalHostname = parseHost('INTERNAL_HOSTNAME', 'crosspaste.home');

  const textCharacterLimit = parseIntEnv('TEXT_CHARACTER_LIMIT', 500000, { min: 1000, max: 5_000_000 });
  const imageCountLimit = parseIntEnv('IMAGE_COUNT_LIMIT', 10, { min: 1, max: 200 });
  const imageSizeLimitMb = parseIntEnv('IMAGE_SIZE_LIMIT_MB', 10, { min: 1, max: 200 });
  const imageMaxDimension = parseIntEnv('IMAGE_MAX_DIMENSION', 2000, { min: 200, max: 10000 });
  const fileCountLimit = parseIntEnv('FILE_COUNT_LIMIT', 10, { min: 1, max: 200 });
  const fileSizeLimitMb = parseIntEnv('FILE_SIZE_LIMIT_MB', 25, { min: 1, max: 500 });

  const autosaveDelayMs = parseIntEnv('AUTOSAVE_DELAY_MS', 800, { min: 100, max: 10000 });

  const writeRateLimitWindowMs = parseIntEnv('WRITE_RATE_LIMIT_WINDOW_MS', 60000, { min: 1000 });
  const writeRateLimitMax = parseIntEnv('WRITE_RATE_LIMIT_MAX', 120, { min: 1 });
  const uploadRateLimitWindowMs = parseIntEnv('UPLOAD_RATE_LIMIT_WINDOW_MS', 60000, { min: 1000 });
  const uploadRateLimitMax = parseIntEnv('UPLOAD_RATE_LIMIT_MAX', 20, { min: 1 });

  const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || './data');
  const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY || path.join(dataDirectory, 'uploads'));
  const thumbnailDirectory = path.resolve(process.env.THUMBNAIL_DIRECTORY || path.join(dataDirectory, 'thumbnails'));
  const filesDirectory = path.resolve(process.env.FILES_DIRECTORY || path.join(dataDirectory, 'files'));

  const optionalAccessToken = process.env.OPTIONAL_ACCESS_TOKEN || '';
  const contentExpiryHours = parseIntEnv('CONTENT_EXPIRY_HOURS', 0, { min: 0, max: 8760 });

  const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: "${logLevel}" (expected one of ${validLogLevels.join(', ')})`);
  }

  if (appHost.length === 0) {
    throw new Error('APP_HOST must not be empty');
  }
  if (internalHostname.length === 0) {
    throw new Error('INTERNAL_HOSTNAME must not be empty');
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    appHost,
    appPort,
    internalHostname,
    textCharacterLimit,
    imageCountLimit,
    imageSizeLimitBytes: imageSizeLimitMb * 1024 * 1024,
    imageMaxDimension,
    fileCountLimit,
    fileSizeLimitBytes: fileSizeLimitMb * 1024 * 1024,
    autosaveDelayMs,
    writeRateLimitWindowMs,
    writeRateLimitMax,
    uploadRateLimitWindowMs,
    uploadRateLimitMax,
    dataDirectory,
    uploadDirectory,
    thumbnailDirectory,
    filesDirectory,
    databasePath: path.join(dataDirectory, 'crosspaste.db'),
    optionalAccessToken,
    accessTokenEnabled: optionalAccessToken.trim().length > 0,
    contentExpiryHours,
    contentExpiryEnabled: contentExpiryHours > 0,
    logLevel,
    appVersion: process.env.npm_package_version || '1.0.0',
  };
}

export const config = loadConfig();
