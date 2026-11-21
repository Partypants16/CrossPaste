import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnvironment, teardownTestEnvironment } from './helpers/test-env.js';

const tempDir = await setupTestEnvironment({ HISTORY_MAX_ITEMS: 3, HISTORY_MAX_DAYS: 30, HISTORY_MERGE_SECONDS: 120 });

const { openDatabase, closeDatabase, getDatabase } = await import('../server/database.js');
const { saveClipboard, clearClipboard, getClipboardState } = await import('../server/services/clipboard-service.js');
const history = await import('../server/services/history-service.js');

test.before(async () => {
  await openDatabase();
});

test.after(async () => {
  closeDatabase();
  await teardownTestEnvironment(tempDir);
});

function save(html, deviceName = 'Laptop') {
  return saveClipboard({ html, baseRevision: null, force: true, deviceName });
}

function resetHistory() {
  const db = getDatabase();
  db.prepare('DELETE FROM history').run();
  db.prepare('UPDATE clipboard SET history_id = NULL WHERE id = 1').run();
}

test('looksLikeEdit tells typing apart from pasting something new', () => {
  assert.equal(history.looksLikeEdit('Hello', 'Hello world'), true);
  assert.equal(history.looksLikeEdit('Shopping: milk, eggs', 'Shopping: milk, bread, eggs'), true);
  assert.equal(history.looksLikeEdit('Hello world', 'https://example.com/totally-different'), false);
  assert.equal(history.looksLikeEdit('', 'anything'), false);
});

test('autosaves while typing update one history entry', () => {
  resetHistory();
  save('<p>Hel</p>');
  save('<p>Hello</p>');
  save('<p>Hello there</p>');
  const { items, total } = history.listHistory();
  assert.equal(total, 1);
  assert.equal(items[0].contentPlain, 'Hello there');
  assert.equal(items[0].deviceName, 'Laptop');
  assert.equal(items[0].isCurrent, true);
});

test('pasting different text, or saving from another device, starts a new entry', () => {
  resetHistory();
  save('<p>First note</p>');
  save('<p>https://example.com/something-else-entirely</p>');
  save('<p>https://example.com/something-else-entirely and more</p>', 'Phone');
  const { items } = history.listHistory();
  assert.deepEqual(
    items.map((item) => item.contentPlain),
    ['https://example.com/something-else-entirely and more', 'https://example.com/something-else-entirely', 'First note']
  );
  assert.equal(items[0].deviceName, 'Phone');
});

test('clearing keeps the old text in history and the next text is a new entry', () => {
  resetHistory();
  save('<p>Keep me</p>');
  clearClipboard({ deviceName: 'Laptop' });
  assert.equal(getClipboardState().contentPlain, '');
  save('<p>Keep me too</p>');
  const { items } = history.listHistory();
  assert.deepEqual(items.map((item) => item.contentPlain), ['Keep me too', 'Keep me']);
});

test('saving text that is already in history moves it to the top instead of duplicating it', () => {
  resetHistory();
  save('<p>Alpha text</p>');
  clearClipboard();
  save('<p>Bravo text that is different</p>');
  clearClipboard();
  save('<p>Alpha text</p>');
  const { items, total } = history.listHistory();
  assert.equal(total, 2);
  assert.equal(items[0].contentPlain, 'Alpha text');
});

test('a pinned entry is never changed by later edits', () => {
  resetHistory();
  const saved = save('<p>Wi-Fi password note</p>');
  const entryId = getDatabase().prepare('SELECT history_id FROM clipboard WHERE id = 1').get().history_id;
  history.setHistoryPinned(entryId, true);
  save('<p>Wi-Fi password note, edited</p>');
  assert.ok(saved.revision > 0);
  assert.equal(history.getHistoryEntry(entryId).contentPlain, 'Wi-Fi password note');
  assert.equal(history.listHistory().total, 2);
  assert.equal(history.listHistory().items[0].pinned, true, 'pinned entries are listed first');
});

test('search matches the plain text, case-insensitively, with LIKE characters taken literally', () => {
  resetHistory();
  save('<p>Invoice 100% paid</p>');
  clearClipboard();
  save('<p>Grocery list</p>');
  assert.deepEqual(history.listHistory({ query: 'INVOICE' }).items.map((item) => item.contentPlain), ['Invoice 100% paid']);
  assert.equal(history.listHistory({ query: '100%' }).total, 1);
  assert.equal(history.listHistory({ query: '_' }).total, 0);
});

test('trimHistory keeps pinned entries and the newest unpinned ones', () => {
  resetHistory();
  const db = getDatabase();
  for (let index = 1; index <= 5; index += 1) {
    save(`<p>Entry number ${index} with its own words ${'x'.repeat(index * 7)}</p>`);
    clearClipboard();
  }
  const oldest = history.listHistory({ limit: 10 }).items.at(-1);
  history.setHistoryPinned(oldest.id, true);

  const removed = history.trimHistory();
  assert.equal(removed, 1, 'four unpinned entries, limit three');
  const remaining = history.listHistory({ limit: 10 }).items;
  assert.equal(remaining.length, 4);
  assert.ok(remaining.some((item) => item.id === oldest.id));

  // Entries older than HISTORY_MAX_DAYS go too.
  db.prepare("UPDATE history SET updated_at = '2000-01-01T00:00:00.000Z' WHERE pinned = 0").run();
  history.trimHistory();
  assert.deepEqual(history.listHistory({ limit: 10 }).items.map((item) => item.id), [oldest.id]);
});

test('clearUnpinnedHistory and deleteHistoryEntry', () => {
  resetHistory();
  save('<p>Pinned one</p>');
  const pinnedId = history.listHistory().items[0].id;
  history.setHistoryPinned(pinnedId, true);
  clearClipboard();
  save('<p>Unpinned one</p>');
  assert.equal(history.clearUnpinnedHistory(), 1);
  assert.equal(getDatabase().prepare('SELECT history_id FROM clipboard WHERE id = 1').get().history_id, null);
  history.deleteHistoryEntry(pinnedId);
  assert.equal(history.listHistory().total, 0);
  assert.throws(() => history.deleteHistoryEntry(pinnedId), history.HistoryNotFoundError);
});
