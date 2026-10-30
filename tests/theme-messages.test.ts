import { afterEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { THEME_MESSAGES_ATTRIBUTE, USER_CSS_ID, themedMessageStyles, watchThemeMessages } from '../src/theme-messages';

let dom: JSDOM | undefined;
afterEach(() => { dom?.window.close(); dom = undefined; });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('only themes that design a message style count; Janiverse’s own text rules do not', () => {
  expect(themedMessageStyles('[data-component="BubbleMessage"] [class*="_header_"] { min-height: 180px; }')).toEqual(['bubble']);
  expect(themedMessageStyles('[data-component="MinimalMessage"] {} [data-component="BubbleMessage"] {}')).toEqual(['bubble', 'minimal']);
  expect(themedMessageStyles('/* Janiverse appearance */ [data-component="MessageContent"][data-component] { font-size: 16px !important; }')).toEqual([]);
});

test('the attribute follows the custom CSS as the theme is applied, changed and removed', async () => {
  dom = new JSDOM('<!doctype html><html data-jb-theme-messages="old"><head></head><body></body></html>');
  const doc = dom.window.document, root = doc.documentElement;
  const stop = watchThemeMessages(doc);
  expect(root.hasAttribute(THEME_MESSAGES_ATTRIBUTE)).toBe(false);

  const style = doc.createElement('style'); style.id = USER_CSS_ID; style.textContent = '[data-component="BubbleMessage"] { color: red; }';
  doc.head.append(style); await settle();
  expect(root.getAttribute(THEME_MESSAGES_ATTRIBUTE)).toBe('bubble');

  style.textContent = '[data-component="MinimalMessage"] {}'; await settle();
  expect(root.getAttribute(THEME_MESSAGES_ATTRIBUTE)).toBe('minimal');

  style.textContent = ''; await settle();
  expect(root.hasAttribute(THEME_MESSAGES_ATTRIBUTE)).toBe(false);

  stop();
  expect(root.getAttribute(THEME_MESSAGES_ATTRIBUTE)).toBe('old');
});

test('every message layout rule steps aside for a theme that styles that message style', () => {
  const css = readFileSync(`${import.meta.dir}/../src/layout.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}@;]+)\{[^{}]*\}/g)].flatMap(match => match[1].split(',').map(part => part.trim()));
  for (const selector of selectors) {
    if (/BubbleMessage|BubbleActions/.test(selector)) expect(selector.startsWith('html:not([data-jb-theme-messages~="bubble"])')).toBe(true);
    if (/MinimalMessage/.test(selector)) expect(selector.startsWith('html:not([data-jb-theme-messages~="minimal"])')).toBe(true);
    if (/SwipeControls/.test(selector)) expect(selector.startsWith('html:not([data-jb-theme-messages~=')).toBe(true);
  }
});
