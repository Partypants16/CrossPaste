import {
  uploadImage,
  deleteImageRequest,
  imageFileUrl,
  imageThumbnailUrl,
  imageDownloadUrl,
  ApiError,
} from './api.js';
import { copyImageBlob } from './clipboard.js';
import { showInlineMessage, hideInlineMessage, showPanel, hidePanel, announce } from './ui.js';

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(isoTimestamp) {
  return new Date(isoTimestamp).toLocaleString();
}

export function createImagePanel(elements) {
  let images = [];
  let selectedImageId = null;
  let imageCountLimit = 10;

  function findSelected() {
    return images.find((image) => image.id === selectedImageId) || null;
  }

  function updateActionButtons() {
    const selected = findSelected();
    elements.copyButton.disabled = !selected;
    elements.downloadButton.disabled = !selected;
    elements.deleteButton.disabled = !selected;
  }

  function updateCapacityUi() {
    const remaining = Math.max(0, imageCountLimit - images.length);
    elements.countStatus.textContent = `${images.length} of ${imageCountLimit} images stored`;

    const atLimit = remaining === 0;
    elements.pasteImageButton.disabled = atLimit;
    elements.fileInput.disabled = atLimit;
    elements.fileInput.closest('label')?.classList.toggle('toolbar-button--disabled', atLimit);

    if (atLimit) {
      showInlineMessage(elements.limitMessage, `The ${imageCountLimit}-image limit has been reached. Delete an image to upload another.`);
    } else {
      hideInlineMessage(elements.limitMessage);
    }
  }

  function selectImage(id) {
    selectedImageId = selectedImageId === id ? null : id;
    renderCards();
    updateActionButtons();
  }

  function renderCards() {
    elements.grid.innerHTML = '';
    elements.emptyState.hidden = images.length > 0;

    for (const image of images) {
      const li = document.createElement('li');

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'image-card';
      card.setAttribute('aria-pressed', String(image.id === selectedImageId));
      card.setAttribute('aria-label', `Select image ${image.originalFilename}`);
      card.addEventListener('click', () => selectImage(image.id));

      const img = document.createElement('img');
      img.src = imageThumbnailUrl(image.id);
      img.alt = image.originalFilename ? `Thumbnail of ${image.originalFilename}` : 'Uploaded image thumbnail';
      img.loading = 'lazy';
      card.appendChild(img);

      const meta = document.createElement('div');
      meta.className = 'image-card__meta';
      const filenameEl = document.createElement('span');
      filenameEl.className = 'image-card__filename';
      filenameEl.textContent = image.originalFilename;
      const detailsEl = document.createElement('span');
      detailsEl.textContent = `${image.mimeType.replace('image/', '').toUpperCase()} · ${formatBytes(image.sizeBytes)}`;
      const timeEl = document.createElement('span');
      timeEl.textContent = formatTimestamp(image.createdAt);
      meta.append(filenameEl, detailsEl, timeEl);
      card.appendChild(meta);

      li.appendChild(card);

      const actions = document.createElement('div');
      actions.className = 'image-card__actions';
      actions.appendChild(createCardActionButton('Copy', `Copy ${image.originalFilename}`, () => copySelected(image.id)));
      actions.appendChild(createCardActionButton('Download', `Download ${image.originalFilename}`, () => downloadImage(image.id)));
      actions.appendChild(createCardActionButton('Delete', `Delete ${image.originalFilename}`, () => requestDelete(image.id)));
      li.appendChild(actions);

      elements.grid.appendChild(li);
    }
  }

  function createCardActionButton(label, accessibleLabel, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--ghost';
    button.textContent = label;
    button.setAttribute('aria-label', accessibleLabel);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function setImages(nextImages, limits) {
    images = nextImages;
    if (limits?.imageCountLimit) imageCountLimit = limits.imageCountLimit;
    if (selectedImageId && !images.some((image) => image.id === selectedImageId)) {
      selectedImageId = null;
    }
    renderCards();
    updateActionButtons();
    updateCapacityUi();
  }

  async function uploadFiles(fileList) {
    hideInlineMessage(elements.errorMessage);
    const files = Array.from(fileList);

    for (const file of files) {
      if (images.length >= imageCountLimit) {
        showInlineMessage(elements.limitMessage, `The ${imageCountLimit}-image limit has been reached. Delete an image to upload another.`);
        break;
      }

      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        showInlineMessage(elements.errorMessage, `"${file.name}" was not uploaded: only PNG, JPEG, WebP, and GIF images are supported.`);
        continue;
      }

      try {
        await uploadImage(file);
        announce(`${file.name} uploaded`);
      } catch (error) {
        const message = error instanceof ApiError ? error.message : 'Upload failed.';
        showInlineMessage(elements.errorMessage, `"${file.name}" was not uploaded: ${message}`);
      }
    }
  }

  function downloadImage(id) {
    const link = document.createElement('a');
    link.href = imageDownloadUrl(id);
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copySelected(id) {
    hideInlineMessage(elements.errorMessage);
    try {
      const response = await fetch(imageFileUrl(id));
      if (!response.ok) throw new Error('Could not load the image.');
      const blob = await response.blob();
      const result = await copyImageBlob(blob);
      if (result.ok) {
        announce('Image copied to clipboard');
      } else {
        showInlineMessage(
          elements.errorMessage,
          'Copying the image directly is not supported in this browser or context. Use Download instead, or open it in a new tab.'
        );
      }
    } catch {
      showInlineMessage(elements.errorMessage, 'Could not copy the image. Try downloading it instead.');
    }
  }

  let pendingDeleteId = null;

  function requestDelete(id) {
    pendingDeleteId = id;
    showPanel(elements.deletePanel);
  }

  async function confirmDelete() {
    if (pendingDeleteId == null) return;
    const id = pendingDeleteId;
    pendingDeleteId = null;
    hidePanel(elements.deletePanel);
    try {
      await deleteImageRequest(id);
      if (selectedImageId === id) selectedImageId = null;
      announce('Image deleted');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not delete the image.';
      showInlineMessage(elements.errorMessage, message);
    }
  }

  function cancelDelete() {
    pendingDeleteId = null;
    hidePanel(elements.deletePanel);
  }

  elements.deleteConfirmButton.addEventListener('click', confirmDelete);
  elements.deleteCancelButton.addEventListener('click', cancelDelete);

  elements.copyButton.addEventListener('click', () => {
    if (selectedImageId != null) copySelected(selectedImageId);
  });
  elements.downloadButton.addEventListener('click', () => {
    if (selectedImageId != null) downloadImage(selectedImageId);
  });
  elements.deleteButton.addEventListener('click', () => {
    if (selectedImageId != null) requestDelete(selectedImageId);
  });

  elements.fileInput.addEventListener('change', (event) => {
    if (event.target.files.length > 0) uploadFiles(event.target.files);
    event.target.value = '';
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.add('is-drag-active');
    });
  });
  ['dragleave', 'dragend'].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, () => {
      elements.dropzone.classList.remove('is-drag-active');
    });
  });
  elements.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('is-drag-active');
    if (event.dataTransfer?.files?.length) uploadFiles(event.dataTransfer.files);
  });

  async function pasteFromClipboard() {
    hideInlineMessage(elements.errorMessage);

    if (!navigator.clipboard || !navigator.clipboard.read) {
      showInlineMessage(elements.errorMessage, 'This browser cannot read images from the clipboard here. Click inside this panel and use Ctrl+V or Command+V instead.');
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        const imageType = item.types.find((type) => ALLOWED_MIME_TYPES.has(type));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        files.push(new File([blob], `pasted-image.${imageType.split('/')[1]}`, { type: imageType }));
      }
      if (files.length === 0) {
        showInlineMessage(elements.errorMessage, 'No supported image was found on the clipboard.');
        return;
      }
      await uploadFiles(files);
    } catch (error) {
      const reason = error?.name === 'NotAllowedError' ? 'Clipboard permission was denied.' : 'Could not read the clipboard.';
      showInlineMessage(elements.errorMessage, `${reason} Click inside this panel and use Ctrl+V or Command+V instead.`);
    }
  }

  elements.pasteImageButton.addEventListener('click', pasteFromClipboard);

  function handleDocumentPaste(event) {
    if (!event.clipboardData) return;
    const files = Array.from(event.clipboardData.files || []).filter((file) => ALLOWED_MIME_TYPES.has(file.type));
    if (files.length === 0) return;
    event.preventDefault();
    uploadFiles(files);
  }

  return {
    setImages,
    uploadFiles,
    handleDocumentPaste,
    getSelectedImageId: () => selectedImageId,
  };
}
