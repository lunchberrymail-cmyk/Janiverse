import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { characterSoundCloudTrack, createSoundCloud, soundCloudFrameAllowed, soundCloudTrackUrl, soundCloudWidgetUrl } from '../src/soundcloud';

const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const allowedPolicy = "frame-src 'self' blob: https://www.youtube-nocookie.com https://w.soundcloud.com; child-src 'self' blob: https://www.youtube-nocookie.com https://w.soundcloud.com; object-src 'none'";
const blockedPolicy = "frame-src 'self' blob: https://www.youtube-nocookie.com; child-src 'self' blob: https://www.youtube-nocookie.com; object-src 'none'";
let dom: JSDOM, player: ReturnType<typeof createSoundCloud> | undefined;
let current: { chatId: string | null; characterId: string | null };
let read: (id: string) => Promise<unknown>, reads: string[];
let subscriptions: Map<string, Set<() => void>>, events: Map<string, Set<() => void>>;
let fetches: string[], engines: FakeEngine[], factory: ReturnType<typeof fakeApi>;
const originalFetch = globalThis.fetch, originalDocument = globalThis.document;
const node = <T extends Element = HTMLElement>(query: string) => document.querySelector<T>(query)!;
const card = (id = 'character-1', track: unknown = '123456') => ({ id, name: 'Example character', extensions: { jar_bridge: { soundcloud_track_id: track } } });
function policy(value: string) { node<HTMLMetaElement>('meta[http-equiv]').content = value; }
function emit(name = 'chat.active') { subscriptions.get(name)?.forEach(fn => fn()); events.get(name)?.forEach(fn => fn()); }
class FakeEngine {
  listeners = new Map<string, (payload?: unknown) => void>(); removed: string[] = []; commands: string[] = []; responds = true;
  sound: unknown = { title: 'A soundtrack', permalink_url: 'https://soundcloud.com/artist/song', user: { username: 'The uploader' } };
  constructor(readonly frame: HTMLIFrameElement) {}
  bind(name: string, callback: (payload?: unknown) => void) { this.listeners.set(name, callback); }
  unbind(name: string) { this.removed.push(name); this.listeners.delete(name); }
  emit(name: string) { this.listeners.get(name)?.(); }
  play() { this.commands.push('play'); if (this.responds) this.emit('play'); }
  pause() { this.commands.push('pause'); if (this.responds) this.emit('pause'); }
  getCurrentSound(callback: (sound: unknown) => void) { callback(this.sound); }
}
function fakeApi() {
  const api = (frame: HTMLIFrameElement) => { const engine = new FakeEngine(frame); engines.push(engine); return engine; };
  api.Events = { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error' }; return api;
}
function setApi(value: typeof factory | undefined) { (dom.window as any).SC = value ? { Widget: value } : undefined; }
function setup() {
  player = createSoundCloud({ getActiveChat: () => ({ ...current }), characters: { get(id: string) { reads.push(id); return read(id); } },
    state: { subscribe(key: string, fn: () => void) { const list = subscriptions.get(key) ?? new Set(); list.add(fn); subscriptions.set(key, list); return () => list.delete(fn); } },
    events: { on(key: string, fn: () => void) { const list = events.get(key) ?? new Set(); list.add(fn); events.set(key, list); return () => list.delete(fn); } },
  } as any); document.body.append(player.root); return player;
}
async function loadEngine(ready = true) { node<HTMLButtonElement>('.jb-soundcloud-play').click(); await settle(); const engine = engines.at(-1)!; if (ready) engine.emit('ready'); return engine; }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"></head><body><textarea id="native">Native draft</textarea></body></html>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document; policy(blockedPolicy); current = { chatId: 'chat-1', characterId: 'character-1' }; read = async id => card(id); reads = []; subscriptions = new Map(); events = new Map();
  engines = []; factory = fakeApi(); setApi(factory); fetches = []; globalThis.fetch = (async url => { fetches.push(String(url)); throw new Error('Unexpected fetch'); }) as typeof fetch;
});
afterEach(() => { player?.destroy(); player = undefined; globalThis.fetch = originalFetch; dom.window.close(); globalThis.document = originalDocument; });

describe('SoundCloud source boundaries', () => {
  test('accepts only numeric IDs or canonical public HTTPS track addresses', () => {
    expect(soundCloudTrackUrl(' 123456 ')).toBe('https://api.soundcloud.com/tracks/123456'); expect(soundCloudTrackUrl(42)).toBe('https://api.soundcloud.com/tracks/42');
    expect(soundCloudTrackUrl('https://api.soundcloud.com/tracks/42?client_id=do-not-forward')).toBe('https://api.soundcloud.com/tracks/42');
    expect(soundCloudTrackUrl('https://www.soundcloud.com/Artist/track-name?si=tracking&utm_source=share#t=2')).toBe('https://soundcloud.com/Artist/track-name');
    for (const invalid of [null, {}, '<iframe src="https://w.soundcloud.com/player/">', 'javascript:alert(1)', 'http://soundcloud.com/user/song', 'https://soundcloud.com.evil.test/user/song', 'https://user:password@soundcloud.com/user/song', 'https://soundcloud.com:444/user/song', 'https://evil.test/user/song', 'https://soundcloud.com/user', 'https://soundcloud.com/user/sets', 'https://soundcloud.com/user/sets/playlist', 'https://soundcloud.com/search/tracks', 'https://soundcloud.com/user/a/../b', 'https://soundcloud.com/user/%2ftrack', 'https://soundcloud.com/user/song?secret_token=s-secret', 'https://api.soundcloud.com/tracks/42/stream', '0', '-1', '1e5', Number.MAX_SAFE_INTEGER + 1]) expect(soundCloudTrackUrl(invalid)).toBeNull();
  });
  test('reads explicit known card namespaces, never arbitrary markup', () => {
    for (const namespace of ['jar_bridge', 'janitor_ai', 'janitorai', 'janitor']) expect(characterSoundCloudTrack({ extensions: { [namespace]: { soundcloud_track_id: '55' } } })).toBe('https://api.soundcloud.com/tracks/55');
    expect(characterSoundCloudTrack({ data: { extensions: { jar_bridge: { soundcloud_track_id: '66' } } } })).toBe('https://api.soundcloud.com/tracks/66'); expect(characterSoundCloudTrack({ extensions: { soundcloud_track_id: '77' } })).toBe('https://api.soundcloud.com/tracks/77');
    expect(characterSoundCloudTrack({ description: '<iframe src="https://evil.test">', extensions: { unknown: { soundcloud_track_id: '55' }, soundcloud: '<iframe>' } })).toBeNull();
  });
  test('official URL has no autoplay, private query strings or forced paid Mini mode', () => {
    const url = new URL(soundCloudWidgetUrl('https://soundcloud.com/user/song?client_id=private')!); expect(url.origin).toBe('https://w.soundcloud.com'); expect(url.pathname).toBe('/player/'); expect(url.searchParams.get('auto_play')).toBe('false');
    expect(url.searchParams.get('url')).toBe('https://soundcloud.com/user/song'); expect(url.searchParams.has('mini')).toBe(false); expect(url.href).not.toContain('private'); expect(soundCloudWidgetUrl('https://evil.test/song')).toBeNull();
  });
});

describe('host frame policy', () => {
  test('a blocked controller script gives immediate external-listening guidance', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle();
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); await settle();
    expect(document.querySelector('script[src="https://w.soundcloud.com/player/api.js"]')).not.toBeNull();
    const violation = new dom.window.Event('securitypolicyviolation');
    Object.defineProperties(violation, { blockedURI: { value: 'https://w.soundcloud.com/player/api.js' }, effectiveDirective: { value: 'script-src-elem' }, disposition: { value: 'enforce' } });
    document.dispatchEvent(violation);
    expect(node('.jb-soundcloud-status').textContent).toContain('script policy');
    expect(node('.jb-soundcloud-status').textContent).toContain('Open SoundCloud');
    expect(document.querySelector('iframe')).toBeNull();
  });

  test('respects all enforcing policies, directive fallbacks and response-header refusals', async () => {
    expect(soundCloudFrameAllowed()).toBe(false); policy(allowedPolicy); expect(soundCloudFrameAllowed()).toBe(true);
    for (const restricted of ["child-src 'self'", "default-src 'none'", "frame-src https://soundcloud.com", "frame-src https://w.soundcloud.com.evil.test", "frame-src https://w.soundcloud.com:444", "frame-src 'none'; frame-src https://w.soundcloud.com"]) { policy(restricted); expect(soundCloudFrameAllowed()).toBe(false); }
    policy("child-src https://w.soundcloud.com"); expect(soundCloudFrameAllowed()).toBe(true); const second = document.createElement('meta'); second.httpEquiv = 'Content-Security-Policy'; second.content = "frame-src 'self'"; document.head.append(second);
    expect(soundCloudFrameAllowed()).toBe(false); second.httpEquiv = 'Content-Security-Policy-Report-Only'; expect(soundCloudFrameAllowed()).toBe(true); second.remove(); node('meta').remove(); setup(); await settle(); await loadEngine();
    const violation = new dom.window.Event('securitypolicyviolation'); Object.defineProperties(violation, { blockedURI: { value: 'https://w.soundcloud.com/player/' }, effectiveDirective: { value: 'frame-src' }, disposition: { value: 'enforce' } }); document.dispatchEvent(violation);
    expect(document.querySelector('iframe')).toBeNull(); expect(node<HTMLButtonElement>('.jb-soundcloud-play').disabled).toBe(true); expect(node('.jb-soundcloud-status').textContent).toContain('blocked'); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toContain('soundcloud.com');
  });
});

describe('compact official playback controls', () => {
  test('opening a chat loads no controller, frame, media, remote request or playback', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle(); expect(reads).toEqual(['character-1']); expect(player!.root.hidden).toBe(false); expect(document.querySelector('iframe,script,audio,video,object,embed')).toBeNull(); expect(fetches).toHaveLength(0);
    const link = node<HTMLAnchorElement>('.jb-soundcloud-open'); expect(link.textContent).toContain('SoundCloud'); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noreferrer'); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Play'); expect(engines).toHaveLength(0);
  });
  test('one click loads a nonvisual official engine, plays once after READY, and updates from actual events', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(false); expect(engine.commands).toHaveLength(0); const frame = node<HTMLIFrameElement>('iframe');
    expect(frame.hidden).toBe(true); expect(frame.tabIndex).toBe(-1); expect(frame.getAttribute('aria-hidden')).toBe('true'); expect(frame.getAttribute('allow')).toBe('autoplay'); expect(new URL(frame.src).searchParams.get('auto_play')).toBe('false'); expect(frame.referrerPolicy).toBe('no-referrer'); expect(document.querySelector('.jb-soundcloud-player,.jb-soundcloud-frame')).toBeNull();
    engine.emit('ready'); expect(engine.commands).toEqual(['play']); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Pause'); expect(node('.jb-soundcloud-label').textContent).toBe('A soundtrack — The uploader'); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toBe('https://soundcloud.com/artist/song'); expect(node<HTMLButtonElement>('.jb-soundcloud-play').getAttribute('aria-pressed')).toBe('true');
    engine.emit('ready'); expect(engine.commands).toEqual(['play']); node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(engine.commands).toEqual(['play', 'pause']); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Play');
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(engine.commands).toEqual(['play', 'pause', 'play']); engine.emit('finish'); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Play'); expect(fetches).toHaveLength(0); expect(node<HTMLTextAreaElement>('#native').value).toBe('Native draft');
  });
  test('Stop unloads audio and all bindings, while typing outside the bar leaves music alone', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(); const frame = engine.frame; node('#native').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(frame.isConnected).toBe(true);
    node<HTMLButtonElement>('.jb-soundcloud-close').click(); expect(frame.isConnected).toBe(false); expect(engine.removed.sort()).toEqual(['error', 'finish', 'pause', 'play', 'ready']); expect(engine.listeners.size).toBe(0); expect(node<HTMLButtonElement>('.jb-soundcloud-close').hidden).toBe(true); expect(document.activeElement).toBe(node('.jb-soundcloud-play')); expect(document.querySelector('iframe')).toBeNull();
  });
  test('track metadata is inert text and cannot replace the official link with another domain', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(false);
    engine.sound = { title: '<img src=x onerror=alert(1)>', user: { username: '<script>bad</script>' }, permalink_url: 'https://evil.test/song' }; engine.emit('ready');
    expect(node('.jb-soundcloud-label').textContent).toContain('<img'); expect(document.querySelector('img,script')).toBeNull(); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').hostname).toBe('w.soundcloud.com'); expect(engine.commands).toEqual(['play']);
  });
  test('loads the exact official controller once and only on click', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); const script = node<HTMLScriptElement>('script');
    expect(script.src).toBe('https://w.soundcloud.com/player/api.js'); expect(script.async).toBe(true); expect(script.referrerPolicy).toBe('no-referrer'); expect(document.querySelector('iframe')).toBeNull();
    setApi(factory); script.dispatchEvent(new dom.window.Event('load')); await settle(); engines[0].emit('ready'); expect(engines[0].commands).toEqual(['play']); player!.close(); await loadEngine(); expect(document.querySelectorAll('script')).toHaveLength(1); expect(engines).toHaveLength(2);
  });
  test('controller failure keeps the link and permits retry without changing policy', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); node('script').dispatchEvent(new dom.window.Event('error')); await settle();
    expect(document.querySelector('script,iframe')).toBeNull(); expect(node('.jb-soundcloud-status').textContent).toContain('could not load'); expect(node<HTMLButtonElement>('.jb-soundcloud-play').disabled).toBe(false); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toContain('soundcloud.com'); expect(node<HTMLMetaElement>('meta').content).toBe(allowedPolicy);
    node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(document.querySelectorAll('script')).toHaveLength(1); node('script').dispatchEvent(new dom.window.Event('error')); await settle();
  });
  test('blocked playback exposes direct player controls without retrying; loading timeout unloads audio', async () => {
    const realSetTimeout = globalThis.setTimeout, callbacks = new Map<number, () => void>(); globalThis.setTimeout = ((callback: () => void, delay: number) => { callbacks.set(delay, callback); return -1; }) as any;
    try {
      policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(false); engine.responds = false; engine.emit('ready'); expect(engine.commands).toEqual(['play']); callbacks.get(4_000)!(); expect(engine.commands).toEqual(['play']); expect(node('.jb-soundcloud-status').textContent).toContain('player below'); expect(engine.frame.hidden).toBe(false); expect(node<HTMLButtonElement>('.jb-soundcloud-play').hidden).toBe(true);
      engine.emit('play'); expect(engine.commands).toEqual(['play']); expect(node('.jb-soundcloud-status').textContent).toBe(''); player!.close(); await loadEngine(false); callbacks.get(20_000)!(); expect(document.querySelector('iframe')).toBeNull(); expect(node('.jb-soundcloud-status').textContent).toContain('did not load');
    } finally { globalThis.setTimeout = realSetTimeout; }
  });
  test('controller load timeout removes the script and keeps a usable retry and external link', async () => {
    const realSetTimeout = globalThis.setTimeout; let timeout: (() => void) | undefined;
    globalThis.setTimeout = ((callback: () => void, delay: number) => { if (delay === 15_000) timeout = callback; return -1; }) as any;
    try {
      policy(allowedPolicy); setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(document.querySelector('script')).not.toBeNull(); timeout!(); await settle();
      expect(document.querySelector('script,iframe')).toBeNull(); expect(node<HTMLButtonElement>('.jb-soundcloud-play').disabled).toBe(false); expect(node<HTMLAnchorElement>('.jb-soundcloud-open').href).toContain('soundcloud.com');
    } finally { globalThis.setTimeout = realSetTimeout; }
  });
  test('errors unload the engine and stale callbacks cannot control its replacement', async () => {
    policy(allowedPolicy); setup(); await settle(); const old = await loadEngine(), stalePlay = old.listeners.get('play')!, staleReady = old.listeners.get('ready')!; old.emit('error'); expect(document.querySelector('iframe')).toBeNull(); expect(node('.jb-soundcloud-status').textContent).toContain('unavailable');
    const next = await loadEngine(false); staleReady(); stalePlay(); expect(next.commands).toHaveLength(0); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Loading…'); next.emit('ready'); expect(next.commands).toEqual(['play']);
  });
  test('Stop during controller loading cancels the pending audio request', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); const script = node('script'); node<HTMLButtonElement>('.jb-soundcloud-close').click(); setApi(factory); script.dispatchEvent(new dom.window.Event('load')); await settle();
    expect(document.querySelector('iframe')).toBeNull(); expect(engines).toHaveLength(0); expect(node<HTMLButtonElement>('.jb-soundcloud-play').textContent).toBe('Play');
  });
});

describe('direct playback inside the chat', () => {
  test('Android exposes the official player for its own Play gesture without requesting autoplay or leaving the chat', async () => {
    Object.defineProperty(dom.window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 16; wv)' });
    policy(allowedPolicy); setup(); await settle();
    const engine = await loadEngine(false), frame = engine.frame;
    expect(frame.hidden).toBe(false); expect(frame.tabIndex).toBe(0); expect(frame.hasAttribute('aria-hidden')).toBe(false);
    expect(frame.classList.contains('jb-soundcloud-frame')).toBe(true); expect(new URL(frame.src).searchParams.get('auto_play')).toBe('false');
    engine.emit('ready'); expect(engine.commands).toEqual([]); expect(node('.jb-soundcloud-status').textContent).toContain('player below');
    engine.emit('play'); expect(node('.jb-soundcloud-status').textContent).toBe('');
    node<HTMLTextAreaElement>('#native').value = 'An unsent roleplay draft'; node('#native').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(frame.isConnected).toBe(true); expect(engine.commands).toEqual([]); expect(node<HTMLTextAreaElement>('#native').value).toBe('An unsent roleplay draft');
    node<HTMLButtonElement>('.jb-soundcloud-close').click(); expect(frame.isConnected).toBe(false); expect(engine.listeners.size).toBe(0);
  });
  test('the Player control reveals an existing playing iframe without reloading or interrupting it', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine();
    node<HTMLButtonElement>('.jb-soundcloud-show').click();
    expect(node('iframe')).toBe(engine.frame); expect(engine.frame.hidden).toBe(false); expect(engines).toHaveLength(1); expect(engine.commands).toEqual(['play']);
    expect(node<HTMLButtonElement>('.jb-soundcloud-play').hidden).toBe(true); expect(node('.jb-soundcloud-status').textContent).toBe('');
  });
  test('direct player remains usable if its optional parent controller fails, until Stop or navigation', async () => {
    policy(allowedPolicy); setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-show').click();
    const frame = node<HTMLIFrameElement>('iframe'); expect(frame.hidden).toBe(false);
    node('script').dispatchEvent(new dom.window.Event('error')); await settle();
    expect(frame.isConnected).toBe(true); expect(node('.jb-soundcloud-status').textContent).toContain('player below');
    expect(node<HTMLButtonElement>('.jb-soundcloud-close').hidden).toBe(false); expect(fetches).toHaveLength(0);
    node<HTMLButtonElement>('.jb-soundcloud-close').click(); expect(document.querySelector('iframe')).toBeNull();
  });
  test('blocked Android host reports the required Lumiverse update without attempting another frame', async () => {
    Object.defineProperty(dom.window.navigator, 'userAgent', { value: 'Android; wv' }); setup(); await settle();
    node<HTMLButtonElement>('.jb-soundcloud-show').click(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); await settle();
    expect(document.querySelector('iframe,script')).toBeNull(); expect(node('.jb-soundcloud-status').textContent).toContain('updating Janiverse alone');
    expect(node<HTMLMetaElement>('meta').content).toBe(blockedPolicy);
  });
});

describe('native lifecycle isolation', () => {
  test('a profile soundtrack uses its own card without selecting or creating a chat, and releases playback on close', async () => {
    policy(allowedPolicy); current = { chatId: null, characterId: null };
    player = createSoundCloud({ characters: { get: async id => { reads.push(id); return card(id); } } } as any, { characterId: 'profile-card', character: card('profile-card') });
    document.body.append(player.root); await settle();
    expect(reads).toEqual([]); expect(player.root.hidden).toBe(false); expect(document.querySelector('iframe')).toBeNull();
    const engine = await loadEngine(); expect(engine.commands).toEqual(['play']); expect(current).toEqual({ chatId: null, characterId: null });
    player.destroy(); player = undefined; expect(engine.frame.isConnected).toBe(false); expect(engine.listeners.size).toBe(0);
  });
  test('blocked frame policy does not load a controller or attempt audio', async () => {
    setApi(undefined); setup(); await settle(); node<HTMLButtonElement>('.jb-soundcloud-play').click(); expect(document.querySelector('script,iframe')).toBeNull(); expect(node<HTMLMetaElement>('meta').content).toBe(blockedPolicy); expect(node('.jb-soundcloud-status').textContent).toContain('blocked');
    policy(allowedPolicy); player!.refresh(); await settle(); expect(node<HTMLButtonElement>('.jb-soundcloud-play').disabled).toBe(false); expect(node<HTMLParagraphElement>('.jb-soundcloud-status').hidden).toBe(true);
  });
  test('same-chat refresh retains audio; changed or invalid soundtracks unload it', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(); emit('CHAT_CHANGED'); await settle(); expect(node('iframe')).toBe(engine.frame); expect(engine.commands).toEqual(['play']);
    read = async id => card(id, '222'); emit('CHARACTER_EDITED'); await settle(); expect(engine.frame.isConnected).toBe(false); expect(document.querySelector('iframe')).toBeNull(); const next = await loadEngine(); expect(new URL(next.frame.src).searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/222');
    read = async () => card('wrong-character'); player!.refresh(); await settle(); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(true);
  });
  test('navigation unloads immediately, rejects stale reads and never starts the next track', async () => {
    policy(allowedPolicy); setup(); await settle(); await loadEngine(); let resolveOld: (value: unknown) => void = () => {}; read = () => new Promise(resolve => { resolveOld = resolve; }); current = { chatId: 'chat-2', characterId: 'character-2' }; emit(); expect(document.querySelector('iframe')).toBeNull(); expect(player!.root.hidden).toBe(true);
    current = { chatId: 'chat-3', characterId: 'character-3' }; read = async id => card(id, '333'); emit(); await settle(); resolveOld(card('character-2', '222')); await settle(); expect(new URL(node<HTMLAnchorElement>('.jb-soundcloud-open').href).searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/333'); expect(document.querySelector('iframe')).toBeNull(); expect(engines).toHaveLength(1);
  });
  test('close and shutdown remove audio, bindings and subscriptions without changing the draft', async () => {
    policy(allowedPolicy); setup(); await settle(); const engine = await loadEngine(); player!.close(); expect(engine.frame.isConnected).toBe(false); expect(player!.root.hidden).toBe(false); await loadEngine(); const last = engines.at(-1)!, instance = player!; instance.destroy(); player = undefined; emit('CHAT_CHANGED'); instance.refresh(); await settle();
    expect(last.frame.isConnected).toBe(false); expect(last.listeners.size).toBe(0); expect(document.querySelector('.jb-soundcloud,iframe')).toBeNull(); expect([...subscriptions.values(), ...events.values()].every(list => list.size === 0)).toBe(true); expect(node<HTMLTextAreaElement>('#native').value).toBe('Native draft');
  });
  test('no selected chat does no reads; teardown ignores late character data', async () => {
    current = { chatId: null, characterId: null }; setup(); await settle(); expect(reads).toHaveLength(0); let resolve: (value: unknown) => void = () => {}; read = () => new Promise(done => { resolve = done; }); current = { chatId: 'chat-1', characterId: 'character-1' }; emit(); player!.destroy(); player = undefined; resolve(card()); await settle(); expect(document.querySelector('.jb-soundcloud,iframe,script')).toBeNull(); expect(fetches).toHaveLength(0);
  });
});
