import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appearanceCSS, appearanceOverrideName, CustomizeSaveError, defaultAppearance, loadCustomize, saveCustomize } from '../src/customize-storage';

let originalFetch: typeof fetch;
let store: Record<string, unknown>, calls: Array<{ path: string; method: string; body?: any }>, grants: string[];
let failPath: string | undefined;
const ctx: any = { permissions: { getGranted: async () => [...grants] } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  originalFetch = globalThis.fetch; grants = ['chats']; calls = []; failPath = undefined;
  store = { componentOverrides: { Other: { css: '.native{}', tsx: '<div />', enabled: false } }, wallpaper: { global: { image_id: 'global', type: 'video' }, mobile: { image_id: 'mobile', type: 'image' }, opacity: .35, blur: 3, fit: 'contain', unknownFutureField: { a: 1 } } };
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const path = String(input).replace('/api/v1', ''); const method = init.method ?? 'GET';
    expect(init.credentials).toBe('same-origin');
    const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (failPath === path) return json({}, 500);
    if (path.startsWith('/settings/')) {
      const key = decodeURIComponent(path.slice('/settings/'.length));
      if (method === 'PUT') { store[key] = structuredClone(body.value); return json({ key, value: body.value }); }
      return key in store ? json({ key, value: structuredClone(store[key]) }) : json({}, 404);
    }
    if (path === '/chats/chat-1?messages=false') return json({ metadata: { wallpaper: { image_id: 'chat-image', type: 'image' }, author_note: 'Keep me' } });
    if (path === '/images/wallpapers') return json({ id: 'uploaded-image' });
    if (path === '/chats/chat-1/metadata' && method === 'PATCH') return json({});
    throw new Error(`Unexpected ${method} ${path}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('load reads only exact settings and the selected chat, without writes or permission requests', async () => {
  const value = await loadCustomize(ctx, 'chat-1');
  expect(value.appearance).toEqual(defaultAppearance);
  expect(value.chatWallpaper).toEqual({ image_id: 'chat-image', type: 'image' });
  expect(value.wallpaper.opacity).toBe(.35);
  expect(calls.map(item => item.path)).toEqual(['/settings/componentOverrides', '/settings/wallpaper', '/chats/chat-1?messages=false']);
  expect(calls.every(item => item.method === 'GET')).toBe(true);
});
test('text save preserves unrelated native overrides and own TSX, and roundtrips validated controls', async () => {
  const own = { css: 'old', tsx: '<span />', enabled: true, future: 'preserve' };
  (store.componentOverrides as any)[appearanceOverrideName] = own;
  const changed = structuredClone(defaultAppearance); changed.fontSize = 20; changed.fontFamily = 'Georgia'; changed.colors.italic = '#00AA99';
  expect(await saveCustomize(ctx, 'chat-1', { appearance: changed })).toEqual({ saved: ['text'] });
  const native: any = store.componentOverrides;
  expect(native.Other).toEqual({ css: '.native{}', tsx: '<div />', enabled: false });
  expect(native[appearanceOverrideName]).toMatchObject({ tsx: '<span />', enabled: true, future: 'preserve' });
  expect(native[appearanceOverrideName].css).toContain('font-size: 20px !important');
  expect(native[appearanceOverrideName].css).not.toContain(':root');
  const result = await loadCustomize(ctx, 'chat-1');
  expect(result.appearance.fontSize).toBe(20); expect(result.appearance.colors.italic).toBe('#00aa99');
  expect(calls.filter(item => item.method !== 'GET').map(item => item.path)).toEqual(['/settings/componentOverrides']);
});
test('text saving never enables previously disabled component code', async () => {
  (store.componentOverrides as any)[appearanceOverrideName] = { css: 'old', tsx: '<span />', enabled: false };
  await expect(saveCustomize(ctx, 'chat-1', { appearance: defaultAppearance })).rejects.toThrow('custom component code');
  expect(calls.every(item => item.method === 'GET')).toBe(true);
  expect((store.componentOverrides as any)[appearanceOverrideName].enabled).toBe(false);
});
test('appearance validation blocks CSS injection and invalid sizes before network traffic', async () => {
  const changed = structuredClone(defaultAppearance); changed.fontFamily = 'Arial; background:url(https://evil.invalid)';
  await expect(saveCustomize(ctx, 'chat-1', { appearance: changed })).rejects.toThrow('supported font');
  changed.fontFamily = 'Arial'; changed.fontSize = 25;
  await expect(saveCustomize(ctx, 'chat-1', { appearance: changed })).rejects.toThrow('Font size');
  changed.fontSize = 18; changed.colors.text = '#fff;display:none';
  await expect(saveCustomize(ctx, 'chat-1', { appearance: changed })).rejects.toThrow('HEX');
  expect(calls).toEqual([]);
});
test('wallpaper preferences merge current global/mobile and future fields without replacing the chat image', async () => {
  await saveCustomize(ctx, 'chat-1', { wallpaper: { opacity: .7, blur: 8 } });
  expect(store.wallpaper).toEqual({ global: { image_id: 'global', type: 'video' }, mobile: { image_id: 'mobile', type: 'image' }, opacity: .7, blur: 8, fit: 'contain', unknownFutureField: { a: 1 } });
  expect(calls.map(item => item.path)).toEqual(['/settings/wallpaper', '/settings/wallpaper']);
});
test('background uploads only during save and atomically patches only this chat wallpaper', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'picture.png', { type: 'image/png' });
  await saveCustomize(ctx, 'chat-1', { background: { file } });
  expect(calls.map(item => item.path)).toEqual(['/images/wallpapers', '/chats/chat-1/metadata']);
  expect(calls[0].body.get('image').name).toBe('picture.png');
  expect(calls[1].body).toEqual({ wallpaper: { image_id: 'uploaded-image', type: 'image' } });
  expect(calls.some(item => item.method === 'DELETE')).toBe(false);
  calls = []; await saveCustomize(ctx, 'chat-1', { background: { remove: true } });
  expect(calls).toEqual([{ path: '/chats/chat-1/metadata', method: 'PATCH', body: { wallpaper: null } }]);
});
test('denied Chats permission and unsupported file input stop before upload or any settings save', async () => {
  grants = [];
  await expect(saveCustomize(ctx, 'chat-1', { appearance: defaultAppearance, background: { remove: true } })).rejects.toThrow('Chats permission');
  const snapshot = await loadCustomize(ctx, 'chat-1'); expect(snapshot.canEditBackground).toBe(false); expect(snapshot.chatWallpaper).toBeNull();
  expect(calls.every(item => item.method === 'GET')).toBe(true);
  calls = []; grants = ['chats'];
  const file = new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' });
  await expect(saveCustomize(ctx, 'chat-1', { background: { file } })).rejects.toThrow('PNG');
  expect(calls).toEqual([]);
});
test('partial-save failures report exactly what persisted and uploaded-but-unassigned image identity', async () => {
  failPath = '/chats/chat-1/metadata';
  const file = new File(['png'], 'picture.png', { type: 'image/png' });
  let result: CustomizeSaveError | undefined;
  try { await saveCustomize(ctx, 'chat-1', { appearance: defaultAppearance, background: { file } }); } catch (error) { result = error as CustomizeSaveError; }
  expect(result).toBeInstanceOf(CustomizeSaveError);
  expect(result!.saved).toEqual(['text']); expect(result!.uploadedImageId).toBe('uploaded-image');
  expect(result!.message).toContain('Saved text.'); expect(result!.message).toContain('was not assigned');
});
test('disabled native appearance roundtrips without enabling it just by loading', async () => {
  (store.componentOverrides as any)[appearanceOverrideName] = { css: appearanceCSS(defaultAppearance), tsx: '', enabled: false };
  const value = await loadCustomize(ctx, 'chat-1'); expect(value.appearanceEnabled).toBe(false);
  expect(calls.every(item => item.method === 'GET')).toBe(true);
});
