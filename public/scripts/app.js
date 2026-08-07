import * as api from './api.js';
import { createEditor } from './editor.js';
import { readClipboardIntoEditor, copyEditorContent } from './clipboard.js';
import { createImagePanel } from './images.js';
import { createFilePanel } from './files.js';
import { startRealtime } from './realtime.js';
import { saveLocalRecovery, loadLocalRecovery, clearLocalRecovery } from './recovery.js';
import { extractPlainText } from './sanitize.js';
import {
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

let textCharacterLimit = 500000;
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

const editor = createEditor(editorEl, {
  onChange: () => {
    isDirty = true;
    setSaveStatus('unsaved');
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
  isDirty = false;
  updateCharCounter();
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
  },
  onFilesChanged: () => {
    refreshFiles();
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

init();
