import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { characterSoundCloudTrack, soundCloudTrackInput } from '../src/soundcloud';
import { createSoundtrackField, mountSoundtrackEditor } from '../src/soundtrack-field';

const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const embed = '<iframe width="100%" height="166" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123&amp;auto_play=true&amp;visual=true"></iframe>';
const original = { document: globalThis.document, fetch: globalThis.fetch };
let dom: JSDOM, cleanup: (() => void) | undefined, ctx: any, character: any, grants: string[], permissionCalls: number, refreshed: number;
let writes: Array<{ url: string; init: RequestInit }>, respond: (init: RequestInit) => Promise<Response>;
const input = () => document.querySelector<HTMLTextAreaElement>('[name="soundcloud_track"]')!;
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;
function mount() { cleanup = mountSoundtrackEditor(ctx, document.body, character, () => { refreshed++; }); }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:7860/' }); globalThis.document = dom.window.document;
  character = { id: 'card/1', extensions: { jar_bridge: { soundcloud_track_id: '41', creator_name: 'Author' }, world_book_ids: ['book'], janiverse: { other: true } } };
  writes = []; grants = ['characters']; permissionCalls = 0; refreshed = 0;
  respond = async init => { character = { ...character, ...JSON.parse(String(init.body)) }; return Response.json(character); };
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { writes.push({ url: String(url), init }); return respond(init); }) as typeof fetch;
  ctx = { characters: { get: async () => character }, permissions: { getGranted: async () => [...grants], request: async () => { permissionCalls++; } } };
});
afterEach(() => { cleanup?.(); cleanup = undefined; dom.window.close(); globalThis.document = original.document; globalThis.fetch = original.fetch; });

test('extracts a public track from links, player URLs and inert official iframe code', () => {
  expect(soundCloudTrackInput('https://soundcloud.com/artist/song?si=tracking')).toBe('https://soundcloud.com/artist/song');
  expect(soundCloudTrackInput(embed)).toBe('https://api.soundcloud.com/tracks/123');
  expect(soundCloudTrackInput('https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsong')).toBe('https://soundcloud.com/artist/song');
  expect(soundCloudTrackInput(embed + '<div><a href="https://soundcloud.com/artist">Artist credit</a></div>')).toBe('https://api.soundcloud.com/tracks/123');
  expect(document.querySelector('iframe,script')).toBeNull(); expect(writes).toEqual([]);
});

test('rejects untrusted embed origins, private tracks, ambiguous sources and playlists', () => {
  for (const value of [embed.replace('w.soundcloud.com', 'w.soundcloud.com.evil.test'), embed.replace('w.soundcloud.com', 'user:pass@w.soundcloud.com'), embed.replace('/tracks/123', '/playlists/123'), embed.replace('/tracks/123', '/tracks/123?secret_token=private'), embed + embed, '<script>bad()</script>' + embed, 'https://w.soundcloud.com/player/?url=https://evil.test/track', 'https://w.soundcloud.com/player/?url=123&url=124', 'https://soundcloud.com/artist/sets/playlist', 'x'.repeat(12_001)]) expect(soundCloudTrackInput(value)).toBeNull();
});

test('local extraction discards markup and explains playback without saving or loading media', () => {
  const field = createSoundtrackField(); document.body.append(field.root); input().value = embed;
  button('Extract track').click(); expect(input().value).toBe('https://api.soundcloud.com/tracks/123');
  expect(field.root.textContent).toContain('music never starts automatically');
  expect(document.querySelector('iframe,script')).toBeNull(); expect(writes).toEqual([]); expect(permissionCalls).toBe(0);
});

test('saving overrides imported music and preserves fresh lorebooks, attribution and unrelated extensions', async () => {
  mount(); input().value = embed;
  character.extensions.late_extension = { saved: 'after opening' };
  const save = button('Save soundtrack'); save.click(); save.click(); await settle();
  expect(writes).toHaveLength(1); expect(writes[0].url).toBe('/api/v1/characters/card%2F1'); expect(writes[0].init.method).toBe('PUT'); expect(writes[0].init.credentials).toBe('same-origin');
  expect(JSON.parse(String(writes[0].init.body))).toEqual({ extensions: { jar_bridge: { soundcloud_track_id: '41', creator_name: 'Author' }, world_book_ids: ['book'], late_extension: { saved: 'after opening' }, janiverse: { other: true, soundcloud_track_id: 'https://api.soundcloud.com/tracks/123' } } });
  expect(characterSoundCloudTrack(character)).toBe('https://api.soundcloud.com/tracks/123'); expect(refreshed).toBe(1);
  expect(document.body.textContent).toContain('Soundtrack saved'); expect(document.querySelector('iframe,script')).toBeNull();
});

test('removing an imported song persists an explicit empty attachment rather than reviving the source track', async () => {
  mount(); button('Remove soundtrack').click(); await settle();
  expect(characterSoundCloudTrack(character)).toBeNull(); expect(character.extensions.jar_bridge.soundcloud_track_id).toBe('41');
  expect(character.extensions.janiverse.soundcloud_track_id).toBeNull(); expect(document.querySelector('summary')!.textContent).toBe('Attach a song (optional)');
  expect(document.body.textContent).toContain('Soundtrack removed'); expect(refreshed).toBe(1);
});

test('invalid input never requests permission; denied permission keeps the draft and enabling alone never writes', async () => {
  mount(); input().value = '<iframe src="https://evil.test"></iframe>'; button('Save soundtrack').click(); await settle();
  expect(input().getAttribute('aria-invalid')).toBe('true'); expect(permissionCalls).toBe(0); expect(writes).toEqual([]);
  grants = []; input().value = embed; button('Save soundtrack').click(); await settle();
  expect(permissionCalls).toBe(1); expect(input().value).toBe(embed); expect(writes).toEqual([]);
  button('Enable Characters permission').click(); await settle(); expect(permissionCalls).toBe(2); expect(writes).toEqual([]);
  grants = ['characters']; button('Save soundtrack').click(); await settle(); expect(writes).toHaveLength(1);
});

test('unconfirmed saves retain the draft and dismissal prevents a late read from writing', async () => {
  respond = async () => { throw new Error('lost response'); }; mount(); input().value = embed; button('Save soundtrack').click(); await settle();
  expect(document.body.textContent).toContain('could not be confirmed'); expect(input().value).toBe(embed); expect(refreshed).toBe(0);
  let release!: (value: unknown) => void; ctx.characters.get = () => new Promise(resolve => { release = resolve; });
  button('Save soundtrack').click(); await settle(); cleanup!(); release(character); await settle();
  expect(writes).toHaveLength(1); expect(document.body.children).toHaveLength(0);
});
