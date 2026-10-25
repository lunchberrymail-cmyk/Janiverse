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
    requests.push({ url, signal: init.signal as AbortSignal | undefined, options: init });
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
    ...['characters', 'connections', 'personas', 'loom', 'lorebook', 'spindle', 'profile', 'summary', 'cortex'].map(id => ({ kind: 'drawer_tab', id })),
    { kind: 'settings_tab', id: 'display' },
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
  findButton('×', document.querySelector('.jb-settings-window-root')!).click();
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

test('Settings composes native API, prompt and generation editors with a persistent footer and cleans them on tab changes', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' }; start(); await flush();
  findButton('Settings', roots.get('chat_header_left')!).click(); await flush();
  const window = document.querySelector('.jb-settings-window-root')!;
  const api = window.querySelector('.jb-api-settings')!;
  const promo = api.querySelector('.jb-preset-promo')!;
  const provider = api.querySelector('.jb-api-provider-card')!;
  expect(promo.compareDocumentPosition(provider) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect([...promo.querySelectorAll('a')].map(anchor => [anchor.textContent, anchor.href])).toEqual([
    ['Browse presets', 'https://illarin.com/browse?type=preset'],
    ['Presets on Discord', 'https://discord.com/channels/1484149939167821915/1484156801447497792'],
    ['Join Discord', 'https://discord.gg/28rBWVFfCu'],
  ]);
  expect(api.querySelector('[aria-label="Improve chat memory"]')).toBeNull();
  expect([...api.querySelectorAll('button')].some(button => button.textContent === 'Set up summaries')).toBe(false);
  expect(api.classList.contains('jb-settings-combined')).toBe(true);
  expect(api.querySelector('input[name="temperature-slider"]')).not.toBeNull();
  expect(api.querySelector('textarea[name="global-prompt"]')).not.toBeNull();
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
  expect(requests.every(request => !/\/(?:generate|generation)(?:\/|$)/.test(request.url.pathname))).toBe(true);
  expect(native.outerHTML).toBe(nativeMarkup);
});

test('unavailable memory setup keeps the Memory editor and its unsaved text available', async () => {
  dom.window.history.replaceState({}, '', '/chat/active_chat');
  activeChat = { chatId: 'active_chat', characterId: 'char_current' };
  const nativeList = ctx.host.surfaces.list;
  ctx.host.surfaces.list = (kinds?: string[]) => nativeList(kinds).filter((surface: Ref) => surface.id !== 'cortex');
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
  expect(requests.every(request => !/\/(?:generate|generation)(?:\/|$)/.test(request.url.pathname))).toBe(true);
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
      : respond(cards, 72);
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
  const header = roots.get('chat_header_left')!; findButton('Play in chat', header).click();
  expect(header.querySelector('iframe')).not.toBeNull();
  findButton('‹ Back', header).click(); expect(header.querySelector('iframe')).toBeNull();
  findButton('Play in chat', header).click(); const frame = header.querySelector('iframe')!;
  subscriptions.get('chat.active')!.forEach(handler => handler()); await flush();
  expect(header.querySelector('iframe')).toBe(frame);
  dom.window.history.replaceState({}, '', '/'); await new Promise(resolve => setTimeout(resolve, 550));
  expect(activeChat.chatId).toBe('active_chat'); expect(header.querySelector('iframe')).toBeNull();
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
  expect(requests[0].url.searchParams.get('sort')).toBe('created');
  expect([...document.querySelectorAll('.jb-sort option')].map(option => (option as HTMLOptionElement).value)).toEqual(['created', 'name']);
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
  const unsafe = { id: 'unsafe', name: '<img src=x onerror=alert(1)>', creator: '<svg onload=alert(1)>', creator_notes: '<img src=x onerror=alert(1)>Safe <b>creator note</b>', description: '<img src=x onerror=alert(1)>Safe <b>description</b>', tags: ['<script>alert(1)</script>'] };
  fetchResult = async () => respond([unsafe]); characterResult = async () => unsafe;
  start(); await flush();
  expect(document.querySelector('.jb-card h3')!.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(document.querySelector('.jb-description')!.textContent).toBe('Safe creator note');
  expect(document.querySelectorAll('.jb-grid img, .jb-grid script, .jb-grid svg')).toHaveLength(0);
  (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(document.querySelector('.jb-preview-body .jb-profile-notes')!.textContent).toContain('Safe creator note');
  expect(document.querySelectorAll('.jb-preview script, .jb-preview svg, .jb-preview [onerror], .jb-preview [onload]')).toHaveLength(0);
  expect(document.querySelector('.jb-preview img')!.getAttribute('src')).toBe('/api/v1/characters/unsafe/avatar?size=lg');
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

test('opening an All Characters card shows card details without mounting chat history or starting a conversation', async () => {
  let chatReads = 0; characterChatsResult = async () => { chatReads++; return []; };
  characterResult = async id => ({ id, name: 'Selected card', creator_notes: 'Public card introduction', description: 'Private definition' });
  start(); await flush(); (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(document.querySelector('.jb-preview-body .jb-character-profile')).toBeNull();
  expect(document.querySelector('.jb-preview-body.jb-character-profile')).not.toBeNull();
  expect(document.querySelector('.jb-preview-body')!.textContent).toContain('Public card introduction');
  expect(document.querySelector('.jb-preview-body details')!.textContent).toContain('Private definition');
  expect((document.querySelector('.jb-preview-body details') as HTMLDetailsElement).open).toBe(false);
  expect(document.querySelector('[data-surface-id="character_preview_panel"]')).toBeNull();
  expect(surfaceHandlers.size).toBe(0); expect(chatReads).toBe(0); expect(calls).toHaveLength(0);
  expect([...document.querySelectorAll('.jb-preview button')].some(button => button.textContent === 'Pin')).toBe(false);
  expect(findButton('Read Creator’s Notes')).not.toBeNull(); expect(findButton('Favorited')).not.toBeNull();
});

test('only the separate explicit chat action resumes a conversation from a character card', async () => {
  start(); await flush(); (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(calls).toHaveLength(0);
  findButton('Chat with this character').click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'entity_action', id: 'character_chat' }, params: { characterId: 'char_0', mode: 'latest' } }]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLElement).click(); await flush();
  expect(calls).toHaveLength(1); findButton('Close', document.querySelector('.jb-preview')!).click();
});

test('an unavailable chat action leaves card details and Creator’s Notes usable', async () => {
  chatActionAvailable = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  expect(findButton('Chat with this character').disabled).toBe(true);
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  findButton('Read Creator’s Notes').click(); await flush();
  expect(document.querySelector('.jb-profile-notes')).not.toBeNull(); expect(calls).toHaveLength(0);
});

test('missing Chats permission leaves the preview usable and explains how to enable it', async () => {
  allowChats = false; start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  const chat = findButton('Chat with this character'); chat.click(); await flush();
  expect(chat.disabled).toBe(false); expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(document.querySelector('.jb-preview')!.textContent).toContain('Chats permission');
  findButton('Read Creator’s Notes').click(); await flush();
  expect(document.querySelector('.jb-character-profile h2')!.textContent).toBe('Current character');
  expect(calls.some(call => call.ref.kind === 'route')).toBe(false);
});

test('Read Creator’s Notes stays on Home, renders the selected full note, and retains working close/edit actions', async () => {
  characterResult = async id => ({ id, name: 'Selected card', creator_notes: '<h2>Public introduction</h2><p>Full creator note.</p>', description: 'Definition stays in details.' });
  start(); await flush(); (document.querySelector('.jb-card') as HTMLButtonElement).click();
  findButton('Read Creator’s Notes').click(); await flush();
  expect(location.pathname).toBe('/'); expect(calls).toHaveLength(0);
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1); expect(surfaceDestroyed).toBe(0);
  expect(document.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.');
  expect(document.querySelector('.jb-profile-details')!.textContent).toContain('Definition stays in details.');
  expect((document.querySelector('.jb-profile-details') as HTMLDetailsElement).open).toBe(false);
  expect(native.outerHTML).toBe(nativeMarkup);
  findButton('Edit character', document.querySelector('.jb-profile-window')!).click(); await flush();
  expect(calls).toEqual([{ ref: { kind: 'modal', id: 'character_editor' }, params: { id: 'char_0' } }]);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  (document.querySelector('.jb-card') as HTMLButtonElement).click(); findButton('Read Creator’s Notes').click(); await flush();
  findButton('Close', document.querySelector('.jb-profile-window')!).click();
  expect(document.querySelector('[role=dialog]')).toBeNull(); expect(document.querySelectorAll('.jb-card')).toHaveLength(24);
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
  expect(document.querySelector('[data-character-id="char_1"] .jb-favorite')).not.toBeNull();
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
  expect(document.querySelector('.jb-preview .jb-status')!.textContent).toContain('Could not save');
  expect(document.querySelector('.jb-preview-body')).not.toBeNull(); expect(calls).toHaveLength(0);
});

test('closing a card while its favorite preference is loading prevents a delayed write', async () => {
  const pending = deferred<any>();
  fetchResult = async url => url.pathname === '/api/v1/settings/favorites' ? pending.promise : respond(cards);
  start(); await flush(); (document.querySelectorAll('.jb-card')[1] as HTMLElement).click(); await flush();
  findButton('Favorite').click(); await flush();
  const request = requests.find(request => request.url.pathname === '/api/v1/settings/favorites')!;
  findButton('Close', document.querySelector('.jb-preview')!).click();
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
  findButton('Close', document.querySelector('.jb-preview')!).click();
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
  findButton('Next idea').click();
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
  findButton('Next idea').click();
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
  findButton('Next idea').click();
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
