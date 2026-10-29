import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createMyChats, profileMarkup } from '../src/my-chats';

type Query = { limit?: number; offset?: number; search?: string; sort?: string; direction?: string };
type Grouped = { character_id: string; character_name: string; character_image_id: string | null; latest_chat_id: string; latest_chat_name: string; updated_at: number; chat_count: number; is_group: boolean; group_character_ids?: string[]; group_name?: string };
const now = Math.floor(Date.now() / 1000);
const groups: Grouped[] = [
  { character_id: 'ada', character_name: 'Ada', character_image_id: 'ada-portrait', latest_chat_id: 'ada-latest', latest_chat_name: 'Moonlit garden', updated_at: now, chat_count: 4, is_group: false },
  { character_id: 'mira', character_name: 'Mira', character_image_id: null, latest_chat_id: 'mira-latest', latest_chat_name: 'New beginnings', updated_at: now - 5000, chat_count: 2, is_group: false },
  { character_id: 'ada', character_name: 'Ada', character_image_id: null, latest_chat_id: 'crew-latest', latest_chat_name: 'The crew', group_name: 'The crew', group_character_ids: ['ada', 'mira'], updated_at: now - 10000, chat_count: 3, is_group: true },
];
const recent = groups.map(group => ({ id: group.latest_chat_id, character_id: group.character_id, character_name: group.character_name, character_image_id: group.character_image_id, name: group.latest_chat_name, metadata: group.is_group ? { group: true, character_ids: group.group_character_ids, active_persona_id: null } : { active_persona_id: null }, created_at: now - 100000, updated_at: group.updated_at, message_count: 12, last_message_preview: '<b>Safe preview</b> <img src=x onerror=alert(1)>' }));
const summaries = [
  { id: 'ada-today', name: 'Today conversation', message_count: 10, created_at: now - 60, updated_at: now - 60, last_message_preview: 'A current scene.' },
  { id: 'ada-yesterday', name: 'Yesterday conversation', message_count: 8, created_at: now - 86400, updated_at: now - 86400, last_message_preview: 'An earlier scene.' },
  { id: 'ada-old', name: 'Older conversation', message_count: 4, created_at: now - 86400 * 40, updated_at: now - 86400 * 40, last_message_preview: 'An old scene.' },
];
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const originals = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch, DOMParser: globalThis.DOMParser };
let dom: any, ctx: any, view: ReturnType<typeof createMyChats> | undefined;
let groupedReads: Query[], recentReads: Query[], characterChatReads: string[], characterReads: string[];
let fetches: { url: URL; init: RequestInit }[], mutations: string[], invoked: { ref: { kind: string; id: string }; params?: Record<string, string> }[];
let opened: string[], started: string[];
let groupedResult: (query: Query) => Promise<any>, recentResult: (query: Query) => Promise<any>, summariesResult: (id: string) => Promise<any>;
let characterResult: (id: string) => Promise<any>;
let hiddenResult: () => Promise<any>, startResult: (id: string) => void | Promise<boolean>;
let metadataResult: (query: Record<string, string>) => Promise<any>, personaResult: (query: Record<string, string>) => Promise<any>;
let chatDetailResult: (id: string) => Promise<any>;
let injections: Element[], uninjected: Element[];
let subscriptions: Map<string, Set<() => void>>;
function root(): HTMLElement { if (!view) throw new Error('View not created'); return view.root; }
function btn(text: string, parent: ParentNode = root()): HTMLButtonElement {
  const value = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text || node.getAttribute('aria-label') === text);
  if (!value) throw new Error(`Missing button ${text}`); return value;
}
function setup() {
  view = createMyChats(ctx, {
    invoke: async (ref: { kind: string; id: string }, params?: Record<string, string>) => { invoked.push({ ref, params }); return true; },
    openCharacter: (id: string) => { opened.push(id); }, startChat: (id: string) => { started.push(id); return startResult(id); },
  });
  document.body.append(view.root); return view;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main id="native">Native chat remains mounted</main></body></html>', { url: 'http://localhost:7860/' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.DOMParser = dom.window.DOMParser;
  groupedReads = []; recentReads = []; characterChatReads = []; characterReads = []; fetches = []; mutations = []; invoked = []; opened = []; started = []; subscriptions = new Map();
  groupedResult = async () => ({ data: structuredClone(groups), total: 3 }); recentResult = async () => ({ data: structuredClone(recent), total: 3 });
  summariesResult = async () => structuredClone(summaries);
  hiddenResult = async () => []; startResult = () => {}; injections = []; uninjected = [];
  metadataResult = async () => ({ data: [], total: 0 }); personaResult = async () => ({ data: [], total: 0 });
  chatDetailResult = async id => ({ id, character_id: id.startsWith('mira') ? 'mira' : 'ada', metadata: { active_persona_id: null } });
  characterResult = async id => ({ id, name: id === 'ada' ? 'Ada' : 'Mira', image_id: null, creator_notes: '<b>Creator note</b>', description: '<b>Character description</b>', personality: 'Thoughtful', tags: ['Adventure'] });
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input), dom.window.location.href); fetches.push({ url, init });
    if (init.method && init.method !== 'GET') { mutations.push(init.method); throw new Error('Unexpected mutation'); }
    expect(init.credentials).toBe('same-origin');
    const query = Object.fromEntries([...url.searchParams].map(([key, value]) => [key, ['limit', 'offset'].includes(key) ? Number(value) : value])) as Query;
    const result = url.pathname === '/api/v1/chats/hidden-from-recent' ? hiddenResult()
      : url.pathname === '/api/v1/chats' ? metadataResult(Object.fromEntries(url.searchParams))
      : url.pathname === '/api/v1/personas' ? personaResult(Object.fromEntries(url.searchParams))
      : url.pathname === '/api/v1/chats/recent-grouped' ? groupedResult(query)
        : url.pathname === '/api/v1/chats/recent' ? recentResult(query)
          : url.pathname.includes('/chats/character-chats/') ? summariesResult(decodeURIComponent(url.pathname.split('/').at(-1)!))
            : /^\/api\/v1\/chats\/[^/]+$/.test(url.pathname) ? chatDetailResult(decodeURIComponent(url.pathname.split('/').at(-1)!))
            : characterResult(decodeURIComponent(url.pathname.split('/').at(-1)!));
    return { ok: true, json: async () => result } as any;
  }) as typeof fetch;
  const subscribe = (key: string, fn: () => void) => { const callbacks = subscriptions.get(key) ?? new Set(); callbacks.add(fn); subscriptions.set(key, callbacks); return () => callbacks.delete(fn); };
  ctx = {
    dom: {
      inject: (target: HTMLElement, markup: string) => { const node = document.createElement('div'); node.innerHTML = markup; target.append(node); injections.push(node); return node; },
      uninject: (node: Element) => { uninjected.push(node); node.remove(); },
    },
    chats: {
      listRecentGrouped: async (query: Query) => { groupedReads.push({ ...query }); return groupedResult(query); },
      listRecent: async (query: Query) => { recentReads.push({ ...query }); return recentResult(query); },
      listForCharacter: async (id: string) => { characterChatReads.push(id); return summariesResult(id); },
      create: async () => { mutations.push('chats.create'); throw new Error('Unexpected create'); },
      update: async () => { mutations.push('chats.update'); throw new Error('Unexpected update'); },
      delete: async () => { mutations.push('chats.delete'); throw new Error('Unexpected delete'); },
    },
    characters: { get: async (id: string) => { characterReads.push(id); return characterResult(id); } },
    state: { get: (key: string) => key === 'characters.favorites' ? [] : undefined, subscribe },
    events: { on: subscribe },
    permissions: { getGranted: async () => [], request: async () => { mutations.push('permissions.request'); return []; } },
  };
});
afterEach(() => {
  view?.destroy(); view = undefined; dom.window.close();
  globalThis.document = originals.document; globalThis.location = originals.location; globalThis.fetch = originals.fetch; globalThis.DOMParser = originals.DOMParser;
});

describe('My Chats reads native conversations without changing them', () => {
  test('stays inert until activation and renders grouped rows plus three compact Continue cards', async () => {
    recentResult = async () => ({ data: structuredClone(recent), total: 9 });
    const native = document.querySelector('#native')!; const original = native.outerHTML; const browser = setup();
    expect(root().hidden).toBe(true); expect(groupedReads).toHaveLength(0); expect(recentReads).toHaveLength(0); expect(fetches).toHaveLength(0);
    browser.activate(); await flush();
    expect(root().hidden).toBe(false); expect(groupedReads).toEqual([{ limit: 12, offset: 0, sort: 'recent', direction: 'desc' }]);
    expect(recentReads).toEqual([{ limit: 3, offset: 0, sort: 'recent', direction: 'desc' }]);
    expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(3); expect(root().querySelectorAll('.jb-mc-character')).toHaveLength(3);
    expect(root().querySelector('.jb-mc-summary')?.textContent).toBe('3 characters & groups · 9 chats');
    expect(root().querySelector('.jb-mc-all-nav .jb-mc-count')?.textContent).toBe('9');
    expect(characterReads).toHaveLength(0); expect(characterChatReads).toHaveLength(0); expect(fetches).toHaveLength(0); expect(mutations).toHaveLength(0); expect(started).toHaveLength(0);
    expect(native.outerHTML).toBe(original);
  });
  test('Continue invokes exact chat IDs even when the same character appears in several rows', async () => {
    setup().activate(); await flush(); const cards = [...root().querySelectorAll<HTMLButtonElement>('.jb-mc-resume-card')];
    cards[0].click(); cards[2].click(); await flush();
    expect(invoked).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'ada-latest' } }, { ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'crew-latest' } }]);
    expect(cards[2].getAttribute('aria-label')).toBe('Continue The crew'); expect(started).toHaveLength(0); expect(mutations).toHaveLength(0);
  });
  test('expanding a solo character reads summaries once, excludes hidden chats and groups the visible conversations by date', async () => {
    hiddenResult = async () => [{ id: 'ada-old' }]; setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(characterReads).toEqual(['ada']); expect(characterChatReads).toEqual(['ada']); expect(fetches.map(item => item.url.pathname)).toEqual(['/api/v1/chats/hidden-from-recent', '/api/v1/chats']);
    expect([...root().querySelectorAll('.jb-mc-date-heading')].map(node => node.textContent)).toEqual(['Today', 'Yesterday']);
    expect([...root().querySelectorAll('.jb-mc-conversation-name')].map(node => node.textContent)).toEqual(['Today conversation', 'Yesterday conversation']);
    expect(root().textContent).not.toContain('Older conversation'); expect(root().querySelector('.jb-mc-description b')?.textContent).toBe('Creator note');
    expect(mutations).toHaveLength(0); expect(started).toHaveLength(0); expect(invoked).toHaveLength(0);
  });
  test('Name A–Z orders every conversation together across date boundaries', async () => {
    setup().activate(); await flush();
    btn('Ada, 4 chats').click(); await flush();
    const sort = root().querySelector<HTMLSelectElement>('select[aria-label="Sort conversations"]')!;
    sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change')); await flush();
    expect([...root().querySelectorAll('.jb-mc-conversation-name')].map(node => node.textContent)).toEqual(['Older conversation', 'Today conversation', 'Yesterday conversation']);
    expect(root().querySelectorAll('.jb-mc-date-heading')).toHaveLength(0);
  });

  test('conversation navigation, profile view and Start new chat are separate explicit native actions', async () => {
    const pending = deferred<boolean>(); startResult = () => pending.promise;
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect([...root().querySelectorAll('.jb-mc-date-heading')].map(node => node.textContent)).toEqual(['Today', 'Yesterday', 'Older']);
    btn('Continue Yesterday conversation').click(); btn('View character →').click();
    const start = btn('＋ Start new chat'); start.click(); start.click(); await flush();
    expect(invoked).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'ada-yesterday' } }]); expect(opened).toEqual(['ada']); expect(started).toEqual(['ada']); expect(start.disabled).toBe(true);
    pending.resolve(true); await flush(); expect(start.disabled).toBe(false); expect(mutations).toHaveLength(0);
  });
  test('group rows never use solo character summaries or offer a solo Start new chat action', async () => {
    setup().activate(); await flush(); btn('The crew, 3 chats').click(); await flush();
    expect(characterReads).toHaveLength(0); expect(characterChatReads).toHaveLength(0); expect(fetches).toHaveLength(0); expect(root().querySelector('.jb-mc-profile')).toBeNull();
    btn('Continue group chat').click(); await flush(); expect(invoked).toEqual([{ ref: { kind: 'route', id: '/chat/:chatId' }, params: { chatId: 'crew-latest' } }]); expect(started).toHaveLength(0);
  });
  test('a failed solo expansion stays local and Retry reads the same character again', async () => {
    let attempts = 0; summariesResult = async () => { if (++attempts === 1) throw new Error('Unavailable'); return structuredClone(summaries); };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(root().querySelector('.jb-mc-expanded')?.textContent).toContain('Could not load this character'); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(3);
    btn('Retry').click(); await flush(); expect(characterChatReads).toEqual(['ada', 'ada']); expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(3); expect(mutations).toHaveLength(0);
  });
  test('a character response with another ID is rejected instead of being shown under the selected row', async () => {
    characterResult = async () => ({ id: 'other-character', name: 'Wrong character', description: 'Wrong definition' });
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(root().querySelector('.jb-mc-expanded')?.textContent).toContain('Could not load'); expect(root().textContent).not.toContain('Wrong definition'); expect(root().querySelector('.jb-mc-profile')).toBeNull();
  });
});

describe('My Chats native rename and delete actions', () => {
  test('renames only the selected chat, preserves its expanded character and never navigates', async () => {
    const writes: unknown[] = []; ctx.permissions.getGranted = async () => ['chats'];
    ctx.chats.update = async (id: string, input: unknown) => { writes.push({ id, input }); return { id, ...input as object }; };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    const detail = root().querySelector('.jb-mc-expanded');
    btn('Rename chat: Yesterday conversation').click();
    const input = root().querySelector<HTMLInputElement>('input[aria-label="Chat name"]')!;
    expect(input.value).toBe('Yesterday conversation'); input.value = '  A name I chose  ';
    btn('Save name').click(); await flush(); await flush();
    expect(writes).toEqual([{ id: 'ada-yesterday', input: { name: 'A name I chose' } }]);
    expect(btn('Continue A name I chose')).toBeDefined(); expect(root().querySelector('.jb-mc-expanded')).toBe(detail);
    expect(btn('Ada, 4 chats').getAttribute('aria-expanded')).toBe('true'); expect(invoked).toHaveLength(0); expect(started).toHaveLength(0);
  });
  test('Cancel and Escape discard a draft, while blank names never reach the native API', async () => {
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    btn('Rename chat: Today conversation').click(); btn('Cancel').click();
    expect((root().querySelector('.jb-mc-conversation-editor') as HTMLElement).hidden).toBe(true);
    btn('Rename chat: Today conversation').click();
    const input = root().querySelector<HTMLInputElement>('input[aria-label="Chat name"]')!; input.value = '   ';
    input.closest('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true })); await flush();
    expect(root().textContent).toContain('Enter a chat name.'); expect(mutations).toHaveLength(0);
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((root().querySelector('.jb-mc-conversation-editor') as HTMLElement).hidden).toBe(true);
    expect(document.activeElement).toBe(btn('Rename chat: Today conversation')); expect(invoked).toHaveLength(0);
  });
  test('delete requires confirmation, removes the exact conversation and refreshes counts without deleting its character', async () => {
    const deleted: string[] = []; ctx.permissions.getGranted = async () => ['chats'];
    ctx.chats.delete = async (id: string) => { deleted.push(id); groupedResult = async () => ({ data: [{ ...groups[0], chat_count: 3 }], total: 1 }); recentResult = async () => ({ data: [], total: 2 }); const previous = summariesResult; summariesResult = async (character: string) => (await previous(character)).filter((chat: { id: string }) => chat.id !== id); };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    btn('Delete chat: Yesterday conversation').click(); expect(deleted).toHaveLength(0); expect(invoked).toHaveLength(0);
    expect(root().textContent).toContain('permanently deletes this conversation and its messages'); btn('Cancel').click(); expect(deleted).toHaveLength(0);
    btn('Delete chat: Yesterday conversation').click(); btn('Delete chat').click(); await flush(); await flush();
    expect(deleted).toEqual(['ada-yesterday']); expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(2);
    expect(root().textContent).not.toContain('Yesterday conversation'); expect(root().querySelector('.jb-mc-summary')?.textContent).toBe('1 character or group · 2 chats');
    expect(btn('Ada, 3 chats').getAttribute('aria-expanded')).toBe('true'); expect(document.querySelector('#native')?.textContent).toBe('Native chat remains mounted');
  });
  test('permission is requested only by the explicit enable action and enabling alone does not submit a write', async () => {
    let allowed = false; const writes: string[] = []; const requests: unknown[] = [];
    ctx.permissions.getGranted = async () => allowed ? ['chats'] : [];
    ctx.permissions.request = async (...args: unknown[]) => { requests.push(args); allowed = true; };
    ctx.chats.update = async (id: string, input: { name: string }) => { writes.push(id); return { id, ...input }; };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); btn('Rename chat: Today conversation').click();
    btn('Save name').click(); await flush(); expect(writes).toHaveLength(0); expect(requests).toHaveLength(0);
    btn('Enable Chats permission').click(); await flush(); expect(requests).toHaveLength(1); expect(writes).toHaveLength(0);
    btn('Save name').click(); await flush(); expect(writes).toEqual(['ada-today']);
  });
  test('pending deletion blocks duplicate submissions and background events preserve the confirmation', async () => {
    const pending = deferred<void>(); const writes: string[] = []; ctx.permissions.getGranted = async () => ['chats'];
    ctx.chats.delete = (id: string) => { writes.push(id); return pending.promise; };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); btn('Delete chat: Today conversation').click();
    const confirm = btn('Delete chat'); confirm.click(); confirm.click(); await flush();
    subscriptions.get('CHAT_CHANGED')?.forEach(callback => callback()); await new Promise(resolve => setTimeout(resolve, 325));
    expect(writes).toEqual(['ada-today']); expect(btn('Delete chat')).toBe(confirm); expect(confirm.disabled).toBe(true); expect(btn('Cancel').disabled).toBe(true);
    pending.resolve(); await flush(); await flush(); expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(2);
  });
  test('an unconfirmed write retains the conversation and offers a read refresh without automatically retrying', async () => {
    let attempts = 0; ctx.permissions.getGranted = async () => ['chats']; ctx.chats.delete = async () => { attempts++; throw new Error('Lost response'); };
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); btn('Delete chat: Today conversation').click(); btn('Delete chat').click(); await flush();
    expect(attempts).toBe(1); expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(3); expect(root().textContent).toContain('Could not confirm the change.');
    btn('Refresh chats').click(); await flush(); expect(attempts).toBe(1); expect(root().querySelectorAll('.jb-mc-character')).toHaveLength(3);
  });
  test('navigation away during permission checking prevents a stale form from changing a chat', async () => {
    const pending = deferred<string[]>(); ctx.permissions.getGranted = () => pending.promise;
    const browser = setup(); browser.activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); btn('Delete chat: Today conversation').click(); btn('Delete chat').click(); browser.deactivate();
    pending.resolve(['chats']); await flush(); expect(mutations).toHaveLength(0); expect(root().hidden).toBe(true);
  });
  test('late optional persona reads cannot erase a rename draft', async () => {
    const pending = deferred<any>(); metadataResult = () => pending.promise;
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); btn('Rename chat: Today conversation').click();
    const input = root().querySelector<HTMLInputElement>('input[aria-label="Chat name"]')!; input.value = 'My unsaved name';
    pending.resolve({ data: [], total: 0 }); await flush(); expect(input.isConnected).toBe(true); expect(input.value).toBe('My unsaved name');
  });
  test('group conversations expose the same native rename and delete controls', async () => {
    const renamed: unknown[] = [], deleted: string[] = []; ctx.permissions.getGranted = async () => ['chats'];
    ctx.chats.update = async (id: string, input: { name: string }) => { renamed.push({ id, input }); return { id, ...input }; };
    ctx.chats.delete = async (id: string) => { deleted.push(id); };
    setup().activate(); await flush(); btn('The crew, 3 chats').click(); await flush(); btn('Rename chat: The crew').click();
    root().querySelector<HTMLInputElement>('input[aria-label="Chat name"]')!.value = 'Weekend adventure'; btn('Save name').click(); await flush(); await flush();
    expect(renamed).toEqual([{ id: 'crew-latest', input: { name: 'Weekend adventure' } }]); expect(btn('Continue group chat')).toBeDefined();
    btn('Delete chat: Weekend adventure').click(); btn('Delete chat').click(); await flush(); expect(deleted).toEqual(['crew-latest']); expect(invoked).toHaveLength(0);
  });
});

describe('My Chats filters and asynchronous lifecycle', () => {
  test('search and sort reset pagination and send the native sort/query values', async () => {
    groupedResult = async () => ({ data: structuredClone(groups), total: 36 }); setup().activate(); await flush(); btn('Next →').click(); await flush(); expect(groupedReads.at(-1)?.offset).toBe(12);
    const search = root().querySelector<HTMLInputElement>('input[aria-label="Search character"]')!; search.value = '  Mira  '; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 230)); expect(groupedReads.at(-1)).toMatchObject({ search: 'Mira', offset: 0, limit: 12 });
    btn('Next →').click(); await flush(); const sort = root().querySelector<HTMLSelectElement>('select[aria-label="Sort characters"]')!;
    sort.value = 'name'; sort.dispatchEvent(new dom.window.Event('change')); await flush(); expect(groupedReads.at(-1)).toMatchObject({ offset: 0, sort: 'name', direction: 'asc' });
    sort.value = 'oldest'; sort.dispatchEvent(new dom.window.Event('change')); await flush(); expect(groupedReads.at(-1)).toMatchObject({ offset: 0, sort: 'recent', direction: 'asc' });
    (root().querySelector('.jb-mc-all-nav') as HTMLButtonElement).click(); await flush();
    expect(search.value).toBe(''); expect(sort.value).toBe('latest'); expect(groupedReads.at(-1)).toEqual({ limit: 12, offset: 0, sort: 'recent', direction: 'desc' });
  });
  test('a stale grouped result cannot replace a newer search result when SDK reads ignore abort', async () => {
    const old = deferred<any>(), fresh = deferred<any>(); let reads = 0; groupedResult = async () => ++reads === 1 ? old.promise : fresh.promise;
    const browser = setup(); browser.activate(); await flush(); expect(groupedReads).toHaveLength(1); browser.setSearch('Mira'); await flush(); expect(groupedReads).toHaveLength(2);
    fresh.resolve({ data: [groups[1]], total: 1 }); await flush(); old.resolve({ data: [groups[0]], total: 1 }); await flush();
    expect([...root().querySelectorAll('.jb-mc-character-name')].map(node => node.textContent)).toEqual(['Mira']); expect(root().querySelector('.jb-mc-summary')?.textContent).toContain('1 character');
  });
  test('older character-detail responses cannot replace another expanded row', async () => {
    const old = deferred<any>(); summariesResult = async id => id === 'ada' ? old.promise : [{ ...summaries[0], id: 'mira-current', name: 'Mira current' }];
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); const firstSignal = fetches[0].init.signal!;
    btn('Mira, 2 chats').click(); await flush(); expect(firstSignal.aborted).toBe(true); old.resolve(structuredClone(summaries)); await flush();
    expect(root().querySelectorAll('.jb-mc-profile')).toHaveLength(1); const visible = [...root().querySelectorAll<HTMLElement>('.jb-mc-expanded')].find(node => !node.hidden)!;
    expect(visible.textContent).toContain('Mira current'); expect(visible.textContent).not.toContain('Today conversation'); btn('Continue Mira current', visible).click(); await flush(); expect(invoked.at(-1)?.params).toEqual({ chatId: 'mira-current' });
  });
  test('collapsing an in-flight character expansion cannot re-open it on completion', async () => {
    const pending = deferred<any>(); summariesResult = async () => pending.promise;
    setup().activate(); await flush(); const header = btn('Ada, 4 chats'); header.click(); await flush(); header.click(); pending.resolve(structuredClone(summaries)); await flush();
    expect(header.getAttribute('aria-expanded')).toBe('false'); expect((root().querySelector('.jb-mc-expanded') as HTMLElement).hidden).toBe(true); expect(root().querySelector('.jb-mc-profile')).toBeNull();
  });
  test('a collection shrinking beyond the current page is clamped and reloaded', async () => {
    let total = 36; groupedResult = async () => ({ data: structuredClone(groups), total }); const browser = setup(); browser.activate(); await flush();
    btn('Next →').click(); await flush(); btn('Next →').click(); await flush(); expect(groupedReads.at(-1)?.offset).toBe(24);
    total = 2; browser.refresh(); await flush(); await flush(); expect(groupedReads.at(-1)?.offset).toBe(0); expect((root().querySelector('.jb-mc-pagination') as HTMLElement).hidden).toBe(true);
  });
  test('one failed endpoint does not discard data from the other endpoint', async () => {
    groupedResult = async () => { throw new Error('Grouped unavailable'); }; setup().activate(); await flush(); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(3); expect(root().querySelectorAll('.jb-mc-character')).toHaveLength(0); expect(btn('Retry')).toBeDefined();
    groupedResult = async () => ({ data: structuredClone(groups), total: 3 }); recentResult = async () => { throw new Error('Recent unavailable'); }; btn('Retry').click(); await flush();
    expect(root().querySelectorAll('.jb-mc-character')).toHaveLength(3); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(0);
  });
  test('fallback reads use fixed same-origin native GET routes and encoded queries', async () => {
    delete ctx.chats.listRecentGrouped; delete ctx.chats.listRecent; delete ctx.chats.listForCharacter;
    const browser = setup(); browser.setSearch('Ada & Friends'); browser.activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(fetches[0].url.pathname).toBe('/api/v1/chats/recent-grouped'); expect(fetches[0].url.searchParams.get('search')).toBe('Ada & Friends');
    expect(fetches.some(item => item.url.pathname === '/api/v1/chats/character-chats/ada')).toBe(true); expect(fetches.some(item => item.url.pathname === '/api/v1/chats/hidden-from-recent')).toBe(true); expect(fetches.every(item => !item.init.method || item.init.method === 'GET')).toBe(true); expect(mutations).toHaveLength(0);
  });
  test('untrusted names and previews remain text, while profile formatting removes active content', async () => {
    groupedResult = async () => ({ data: [{ ...groups[0], character_name: '<img src=x onerror=alert(1)>' }], total: 1 });
    characterResult = async id => ({ id, creator_notes: '<p onclick="alert(1)">Safe <b>bio</b><img src="https://illustration.example/image.png" onerror="alert(1)"><script>bad()</script><iframe src="https://evil.example"></iframe><a href="javascript:alert(1)">Bad URL</a></p>' });
    setup().activate(); await flush(); expect(root().querySelector('.jb-mc-character-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root().querySelector('.jb-mc-resume-preview')?.textContent).toBe('Safe preview'); expect(root().querySelector('.jb-mc-resume-preview img')).toBeNull();
    btn('<img src=x onerror=alert(1)>, 4 chats').click(); await flush(); const profile = root().querySelector('.jb-mc-description')!;
    expect(profile.querySelector('b')?.textContent).toBe('bio'); expect(profile.querySelector('img')?.getAttribute('src')).toBe('https://illustration.example/image.png');
    expect(profile.querySelectorAll('script,iframe,[onclick],[onerror],a[href^="javascript:"]')).toHaveLength(0); expect(mutations).toHaveLength(0);
  });
  test('long rich creator notes start bounded and expand only by explicit choice without reloading chats', async () => {
    characterResult = async id => ({ id, creator_notes: '<p>' + 'A long creator note. '.repeat(200) + '</p><img src="https://example.com/art.png"><a href="https://example.com/card">Original card</a>', description: 'Private definition stays out of the chat browser.' });
    const style = document.createElement('style'); style.textContent = await Bun.file(new URL('../src/my-chats.css', import.meta.url)).text(); document.head.append(style);
    const native = document.querySelector('#native')!, nativeMarkup = native.outerHTML;
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    const note = root().querySelector('.jb-mc-description') as HTMLElement;
    const toggle = btn('Read full creator note'), requestsBefore = fetches.length;
    expect(dom.window.getComputedStyle(note).maxHeight).toBe('360px'); expect(dom.window.getComputedStyle(note).overflow).toBe('auto');
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(toggle.getAttribute('aria-controls')).toBe(note.id);
    expect(note.querySelector('img')?.getAttribute('src')).toBe('https://example.com/art.png');
    expect(note.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(3); expect(root().textContent).not.toContain('Private definition');
    toggle.click(); expect(toggle.textContent).toBe('Show less'); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(dom.window.getComputedStyle(note).maxHeight).toBe('none');
    note.scrollTop = 150; toggle.click(); expect(toggle.textContent).toBe('Read full creator note'); expect(note.scrollTop).toBe(0);
    expect(dom.window.getComputedStyle(note).maxHeight).toBe('360px'); expect(fetches).toHaveLength(requestsBefore);
    expect(characterReads).toEqual(['ada']); expect(characterChatReads).toEqual(['ada']); expect(injections).toHaveLength(1);
    expect(mutations).toHaveLength(0); expect(native.outerHTML).toBe(nativeMarkup);
  });
  test('missing creator notes never fall back to private character definitions', async () => {
    characterResult = async id => ({ id, creator_notes: '  ', description: 'Private character definition', preview_description: 'Old copied definition' });
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(root().querySelector('.jb-mc-description')?.textContent).toBe('No creator’s note.');
    expect(root().textContent).not.toContain('Private character definition'); expect(root().textContent).not.toContain('Old copied definition');
    expect(root().querySelector('.jb-mc-note-toggle')).toBeNull(); expect(injections).toHaveLength(0);
    expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(3);
  });
  test('collapsing a character releases its rich note and removes its detached expansion control', async () => {
    setup().activate(); await flush(); const header = btn('Ada, 4 chats'); header.click(); await flush();
    const toggle = btn('Read full creator note'); header.click();
    expect(uninjected).toHaveLength(1); toggle.click(); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(injections).toHaveLength(1); expect(mutations).toHaveLength(0);
    header.click(); await flush(); expect(btn('Read full creator note').getAttribute('aria-expanded')).toBe('false');
  });
  test('Continue resolves only actual native persona bindings and never substitutes a global or copied display name', async () => {
    recentResult = async () => ({ data: [{ ...recent[0], metadata: { active_persona_id: 'persona-a' } }, { ...recent[1], metadata: { active_persona_id: null, persona_id: 'old-import-id', persona_name: 'Unbound guessed name' } }], total: 2 });
    personaResult = async () => ({ data: [{ id: 'persona-a', name: 'Actual persona' }, { id: 'global-persona', name: 'Global persona' }], total: 2 });
    setup().activate(); await flush(); expect(root().textContent).toContain('as Actual persona'); expect(root().textContent).not.toContain('Unbound guessed name'); expect(root().textContent).not.toContain('Global persona');
    expect(fetches.map(item => item.url.pathname)).toEqual(['/api/v1/personas']);
    expect(fetches[0].url.searchParams.toString()).toBe('limit=200&offset=0');
  });
  test('expanded chat personas come from one paginated native metadata join and batched persona reads, never messages', async () => {
    metadataResult = async query => ({ data: query.offset === '0' ? [{ id: 'ada-today', metadata: { active_persona_id: 'persona-a' } }] : [{ id: 'ada-yesterday', metadata: { active_persona_id: 'persona-b' } }], total: 2 });
    personaResult = async query => ({ data: query.offset === '0' ? [{ id: 'persona-a', name: 'Morning persona' }] : [{ id: 'persona-b', name: 'Evening persona' }], total: 2 });
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    expect(btn('Continue Today conversation').textContent).toContain('as Morning persona'); expect(btn('Continue Yesterday conversation').textContent).toContain('as Evening persona'); expect(btn('Continue Older conversation').textContent).not.toContain('as ');
    const metadata = fetches.filter(item => item.url.pathname === '/api/v1/chats'); expect(metadata).toHaveLength(2); expect(metadata.map(item => item.url.searchParams.get('offset'))).toEqual(['0', '1']); expect(metadata.every(item => item.url.searchParams.get('characterId') === 'ada')).toBe(true);
    expect(fetches.filter(item => item.url.pathname === '/api/v1/personas')).toHaveLength(2); expect(fetches.some(item => /messages/.test(item.url.pathname))).toBe(false); expect(mutations).toHaveLength(0);
  });
  test('optional persona lookup failure leaves chats usable without guessing a name', async () => {
    recentResult = async () => ({ data: [{ ...recent[0], metadata: { active_persona_id: 'missing', persona_name: 'Copied name' } }], total: 1 });
    personaResult = async () => { throw new Error('Unavailable'); };
    setup().activate(); await flush(); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(1); expect(root().querySelector('.jb-mc-persona')).toBeNull(); btn('Continue Ada').click(); await flush(); expect(invoked.at(-1)?.params).toEqual({ chatId: 'ada-latest' });
  });
  test('missing recent metadata uses at most three exact native reads without loading messages', async () => {
    recentResult = async () => ({ data: [...recent, { ...recent[0], id: 'fourth' }].map(row => ({ ...row, metadata: row.id === 'crew-latest' ? { group: true } : undefined })), total: 4 });
    chatDetailResult = async id => ({ id, character_id: id.startsWith('mira') ? 'mira' : 'ada', metadata: { active_persona_id: 'persona-a' } });
    personaResult = async () => ({ data: [{ id: 'persona-a', name: 'Saved persona' }], total: 1 });
    setup().activate(); await flush();
    const details = fetches.filter(item => /^\/api\/v1\/chats\/[^/]+$/.test(item.url.pathname));
    expect(details.map(item => item.url.pathname)).toEqual(['/api/v1/chats/ada-latest', '/api/v1/chats/mira-latest', '/api/v1/chats/crew-latest']);
    expect(details.every(item => item.url.searchParams.toString() === 'messages=false')).toBe(true); expect(root().querySelectorAll('.jb-mc-persona')).toHaveLength(3); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(3); expect(btn('Continue The crew')).toBeDefined(); expect(mutations).toHaveLength(0);
  });
  test('an explicit saved no-persona binding bypasses compatibility reads and global defaults', async () => {
    recentResult = async () => ({ data: [{ ...recent[0], metadata: { active_persona_id: null, persona_name: 'Copied persona' } }], total: 1 });
    ctx.state.get = () => ({ id: 'global', name: 'Global persona' }); setup().activate(); await flush();
    expect(fetches).toHaveLength(0); expect(root().querySelector('.jb-mc-persona')).toBeNull(); expect(root().textContent).not.toContain('Global persona'); expect(root().textContent).not.toContain('Copied persona');
  });
  test('compatibility metadata rejects both mismatched chat IDs and mismatched character IDs', async () => {
    recentResult = async () => ({ data: recent.slice(0, 2).map(row => ({ ...row, metadata: undefined })), total: 2 });
    chatDetailResult = async id => ({ id: id === 'ada-latest' ? 'wrong-chat' : id, character_id: id === 'mira-latest' ? 'wrong-character' : 'ada', metadata: { active_persona_id: 'wrong-persona' } });
    personaResult = async () => ({ data: [{ id: 'wrong-persona', name: 'Wrong persona' }], total: 1 });
    setup().activate(); await flush(); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(2); expect(root().querySelector('.jb-mc-persona')).toBeNull(); expect(fetches.some(item => item.url.pathname === '/api/v1/personas')).toBe(false);
    btn('Continue Ada').click(); await flush(); expect(invoked.at(-1)?.params).toEqual({ chatId: 'ada-latest' });
  });
  test('an unavailable optional recent metadata read leaves Continue working', async () => {
    recentResult = async () => ({ data: [{ ...recent[0], metadata: undefined }], total: 1 }); chatDetailResult = async () => { throw new Error('Unavailable'); };
    setup().activate(); await flush(); expect(root().querySelector('.jb-mc-persona')).toBeNull(); expect(root().textContent).not.toContain('Could not load your recent'); btn('Continue Ada').click(); await flush(); expect(invoked.at(-1)?.params).toEqual({ chatId: 'ada-latest' });
  });
  test('late compatibility reads cannot replace a newer Continue list or revive the deactivated view', async () => {
    const pending = deferred<any>(); recentResult = async () => ({ data: [{ ...recent[0], metadata: undefined }], total: 1 }); chatDetailResult = async () => pending.promise;
    const browser = setup(); browser.activate(); await flush(); const oldSignal = fetches[0].init.signal!;
    recentResult = async () => ({ data: [structuredClone(recent[1])], total: 1 }); browser.refresh(); await flush(); expect(oldSignal.aborted).toBe(true);
    pending.resolve({ id: 'ada-latest', character_id: 'ada', metadata: { active_persona_id: 'old-persona' } }); await flush();
    expect([...root().querySelectorAll('.jb-mc-resume-name')].map(node => node.textContent)).toEqual(['Mira']); expect(root().querySelector('.jb-mc-persona')).toBeNull(); expect(fetches.some(item => item.url.pathname === '/api/v1/personas')).toBe(false);
    const later = deferred<any>(); recentResult = async () => ({ data: [{ ...recent[0], metadata: undefined }], total: 1 }); chatDetailResult = async () => later.promise; browser.refresh(); await flush(); browser.deactivate();
    later.resolve({ id: 'ada-latest', character_id: 'ada', metadata: { active_persona_id: 'old-persona' } }); await flush(); expect(root().hidden).toBe(true); expect(root().querySelector('.jb-mc-persona')).toBeNull();
  });
  test('synchronous SDK failures remain local and an immediate deactivation starts no deferred reads', async () => {
    ctx.chats.listRecentGrouped = () => { throw new Error('Synchronous unavailable'); };
    const browser = setup(); browser.activate(); await flush(); expect(root().textContent).toContain('Could not load your chats.'); expect(root().querySelectorAll('.jb-mc-resume-card')).toHaveLength(3);
    browser.deactivate(); const reads = recentReads.length; browser.activate(); browser.deactivate(); await flush(); expect(recentReads).toHaveLength(reads); expect(root().hidden).toBe(true);
  });
  test('deactivation stops background refresh and ignores late reads; destruction removes subscriptions and injected profiles', async () => {
    const browser = setup(); browser.activate(); await flush(); btn('Ada, 4 chats').click(); await flush(); expect(injections).toHaveLength(1);
    const pending = deferred<any>(); groupedResult = async () => pending.promise; browser.refresh(); browser.deactivate(); const reads = groupedReads.length;
    for (const callbacks of subscriptions.values()) callbacks.forEach(callback => callback()); browser.refresh(); await new Promise(resolve => setTimeout(resolve, 325));
    expect(groupedReads).toHaveLength(reads); pending.resolve({ data: [groups[1]], total: 1 }); await flush(); expect(root().hidden).toBe(true); expect(uninjected).toHaveLength(1);
    browser.destroy(); view = undefined; expect(document.querySelector('.jb-my-chats')).toBeNull(); expect([...subscriptions.values()].every(callbacks => callbacks.size === 0)).toBe(true); expect(document.querySelector('#native')?.textContent).toBe('Native chat remains mounted');
  });
});

describe('My Chats keeps an expanded character current', () => {
  test('a background change re-reads the expanded chat list without collapsing the character', async () => {
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    const detail = root().querySelector('.jb-mc-expanded'); const reads = characterChatReads.length;
    groupedResult = async () => ({ data: [{ ...structuredClone(groups[0]), chat_count: 1 }, ...structuredClone(groups.slice(1))], total: 3 });
    summariesResult = async () => structuredClone(summaries.slice(0, 1));
    subscriptions.get('CHAT_DELETED')?.forEach(callback => callback()); await new Promise(resolve => setTimeout(resolve, 325)); await flush();
    expect(characterChatReads.length).toBe(reads + 1); expect(root().querySelector('.jb-mc-expanded')).toBe(detail);
    expect(root().querySelectorAll('.jb-mc-conversation-card')).toHaveLength(1); expect(btn('Continue Today conversation')).toBeDefined();
  });
  test('rename and delete return keyboard focus to the same chat, or the first remaining one', async () => {
    ctx.permissions.getGranted = async () => ['chats'];
    ctx.chats.update = async (id: string, input: unknown) => ({ id, ...input as object });
    setup().activate(); await flush(); btn('Ada, 4 chats').click(); await flush();
    btn('Rename chat: Yesterday conversation').click();
    root().querySelector<HTMLInputElement>('input[aria-label="Chat name"]')!.value = 'Renamed';
    btn('Save name').click(); await flush(); await flush();
    expect(document.activeElement).toBe(btn('Rename chat: Renamed'));
    ctx.chats.delete = async () => {}; btn('Delete chat: Renamed').click(); btn('Delete chat').click(); await flush(); await flush();
    expect(document.activeElement?.classList.contains('jb-mc-conversation-open')).toBe(true);
  });
});

describe('Creator’s Note formatting', () => {
  test('notes only auto-load remote HTTPS images, never this server’s API or plain HTTP', () => {
    const markup = profileMarkup('<img src="/api/v1/settings/favorites"><img src="http://localhost:7860/api/v1/chats"><img src="http://example.com/a.png"><img src="https://example.com/b.png"><a href="http://example.com/page">link</a>');
    expect(markup).not.toContain('/api/v1'); expect(markup).not.toContain('http://example.com/a.png');
    expect(markup).toContain('https://example.com/b.png'); expect(markup).toContain('href="http://example.com/page"');
  });
  test('plain-text notes keep single line breaks inside a paragraph', () => {
    expect(profileMarkup('First line\nSecond line\n\nNew paragraph').replace(/ class=""/g, '')).toBe('<p>First line<br>Second line</p><p>New paragraph</p>');
  });
});
