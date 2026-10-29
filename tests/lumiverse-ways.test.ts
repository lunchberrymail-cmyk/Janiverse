import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { LEARNED_KEY, lumiverseWays, mountLumiverseWay, openLumiverseWays } from '../src/lumiverse-ways';
import { featureTutorials } from '../src/feature-tutorials';

const original = { document: globalThis.document };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let dom: JSDOM, ctx: any, stored: Record<string, unknown>, shown: string[];
function button(text: string, root: ParentNode = document) { return [...root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!; }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }); globalThis.document = dom.window.document; stored = {}; shown = [];
  ctx = {
    settings: { get: async (key: string) => stored[key], set: async (key: string, value: unknown) => { stored[key] = value; } },
    ui: { showModal() {
      const node = document.createElement('section'); document.body.append(node); const listeners = new Set<() => void>(); let closed = false;
      return { root: node, onDismiss(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }, dismiss() { if (closed) return; closed = true; listeners.forEach(fn => fn()); node.remove(); } };
    } },
  };
});
afterEach(() => { dom.window.close(); globalThis.document = original.document; });

test('Chat Memory’s note names Author’s Note and its guide closes the Janiverse window first', async () => {
  const target = document.createElement('div'); let closed = 0;
  mountLumiverseWay(target, 'memory', { show: way => { shown.push(way.id); } }, () => { closed++; });
  expect(target.textContent).toContain('Leaving Janiverse later? In Lumiverse this is Author’s Note.');
  expect(target.textContent).toContain('Tools (wrench) → Author’s Note');
  button('Show me how', target).click(); await settle();
  expect(closed).toBe(1); expect(shown).toEqual(['memory']);
});

test('an unavailable shortcut says where to look instead', async () => {
  const target = document.createElement('div');
  mountLumiverseWay(target, 'persona', { show: () => false });
  button('Show me where', target).click(); await settle();
  expect(target.querySelector('[role=status]')!.textContent).toBe('This shortcut is unavailable. Personas in the sidebar.');
});

test('the list remembers what was learned and shows how to leave once everything is ticked', async () => {
  stored[LEARNED_KEY] = ['memory', 'retired-id'];
  openLumiverseWays(ctx, { show: way => { shown.push(way.id); } }); await settle();
  const root = document.querySelector('.jb-lumiverse-ways')!;
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  expect(boxes).toHaveLength(lumiverseWays.length);
  expect(root.textContent).toContain(`1 of ${lumiverseWays.length} learned`);
  expect(root.querySelector<HTMLElement>('.jb-lumiverse-ways-done')!.hidden).toBe(true);
  for (const box of boxes.filter(box => !box.checked)) { box.checked = true; box.dispatchEvent(new dom.window.Event('change')); }
  await settle();
  expect(stored[LEARNED_KEY]).toHaveLength(lumiverseWays.length);
  expect(root.querySelector<HTMLElement>('.jb-lumiverse-ways-done')!.hidden).toBe(false);
  expect(root.textContent).toContain('switch Janiverse off');
  button('Show me how', root).click(); await settle();
  expect(shown).toEqual(['memory']); expect(root.isConnected).toBe(false);
});

test('every guide named by the list exists, and Summary and Cortex are taught as alternatives', () => {
  for (const way of lumiverseWays) if (way.tutorial) expect(featureTutorials[way.tutorial]).toBeDefined();
  expect(featureTutorials.memory.intro).toContain('Don’t use both');
  expect(JSON.stringify(featureTutorials.authorsNote)).toContain('Tools (wrench icon)');
});
