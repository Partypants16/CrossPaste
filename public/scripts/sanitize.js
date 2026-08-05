const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'CODE', 'PRE', 'SPAN', 'DIV',
]);

const ALLOWED_ATTRIBUTES = {
  A: ['href', 'title'],
};

const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'mailto:'];

function isSafeUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ALLOWED_URL_SCHEMES.includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitiseNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  if (!ALLOWED_TAGS.has(node.tagName)) {
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      const cleanChild = sanitiseNode(child);
      if (cleanChild) fragment.appendChild(cleanChild);
    }
    return fragment;
  }

  const clone = document.createElement(node.tagName);
  const allowedAttrs = ALLOWED_ATTRIBUTES[node.tagName] || [];
  for (const attrName of allowedAttrs) {
    const value = node.getAttribute(attrName);
    if (!value) continue;
    if (attrName === 'href' && !isSafeUrl(value)) continue;
    clone.setAttribute(attrName, value);
  }
  if (node.tagName === 'A') {
    clone.setAttribute('rel', 'noopener noreferrer nofollow');
    clone.setAttribute('target', '_blank');
  }

  for (const child of Array.from(node.childNodes)) {
    const cleanChild = sanitiseNode(child);
    if (cleanChild) clone.appendChild(cleanChild);
  }

  return clone;
}

/**
 * Client-side sanitisation is defense-in-depth only; the server re-sanitises with the
 * same allow-list before anything is stored, so this never needs to be perfectly strict.
 */
export function sanitiseHtmlForEditor(rawHtml) {
  const template = document.createElement('template');
  template.innerHTML = rawHtml;

  const container = document.createDocumentFragment();
  for (const child of Array.from(template.content.childNodes)) {
    const cleanChild = sanitiseNode(child);
    if (cleanChild) container.appendChild(cleanChild);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(container);
  return wrapper.innerHTML;
}

export function extractPlainText(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return (wrapper.textContent || '').trim();
}
