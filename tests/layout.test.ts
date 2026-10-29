import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { setup } from '../dist/frontend.js';

type Ref = { kind: string; id: string };
type Card = { id: string; name: string; description?: string; creator_notes?: string; creator?: string; tags?: string[]; image_id?: string; updated_at?: number };
function fullCard(card: Card, changes: Record<string, unknown> = {}) {
  return {
    description: '', personality: '', scenario: '', first_mes: '', mes_example: '', creator: '', creator_notes: '',
    system_prompt: '', post_history_instructions: '', tags: [], alternate_greetings: [], extensions: {}, ...card, ...changes,
  };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const respond = (data: Card[], total = data.length) => ({ ok: true, json: async () => ({ data, total }) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const cards = Array.from({ length: 24 }, (_, index) => ({ id: `char_${index}`, name: `Character ${index}`, description: 'A character from your own library.' }));
const allCards = [...cards, ...Array.from({ length: 48 }, (_, index) => ({ id: `char_${index + 24}`, name: `Character ${index + 24}`, description: 'A character from your own library.' }))];
const summaryRequests = () => requests.filter(request => request.url.pathname === '/api/v1/characters/summary' && request.url.searchParams.get('limit') !== '1');
function respondPage(data: Card[], url: URL) {
  const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
  return respond(data.slice(offset, offset + limit), data.length);
}
let dom: any, ctx: any, stop: (() => void) | undefined;
let native: HTMLElement, nativeMarkup: string, nativeClicks: number;
let calls: Array<{ ref: Ref; params?: Record<string, string> }>;
let requests: Array<{ url: URL; signal?: AbortSignal; options: RequestInit }>;
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

// Stands in for the host window's own close (×) control.
const modalDismiss = new WeakMap<Element, () => void>();
function closeModal(selector: string) { modalDismiss.get(document.querySelector(selector)!)!(); }
function findButton(label: string, root: ParentNode = document): HTMLButtonElement {
  const node = [...root.querySelectorAll('button')].find(button => button.textContent === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node as HTMLButtonElement;
}
function start() { stop = setup(ctx); }

beforeEach(() => {
  originalDocument = globalThis.document; originalLocation = globalThis.location; originalFetch = globalThis.fetch; originalDOMParser = globalThis.DOMParser;
  dom = new JSDOM('<!doctype html><html data-janitor-bridge-view="previous" data-jb-tools="saved"><head></head><body><main id="native"><h1>Native Lumiverse</h1><button id="native-send">Native send</button><section id="native-chat">The native chat and its controls remain mounted.</section></main><div id="slot-landing_header"></div><div id="slot-chat_header_left"></div><div id="slot-landing_hero"></div><div id="slot-landing_chats"></div><div id="slot-chat_input_tools_left"></div><div id="slot-chat_composer_above"></div></body></html>', { url: 'http://localhost:7860/' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.DOMParser = dom.window.DOMParser;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  native = document.querySelector('#native')!; nativeMarkup = native.outerHTML; nativeClicks = 0;
  document.querySelector('#native-send')!.addEventListener('click', () => { nativeClicks++; });
  calls = []; requests = []; roots = new Map(); subscriptions = new Map(); favoriteIds = ['char_0', 'char_4'];
  allowChats = true; chatActionAvailable = true; previewSurfaces = true; surfaceDestroyed = 0; surfaceHandlers = new Map();
  activeChat = { chatId: null, characterId: null };
  connectionProjection = { activeProfileId: 'connection_1', provider: 'test-provider', model: 'model-one' };
  characterResult = async id => ({ id, name: 'Current character' });
  fetchResult = async url => respondPage(allCards, url);
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(String(input), dom.window.location.href);
    requests.push({ url, signal: init.signal as AbortSignal | undefined, options: init });
    expect(init.credentials).toBe('same-origin');
    if (url.pathname === '/api/v1/connections') return { ok: true, json: async () => ({ data: [], total: 0 }) };
    if (url.pathname === '/api/v1/characters/summary' && url.searchParams.get('limit') === '1') return { ok: true, json: async () => ({ data: allCards.slice(0, 1), total: allCards.length }) };
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
    ...['characters', 'connections', 'personas', 'loom', 'lorebook', 'spindle', 'profile', 'summary', 'cortex'].map(id => ({ kind: 'drawer_tab', id })),
    { kind: 'settings_tab', id: 'memoryCortex' }, { kind: 'settings_tab', id: 'display' },
    { kind: 'settings_tab', id: 'illarin' },
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
        const dismiss = () => { if (dismissed) return; dismissed = true; listeners.forEach(fn => fn()); root.remove(); };
        modalDismiss.set(root, dismiss);
        return { root, onDismiss: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, dismiss };
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
  expect([...roots.keys()]).toEqual(['landing_header', 'chat_header_left', 'landing_hero', 'chat_input_tools_left', 'chat_composer_above', 'landing_chats']);
  expect(document.querySelector('#native')).toBe(native); expect(native.outerHTML).toBe(nativeMarkup);
  (document.querySelector('#native-send') as HTMLButtonElement).click(); expect(nativeClicks).toBe(1);
  expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
});

test('Home hands off the native chats controller until the extension is disposed', async () => {
  start(); await flush();
  const handoff = roots.get('landing_chats')!;
  expect(handoff.getAttribute('data-recent-chats-ready')).toBe('true');
  // Both custom views use the shared hero surface; neither may reactivate a
  // hidden native virtualizer that could reset their scroll position.
  findButton('My Chats', roots.get('landing_header')!).click(); await flush();
  expect(handoff.getAttribute('data-recent-chats-ready')).toBe('true');
  findButton('Home', roots.get('landing_header')!).click(); await flush();
  expect(handoff.getAttribute('data-recent-chats-ready')).toBe('true');
  stop!(); stop = undefined;
  expect(handoff.hasAttribute('data-recent-chats-ready')).toBe(false);
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('older hosts without the chats handoff still mount the Home browser', async () => {
  document.querySelector('#slot-landing_chats')!.remove();
  expect(() => start()).not.toThrow(); await flush();
  expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
  expect(roots.has('landing_chats')).toBe(false);
});

test('optional state selector failures leave the home layout usable without requesting permissions', async () => {
  let permissionRequests = 0;
  ctx.state = { get() { throw new Error('SELECTOR_UNKNOWN'); }, subscribe() { throw new Error('PERMISSION_DENIED'); } };
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  expect(() => start()).not.toThrow(); await flush();
  expect(document.querySelector('.jb-home-masthead')).not.toBeNull(); expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
  expect(permissionRequests).toBe(0); expect(native.outerHTML).toBe(nativeMarkup);
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
  expect(myChats.querySelectorAll('.jb-mc-character')).toHaveLength(1); expect(myChats.querySelector('.jb-mc-summary')!.textContent).toBe('1 character or group · 1 chat');
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
  const profile = document.querySelector('.jb-profile-window')!; expect(profile.getAttribute('aria-label')).toBe('Current character');
  expect(profile.querySelector('.jb-delete-confirmation p')!.textContent).toContain('Delete “Current character”?');
  expect(calls).toHaveLength(1); expect(calls.some(call => call.ref.kind === 'route')).toBe(false);
  expect(native.outerHTML).toBe(nativeMarkup); stop!(); stop = undefined; expect(document.querySelector('.jb-my-chats')).toBeNull();
});

test('chat API Settings opens native Connections, preserves chat settings, and reflects connection changes', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  const header = roots.get('chat_header_left')!;
  const api = header.querySelector('.jb-api-status') as HTMLButtonElement;
  expect(api.title).toContain('model-one'); expect(api.getAttribute('aria-label')).toBe('API Settings');
  const previousRequests = requests.length;
  api.click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'connections' }, params: undefined }]);
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  expect(requests).toHaveLength(previousRequests);
  expect(activeChat).toEqual({ chatId: 'active_chat', characterId: 'char_current' });
  expect(header.querySelector('summary[aria-label="Chat menu"]')).not.toBeNull();
  findButton('New Chat', header).click(); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_current', mode: 'new' } });
  findButton('Settings', header).click(); await flush();
  expect(document.querySelector('.jb-settings input[name="temperature"]')).not.toBeNull();
  expect(calls.some(call => call.ref.id === 'loom')).toBe(false);
  findButton('×', document.querySelector('.jb-settings-window-root')!).click();
  findButton('Customize', header).click(); await flush();
  expect(document.querySelector('.jb-customize')).not.toBeNull();
  expect(calls.some(call => call.ref.kind === 'settings_tab' && call.ref.id === 'display')).toBe(false);
  findButton('×', document.querySelector('.jb-customize')!).click();
  header.querySelector<HTMLButtonElement>('.jb-chat-help-button')!.click(); findButton('Story tools', document.querySelector('.jb-chat-help')!).click(); findButton('Manage personas', document.querySelector('.jb-chat-help')!).click(); await flush(); expect(calls.at(-1)!.ref).toEqual({ kind: 'drawer_tab', id: 'personas' });
  connectionProjection = { activeProfileId: null, provider: null, model: null };
  subscriptions.get('connections.active')!.forEach(handler => handler());
  expect(api.textContent).toBe('API not ready · Set up'); expect(api.classList.contains('jb-api-missing')).toBe(true);
  api.click(); await flush();
  expect(calls.at(-1)!.ref).toEqual({ kind: 'drawer_tab', id: 'connections' });
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  connectionProjection = { activeProfileId: 'connection_2', provider: 'other-provider', model: 'model-two' };
  subscriptions.get('connections.active')!.forEach(handler => handler());
  expect(api.title).toContain('model-two'); expect(api.classList.contains('jb-api-missing')).toBe(false);
});

test('chat Settings contains prompt and generation with its preset banner and footer, without an API editor', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  findButton('Settings', roots.get('chat_header_left')!).click(); await flush();
  const window = document.querySelector('.jb-settings-window-root')!;
  const settings = window.querySelector('.jb-settings-combined')!;
  const promo = settings.querySelector('.jb-preset-promo')!;
  const preferences = settings.querySelector('.jb-prompt-settings-inline')!;
  expect(settings.querySelector('.jb-api-settings, .jb-api-native-setup, .jb-api-config-card, .jb-api-provider-card')).toBeNull();
  expect(promo.compareDocumentPosition(preferences) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect([...promo.querySelectorAll('a')].map(anchor => [anchor.textContent, anchor.href])).toEqual([
    ['Browse presets', 'https://illarin.com/browse?type=preset'],
    ['Presets on Discord', 'https://discord.com/channels/1484149939167821915/1484156801447497792'],
    ['Join Discord', 'https://discord.gg/28rBWVFfCu'],
  ]);
  expect(settings.querySelector('[aria-label="Improve chat memory"]')).toBeNull();
  expect([...settings.querySelectorAll('button')].some(button => ['Set up summaries', 'Connection', 'Open Lumiverse Connections', 'Save & Use'].includes(button.textContent || ''))).toBe(false);
  expect(settings.querySelector('input[name="temperature-slider"]')).not.toBeNull();
  expect(settings.querySelector('textarea[name="global-prompt"]')).not.toBeNull();
  expect(requests.some(request => /^\/api\/v1\/(?:connections|providers)$/.test(request.url.pathname))).toBe(false);
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
  const footer = window.querySelector('.jb-settings-window-footer')!;
  expect(footer.parentElement).toBe(window);
  expect(findButton('Save prompt & generation', footer)).not.toBeNull();
  expect(calls).toHaveLength(0);
  findButton('Customize', window).click(); await flush();
  expect(document.querySelector('.jb-prompt-settings-inline')).toBeNull();
  expect(document.querySelector('.jb-settings-window-footer')).toBeNull();
  findButton('Settings', window).click(); await flush();
  expect(document.querySelectorAll('.jb-settings-window-footer')).toHaveLength(1);
  stop!(); stop = undefined;
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  expect(document.querySelector('.jb-settings-window-footer')).toBeNull();
});

test('Memory tab advertises memory tools and opens native setup without running generation', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  findButton('Settings', roots.get('chat_header_left')!).click(); await flush();
  findButton('Memory', document.querySelector('.jb-settings-window-root')!).click(); await flush();
  const ad = document.querySelector('.jb-memory [aria-label="Improve chat memory"]')!;
  expect(ad.querySelector('h3')!.textContent).toBe('Give your characters more memory.');
  expect(document.querySelector('.jb-settings-window-root .jb-preset-promo')).toBeNull();
  expect(document.querySelector('.jb-memory textarea')).not.toBeNull();
  expect(calls).toHaveLength(0);
  findButton('Set up summaries', ad).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'summary' }, params: undefined }]);
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  expect(document.querySelector('.jb-settings-window-footer')).toBeNull();
  expect(requests.every(request => !/\/(?:generate|generation)(?:\/|$)/.test(request.url.pathname) || request.options?.method === undefined && request.url.pathname.includes('/generate/status/'))).toBe(true);
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('unavailable memory setup keeps the Memory editor and its unsaved text available', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' };
  const nativeList = ctx.host.surfaces.list;
  ctx.host.surfaces.list = (kinds?: string[]) => nativeList(kinds).filter((surface: Ref) => surface.id !== 'memoryCortex');
  start(); await flush();
  findButton('Chat Memory', roots.get('chat_header_left')!).click(); await flush();
  const editor = document.querySelector('.jb-memory')!;
  const note = editor.querySelector('textarea')!; note.value = 'Unsaved story fact';
  findButton('Explore Memory Cortex', editor).click(); await flush();
  expect(calls).toHaveLength(0);
  expect(editor.isConnected).toBe(true); expect(note.value).toBe('Unsaved story fact');
  expect(editor.querySelector('.jb-memory-promo-status')!.textContent).toContain('unavailable');
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('preset management and Illarin connection open only after explicit help actions and close the settings panel', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  const header = roots.get('chat_header_left')!;
  findButton('Settings', header).click(); await flush();
  let panel = document.querySelector('.jb-settings-window-root')!;
  expect(calls).toHaveLength(0);
  const prompt = panel.querySelector<HTMLDetailsElement>('.jb-settings-global-prompt')!;
  prompt.querySelector('summary')!.click();
  findButton('Manage / import presets', panel).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'loom' }, params: undefined }]);
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  findButton('Settings', header).click(); await flush();
  panel = document.querySelector('.jb-settings-window-root')!;
  panel.querySelector<HTMLDetailsElement>('.jb-settings-global-prompt')!.querySelector('summary')!.click();
  panel.querySelector<HTMLDetailsElement>('.jb-settings-prompt-help')!.querySelector('summary')!.click();
  expect(calls).toHaveLength(1);
  findButton('Connect Illarin', panel).click(); await flush();
  expect(calls[1]).toEqual({ ref: { kind: 'settings_tab', id: 'illarin' }, params: { anchorId: 'setsec-illarin-general' } });
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  expect(requests.every(request => !/\/(?:generate|generation)(?:\/|$)/.test(request.url.pathname) || request.options?.method === undefined && request.url.pathname.includes('/generate/status/'))).toBe(true);
  expect(native.outerHTML).toBe(nativeMarkup);
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
      : respond(cards);
  start(); await flush();
  const api = roots.get('chat_header_left')!.querySelector('.jb-api-status') as HTMLButtonElement;
  expect(api.textContent).toBe('using proxy');
  expect(api.title).toContain('chat-specific-model');
  expect(api.title).not.toContain('model-one');
});

test('leaving a chat unloads its SoundCloud frame even when the native active chat is unchanged', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat'); activeChat = { chatId: 'active_chat', characterId: 'char_current' };
  characterResult = async id => ({ id, name: 'Soundtrack character', extensions: { jar_bridge: { soundcloud_track_id: '123456789' } } });
  start(); await flush();
  const header = roots.get('chat_header_left')!;
  expect(header.querySelector('iframe')).toBeNull(); expect(document.querySelector('script')).toBeNull();
  findButton('Play', header).click();
  const controller = document.querySelector<HTMLScriptElement>('script[src="https://w.soundcloud.com/player/api.js"]')!;
  expect(controller).not.toBeNull(); expect(header.querySelector('iframe')).toBeNull();
  // Simulate the official controller becoming available without loading its network script.
  const bindings: Array<Set<string>> = [];
  const widget = Object.assign(() => {
    const events = new Set<string>(); bindings.push(events);
    return { bind: (name: string) => { events.add(name); }, unbind: (name: string) => { events.delete(name); }, play() {}, pause() {}, getCurrentSound() {} };
  }, { Events: { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error' } });
  dom.window.SC = { Widget: widget }; controller.dispatchEvent(new dom.window.Event('load')); await flush();
  expect(header.querySelector('iframe')).not.toBeNull();
  findButton('Stop', header).click(); expect(header.querySelector('iframe')).toBeNull(); expect(bindings[0].size).toBe(0);
  findButton('Play', header).click(); await flush(); expect(header.querySelector('iframe')).not.toBeNull();
  findButton('‹ Back', header).click(); expect(header.querySelector('iframe')).toBeNull();
  findButton('Play', header).click(); await flush(); const frame = header.querySelector('iframe')!; expect(frame).not.toBeNull();
  subscriptions.get('chat.active')!.forEach(handler => handler()); await flush();
  expect(header.querySelector('iframe')).toBe(frame);
  dom.window.history.replaceState({}, '', '/'); await new Promise(resolve => setTimeout(resolve, 550));
  expect(activeChat.chatId).toBe('active_chat'); expect(header.querySelector('iframe')).toBeNull();
  expect(bindings.every(events => events.size === 0)).toBe(true); expect(document.querySelectorAll('script')).toHaveLength(1);
});

test('chat menu keeps the reference order and icons while extra shortcuts live in Help', async () => {
  start(); await flush();
  const menu = roots.get('chat_header_left')!.querySelector('.jb-chat-menu')!;
  const labels = ['Settings', 'Generation settings', 'Chat Memory', 'Customize', 'New Chat', 'All Chats'];
  expect([...menu.querySelectorAll('button')].map(button => button.textContent)).toEqual(labels);
  for (const label of labels) {
    expect(findButton(label, menu).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  findButton('Settings', menu).click(); await flush();
  expect(document.querySelector('.jb-settings textarea[name="global-prompt"]')).not.toBeNull();
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('chat menu keyboard navigation stays within supported actions and Escape shields generation', async () => {
  start(); await flush(); const menu = roots.get('chat_header_left')!.querySelector<HTMLDetailsElement>('.jb-chat-menu')!;
  const summary = menu.querySelector('summary')!; summary.focus(); let stops = 0;
  const host = (event: KeyboardEvent) => { if (event.key === 'Escape') stops++; }; document.addEventListener('keydown', host);
  summary.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  expect(menu.open).toBe(true); expect(document.activeElement).toBe(findButton('All Chats', menu));
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(findButton('Settings', menu));
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.open).toBe(false); expect(stops).toBe(0); expect(document.activeElement).toBe(summary); document.removeEventListener('keydown', host);
});

test('chat help and the chat menu open the generation panel directly', async () => {
  start(); await flush(); const header = roots.get('chat_header_left')!;
  header.querySelector<HTMLButtonElement>('.jb-chat-help-button')!.click();
  findButton('AI settings', document.querySelector('.jb-chat-help')!).click();
  findButton('Open generation settings', document.querySelector('.jb-chat-help')!).click(); await flush();
  expect(document.querySelector('.jb-chat-help')).toBeNull();
  expect(document.querySelector('.jb-settings [role="tab"][aria-selected="true"]')!.textContent).toBe('Generation');
  expect(document.querySelector<HTMLElement>('.jb-settings-panel[id$="-generation"]')!.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>('.jb-settings-panel[id$="-prompt"]')!.hidden).toBe(true);
  findButton('×', document.querySelector('.jb-settings-window-root')!).click();
  findButton('Generation settings', header).click(); await flush();
  expect(document.querySelector('.jb-settings [role="tab"][aria-selected="true"]')!.textContent).toBe('Generation');
  expect(native.outerHTML).toBe(nativeMarkup); expect(calls).toEqual([]);
});

test('native chat tools are the default and the home menu or chat Help can open the optional familiar layout', async () => {
  start(); await flush(); expect(document.documentElement.getAttribute('data-jb-tools')).toBe('true');
  expect(document.documentElement.getAttribute('data-jb-composer')).toBe('false');
  const header = roots.get('chat_header_left')!;
  expect(header.querySelector('.jb-memory-button')).toBeNull();
  expect([...header.querySelectorAll('button')].filter(button => button.textContent === 'Chat Memory')).toHaveLength(1);
  findButton('Help', roots.get('landing_header')!).click();
  findButton('Explore', document.querySelector('.jb-chat-help')!).click();
  document.querySelector<HTMLInputElement>('input[value="janitorai"]')!.click();
  expect(document.documentElement.getAttribute('data-jb-tools')).toBe('false');
  expect(document.documentElement.getAttribute('data-jb-composer')).toBe('true');
  findButton('Close', document.querySelector('.jb-chat-help')!).click();
  expect(header.querySelector('.jb-chat-help-button')!.getAttribute('aria-label')).toBe('Chat tools & help');
  header.querySelector<HTMLButtonElement>('.jb-chat-help-button')!.click();
  findButton('Explore', document.querySelector('.jb-chat-help')!).click();
  document.querySelector<HTMLInputElement>('input[value="lumiverse"]')!.click();
  expect(document.documentElement.getAttribute('data-jb-tools')).toBe('true');
  expect(document.documentElement.getAttribute('data-jb-composer')).toBe('false');
  expect(native.outerHTML).toBe(nativeMarkup);
  stop!(); stop = undefined; expect(document.documentElement.getAttribute('data-jb-tools')).toBe('saved');
});

test('familiar composer opens extension discovery without requesting generation or changing a draft', async () => {
  activeChat = { chatId: 'chat-1', characterId: 'char-1' }; const sent: any[] = [];
  ctx.composer = { getState: () => ({ mounted: true, chatId: 'chat-1', text: 'An unsent draft' }), onChange: () => () => {}, focus() {} };
  ctx.sendToBackend = (payload: unknown) => sent.push(payload);
  start(); await flush(); roots.get('chat_header_left')!.querySelector<HTMLButtonElement>('.jb-chat-help-button')!.click();
  findButton('Explore', document.querySelector('.jb-chat-help')!).click();
  document.querySelector<HTMLInputElement>('input[value="janitorai"]')!.click(); findButton('Close', document.querySelector('.jb-chat-help')!).click();
  document.querySelector<HTMLButtonElement>('.jb-assist-toggle')!.click(); await flush();
  const guide = document.querySelector('.jb-chat-help')!;
  expect(guide.querySelector<HTMLElement>('.jb-extension-guide')!.hidden).toBe(false);
  findButton('Enhance my draft', guide).click();
  expect(guide.querySelector('.jb-extension-result h3')!.textContent).toBe('Hone');
  expect(document.querySelector('.jb-assist-menu')).toBeNull();
  expect(sent).toHaveLength(0); expect(calls).toHaveLength(0);
  expect(ctx.composer.getState().text).toBe('An unsent draft');
  const header = roots.get('chat_header_left')!;
  expect(header.querySelector('.jb-chat-title')!.parentElement).toBe(header.querySelector('.jb-chat-bar'));
});

test('Cortex setup leaves the Memory editor for native configuration', async () => {
  activeChat = { chatId: 'chat-1', characterId: 'char-1' }; dom.window.history.replaceState({}, '', '/chat/chat-1');
  start(); await flush(); findButton('Chat Memory', roots.get('chat_header_left')!).click(); await flush();
  findButton('Explore Memory Cortex', document.querySelector('.jb-memory')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'settings_tab', id: 'memoryCortex' }, params: undefined }]);
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
});

test('grouped gallery pages reuse the native summary index while search, sort and favorites reset it', async () => {
  start(); await flush();
  expect(summaryRequests()[0].url.searchParams.get('sort')).toBe('created');
  expect(summaryRequests()).toHaveLength(1);
  expect(summaryRequests()[0].url.searchParams.get('limit')).toBe('1000');
  expect(summaryRequests()[0].url.searchParams.get('offset')).toBe('0');
  expect([...document.querySelectorAll('.jb-sort option')].map(option => (option as HTMLOptionElement).value)).toEqual(['created', 'name']);
  findButton('Next →').click(); await flush();
  expect(summaryRequests()).toHaveLength(1);
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_24');
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('25–48 of 72');
  const search = document.querySelector('.jb-search input') as HTMLInputElement;
  search.value = '  Ada  '; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 225));
  expect(summaryRequests()).toHaveLength(2);
  expect(summaryRequests().at(-1)!.url.searchParams.get('offset')).toBe('0'); expect(summaryRequests().at(-1)!.url.searchParams.get('search')).toBe('Ada');
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_0');
  findButton('Next →').click(); await flush();
  expect(summaryRequests()).toHaveLength(2);
  const sort = document.querySelector('.jb-sort') as HTMLSelectElement; sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change'));
  await flush(); expect(summaryRequests()).toHaveLength(3);
  expect(summaryRequests().at(-1)!.url.searchParams.get('offset')).toBe('0'); expect(summaryRequests().at(-1)!.url.searchParams.get('direction')).toBe('asc');
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_0');
  sort.value = 'created'; sort.dispatchEvent(new dom.window.Event('change')); await flush();
  expect(summaryRequests().at(-1)!.url.searchParams.get('sort')).toBe('created'); expect(summaryRequests().at(-1)!.url.searchParams.get('direction')).toBe('desc');
  findButton('Next →').click(); await flush(); findButton('♥ Favorites').click(); await flush();
  const params = summaryRequests().at(-1)!.url.searchParams;
  expect(params.get('offset')).toBe('0'); expect(params.get('filter')).toBe('favorites'); expect(params.get('favorite_ids')).toBe('char_0,char_4');
  expect(params.get('limit')).toBe('1000');
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_0');
});

test('favorites changes reset the page when the filtered collection shrinks', async () => {
  favoriteIds = allCards.map(card => card.id); start(); await flush(); findButton('♥ Favorites').click(); await flush();
  const priorReads = summaryRequests().length;
  findButton('Next →').click(); await flush(); expect(summaryRequests()).toHaveLength(priorReads);
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_24');
  favoriteIds = ['char_0']; fetchResult = async () => respond([cards[0]], 1);
  subscriptions.get('characters.favorites')!.forEach(handler => handler()); await flush();
  expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0');
  expect(requests.at(-1)!.url.searchParams.get('favorite_ids')).toBe('char_0');
  expect(document.querySelector('.jb-count')!.textContent).toBe('1 favorite character card');
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('1–1 of 1');
  expect((document.querySelector('.jb-paging') as HTMLElement).hidden).toBe(true);
});

test('a stale library response cannot replace newer results even if transport ignores abort', async () => {
  const old = deferred<any>(), fresh = deferred<any>(); let number = 0;
  fetchResult = async () => ++number === 1 ? old.promise : fresh.promise;
  start(); const sort = document.querySelector('.jb-sort') as HTMLSelectElement; sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change'));
  expect(summaryRequests()[0].signal!.aborted).toBe(true);
  fresh.resolve(respond([{ id: 'new', name: 'Fresh result' }])); await flush();
  old.resolve(respond([{ id: 'old', name: 'Stale result' }])); await flush();
  expect(document.querySelector('.jb-grid')!.textContent).toContain('Fresh result'); expect(document.querySelector('.jb-grid')!.textContent).not.toContain('Stale result');
  expect(document.querySelector('.jb-count')!.textContent).toBe('1 saved character card');
});

test('recent chats invoke the native route with the exact chat id', async () => {
  start(); await flush(); (document.querySelector('.jb-recent-card') as HTMLButtonElement).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'chat_123' } }]);
});

test('empty favorites do not request the full library and show a useful empty state', async () => {
  start(); await flush(); favoriteIds = []; const previousRequests = requests.length;
  findButton('♥ Favorites').click(); await flush();
  expect(requests.length).toBe(previousRequests); expect(document.querySelector('.jb-empty')!.textContent).toContain('Character cards you favorite');
  expect((document.querySelector('.jb-paging') as HTMLElement).hidden).toBe(true);
});

test('untrusted names and creator notes are rendered as text without executable nodes', async () => {
  const unsafe = { id: 'unsafe', name: '<img src=x onerror=alert(1)>', creator: '<svg onload=alert(1)>', creator_notes: '<img src=x onerror=alert(1)>Safe <b>creator note</b>', description: '<img src=x onerror=alert(1)>Safe <b>description</b>', tags: ['<script>alert(1)</script>'] };
  fetchResult = async () => respond([unsafe]); characterResult = async () => unsafe;
  start(); await flush();
  expect(document.querySelector('.jb-card h3')!.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.jb-description')!.textContent).toBe('Safe creator note');
  expect(document.querySelectorAll('.jb-grid img, .jb-grid script, .jb-grid svg')).toHaveLength(0);
  (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  const note = document.querySelector<HTMLDetailsElement>('.jb-profile-notes')!; note.open = true; note.dispatchEvent(new dom.window.Event('toggle'));
  expect(document.querySelector('.jb-preview-body .jb-profile-notes')!.textContent).toContain('Safe creator note');
  expect(document.querySelectorAll('.jb-preview script, .jb-preview svg, .jb-preview [onerror], .jb-preview [onload]')).toHaveLength(0);
  expect(document.querySelector('.jb-preview img')!.getAttribute('src')).toBe('/api/v1/characters/unsafe/avatar?size=lg');
});

test('gallery loads and caches the saved creator note instead of the definition', async () => {
  const libraryEvents = new Map<string, () => void>();
  ctx.events = { on: (name: string, handler: () => void) => { libraryEvents.set(name, handler); return () => libraryEvents.delete(name); } };
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
  libraryEvents.get('CHARACTER_EDITED')!(); await new Promise(resolve => setTimeout(resolve, 325));
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

test('All Characters includes saved cards with no chats and never builds the library from chat results', async () => {
  const savedCards = [cards[0], { id: 'unused-card', name: 'Never chatted with', creator_notes: 'A card kept for later.' }];
  fetchResult = async () => respond(savedCards);
  let chatReads = 0; characterChatsResult = async () => { chatReads++; return []; };
  start(); await flush();
  expect([...document.querySelectorAll('.jb-card')].map(card => card.getAttribute('data-character-id'))).toEqual(['char_0', 'unused-card']);
  expect(document.querySelector('.jb-count')!.textContent).toBe('2 saved character cards');
  const summary = summaryRequests()[0];
  expect(summary.url.searchParams.get('sort')).toBe('created'); expect(summary.url.searchParams.has('filter')).toBe(false);
  expect(groupedQueries).toHaveLength(0); expect(chatReads).toBe(0);
  (document.querySelector('[data-character-id="unused-card"] .jb-card-title') as HTMLButtonElement).click(); await flush();
  expect(document.querySelector('.jb-profile-window')).not.toBeNull(); expect(calls).toHaveLength(0); expect(chatReads).toBe(0);
});

test('identical saved cards across native summary pages share one tile before gallery pagination', async () => {
  const first = { id: 'rajah-new', name: 'Rajah | Tiger in the Garden', description: 'A saved card.', updated_at: 1 };
  const last = { ...first, id: 'rajah-old', image_id: 'older-portrait' };
  const library = [first, ...Array.from({ length: 999 }, (_, index) => ({ id: `unique-${index}`, name: `Unique ${index}`, creator_notes: 'A separate saved card.' })), last];
  const fullReads: string[] = [];
  fetchResult = async url => respondPage(library, url);
  characterResult = async id => {
    fullReads.push(id);
    const summary = library.find(card => card.id === id)!;
    return fullCard(summary, { extensions: id === last.id ? { world_book_ids: ['older-lorebook'], jar_companion: { source: 'janitorai' } } : {} });
  };
  start(); await flush(); await flush();
  expect(summaryRequests().map(request => request.url.searchParams.get('offset'))).toEqual(['0', '1000']);
  expect(summaryRequests().every(request => request.url.searchParams.get('limit') === '1000')).toBe(true);
  expect(fullReads).toContain(last.id);
  const rajahTiles = [...document.querySelectorAll('.jb-card')].filter(card => card.getAttribute('aria-label') === first.name);
  expect(rajahTiles).toHaveLength(1);
  expect(rajahTiles[0].querySelector('.jb-card-copies')!.textContent).toBe('2 saved copies');
  expect(document.querySelector('.jb-count')!.textContent).toBe('1000 characters · 1001 saved cards');
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('1–24 of 1000');
  const initialReads = summaryRequests().length;
  findButton('Next →').click(); await flush();
  expect(summaryRequests()).toHaveLength(initialReads);
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('25–48 of 1000');
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('unique-23');
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
  expect(calls).toHaveLength(0); expect(groupedQueries).toHaveLength(0); expect(native.outerHTML).toBe(nativeMarkup);
});

test('saved-copy selection keeps edited variants separate and uses the exact copy for favorite, edit and chat actions', async () => {
  const first = { id: 'rajah-new', name: 'Rajah | Tiger in the Garden', description: 'A saved card.', creator_notes: 'Public notes.', updated_at: 1 };
  const older = { ...first, id: 'rajah-old', image_id: 'older-portrait' };
  const variant = { ...first, id: 'rajah-edited' };
  const library = [first, older, variant]; let savedFavorites: string[] = [];
  fetchResult = async (url, options) => {
    if (url.pathname !== '/api/v1/settings/favorites') return respond(library);
    if (options.method === 'PUT') savedFavorites = JSON.parse(String(options.body)).value;
    return { ok: true, status: 200, json: async () => ({ value: [...savedFavorites] }) };
  };
  characterResult = async id => fullCard(library.find(card => card.id === id)!, {
    personality: id === variant.id ? 'An intentionally edited personality.' : 'The original personality.',
    extensions: id === older.id ? { world_book_ids: ['older-lorebook'], jar_companion: { source: 'janitorai' } } : {},
  });
  start(); await flush(); await flush();
  expect([...document.querySelectorAll('.jb-card')].map(card => card.getAttribute('data-character-id'))).toEqual([first.id, variant.id]);
  expect(document.querySelector('.jb-count')!.textContent).toBe('2 characters · 3 saved cards');
  expect(document.querySelector(`[data-character-id="${variant.id}"] .jb-card-copies`)).toBeNull();
  const openCopies = () => (document.querySelector(`[data-character-id="${first.id}"] .jb-card-copies`) as HTMLButtonElement).click();
  const chooseOlder = async () => {
    const picker = document.querySelector<HTMLSelectElement>('.jb-profile-copy-select')!;
    expect(picker.getAttribute('aria-label')).toBe('Saved copy');
    expect([...picker.options].map(option => option.value)).toEqual([first.id, older.id]);
    picker.value = older.id; picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await flush();
    expect(document.querySelector<HTMLSelectElement>('.jb-profile-copy-select')!.value).toBe(older.id);
    expect(document.querySelectorAll('.jb-profile-window')).toHaveLength(1);
  };
  openCopies(); await flush(); expect(calls).toHaveLength(0); await chooseOlder();
  findButton('Favorite', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(savedFavorites).toEqual([older.id]);
  findButton('Edit card', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'modal', id: 'character_editor' }, params: { id: older.id } }]);
  openCopies(); await flush(); await chooseOlder();
  findButton('Start new chat', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(calls.at(-1)).toEqual({ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: older.id, mode: 'new' } });
  expect(requests.filter(request => request.options.method && request.options.method !== 'GET').map(request => request.url.pathname)).toEqual(['/api/v1/settings/favorites']);
  expect(groupedQueries).toHaveLength(0); expect(native.outerHTML).toBe(nativeMarkup);
});

test('opening an All Characters card shows the full introduction and definition panels without starting a conversation', async () => {
  let chatReads = 0; characterChatsResult = async () => { chatReads++; return []; };
  characterResult = async id => ({ id, name: 'Selected card', creator_notes: 'Public card introduction', description: 'Private definition' });
  start(); await flush(); (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(document.querySelector('.jb-preview-body .jb-character-profile')).toBeNull();
  expect(document.querySelector('.jb-preview-body.jb-character-profile')).not.toBeNull();
  const note = document.querySelector<HTMLDetailsElement>('.jb-profile-notes')!; expect(note.open).toBe(true);
  expect(document.querySelector('.jb-profile-rich')!.childElementCount).toBe(1);
  note.open = true; note.dispatchEvent(new dom.window.Event('toggle'));
  expect(document.querySelector('.jb-preview-body')!.textContent).toContain('Public card introduction');
  expect(document.querySelector('.jb-profile-details')!.textContent).toContain('Private definition');
  expect([...document.querySelectorAll<HTMLDetailsElement>('.jb-profile-field')].every(field => !field.open)).toBe(true);
  expect(document.querySelector('[data-surface-id="character_preview_panel"]')).toBeNull();
  expect(surfaceHandlers.size).toBe(0); expect(chatReads).toBe(0); expect(calls).toHaveLength(0);
  expect([...document.querySelectorAll('.jb-preview button')].some(button => button.textContent === 'Pin')).toBe(false);
  expect(document.querySelector('.jb-card-cta')!.textContent).toBe('Read Creator’s Notes →');
  expect(findButton('Favorited')).not.toBeNull(); expect(findButton('Edit card')).not.toBeNull();
  expect(document.querySelector('.jb-profile-window')!.firstElementChild!.classList.contains('jb-character-profile')).toBe(true);
  expect(findButton('Start new chat').closest('.jb-profile-chat-actions')).not.toBeNull();
  expect(findButton('Start new chat').classList.contains('jb-primary')).toBe(true);
  expect(findButton('Start new chat').closest('.jb-profile-sidebar')).not.toBeNull();
});

test('the separate explicit chat action starts a new chat rather than resuming the existing conversation', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(calls).toHaveLength(0);
  findButton('Start new chat').click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_0', mode: 'new' } }]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(calls).toHaveLength(1); closeModal('.jb-preview');
});

test('Continue old chat opens a picker and resumes the chosen conversation without creating another', async () => {
  const reads: string[] = [];
  characterChatsResult = async id => { reads.push(id); return [{ id: 'old-story', name: 'A saved story', message_count: 3, updated_at: 100, created_at: 90, last_message_preview: 'Last scene' }]; };
  start(); await flush(); (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(reads).toHaveLength(0); findButton('Continue old chat').click(); await flush();
  expect(reads).toEqual(['char_0']); expect(calls).toHaveLength(0);
  document.querySelector<HTMLButtonElement>('.jb-profile-chat-row')!.click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'old-story' } }]);
  expect(document.querySelector('.jb-profile-window')).toBeNull();
});

test('an unavailable chat action leaves card details and Creator’s Notes usable', async () => {
  chatActionAvailable = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(findButton('Start new chat').disabled).toBe(true);
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  await flush();
  expect(document.querySelector('.jb-profile-notes')).not.toBeNull(); expect(calls).toHaveLength(0);
});

test('missing Chats permission leaves the preview usable and explains how to enable it', async () => {
  allowChats = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  const chat = findButton('Start new chat'); chat.click(); await flush();
  expect(chat.disabled).toBe(false); expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  expect(document.querySelector('.jb-character-profile h2')!.textContent).toBe('Current character');
  expect(calls.some(call => call.ref.kind === 'route')).toBe(false);
});

test('Read Creator’s Notes stays on Home, renders the selected full note, and retains working close/edit actions', async () => {
  characterResult = async id => ({ id, name: 'Selected card', creator_notes: `<h2>Public introduction</h2><p>${'An introduction. '.repeat(30)}Full creator note.</p>`, description: 'Definition stays in details.' });
  start(); await flush(); (document.querySelector('.jb-card-cta')!.closest('button') as HTMLButtonElement).click(); await flush();
  expect(location.pathname).toBe('/'); expect(calls).toHaveLength(0);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(surfaceDestroyed).toBe(0);
  const note = document.querySelector<HTMLDetailsElement>('.jb-profile-notes')!; expect(note.open).toBe(true);
  expect(document.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.');
  expect(document.querySelector('.jb-profile-notes .jb-profile-rich h2')!.textContent).toBe('Public introduction');
  expect(document.querySelector('.jb-profile-details')!.textContent).toContain('Definition stays in details.');
  expect([...document.querySelectorAll<HTMLDetailsElement>('.jb-profile-field')].every(field => !field.open)).toBe(true);
  expect(native.outerHTML).toBe(nativeMarkup);
  findButton('Edit card', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'modal', id: 'character_editor' }, params: { id: 'char_0' } }]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  const row = document.querySelector('.jb-profile-window .jb-profile-controls .jb-preview-actions')!;
  expect([...row.querySelectorAll('button')].map(node => node.textContent).slice(-2)).toEqual(['Edit card', 'Delete card']);
  expect([...document.querySelectorAll('.jb-profile-window button')].some(node => node.textContent === 'Close')).toBe(false);
  findButton('Delete card', row as HTMLElement).click();
  expect(document.querySelector<HTMLElement>('.jb-profile-removal .jb-delete-confirmation')!.hidden).toBe(false);
  findButton('Cancel', document.querySelector('.jb-profile-window')!).click(); expect(findButton('Delete card', row as HTMLElement).hidden).toBe(false);
  findButton('Edit card', row as HTMLElement).click(); await flush();
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
});

test('the inline Favorite button saves the native card preference without opening notes or starting a chat', async () => {
  let saved = ['char_4', 'another-native-favorite'];
  fetchResult = async (url, options) => {
    if (url.pathname !== '/api/v1/settings/favorites') return respond(cards);
    if (options.method === 'PUT') saved = JSON.parse(String(options.body)).value;
    return { ok: true, status: 200, json: async () => ({ value: [...saved] }) };
  };
  start(); await flush();
  const inline = document.querySelector<HTMLButtonElement>('[data-character-id="char_1"] .jb-card-favorite')!;
  expect(inline.tagName).toBe('BUTTON'); expect(inline.parentElement!.closest('button')).toBeNull();
  expect(inline.getAttribute('aria-label')).toBe('Favorite Character 1'); expect(inline.getAttribute('aria-pressed')).toBe('false');
  inline.click(); inline.click(); await flush();
  expect(saved).toEqual(['char_4', 'another-native-favorite', 'char_1']);
  expect(requests.filter(request => request.url.pathname === '/api/v1/settings/favorites' && request.options.method === 'PUT')).toHaveLength(1);
  const updated = document.querySelector<HTMLButtonElement>('[data-character-id="char_1"] .jb-card-favorite')!;
  expect(updated.getAttribute('aria-pressed')).toBe('true'); expect(updated.getAttribute('aria-label')).toBe('Remove Character 1 from favorites');
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(calls).toHaveLength(0);
  updated.click(); await flush();
  expect(saved).toEqual(['char_4', 'another-native-favorite']);
  expect(document.querySelector('[data-character-id="char_1"] .jb-card-favorite')!.getAttribute('aria-pressed')).toBe('false');
});

test('replacing a gallery page disposes its Favorite controls and prevents a delayed preference write', async () => {
  const pending = deferred<any>();
  fetchResult = async url => url.pathname === '/api/v1/settings/favorites' ? pending.promise : respondPage(allCards, url);
  start(); await flush();
  const subscriptionCount = subscriptions.get('characters.favorites')!.size;
  const inline = document.querySelector<HTMLButtonElement>('[data-character-id="char_1"] .jb-card-favorite')!;
  inline.click(); await flush();
  const favoriteRead = requests.find(request => request.url.pathname === '/api/v1/settings/favorites')!;
  findButton('Next →').click(); await flush();
  expect(favoriteRead.signal!.aborted).toBe(true); expect(inline.isConnected).toBe(false);
  expect(subscriptions.get('characters.favorites')!.size).toBe(subscriptionCount);
  pending.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) }); await flush();
  expect(requests.some(request => request.options.method === 'PUT')).toBe(false); expect(calls).toHaveLength(0);
});

test('Favorite persists the native preference and preserves other favorites read immediately before saving', async () => {
  let saved = ['char_4', 'saved-in-another-surface'];
  fetchResult = async (url, options) => {
    if (url.pathname === '/api/v1/settings/favorites') {
      if (options.method === 'PUT') {
        saved = JSON.parse(String(options.body)).value; favoriteIds = [...saved];
        subscriptions.get('characters.favorites')!.forEach(handler => handler());
      }
      return { ok: true, status: 200, json: async () => ({ value: [...saved] }) };
    }
    return respond(cards);
  };
  start(); await flush(); (document.querySelectorAll('.jb-card')[1] as HTMLElement).click(); await flush();
  const favorite = findButton('Favorite'); favorite.click(); favorite.click(); await flush();
  expect(saved).toEqual(['char_4', 'saved-in-another-surface', 'char_1']);
  expect(requests.filter(request => request.url.pathname === '/api/v1/settings/favorites' && request.options.method === 'PUT')).toHaveLength(1);
  expect(favorite.getAttribute('aria-pressed')).toBe('true'); expect(favorite.textContent).toBe('Favorited');
  expect(document.querySelector('[data-character-id="char_1"] .jb-card-favorite')!.getAttribute('aria-pressed')).toBe('true');
  favorite.click(); await flush();
  expect(saved).toEqual(['char_4', 'saved-in-another-surface']); expect(favorite.getAttribute('aria-pressed')).toBe('false');
  expect(calls).toHaveLength(0);
});

test('a failed native Favorite write leaves the card readable and does not pretend it was saved', async () => {
  fetchResult = async (url, options) => url.pathname === '/api/v1/settings/favorites'
    ? { ok: options.method !== 'PUT', status: options.method === 'PUT' ? 500 : 200, json: async () => ({ value: [] }) }
    : respond(cards);
  start(); await flush(); (document.querySelectorAll('.jb-card')[1] as HTMLElement).click(); await flush();
  const favorite = findButton('Favorite'); favorite.click(); await flush();
  expect(favorite.disabled).toBe(false); expect(favorite.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('.jb-profile-controls > .jb-status')!.textContent).toContain('Could not save');
  expect(document.querySelector('.jb-preview-body')).not.toBeNull(); expect(calls).toHaveLength(0);
});

test('closing a card while its favorite preference is loading prevents a delayed write', async () => {
  const pending = deferred<any>();
  fetchResult = async url => url.pathname === '/api/v1/settings/favorites' ? pending.promise : respond(cards);
  start(); await flush(); (document.querySelectorAll('.jb-card')[1] as HTMLElement).click(); await flush();
  findButton('Favorite').click(); await flush();
  const request = requests.find(request => request.url.pathname === '/api/v1/settings/favorites')!;
  closeModal('.jb-preview');
  expect(request.signal?.aborted).toBe(true);
  pending.resolve({ ok: true, status: 200, json: async () => ({ value: [] }) }); await flush();
  expect(requests.some(request => request.options.method === 'PUT')).toBe(false);
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

test('favorite writes from replacement card windows wait for a previous native save before merging', async () => {
  let saved = ['char_4']; const pending = deferred<void>(); let first = true;
  fetchResult = async (url, options) => {
    if (url.pathname !== '/api/v1/settings/favorites') return respond(cards);
    if (options.method === 'PUT') {
      if (first) { first = false; await pending.promise; }
      saved = JSON.parse(String(options.body)).value; favoriteIds = [...saved];
      subscriptions.get('characters.favorites')!.forEach(handler => handler());
    }
    return { ok: true, status: 200, json: async () => ({ value: [...saved] }) };
  };
  start(); await flush(); (document.querySelectorAll('.jb-card')[1] as HTMLElement).click(); await flush();
  findButton('Favorite').click(); await flush();
  closeModal('.jb-preview');
  (document.querySelectorAll('.jb-card')[2] as HTMLElement).click(); await flush();
  findButton('Favorite').click(); await flush();
  expect(requests.filter(request => request.url.pathname === '/api/v1/settings/favorites' && request.options.method !== 'PUT')).toHaveLength(1);
  pending.resolve(); await flush(); await flush();
  expect(saved).toEqual(['char_4', 'char_1', 'char_2']);
  expect(findButton('Favorited').getAttribute('aria-pressed')).toBe('true'); expect(calls).toHaveLength(0);
});

test('a named summary hydrates missing creator provenance and retains its cached profile link when Home rerenders', async () => {
  fetchResult = async () => respond([{ id: 'imported', name: 'Imported card', creator: 'Original Author ✨', creator_notes: 'A public introduction', updated_at: 1 }]);
  let reads = 0;
  characterResult = async id => { reads++; return { id, name: 'Imported card', creator: 'Original Author ✨', creator_notes: 'A public introduction', extensions: { jar_bridge: { source: 'janitorai', creator_name: 'Original Author ✨', creator_id: '12345678-1234-4234-8234-123456789abc' } } }; };
  start(); await flush();
  const creator = document.querySelector<HTMLAnchorElement>('.jb-card .jb-creator a')!;
  expect(creator.textContent).toBe('@Original Author ✨');
  expect(creator.href).toBe('https://janitorai.com/profiles/12345678-1234-4234-8234-123456789abc');
  expect(creator.closest('button')).toBeNull(); expect(creator.target).toBe('_blank');
  creator.addEventListener('click', event => event.preventDefault()); creator.click(); await flush();
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(calls).toHaveLength(0);
  expect(reads).toBe(1);
  findButton('Home', roots.get('landing_header')!).click(); await flush(); expect(reads).toBe(1);
  expect(document.querySelector('.jb-creator')!.textContent).toBe('@Original Author ✨');
  expect(document.querySelector<HTMLAnchorElement>('.jb-card .jb-creator a')!.href).toBe('https://janitorai.com/profiles/12345678-1234-4234-8234-123456789abc');
});

test('creator provenance lookup failure preserves a creator note already supplied by the summary', async () => {
  fetchResult = async () => respond([{ id: 'recorded-author', name: 'Card', creator: 'Recorded author', creator_notes: 'Available public introduction', updated_at: 1 }]);
  characterResult = async () => { throw new Error('Read unavailable'); };
  start(); await flush();
  expect(document.querySelector('.jb-description')!.textContent).toBe('Available public introduction');
  expect(document.querySelector('.jb-creator')!.textContent).toBe('@Recorded author');
  expect(document.querySelector('.jb-creator a')).toBeNull();
});

test('disable cleans owned UI/styles/subscriptions, closes preview and restores the original marker', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(document.querySelectorAll('style').length).toBeGreaterThan(0); stop!(); stop = undefined;
  expect(document.querySelectorAll('style')).toHaveLength(0); expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(surfaceDestroyed).toBe(0); expect([...roots.values()].every(root => root.childNodes.length === 0)).toBe(true);
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

test('Add API connection opens the native Connections drawer without loading the custom form or requesting access', async () => {
  let permissionRequests = 0;
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush();
  const previousRequests = requests.length;
  roots.get('landing_hero')!.querySelector<HTMLButtonElement>('[data-step=connection]')!.click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'connections' }, params: undefined }]);
  expect(document.querySelector('.jb-api-settings')).toBeNull();
  expect(requests).toHaveLength(previousRequests);
  expect(permissionRequests).toBe(0);
});

test('Home API Settings opens native Connections directly without a custom connection window', async () => {
  start(); await flush();
  const previousRequests = requests.length;
  findButton('API Settings', roots.get('landing_header')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'connections' }, params: undefined }]);
  expect(document.querySelector('.jb-settings-window-root')).toBeNull();
  expect(requests).toHaveLength(previousRequests);
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
});

test('Create a persona opens a writing guide and form without requesting permission or saving', async () => {
  let permissionRequests = 0;
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush();
  const previousRequests = requests.length;
  roots.get('landing_hero')!.querySelector<HTMLButtonElement>('[data-step=persona]')!.click(); await flush();
  expect(calls).toEqual([]);
  expect(requests).toHaveLength(previousRequests);
  expect(permissionRequests).toBe(0);
  const creator = document.querySelector('.jb-persona-create')!;
  expect(creator.getAttribute('aria-label')).toBe('Create a persona');
  expect(creator.textContent).toContain('your persona is who you play');
  expect(creator.querySelector('input[name=name]')).not.toBeNull();
  expect(creator.querySelector('textarea[name=description]')).not.toBeNull();
  expect(creator.textContent).toContain('A simple example');
  findButton('Open existing personas', creator).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'personas' }, params: undefined }]);
  expect(creator.isConnected).toBe(false);
});

test('the optional preset or prompt shortcut opens its editor without saving settings or requesting access', async () => {
  let permissionRequests = 0;
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush();
  roots.get('landing_hero')!.querySelector<HTMLButtonElement>('[data-step=prompt]')!.click(); await flush();
  expect(document.querySelector('.jb-settings-prompt')).not.toBeNull();
  expect(permissionRequests).toBe(0);
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
  expect(calls).toEqual([]);
});

test('card import stays regular with JAR installed; only the explicit history shortcut invokes JAR', async () => {
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
  const summary = document.querySelector('.jb-more > summary')!; let menuScrolled = false;
  summary.scrollIntoView = () => { menuScrolled = true; };
  document.querySelector<HTMLButtonElement>('[data-step=card]')!.click(); await flush();
  expect(document.querySelector('.jb-card-methods')).toBeNull();
  expect(menuScrolled).toBe(true);
  expect(document.querySelector<HTMLDetailsElement>('.jb-more')!.open).toBe(true);
  expect(findButton('Import characters', roots.get('landing_header')!).classList.contains('jb-card-import-target')).toBe(true);
  expect(document.querySelector('.jb-card-import')).toBeNull();
  findButton('Import characters', roots.get('landing_header')!).click(); await flush();
  expect(document.querySelector('.jb-card-import')).not.toBeNull();
  expect(document.querySelector('.jb-import-guide')).not.toBeNull();
  expect(calls).toEqual([]);
  findButton('Close', document.querySelector('.jb-card-import')!).click();
  findButton('Import characters', roots.get('landing_header')!).click(); await flush();
  expect(document.querySelector('.jb-card-import')).not.toBeNull();
  expect(calls).toEqual([]);
  findButton('Close', document.querySelector('.jb-card-import')!).click();
  findButton('Import old chats', roots.get('landing_header')!).click(); await flush();
  expect(calls).toEqual([
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
  findButton('Import old chats', roots.get('landing_header')!).click(); await flush();
  expect(emitted).toEqual([{ name: 'jar_bridge:open_import', payload: {} }]);
  expect(calls).toHaveLength(0); expect(requests).toHaveLength(priorRequests);
});

test('without an invocable JAR drawer the Basics card guide teaches the menu before opening file/link import', async () => {
  const nativeList = ctx.host.surfaces.list;
  ctx.host.surfaces.list = (kinds?: string[]) => [
    ...nativeList(kinds),
    ...(!kinds || kinds.includes('drawer_tab') ? [{ kind: 'drawer_tab', id: 'jar-disabled', invocable: false, keywords: ['jar_bridge', 'jar-bridge-import'] }] : []),
  ];
  let permissionsRead = 0, permissionRequests = 0;
  ctx.permissions.getGranted = async () => { permissionsRead++; return []; };
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush(); const priorRequests = requests.length;
  document.querySelector<HTMLButtonElement>('[data-step=card]')!.click(); await flush();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(document.querySelector('.jb-card-menu-guide')).not.toBeNull();
  expect(requests).toHaveLength(priorRequests); expect(calls).toHaveLength(0);
  findButton('Import characters', roots.get('landing_header')!).click(); await flush();
  const modal = document.querySelector('[role=dialog]')!;
  expect(modal.getAttribute('aria-label')).toBe('Import character');
  expect(findButton('File', modal).getAttribute('aria-selected')).toBe('true');
  expect(findButton('Link', modal).getAttribute('aria-selected')).toBe('false');
  const input = modal.querySelector('input[type=file]') as HTMLInputElement;
  expect(input.multiple).toBe(true); expect(input.accept).toContain('.png'); expect(input.accept).toContain('.json');
  expect(calls).toHaveLength(0); expect(requests).toHaveLength(priorRequests);
  expect(permissionsRead).toBe(0); expect(permissionRequests).toBe(0);
});

test('the live checklist offers the traditional native menu and cleans up its guide with the extension', async () => {
  start(); await flush();
  document.querySelector<HTMLButtonElement>('.jb-setup-step[data-step=card]')!.click(); await flush();
  expect(document.querySelector('.jb-card-menu-guide')).not.toBeNull();
  findButton('Use Chars → + instead').click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'characters' }, params: undefined }]);
  expect(document.querySelector('.jb-card-import')).toBeNull(); expect(document.querySelector('.jb-card-menu-guide')!.textContent).toContain('Chars → +');
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
  stop!(); stop = undefined; expect(document.querySelector('.jb-card-menu-guide')).toBeNull();
});

test('history without JAR explains the optional extension without routing card users to it', async () => {
  start(); await flush();
  findButton('Import old chats', roots.get('landing_header')!).click(); await flush();
  const guide = document.querySelector('.jb-feature-tutorial')!;
  expect(guide.getAttribute('aria-label')).toBe('Bring your old chat history');
  findButton('Open history importer', guide).click(); await flush();
  expect(guide.textContent).toContain('Install and enable JAR Bridge');
  expect(calls).toEqual([]);
  expect(document.querySelector('.jb-card-import')).toBeNull();
});

test('first-install welcome on native Characters waits for an explicit Home click before navigating or acknowledging', async () => {
  dom.window.history.replaceState({}, '', '/characters'); activeChat = { chatId: null, characterId: null };
  let permissionRequests = 0; const writes: Array<{ key: string; value: unknown }> = [];
  ctx.settings = { get: async () => undefined, set: async (key: string, value: unknown) => { writes.push({ key, value }); } };
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  const invokeNative = ctx.host.surfaces.invoke;
  ctx.host.surfaces.invoke = async (ref: Ref, params?: Record<string, string>) => {
    await invokeNative(ref, params);
    if (ref.kind === 'route' && ref.id === '/') dom.window.history.replaceState({}, '', '/');
  };
  start(); await flush();
  const welcome = document.querySelector('.jb-welcome')!;
  expect(welcome.getAttribute('aria-label')).toBe('Welcome to Janiverse');
  expect(welcome.textContent).toContain('No permissions enabled yet? That’s normal.');
  expect(dom.window.location.pathname).toBe('/characters'); expect(calls).toHaveLength(0); expect(writes).toHaveLength(0);
  expect(permissionRequests).toBe(0); expect(native.outerHTML).toBe(nativeMarkup);
  findButton('Open Janiverse Home', welcome).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'route', id: '/' }, params: undefined }]);
  expect(dom.window.location.pathname).toBe('/'); expect(document.documentElement.getAttribute('data-janitor-bridge-view')).toBe('browse');
  expect(document.querySelector('.jb-welcome')).toBeNull();
  expect(writes).toEqual([{ key: 'onboarding:welcome_completed_v1', value: true }]);
  expect(permissionRequests).toBe(0); expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('Home More keeps five everyday actions and moves setup guides into Help', async () => {
  start(); await flush(); const beforeRequests = requests.length;
  const more = roots.get('landing_header')!.querySelector<HTMLDetailsElement>('.jb-more')!; more.open = true;
  expect([...more.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Import characters', 'Import old chats', 'API Settings', 'Prompt & generation', 'Help']);
  findButton('Help', more).click(); await flush(); const help = document.querySelector('.jb-chat-help')!;
  expect(help.getAttribute('aria-label')).toBe('Help'); expect(findButton('Start here', help).getAttribute('aria-pressed')).toBe('true');
  expect(findButton('Where did it go? Search JanitorAI terms', help)).not.toBeNull();
  expect([...help.querySelectorAll('.jb-start-guide button')].map(node => node.textContent)).toEqual(['Show checklist', 'API connection guide', 'Card import guide', 'Old chat import guide', 'Create a persona', 'Show the list']);
  expect(more.open).toBe(false); expect(calls).toHaveLength(0); expect(requests).toHaveLength(beforeRequests);
  findButton('Card import guide', help).click(); await flush();
  expect(help.isConnected).toBe(false); expect(more.open).toBe(true); expect(document.querySelector('.jb-card-menu-guide')).not.toBeNull();
  expect(document.querySelector('.jb-card-import')).toBeNull(); expect(calls).toHaveLength(0);
});

test('Help restores the hidden checklist without repeating first-run orientation', async () => {
  start(); await flush(); findButton('Do this later', roots.get('landing_hero')!).click(); await flush();
  findButton('Help', roots.get('landing_header')!).click(); await flush();
  expect(roots.get('landing_hero')!.querySelector<HTMLElement>('.jb-discover')!.hidden).toBe(true);
  findButton('Show checklist', document.querySelector('.jb-chat-help')!).click(); await flush();
  expect(document.querySelector('.jb-chat-help')).toBeNull(); expect(document.querySelector('.jb-welcome')).toBeNull();
  expect(roots.get('landing_hero')!.querySelector<HTMLElement>('.jb-discover')!.hidden).toBe(false);
  expect(roots.get('landing_hero')!.querySelector('h2')!.textContent).toBe('Let’s do the basics.');
  expect(document.querySelector<HTMLElement>('.jb-setup-checklist')!.hidden).toBe(false); expect(calls).toHaveLength(0);
});

test('Home Help hands off to persistent task guides and replaces an old guide without adding native writes', async () => {
  let permissionRequests = 0; ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush(); const header = roots.get('landing_header')!;
  findButton('Help', header).click(); await flush(); const firstHelp = document.querySelector('.jb-chat-help')!; findButton('AI settings', firstHelp).click(); findButton('Preset guide', firstHelp).click(); await flush();
  const presetGuide = document.querySelector<HTMLElement>('.jb-tutorial-companion')!; expect(presetGuide.dataset.feature).toBe('presets'); expect(calls).toHaveLength(0);
  findButton('Open preset editor', presetGuide).click(); await flush(); expect(calls.at(-1)).toEqual({ ref: { kind: 'drawer_tab', id: 'loom' }, params: undefined }); expect(presetGuide.isConnected).toBe(true);
  findButton('Help', header).click(); await flush(); expect(presetGuide.isConnected).toBe(false);
  const help = document.querySelector('.jb-chat-help')!; findButton('Story tools', help).click();
  findButton('Set up a Lorebook', help).click(); await flush(); const bookGuide = document.querySelector<HTMLElement>('.jb-tutorial-companion')!; expect(bookGuide.dataset.feature).toBe('lorebooks');
  findButton('Open Lorebooks', bookGuide).click(); await flush(); expect(calls.at(-1)).toEqual({ ref: { kind: 'drawer_tab', id: 'lorebook' }, params: undefined }); expect(bookGuide.isConnected).toBe(true);
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true); expect(permissionRequests).toBe(0);
});

test('one Home prompt entry opens both instructions and generation without saving', async () => {
  start(); await flush(); findButton('Prompt & generation', roots.get('landing_header')!).click(); await flush();
  const panel = document.querySelector('.jb-settings-window-root')!; expect(panel).not.toBeNull();
  expect(findButton('Instructions', panel).getAttribute('aria-selected')).toBe('true'); findButton('Generation', panel).click();
  expect(findButton('Generation', panel).getAttribute('aria-selected')).toBe('true'); expect(calls).toHaveLength(0);
  expect(requests.every(request => !request.options.method || request.options.method === 'GET')).toBe(true);
});

test('Home Help stays available after first-run dismissal without routing, requesting grants or repeating the welcome', async () => {
  dom.window.history.replaceState({}, '', '/characters'); activeChat = { chatId: null, characterId: null };
  const saved = new Map<string, unknown>(); let permissionRequests = 0, writes = 0;
  ctx.settings = { get: async (key: string) => saved.get(key), set: async (key: string, value: unknown) => { writes++; saved.set(key, value); } };
  ctx.permissions.request = async () => { permissionRequests++; return []; };
  start(); await flush(); const first = document.querySelector('.jb-welcome')!;
  findButton('Got it', first).click(); await flush();
  expect(document.querySelector('.jb-welcome')).toBeNull(); expect(saved.get('onboarding:welcome_completed_v1')).toBe(true); expect(writes).toBe(1);
  const more = roots.get('landing_header')!.querySelector('.jb-more') as HTMLDetailsElement; more.open = true;
  findButton('Help', more).click(); await flush();
  const help = document.querySelector('.jb-chat-help')!; expect(help).not.toBeNull(); expect(document.querySelector('.jb-welcome')).toBeNull();
  expect(findButton('Show checklist', help)).not.toBeNull(); expect(dom.window.location.pathname).toBe('/characters');
  expect(calls).toHaveLength(0); expect(permissionRequests).toBe(0); expect(native.outerHTML).toBe(nativeMarkup);
  stop!(); stop = undefined; expect(help.isConnected).toBe(false); expect(writes).toBe(1);
});

test('a favorite change in All characters keeps the current gallery page', async () => {
  start(); await flush(); findButton('Next →').click(); await flush();
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('25–48 of 72');
  subscriptions.get('characters.favorites')!.forEach(handler => handler()); await flush();
  expect(document.querySelector('.jb-paging span')!.textContent).toBe('25–48 of 72');
  expect(document.querySelector('.jb-card')!.getAttribute('data-character-id')).toBe('char_24');
});

test('a failed shortcut inside a chat floats its message, and Home keeps it in the status line', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  ctx.host.surfaces.invoke = async () => { throw new Error('drawer unavailable'); };
  (roots.get('chat_header_left')!.querySelector('.jb-chat-title') as HTMLButtonElement).click(); await flush();
  expect(document.querySelector('.jb-toast')!.textContent).toBe('Could not open that tool. Please try again from the sidebar.');
  stop!(); stop = undefined; expect(document.querySelector('.jb-toast')).toBeNull();
  dom.window.history.replaceState({}, '', '/'); activeChat = { chatId: null, characterId: null }; start(); await flush();
  (document.querySelector('.jb-recent-card') as HTMLButtonElement | null)?.click(); await flush();
  expect(document.querySelector('.jb-toast')).toBeNull();
});

test('Create a Character offers the familiar form or Lumiverse’s editor with its guide', async () => {
  start(); await flush();
  findButton('Create a Character').click(); await flush();
  const choice = document.querySelector('.jb-character-choice')!; expect(choice).not.toBeNull(); expect(calls).toHaveLength(0);
  findButton('Use the familiar form', choice).click(); await flush();
  expect(document.querySelector('.jb-character-create')).not.toBeNull(); expect(calls).toHaveLength(0);
  findButton('Create a Character').click(); await flush();
  findButton('Open with a guide', document.querySelector('.jb-character-choice')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'drawer_tab', id: 'characters' }, params: undefined }]);
  expect(document.querySelector('.jb-character-choice')).toBeNull();
  expect(document.querySelector<HTMLElement>('.jb-tutorial-companion')!.dataset.feature).toBe('character');
});
