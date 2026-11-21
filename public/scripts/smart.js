/**
 * Spots links and colours in the shared text so they can be acted on directly:
 * links get an Open button (one tap on a phone) and a QR code; colours get a swatch
 * and copy buttons in the common formats.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const HEX_PATTERN = /(^|[^\w&/#])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![\w-])/gi;
const FUNCTION_PATTERN = /\b(?:rgba?|hsla?)\(\s*[-\d.%\s,/]+\)/gi;
const MAX_LINKS = 5;
const MAX_COLOURS = 4;

function trimTrailingPunctuation(url) {
  let result = url.replace(/[.,;:!?'"]+$/, '');
  // Keep a closing bracket only when the link opened one, e.g. a Wikipedia link in a sentence.
  while (/[)\]]$/.test(result)) {
    const closer = result.at(-1);
    const opener = closer === ')' ? '(' : '[';
    const opens = result.split(opener).length - 1;
    const closes = result.split(closer).length - 1;
    if (closes <= opens) break;
    result = result.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  }
  return result;
}

export function findLinks(text) {
  const links = [];
  for (const match of String(text || '').matchAll(URL_PATTERN)) {
    const url = trimTrailingPunctuation(match[0]);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    } catch {
      continue;
    }
    if (!links.includes(url)) links.push(url);
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

/** True when the whole text is one link (then the QR button shows the link itself). */
export function singleLink(text) {
  const trimmed = String(text || '').trim();
  const links = findLinks(trimmed);
  return links.length === 1 && trimmed === links[0] ? links[0] : null;
}

export function shortLinkLabel(url, maxLength = 48) {
  try {
    const parsed = new URL(url);
    const label = `${parsed.host.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
  } catch {
    return url;
  }
}

function isValidColour(value) {
  return typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('color', value) : true;
}

/**
 * Colour values in the text. Short hex like "#123" is only taken when it's all the
 * text holds, since "#123" in a sentence is usually an issue or order number.
 */
export function findColours(text) {
  const source = String(text || '');
  const withoutLinks = source.replace(URL_PATTERN, ' ');
  const trimmed = source.trim();
  const found = [];

  for (const match of withoutLinks.matchAll(HEX_PATTERN)) {
    const value = match[2];
    const digits = value.length - 1;
    if ((digits === 3 || digits === 4) && trimmed !== value) continue;
    found.push(value);
  }
  for (const match of withoutLinks.matchAll(FUNCTION_PATTERN)) found.push(match[0].replace(/\s+/g, ' '));

  const unique = [];
  for (const value of found) {
    if (!isValidColour(value)) continue;
    if (!unique.some((existing) => existing.toLowerCase() === value.toLowerCase())) unique.push(value);
    if (unique.length >= MAX_COLOURS) break;
  }
  return unique;
}

/** { hex: '#ff8800', rgb: 'rgb(255, 136, 0)' } for any CSS colour the browser understands. */
export function colourFormats(value) {
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.hidden = true;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = computed.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
  const [r, g, b, alpha = 1] = parts;
  const hexPart = (number) => Math.round(number).toString(16).padStart(2, '0');
  const hex = `#${hexPart(r)}${hexPart(g)}${hexPart(b)}${alpha < 1 ? hexPart(alpha * 255) : ''}`;
  const rgb = alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
  return { hex, rgb, css: computed };
}
