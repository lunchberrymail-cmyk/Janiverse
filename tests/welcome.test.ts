import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createWelcome, WELCOME_COMPLETED_KEY } from '../src/welcome';

const original = { document: globalThis.document, fetch: globalThis.fetch };
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let dom: JSDOM, ctx: any, welcome: ReturnType<typeof createWelcome> | undefined;
let settings: Map<string, unknown>, reads: string[], writes: Array<{ key: string; value: unknown }>, grants: unknown;
let permissionRequests: number, fetchCalls: number, shown: number, dismissed: number, apiCalls: number, importCalls: number, homeCalls: number;
let readSetting: (key: string) => Promise<unknown>, readGrants: () => Promise<unknown>, goHome: () => Promise<boolean>;
let closeHost: () => void, failStorage: boolean, failModal: boolean;

function setup() {
  welcome = createWelcome(ctx, { openHome: () => { homeCalls++; return goHome(); }, openApi: () => { apiCalls++; }, openImport: () => { importCalls++; } });
  return welcome;
}
function action(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.jb-welcome button')].find(node => node.textContent === label);
  if (!found) throw new Error(`Missing action ${label}`); return found;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="native"><button>Native action</button><p>Existing Lumiverse library</p></main></body></html>', { url: 'http://localhost:7860/characters' });
  globalThis.document = dom.window.document;
  settings = new Map(); reads = []; writes = []; grants = [];
  permissionRequests = fetchCalls = shown = dismissed = apiCalls = importCalls = homeCalls = 0; failStorage = failModal = false;
  readSetting = async key => settings.get(key); readGrants = async () => grants; goHome = async () => true;
  globalThis.fetch = (async () => { fetchCalls++; throw new Error('No network expected'); }) as typeof fetch;
  ctx = {
    settings: {
      get: async (key: string) => { reads.push(key); return readSetting(key); },
      set: async (key: string, value: unknown) => { writes.push({ key, value }); if (failStorage) throw new Error('Unavailable storage'); settings.set(key, value); },
    },
    permissions: { getGranted: () => readGrants(), request: async () => { permissionRequests++; return false; } },
    ui: { showModal(options: { title: string }) {
      if (failModal) throw new Error('No available modal slot');
      shown++; expect(options.title).toBe('Welcome to Janiverse');
      const root = document.createElement('section'); root.dataset.spindleModal = String(shown); document.body.append(root);
      const listeners = new Set<() => void>(); let closed = false;
      const dismiss = () => { if (closed) return; closed = true; dismissed++; root.remove(); for (const listener of [...listeners]) listener(); };
      closeHost = dismiss;
      return { root, modalId: String(shown), dismiss, setTitle() {}, onDismiss(handler: () => void) { listeners.add(handler); return () => listeners.delete(handler); } };
    } },
  };
});
afterEach(async () => {
  welcome?.destroy(); welcome = undefined; await flush(); dom.window.close();
  globalThis.document = original.document; globalThis.fetch = original.fetch;
});

test('fresh zero-permission installation can orient on the native characters page without changing it', async () => {
  const native = document.querySelector('#native')!, before = native.outerHTML;
  const helper = setup(); expect(reads).toHaveLength(0); expect(shown).toBe(0); expect(writes).toHaveLength(0);
  expect(await helper.maybeOpen()).toBe(true);
  expect(reads).toEqual([WELCOME_COMPLETED_KEY]); expect(WELCOME_COMPLETED_KEY).toMatch(/^[a-z][a-z0-9_]*:[A-Za-z0-9._-]+$/);
  expect(document.querySelector('.jb-welcome')?.textContent).toContain('No permissions enabled yet? That’s normal.');
  expect(document.querySelector('.jb-welcome')?.textContent).toContain('close it with its ×');
  expect(document.querySelector('.jb-welcome')?.textContent).toContain('stay in Lumiverse');
  expect(dom.window.location.pathname).toBe('/characters'); expect(homeCalls + apiCalls + importCalls + permissionRequests + fetchCalls).toBe(0);
  expect(writes).toHaveLength(0); expect(native.outerHTML).toBe(before);
  expect(await helper.maybeOpen()).toBe(false); expect(shown).toBe(1);
});

test('automatic welcome requires an absent completion marker and an exactly empty granted list', async () => {
  for (const value of [true, false, 'legacy-value']) {
    settings.set(WELCOME_COMPLETED_KEY, value); const helper = setup(); expect(await helper.maybeOpen()).toBe(false); helper.destroy();
  }
  settings.clear();
  for (const value of [['chats'], ['generation', 'presets'], null, {}]) {
    grants = value; const helper = setup(); expect(await helper.maybeOpen()).toBe(false); helper.destroy();
  }
  expect(shown).toBe(0); expect(permissionRequests).toBe(0); expect(writes).toHaveLength(0);
});

test('automatic welcome stays out of chats but manual Start here can always reopen it', async () => {
  dom.reconfigure({ url: 'http://localhost:7860/chat/chat-one' }); settings.set(WELCOME_COMPLETED_KEY, true); grants = ['chats'];
  const helper = setup(); expect(await helper.maybeOpen()).toBe(false); expect(reads).toHaveLength(0);
  expect(helper.open()).toBe(true); expect(shown).toBe(1); helper.open(); expect(shown).toBe(1);
  action('Got it').click(); await flush(); expect(writes).toEqual([{ key: WELCOME_COMPLETED_KEY, value: true }]);
  helper.open(); expect(shown).toBe(2); closeHost(); await flush(); expect(writes).toHaveLength(1);
  expect(permissionRequests).toBe(0); expect(homeCalls + apiCalls + importCalls).toBe(0);
});

test('successful Home choice acknowledges only after its route resolves', async () => {
  const pending = deferred<boolean>(); goHome = () => pending.promise;
  const helper = setup(); await helper.maybeOpen(); action('Open Janiverse Home').click();
  expect(homeCalls).toBe(1); expect(writes).toHaveLength(0); expect(document.querySelector('.jb-welcome')?.getAttribute('aria-busy')).toBe('true');
  expect([...document.querySelectorAll<HTMLButtonElement>('.jb-welcome button')].every(node => node.disabled)).toBe(true);
  pending.resolve(true); await flush(); expect(dismissed).toBe(1); expect(settings.get(WELCOME_COMPLETED_KEY)).toBe(true);
  expect(writes).toHaveLength(1); expect(permissionRequests + fetchCalls).toBe(0);
});

test('failed Home navigation stays open with retry and never marks first run complete', async () => {
  goHome = async () => false; const helper = setup(); await helper.maybeOpen(); action('Open Janiverse Home').click(); await flush();
  expect(shown).toBe(1); expect(dismissed).toBe(0); expect(writes).toHaveLength(0); expect(document.querySelector('[role="status"]')?.textContent).toContain('Try again');
  goHome = async () => { throw new Error('Unavailable'); }; action('Retry opening Janiverse Home').click(); await flush();
  expect(writes).toHaveLength(0); expect(action('Retry opening Janiverse Home').disabled).toBe(false);
  goHome = async () => true; action('Retry opening Janiverse Home').click(); await flush(); expect(writes).toHaveLength(1); expect(dismissed).toBe(1);
});

test('API and import are separate explicit optional actions', async () => {
  const helper = setup(); helper.open(); action('API settings').click(); await flush();
  expect(apiCalls).toBe(1); expect(importCalls + homeCalls).toBe(0); expect(writes).toHaveLength(1);
  helper.open(); action('Import old cards & chats').click(); await flush();
  expect(importCalls).toBe(1); expect(dismissed).toBe(2); expect(writes).toHaveLength(1); expect(permissionRequests + fetchCalls).toBe(0);
});

test('host close is an acknowledgement while destroying an open window is not', async () => {
  const helper = setup(); helper.open(); closeHost(); await flush(); expect(writes).toHaveLength(1);
  helper.destroy(); welcome = undefined; settings.clear(); writes = [];
  const next = setup(); next.open(); next.destroy(); await flush(); expect(writes).toHaveLength(0);
  expect(await next.maybeOpen()).toBe(false); expect(next.open()).toBe(false);
});

test('pending reads cannot open after manual orientation or an intervening user action', async () => {
  const pending = deferred<unknown>(); readSetting = () => pending.promise;
  const helper = setup(); const automatic = helper.maybeOpen(); helper.open(); pending.resolve(undefined);
  expect(await automatic).toBe(false); expect(shown).toBe(1); expect(writes).toHaveLength(0);
  helper.destroy(); welcome = undefined;
  const secondRead = deferred<unknown>(); readSetting = () => secondRead.promise; const second = setup(); const delayed = second.maybeOpen();
  document.querySelector('#native button')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  secondRead.resolve(undefined); expect(await delayed).toBe(false); expect(shown).toBe(1); expect(writes).toHaveLength(0);
});

test('existing dialogs and new dialogs opened during reads suppress the automatic welcome', async () => {
  const existing = document.createElement('dialog'); existing.open = true; document.body.append(existing);
  const helper = setup(); expect(await helper.maybeOpen()).toBe(false); expect(reads).toHaveLength(0); helper.destroy(); welcome = undefined; existing.remove();
  const pending = deferred<unknown>(); readSetting = () => pending.promise; const next = setup(); const result = next.maybeOpen();
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog); dialog.remove(); await flush();
  pending.resolve(undefined); expect(await result).toBe(false); expect(shown).toBe(0); expect(writes).toHaveLength(0);
});

test('navigation or destruction during asynchronous checks never opens or persists the welcome', async () => {
  const pending = deferred<unknown>(); readGrants = () => pending.promise;
  const helper = setup(); const automatic = helper.maybeOpen(); dom.reconfigure({ url: 'http://localhost:7860/chat/new-chat' }); pending.resolve([]);
  expect(await automatic).toBe(false); expect(shown).toBe(0);
  helper.destroy(); welcome = undefined; dom.reconfigure({ url: 'http://localhost:7860/' });
  const nextRead = deferred<unknown>(); readGrants = () => nextRead.promise; const next = setup(); const nextAutomatic = next.maybeOpen(); next.destroy(); nextRead.resolve([]);
  expect(await nextAutomatic).toBe(false); expect(shown).toBe(0); expect(writes).toHaveLength(0);
});

test('destroying during Home navigation discards a late result without acknowledging', async () => {
  const pending = deferred<boolean>(); goHome = () => pending.promise;
  const helper = setup(); helper.open(); action('Open Janiverse Home').click(); helper.destroy(); pending.resolve(true); await flush();
  expect(writes).toHaveLength(0); expect(dismissed).toBe(1); expect(document.querySelector('.jb-welcome')).toBeNull();
});

test('missing, rejected or unsupported settings surfaces fail quietly without breaking manual orientation', async () => {
  delete ctx.settings; const missing = setup(); expect(await missing.maybeOpen()).toBe(false); expect(missing.open()).toBe(true); closeHost(); await flush(); missing.destroy(); welcome = undefined;
  ctx.settings = { get: async () => { throw new Error('Unavailable'); }, set: async () => { throw new Error('Unavailable'); } };
  const rejected = setup(); expect(await rejected.maybeOpen()).toBe(false); expect(rejected.open()).toBe(true); closeHost(); await flush();
  expect(permissionRequests + fetchCalls).toBe(0);
});

test('failed acknowledgement storage and a full modal stack never create startup errors', async () => {
  failStorage = true; const helper = setup(); expect(await helper.maybeOpen()).toBe(true); closeHost(); await flush();
  expect(writes).toHaveLength(1); expect(await helper.maybeOpen()).toBe(false); helper.destroy(); welcome = undefined;
  failModal = true; const full = setup(); expect(await full.maybeOpen()).toBe(false); expect(full.open()).toBe(false); expect(permissionRequests).toBe(0);
});
