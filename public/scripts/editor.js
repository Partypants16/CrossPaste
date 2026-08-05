import { sanitiseHtmlForEditor } from './sanitize.js';

const HEADING_TAG = 'H2';

export function createEditor(editorEl, { onChange }) {
  function notifyChange() {
    onChange();
  }

  function insertSanitisedHtml(rawHtml) {
    const clean = sanitiseHtmlForEditor(rawHtml);
    if (!clean) return;
    editorEl.focus();
    document.execCommand('insertHTML', false, clean);
    notifyChange();
  }

  function insertPlainText(text) {
    editorEl.focus();
    document.execCommand('insertText', false, text);
    notifyChange();
  }

  function handlePaste(event) {
    event.preventDefault();
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData('text/html');
    if (html) {
      insertSanitisedHtml(html);
      return;
    }

    const text = clipboardData.getData('text/plain');
    if (text) {
      insertPlainText(text);
    }
  }

  function toggleHeading() {
    const currentBlock = document.queryCommandValue('formatBlock');
    if (currentBlock?.toLowerCase() === HEADING_TAG.toLowerCase()) {
      document.execCommand('formatBlock', false, 'p');
    } else {
      document.execCommand('formatBlock', false, HEADING_TAG);
    }
    notifyChange();
  }

  function insertLink() {
    const url = window.prompt('Enter a link URL (https://…):');
    if (!url) return;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed) && !/^mailto:/i.test(trimmed)) {
      window.alert('Links must start with http://, https://, or mailto:.');
      return;
    }
    document.execCommand('createLink', false, trimmed);
    notifyChange();
  }

  function execToolbarCommand(command) {
    editorEl.focus();
    switch (command) {
      case 'heading':
        toggleHeading();
        return;
      case 'createLink':
        insertLink();
        return;
      default:
        document.execCommand(command, false, null);
        notifyChange();
    }
  }

  function getHtml() {
    return editorEl.innerHTML;
  }

  function setHtml(html) {
    editorEl.innerHTML = sanitiseHtmlForEditor(html || '');
  }

  function getPlainText() {
    return editorEl.textContent || '';
  }

  function isEmpty() {
    return getPlainText().trim().length === 0;
  }

  function clear() {
    editorEl.innerHTML = '';
    notifyChange();
  }

  function focus() {
    editorEl.focus();
  }

  function queryActiveCommands() {
    return {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikeThrough: document.queryCommandState('strikeThrough'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      heading: document.queryCommandValue('formatBlock')?.toLowerCase() === HEADING_TAG.toLowerCase(),
    };
  }

  editorEl.addEventListener('paste', handlePaste);
  editorEl.addEventListener('input', notifyChange);

  function destroy() {
    editorEl.removeEventListener('paste', handlePaste);
    editorEl.removeEventListener('input', notifyChange);
  }

  return {
    getHtml,
    setHtml,
    getPlainText,
    isEmpty,
    clear,
    focus,
    execToolbarCommand,
    insertSanitisedHtml,
    queryActiveCommands,
    destroy,
  };
}
