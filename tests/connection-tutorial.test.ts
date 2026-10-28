import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { openFeatureTutorial } from '../src/feature-tutorials';
import { CONNECTION_GUIDE_KEY } from '../src/connection-tutorial';

let dom: JSDOM, previousDocument: any, previousFetch: any, ctx: any;
let guide: ReturnType<typeof openFeatureTutorial> | undefined;
let state: Record<string, any>, listeners: Map<string, Set<() => void>>, calls: any[], writes: any[], requests: any[], saved: unknown;
let respond: () => Promise<any>, invoke: () => Promise<boolean>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { await flush(); await flush(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const button = (name: string) => { const match = [...guide!.root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name); if (!match) throw new Error(`Missing ${name}`); return match; };
function start(screenshots = {}) { guide = openFeatureTutorial(ctx, 'connections', { invoke: async ref => { calls.push(ref); return invoke(); }, screenshots }); return guide; }
function step(number: number) { while (Number(guide!.root.dataset.scene) < number) button('Next').click(); while (Number(guide!.root.dataset.scene) > number) button('Back').click(); }
function select(id: string) { const node = guide!.root.querySelector<HTMLSelectElement>('select')!; node.value = id; node.dispatchEvent(new dom.window.Event('change')); }
function emit(key: string) { listeners.get(key)?.forEach(handler => handler()); }
const complete = () => guide!.root.querySelector('.jb-api-guide-checks')!.getAttribute('data-complete');

beforeEach(() => {
  previousDocument = globalThis.document; previousFetch = globalThis.fetch;
  dom = new JSDOM('<!doctype html><html><body><button id="launch">API guide</button><div data-lumiverse-surface="viewport-drawer"><div data-spindle-mount="sidebar"></div><div><header><span data-spindle-mount="drawer_header_actions"></span></header><main id="native"><input type="password" value="private-draft"><button id="native-save">Create</button></main></div><span id="slot" data-spindle-mount="drawer_footer"></span></div><button id="outside">Outside</button></body></html>', { url: 'http://localhost:7860/', pretendToBeVisual: true }); globalThis.document = dom.window.document;
  document.querySelector<HTMLElement>('#launch')!.focus();
  state = { 'connections.profiles': [{ id: 'one', name: 'My API', provider: 'openrouter', model: 'model-a', updated_at: 1, has_api_key: true, api_key: 'must-not-read-or-save' }], 'connections.active': { activeProfileId: 'one' }, 'ui.drawer': { open: true, tabId: 'connections' } };
  listeners = new Map(); calls = []; writes = []; requests = []; saved = undefined;
  invoke = async () => true; respond = async () => ({ ok: true, json: async () => ({ success: true, message: 'Connection successful' }) });
  ctx = { ui: { mount: (slot: string) => { expect(slot).toBe('drawer_footer'); const mount = document.createElement('div'); document.querySelector('#slot')!.append(mount); return mount; }, showModal: () => { throw new Error('A guide must not block the form'); } },
    state: { get: (key: string) => state[key], subscribe: (key: string, handler: () => void) => { const list = listeners.get(key) || new Set(); listeners.set(key, list); list.add(handler); return () => list.delete(handler); } },
    settings: { get: async () => saved, set: async (key: string, value: unknown) => { writes.push({ key, value: structuredClone(value) }); saved = value; } },
  };
  globalThis.fetch = (async (url: any, init: any) => { requests.push({ url: String(url), init }); return respond(); }) as any;
});
afterEach(() => { guide?.destroy(); guide = undefined; dom.window.close(); globalThis.document = previousDocument; globalThis.fetch = previousFetch; });

test('opens the native workspace once and keeps visible guidance in its footer without a modal or automatic tests', async () => {
  const view = start(); await settle(); expect(calls).toEqual([{ kind: 'drawer_tab', id: 'connections' }]); expect(view.root.closest('#slot')).not.toBeNull();
  expect(view.root.getAttribute('role')).toBe('complementary'); expect(view.root.querySelector('.jb-api-guide-instruction')!.closest('details')).toBeNull(); expect(view.root.querySelector('.jb-api-guide-result')!.closest('details')).toBeNull();
  expect(view.root.querySelectorAll('details[open]')).toHaveLength(0); expect(requests).toEqual([]); expect(writes).toEqual([]);
  document.querySelector<HTMLElement>('#native-save')!.focus(); expect(document.activeElement!.id).toBe('native-save');
  expect(document.querySelector<HTMLInputElement>('#native input')!.value).toBe('private-draft'); expect(view.root.textContent).not.toContain('must-not-read-or-save');
});

test('leaving for the native form keeps the step and guide available; keyboard focus is not trapped', async () => {
  const view = start(); await settle(); view.root.scrollTop = 120; step(3); expect(view.root.scrollTop).toBe(0); const focused = document.querySelector<HTMLElement>('#outside')!; focused.focus();
  focused.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); expect(document.activeElement).toBe(focused); expect(view.root.isConnected).toBe(true); expect(view.root.dataset.scene).toBe('3');
  button('Close tutorial').click(); expect(view.root.isConnected).toBe(false); expect(document.querySelector<HTMLInputElement>('#native input')!.value).toBe('private-draft'); expect(document.activeElement!.id).toBe('launch');
});

test('resumes step and selected connection after close and reopen, without persisting credentials or test results', async () => {
  start(); await settle(); step(5); select('one'); await settle(); guide!.destroy(); start(); await settle();
  expect(guide!.root.dataset.scene).toBe('5'); expect(guide!.root.querySelector<HTMLSelectElement>('select')!.value).toBe('one'); expect(complete()).toBe('false');
  expect(writes.at(-1)).toEqual({ key: CONNECTION_GUIDE_KEY, value: { step: 4, connectionId: 'one' } }); expect(JSON.stringify(writes)).not.toMatch(/api_key|must-not-read|private-draft|success/); expect(requests).toHaveLength(0);
});

test('a late saved step never replaces explicit navigation or selection', async () => {
  const pending = deferred<unknown>(); ctx.settings.get = () => pending.promise;
  start(); step(3); pending.resolve({ step: 6, connectionId: 'wrong' }); await settle(); expect(guide!.root.dataset.scene).toBe('3');
  expect(guide!.root.querySelector<HTMLSelectElement>('select')!.value).toBe('');
});

test('working in the native form also prevents a late saved step replacing the current instruction', async () => {
  const pending = deferred<unknown>(); ctx.settings.get = () => pending.promise;
  start(); document.querySelector('#native input')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); pending.resolve({ step: 5 }); await settle(); expect(guide!.root.dataset.scene).toBe('1');
});

test('invalid saved steps are ignored and stored names are rendered as plain text', async () => {
  saved = { step: 99, connectionId: '<img>' }; state['connections.profiles'][0].name = '<script>name</script>';
  start(); await settle(); expect(guide!.root.dataset.scene).toBe('1'); expect(guide!.root.querySelector('script,img')).toBeNull();
  expect(guide!.root.querySelector('select')!.textContent).toContain('<script>name</script>');
});

test('follows one newly saved connection after Create, while multiple additions require an explicit choice', async () => {
  start(); await settle(); step(4); state['connections.profiles'].push({ id: 'new', name: 'New API', provider: 'custom', model: 'local' }); emit('connections.profiles');
  expect(guide!.root.querySelector<HTMLSelectElement>('select')!.value).toBe('new'); expect(complete()).toBe('false');
  button('Restart guide').click(); step(4); state['connections.profiles'].push({ id: 'a', name: 'A', provider: 'custom', model: 'a' }, { id: 'b', name: 'B', provider: 'custom', model: 'b' }); emit('connections.profiles');
  expect(guide!.root.querySelector<HTMLSelectElement>('select')!.value).toBe(''); expect(requests).toHaveLength(0);
});

test('preexisting profiles are not silently selected, and model roulette cannot masquerade as a tested provider', async () => {
  state['connections.profiles'].push({ id: 'roulette', name: 'Random', provider: 'model_roulette', model: 'placeholder' });
  start(); await settle(); step(7); expect(button('Finish guide').disabled).toBe(true); expect(button('Test selected connection').disabled).toBe(true);
  const option = guide!.root.querySelector<HTMLOptionElement>('option[value=roulette]')!; expect(option.disabled).toBe(true); select('roulette'); expect(button('Test selected connection').disabled).toBe(true); expect(requests).toHaveLength(0);
});

test('successful explicit testing checks the chosen profile and only completes when it is saved and active', async () => {
  start(); await settle(); step(6); select('one'); expect(complete()).toBe('false'); expect(requests).toHaveLength(0);
  button('Test selected connection').click(); button('Testing…').click(); await settle();
  expect(requests).toHaveLength(1); expect(requests[0].url).toBe('/api/v1/connections/one/test'); expect(requests[0].init.method).toBe('POST'); expect(requests[0].init.credentials).toBe('same-origin'); expect(requests[0].init.body).toBeUndefined();
  expect(guide!.root.dataset.scene).toBe('7'); expect(complete()).toBe('true'); expect(button('Finish guide').disabled).toBe(false); expect(guide!.root.textContent).toContain('Connection successful · My API');
  state['connections.active'] = { activeProfileId: 'another' }; emit('connections.active'); expect(button('Finish guide').disabled).toBe(true); expect(complete()).toBe('false');
  state['connections.active'] = { activeProfileId: 'one' }; emit('connections.active'); expect(button('Finish guide').disabled).toBe(false); button('Finish guide').click(); expect(guide!.root.isConnected).toBe(false);
});

test.each(['rejected', 'http', 'false', 'string'])('a %s test cannot produce a successful finish', async mode => {
  respond = async () => { if (mode === 'rejected') throw new Error('network'); return { ok: mode !== 'http', json: async () => ({ success: mode === 'string' ? 'true' : false }) }; };
  start(); await settle(); step(7); select('one'); button('Test selected connection').click(); await settle();
  expect(complete()).toBe('false'); expect(button('Finish guide').disabled).toBe(true); expect(button('Test selected connection').disabled).toBe(false); expect(guide!.root.textContent).toMatch(/Test failed|Couldn’t complete/);
});

test('edits invalidate verification, including key changes hidden from the safe profile projection', async () => {
  start(); await settle(); step(6); select('one'); button('Test selected connection').click(); await settle(); expect(complete()).toBe('true');
  emit('connections.profiles'); expect(complete()).toBe('false'); expect(button('Finish guide').disabled).toBe(true); expect(guide!.root.textContent).toContain('Test the selected connection again');
});

test('a late successful response from a changed connection cannot verify the replacement', async () => {
  const pending = deferred<any>(); respond = () => pending.promise;
  start(); await settle(); step(6); select('one'); button('Test selected connection').click(); await flush();
  state['connections.profiles'] = [{ id: 'two', name: 'Other API', provider: 'custom', model: 'other' }]; emit('connections.profiles'); select('two');
  expect(requests[0].init.signal.aborted).toBe(true); pending.resolve({ ok: true, json: async () => ({ success: true }) }); await settle(); expect(complete()).toBe('false'); expect(guide!.root.dataset.scene).toBe('6');
});

test('closing during testing aborts and ignores late completion; old controls cannot test or open anything', async () => {
  const pending = deferred<any>(); respond = () => pending.promise;
  start(); await settle(); step(6); select('one'); const oldTest = button('Test selected connection'), oldOpen = button('Open Connections'); oldTest.click(); await flush(); const view = guide!; view.destroy();
  expect(requests[0].init.signal.aborted).toBe(true); pending.resolve({ ok: true, json: async () => ({ success: true }) }); await settle(); oldTest.click(); oldOpen.click();
  expect(requests).toHaveLength(1); expect(calls).toHaveLength(1); expect(view.root.dataset.scene).toBe('6'); expect([...listeners.values()].every(list => list.size === 0)).toBe(true);
});

test('minimize and switching drawers preserve the step and leave other tools available', async () => {
  start(); await settle(); step(4); button('Minimize API guide').click(); expect(guide!.root.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(true);
  button('Resume API guide').click(); expect(guide!.root.dataset.scene).toBe('4');
  state['ui.drawer'] = { open: true, tabId: 'personas' }; emit('ui.drawer'); expect(guide!.root.hidden).toBe(true);
  state['ui.drawer'] = { open: true, tabId: 'connections' }; emit('ui.drawer'); expect(guide!.root.hidden).toBe(false); expect(guide!.root.dataset.scene).toBe('4'); expect(calls).toHaveLength(1);
});

test('screenshots and matching numbered instructions expand together, with safe image sources and recovery', async () => {
  start({ 'api-connection-open': { src: 'data:image/png;base64,aGVsbG8=', alt: 'Native controls', callouts: [{ label: 'Choose New Connection', x: 10, y: 10, targetX: 20, targetY: 20 }] }, 'api-connection-key': { src: 'https://remote.invalid/tracking.png', alt: 'Remote' } }); await settle();
  const picture = guide!.root.querySelector<HTMLDetailsElement>('.jb-api-guide-picture')!; expect(picture.open).toBe(false); picture.open = true;
  expect(picture.querySelector('.jb-tutorial-callouts')!.textContent).toContain('Choose New Connection'); expect(picture.querySelectorAll('.jb-tutorial-number')).toHaveLength(1);
  picture.querySelector('img')!.dispatchEvent(new dom.window.Event('error')); expect(picture.textContent).toContain('Follow the instruction above');
  step(2); expect(picture.open).toBe(false); expect(picture.querySelector('img')).toBeNull(); expect(guide!.root.textContent).toContain('Name the connection');
});

test('unsupported projections and failed preference storage do not break manual instructions', async () => {
  delete state['connections.profiles']; ctx.settings.get = async () => { throw new Error('unavailable'); }; ctx.settings.set = async () => { throw new Error('unavailable'); };
  start(); await settle(); step(6); await settle(); expect(button('Test selected connection').disabled).toBe(true); expect(guide!.root.textContent).toContain('Your place could not be saved'); expect(guide!.root.textContent).toContain('Couldn’t read saved connections');
});

test('a failed workspace shortcut remains visible and docks again when Connections opens manually', async () => {
  state['ui.drawer'] = { open: false, tabId: 'profile' }; invoke = async () => false;
  start(); await settle(); expect(guide!.root.hidden).toBe(false); expect(guide!.root.classList.contains('jb-api-guide-fallback')).toBe(true); expect(guide!.root.textContent).toContain('Couldn’t open Connections');
  state['ui.drawer'] = { open: true, tabId: 'connections' }; emit('ui.drawer'); expect(guide!.root.closest('#slot')).not.toBeNull(); expect(guide!.root.classList.contains('jb-api-guide-fallback')).toBe(false);
});

test('closing before deferred launch cancels the native action', async () => { start(); guide!.destroy(); await settle(); expect(calls).toEqual([]); expect(requests).toEqual([]); });
