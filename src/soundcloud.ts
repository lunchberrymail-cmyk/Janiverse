import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

const PLAYER_ORIGIN = 'https://w.soundcloud.com';
const API_SCRIPT = `${PLAYER_ORIGIN}/player/api.js`;
const BLOCKED_MESSAGE = 'In-chat playback is blocked by this Lumiverse copy. You can open the track externally.';
const TRACK_ID = /^[1-9]\d{0,19}$/;
const SLUG = /^[a-z\d_-]+$/i;
const NON_TRACK_NAMES = new Set(['sets', 'tracks', 'albums', 'reposts', 'likes', 'popular-tracks', 'followers', 'following', 'comments']);
const NON_USERS = new Set(['discover', 'you', 'stream', 'charts', 'search', 'upload', 'pages', 'settings', 'messages', 'people', 'terms-of-use', 'mobile', 'tracks', 'playlists', 'sets', 'users', 'stations', 'tags', 'genres', 'subscriptions', 'pro', 'login', 'logout', 'connect', 'jobs', 'advertising', 'artists', 'cookies', 'imprint', 'copyright']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}

/** A public track only. Never forwards card-supplied query strings, credentials or HTML. */
export function soundCloudTrackUrl(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) return null;
    value = String(value);
  }
  if (typeof value !== 'string' || value.length > 2048) return null;
  const input = value.trim();
  if (TRACK_ID.test(input)) return `https://api.soundcloud.com/tracks/${input}`;
  // Encoded path separators/credentials and private tokens are deliberately unsupported.
  if (!/^https:\/\//i.test(input) || /[%\\\u0000-\u0020\u007f]/.test(input)) return null;
  try {
    const url = new URL(input);
    const rawPath = input.replace(/^https:\/\/[^/?#]+/i, '').split(/[?#]/, 1)[0];
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.searchParams.has('secret_token')) return null;
    if (url.hostname === 'api.soundcloud.com') {
      const match = /^\/tracks\/([1-9]\d{0,19})\/?$/.exec(rawPath);
      return match ? `https://api.soundcloud.com/tracks/${match[1]}` : null;
    }
    if (!['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) return null;
    if (!/^\/[a-z\d_-]+\/[a-z\d_-]+\/?$/i.test(rawPath)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || !parts.every(part => SLUG.test(part)) || NON_USERS.has(parts[0].toLowerCase()) || NON_TRACK_NAMES.has(parts[1].toLowerCase())) return null;
    return `https://soundcloud.com/${parts.join('/')}`;
  } catch { return null; }
}

/** Explicit known card fields; arbitrary card markup is never treated as an embed. */
export function characterSoundCloudTrack(character: unknown): string | null {
  const root = record(character);
  const extensions = record(root.extensions ?? record(root.data).extensions);
  for (const namespace of ['jar_bridge', 'janitor_ai', 'janitorai', 'janitor']) {
    const track = soundCloudTrackUrl(record(extensions[namespace]).soundcloud_track_id);
    if (track) return track;
  }
  return soundCloudTrackUrl(extensions.soundcloud_track_id);
}

/** Build the official widget URL locally: no oEmbed call or autoplay. */
export function soundCloudWidgetUrl(track: unknown): string | null {
  const canonical = soundCloudTrackUrl(track); if (!canonical) return null;
  const url = new URL('/player/', PLAYER_ORIGIN);
  url.search = new URLSearchParams({
    url: canonical, auto_play: 'false', color: '#dddddd', buying: 'false', sharing: 'true', download: 'false',
    show_artwork: 'false', show_playcount: 'false', show_user: 'true', show_comments: 'false', single_active: 'true',
  }).toString();
  return url.href;
}

/** Read the enforcing HTML policies without changing them. The browser also enforces response headers. */
export function soundCloudFrameAllowed(doc: Document = document): boolean {
  const player = new URL('/player/', PLAYER_ORIGIN);
  const matches = (source: string) => {
    if (source === '*') return true;
    if (source === "'self'") return new URL(doc.baseURI).origin === PLAYER_ORIGIN;
    if (source === 'https:') return true;
    if (!source.startsWith('https://')) return false;
    try {
      const url = new URL(source);
      const host = url.hostname.startsWith('*.') ? player.hostname.endsWith(url.hostname.slice(1)) : url.hostname === player.hostname;
      const path = url.pathname === '/' || (url.pathname.endsWith('/') ? player.pathname.startsWith(url.pathname) : player.pathname === url.pathname);
      return host && url.port === player.port && path && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  };
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[http-equiv]')) {
    if (meta.httpEquiv.toLowerCase() !== 'content-security-policy') continue;
    const directives = new Map<string, string[]>();
    for (const directive of meta.content.split(';')) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
    }
    const sources = directives.get('frame-src') ?? directives.get('child-src') ?? directives.get('default-src');
    if (sources && !sources.some(matches)) return false;
  }
  return true;
}

type WidgetEvent = 'READY' | 'PLAY' | 'PAUSE' | 'FINISH' | 'ERROR';
type Widget = {
  bind(event: string, listener: (payload?: unknown) => void): void;
  unbind(event: string): void;
  play(): void;
  pause(): void;
  getCurrentSound(callback: (sound: unknown) => void): void;
};
type WidgetFactory = ((frame: HTMLIFrameElement) => Widget) & { Events: Record<WidgetEvent, string> };
const apiLoads = new WeakMap<Document, Promise<WidgetFactory>>();
function existingApi(doc: Document): WidgetFactory | undefined {
  const factory = record(record(doc.defaultView).SC).Widget;
  if (typeof factory !== 'function') return;
  const events = (factory as WidgetFactory).Events;
  if (events && ['READY', 'PLAY', 'PAUSE', 'FINISH', 'ERROR'].every(name => typeof events[name as WidgetEvent] === 'string')) return factory as WidgetFactory;
}

/** Load SoundCloud's documented controller once, only after an explicit music request. */
function loadWidgetApi(doc: Document): Promise<WidgetFactory> {
  const existing = existingApi(doc); if (existing) return Promise.resolve(existing);
  const pending = apiLoads.get(doc); if (pending) return pending;
  const promise = new Promise<WidgetFactory>((resolve, reject) => {
    const script = doc.createElement('script'); script.src = API_SCRIPT; script.async = true; script.referrerPolicy = 'no-referrer';
    let timer: ReturnType<typeof setTimeout>;
    const clean = () => { clearTimeout(timer); script.onload = null; script.onerror = null; };
    const fail = () => { clean(); script.remove(); reject(new Error('SoundCloud controller unavailable')); };
    script.onload = () => { const factory = existingApi(doc); if (!factory) { fail(); return; } clean(); resolve(factory); };
    script.onerror = fail; timer = setTimeout(fail, 15_000);
    try { doc.head.append(script); } catch { fail(); }
  });
  apiLoads.set(doc, promise);
  void promise.catch(() => { if (apiLoads.get(doc) === promise) apiLoads.delete(doc); });
  return promise;
}

/** Compact controls for the official audio engine. No popup, waveform, or playback polling. */
export function createSoundCloud(ctx: SpindleFrontendContext, options: { characterId?: string; character?: unknown } = {}) {
  let disposed = false, request = 0, playerRequest = 0;
  let initialCharacter = options.character;
  let source: { chatId: string; characterId: string; track: string; url: string; name: string } | undefined;
  let frame: HTMLIFrameElement | undefined, headerBlocked = false;
  let widget: Widget | undefined, api: WidgetFactory | undefined;
  let ready = false, playing = false, pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanups: Array<() => void> = [];
  const root = el('section', 'jb-soundcloud'); root.hidden = true; root.setAttribute('aria-label', 'Character soundtrack');
  const bar = el('div', 'jb-soundcloud-bar');
  const label = el('span', 'jb-soundcloud-label', 'SoundCloud track');
  const play = el('button', 'jb-soundcloud-play', 'Play'); play.type = 'button'; play.setAttribute('aria-pressed', 'false');
  const open = el('a', 'jb-soundcloud-open', 'SoundCloud ↗'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
  const close = el('button', 'jb-soundcloud-close', 'Stop'); close.type = 'button'; close.hidden = true; close.title = 'Stop and unload the soundtrack';
  const status = el('p', 'jb-soundcloud-status'); status.hidden = true; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  bar.append(play, label, status, open, close); root.append(bar);

  function message(text: string) { status.textContent = text; status.title = text; status.hidden = !text; label.hidden = !!text; }
  function controls() {
    play.textContent = pending ? ready ? 'Starting…' : 'Loading…' : playing ? 'Pause' : 'Play';
    play.setAttribute('aria-pressed', String(playing));
    play.disabled = pending || headerBlocked || !soundCloudFrameAllowed();
    close.hidden = !frame && !pending;
  }
  function closePlayer(focus = false) {
    playerRequest++; clearTimeout(timer); timer = undefined;
    if (widget && api) for (const name of ['READY', 'PLAY', 'PAUSE', 'FINISH', 'ERROR'] as const) { try { widget.unbind(api.Events[name]); } catch { /* Removing the iframe also releases playback. */ } }
    widget = undefined; api = undefined; ready = false; playing = false; pending = false;
    frame?.remove(); frame = undefined; controls();
    if (focus && !play.disabled) play.focus();
  }
  function updatePolicy() {
    const allowed = !headerBlocked && soundCloudFrameAllowed(); controls();
    play.title = allowed ? 'Play or pause this soundtrack. SoundCloud loads only when you press Play.' : 'This Lumiverse copy currently blocks SoundCloud’s embedded player.';
    if (!allowed) { closePlayer(); message(BLOCKED_MESSAGE); }
    else if (status.textContent === BLOCKED_MESSAGE) message('');
    return allowed;
  }
  function clear() {
    closePlayer(); source = undefined; headerBlocked = false; root.hidden = true;
    root.removeAttribute('title'); open.removeAttribute('href'); label.textContent = 'SoundCloud track'; label.removeAttribute('title'); message('');
  }
  function active() {
    if (options.characterId) return { chatId: `profile:${options.characterId}`, characterId: options.characterId };
    try { return ctx.getActiveChat(); } catch { return { chatId: null, characterId: null }; }
  }
  function sourceCurrent() { const snapshot = active(); return !disposed && !!source && snapshot.chatId === source.chatId && snapshot.characterId === source.characterId; }
  function playbackFailed(text: string) { closePlayer(); message(text); }
  function requestPlayback(wantPlay: boolean) {
    if (!widget || !ready || !sourceCurrent()) return;
    const engine = widget, generation = playerRequest;
    clearTimeout(timer); pending = true; controls(); message('');
    timer = setTimeout(() => {
      if (generation !== playerRequest || !sourceCurrent()) return;
      pending = false;
      if (wantPlay) { controls(); message('Ready—press Play.'); }
      else playbackFailed('Pause did not respond. Playback was stopped.');
    }, 4_000);
    try { if (wantPlay) engine.play(); else engine.pause(); }
    catch { clearTimeout(timer); timer = undefined; pending = false; if (wantPlay) { controls(); message('Ready—press Play.'); } else playbackFailed('Playback was stopped.'); }
  }
  async function loadPlayer() {
    const generation = ++playerRequest; pending = true; controls(); message('');
    const current = () => generation === playerRequest && sourceCurrent();
    try {
      const factory = await loadWidgetApi(document); if (!current()) return;
      if (!updatePolicy()) { pending = false; controls(); return; }
      api = factory;
      frame = el('iframe', 'jb-soundcloud-engine'); frame.hidden = true; frame.tabIndex = -1; frame.setAttribute('aria-hidden', 'true');
      frame.title = 'SoundCloud playback engine'; frame.referrerPolicy = 'no-referrer'; frame.loading = 'eager';
      // SoundCloud owns the stream. Our small controls use only its documented Widget API.
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.setAttribute('allow', 'autoplay'); frame.src = source!.url; root.append(frame);
      const engine = factory(frame); widget = engine;
      const updatePlayback = (value: boolean) => { if (!current()) return; clearTimeout(timer); timer = undefined; playing = value; pending = false; controls(); message(''); };
      engine.bind(factory.Events.PLAY, () => updatePlayback(true));
      engine.bind(factory.Events.PAUSE, () => updatePlayback(false));
      engine.bind(factory.Events.FINISH, () => updatePlayback(false));
      engine.bind(factory.Events.ERROR, () => { if (current()) playbackFailed('Track unavailable here. Open SoundCloud or try again.'); });
      timer = setTimeout(() => { if (current() && !ready) playbackFailed('SoundCloud did not load. Open it or try again.'); }, 20_000);
      engine.bind(factory.Events.READY, () => {
        if (!current() || ready) return;
        clearTimeout(timer); timer = undefined; ready = true; pending = false; controls();
        try {
          engine.getCurrentSound(sound => {
            if (!current()) return;
            const track = record(sound), user = record(track.user);
            const title = typeof track.title === 'string' ? track.title.slice(0, 200) : '';
            const author = typeof user.username === 'string' ? user.username.slice(0, 100) : '';
            label.textContent = title ? `${title}${author ? ` — ${author}` : ''}` : 'SoundCloud track';
            label.title = label.textContent;
            const permalink = soundCloudTrackUrl(track.permalink_url);
            if (permalink?.startsWith('https://soundcloud.com/')) open.href = permalink;
          });
        } catch { /* Track metadata is optional; the SoundCloud source link remains available. */ }
        // This single attempt belongs to the user's Play click, never to chat opening or refresh.
        requestPlayback(true);
      });
      controls();
    } catch { if (current()) playbackFailed('Player could not load. Open SoundCloud or try again.'); }
  }
  play.addEventListener('click', () => {
    if (!sourceCurrent()) { clear(); void load(); return; }
    if (pending || !updatePolicy()) return;
    if (!widget || !ready) { void loadPlayer(); return; }
    requestPlayback(!playing);
  });
  close.addEventListener('click', () => { closePlayer(true); message(''); updatePolicy(); });
  open.addEventListener('click', event => { if (!sourceCurrent()) { event.preventDefault(); clear(); void load(); } });
  const onPolicyViolation = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent;
    if (pending && violation.disposition !== 'report' && ['script-src', 'script-src-elem'].includes(violation.effectiveDirective) && [API_SCRIPT, PLAYER_ORIGIN].includes(violation.blockedURI)) { closePlayer(); message('SoundCloud’s controller is blocked by this site’s script policy. Open SoundCloud to listen.'); return; }
    if (!frame || violation.disposition === 'report' || !['frame-src', 'child-src', 'default-src'].includes(violation.effectiveDirective)) return;
    try { if (new URL(violation.blockedURI).origin !== PLAYER_ORIGIN) return; } catch { return; }
    headerBlocked = true; closePlayer(); updatePolicy();
  };
  document.addEventListener('securitypolicyviolation', onPolicyViolation);
  cleanups.push(() => document.removeEventListener('securitypolicyviolation', onPolicyViolation));
  async function load() {
    const generation = ++request;
    if (disposed) return;
    const snapshot = active();
    if (!source || source.chatId !== snapshot.chatId || source.characterId !== snapshot.characterId) clear();
    if (!snapshot.chatId || !snapshot.characterId) { clear(); return; }
    const current = () => !disposed && generation === request && active().chatId === snapshot.chatId && active().characterId === snapshot.characterId;
    try {
      const supplied = initialCharacter; initialCharacter = undefined;
      const character = record(supplied ?? await ctx.characters.get(snapshot.characterId));
      if (!current()) return;
      if (typeof character.id === 'string' && character.id !== snapshot.characterId) { clear(); return; }
      const track = characterSoundCloudTrack(character); const url = soundCloudWidgetUrl(track); if (!track || !url) { clear(); return; }
      const name = typeof character.name === 'string' ? character.name.slice(0, 200) : '';
      if (source && source.track !== track) clear();
      source = { chatId: snapshot.chatId, characterId: snapshot.characterId, track, url, name };
      open.href = track.startsWith('https://soundcloud.com/') ? track : url;
      root.title = 'Character soundtrack on SoundCloud';
      open.setAttribute('aria-label', name ? `Open ${name} soundtrack on SoundCloud in a new tab` : 'Open character soundtrack on SoundCloud in a new tab');
      root.setAttribute('aria-label', name ? `${name} soundtrack` : 'Character soundtrack'); root.hidden = false; updatePolicy();
    } catch { if (current()) clear(); }
  }
  if (!options.characterId && ctx.state?.subscribe) {
    try { cleanups.push(ctx.state.subscribe('chat.active', () => { void load(); })); } catch { /* Older host: explicit refresh remains available. */ }
  }
  if (ctx.events?.on) {
    for (const event of ['CHAT_CHANGED', 'CHAT_DELETED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_LIBRARY_CHANGED']) {
      cleanups.push(ctx.events.on(event, () => { void load(); }));
    }
  }
  void load();
  return {
    root,
    refresh() { if (!disposed) void load(); },
    close() { if (!disposed) { closePlayer(); message(''); updatePolicy(); } },
    destroy() { if (disposed) return; disposed = true; request++; clear(); cleanups.splice(0).forEach(cleanup => cleanup()); root.remove(); },
  };
}
