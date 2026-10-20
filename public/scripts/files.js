import {
  fetchFiles,
  uploadFile,
  deleteFileRequest,
  fileDownloadUrl,
  ApiError,
} from './api.js';
import { showInlineMessage, hideInlineMessage, showPanel, hidePanel, announce } from './ui.js';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// Uploads that finish faster than this never show the progress bar, so small files don't flicker it.
const PROGRESS_REVEAL_DELAY_MS = 300;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(seconds) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  return `${Math.round(seconds / 60)} min`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function extensionFor(filename) {
  const match = String(filename || '').match(/\.([^.]+)$/);
  return (match?.[1] || 'FILE').slice(0, 5).toUpperCase();
}

function typeLabel(mimeType) {
  const [group, subtype] = String(mimeType || 'application/octet-stream').split('/');
  if (group === 'application') return (subtype || 'file').replace(/^vnd\./, '').split(/[.+-]/)[0].toUpperCase();
  return group ? `${group[0].toUpperCase()}${group.slice(1)} file` : 'File';
}

export function createFilePanel(elements, { onImageFiles, onChanged } = {}) {
  let files = [];
  let selectedFileId = null;
  let pendingDeleteId = null;
  let fileCountLimit = 10;
  let fileSizeLimitBytes = 200 * 1024 * 1024;
  let imageSizeLimitBytes = 10 * 1024 * 1024;
  let busy = false;
  const uploadQueue = [];
  let queuedTotal = 0;
  let queuedDone = 0;
  let activeUpload = null;
  let progressRevealTimer = null;

  function findSelected() {
    return files.find((file) => file.id === selectedFileId) || null;
  }

  function updateActions() {
    const selected = findSelected();
    elements.downloadButton.disabled = !selected || busy;
    elements.deleteButton.disabled = !selected || busy;
  }

  function updateCapacity() {
    const atLimit = files.length >= fileCountLimit;
    elements.countStatus.textContent = `${files.length} of ${fileCountLimit} files stored · ${formatBytes(fileSizeLimitBytes)} maximum per file`;
    elements.fileInput.disabled = atLimit || busy;
    elements.fileInput.closest('label')?.classList.toggle('toolbar-button--disabled', atLimit || busy);
    if (atLimit) {
      showInlineMessage(elements.limitMessage, `The ${fileCountLimit}-file limit has been reached. Delete a file to upload another.`);
    } else {
      hideInlineMessage(elements.limitMessage);
    }
  }

  function createAction(label, ariaLabel, handler, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button button--ghost${danger ? ' file-card__delete' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function render() {
    elements.list.replaceChildren();
    elements.emptyState.hidden = files.length > 0;

    for (const file of files) {
      const item = document.createElement('li');
      item.className = 'file-card';

      const selector = document.createElement('button');
      selector.type = 'button';
      selector.className = 'file-card__selector';
      selector.setAttribute('aria-pressed', String(file.id === selectedFileId));
      selector.setAttribute('aria-label', `Select file ${file.originalFilename}`);
      selector.addEventListener('click', () => {
        selectedFileId = selectedFileId === file.id ? null : file.id;
        render();
        updateActions();
      });

      const icon = document.createElement('span');
      icon.className = 'file-card__icon';
      icon.textContent = extensionFor(file.originalFilename);
      icon.setAttribute('aria-hidden', 'true');

      const details = document.createElement('span');
      details.className = 'file-card__details';
      const name = document.createElement('span');
      name.className = 'file-card__name';
      name.textContent = file.originalFilename;
      name.title = file.originalFilename;
      const metadata = document.createElement('span');
      metadata.className = 'file-card__metadata';
      metadata.textContent = `${typeLabel(file.mimeType)} · ${formatBytes(file.sizeBytes)} · ${formatTimestamp(file.createdAt)}`;
      details.append(name, metadata);
      selector.append(icon, details);

      const actions = document.createElement('div');
      actions.className = 'file-card__actions';
      actions.append(
        createAction('Download', `Download ${file.originalFilename}`, () => download(file.id)),
        createAction('Delete', `Delete ${file.originalFilename}`, () => requestDelete(file.id), true)
      );
      item.append(selector, actions);
      elements.list.appendChild(item);
    }
  }

  function setFiles(nextFiles = [], limits = {}) {
    files = Array.isArray(nextFiles) ? nextFiles : [];
    if (Number.isFinite(limits.fileCountLimit)) fileCountLimit = limits.fileCountLimit;
    if (Number.isFinite(limits.fileSizeLimitBytes)) fileSizeLimitBytes = limits.fileSizeLimitBytes;
    if (Number.isFinite(limits.imageSizeLimitBytes)) imageSizeLimitBytes = limits.imageSizeLimitBytes;
    if (selectedFileId != null && !files.some((file) => file.id === selectedFileId)) selectedFileId = null;
    render();
    updateActions();
    updateCapacity();
  }

  async function refresh() {
    try {
      const result = await fetchFiles();
      setFiles(result.files, { fileCountLimit, fileSizeLimitBytes });
    } catch (error) {
      showInlineMessage(elements.errorMessage, error instanceof ApiError ? error.message : 'Could not refresh shared files.');
    }
  }

  function showProgress(file) {
    elements.progressName.textContent = queuedTotal > 1
      ? `Uploading ${file.name} (${queuedDone} of ${queuedTotal})`
      : `Uploading ${file.name}`;
    elements.progressBar.value = 0;
    elements.progressDetail.textContent = `0 B of ${formatBytes(file.size)}`;
    elements.cancelButton.disabled = false;
    if (elements.progress.hidden && progressRevealTimer == null) {
      progressRevealTimer = setTimeout(() => {
        progressRevealTimer = null;
        elements.progress.hidden = false;
      }, PROGRESS_REVEAL_DELAY_MS);
    }
  }

  function updateProgress(file, startedAt, { loaded, total }) {
    const sent = Math.min(loaded, file.size);
    const percent = Math.min(100, Math.floor((loaded / (total || file.size || 1)) * 100));
    elements.progressBar.value = percent;
    const parts = [`${formatBytes(sent)} of ${formatBytes(file.size)}`, `${percent}%`];
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    if (elapsedSeconds >= 1 && sent > 0) {
      const bytesPerSecond = sent / elapsedSeconds;
      parts.push(`${formatBytes(bytesPerSecond)}/s`, `about ${formatDuration((file.size - sent) / bytesPerSecond)} left`);
    }
    elements.progressDetail.textContent = parts.join(' · ');
  }

  function showSaving() {
    elements.progressBar.value = 100;
    elements.progressDetail.textContent = 'Upload complete. Saving on the server…';
    // Once every byte is sent the server keeps the file, so cancelling no longer means anything.
    elements.cancelButton.disabled = true;
  }

  function hideProgress() {
    clearTimeout(progressRevealTimer);
    progressRevealTimer = null;
    elements.progress.hidden = true;
  }

  function warnBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  async function uploadWithProgress(file) {
    activeUpload = new AbortController();
    const startedAt = performance.now();
    showProgress(file);
    try {
      return await uploadFile(file, {
        signal: activeUpload.signal,
        onProgress: (progress) => updateProgress(file, startedAt, progress),
        onSent: showSaving,
      });
    } finally {
      activeUpload = null;
    }
  }

  function belongsInImageTray(file) {
    // An image too big for the image tray is stored here as an ordinary file instead.
    return IMAGE_MIME_TYPES.has(file.type) && file.size <= imageSizeLimitBytes;
  }

  async function uploadFiles(fileList) {
    if (!busy) hideInlineMessage(elements.errorMessage);
    const incoming = Array.from(fileList || []);
    const images = incoming.filter(belongsInImageTray);
    const otherFiles = incoming.filter((file) => !belongsInImageTray(file));
    uploadQueue.push(...otherFiles);
    queuedTotal += otherFiles.length;
    if (images.length && onImageFiles) await onImageFiles(images);
    // Files added while an upload is running join the queue that the running loop drains.
    if (busy || !uploadQueue.length) return;

    busy = true;
    updateActions();
    updateCapacity();
    window.addEventListener('beforeunload', warnBeforeUnload);
    while (uploadQueue.length) {
      const file = uploadQueue.shift();
      queuedDone += 1;
      if (files.length >= fileCountLimit) {
        showInlineMessage(elements.limitMessage, `The ${fileCountLimit}-file limit has been reached. Delete a file to upload another.`);
        break;
      }
      if (file.size > fileSizeLimitBytes) {
        showInlineMessage(elements.errorMessage, `“${file.name}” is ${formatBytes(file.size)}. The maximum file size is ${formatBytes(fileSizeLimitBytes)}.`);
        continue;
      }
      try {
        const result = await uploadWithProgress(file);
        // The realtime refresh can land before this response, so never add the file twice.
        files = [...files.filter((entry) => entry.id !== result.file.id), result.file];
        render();
        updateCapacity();
        announce(`${file.name} uploaded`);
      } catch (error) {
        if (error?.code === 'UPLOAD_CANCELLED') {
          announce(`Upload of ${file.name} cancelled`);
          break;
        }
        const message = error instanceof ApiError ? error.message : 'Upload failed.';
        showInlineMessage(elements.errorMessage, `“${file.name}” was not uploaded: ${message}`);
        if (error?.code === 'FILE_LIMIT_REACHED') break;
      }
    }
    uploadQueue.length = 0;
    queuedTotal = 0;
    queuedDone = 0;
    hideProgress();
    window.removeEventListener('beforeunload', warnBeforeUnload);
    busy = false;
    updateActions();
    updateCapacity();
    onChanged?.();
  }

  function download(id) {
    const file = files.find((entry) => entry.id === id);
    const link = document.createElement('a');
    link.href = fileDownloadUrl(id);
    link.download = file?.originalFilename || '';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    announce(file ? `Downloading ${file.originalFilename}` : 'Downloading file');
  }

  function requestDelete(id) {
    pendingDeleteId = id;
    const file = files.find((entry) => entry.id === id);
    elements.deleteFilename.textContent = file?.originalFilename || 'this file';
    showPanel(elements.deletePanel);
  }

  async function confirmDelete() {
    if (pendingDeleteId == null) return;
    const id = pendingDeleteId;
    pendingDeleteId = null;
    hidePanel(elements.deletePanel);
    try {
      await deleteFileRequest(id);
      files = files.filter((file) => file.id !== id);
      if (selectedFileId === id) selectedFileId = null;
      render();
      updateActions();
      updateCapacity();
      announce('File deleted');
      onChanged?.();
    } catch (error) {
      showInlineMessage(elements.errorMessage, error instanceof ApiError ? error.message : 'Could not delete the file.');
    }
  }

  elements.downloadButton.addEventListener('click', () => selectedFileId != null && download(selectedFileId));
  elements.deleteButton.addEventListener('click', () => selectedFileId != null && requestDelete(selectedFileId));
  elements.deleteConfirmButton.addEventListener('click', confirmDelete);
  elements.deleteCancelButton.addEventListener('click', () => {
    pendingDeleteId = null;
    hidePanel(elements.deletePanel);
  });
  elements.cancelButton.addEventListener('click', () => {
    uploadQueue.length = 0;
    activeUpload?.abort();
  });
  elements.fileInput.addEventListener('change', (event) => {
    if (event.target.files?.length) uploadFiles(event.target.files);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    elements.dropzone.classList.add('is-drag-active');
  }));
  ['dragleave', 'dragend'].forEach((name) => elements.dropzone.addEventListener(name, (event) => {
    event.stopPropagation();
    if (name === 'dragleave' && event.relatedTarget && elements.dropzone.contains(event.relatedTarget)) return;
    elements.dropzone.classList.remove('is-drag-active');
  }));
  elements.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    elements.dropzone.classList.remove('is-drag-active');
    if (event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
  });

  return { setFiles, refresh, uploadFiles, getSelectedFileId: () => selectedFileId };
}
