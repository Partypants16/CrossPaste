import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

const tempDir = await setupTestEnvironment({ TEXT_CHARACTER_LIMIT: 1000 });

const { openDatabase, closeDatabase } = await import('../server/database.js');
const {
  getClipboardState,
  saveClipboard,
  clearClipboard,
  TextTooLargeError,
  RevisionConflictError,
} = await import('../server/services/clipboard-service.js');

test.before(async () => {
  await openDatabase();
});

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

test('a fresh database starts with an empty revision-0 clipboard', () => {
  const state = getClipboardState();
  assert.equal(state.revision, 0);
  assert.equal(state.contentHtml, '');
  assert.equal(state.characterCount, 0);
});

test('saveClipboard stores sanitised content and increments the revision', () => {
  const result = saveClipboard({ html: '<p>Hello <script>bad()</script>world</p>', baseRevision: 0 });
  assert.equal(result.revision, 1);
  assert.doesNotMatch(result.contentHtml, /script/i);
  assert.equal(result.contentPlain, 'Hello world');
  assert.equal(result.characterCount, 11);
});

test('saveClipboard rejects a stale baseRevision with RevisionConflictError', () => {
  const staleRevision = getClipboardState().revision;
  saveClipboard({ html: '<p>first</p>', baseRevision: staleRevision });
  assert.throws(
    () => saveClipboard({ html: '<p>stale write</p>', baseRevision: staleRevision }),
    RevisionConflictError
  );
});

test('saveClipboard with force=true overwrites regardless of baseRevision', () => {
  const before = getClipboardState();
  const result = saveClipboard({ html: '<p>forced</p>', baseRevision: 0, force: true });
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.contentPlain, 'forced');
});

test('saveClipboard rejects text over the configured character limit', () => {
  const longText = 'a'.repeat(1100);
  assert.throws(() => saveClipboard({ html: `<p>${longText}</p>`, baseRevision: 0, force: true }), TextTooLargeError);
});

test('clearClipboard empties the content and bumps the revision', () => {
  saveClipboard({ html: '<p>content</p>', baseRevision: 0, force: true });
  const before = getClipboardState();
  const cleared = clearClipboard();
  assert.equal(cleared.contentHtml, '');
  assert.equal(cleared.characterCount, 0);
  assert.equal(cleared.revision, before.revision + 1);
});
