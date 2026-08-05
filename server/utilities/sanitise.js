import sanitizeHtml from 'sanitize-html';

export const ALLOWED_TAGS = [
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'span', 'div',
];

export const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  span: [],
  div: [],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

/**
 * Server-side sanitisation is authoritative: strips scripts, event handlers, iframes,
 * forms, and anything outside the documented allow-list before content is ever stored.
 */
export function sanitiseHtml(rawHtml) {
  if (typeof rawHtml !== 'string') return '';

  const clean = sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attribs) => {
        const safeAttribs = { rel: 'noopener noreferrer nofollow', target: '_blank' };
        if (attribs.href && ALLOWED_SCHEMES.some((scheme) => attribs.href.toLowerCase().startsWith(`${scheme}:`))) {
          safeAttribs.href = attribs.href;
        }
        return { tagName: 'a', attribs: safeAttribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'a' && !frame.attribs.href,
  });

  return clean.trim();
}

export function extractPlainText(html) {
  const withBreaks = html
    .replace(/<\/(p|div|li|h1|h2|h3|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countCharacters(plainText) {
  return Array.from(plainText).length;
}
