import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createSetupChecklist, SETUP_DISMISSED_KEY } from '../src/setup-checklist';
import { createChatSetup } from '../src/chat-setup';
import { readConnection } from '../src/setup-data';
import { createHomeBanner } from '../src/home-banner';

let dom: JSDOM, oldDocument: any, oldFetch: any, ctx: any;
let checklist: ReturnType<typeof createSetupChecklist> | undefined, chatSetup: ReturnType<typeof createChatSetup> | undefined;
let homeBanner: ReturnType<typeof createHomeBanner> | undefined;
let profiles: any[], cards: any[], personas: any[], metadata: any, presets: Record<string, any>, resolved: any;
let selectors: Record<string, unknown>, subscriptions: Map<string, Set<() => void>>, events: Map<string, Set<() => void>>;
let reads: Array<{ url: URL; init: RequestInit }>, changes: Array<unknown>, opened: string[], dismissed: number;
let activeChat: string | null, savedPreference: unknown;
let respond: (url: URL, init: RequestInit) => Promise<any>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { await flush(); await flush(); };
const json = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) });
const pending = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
function button(name: string, root: ParentNode = document): HTMLButtonElement { const node = [...root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name); if (!node) throw new Error(`Missing ${name}`); return node; }
function startChecklist() {
  checklist = createSetupChecklist(ctx, { openApi: () => opened.push('api'), openImport: () => opened.push('import'), openPersona: () => opened.push('persona'), openPrompt: () => opened.push('prompt'), chooseCharacter: () => opened.push('choose'), dismissed: () => { dismissed++; } });
  document.body.append(checklist.root); return checklist;
}
function startChat() {
  activeChat = 'chat-1'; dom.window.history.replaceState({}, '', '/chat/chat-1');
  chatSetup = createChatSetup(ctx, { openApi: () => opened.push('api'), openPersona: () => opened.push('persona'), openPrompt: () => opened.push('prompt') });
  document.body.append(chatSetup.root); void chatSetup.refresh(); return chatSetup;
}
function startHome() {
  homeBanner = createHomeBanner(ctx, { openApi: () => opened.push('api'), openImport: () => opened.push('import'), openPersona: () => opened.push('persona'), openPrompt: () => opened.push('prompt'), chooseCharacter: () => opened.push('choose'), openHelp: () => opened.push('help') });
  document.body.append(homeBanner.root); homeBanner.activate(); return homeBanner;
}
beforeEach(() => {
  oldDocument = globalThis.document; oldFetch = globalThis.fetch;
  dom = new JSDOM('<!doctype html><html><body><main id="native">Native messages and draft</main></body></html>', { url: 'http://localhost:7860/' }); globalThis.document = dom.window.document;
  profiles = [{ id: 'conn-1', name: 'My API', provider: 'openrouter', model: 'model-a', preset_id: null, is_default: true }];
  cards = [{ id: 'card-1', name: 'Ada' }]; personas = []; metadata = {}; presets = { 'preset-1': { id: 'preset-1', name: 'Evening roleplay' } }; resolved = { preset_id: 'preset-1', source: 'chat' };
  selectors = { 'connections.active': { activeProfileId: 'conn-1' }, 'loom.activePresetId': null, 'persona.activeId': null };
  subscriptions = new Map(); events = new Map(); reads = []; changes = []; opened = []; dismissed = 0; activeChat = null; savedPreference = undefined;
  const subscribe = (map: Map<string, Set<() => void>>, key: string, handler: () => void) => { const listeners = map.get(key) || new Set(); map.set(key, listeners); listeners.add(handler); return () => listeners.delete(handler); };
  ctx = { state: { get: (key: string) => selectors[key], subscribe: (key: string, handler: () => void) => subscribe(subscriptions, key, handler) }, events: { on: (key: string, handler: () => void) => subscribe(events, key, handler) }, getActiveChat: () => ({ chatId: activeChat }),
    settings: { get: async () => savedPreference, set: async (key: string, value: unknown) => { changes.push({ key, value }); savedPreference = value; } },
    permissions: { request() { throw new Error('No automatic grants'); } },
  };
  respond = async url => {
    const path = url.pathname;
    if (path === '/api/v1/connections') { const offset = Number(url.searchParams.get('offset') || 0); return json({ data: profiles.slice(offset, offset + 200), total: profiles.length }); }
    if (path === '/api/v1/characters/summary') return json({ data: cards.slice(0, 1), total: cards.length });
    if (path === '/api/v1/personas') return json({ data: personas.slice(0, 1), total: personas.length });
    if (path.startsWith('/api/v1/personas/')) { const id = decodeURIComponent(path.split('/').at(-1)!); const persona = personas.find(row => row.id === id); return json(persona || {}, persona ? 200 : 404); }
    if (path.startsWith('/api/v1/chats/')) return json({ id: decodeURIComponent(path.split('/').at(-1)!), metadata });
    if (path.startsWith('/api/v1/preset-profiles/resolve/')) return json(resolved);
    if (path.startsWith('/api/v1/preset-profiles/')) return json({}, 404);
    if (path.startsWith('/api/v1/presets/')) { const preset = presets[decodeURIComponent(path.split('/').at(-1)!)]; return json(preset || {}, preset ? 200 : 404); }
    throw new Error(`Unexpected read ${url}`);
  };
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => { const url = new URL(String(input), dom.window.location.href); reads.push({ url, init }); expect(init.credentials).toBe('same-origin'); expect(init.method || 'GET').toBe('GET'); expect(init.body).toBeUndefined(); return respond(url, init); }) as any;
});
afterEach(() => { homeBanner?.destroy(); checklist?.destroy(); chatSetup?.destroy(); homeBanner = undefined; checklist = undefined; chatSetup = undefined; dom.window.close(); globalThis.document = oldDocument; globalThis.fetch = oldFetch; });

test('hiding the Home checklist hides the whole banner and remembers it, while Help stays one click away', async () => {
  const view = startHome(); await settle(); button('Guides & help', view.root).click(); expect(opened).toEqual(['help']);
  button('Hide checklist', view.root).click(); await settle();
  expect(view.root.hidden).toBe(true); expect(changes.at(-1)).toEqual({ key: SETUP_DISMISSED_KEY, value: true });
});

test('a remembered hidden checklist keeps the banner hidden until setup is reviewed', async () => {
  savedPreference = true; const view = startHome(); await settle();
  expect(view.root.hidden).toBe(true); expect(changes).toEqual([]);
  view.deactivate(); view.activate(); await settle(); expect(view.root.hidden).toBe(true);
  view.reviewSetup(); await settle(); expect(view.root.hidden).toBe(false); expect(view.root.querySelector('h2')!.textContent).toBe('Let’s do the basics.');
  expect(view.root.querySelector('.jb-setup-checklist')!.hasAttribute('hidden')).toBe(false); expect(changes.at(-1)).toEqual({ key: SETUP_DISMISSED_KEY, value: false });
});

test('checklist stays inert until Home activates it, and completion reads never change settings or open controls', async () => {
  const view = startChecklist(); await settle(); expect(reads).toHaveLength(0);
  view.activate(); await settle();
  expect(view.root.textContent).toContain('The essentials are ready'); expect(view.root.querySelector('[data-step=persona]')?.getAttribute('data-state')).toBe('missing');
  expect(button('Choose a character →').disabled).toBe(false); expect(opened).toEqual([]); expect(changes).toEqual([]);
  expect(document.querySelector('#native')!.textContent).toBe('Native messages and draft');
  button('Choose a character →').click(); expect(opened).toEqual(['choose']);
});
test('the next unfinished essential is actionable, while persona and prompt stay optional', async () => {
  profiles = []; cards = []; const view = startChecklist(); view.activate(); await settle();
  expect(view.root.textContent).toContain('0 of 2 essentials ready'); button('Set up AI connection').click(); expect(opened).toEqual(['api']);
  profiles = [{ id: 'new', provider: 'custom', model: 'local' }]; await view.refresh();
  expect(view.root.textContent).toContain('1 of 2 essentials ready'); button('Add a character card').click(); expect(opened).toEqual(['api', 'import']);
  cards = [{ id: 'my-card' }]; await view.refresh(); button('Choose a character →').click();
  expect(opened).toEqual(['api', 'import', 'choose']); expect(changes).toEqual([]);
});
test('a saved connection without a model is incomplete, and credential testing never runs automatically', async () => {
  profiles[0].model = ''; const view = startChecklist(); view.activate(); await settle();
  expect(view.root.querySelector('[data-step=connection]')?.getAttribute('data-state')).toBe('missing'); expect(view.root.textContent).toContain('Choose a model');
  expect(reads.some(read => /test|generate|api-key/.test(read.url.pathname))).toBe(false);
});
test('partial failures remain unknown and optional failures do not block the essentials', async () => {
  const native = respond; respond = async (url, init) => url.pathname === '/api/v1/personas' || url.pathname.startsWith('/api/v1/preset-profiles/') ? json({}, 503) : native(url, init);
  const view = startChecklist(); view.activate(); await settle();
  expect(view.root.querySelector('[data-step=persona]')?.getAttribute('data-state')).toBe('unknown'); expect(view.root.querySelector('[data-step=prompt]')?.getAttribute('data-state')).toBe('unknown');
  expect(button('Choose a character →').disabled).toBe(false);
  respond = async (url, init) => url.pathname === '/api/v1/characters/summary' ? json({}, 503) : native(url, init); await view.refresh();
  expect(view.root.querySelector('[data-step=card]')?.getAttribute('data-state')).toBe('unknown'); expect(view.root.textContent).not.toContain('The essentials are ready');
});
test('all four step shortcuts require a click and use their own setup destination', async () => {
  const view = startChecklist(); view.activate(); await settle();
  for (const node of view.root.querySelectorAll<HTMLButtonElement>('.jb-setup-step')) node.click();
  expect(opened).toEqual(['api', 'import', 'persona', 'prompt']); expect(changes).toEqual([]);
  view.deactivate(); view.root.querySelector<HTMLButtonElement>('.jb-setup-step')!.click(); expect(opened).toHaveLength(4);
});
test('hide is explicit, remembered, and review overrides a late dismissed preference', async () => {
  const preference = pending<unknown>(); ctx.settings.get = () => preference.promise;
  const view = startChecklist(); view.activate(); await settle(); view.review(); preference.resolve(true); await settle();
  expect(dismissed).toBe(0); expect(changes).toEqual([{ key: SETUP_DISMISSED_KEY, value: false }]);
  button('Hide checklist').click(); await settle(); expect(dismissed).toBe(1); expect(changes.at(-1)).toEqual({ key: SETUP_DISMISSED_KEY, value: true });
});
test('previously hidden setup can stay dismissed without making a preference write', async () => {
  savedPreference = true; startChecklist().activate(); await settle(); expect(dismissed).toBe(1); expect(changes).toEqual([]);
});

test('a hidden preference arriving after leaving Home is respected on the next activation', async () => {
  const preference = pending<unknown>(); ctx.settings.get = () => preference.promise;
  const view = startChecklist(); view.activate(); view.deactivate(); preference.resolve(true); await settle();
  expect(dismissed).toBe(0); view.activate(); expect(dismissed).toBe(1); expect(changes).toEqual([]);
});
test('leaving Home cancels pending reads, ignores late results and releases subscriptions on disable', async () => {
  const slow = pending<any>(); const native = respond; respond = (url, init) => url.pathname === '/api/v1/characters/summary' ? slow.promise : native(url, init);
  const view = startChecklist(); view.activate(); await flush(); view.deactivate(); const previous = view.root.textContent;
  slow.resolve(json({ data: [{ id: 'late' }], total: 1 })); await settle(); expect(view.root.textContent).toBe(previous); expect(reads[0].init.signal?.aborted).toBe(true);
  const count = reads.length; subscriptions.get('connections.active')?.forEach(handler => handler()); await new Promise(resolve => setTimeout(resolve, 270)); expect(reads).toHaveLength(count);
  view.destroy(); expect([...subscriptions.values(), ...events.values()].every(listeners => listeners.size === 0)).toBe(true);
});
test('native changes refresh progress, with no polling or reads while the checklist is inactive', async () => {
  profiles = []; const view = startChecklist(); view.activate(); await settle(); profiles = [{ id: 'new', provider: 'custom', model: 'local' }];
  events.get('CONNECTION_PROFILE_LOADED')!.forEach(handler => handler()); await new Promise(resolve => setTimeout(resolve, 270)); await settle();
  expect(view.root.querySelector('[data-step=connection]')?.getAttribute('data-state')).toBe('done');
  view.deactivate(); const count = reads.length; events.get('PERSONA_CHANGED')!.forEach(handler => handler()); await new Promise(resolve => setTimeout(resolve, 270)); expect(reads).toHaveLength(count);
});
test('the connection selection matches native chat pins and drops overrides from deleted pins', async () => {
  profiles.push({ id: 'pin', provider: 'nanogpt', model: 'original' }); const signal = new AbortController().signal;
  expect(await readConnection(ctx, signal, { connection_profile_id: 'pin', connection_model: 'chat-model' })).toMatchObject({ id: 'pin', model: 'chat-model', source: 'chat' });
  expect(await readConnection(ctx, signal, { connection_profile_id: 'deleted', connection_model: 'wrong' })).toMatchObject({ id: 'conn-1', model: 'model-a', source: 'active' });
  expect(await readConnection(ctx, signal, { connection_model: 'also-wrong' })).toMatchObject({ model: 'model-a' });
});
test('connection fallback uses default then owned profile, and a pin outside the first page is found', async () => {
  selectors['connections.active'] = { activeProfileId: 'missing' }; profiles.unshift({ id: 'first', provider: 'custom', model: 'local' });
  expect(await readConnection(ctx, new AbortController().signal)).toMatchObject({ id: 'conn-1', source: 'default' }); profiles[1].is_default = false;
  expect(await readConnection(ctx, new AbortController().signal)).toMatchObject({ id: 'first', source: 'default' });
  profiles = Array.from({ length: 201 }, (_, index) => ({ id: `conn-${index}`, provider: 'custom', model: `model-${index}` }));
  expect(await readConnection(ctx, new AbortController().signal, { connection_profile_id: 'conn-200' })).toMatchObject({ id: 'conn-200', source: 'chat' });
  expect(reads.at(-1)!.url.searchParams.get('offset')).toBe('200');
});

test('model roulette shows a per-reply selection and requires a configured member', async () => {
  profiles.unshift({ id: 'roulette', provider: 'model_roulette', metadata: { connection_roulette: { connection_ids: ['conn-1'] } } });
  selectors['connections.active'] = { activeProfileId: 'roulette' };
  const view = startChat(); await settle(); expect(view.root.textContent).toContain('Selected per reply'); expect(view.root.textContent).toContain('Resolved per reply');
  expect(reads.some(read => read.url.pathname.includes('/resolve/'))).toBe(false);
  profiles[1].model = ''; await view.refresh(); expect(view.root.textContent).toContain('Choose a model');
});
test('chat setup shows the selected persona, pinned model and resolved prompt without opening or changing anything', async () => {
  personas = [{ id: 'persona-1', name: 'Alex' }]; selectors['persona.activeId'] = 'persona-1'; metadata = { active_persona_id: 'persona-1', connection_profile_id: 'conn-1', connection_model: 'chat-model' };
  const view = startChat(); await settle();
  expect(view.root.hidden).toBe(false); expect(view.root.textContent).toContain('Alex'); expect(view.root.textContent).toContain('chat-model'); expect(view.root.textContent).toContain('Evening roleplay'); expect(view.root.textContent).toContain('This chat');
  const resolution = reads.find(read => read.url.pathname.includes('/resolve/'))!.url;
  expect(resolution.searchParams.get('persona_id')).toBe('persona-1'); expect(resolution.searchParams.get('connection_id')).toBe('conn-1');
  expect(reads.some(read => read.url.pathname === '/api/v1/chats/chat-1' && read.url.searchParams.get('messages') !== 'false')).toBe(false); expect(changes).toEqual([]); expect(opened).toEqual([]);
  for (const chip of view.root.querySelectorAll<HTMLButtonElement>('.jb-chat-setup-chip')) chip.click(); expect(opened).toEqual(['persona', 'api', 'prompt']);
});
test.each([['chat', 'This chat'], ['persona', 'This persona'], ['character', 'This character'], ['connection', 'This connection'], ['defaults', 'Preset defaults'], ['none', 'Selected preset']])('prompt source %s uses the native resolution label', async (source, label) => {
  resolved.source = source; const view = startChat(); await settle(); expect(view.root.querySelectorAll('.jb-chat-setup-source')[2].textContent).toBe(label);
});
test('a missing persona is explicit, failed setup reads offer recovery and never substitute a display name', async () => {
  const view = startChat(); await settle(); expect(view.root.textContent).toContain('No persona');
  const native = respond; selectors['persona.activeId'] = 'removed'; respond = async (url, init) => url.pathname === '/api/v1/connections' ? json({}, 503) : native(url, init);
  await view.refresh(); expect(view.root.textContent).toContain('Unavailable'); expect(view.root.textContent).toContain('couldn’t be checked'); expect(button('Refresh setup', view.root).hidden).toBe(false); expect(changes).toEqual([]);
});
test('raw temporary chats never resolve persona presets or pretend to have a persona', async () => {
  metadata = { temporary: true, no_preset: true, active_persona_id: 'ignored' }; selectors['persona.activeId'] = 'ignored';
  const view = startChat(); await settle(); expect(view.root.textContent).toContain('No preset · Raw chat'); expect(view.root.textContent).toContain('No persona');
  expect(view.root.querySelector<HTMLButtonElement>('.jb-chat-setup-chip')!.disabled).toBe(true); expect(reads.some(read => /personas|preset-profiles|\/presets/.test(read.url.pathname))).toBe(false);
});
test('an earlier chat response cannot replace the next chat, and leaving the route hides and disables old actions', async () => {
  const slow = pending<any>(); const native = respond; respond = (url, init) => url.pathname === '/api/v1/chats/chat-1' ? slow.promise : native(url, init);
  const view = startChat(); await flush(); activeChat = 'chat-2'; dom.window.history.replaceState({}, '', '/chat/chat-2'); view.sync(); await settle();
  slow.resolve(json({ id: 'chat-1', metadata: { connection_profile_id: 'stale' } })); await settle(); expect(view.root.textContent).toContain('model-a'); expect(view.root.textContent).not.toContain('stale');
  const oldAction = view.root.querySelector<HTMLButtonElement>('button')!; dom.window.history.replaceState({}, '', '/'); activeChat = null; view.sync(); oldAction.click(); expect(view.root.hidden).toBe(true); expect(opened).toEqual([]);
});
test('a mismatched chat ID is rejected before reading any persona, connection or prompt', async () => {
  respond = async () => json({ id: 'different', metadata: {} }); const view = startChat(); await settle();
  expect(view.root.textContent).toContain('Couldn’t read this chat'); expect(reads).toHaveLength(1); expect(changes).toEqual([]);
});
