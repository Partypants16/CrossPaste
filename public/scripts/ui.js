const connectionStatusEl = document.getElementById('connection-status');
const connectionStatusTextEl = document.getElementById('connection-status-text');
const saveStatusEl = document.getElementById('save-status');
const saveStatusTextEl = document.getElementById('save-status-text');
const lastUpdatedEl = document.getElementById('last-updated');
const announcerEl = document.getElementById('announcer');
const modalBackdropEl = document.getElementById('modal-backdrop');

const CONNECTION_LABELS = {
  connecting: 'Connecting…',
  connected: 'Connected',
  offline: 'Offline',
};

const SAVE_LABELS = {
  idle: 'Loading…',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  offline: 'Offline — changes kept locally',
  error: 'Save failed',
  'remote-update': 'Remote update available',
  conflict: 'Conflict detected',
};

export function debounce(fn, delayMs) {
  let timer = null;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function setConnectionStatus(state) {
  connectionStatusEl.dataset.state = state;
  connectionStatusTextEl.textContent = CONNECTION_LABELS[state] || state;
}

export function setSaveStatus(state, { announce = false } = {}) {
  saveStatusEl.dataset.state = state;
  saveStatusTextEl.textContent = SAVE_LABELS[state] || state;
  if (announce) announce_(SAVE_LABELS[state] || state);
}

export function setLastUpdated(isoTimestamp) {
  if (!isoTimestamp) {
    lastUpdatedEl.textContent = 'Last updated: —';
    return;
  }
  const date = new Date(isoTimestamp);
  lastUpdatedEl.textContent = `Last updated: ${date.toLocaleString()}`;
}

function announce_(message) {
  announcerEl.textContent = '';
  requestAnimationFrame(() => {
    announcerEl.textContent = message;
  });
}

export function announce(message) {
  announce_(message);
}

export function showPanel(panelEl) {
  modalBackdropEl.hidden = false;
  panelEl.hidden = false;
  const focusable = panelEl.querySelector('button');
  if (focusable) focusable.focus();
}

export function hidePanel(panelEl) {
  panelEl.hidden = true;
  const anyOpen = Array.from(document.querySelectorAll('.conflict-panel')).some((el) => !el.hidden);
  modalBackdropEl.hidden = !anyOpen;
}

export function showInlineMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

export function hideInlineMessage(element) {
  element.hidden = true;
  element.textContent = '';
}

/** "just now", "5 min ago", "yesterday 14:05", or a date for anything older. */
export function formatRelativeTime(isoTimestamp, now = Date.now()) {
  const date = new Date(isoTimestamp);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  const clock = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (hours < 12) return `${hours} h ago`;
  const today = new Date(now);
  const yesterday = new Date(now - 24 * 60 * 60 * 1000);
  if (date.toDateString() === today.toDateString()) return `today ${clock}`;
  if (date.toDateString() === yesterday.toDateString()) return `yesterday ${clock}`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** Small helper for building DOM without innerHTML: el('button', { className, onClick }, 'Text'). */
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'className') element.className = value;
    else if (key === 'onClick') element.addEventListener('click', value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key in element && typeof value !== 'string') element[key] = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}
