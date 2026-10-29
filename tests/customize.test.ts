import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCustomize } from '../src/customize';
import { appearanceOverrideName } from '../src/customize-storage';

type Row = Record<string, any>;
const original = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
let dom: JSDOM, customize: ReturnType<typeof createCustomize>, ctx: any, chatId: string;
let calls: Array<{ path: string; method: string; body: any; signal?: AbortSignal | null }>, requested: number, grants: string[];
let settings: Map<string, Row>, metadata: Row, handlers: Set<() => void>, rejectedSave: boolean, revoked: string[];
let navigation: string[], native: HTMLElement, nativeMarkup: string;
function panel() { return document.querySelector<HTMLElement>('.jb-customize')!; }
function button(label: string) { const found = [...panel().querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label); if (!found) throw new Error(`Missing button ${label}`); return found; }
function input(label: string) { const found = panel().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); if (!found) throw new Error(`Missing input ${label}`); return found; }
function change(label: string, value: string) { const control = input(label); control.value = value; control.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
function choose(file: File) { const control = input('Background image file'); Object.defineProperty(control, 'files', { configurable: true, value: [file] }); control.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
const writes = () => calls.filter(call => call.method !== 'GET');
async function open() { customize.open(); await settle(); }
async function save() { button('Save').click(); await settle(); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><button id="prior">Prior focus</button><main id="native"><article data-component="MessageContent">Native chat prose <em>with emphasis</em></article><button>Native send</button></main></body>', { url: 'http://localhost/chat/chat-1' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  native = document.querySelector('#native')!; nativeMarkup = native.outerHTML;
  calls = []; requested = 0; grants = ['chats']; chatId = 'chat-1'; handlers = new Set(); rejectedSave = false; revoked = []; navigation = [];
  settings = new Map([
    ['componentOverrides', { OtherNativeComponent: { css: '.native { color: green; }', tsx: '<Content />', enabled: false } }],
    ['wallpaper', { global: { image_id: 'existing-global', type: 'image' }, opacity: .25, blur: 1.5, fit: 'cover', future: { keep: true } }],
  ]); metadata = { unrelated: { keep: true } };
  URL.createObjectURL = () => 'blob:customize-test-preview'; URL.revokeObjectURL = value => { revoked.push(value); };
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://localhost'); const path = parsed.pathname.replace('/api/v1', ''); const method = init.method || 'GET';
    const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: path + parsed.search, method, body, signal: init.signal }); expect(init.credentials).toBe('same-origin');
    if (path.startsWith('/settings/')) {
      const key = decodeURIComponent(path.slice('/settings/'.length));
      if (method === 'PUT') { if (rejectedSave) return json({}, 500); settings.set(key, structuredClone(body.value)); }
      return settings.has(key) ? json({ key, value: settings.get(key) }) : json({}, 404);
    }
    if (path === '/chats/chat-1') return json({ id: 'chat-1', metadata });
    if (path === '/images/wallpapers' && method === 'POST') return json({ id: 'uploaded-image', mime_type: 'image/png' }, 201);
    if (path === '/chats/chat-1/metadata' && method === 'PATCH') { metadata = { ...metadata, ...body }; return json({ id: 'chat-1', metadata }); }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as typeof fetch;
  ctx = { getActiveChat: () => ({ chatId, characterId: 'character-1' }), permissions: { getGranted: async () => [...grants], request: async () => { requested++; return [...grants]; } }, state: { subscribe(name: string, callback: () => void) { expect(name).toBe('chat.active'); handlers.add(callback); return () => handlers.delete(callback); } } };
  customize = createCustomize(ctx, { settings: () => navigation.push('settings'), memory: id => navigation.push(`memory:${id}`) });
});
afterEach(() => { customize.destroy(); dom.window.close(); globalThis.document = original.document; globalThis.location = original.location; globalThis.fetch = original.fetch; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; });

test('opening Customize reads only needed preferences, never requests access or modifies native chat', async () => {
  await open(); expect(panel().getAttribute('aria-modal')).toBe('false'); expect(button('Save').disabled).toBe(true); expect(input('Text streaming').disabled).toBe(true);
  expect(calls.map(call => call.path).sort()).toEqual(['/chats/chat-1?messages=false', '/settings/componentOverrides', '/settings/wallpaper'].sort());
  expect(writes()).toEqual([]); expect(requested).toBe(0); expect(native.outerHTML).toBe(nativeMarkup);
});

test('font and color edits preview locally until Save persists native CSS and preserves unrelated overrides', async () => {
  await open(); const originalOverrides = structuredClone(settings.get('componentOverrides'));
  change('Font size value', '20'); change('Text color hex', '#abcdef');
  const family = panel().querySelector<HTMLSelectElement>('[aria-label="Font family"]')!; family.value = 'Georgia'; family.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  expect(panel().querySelector<HTMLElement>('.jb-customize-sample')!.style.fontSize).toBe('20px'); expect(panel().querySelector<HTMLElement>('.jb-customize-sample')!.style.fontFamily).toContain('Georgia');
  expect(panel().querySelector<HTMLElement>('.jb-customize-sample>span')!.style.color).toBe('rgb(171, 205, 239)'); expect(button('Save').disabled).toBe(false); expect(writes()).toEqual([]); expect(native.outerHTML).toBe(nativeMarkup);
  await save(); const stored = settings.get('componentOverrides')!;
  expect(stored.OtherNativeComponent).toEqual(originalOverrides!.OtherNativeComponent); expect(stored[appearanceOverrideName].enabled).toBe(true); expect(stored[appearanceOverrideName].tsx).toBe('');
  expect(stored[appearanceOverrideName].css).toContain('font-size: 20px'); expect(stored[appearanceOverrideName].css).toContain('#abcdef'); expect(stored[appearanceOverrideName].css).toContain('Georgia');
  expect(writes()).toHaveLength(1); expect(writes()[0].path).toBe('/settings/componentOverrides'); expect(button('Save').disabled).toBe(true); expect(panel().textContent).toContain('Saved.'); expect(native.outerHTML).toBe(nativeMarkup);
});

test('invalid draft values cannot be saved and correcting them restores the Save action', async () => {
  await open(); change('Font size value', '200'); expect(button('Save').disabled).toBe(true); await save(); expect(writes()).toEqual([]);
  change('Font size value', '20'); change('Bold text color hex', 'invalid'); expect(button('Save').disabled).toBe(true); await save(); expect(writes()).toEqual([]);
  change('Bold text color hex', '#123abc'); expect(button('Save').disabled).toBe(false); await save(); expect(writes()).toHaveLength(1);
});

test('a selected image is staged locally and uploads only on explicit Save', async () => {
  await open(); choose(new File(['synthetic image'], 'test-background.png', { type: 'image/png' }));
  expect(writes()).toEqual([]); expect(panel().querySelector<HTMLImageElement>('.jb-customize-background-preview')!.src).toBe('blob:customize-test-preview'); expect(button('Save').disabled).toBe(false);
  await save(); expect(writes().map(call => call.path)).toEqual(['/images/wallpapers', '/chats/chat-1/metadata']); expect(writes()[0].body).toBeInstanceOf(FormData); expect((writes()[0].body as FormData).get('image')).toBeInstanceOf(File);
  expect(metadata).toEqual({ unrelated: { keep: true }, wallpaper: { image_id: 'uploaded-image', type: 'image' } }); expect(revoked).toContain('blob:customize-test-preview'); expect(button('Save').disabled).toBe(true);
});

test('invalid image types and oversized files are rejected without staging, upload, or enabled Save', async () => {
  await open(); choose(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })); expect(panel().textContent).toContain('PNG, JPEG, or WebP'); expect(button('Save').disabled).toBe(true); expect(writes()).toEqual([]);
  choose(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })); expect(button('Save').disabled).toBe(true); expect(writes()).toEqual([]);
});

test('minimizing and restoring preserves the draft while closing discards it without writing', async () => {
  (document.querySelector('#prior') as HTMLButtonElement).focus(); await open(); change('Font size value', '18');
  button('Collapse panel').click(); expect(panel().querySelector<HTMLElement>('.jb-customize-content')!.hidden).toBe(true); expect(panel().querySelector<HTMLElement>('.jb-customize-footer')!.hidden).toBe(true);
  button('Expand panel').click(); expect(panel().querySelector<HTMLElement>('.jb-customize-content')!.hidden).toBe(false); expect(input('Font size value').value).toBe('18'); expect(button('Save').disabled).toBe(false);
  button('Close panel').click(); expect(panel()).toBeNull(); expect(writes()).toEqual([]); expect(handlers.size).toBe(0); expect(document.activeElement?.id).toBe('prior'); expect(native.outerHTML).toBe(nativeMarkup);
  await open(); expect(input('Font size value').value).toBe('15'); customize.destroy(); expect(panel()).toBeNull(); expect(writes()).toEqual([]);
});

test('changing chats closes the panel, aborts pending reads, and suppresses late content', async () => {
  const transport = globalThis.fetch; let finish!: (value: Response) => void;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { if (String(url) === '/api/v1/settings/componentOverrides') { calls.push({ path: '/settings/componentOverrides', method: 'GET', body: undefined, signal: init.signal }); return new Promise<Response>(resolve => { finish = resolve; }); } return transport(url, init); }) as typeof fetch;
  customize.open(); await settle(); expect(panel()).not.toBeNull(); expect(handlers.size).toBe(1);
  chatId = 'chat-2'; [...handlers].forEach(callback => callback()); expect(panel()).toBeNull(); expect(calls.every(call => call.signal?.aborted)).toBe(true);
  finish(json({ value: {} })); await settle(); expect(panel()).toBeNull(); expect(writes()).toEqual([]); expect(handlers.size).toBe(0); expect(native.outerHTML).toBe(nativeMarkup);
});

test('an uncertain save requires Reload before another write attempt', async () => {
  await open(); change('Font size value', '20'); rejectedSave = true; await save(); expect(writes()).toHaveLength(1); expect(panel().textContent).toContain('Reload saved settings before trying again'); expect(button('Save').disabled).toBe(true);
  change('Font size value', '21'); button('Save').dispatchEvent(new dom.window.Event('click', { bubbles: true })); await settle(); expect(writes()).toHaveLength(1);
  rejectedSave = false; button('Reload saved settings').click(); await settle(); expect(input('Font size value').value).toBe('15'); change('Font size value', '21'); await save(); expect(writes()).toHaveLength(2); expect(button('Save').disabled).toBe(true);
});

test('Close and Escape keep an in-flight multi-setting save open to report a partial failure', async () => {
  await open(); change('Font size value', '20'); change('Background opacity value', '50');
  const transport = globalThis.fetch; let finish!: (value: Response) => void;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (String(url) === '/api/v1/settings/wallpaper' && init.method === 'PUT') return new Promise<Response>(resolve => { finish = resolve; });
    return transport(url, init);
  }) as typeof fetch;
  button('Save').click(); await settle();
  expect(button('Close panel').disabled).toBe(true);
  button('Close panel').click();
  panel().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(panel()).not.toBeNull(); expect(finish).toBeDefined();
  finish(json({}, 500)); await settle();
  expect(panel().textContent).toContain('Saved text.');
  expect(panel().textContent).toContain('Reload saved settings');
  expect(button('Close panel').disabled).toBe(false);
});

test('mobile Customize previews a video override and removes only the mobile background', async () => {
  Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  metadata = { wallpaper: { image_id: 'desktop', type: 'image' }, mobile_wallpaper: { image_id: 'phone-video', type: 'video' } };
  await open();
  const video = panel().querySelector('video')!;
  expect(video.hidden).toBe(false); expect(video.getAttribute('src')).toContain('phone-video');
  button('Remove chat background').click(); await save();
  expect(writes().at(-1)?.body).toEqual({ mobile_wallpaper: null });
  expect(metadata.wallpaper).toEqual({ image_id: 'desktop', type: 'image' });
});

test('header navigation closes the panel and preserves the captured chat for Memory', async () => {
  await open(); button('Memory').click(); expect(panel()).toBeNull(); expect(navigation).toEqual(['memory:chat-1']); expect(writes()).toEqual([]);
  await open(); button('Settings').click(); expect(panel()).toBeNull(); expect(navigation).toEqual(['memory:chat-1', 'settings']); expect(writes()).toEqual([]);
});

test('a save in flight marks the panel saving and finishes its write before closing for a chat change', async () => {
  await open(); change('Background opacity value', '50');
  const transport = globalThis.fetch; let finish!: (value: Response) => void, signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (String(url) === '/api/v1/settings/wallpaper' && init.method === 'PUT') { signal = init.signal; return new Promise<Response>(resolve => { finish = resolve; }); }
    return transport(url, init);
  }) as typeof fetch;
  button('Save').click(); await settle(); expect(panel().getAttribute('data-jb-saving')).toBe('true');
  chatId = 'chat-2'; [...handlers].forEach(callback => callback()); expect(panel()).not.toBeNull(); expect(signal?.aborted).toBe(false);
  finish(json({ value: {} })); await settle(); expect(panel()).toBeNull(); expect(handlers.size).toBe(0);
});
