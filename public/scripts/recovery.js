const STORAGE_KEY = 'crosspaste:unsaved-recovery';

function isStorageAvailable() {
  try {
    const testKey = `${STORAGE_KEY}:test`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const storageAvailable = isStorageAvailable();

export function saveLocalRecovery({ contentHtml, contentPlain, lastKnownServerRevision }) {
  if (!storageAvailable) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        contentHtml,
        contentPlain,
        localUpdatedAt: new Date().toISOString(),
        lastKnownServerRevision,
      })
    );
  } catch {
    // Storage full or unavailable: unsaved recovery is best-effort only.
  }
}

export function loadLocalRecovery() {
  if (!storageAvailable) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearLocalRecovery() {
  if (!storageAvailable) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore: nothing to clean up if storage is unavailable.
  }
}

export function isRecoveryStorageAvailable() {
  return storageAvailable;
}
