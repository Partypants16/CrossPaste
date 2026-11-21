import qrcode from '/vendor/qrcode.mjs';
import { showPanel, hidePanel } from './ui.js';

// The library encodes each character as one byte; this makes it UTF-8 so any text works.
qrcode.stringToBytes = (text) => Array.from(new TextEncoder().encode(text));

/** About the most a QR code holds and a phone camera still reads easily. */
export const QR_MAX_BYTES = 1200;

export function qrByteLength(text) {
  return new TextEncoder().encode(text).length;
}

/** A data: URL of the QR code image, or null if the text is too long for one. */
export function makeQrDataUrl(text) {
  if (!text || qrByteLength(text) > QR_MAX_BYTES) return null;
  for (const level of ['M', 'L']) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text, 'Byte');
      qr.make();
      const cellSize = Math.max(3, Math.floor(300 / qr.getModuleCount()));
      return qr.createDataURL(cellSize, cellSize * 4);
    } catch {
      // Too long at this error-correction level: try the next one.
    }
  }
  return null;
}

export function createQrDialog(elements) {
  let lastText = '';

  function render(text, title) {
    lastText = text;
    elements.title.textContent = title;
    const dataUrl = makeQrDataUrl(text);
    if (dataUrl) {
      elements.image.src = dataUrl;
      elements.image.hidden = false;
      elements.message.hidden = true;
    } else {
      elements.image.hidden = true;
      elements.image.removeAttribute('src');
      elements.message.hidden = false;
      elements.message.textContent = `This text is too long for a QR code (${qrByteLength(text).toLocaleString()} bytes; about ${QR_MAX_BYTES.toLocaleString()} fit). Open CrossPaste on the other device instead: scan this page's QR code.`;
    }
    elements.caption.textContent = text.length > 160 ? `${text.slice(0, 159)}…` : text;
    elements.pageButton.hidden = text === window.location.origin + '/';
  }

  function open(text, title = 'Scan with your phone') {
    render(text, title);
    showPanel(elements.panel);
  }

  elements.closeButton.addEventListener('click', () => hidePanel(elements.panel));
  elements.pageButton.addEventListener('click', () => render(`${window.location.origin}/`, 'Open CrossPaste on another device'));
  elements.panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePanel(elements.panel);
  });

  return { open, getLastText: () => lastText };
}
