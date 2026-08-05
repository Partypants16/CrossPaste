/**
 * Dedicated Paste/Copy buttons use the async Clipboard API, which browsers restrict to
 * secure contexts and direct user gestures. Failures here are expected on plain HTTP —
 * callers fall back to native Ctrl+V/Ctrl+C instead of treating this as a real error.
 */
export async function readClipboardIntoEditor(editor) {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      editor.insertSanitisedHtml(escapeToHtml(text));
      return { ok: true };
    }
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html');
        editor.insertSanitisedHtml(await blob.text());
        return { ok: true };
      }
    }
    for (const item of items) {
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        editor.insertSanitisedHtml(escapeToHtml(await blob.text()));
        return { ok: true };
      }
    }
    return { ok: false, reason: 'empty' };
  } catch (error) {
    return { ok: false, reason: error.name === 'NotAllowedError' ? 'denied' : 'failed' };
  }
}

function escapeToHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

export async function copyEditorContent(html, plainText) {
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return { ok: true, mode: 'rich' };
    } catch {
      // Fall through to plain-text copying below.
    }
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      return { ok: true, mode: 'plain' };
    } catch {
      return { ok: false, reason: 'failed' };
    }
  }

  return { ok: false, reason: 'unsupported' };
}

export async function copyImageBlob(blob) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.name === 'NotAllowedError' ? 'denied' : 'failed' };
  }
}

async function convertToPng(blob) {
  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Conversion failed'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = url;
  });
}
