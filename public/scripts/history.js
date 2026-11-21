import * as api from './api.js';
import { copyPlainText } from './clipboard.js';
import { deviceIcon } from './device.js';
import { el, formatRelativeTime, announce, debounce } from './ui.js';

/**
 * The History drawer: every earlier version of the shared text (pinned first), and a
 * search box that also looks through image names, the text read from images, and
 * file names. Opens from the header; on a phone it fills the screen.
 */
const PREVIEW_CHARACTERS = 400;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function metaLine(timestamp, deviceName, extra = []) {
  const parts = [formatRelativeTime(timestamp)];
  if (deviceName) parts.push(`${deviceIcon(deviceName)} ${deviceName}`);
  return el('span', { className: 'history-item__meta' }, [...parts, ...extra].filter(Boolean).join(' · '));
}

function actionButton(label, onClick, { danger = false, pressed = null, title = null } = {}) {
  return el(
    'button',
    {
      type: 'button',
      className: `button button--ghost button--small${danger ? ' button--danger-ghost' : ''}`,
      onClick,
      'aria-pressed': pressed == null ? null : String(pressed),
      title,
    },
    label
  );
}

export function createHistoryDrawer(elements, { onRestored, onShowImageText, describeLimits }) {
  let isOpen = false;
  let query = '';
  let requestCounter = 0;
  let lastFocused = null;

  function setStatus(message) {
    elements.status.textContent = message;
    elements.status.hidden = !message;
  }

  async function copy(text, label) {
    const result = await copyPlainText(text);
    announce(result.ok ? `${label} copied` : 'Could not copy automatically');
    setStatus(result.ok ? `${label} copied.` : 'Could not copy automatically. Select the text and copy it by hand.');
  }

  async function run(action, failureMessage) {
    try {
      await action();
    } catch (error) {
      setStatus(error?.message || failureMessage);
    }
  }

  function renderTextEntry(entry) {
    const preview = entry.contentPlain.length > PREVIEW_CHARACTERS
      ? `${entry.contentPlain.slice(0, PREVIEW_CHARACTERS)}…`
      : entry.contentPlain;
    const badges = [];
    if (entry.pinned) badges.push(el('span', { className: 'badge badge--pin' }, '📌 Pinned'));
    if (entry.isCurrent) badges.push(el('span', { className: 'badge' }, 'Shared now'));

    return el(
      'li',
      { className: `history-item${entry.pinned ? ' history-item--pinned' : ''}` },
      el('p', { className: 'history-item__text' }, preview),
      el('div', { className: 'history-item__footer' },
        el('div', { className: 'history-item__info' }, badges, metaLine(entry.updatedAt, entry.deviceName, [`${entry.characterCount.toLocaleString()} chars`])),
        el('div', { className: 'history-item__actions' },
          entry.isCurrent ? null : actionButton('Use', () => run(async () => {
            const { clipboard } = await api.restoreHistoryEntry(entry.id);
            onRestored(clipboard);
            announce('Text restored');
            setStatus('That text is the shared text again. What it replaced is still here in history.');
          }, 'Could not restore it.'), { title: 'Make this the shared text again' }),
          actionButton('Copy', () => copy(entry.contentPlain, 'Text')),
          actionButton(entry.pinned ? 'Unpin' : 'Pin', () => run(async () => {
            await api.pinHistoryEntry(entry.id, !entry.pinned);
            await refresh();
          }, 'Could not change the pin.'), { pressed: entry.pinned, title: 'Pinned text is never cleaned up' }),
          actionButton('Delete', () => run(async () => {
            await api.deleteHistoryEntry(entry.id);
            await refresh();
          }, 'Could not delete it.'), { danger: true })
        )
      )
    );
  }

  function renderImageResult(image) {
    return el(
      'li',
      { className: 'history-item history-item--media' },
      el('img', { className: 'history-item__thumb', src: api.imageThumbnailUrl(image.id), alt: '', loading: 'lazy' }),
      el('div', { className: 'history-item__body' },
        el('span', { className: 'history-item__name' }, image.originalFilename),
        image.textSnippet ? el('p', { className: 'history-item__snippet' }, `Text in image: “${image.textSnippet}”`) : null,
        metaLine(image.createdAt, image.uploadedBy, [image.pinned ? '📌 Pinned' : null]),
        el('div', { className: 'history-item__actions' },
          actionButton('Show text', () => onShowImageText(image.id, image.originalFilename)),
          actionButton(image.pinned ? 'Unpin' : 'Pin', () => run(async () => {
            await api.pinImage(image.id, !image.pinned);
            await refresh();
          }, 'Could not change the pin.'), { pressed: image.pinned })
        )
      )
    );
  }

  function renderFileResult(file) {
    return el(
      'li',
      { className: 'history-item history-item--media' },
      el('span', { className: 'file-card__icon', 'aria-hidden': 'true' }, (file.originalFilename.split('.').pop() || 'FILE').slice(0, 5).toUpperCase()),
      el('div', { className: 'history-item__body' },
        el('span', { className: 'history-item__name' }, file.originalFilename),
        metaLine(file.createdAt, file.uploadedBy, [formatBytes(file.sizeBytes), file.pinned ? '📌 Pinned' : null]),
        el('div', { className: 'history-item__actions' },
          el('a', { className: 'button button--ghost button--small', href: api.fileDownloadUrl(file.id), download: file.originalFilename }, 'Download'),
          actionButton(file.pinned ? 'Unpin' : 'Pin', () => run(async () => {
            await api.pinFile(file.id, !file.pinned);
            await refresh();
          }, 'Could not change the pin.'), { pressed: file.pinned })
        )
      )
    );
  }

  function section(title, items) {
    return el('section', { className: 'history-section' }, el('h3', { className: 'history-section__title' }, title), el('ul', { className: 'history-list' }, items));
  }

  async function refresh() {
    if (!isOpen) return;
    const myRequest = ++requestCounter;
    try {
      if (!query) {
        const { items, total } = await api.fetchHistory({ limit: 200 });
        if (myRequest !== requestCounter) return;
        elements.results.replaceChildren(
          items.length
            ? section(`Text (${total.toLocaleString()})`, items.map(renderTextEntry))
            : el('p', { className: 'history-empty' }, 'Nothing yet. Every text you share is kept here, so you can bring it back later.')
        );
        elements.clearButton.disabled = !items.some((item) => !item.pinned);
      } else {
        const result = await api.search(query);
        if (myRequest !== requestCounter) return;
        const sections = [];
        if (result.history.length) sections.push(section(`Text (${result.historyTotal ?? result.history.length})`, result.history.map(renderTextEntry)));
        if (result.images.length) sections.push(section(`Images (${result.images.length})`, result.images.map(renderImageResult)));
        if (result.files.length) sections.push(section(`Files (${result.files.length})`, result.files.map(renderFileResult)));
        elements.results.replaceChildren(
          ...(sections.length ? sections : [el('p', { className: 'history-empty' }, `Nothing matches “${query}”.`)])
        );
      }
      elements.limits.textContent = describeLimits();
    } catch (error) {
      if (myRequest !== requestCounter) return;
      elements.results.replaceChildren(el('p', { className: 'history-empty' }, error?.message || 'Could not load history.'));
    }
  }

  const refreshSoon = debounce(refresh, 400);

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocused = document.activeElement;
    elements.drawer.hidden = false;
    elements.overlay.hidden = false;
    elements.toggleButton.setAttribute('aria-expanded', 'true');
    document.body.classList.add('has-drawer-open');
    setStatus('');
    elements.searchInput.focus();
    refresh();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    elements.drawer.hidden = true;
    elements.overlay.hidden = true;
    elements.toggleButton.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('has-drawer-open');
    lastFocused?.focus?.();
  }

  elements.toggleButton.addEventListener('click', () => (isOpen ? close() : open()));
  elements.closeButton.addEventListener('click', close);
  elements.overlay.addEventListener('click', close);
  elements.drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  elements.searchInput.addEventListener('input', () => {
    query = elements.searchInput.value.trim();
    refreshSoon();
  });
  // Two taps: the first only arms the button, so one stray tap can't wipe history.
  let clearArmedTimer = null;
  const clearLabel = elements.clearButton.textContent;
  elements.clearButton.addEventListener('click', () => run(async () => {
    if (!clearArmedTimer) {
      elements.clearButton.textContent = 'Tap again to clear';
      elements.clearButton.classList.add('is-armed');
      clearArmedTimer = setTimeout(() => {
        clearArmedTimer = null;
        elements.clearButton.textContent = clearLabel;
        elements.clearButton.classList.remove('is-armed');
      }, 4000);
      return;
    }
    clearTimeout(clearArmedTimer);
    clearArmedTimer = null;
    elements.clearButton.textContent = clearLabel;
    elements.clearButton.classList.remove('is-armed');
    const { removed } = await api.clearUnpinnedHistory();
    setStatus(`Removed ${removed} unpinned ${removed === 1 ? 'entry' : 'entries'}. Pinned ones were kept.`);
    await refresh();
  }, 'Could not clear history.'));

  return {
    open,
    close,
    isOpen: () => isOpen,
    refreshSoon,
    openWithQuery(text) {
      elements.searchInput.value = text;
      query = text.trim();
      open();
      refresh();
    },
  };
}
