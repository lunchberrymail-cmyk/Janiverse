import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { glossary, openGlossary, type GlossaryAction } from '../src/glossary';

const original = { document: globalThis.document };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let dom: JSDOM, ctx: any, invoked: Array<{ kind: string; id: string }>, ran: GlossaryAction[], chatId: string | null, dismissed: number;
let invokeResult: () => Promise<boolean>;
function actions(result: () => void | boolean | Promise<void | boolean> = () => {}) {
  return Object.fromEntries(['home', 'myChats', 'createCharacter', 'importCards', 'importHistory', 'prompt', 'generation', 'memory', 'customize', 'replies']
    .map(key => [key, () => { ran.push(key as GlossaryAction); return result(); }])) as Record<GlossaryAction, () => void | boolean | Promise<void | boolean>>;
}
function root() { return document.querySelector<HTMLElement>('.jb-glossary')!; }
function rowFor(term: string) { return [...root().querySelectorAll<HTMLElement>('.jb-glossary-row')].find(row => row.querySelector('.jb-glossary-janitor')!.textContent === term)!; }
function search(value: string) { const input = root().querySelector<HTMLInputElement>('.jb-glossary-search')!; input.value = value; input.dispatchEvent(new dom.window.Event('input')); }
function visible() { return [...root().querySelectorAll<HTMLElement>('.jb-glossary-row')].filter(row => !row.hidden).map(row => row.querySelector('.jb-glossary-janitor')!.textContent); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }); globalThis.document = dom.window.document;
  invoked = []; ran = []; chatId = null; dismissed = 0; invokeResult = async () => true;
  ctx = { getActiveChat: () => ({ chatId }), ui: { showModal() {
    const node = document.createElement('section'); document.body.append(node); const listeners = new Set<() => void>(); let closed = false;
    return { root: node, onDismiss(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }, dismiss() { if (closed) return; closed = true; dismissed++; listeners.forEach(fn => fn()); node.remove(); } };
  } } };
});
afterEach(() => { dom.window.close(); globalThis.document = original.document; });

test('every entry names both sides and every native shortcut targets a known Lumiverse tab', () => {
  const nativeTabs = new Set(['characters', 'connections', 'personas', 'lorebook', 'summary']);
  for (const entry of glossary) {
    expect(entry.janitor.trim()).not.toBe(''); expect(entry.lumiverse.trim()).not.toBe(''); expect(entry.detail.trim()).not.toBe('');
    if (entry.show && 'ref' in entry.show) { expect(entry.show.ref.kind).toBe('drawer_tab'); expect(nativeTabs.has(entry.show.ref.id)).toBe(true); }
  }
  expect(new Set(glossary.map(entry => entry.janitor)).size).toBe(glossary.length);
});

test('search matches JanitorAI names and aliases, ignoring case and apostrophes, and explains an empty result', () => {
  openGlossary(ctx, { invoke: async ref => { invoked.push(ref); return invokeResult(); }, actions: actions() });
  search('PROXY'); expect(visible()).toEqual(['API Settings']);
  search('creators note'); expect(visible()).toEqual(['Bot profile']);
  search('temperature'); expect(visible()).toEqual(['Generation Settings']);
  search('zzz'); expect(visible()).toEqual([]); expect(root().querySelector<HTMLElement>('.jb-glossary-empty')!.hidden).toBe(false);
  search(''); expect(visible()).toHaveLength(glossary.length);
});

test('Show me opens a native tab or a Janiverse tool, then closes the glossary', async () => {
  openGlossary(ctx, { invoke: async ref => { invoked.push(ref); return invokeResult(); }, actions: actions() });
  rowFor('API Settings').querySelector('button')!.click(); await settle();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'connections' }]); expect(dismissed).toBe(1);
  openGlossary(ctx, { invoke: async ref => { invoked.push(ref); return true; }, actions: actions() });
  rowFor('Generation Settings').querySelector('button')!.click(); await settle();
  expect(ran).toEqual(['generation']); expect(dismissed).toBe(2);
});

test('chat-only shortcuts are disabled outside a chat and enabled inside one', () => {
  openGlossary(ctx, { invoke: async () => true, actions: actions() });
  const memory = rowFor('Chat Memory').querySelector('button')!; expect(memory.disabled).toBe(true); expect(memory.title).toBe('Open a chat first.');
  document.body.replaceChildren(); chatId = 'chat-1';
  openGlossary(ctx, { invoke: async () => true, actions: actions() });
  expect(rowFor('Chat Memory').querySelector('button')!.disabled).toBe(false);
});

test('a shortcut that cannot open keeps the glossary open with a message, including the host’s own error text', async () => {
  invokeResult = async () => false;
  openGlossary(ctx, { invoke: async ref => { invoked.push(ref); return invokeResult(); }, actions: actions(() => { throw new Error('PERMISSION_DENIED:chats'); }) });
  rowFor('Personas').querySelector('button')!.click(); await settle();
  expect(dismissed).toBe(0); expect(root().querySelector('.jb-status')!.textContent).toContain('Could not open that tool here');
  rowFor('My Chats').querySelector('button')!.click(); await settle();
  expect(dismissed).toBe(0); expect(root().querySelector('.jb-status')!.textContent).toBe('PERMISSION_DENIED:chats');
  expect(rowFor('My Chats').querySelector('button')!.disabled).toBe(false);
});
