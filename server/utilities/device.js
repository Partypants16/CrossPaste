/**
 * Each browser picks a device name ("Laptop", "Phone") that the page stores in the
 * crosspaste_device cookie, so every request (uploads and the phone's share sheet
 * included) says which device it came from. It's a label, not a login: anyone can
 * type any name, so it is only ever shown, never trusted.
 */
export const DEVICE_COOKIE_NAME = 'crosspaste_device';
export const DEVICE_NAME_MAX_LENGTH = 32;

export function cleanDeviceName(raw) {
  if (typeof raw !== 'string') return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Not URI-encoded: use it as it is.
  }
  const cleaned = Array.from(value.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, DEVICE_NAME_MAX_LENGTH)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function getDeviceName(req) {
  return cleanDeviceName(req.cookies?.[DEVICE_COOKIE_NAME]);
}
