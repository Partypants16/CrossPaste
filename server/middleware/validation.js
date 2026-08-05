export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function assertOnlyKeys(body, allowedKeys) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const unexpected = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new ValidationError(`Unexpected field(s): ${unexpected.join(', ')}`);
  }
}

export function validateClipboardPayload(body) {
  assertOnlyKeys(body, ['html', 'baseRevision']);
  if (typeof body.html !== 'string') {
    throw new ValidationError('"html" must be a string');
  }
  if (!Number.isInteger(body.baseRevision) || body.baseRevision < 0) {
    throw new ValidationError('"baseRevision" must be a non-negative integer');
  }
  return { html: body.html, baseRevision: body.baseRevision };
}

export function validateForceClipboardPayload(body) {
  assertOnlyKeys(body, ['html']);
  if (typeof body.html !== 'string') {
    throw new ValidationError('"html" must be a string');
  }
  return { html: body.html };
}
