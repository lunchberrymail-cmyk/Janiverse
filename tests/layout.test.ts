import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { setup } from '../dist/frontend.js';

type Ref = { kind: string; id: string };
type Card = { id: string; name: string; description?: string; creator_notes?: string; creator?: string; tags?: string[]; image_id?: string; updated_at?: number };
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const respond = (data: Card[], total = data.length) => ({ ok: true, json: async () => ({ data, total }) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const cards = Array.from({ length: 24 }, (_, index) => ({ id: `char_${index}`, name: `Character ${index}`, description: 'A character from your own library.' }));
let dom: any, ctx: any, stop: (() => void) | undefined;
let native: HTMLElement, nativeMarkup: string, nativeClicks: number;
let calls: Array<{ ref: Ref; params?: Record<string, string> }>;
let requests: Array<{ url: URL; signal?: AbortSignal }>;
let fetchResult: (url: URL, init: RequestInit) => Promise<any>;
let roots: Map<string, HTMLElement>, subscriptions: Map<string, Set<() => void>>;
let favoriteIds: string[], allowChats: boolean, chatActionAvailable: boolean, previewSurfaces: boolean, surfaceDestroyed: number;
let surfaceHandlers: Map<string, (value?: unknown) => void>;
let recentResult: () => Promise<any>;
let groupedResult: () => Promise<any>, groupedQueries: any[];
let characterChatsResult: (id: string) => Promise<any>;
let activeChat: { chatId: string | null; characterId: string | null };
let connectionProjection: { activeProfileId: string | null; provider: string | null; model: string | null };
let characterResult: (id: string) => Promise<any>;
let originalDocument: any, originalLocation: any, originalFetch: any, originalDOMParser: any;

function findButton(label: string, root: ParentNode = document): HTMLButtonElement {
  const node = [...root.querySelectorAll('button')].find(button => button.textContent === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node as HTMLButtonElement;
}
function start() { stop = setup(ctx); }

beforeEach(() => {
  originalDocument = globalThis.document; originalLocation = globalThis.location; originalFetch = globalThis.fetch; originalDOMParser = globalThis.DOMParser;
  dom = new JSDOM('<!doctype html><html data-janitor-bridge-view="previous" data-jb-tools="saved"><head></head><body><main id="native"><h1>Native Lumiverse</h1><button id="native-send">Native send</button><section id="native-chat">The native chat and its controls remain mounted.</section></main><div id="slot-landing_header"></div><div id="slot-chat_header_left"></div><div id="slot-landing_hero"></div><div id="slot-chat_input_tools_left"></div><div id="slot-chat_composer_above"></div></body></html>', { url: 'http://localhost:7860/' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.DOMParser = dom.window.DOMParser;
  native = document.querySelector('#native')!; nativeMarkup = native.outerHTML; nativeClicks = 0;
  document.querySelector('#native-send')!.addEventListener('click', () => { nativeClicks++; });
  calls = []; requests = []; roots = new Map(); subscriptions = new Map(); favoriteIds = ['char_0', 'char_4'];
  allowChats = true; chatActionAvailable = true; previewSurfaces = true; surfaceDestroyed = 0; surfaceHandlers = new Map();
  activeChat = { chatId: null, characterId: null };
  connectionProjection = { activeProfileId: 'connection_1', provider: 'test-provider', model: 'model-one' };
  characterResult = async id => ({ id, name: 'Current character' });
  fetchResult = async () => respond(cards, 72);
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    requests.push({ url, signal: init.signal as AbortSignal | undefined });
    expect(init.credentials).toBe('same-origin');
    if (url.pathname === '/api/v1/chats/hidden-from-recent') return { ok: true, json: async () => [] };
    if (url.pathname === '/api/v1/chats' || url.pathname === '/api/v1/personas') return { ok: true, json: async () => ({ data: [], total: 0 }) };
    return fetchResult(url, init);
  }) as any;
  recentResult = async () => ({ data: [{ id: 'chat_123', name: 'Moonlit story', character_name: 'Ada', character_id: 'char_0', message_count: 12, last_message_preview: '<b>The story continues.</b>' }], total: 1 });
  groupedQueries = [];
  groupedResult = async () => ({ data: [{ character_id: 'char_0', character_name: 'Ada', character_image_id: null, latest_chat_id: 'chat_123', latest_chat_name: 'Moonlit story', updated_at: Math.floor(Date.now() / 1000), chat_count: 1, is_group: false }], total: 1 });
  characterChatsResult = async () => [{ id: 'chat_123', name: 'Moonlit story', message_count: 12, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000), last_message_preview: 'The story continues.' }];
  const catalog = [
    { kind: 'route', id: '/' }, { kind: 'route', id: '/chat/:chatId' }, { kind: 'route', id: '/characters/:id' },
    ...['characters', 'connections', 'personas', 'loom', 'lorebook', 'spindle', 'profile'].map(id => ({ kind: 'drawer_tab', id })),
    { kind: 'settings_tab', id: 'display' },
    { kind: 'entity_action', id: 'character_chat' },
    { kind: 'modal', id: 'character_editor' },
  ];
  ctx = {
    host: { surfaces: {
      list: (kinds?: string[]) => catalog.filter(surface => (!kinds || kinds.includes(surface.kind)) && (chatActionAvailable || surface.id !== 'character_chat')),
      invoke: async (ref: Ref, params?: Record<string, string>) => {
        calls.push({ ref, params });
        if (ref.id === 'character_chat' && !allowChats) throw new Error('PERMISSION_DENIED:chats');
      },
    } },
    dom: { addStyle: (css: string) => {
      const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove();
    }, inject: (target: HTMLElement, markup: string) => { const node = document.createElement('div'); node.innerHTML = markup; target.append(node); return node; }, uninject: (node: Element) => node.remove() },
    ui: {
      mount: (slot: string) => {
        const parent = document.querySelector(`#slot-${slot}`);
        if (!parent) throw new Error(`Undeclared host slot ${slot}`);
        const root = document.createElement('div'); root.dataset.extensionOwned = slot; parent.append(root); roots.set(slot, root); return root;
      },
      showModal: ({ title }: { title: string }) => {
        const root = document.createElement('section'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', title); document.body.append(root);
        const listeners = new Set<() => void>(); let dismissed = false;
        return { root, onDismiss: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, dismiss: () => {
          if (dismissed) return; dismissed = true; listeners.forEach(fn => fn()); root.remove();
        } };
      },
    },
    components: {
      listHostSurfaces: () => previewSurfaces ? [{ id: 'character_preview_panel' }] : [],
      mountHostSurface: (root: HTMLElement, id: string, options: { characterId: string }) => {
        expect(id).toBe('character_preview_panel'); root.textContent = `Native preview for ${options.characterId}`;
        return { on: (event: string, fn: (value?: unknown) => void) => { surfaceHandlers.set(event, fn); return () => surfaceHandlers.delete(event); }, destroy: () => { surfaceDestroyed++; root.replaceChildren(); } };
      },
    },
    state: {
      get: (key: string) => {
        if (key === 'characters.favorites') return favoriteIds;
        if (key === 'connections.active') return connectionProjection;
        if (key === 'chat.active') return activeChat;
        throw new Error(`Unknown state selector ${key}`);
      },
      subscribe: (key: string, fn: () => void) => {
        const handlers = subscriptions.get(key) || new Set(); handlers.add(fn); subscriptions.set(key, handlers); return () => handlers.delete(fn);
      },
    },
    chats: { listRecent: async () => recentResult(), listRecentGrouped: async (query: unknown) => { groupedQueries.push(query); return groupedResult(); }, listForCharacter: async (id: string) => characterChatsResult(id) },
    permissions: { getGranted: async () => [], request: async () => [] },
    onBackendMessage: () => () => {},
    sendToBackend: () => {},
    getActiveChat: () => activeChat,
    characters: { get: (id: string) => characterResult(id) },
  };
});

afterEach(() => {
  stop?.(); stop = undefined; dom.window.close();
  globalThis.document = originalDocument; globalThis.location = originalLocation; globalThis.fetch = originalFetch; globalThis.DOMParser = originalDOMParser;
});

test('mounts only the declared visual slots and preserves native chat DOM and listeners', async () => {
  start(); await flush();
  expect([...roots.keys()]).toEqual(['landing_header', 'chat_header_left', 'landing_hero', 'chat_input_tools_left', 'chat_composer_above']);
  expect(document.querySelector('#native')).toBe(native); expect(native.outerHTML).toBe(nativeMarkup);
  (document.querySelector('#native-send') as HTMLButtonElement).click(); expect(nativeClicks).toBe(1);
  expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
});

test('Home and My Chats select native home views while chat uses its own Back control', async () => {
  dom.window.history.replaceState({}, '', '/chat/existing'); start(); await flush();
  const nav = roots.get('landing_header')!.querySelector('nav')!;
  const links = [...nav.querySelectorAll('button')].map(node => node.textContent);
  expect(links).toEqual(['Home', 'My Chats']);
  expect(roots.get('chat_header_left')!.querySelector('nav')).toBeNull();
  findButton('My Chats', nav).click(); await flush();
  expect(document.documentElement.getAttribute('data-janitor-bridge-view')).toBe('chats');
  expect(findButton('My Chats', nav).getAttribute('aria-current')).toBe('page');
  expect(calls).toContainEqual({ ref: { kind: 'route', id: '/' }, params: undefined });
  findButton('Home', nav).click(); await flush();
  expect(document.documentElement.getAttribute('data-janitor-bridge-view')).toBe('browse');
  findButton('‹ Back', roots.get('chat_header_left')!).click(); await flush();
  expect(document.documentElement.getAttribute('data-janitor-bridge-view')).toBe('chats');
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('masthead search, character names and recent chats follow the familiar browsing hierarchy', async () => {
  start(); await flush();
  expect(roots.get('landing_header')!.querySelector('.jb-search input')).not.toBeNull();
  expect(roots.get('landing_hero')!.querySelector('.jb-search')).toBeNull();
  const card = document.querySelector('.jb-card')!;
  expect(card.firstElementChild!.matches('h3')).toBe(true);
  const recent = document.querySelector('.jb-recent-card')!;
  expect(recent.querySelector('.jb-recent-name')!.textContent).toBe('Ada');
  expect(recent.querySelector('.jb-recent-preview')!.textContent).toBe('The story continues.');
  expect(recent.querySelector('.jb-recent-footer')!.textContent).toContain('12 messages');
  expect(recent.querySelector('.jb-continue')!.textContent).toBe('Continue');
  expect(recent.querySelector('b')).toBeNull();
});

test('My Chats activates its own grouped browser only on demand and routes its Continue cards to the exact native chat', async () => {
  start(); await flush(); const nav = roots.get('landing_header')!.querySelector('nav')!;
  const myChats = document.querySelector('.jb-my-chats') as HTMLElement;
  expect(myChats).not.toBeNull(); expect(myChats.hidden).toBe(true); expect(groupedQueries).toHaveLength(0);
  findButton('My Chats', nav).click(); await flush();
  expect(myChats.hidden).toBe(false); expect(groupedQueries).toEqual([{ limit: 12, offset: 0, sort: 'recent', direction: 'desc' }]);
  expect(myChats.querySelectorAll('.jb-mc-character')).toHaveLength(1); expect(myChats.querySelector('.jb-mc-summary')!.textContent).toBe('1 character · 1 chat');
  (myChats.querySelector('.jb-mc-resume-card') as HTMLButtonElement).click(); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'chat_123' } });
  findButton('Home', nav).click(); await flush(); expect(myChats.hidden).toBe(true); expect(native.outerHTML).toBe(nativeMarkup);
});

test('My Chats expands read-only and opens profiles locally while keeping new chats explicit', async () => {
  start(); await flush(); const nav = roots.get('landing_header')!.querySelector('nav')!; findButton('My Chats', nav).click(); await flush();
  const myChats = document.querySelector('.jb-my-chats')!;
  (myChats.querySelector('.jb-mc-character-header') as HTMLButtonElement).click(); await flush();
  expect(calls).toHaveLength(0); expect(myChats.querySelectorAll('.jb-mc-conversation-card')).toHaveLength(1);
  findButton('＋ Start new chat', myChats).click(); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_0', mode: 'new' } });
  findButton('View character →', myChats).click(); await flush();
  expect(document.querySelector('.jb-character-profile h2')!.textContent).toBe('Current character');
  expect(calls).toHaveLength(1); expect(calls.some(call => call.ref.kind === 'route')).toBe(false);
  expect(native.outerHTML).toBe(nativeMarkup); stop!(); stop = undefined; expect(document.querySelector('.jb-my-chats')).toBeNull();
});

test('chat header opens owned settings, preserves native chat actions, and reflects connection changes', async () => {
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  const header = roots.get('chat_header_left')!;
  const api = header.querySelector('.jb-api-status') as HTMLButtonElement;
  expect(api.title).toContain('model-one'); expect(api.getAttribute('aria-label')).toBe('API Settings');
  api.click(); await flush();
  expect(document.querySelector('.jb-api-settings input[name="api-model"]')).not.toBeNull();
  expect(calls.some(call => call.ref.id === 'connections')).toBe(false);
  findButton('Cancel', document.querySelector('.jb-api-settings')!).click();
  expect(header.querySelector('summary[aria-label="Chat menu"]')).not.toBeNull();
  findButton('New Chat', header).click(); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_current', mode: 'new' } });
  findButton('Settings', header).click(); await flush();
  expect(document.querySelector('.jb-settings input[name="temperature"]')).not.toBeNull();
  expect(calls.some(call => call.ref.id === 'loom')).toBe(false);
  findButton('Close', document.querySelector('.jb-settings')!).click();
  findButton('Customize', header).click(); await flush();
  expect(document.querySelector('.jb-customize')).not.toBeNull();
  expect(calls.some(call => call.ref.kind === 'settings_tab' && call.ref.id === 'display')).toBe(false);
  findButton('×', document.querySelector('.jb-customize')!).click();
  findButton('My Persona', header).click(); await flush(); expect(calls.at(-1)!.ref).toEqual({ kind: 'drawer_tab', id: 'personas' });
  connectionProjection = { activeProfileId: null, provider: null, model: null };
  subscriptions.get('connections.active')!.forEach(handler => handler());
  expect(api.textContent).toBe('API not ready · Set up'); expect(api.classList.contains('jb-api-missing')).toBe(true);
  connectionProjection = { activeProfileId: 'connection_2', provider: 'other-provider', model: 'model-two' };
  subscriptions.get('connections.active')!.forEach(handler => handler());
  expect(api.title).toContain('model-two'); expect(api.classList.contains('jb-api-missing')).toBe(false);
});

test('chat header ignores an older character lookup after the active chat switches', async () => {
  const old = deferred<any>(), fresh = deferred<any>();
  activeChat = { chatId: 'old_chat', characterId: 'old_character' };
  characterResult = id => id === 'old_character' ? old.promise : fresh.promise;
  start(); activeChat = { chatId: 'new_chat', characterId: 'new_character' };
  subscriptions.get('chat.active')!.forEach(handler => handler());
  fresh.resolve({ name: 'New character' }); await flush(); old.resolve({ name: 'Old character' }); await flush();
  const header = roots.get('chat_header_left')!;
  expect(header.querySelector('.jb-chat-title')!.textContent).toBe('New character');
  expect(findButton('Chat Memory', header).disabled).toBe(false);
  activeChat = { chatId: null, characterId: null }; subscriptions.get('chat.active')!.forEach(handler => handler());
  expect(header.querySelector('.jb-chat-title')!.textContent).toBe('Conversation'); expect(findButton('Chat Memory', header).disabled).toBe(true);
});

test('API status reflects the chat-bound profile and model rather than the global default', async () => {
  activeChat = { chatId: 'pinned_chat', characterId: 'char_current' };
  fetchResult = async url => url.pathname === '/api/v1/chats/pinned_chat'
    ? { ok: true, json: async () => ({ metadata: { connection_profile_id: 'pinned_api', connection_model: 'chat-specific-model' } }) }
    : url.pathname === '/api/v1/connections/pinned_api'
      ? { ok: true, json: async () => ({ id: 'pinned_api', provider: 'custom', model: 'profile-default-model' }) }
      : respond(cards, 72);
  start(); await flush();
  const api = roots.get('chat_header_left')!.querySelector('.jb-api-status') as HTMLButtonElement;
  expect(api.textContent).toBe('using proxy');
  expect(api.title).toContain('chat-specific-model');
  expect(api.title).not.toContain('model-one');
});

test('chat menu uses icons and owned prompt controls without altering native chat content', async () => {
  start(); await flush();
  const menu = roots.get('chat_header_left')!.querySelector('.jb-chat-menu')!;
  for (const label of ['Settings', 'Chat Memory', 'Customize', 'New Chat', 'All Chats', 'Prompt']) {
    expect(findButton(label, menu).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  findButton('Prompt', menu).click(); await flush();
  expect(document.querySelector('.jb-settings textarea[name="global-prompt"]')).not.toBeNull();
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('Lumiverse tools can be revealed from either menu and the prior attribute is restored on disable', async () => {
  start(); await flush(); expect(document.documentElement.getAttribute('data-jb-tools')).toBe('false');
  const homeToggle = findButton('Lumiverse tools', roots.get('landing_header')!);
  const chatToggle = findButton('Lumiverse tools', roots.get('chat_header_left')!);
  homeToggle.click(); expect(document.documentElement.getAttribute('data-jb-tools')).toBe('true');
  expect(homeToggle.getAttribute('aria-pressed')).toBe('true'); expect(chatToggle.getAttribute('aria-pressed')).toBe('true');
  chatToggle.click(); expect(document.documentElement.getAttribute('data-jb-tools')).toBe('false');
  expect(homeToggle.getAttribute('aria-pressed')).toBe('false'); expect(chatToggle.getAttribute('aria-pressed')).toBe('false');
  stop!(); stop = undefined; expect(document.documentElement.getAttribute('data-jb-tools')).toBe('saved');
});

test('search, sort and favorites reset pagination and send native summary query parameters', async () => {
  start(); await flush();
  expect(requests[0].url.searchParams.get('sort')).toBe('recent');
  expect([...document.querySelectorAll('.jb-sort option')].map(option => (option as HTMLOptionElement).value)).toEqual(['recent', 'name', 'created']);
  findButton('Next →').click(); await flush();
  expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('24');
  const search = document.querySelector('.jb-search input') as HTMLInputElement;
  search.value = '  Ada  '; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 225));
  expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0'); expect(requests.at(-1)!.url.searchParams.get('search')).toBe('Ada');
  findButton('Next →').click(); await flush();
  const sort = document.querySelector('.jb-sort') as HTMLSelectElement; sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change'));
  await flush(); expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0'); expect(requests.at(-1)!.url.searchParams.get('direction')).toBe('asc');
  sort.value = 'created'; sort.dispatchEvent(new dom.window.Event('change')); await flush();
  expect(requests.at(-1)!.url.searchParams.get('sort')).toBe('created'); expect(requests.at(-1)!.url.searchParams.get('direction')).toBe('desc');
  findButton('Next →').click(); await flush(); findButton('♥ Favorites').click(); await flush();
  const params = requests.at(-1)!.url.searchParams;
  expect(params.get('offset')).toBe('0'); expect(params.get('filter')).toBe('favorites'); expect(params.get('favorite_ids')).toBe('char_0,char_4');
  expect(params.get('limit')).toBe('24'); expect(requests.at(-1)!.url.pathname).toBe('/api/v1/characters/summary');
});

test('favorites changes reset the page when the filtered collection shrinks', async () => {
  favoriteIds = cards.map(card => card.id); start(); await flush(); findButton('♥ Favorites').click(); await flush();
  findButton('Next →').click(); await flush(); expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('24');
  favoriteIds = ['char_0']; fetchResult = async () => respond([cards[0]], 1);
  subscriptions.get('characters.favorites')!.forEach(handler => handler()); await flush();
  expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0');
  expect(requests.at(-1)!.url.searchParams.get('favorite_ids')).toBe('char_0');
  expect(document.querySelector('.jb-count')!.textContent).toBe('1 character in favorites');
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('1–1 of 1');
  expect((document.querySelector('.jb-paging') as HTMLElement).hidden).toBe(true);
});

test('a stale library response cannot replace newer results even if transport ignores abort', async () => {
  const old = deferred<any>(), fresh = deferred<any>(); let number = 0;
  fetchResult = async () => ++number === 1 ? old.promise : fresh.promise;
  start(); const sort = document.querySelector('.jb-sort') as HTMLSelectElement; sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change'));
  expect(requests[0].signal!.aborted).toBe(true);
  fresh.resolve(respond([{ id: 'new', name: 'Fresh result' }])); await flush();
  old.resolve(respond([{ id: 'old', name: 'Stale result' }])); await flush();
  expect(document.querySelector('.jb-grid')!.textContent).toContain('Fresh result'); expect(document.querySelector('.jb-grid')!.textContent).not.toContain('Stale result');
  expect(document.querySelector('.jb-count')!.textContent).toBe('1 character in your library');
});

test('recent chats invoke the native route with the exact chat id', async () => {
  start(); await flush(); (document.querySelector('.jb-recent-card') as HTMLButtonElement).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'chat_123' } }]);
});

test('empty favorites do not request the full library and show a useful empty state', async () => {
  start(); await flush(); favoriteIds = []; const previousRequests = requests.length;
  findButton('♥ Favorites').click(); await flush();
  expect(requests.length).toBe(previousRequests); expect(document.querySelector('.jb-empty')!.textContent).toContain('Characters you favorite');
  expect((document.querySelector('.jb-paging') as HTMLElement).hidden).toBe(true);
});

test('untrusted names and creator notes are rendered as text without executable nodes', async () => {
  previewSurfaces = false;
  fetchResult = async () => respond([{ id: 'unsafe', name: '<img src=x onerror=alert(1)>', creator: '<svg onload=alert(1)>', creator_notes: '<img src=x onerror=alert(1)>Safe <b>creator note</b>', description: '<img src=x onerror=alert(1)>Safe <b>description</b>', tags: ['<script>alert(1)</script>'] }]);
  start(); await flush();
  expect(document.querySelector('.jb-card h3')!.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.jb-description')!.textContent).toBe('Safe creator note');
  expect(document.querySelectorAll('.jb-grid img, .jb-grid script, .jb-grid svg')).toHaveLength(0);
  (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(document.querySelector('.jb-preview-body')!.textContent).toBe('Safe description');
  expect(document.querySelectorAll('.jb-preview img, .jb-preview script, .jb-preview svg')).toHaveLength(0);
});

test('gallery loads and caches the saved creator note instead of the definition', async () => {
  fetchResult = async () => respond([{ id: 'note-card', name: 'Story', description: 'PRIVATE DEFINITION', updated_at: 1 }]);
  let reads = 0;
  characterResult = async id => { reads++; return { id, name: 'Story', creator_notes: '<p>A creator’s</p><p>introduction.</p>', description: 'PRIVATE DEFINITION' }; };
  start(); await flush();
  expect(document.querySelector('.jb-description')!.textContent).toBe('A creator’s introduction.');
  expect(document.querySelector('.jb-grid')!.textContent).not.toContain('PRIVATE DEFINITION');
  expect(reads).toBe(1);
  findButton('Home', roots.get('landing_header')!).click(); await flush(); expect(reads).toBe(1);
  fetchResult = async () => respond([{ id: 'note-card', name: 'Story', description: 'PRIVATE DEFINITION', updated_at: 2 }]);
  characterResult = async id => { reads++; return { id, creator_notes: '' }; };
  findButton('Home', roots.get('landing_header')!).click(); await flush();
  expect(reads).toBe(2); expect(document.querySelector('.jb-description')!.textContent).toBe('No creator’s note.');
});

test('a stale note lookup cannot replace a newly loaded card page', async () => {
  const stale = deferred<any>();
  fetchResult = async () => respond([{ id: 'old-note', name: 'Old' }]);
  characterResult = async id => id === 'old-note' ? stale.promise : { id, creator_notes: 'Current creator note' };
  start(); await flush();
  fetchResult = async () => respond([{ id: 'new-note', name: 'New' }]);
  const sort = document.querySelector('.jb-sort') as HTMLSelectElement; sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change')); await flush();
  stale.resolve({ id: 'old-note', creator_notes: 'Stale creator note' }); await flush();
  expect(document.querySelector('.jb-description')!.textContent).toBe('Current creator note');
  expect(document.querySelector('.jb-grid')!.textContent).not.toContain('Stale creator note');
});

test('preview uses the host component and forwards native edit and openChat events', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(document.querySelector('.jb-preview-body')!.textContent).toBe('Native preview for char_0');
  surfaceHandlers.get('openChat')!({ chatId: 'selected_chat' }); await flush();
  expect(calls).toContainEqual({ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'selected_chat' } });
  expect(surfaceDestroyed).toBe(1); expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLButtonElement).click(); surfaceHandlers.get('edit')!(); await flush();
  expect(calls).toContainEqual({ ref: { kind: 'modal', id: 'character_editor' }, params: { id: 'char_0' } });
});

test('main chat action resumes the latest chat while native Start chat explicitly starts a new one', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  findButton('Chat with this character').click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_0', mode: 'latest' } }]);
  (document.querySelector('.jb-card') as HTMLButtonElement).click(); surfaceHandlers.get('openChat')!({}); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_0', mode: 'new' } });
  expect(surfaceDestroyed).toBe(2); expect(document.querySelector('[role=dialog]')).toBeNull();
});

test('an unavailable chat action is disabled while native existing-chat navigation still works', async () => {
  chatActionAvailable = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(findButton('Chat with this character').disabled).toBe(true);
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  surfaceHandlers.get('openChat')!({ chatId: 'existing_chat' }); await flush();
  expect(calls).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'existing_chat' } }]);
});

test('missing Chats permission leaves the preview usable and explains how to enable it', async () => {
  allowChats = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  const chat = findButton('Chat with this character'); chat.click(); await flush();
  expect(chat.disabled).toBe(false); expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  findButton('View profile').click(); await flush();
  expect(document.querySelector('.jb-character-profile h2')!.textContent).toBe('Current character');
  expect(calls.some(call => call.ref.kind === 'route')).toBe(false);
});

test('View profile stays on Home, renders the selected saved note, and retains working close/edit actions', async () => {
  characterResult = async id => ({ id, name: 'Selected card', creator_notes: '<h2>Public introduction</h2><p>Full creator note.</p>', description: 'Definition stays in details.' });
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  findButton('View profile').click(); await flush();
  expect(location.pathname).toBe('/'); expect(calls).toHaveLength(0);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(surfaceDestroyed).toBe(1);
  expect(document.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.');
  expect(document.querySelector('.jb-profile-details')!.textContent).toContain('Definition stays in details.');
  expect((document.querySelector('.jb-profile-details') as HTMLDetailsElement).open).toBe(false);
  expect(native.outerHTML).toBe(nativeMarkup);
  findButton('Edit character', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'modal', id: 'character_editor' }, params: { id: 'char_0' } }]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLButtonElement).click(); findButton('View profile').click(); await flush();
  findButton('Close', document.querySelector('.jb-profile-window')!).click();
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
});

test('disable cleans owned UI/styles/subscriptions, closes preview and restores the original marker', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(document.querySelectorAll('style').length).toBeGreaterThan(0); stop!(); stop = undefined;
  expect(document.querySelectorAll('style')).toHaveLength(0); expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(surfaceDestroyed).toBe(1); expect([...roots.values()].every(root => root.childNodes.length === 0)).toBe(true);
  expect([...subscriptions.values()].every(handlers => handlers.size === 0)).toBe(true);
  expect(document.documentElement.getAttribute('data-janitor-bridge-view')).toBe('previous');
  expect(document.documentElement.getAttribute('data-jb-tools')).toBe('saved');
  expect(document.querySelector('#native')).toBe(native); expect(native.outerHTML).toBe(nativeMarkup);
});

test('an in-flight response after disable cannot restore removed cards', async () => {
  const pending = deferred<any>(); fetchResult = async () => pending.promise; start(); stop!(); stop = undefined;
  expect(requests[0].signal!.aborted).toBe(true); pending.resolve(respond(cards)); await flush();
  expect(document.querySelector('.jb-card')).toBeNull(); expect(document.querySelectorAll('style')).toHaveLength(0);
});

test('import shortcuts discover the installed JAR extension by both unique keywords and invoke its dynamic drawer ID', async () => {
  const nativeList = ctx.host.surfaces.list;
  const dynamicId = 'extension:instance-uuid-73:jar-import';
  ctx.host.surfaces.list = (kinds?: string[]) => [
    ...nativeList(kinds),
    ...(!kinds || kinds.includes('drawer_tab') ? [
      { kind: 'drawer_tab', id: 'misleading-title', title: 'JAR Import', keywords: ['jar_bridge'] },
      { kind: 'drawer_tab', id: 'unavailable-jar', invocable: false, keywords: ['jar_bridge', 'jar-bridge-import'] },
      { kind: 'drawer_tab', id: dynamicId, invocable: true, keywords: ['jar_bridge', 'jar-bridge-import'] },
    ] : []),
  ];
  start(); await flush();
  findButton('Start guided import').click(); await flush();
  findButton('Import characters', roots.get('landing_header')!).click(); await flush();
  expect(calls).toEqual([
    { ref: { kind: 'drawer_tab', id: dynamicId }, params: undefined },
    { ref: { kind: 'drawer_tab', id: dynamicId }, params: undefined },
  ]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

test('the guided JAR capability opens its assistant directly through the shared event', async () => {
  const nativeList = ctx.host.surfaces.list;
  ctx.host.surfaces.list = (kinds?: string[]) => [
    ...nativeList(kinds),
    ...(!kinds || kinds.includes('drawer_tab') ? [{ kind: 'drawer_tab', id: 'guided-jar', invocable: true, keywords: ['jar_bridge', 'jar-bridge-import', 'jar-bridge-guided-import'] }] : []),
  ];
  const emitted: unknown[] = [];
  ctx.events = { emit: (name: string, payload: unknown) => emitted.push({ name, payload }) };
  start(); await flush();
  const priorRequests = requests.length;
  findButton('Start guided import').click(); await flush();
  expect(emitted).toEqual([{ name: 'jar_bridge:open_import', payload: {} }]);
  expect(calls).toHaveLength(0); expect(requests).toHaveLength(priorRequests);
});

test('without an invocable JAR drawer import opens the card file/link modal without requesting permission or writing', async () => {
  const nativeList = ctx.host.surfaces.list;
  ctx.host.surfaces.list = (kinds?: string[]) => [
    ...nativeList(kinds),
    ...(!kinds || kinds.includes('drawer_tab') ? [{ kind: 'drawer_tab', id: 'jar-disabled', invocable: false, keywords: ['jar_bridge', 'jar-bridge-import'] }] : []),
  ];
  let permissionsRead = 0, permissionRequests = 0;
  ctx.permissions.getGranted = async () => { permissionsRead++; return []; };
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush(); const priorRequests = requests.length;
  findButton('Start guided import').click(); await flush();
  const modal = document.querySelector('[role=dialog]')!;
  expect(modal.getAttribute('aria-label')).toBe('Import character');
  expect(findButton('File', modal).getAttribute('aria-selected')).toBe('true');
  expect(findButton('Link', modal).getAttribute('aria-selected')).toBe('false');
  const input = modal.querySelector('input[type=file]') as HTMLInputElement;
  expect(input.multiple).toBe(true); expect(input.accept).toContain('.png'); expect(input.accept).toContain('.json');
  expect(calls).toHaveLength(0); expect(requests).toHaveLength(priorRequests);
  expect(permissionsRead).toBe(0); expect(permissionRequests).toBe(0);
});
