import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { characterSoundCloudTrack, createSoundCloud, soundCloudFrameAllowed, soundCloudTrackUrl, soundCloudWidgetUrl } from '../src/soundcloud';

const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const allowedPolicy = "frame-src 'self' blob: https://www.youtube-nocookie.com https://w.soundcloud.com; child-src 'self' blob: https://www.youtube-nocookie.com https://w.soundcloud.com; object-src 'none'";
const blockedPolicy = "frame-src 'self' blob: https://www.youtube-nocookie.com; child-src 'self' blob: https://www.youtube-nocookie.com; object-src 'none'";
let dom: JSDOM, player: ReturnType<typeof createSoundCloud> | undefined;
let current: { chatId: string | null; characterId: string | null };
let read: (id: string) => Promise<unknown>, reads: string[];
let subscriptions: Map<string, Set<() => void>>;
let events: Map<string, Set<() => void>>;
let fetches: string[];
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const node = <T extends Element = HTMLElement>(query: string) => document.querySelector<T>(query)!;
const card = (id = 'character-1', track: unknown = '123456') => ({ id, name: 'Example character', extensions: { jar_bridge: { soundcloud_track_id: track } } });
function policy(value: string) { node<HTMLMetaElement>('meta[http-equiv]').content = value; }
function emit(name = 'chat.active') { subscriptions.get(name)?.forEach(fn => fn()); events.get(name)?.forEach(fn => fn()); }
function setup() {
  player = createSoundCloud({
    getActiveChat: () => ({ ...current }),
    characters: { get(id: string) { reads.push(id); return read(id); } },
    state: { subscribe(key: string, fn: () => void) { const list = subscriptions.get(key) ?? new Set(); list.add(fn); subscriptions.set(key, list); return () => list.delete(fn); } },
    events: { on(key: string, fn: () => void) { const list = events.get(key) ?? new Set(); list.add(fn); events.set(key, list); return () => list.delete(fn); } },
  } as any);
  document.body.append(player.root); return player;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"></head><body><textarea id="native">Native draft</textarea></body></html>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document; policy(blockedPolicy);
  current = { chatId: 'chat-1', characterId: 'character-1' }; read = async id => card(id); reads = []; subscriptions = new Map(); events = new Map();
  fetches = []; globalThis.fetch = (async url => { fetches.push(String(url)); throw new Error('Unexpected remote fetch'); }) as typeof fetch;
});
afterEach(() => { player?.destroy(); player = undefined; globalThis.fetch = originalFetch; dom.window.close(); globalThis.document = originalDocument; });

describe('SoundCloud source boundaries', () => {
  test('accepts only numeric IDs or canonical public HTTPS track addresses', () => {
    expect(soundCloudTrackUrl(' 123456 ')).toBe('https://api.soundcloud.com/tracks/123456');
    expect(soundCloudTrackUrl(42)).toBe('https://api.soundcloud.com/tracks/42');
    expect(soundCloudTrackUrl('https://api.soundcloud.com/tracks/42?client_id=do-not-forward')).toBe('https://api.soundcloud.com/tracks/42');
    expect(soundCloudTrackUrl('https://www.soundcloud.com/Artist/track-name?si=tracking&utm_source=share#t=2')).toBe('https://soundcloud.com/Artist/track-name');
    for (const invalid of [null, {}, '<iframe src="https://w.soundcloud.com/player/">', 'javascript:alert(1)', 'http://soundcloud.com/user/song', 'https://soundcloud.com.evil.test/user/song', 'https://user:password@soundcloud.com/user/song', 'https://soundcloud.com:444/user/song', 'https://evil.test/user/song', 'https://soundcloud.com/user', 'https://soundcloud.com/user/sets', 'https://soundcloud.com/user/sets/playlist', 'https://soundcloud.com/search/tracks', 'https://soundcloud.com/user/a/../b', 'https://soundcloud.com/user/%2ftrack', 'https://soundcloud.com/user/song?secret_token=s-secret', 'https://api.soundcloud.com/tracks/42/stream', '0', '-1', '1e5', Number.MAX_SAFE_INTEGER + 1]) {
      expect(soundCloudTrackUrl(invalid)).toBeNull();
    }
  });

  test('reads explicit known card namespaces, preserving unrelated metadata as inert', () => {
    for (const namespace of ['jar_bridge', 'janitor_ai', 'janitorai', 'janitor']) expect(characterSoundCloudTrack({ extensions: { [namespace]: { soundcloud_track_id: '55' } } })).toBe('https://api.soundcloud.com/tracks/55');
    expect(characterSoundCloudTrack({ data: { extensions: { jar_bridge: { soundcloud_track_id: '66' } } } })).toBe('https://api.soundcloud.com/tracks/66');
    expect(characterSoundCloudTrack({ extensions: { soundcloud_track_id: '77' } })).toBe('https://api.soundcloud.com/tracks/77');
    expect(characterSoundCloudTrack({ description: '<iframe src="https://evil.test">', extensions: { unknown: { soundcloud_track_id: '55' }, soundcloud: '<iframe>' } })).toBeNull();
  });

  test('builds a single official widget URL without autoplay or copied query credentials', () => {
    const url = new URL(soundCloudWidgetUrl('https://soundcloud.com/user/song?client_id=private')!);
    expect(url.origin).toBe('https://w.soundcloud.com'); expect(url.pathname).toBe('/player/');
    expect(url.searchParams.get('url')).toBe('https://soundcloud.com/user/song'); expect(url.searchParams.get('auto_play')).toBe('false');
    expect(url.href).not.toContain('private'); expect(soundCloudWidgetUrl('https://evil.test/song')).toBeNull();
  });

});

describe('host frame policy', () => {
  test('requires every enforcing policy to permit the official widget, respecting native fallback directives', () => {
    expect(soundCloudFrameAllowed()).toBe(false);
    policy(allowedPolicy); expect(soundCloudFrameAllowed()).toBe(true);
    for (const restricted of ["child-src 'self'", "default-src 'none'", "frame-src https://soundcloud.com", "frame-src https://w.soundcloud.com.evil.test", "frame-src https://w.soundcloud.com:444", "frame-src 'none'; frame-src https://w.soundcloud.com"]) {
      policy(restricted); expect(soundCloudFrameAllowed()).toBe(false);
    }
    policy("child-src https://w.soundcloud.com"); expect(soundCloudFrameAllowed()).toBe(true);
    const second = document.createElement('meta'); second.httpEquiv = 'Content-Security-Policy'; second.content = "frame-src 'self'"; document.head.append(second);
    expect(soundCloudFrameAllowed()).toBe(false);
    second.httpEquiv = 'Content-Security-Policy-Report-Only'; expect(soundCloudFrameAllowed()).toBe(true);
    second.remove(); node('meta').remove(); expect(soundCloudFrameAllowed()).toBe(true);
  });
});

describe('soundtrack lifecycle and native isolation', () => {
  test('offers both choices without loading a player, SDK, media, or remote request on open', async () => {
    policy(allowedPolicy);
    setup(); await settle();
    expect(reads).toEqual(['character-1']); expect(player!.root.hidden).toBe(false);
    expect(player!.root.title).toBe('Character soundtrack on SoundCloud');
    expect(document.querySelector('iframe, script, audio, video, object, embed')).toBeNull(); expect(fetches).toHaveLength(0);
    const link = node<HTMLAnchorElement>('.jb-soundcloud-open'); expect(link.hostname).toBe('w.soundcloud.com'); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noreferrer');
    expect(link.textContent).toBe('Open externally'); expect(link.referrerPolicy).toBe('no-referrer'); expect(link.getAttribute('aria-label')).toContain('in a new tab');
    const play = node<HTMLButtonElement>('.jb-soundcloud-play'); expect(play.textContent).toBe('Play in chat'); expect(play.disabled).toBe(false); expect(play.getAttribute('aria-expanded')).toBe('false');
    expect(node<HTMLButtonElement>('.jb-soundcloud-close').hidden).toBe(true);
    expect(node<HTMLTextAreaElement>('#native').value).toBe('Native draft');
  });

  test('blocked policy keeps the external choice and never changes host policy or tries a frame', async () => {
    setup(); await settle();
    const play = node<HTMLButtonElement>('.jb-soundcloud-play'); expect(play.disabled).toBe(true); play.click();
    expect(node('.jb-soundcloud-status').textContent).toContain('blocked'); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toStartWith('https://w.soundcloud.com/player/');
    expect(document.querySelector('iframe')).toBeNull(); expect(node<HTMLMetaElement>('meta').content).toBe(blockedPolicy); expect(fetches).toHaveLength(0);
    policy(allowedPolicy); player!.refresh(); await settle(); expect(play.disabled).toBe(false); expect(node<HTMLParagraphElement>('.jb-soundcloud-status').hidden).toBe(true);
  });

  test('explicit play loads one official non-autoplay frame, close unloads it, and Escape restores the button', async () => {
    policy(allowedPolicy); setup(); await settle();
    const play = node<HTMLButtonElement>('.jb-soundcloud-play'); play.click(); play.click();
    const frame = node<HTMLIFrameElement>('iframe'); const url = new URL(frame.src);
    expect(document.querySelectorAll('iframe')).toHaveLength(1); expect(url.origin).toBe('https://w.soundcloud.com'); expect(url.pathname).toBe('/player/'); expect(url.searchParams.get('auto_play')).toBe('false'); expect(url.searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/123456');
    expect(frame.referrerPolicy).toBe('no-referrer'); expect(frame.getAttribute('sandbox')).toContain('allow-scripts'); expect(frame.getAttribute('allow')).toBeNull();
    expect(play.hidden).toBe(true); expect(play.getAttribute('aria-expanded')).toBe('true'); expect(document.querySelector('script, audio, video, object, embed')).toBeNull(); expect(fetches).toHaveLength(0);
    node<HTMLButtonElement>('.jb-soundcloud-close').click(); expect(frame.isConnected).toBe(false); expect(document.querySelector('iframe')).toBeNull(); expect(document.activeElement).toBe(play); expect(play.hidden).toBe(false); expect(play.getAttribute('aria-expanded')).toBe('false');
    play.click(); expect(document.querySelectorAll('iframe')).toHaveLength(1);
    player!.root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('iframe')).toBeNull(); expect(document.activeElement).toBe(play); expect(node<HTMLTextAreaElement>('#native').value).toBe('Native draft');
  });

  test('same-chat refresh retains the player, changed or invalid soundtrack unloads it', async () => {
    policy(allowedPolicy); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click();
    const original = node('iframe'); emit('CHAT_CHANGED'); await settle(); expect(node('iframe')).toBe(original);
    read = async id => card(id, '222'); emit('CHARACTER_EDITED'); await settle(); expect(original.isConnected).toBe(false); expect(document.querySelector('iframe')).toBeNull();
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(new URL(node<HTMLIFrameElement>('iframe').src).searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/222');
    read = async () => card('wrong-character'); player!.refresh(); await settle(); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(true);
  });

  test('chat navigation hides old soundtrack immediately and rejects stale character reads', async () => {
    policy(allowedPolicy); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(document.querySelector('iframe')).not.toBeNull();
    let resolveOld: (value: unknown) => void = () => {}; read = () => new Promise(resolve => { resolveOld = resolve; });
    current = { chatId: 'chat-2', characterId: 'character-2' }; emit(); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(true); expect(node('.jb-soundcloud-open').hasAttribute('href')).toBe(false);
    current = { chatId: 'chat-3', characterId: 'character-3' }; read = async id => card(id, '333'); emit(); await settle();
    resolveOld(card('character-2', '222')); await settle();
    expect(new URL(node<HTMLAnchorElement>('.jb-soundcloud-open').href).searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/333');
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); current = { chatId: null, characterId: null }; emit(); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(true);
  });

  test('a response-header frame refusal unloads the attempted player and explains the external fallback', async () => {
    // No meta policy can reveal an HTTP response header. Let the browser report enforcement.
    node('meta').remove(); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click();
    const violation = (blockedURI: string, disposition = 'enforce') => {
      const event = new dom.window.Event('securitypolicyviolation');
      Object.defineProperties(event, { blockedURI: { value: blockedURI }, effectiveDirective: { value: 'frame-src' }, disposition: { value: disposition } }); document.dispatchEvent(event);
    };
    violation('https://other.example'); violation('https://w.soundcloud.com', 'report'); expect(document.querySelector('iframe')).not.toBeNull();
    violation('https://w.soundcloud.com/player/'); expect(document.querySelector('iframe')).toBeNull(); expect(node<HTMLButtonElement>('.jb-soundcloud-play').disabled).toBe(true); expect(node('.jb-soundcloud-status').textContent).toContain('blocked'); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toContain('w.soundcloud.com');
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(document.querySelector('iframe')).toBeNull(); expect(fetches).toHaveLength(0);
  });

  test('character edits with removed/invalid soundtracks hide the link, failed reads stay hidden', async () => {
    setup(); await settle();
    read = async id => card(id, 'https://evil.test/track'); emit('CHARACTER_EDITED'); expect(document.querySelector('iframe')).toBeNull(); await settle(); expect(player!.root.hidden).toBe(true);
    read = async () => { throw new Error('Unavailable'); }; player!.refresh(); await settle(); expect(player!.root.hidden).toBe(true);
    read = async () => card('wrong-character'); player!.refresh(); await settle(); expect(player!.root.hidden).toBe(true);
  });

  test('public track link opens the canonical SoundCloud track and never forwards tracking values', async () => {
    read = async id => card(id, 'https://www.soundcloud.com/artist/song?si=private-tracking'); setup(); await settle();
    const link = node<HTMLAnchorElement>('.jb-soundcloud-open'); expect(link.href).toBe('https://soundcloud.com/artist/song'); expect(link.referrerPolicy).toBe('no-referrer');
    // Observe the external choice without opening a browser in this unit test.
    link.addEventListener('click', event => event.preventDefault()); link.click(); await settle();
    expect(fetches).toHaveLength(0); expect(document.querySelector('iframe, script, audio, video, object, embed')).toBeNull();
  });

  test('no active chat does no reads; destroy removes subscriptions and ignores late results', async () => {
    current = { chatId: null, characterId: null }; setup(); await settle(); expect(reads).toHaveLength(0);
    let resolve: (value: unknown) => void = () => {}; read = () => new Promise(done => { resolve = done; });
    current = { chatId: 'chat-1', characterId: 'character-1' }; emit(); player!.destroy(); player = undefined;
    resolve(card()); await settle(); expect(document.querySelector('.jb-soundcloud')).toBeNull(); expect(document.querySelector('iframe')).toBeNull();
    expect([...subscriptions.values(), ...events.values()].every(list => list.size === 0)).toBe(true); expect(node<HTMLTextAreaElement>('#native').value).toBe('Native draft');
  });

  test('extension shutdown immediately destroys a loaded player and ignores later events', async () => {
    policy(allowedPolicy); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click();
    const frame = node('iframe'); const instance = player!; instance.destroy(); player = undefined; emit('CHAT_CHANGED'); instance.refresh(); await settle();
    expect(frame.isConnected).toBe(false); expect(document.querySelector('.jb-soundcloud, iframe')).toBeNull(); expect(reads).toHaveLength(1); expect([...subscriptions.values(), ...events.values()].every(list => list.size === 0)).toBe(true); expect(fetches).toHaveLength(0);
  });

  test('host navigation can stop playback even when the active chat remains selected', async () => {
    policy(allowedPolicy); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click();
    const frame = node('iframe'); player!.close(); expect(frame.isConnected).toBe(false); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(false); expect(node<HTMLButtonElement>('.jb-soundcloud-play').hidden).toBe(false);
    player!.refresh(); await settle(); expect(document.querySelector('iframe')).toBeNull(); expect(fetches).toHaveLength(0);
  });
});
