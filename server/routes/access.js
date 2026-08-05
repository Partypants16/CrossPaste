import { Router } from 'express';
import { verifyAccessToken } from '../middleware/security.js';
import { config } from '../config.js';

export const accessRouter = Router();

accessRouter.post('/access/verify', (req, res) => {
  if (!config.accessTokenEnabled) {
    return res.status(404).json({ error: { code: 'NOT_ENABLED', message: 'Access token login is not enabled.' } });
  }
  return verifyAccessToken(req, res);
});
