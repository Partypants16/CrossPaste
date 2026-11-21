import { fetchImageText } from './api.js';
import { copyPlainText } from './clipboard.js';
import { showPanel, hidePanel, announce } from './ui.js';

/**
 * Shows the text the server read from an image (a screenshot, a photo of a note),
 * with Copy and "Add to shared text". The text is shown in a box as well as copied,
 * because copying needs HTTPS on most phones and the LAN address is plain HTTP.
 */
export function createImageTextDialog(elements, { onAddToSharedText }) {
  let currentId = null;
  let currentText = '';

  function setBusy(message) {
    elements.status.textContent = message;
    elements.status.hidden = false;
    elements.output.hidden = true;
    elements.copyButton.disabled = true;
    elements.addButton.disabled = true;
    elements.retryButton.hidden = true;
  }

  function showResult({ status, text }) {
    currentText = text || '';
    elements.retryButton.hidden = status !== 'failed';
    if (status === 'disabled') {
      elements.status.textContent = 'Reading text from images is switched off on this server (OCR_ENABLED=0).';
    } else if (status === 'failed') {
      elements.status.textContent = 'The server could not read this image. Try again, or use a sharper picture.';
    } else if (!currentText) {
      elements.status.textContent = 'No text was found in this image.';
    } else {
      elements.status.textContent = '';
    }
    elements.status.hidden = !elements.status.textContent;
    elements.output.value = currentText;
    elements.output.hidden = !currentText;
    elements.copyButton.disabled = !currentText;
    elements.addButton.disabled = !currentText;
  }

  async function load(id, { retry = false } = {}) {
    setBusy('Reading the text in this image… (a few seconds)');
    try {
      const result = await fetchImageText(id, { retry });
      if (id === currentId) showResult(result);
    } catch (error) {
      if (id === currentId) showResult({ status: 'failed', text: '' });
      elements.status.textContent = error?.message || 'Could not read the image.';
    }
  }

  function open(id, filename) {
    currentId = id;
    elements.title.textContent = filename ? `Text in ${filename}` : 'Text in image';
    showPanel(elements.panel);
    load(id);
  }

  elements.closeButton.addEventListener('click', () => {
    currentId = null;
    hidePanel(elements.panel);
  });
  elements.panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') elements.closeButton.click();
  });
  elements.retryButton.addEventListener('click', () => currentId != null && load(currentId, { retry: true }));
  elements.copyButton.addEventListener('click', async () => {
    const result = await copyPlainText(elements.output.value);
    announce(result.ok ? 'Text copied' : 'Could not copy automatically');
    if (!result.ok) {
      elements.output.focus();
      elements.output.select();
    }
    elements.status.textContent = result.ok ? 'Copied.' : 'Could not copy automatically: the text is selected, copy it by hand.';
    elements.status.hidden = false;
  });
  elements.addButton.addEventListener('click', () => {
    onAddToSharedText(elements.output.value);
    elements.closeButton.click();
    announce('Text added to the shared text');
  });

  return { open };
}
