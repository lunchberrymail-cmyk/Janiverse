import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

const PLAYER_ORIGIN = 'https://w.soundcloud.com';
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

/** Lightweight soundtrack link: no embedded player, SDK, remote fetch, or autoplay. */
export function createSoundCloud(ctx: SpindleFrontendContext) {
  let disposed = false, request = 0;
  const cleanups: Array<() => void> = [];
  const root = el('section', 'jb-soundcloud'); root.hidden = true; root.setAttribute('aria-label', 'Character soundtrack');
  const bar = el('div', 'jb-soundcloud-bar');
  const label = el('span', 'jb-soundcloud-label', 'SoundCloud track');
  const open = el('a', 'jb-soundcloud-open', 'Open on SoundCloud'); open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
  bar.append(label, open); root.append(bar);

  function clear() {
    root.hidden = true;
    root.removeAttribute('title'); open.removeAttribute('href');
  }
  function active() { try { return ctx.getActiveChat(); } catch { return { chatId: null, characterId: null }; } }
  async function load() {
    const generation = ++request; clear();
    if (disposed) return;
    const snapshot = active(); if (!snapshot.chatId || !snapshot.characterId) return;
    const current = () => !disposed && generation === request && active().chatId === snapshot.chatId && active().characterId === snapshot.characterId;
    try {
      const character = record(await ctx.characters.get(snapshot.characterId));
      if (!current() || (typeof character.id === 'string' && character.id !== snapshot.characterId)) return;
      const track = characterSoundCloudTrack(character); const url = soundCloudWidgetUrl(track); if (!url) return;
      const name = typeof character.name === 'string' ? character.name.slice(0, 200) : '';
      open.href = track?.startsWith('https://soundcloud.com/') ? track : url;
      root.title = 'Open character soundtrack on SoundCloud';
      open.setAttribute('aria-label', name ? `Open ${name} soundtrack on SoundCloud in a new tab` : 'Open character soundtrack on SoundCloud in a new tab');
      root.setAttribute('aria-label', name ? `${name} soundtrack` : 'Character soundtrack'); root.hidden = false;
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
    destroy() { if (disposed) return; disposed = true; request++; clear(); cleanups.splice(0).forEach(cleanup => cleanup()); root.remove(); },
  };
}
