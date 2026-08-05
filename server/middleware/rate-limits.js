import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

function rateLimitResponse(_req, res) {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
  });
}

export const writeRateLimiter = rateLimit({
  windowMs: config.writeRateLimitWindowMs,
  max: config.writeRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitResponse,
});

export const uploadRateLimiter = rateLimit({
  windowMs: config.uploadRateLimitWindowMs,
  max: config.uploadRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitResponse,
});
