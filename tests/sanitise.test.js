import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitiseHtml, extractPlainText, countCharacters } from '../server/utilities/sanitise.js';

test('sanitiseHtml removes script elements', () => {
  const result = sanitiseHtml('<p>Hello</p><script>alert(1)</script>');
  assert.doesNotMatch(result, /script/i);
  assert.match(result, /Hello/);
});

test('sanitiseHtml removes inline event handler attributes', () => {
  const result = sanitiseHtml('<p onclick="alert(1)">Hi</p>');
  assert.doesNotMatch(result, /onclick/i);
});

test('sanitiseHtml removes iframes, forms, and objects', () => {
  const result = sanitiseHtml('<iframe src="https://example.com"></iframe><form><input></form><object data="x"></object>');
  assert.doesNotMatch(result, /iframe/i);
  assert.doesNotMatch(result, /<form/i);
  assert.doesNotMatch(result, /<object/i);
});

test('sanitiseHtml strips javascript: URLs from links', () => {
  const result = sanitiseHtml('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(result, /javascript:/i);
});

test('sanitiseHtml keeps safe formatting tags', () => {
  const result = sanitiseHtml('<p><strong>Bold</strong> and <em>italic</em></p><ul><li>item</li></ul>');
  assert.match(result, /<strong>Bold<\/strong>/);
  assert.match(result, /<em>italic<\/em>/);
  assert.match(result, /<li>item<\/li>/);
});

test('sanitiseHtml allows a safe http link with target and rel', () => {
  const result = sanitiseHtml('<a href="https://example.com">link</a>');
  assert.match(result, /href="https:\/\/example\.com"/);
  assert.match(result, /rel="noopener noreferrer nofollow"/);
});

test('extractPlainText converts block breaks to newlines and strips tags', () => {
  const plain = extractPlainText('<p>Line one</p><p>Line two</p>');
  assert.equal(plain, 'Line one\nLine two');
});

test('countCharacters counts unicode code points, not UTF-16 code units', () => {
  assert.equal(countCharacters('abc'), 3);
  assert.equal(countCharacters('👍👍'), 2);
});
