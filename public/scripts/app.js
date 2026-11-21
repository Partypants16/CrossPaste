import * as api from './api.js';
import { createEditor } from './editor.js';
import { readClipboardIntoEditor, copyEditorContent } from './clipboard.js';
import { createImagePanel } from './images.js';
import { createFilePanel } from './files.js';
import { startRealtime } from './realtime.js';
import { saveLocalRecovery, loadLocalRecovery, clearLocalRecovery } from './recovery.js';
import { extractPlainText } from './sanitize.js';
import { copyPlainText } from './clipboard.js';
import { initDeviceName, getDeviceName, setDeviceName, deviceIcon } from './device.js';
import { findLinks, findColours, colourFormats, shortLinkLabel, singleLink } from './smart.js';
import { createQrDialog } from './qr.js';
import { createHistoryDrawer } from './history.js';
import { createImageTextDialog } from './image-text.js';
import {
  el,
  formatRelativeTime,
  debounce,
  setConnectionStatus,
  setSaveStatus,
  setLastUpdated,
  announce,
  showPanel,
  hidePanel,
  showInlineMessage,
  hideInlineMessage,
} from './ui.js';

const DEFAULT_AUTOSAVE_DELAY_MS = 800;
const WARNING_THRESHOLD_RATIO = 0.9;

const editorEl = document.getElementById('editor');
const charCounterEl = document.getElementById('char-counter');
const limitWarningEl = document.getElementById('limit-warning');
const pasteFallbackEl = document.getElementById('paste-fallback-message');
const copyFallbackEl = document.getElementById('copy-fallback-message');

const conflictPanelEl = document.getElementById('conflict-panel');
const recoveryPanelEl = document.getElementById('recovery-panel');
const clearTextPanelEl = document.getElementById('clear-text-panel');

const smartBarEl = document.getElementById('smart-bar');
const textAuthorEl = document.getElementById('text-author');

let textCharacterLimit = 500000;
let serverSettings = {};
let lastClipboard = null;
let serverRevision = 0;
let isDirty = false;
let pendingRemoteClipboard = null;

function updateCharCounter() {
  const plainText = editor.getPlainText();
  const count = plainText.length;
  charCounterEl.textContent = `${count.toLocaleString()} / ${textCharacterLimit.toLocaleString()} characters`;

  if (count > textCharacterLimit) {
    showInlineMessage(
      limitWarningEl,
      `This text is over the ${textCharacterLimit.toLocaleString()}-character limit and cannot be saved until it is shorter.`
    );
  } else if (count > textCharacterLimit * WARNING_THRESHOLD_RATIO) {
    showInlineMessage(limitWarningEl, `Approaching the ${textCharacterLimit.toLocaleString()}-character limit.`);
  } else {
    hideInlineMessage(limitWarningEl);
  }
  return count;
}

// Device name

initDeviceName();
const devicePanelEl = document.getElementById('device-panel');
const deviceInputEl = document.getElementById('device-input');

function renderDeviceChip() {
  const name = getDeviceName();
  document.getElementById('device-name').textContent = name;
  document.getElementById('device-icon').textContent = deviceIcon(name);
}
renderDeviceChip();

document.getElementById('device-button').addEventListener('click', () => {
  deviceInputEl.value = getDeviceName();
  showPanel(devicePanelEl);
  deviceInputEl.focus();
  deviceInputEl.select();
});
document.getElementById('device-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const saved = setDeviceName(deviceInputEl.value);
  if (!saved) return;
  renderDeviceChip();
  hidePanel(devicePanelEl);
  announce(`This device is now called ${saved}`);
});
document.getElementById('device-cancel').addEventListener('click', () => hidePanel(devicePanelEl));

// Who changed the text last, under the editor

function renderTextAuthor() {
  if (!lastClipboard || !lastClipboard.characterCount) {
    textAuthorEl.textContent = '';
    return;
  }
  const who = lastClipboard.updatedBy;
  textAuthorEl.textContent = who
    ? `From ${deviceIcon(who)} ${who === getDeviceName() ? `${who} (this device)` : who} · ${formatRelativeTime(lastClipboard.updatedAt)}`
    : `Updated ${formatRelativeTime(lastClipboard.updatedAt)}`;
}
setInterval(renderTextAuthor, 60 * 1000);

// Links and colours found in the text

const qrDialog = createQrDialog({
  panel: document.getElementById('qr-panel'),
  title: document.getElementById('qr-title'),
  image: document.getElementById('qr-image'),
  message: document.getElementById('qr-message'),
  caption: document.getElementById('qr-caption'),
  closeButton: document.getElementById('qr-close'),
  pageButton: document.getElementById('qr-page-button'),
});

async function copyWithAnnouncement(text, label) {
  const result = await copyPlainText(text);
  announce(result.ok ? `${label} copied` : `Could not copy ${label.toLowerCase()} automatically`);
  return result.ok;
}

function renderSmartBar() {
  const text = editor.getPlainText();
  const links = findLinks(text);
  const colours = findColours(text);
  const chips = [];

  for (const url of links) {
    chips.push(
      el('div', { className: 'smart-chip' },
        el('a', { className: 'smart-chip__link', href: url, target: '_blank', rel: 'noopener noreferrer', title: url },
          el('span', { 'aria-hidden': 'true' }, '↗ '), `Open ${shortLinkLabel(url)}`),
        el('button', { type: 'button', className: 'smart-chip__action', title: 'QR code of this link', 'aria-label': `QR code for ${shortLinkLabel(url)}`, onClick: () => qrDialog.open(url, 'Scan to open this link') }, '▦'),
        el('button', { type: 'button', className: 'smart-chip__action', title: 'Copy this link', 'aria-label': `Copy ${shortLinkLabel(url)}`, onClick: () => copyWithAnnouncement(url, 'Link') }, '⧉')
      )
    );
  }

  for (const value of colours) {
    const { hex, rgb, css } = colourFormats(value);
    const swatch = el('span', { className: 'smart-chip__swatch', 'aria-hidden': 'true' });
    swatch.style.backgroundColor = css;
    chips.push(
      el('div', { className: 'smart-chip' },
        swatch,
        el('span', { className: 'smart-chip__label' }, value),
        el('button', { type: 'button', className: 'smart-chip__action smart-chip__action--text', onClick: () => copyWithAnnouncement(hex, 'Hex colour') }, value.toLowerCase() === hex ? 'HEX' : hex.toUpperCase()),
        el('button', { type: 'button', className: 'smart-chip__action smart-chip__action--text', onClick: () => copyWithAnnouncement(rgb, 'RGB colour') }, 'RGB')
      )
    );
  }

  smartBarEl.replaceChildren(...chips);
  smartBarEl.hidden = chips.length === 0;
}
const renderSmartBarSoon = debounce(renderSmartBar, 250);

const editor = createEditor(editorEl, {
  onChange: () => {
    isDirty = true;
    setSaveStatus('unsaved');
    renderSmartBarSoon();
    const count = updateCharCounter();
    saveLocalRecovery({
      contentHtml: editor.getHtml(),
      contentPlain: editor.getPlainText(),
      lastKnownServerRevision: serverRevision,
    });
    if (count <= textCharacterLimit) {
      scheduleAutosave();
    }
  },
});

let scheduleAutosave = debounce(() => {
  autosave();
}, DEFAULT_AUTOSAVE_DELAY_MS);

async function autosave() {
  const html = editor.getHtml();
  const plainText = extractPlainText(html);
  if (plainText.length > textCharacterLimit) {
    setSaveStatus('error');
    return;
  }

  setSaveStatus('saving');
  try {
    const { clipboard } = await api.saveClipboard(html, serverRevision);
    serverRevision = clipboard.revision;
    lastClipboard = clipboard;
    renderTextAuthor();
    isDirty = false;
    setLastUpdated(clipboard.updatedAt);
    setSaveStatus('saved');
    clearLocalRecovery();
  } catch (error) {
    if (error.code === 'REVISION_CONFLICT') {
      pendingRemoteClipboard = error.details.current;
      setSaveStatus('conflict');
      showPanel(conflictPanelEl);
      return;
    }
    if (error.code === 'TEXT_TOO_LARGE') {
      setSaveStatus('error');
      showInlineMessage(limitWarningEl, 'The saved text is too large for the server to accept. Reduce it and try again.');
      return;
    }
    if (error.code === 'NETWORK_ERROR') {
      setSaveStatus('offline');
      return;
    }
    setSaveStatus('error');
  }
}

function applyServerClipboard(clipboard) {
  editor.setHtml(clipboard.contentHtml);
  serverRevision = clipboard.revision;
  lastClipboard = clipboard;
  isDirty = false;
  updateCharCounter();
  renderSmartBar();
  renderTextAuthor();
  setLastUpdated(clipboard.updatedAt);
  setSaveStatus('saved');
  clearLocalRecovery();
}

// Toolbar wiring

document.querySelectorAll('.toolbar-button[data-command]').forEach((button) => {
  button.addEventListener('click', () => editor.execToolbarCommand(button.dataset.command));
});

document.querySelector('[data-action="paste-text"]').addEventListener('click', async () => {
  hideInlineMessage(pasteFallbackEl);
  const result = await readClipboardIntoEditor(editor);
  if (!result.ok) {
    showInlineMessage(
      pasteFallbackEl,
      'Could not read the clipboard automatically. Click inside the editor and use Ctrl+V or Command+V.'
    );
  }
});

document.querySelector('[data-action="copy-text"]').addEventListener('click', async () => {
  hideInlineMessage(copyFallbackEl);
  const result = await copyEditorContent(editor.getHtml(), editor.getPlainText());
  if (result.ok) {
    announce(result.mode === 'rich' ? 'Text copied' : 'Text copied as plain text');
  } else {
    showInlineMessage(copyFallbackEl, 'Could not copy automatically. Select the text and use Ctrl+C or Command+C.');
    const range = document.createRange();
    range.selectNodeContents(editorEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

document.querySelector('[data-action="copy-plain"]').addEventListener('click', async () => {
  hideInlineMessage(copyFallbackEl);
  const ok = await copyWithAnnouncement(editor.getPlainText(), 'Plain text');
  if (!ok) showInlineMessage(copyFallbackEl, 'Could not copy automatically. Select the text and use Ctrl+C or Command+C.');
});

document.querySelector('[data-action="show-qr"]').addEventListener('click', () => {
  const text = editor.getPlainText().trim();
  if (!text) {
    qrDialog.open(`${window.location.origin}/`, 'Open CrossPaste on another device');
    return;
  }
  const link = singleLink(text);
  qrDialog.open(link || text, link ? 'Scan to open this link' : 'Scan to get this text');
});

// Adds text (e.g. read from an image) to the end of the shared text, then saves it.
function appendToSharedText(text) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const div = document.createElement('div');
      div.textContent = paragraph;
      return `<p>${div.innerHTML.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
  editor.setHtml(`${editor.getHtml()}${paragraphs}`);
  isDirty = true;
  setSaveStatus('unsaved');
  updateCharCounter();
  renderSmartBar();
  scheduleAutosave();
}

document.querySelector('[data-action="clear-text"]').addEventListener('click', () => {
  showPanel(clearTextPanelEl);
});
document.getElementById('clear-text-confirm').addEventListener('click', async () => {
  hidePanel(clearTextPanelEl);
  try {
    const { clipboard } = await api.clearClipboard();
    applyServerClipboard(clipboard);
    announce('Text cleared');
  } catch {
    setSaveStatus('error');
  }
});
document.getElementById('clear-text-cancel').addEventListener('click', () => hidePanel(clearTextPanelEl));

// Conflict resolution

document.getElementById('conflict-keep-local').addEventListener('click', async () => {
  hidePanel(conflictPanelEl);
  try {
    const { clipboard } = await api.forceSaveClipboard(editor.getHtml());
    serverRevision = clipboard.revision;
    isDirty = false;
    setLastUpdated(clipboard.updatedAt);
    setSaveStatus('saved');
    clearLocalRecovery();
    pendingRemoteClipboard = null;
  } catch {
    setSaveStatus('error');
  }
});

document.getElementById('conflict-load-server').addEventListener('click', () => {
  hidePanel(conflictPanelEl);
  if (pendingRemoteClipboard) {
    applyServerClipboard(pendingRemoteClipboard);
    pendingRemoteClipboard = null;
  }
});

document.getElementById('conflict-copy-local').addEventListener('click', async () => {
  const result = await copyEditorContent(editor.getHtml(), editor.getPlainText());
  announce(result.ok ? 'Unsaved version copied to clipboard' : 'Could not copy automatically. Select the text and use Ctrl+C.');
});

// Local recovery

let recoveredContent = null;
document.getElementById('recovery-restore').addEventListener('click', () => {
  if (recoveredContent) {
    editor.setHtml(recoveredContent.contentHtml);
    isDirty = true;
    updateCharCounter();
    setSaveStatus('unsaved');
    scheduleAutosave();
  }
  hidePanel(recoveryPanelEl);
});
document.getElementById('recovery-discard').addEventListener('click', () => {
  clearLocalRecovery();
  hidePanel(recoveryPanelEl);
});

// Text read from images

const imageTextDialog = createImageTextDialog(
  {
    panel: document.getElementById('image-text-panel'),
    title: document.getElementById('image-text-title'),
    status: document.getElementById('image-text-status'),
    output: document.getElementById('image-text-output'),
    copyButton: document.getElementById('image-text-copy'),
    addButton: document.getElementById('image-text-add'),
    retryButton: document.getElementById('image-text-retry'),
    closeButton: document.getElementById('image-text-close'),
  },
  { onAddToSharedText: appendToSharedText }
);

// Image panel

const imagePanel = createImagePanel({
  pasteImageButton: document.getElementById('paste-image-button'),
  fileInput: document.getElementById('image-file-input'),
  copyButton: document.getElementById('copy-image-button'),
  downloadButton: document.getElementById('download-image-button'),
  deleteButton: document.getElementById('delete-image-button'),
  countStatus: document.getElementById('image-count-status'),
  limitMessage: document.getElementById('image-limit-message'),
  errorMessage: document.getElementById('image-error-message'),
  dropzone: document.getElementById('image-dropzone'),
  grid: document.getElementById('image-grid'),
  emptyState: document.getElementById('image-empty-state'),
  deletePanel: document.getElementById('delete-image-panel'),
  deleteConfirmButton: document.getElementById('delete-image-confirm'),
  deleteCancelButton: document.getElementById('delete-image-cancel'),
  textButton: document.getElementById('image-text-button'),
  pinButton: document.getElementById('pin-image-button'),
  pinButtonLabel: document.getElementById('pin-image-label'),
}, {
  onShowText: (id, filename) => imageTextDialog.open(id, filename),
});

document.addEventListener('paste', (event) => {
  if (editorEl.contains(document.activeElement) || document.activeElement === editorEl) return;
  imagePanel.handleDocumentPaste(event);
});

async function refreshImages() {
  try {
    const state = await api.fetchState();
    imagePanel.setImages(state.images, state.limits);
  } catch {
    // A transient failure here just leaves the previous image list visible.
  }
}

// File panel

const filePanel = createFilePanel(
  {
    list: document.getElementById('file-list'),
    emptyState: document.getElementById('file-empty-state'),
    downloadButton: document.getElementById('download-file-button'),
    deleteButton: document.getElementById('delete-file-button'),
    countStatus: document.getElementById('file-count-status'),
    limitMessage: document.getElementById('file-limit-message'),
    errorMessage: document.getElementById('file-error-message'),
    fileInput: document.getElementById('file-file-input'),
    dropzone: document.getElementById('file-dropzone'),
    deletePanel: document.getElementById('delete-file-panel'),
    deleteFilename: document.getElementById('delete-file-name'),
    deleteConfirmButton: document.getElementById('delete-file-confirm'),
    deleteCancelButton: document.getElementById('delete-file-cancel'),
    progress: document.getElementById('file-upload-progress'),
    progressName: document.getElementById('file-upload-name'),
    progressBar: document.getElementById('file-upload-bar'),
    progressDetail: document.getElementById('file-upload-detail'),
    cancelButton: document.getElementById('file-upload-cancel'),
    pinButton: document.getElementById('pin-file-button'),
    pinButtonLabel: document.getElementById('pin-file-label'),
  },
  {
    onImageFiles: (images) => imagePanel.uploadFiles(images),
  }
);

async function refreshFiles() {
  try {
    const state = await api.fetchState();
    filePanel.setFiles(state.files, state.limits);
  } catch {
    // A transient failure here just leaves the previous file list visible.
  }
}

// History drawer

function describeLimits() {
  const { historyMaxItems, historyMaxDays } = serverSettings;
  const parts = [];
  if (historyMaxItems) parts.push(`last ${historyMaxItems}`);
  if (historyMaxDays) parts.push(`${historyMaxDays} days`);
  return parts.length ? `Keeps the ${parts.join(', up to ')}. Pinned is kept forever.` : 'Keeps everything until you delete it.';
}

const historyDrawer = createHistoryDrawer(
  {
    drawer: document.getElementById('history-drawer'),
    overlay: document.getElementById('history-overlay'),
    toggleButton: document.getElementById('history-button'),
    closeButton: document.getElementById('history-close'),
    searchInput: document.getElementById('history-search'),
    clearButton: document.getElementById('history-clear'),
    limits: document.getElementById('history-limits'),
    status: document.getElementById('history-status'),
    results: document.getElementById('history-results'),
  },
  {
    onRestored: (clipboard) => applyServerClipboard(clipboard),
    onShowImageText: (id, filename) => imageTextDialog.open(id, filename),
    describeLimits,
  }
);

// Realtime sync

startRealtime({
  onConnected: async () => {
    setConnectionStatus('connected');
    try {
      const state = await api.fetchState();
      if (state.clipboard.revision !== serverRevision) {
        if (!isDirty) {
          applyServerClipboard(state.clipboard);
        } else {
          pendingRemoteClipboard = state.clipboard;
          setSaveStatus('remote-update');
        }
      }
      imagePanel.setImages(state.images, state.limits);
      filePanel.setFiles(state.files, state.limits);
    } catch {
      // Reconciliation failure on reconnect is non-fatal; the next event will retry.
    }
  },
  onDisconnected: () => setConnectionStatus('offline'),
  onTextUpdated: (clipboard) => {
    if (clipboard.revision <= serverRevision) return;
    if (!isDirty) {
      applyServerClipboard(clipboard);
    } else {
      pendingRemoteClipboard = clipboard;
      setSaveStatus('remote-update');
    }
  },
  onImagesChanged: () => {
    refreshImages();
    historyDrawer.refreshSoon();
  },
  onFilesChanged: () => {
    refreshFiles();
    historyDrawer.refreshSoon();
  },
  onHistoryChanged: () => {
    historyDrawer.refreshSoon();
  },
});

window.addEventListener('online', () => {
  if (isDirty) autosave();
});

document.getElementById('refresh-button').addEventListener('click', async () => {
  try {
    const state = await api.fetchState();
    if (!isDirty) {
      applyServerClipboard(state.clipboard);
    } else {
      pendingRemoteClipboard = state.clipboard;
      setSaveStatus('remote-update');
    }
    imagePanel.setImages(state.images, state.limits);
    filePanel.setFiles(state.files, state.limits);
    announce('Refreshed');
  } catch {
    setSaveStatus('offline');
  }
});

async function init() {
  setConnectionStatus('connecting');
  setSaveStatus('idle');

  try {
    const state = await api.fetchState();
    textCharacterLimit = state.limits.textCharacterLimit;
    serverSettings = state.settings || {};
    if (state.settings?.autosaveDelayMs) {
      scheduleAutosave = debounce(() => autosave(), state.settings.autosaveDelayMs);
    }

    const localRecovery = loadLocalRecovery();
    if (localRecovery && localRecovery.contentPlain?.trim().length > 0) {
      editor.setHtml(state.clipboard.contentHtml);
      serverRevision = state.clipboard.revision;
      setLastUpdated(state.clipboard.updatedAt);
      setSaveStatus('saved');
      recoveredContent = localRecovery;
      showPanel(recoveryPanelEl);
    } else {
      applyServerClipboard(state.clipboard);
    }

    updateCharCounter();
    imagePanel.setImages(state.images, state.limits);
    filePanel.setFiles(state.files, state.limits);
  } catch {
    setConnectionStatus('offline');
    setSaveStatus('offline');
  }
}

// After "Share → CrossPaste" on a phone, the server sends us here with what arrived.

function showShareResult() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('shared') !== '1') return;
  const count = (name) => Number.parseInt(params.get(name), 10) || 0;
  const parts = [];
  if (count('text')) parts.push('the text is now the shared text');
  if (count('images')) parts.push(`${count('images')} image${count('images') === 1 ? '' : 's'} added`);
  if (count('files')) parts.push(`${count('files')} file${count('files') === 1 ? '' : 's'} added`);
  const failed = count('failed');
  let message = parts.length ? `Shared: ${parts.join(', ')}.` : '';
  if (failed) message += `${message ? ' ' : ''}${failed} item${failed === 1 ? '' : 's'} could not be saved (too big, or the tray is full).`;
  if (!message) message = 'Nothing came through from that share.';

  const shareMessageEl = document.getElementById('share-message');
  shareMessageEl.textContent = message;
  shareMessageEl.dataset.tone = failed ? 'warning' : 'success';
  shareMessageEl.hidden = false;
  announce(message);
  setTimeout(() => {
    shareMessageEl.hidden = true;
  }, 8000);
  window.history.replaceState(null, '', window.location.pathname);
}

// The service worker only makes CrossPaste installable (needed for the share menu).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Not installable here; everything else still works.
  });
}

showShareResult();
init();
