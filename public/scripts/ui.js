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
