import { Router } from 'express';
import { registerClient, removeClient } from '../services/realtime-service.js';

export const eventsRouter = Router();

eventsRouter.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write('retry: 3000\n\n');
  res.write(`event: connected\ndata: {}\n\n`);

  registerClient(res);

  req.on('close', () => {
    removeClient(res);
  });
});
