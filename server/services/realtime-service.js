import { logger } from '../utilities/logger.js';

const clients = new Set();
const HEARTBEAT_INTERVAL_MS = 25000;

function formatEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerClient(res) {
  clients.add(res);
  logger.info('Realtime client connected', { activeConnections: clients.size });
}

export function removeClient(res) {
  clients.delete(res);
  logger.info('Realtime client disconnected', { activeConnections: clients.size });
}

export function broadcast(event, data) {
  const payload = formatEvent(event, data);
  for (const client of clients) {
    client.write(payload);
  }
}

export function startHeartbeat() {
  const interval = setInterval(() => {
    for (const client of clients) {
      client.write(': heartbeat\n\n');
    }
  }, HEARTBEAT_INTERVAL_MS);
  interval.unref();
  return interval;
}

export function closeAllConnections() {
  for (const client of clients) {
    client.end();
  }
  clients.clear();
}

export function getActiveConnectionCount() {
  return clients.size;
}
