const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

let eventSource = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let listeners = null;

function connect() {
  if (eventSource) return;

  eventSource = new EventSource('/api/events');

  eventSource.addEventListener('connected', () => {
    reconnectAttempts = 0;
    listeners.onConnected();
  });

  eventSource.addEventListener('text-updated', (event) => {
    listeners.onTextUpdated(JSON.parse(event.data));
  });

  eventSource.addEventListener('images-changed', (event) => {
    listeners.onImagesChanged(JSON.parse(event.data));
  });

  eventSource.onerror = () => {
    listeners.onDisconnected();
    teardown();
    scheduleReconnect();
  };
}

function teardown() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Only one EventSource is ever opened; calling this again after start() is a no-op
 * so re-entrant setup code cannot create duplicate realtime subscriptions.
 */
export function startRealtime(handlers) {
  if (listeners) return;
  listeners = handlers;
  connect();
}

export function stopRealtime() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  teardown();
  listeners = null;
}
