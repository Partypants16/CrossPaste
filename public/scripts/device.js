/**
 * The name this browser goes by ("Laptop", "Phone"), shown next to everything it
 * shares. Kept in a cookie so the server sees it on every request, uploads and the
 * share menu included, with a localStorage copy in case the cookie is cleared.
 */
const STORAGE_KEY = 'crosspaste:device-name';
const COOKIE_NAME = 'crosspaste_device';
const MAX_LENGTH = 32;
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

function readCookie() {
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) || null;
  } catch {
    return null;
  }
}

function readStorage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeCookie(name) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(name)}; Path=/; Max-Age=${TEN_YEARS_SECONDS}; SameSite=Lax${secure}`;
}

export function cleanName(raw) {
  return Array.from(String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_LENGTH)
    .join('')
    .trim();
}

/** A first guess from the browser, until the person names the device themselves. */
export function guessDeviceName(userAgent = navigator.userAgent) {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/CrOS/i.test(userAgent)) return 'Chromebook';
  if (/Linux/i.test(userAgent)) return 'Linux PC';
  return 'This device';
}

let currentName = null;
let chosenByPerson = false;

export function initDeviceName() {
  const saved = cleanName(readCookie() || readStorage());
  chosenByPerson = Boolean(saved);
  currentName = saved || guessDeviceName();
  writeCookie(currentName);
  return currentName;
}

export function getDeviceName() {
  return currentName ?? initDeviceName();
}

export function wasNamedByPerson() {
  return chosenByPerson;
}

export function setDeviceName(raw) {
  const name = cleanName(raw);
  if (!name) return null;
  currentName = name;
  chosenByPerson = true;
  writeCookie(name);
  try {
    window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // The cookie alone is enough.
  }
  return name;
}

export function deviceIcon(name) {
  return /phone|android|pixel|galaxy|mobile/i.test(name || '') ? '📱' : /ipad|tablet/i.test(name || '') ? '📲' : '💻';
}
