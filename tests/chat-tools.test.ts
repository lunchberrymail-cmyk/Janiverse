import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { COMPOSER_LAYOUT_KEY, createChatTools, type ComposerLayout } from '../src/chat-tools';

const original = { document: globalThis.document };
let dom: JSDOM, tools: ReturnType<typeof createChatTools> | undefined;
let layouts: ComposerLayout[], actions: string[], saves: unknown[][];
let ctx: any;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function setup() {
  tools = createChatTools(ctx, { onLayoutChange: layout => layouts.push(layout),
    openApi: () => { actions.push('api'); }, openMemory: () => { actions.push('memory'); },
    openPersonas: () => { actions.push('personas'); }, openHone: () => { actions.push('hone'); },
  }); return tools;
}
function choose(value: ComposerLayout) { document.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click(); }
function button(text: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === text)!; }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html data-jb-tools="previous"><body><button id="help">Help</button><textarea id="draft">Unsent story draft</textarea></body></html>');
  globalThis.document = dom.window.document; layouts = []; actions = []; saves = [];
  ctx = { getActiveChat: () => ({ chatId: 'chat-1' }), settings: {
    get: async () => undefined, set: async (...args: unknown[]) => { saves.push(args); },
  }, ui: { showModal() {
    const root = document.createElement('section'); document.body.append(root);
    let closed = false; const handlers: (() => void)[] = [];
    return { root, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; }, dismiss() {
      if (closed) return; closed = true; root.remove(); handlers.forEach(fn => fn());
    } };
  } } };
});
afterEach(() => { tools?.destroy(); tools = undefined; dom.window.close(); Object.assign(globalThis, original); });

test('default and help leave all native tools available without saving or invoking Hone', async () => {
  setup(); await tools!.ready; tools!.openHelp();
  expect(tools!.getLayout()).toBe('lumiverse'); expect(document.documentElement.dataset.jbTools).toBe('true');
  expect(document.querySelector<HTMLInputElement>('input[value="lumiverse"]')!.checked).toBe(true);
  expect(saves).toEqual([]); expect(actions).toEqual([]);
  expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
});

test('saved layout restores without another write and choosing a layout persists through the host account settings', async () => {
  ctx.settings.get = async () => 'janitorai'; setup(); await tools!.ready;
  expect(tools!.getLayout()).toBe('janitorai'); expect(document.documentElement.dataset.jbTools).toBe('false'); expect(saves).toEqual([]);
  tools!.openHelp(); choose('lumiverse'); await settle();
  expect(saves).toEqual([[COMPOSER_LAYOUT_KEY, 'lumiverse']]); expect(actions).toEqual([]);
});

test('a late preference read cannot undo a new choice and a read after disable cannot alter the host', async () => {
  const read = deferred<unknown>(); ctx.settings.get = () => read.promise;
  setup(); tools!.openHelp(); choose('janitorai'); read.resolve('lumiverse'); await tools!.ready;
  expect(tools!.getLayout()).toBe('janitorai');
  tools!.destroy(); expect(document.documentElement.dataset.jbTools).toBe('previous');
  tools = undefined;
  const late = deferred<unknown>(); ctx.settings.get = () => late.promise;
  setup(); tools!.destroy(); late.resolve('janitorai'); await tools!.ready;
  expect(document.documentElement.dataset.jbTools).toBe('previous');
});

test('rapid changes serialize preference writes so the latest layout remains saved', async () => {
  const first = deferred<void>(); let stored: unknown;
  ctx.settings.set = async (_key: string, value: unknown) => { saves.push([value]); if (saves.length === 1) await first.promise; stored = value; };
  setup(); await tools!.ready; tools!.openHelp(); choose('janitorai'); await settle(); choose('lumiverse'); await settle();
  expect(saves).toEqual([['janitorai']]); first.resolve(); await settle();
  expect(saves).toEqual([['janitorai'], ['lumiverse']]); expect(stored).toBe('lumiverse');
});

test('a save failure is visible and retry preserves the chosen layout and draft', async () => {
  ctx.settings.set = async () => { throw new Error('Unavailable'); };
  setup(); await tools!.ready; tools!.openHelp(); choose('janitorai'); await settle();
  expect(document.querySelector('[role="status"]')!.textContent).toContain('could not be saved');
  expect(tools!.getLayout()).toBe('janitorai'); expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
  ctx.settings.set = async (...args: unknown[]) => { saves.push(args); };
  await tools!.setLayout('janitorai'); expect(document.querySelector('[role="status"]')!.textContent).toBe('');
  expect(saves).toEqual([[COMPOSER_LAYOUT_KEY, 'janitorai']]);
});

test('help actions require an explicit choice and chat-only actions are disabled without a chat', async () => {
  setup(); await tools!.ready; tools!.openHelp(); button('Find Hone').click(); await settle();
  expect(actions).toEqual(['hone']); expect(document.querySelector('.jb-chat-help')).toBeNull();
  ctx.getActiveChat = () => ({ chatId: null }); tools!.openHelp();
  expect(button('Find Hone').disabled).toBe(true); expect(button('Open memory').disabled).toBe(true);
  button('Open settings').click(); await settle(); expect(actions).toEqual(['hone', 'api']);
});

test('Escape closes help before the host generation shortcut and returns focus to Help', async () => {
  let stops = 0; const host = () => { stops++; }; document.addEventListener('keydown', host);
  const opener = document.querySelector<HTMLButtonElement>('#help')!; opener.focus(); setup(); tools!.openHelp();
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.querySelector('.jb-chat-help')).toBeNull(); expect(stops).toBe(0); expect(document.activeElement).toBe(opener);
  document.removeEventListener('keydown', host);
});
