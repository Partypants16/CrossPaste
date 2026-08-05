import helmet from 'helmet';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  frameguard: { action: 'deny' },
  hsts: false,
});

export function permissionsPolicy(_req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
}

export function noCacheForMutableData(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  next();
}

const ACCESS_COOKIE_NAME = 'crosspaste_access';

function timingSafeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Optional shared-token gate. Disabled entirely when OPTIONAL_ACCESS_TOKEN is unset,
 * so the default LAN/VPN workflow never sees a login prompt.
 */
export function accessTokenGate(req, res, next) {
  if (!config.accessTokenEnabled) return next();

  const isApiRequest = req.path.startsWith('/api/');
  const allowedWithoutAuth =
    req.path === '/api/access/verify' || req.path === '/access.html' || req.path.startsWith('/styles/') || req.path.startsWith('/scripts/') || req.path === '/favicon.svg';

  if (allowedWithoutAuth) return next();

  const cookieToken = req.cookies?.[ACCESS_COOKIE_NAME];
  if (cookieToken && timingSafeEqual(cookieToken, config.optionalAccessToken)) {
    return next();
  }

  if (isApiRequest) {
    return res.status(401).json({ error: { code: 'ACCESS_TOKEN_REQUIRED', message: 'A valid access token is required.' } });
  }

  return res.redirect('/access.html');
}

export function verifyAccessToken(req, res) {
  const submitted = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!submitted || !timingSafeEqual(submitted, config.optionalAccessToken)) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Incorrect access token.' } });
  }

  res.cookie(ACCESS_COOKIE_NAME, submitted, {
    httpOnly: true,
    secure: req.secure,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  return res.json({ ok: true });
}
