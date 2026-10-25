import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createLunchPicks } from '../src/lunch-picks';

let dom: JSDOM, oldDocument: Document;
beforeEach(() => {
  oldDocument = globalThis.document;
  dom = new JSDOM('<!doctype html><html><body></body></html>'); globalThis.document = dom.window.document;
});
afterEach(() => { dom.window.close(); globalThis.document = oldDocument; });

test('an empty curated list shows an honest empty state without invented recommendations', () => {
  const root = createLunchPicks([]);
  expect(root.querySelector('.jb-lunch-picks-empty')!.textContent).toBe('Lunch’s recommendations are coming soon.');
  expect(root.querySelector('.jb-lunch-pick,a')).toBeNull();
});

test('authored names and notes stay literal text and outbound destinations stay ordinary links', () => {
  const name = 'Fixture <img src=x onerror=alert(1)>';
  const note = 'A fixture note, including <script>alert(1)</script> and **literal formatting**.';
  const root = createLunchPicks([{ name, note, url: 'https://github.com/example/fixture-extension?ref=lunch#readme' }]);
  expect(root.querySelector('h3')!.textContent).toBe(name);
  expect(root.querySelector('p')!.textContent).toBe(note);
  const link = root.querySelector('a')!;
  expect([link.textContent, link.href, link.target, link.rel, link.referrerPolicy]).toEqual([
    'View extension', 'https://github.com/example/fixture-extension?ref=lunch#readme', '_blank', 'noopener noreferrer', 'no-referrer',
  ]);
  expect(root.querySelector('script,img,iframe,button,link')).toBeNull();
});

test('only absolute HTTPS destinations without embedded credentials become recommendations', () => {
  const unsafe = ['javascript:alert(1)', 'data:text/html,bad', 'http://example.com/extension', '/relative', 'not a URL', 'https://user:secret@example.com/extension', 'https://user@example.com/extension'];
  const root = createLunchPicks([
    ...unsafe.map(url => ({ name: 'Invalid fixture', note: 'Not a published pick', url })),
    { name: 'Valid fixture', note: 'A test recommendation', url: 'https://example.com/extension' },
  ]);
  expect([...root.querySelectorAll('a')].map(link => link.href)).toEqual(['https://example.com/extension']);
  expect(root.querySelectorAll('.jb-lunch-pick')).toHaveLength(1);
  expect(root.textContent).not.toContain('Invalid fixture');
  expect(createLunchPicks(unsafe.map(url => ({ name: 'Invalid fixture', note: '', url }))).querySelector('.jb-lunch-picks-empty')).not.toBeNull();
});
