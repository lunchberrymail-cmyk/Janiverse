import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

const PLAYER_ORIGIN = 'https://w.soundcloud.com';
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

/** Build the official widget URL locally: no oEmbed call, SDK, or autoplay. */
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

let playerId = 0;

/** The official player loads only after a click, and owns no SDK, polling, or autoplay. */
export function createSoundCloud(ctx: SpindleFrontendContext) {
  let disposed = false, request = 0;
  let source: { chatId: string; characterId: string; track: string; url: string; name: string } | undefined;
  let frame: HTMLIFrameElement | undefined, headerBlocked = false;
  const cleanups: Array<() => void> = [];
  const root = el('section', 'jb-soundcloud'); root.hidden = true; root.setAttribute('aria-label', 'Character soundtrack');
  const bar = el('div', 'jb-soundcloud-bar');
  const label = el('span', 'jb-soundcloud-label', 'SoundCloud track');
  const play = el('button', 'jb-soundcloud-play', 'Play in chat'); play.type = 'button'; play.setAttribute('aria-expanded', 'false');
  const open = el('a', 'jb-soundcloud-open', 'Open externally'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
  const close = el('button', 'jb-soundcloud-close', 'Close player'); close.type = 'button'; close.hidden = true;
  const content = el('div', 'jb-soundcloud-player'); content.id = `jb-soundcloud-player-${++playerId}`; content.hidden = true; play.setAttribute('aria-controls', content.id);
  const status = el('p', 'jb-soundcloud-status'); status.hidden = true; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  bar.append(label, play, open, close); root.append(bar, content, status);

  function message(text: string) { status.textContent = text; status.hidden = !text; }
  function closePlayer(focus = false) {
    frame?.remove(); frame = undefined; content.replaceChildren(); content.hidden = true;
    close.hidden = true; play.hidden = false; play.setAttribute('aria-expanded', 'false');
    if (focus && !play.disabled) play.focus();
  }
  function updatePolicy() {
    const allowed = !headerBlocked && soundCloudFrameAllowed(); play.disabled = !allowed;
    play.title = allowed ? 'Load SoundCloud’s official player. Audio will not start automatically.' : 'This Lumiverse copy currently blocks SoundCloud’s embedded player.';
    if (!allowed) { closePlayer(); message(BLOCKED_MESSAGE); }
    else if (status.textContent === BLOCKED_MESSAGE) message('');
    return allowed;
  }
  function clear() {
    closePlayer(); source = undefined; headerBlocked = false; root.hidden = true;
    root.removeAttribute('title'); open.removeAttribute('href'); message('');
  }
  function active() { try { return ctx.getActiveChat(); } catch { return { chatId: null, characterId: null }; } }
  function sourceCurrent() { const snapshot = active(); return !disposed && !!source && snapshot.chatId === source.chatId && snapshot.characterId === source.characterId; }
  play.addEventListener('click', () => {
    if (!sourceCurrent()) { clear(); void load(); return; }
    if (frame || !updatePolicy()) return;
    frame = el('iframe', 'jb-soundcloud-frame'); frame.title = source!.name ? `SoundCloud soundtrack for ${source!.name}` : 'SoundCloud soundtrack';
    frame.referrerPolicy = 'no-referrer'; frame.loading = 'eager'; frame.height = '166'; frame.width = '100%';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.src = source!.url; content.append(frame); content.hidden = false; close.hidden = false; play.hidden = true; play.setAttribute('aria-expanded', 'true');
    message('Press Play in the SoundCloud player. Close player unloads it.');
  });
  close.addEventListener('click', () => { closePlayer(true); message(''); updatePolicy(); });
  open.addEventListener('click', event => { if (!sourceCurrent()) { event.preventDefault(); clear(); void load(); } });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && frame) { event.preventDefault(); event.stopPropagation(); closePlayer(true); message(''); updatePolicy(); } });
  const onPolicyViolation = (event: Event) => {
    const violation = event as SecurityPolicyViolationEvent;
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
      const character = record(await ctx.characters.get(snapshot.characterId));
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
  if (ctx.state?.subscribe) {
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
