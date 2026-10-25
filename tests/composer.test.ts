import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createComposer, type ComposerActions } from '../src/composer';

const originalFetch = globalThis.fetch;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
let dom: JSDOM;
let composer: ReturnType<typeof createComposer> | undefined;
let chatId: string, activePersonaId: string, text: string, stream: boolean;
let mounted: boolean, composerChatId: string;
let granted: string[];
let grant: () => Promise<string[]>;
let requested: string[][];
let invoked: Array<{ ref: unknown; params: unknown }>;
let fetches: Array<{ url: string; signal?: AbortSignal | null }>;
let callbacks: Set<() => void>;
let subscriptions: Map<string, Set<() => void>>;
let nativeBefore: string;
let unavailableSelectors: Set<string>;
const people = [
  { id: 'one', name: 'Avery', title: 'Explorer', image_id: 'avatar-one' },
  { id: 'two', name: 'Alex', title: 'Historian', image_id: null },
];
const selector = <T extends Element = HTMLElement>(query: string) => document.querySelector<T>(query)!;
const assistButton = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.jb-assist-action')).find(button => button.textContent === name)!;
const personaOption = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.jb-composer-persona-option')).find(button => button.textContent?.includes(name))!;
function emit(key?: string) { if (key) subscriptions.get(key)?.forEach(fn => fn()); else callbacks.forEach(fn => fn()); }
function setup(actions: ComposerActions = {}) {
  composer = createComposer({
    getActiveChat: () => ({ chatId, characterId: 'character' }),
    composer: { getState: () => ({ mounted, chatId: composerChatId, text }), onChange(fn: () => void) { callbacks.add(fn); return () => callbacks.delete(fn); } },
    ui: { mount(point: string) { const root = document.createElement('div'); root.dataset.mount = point; document.body.append(root); return root; } },
    state: {
      get(key: string) { return key === 'persona.activeId' ? activePersonaId : key === 'setting:isStreaming' ? stream : null; },
      subscribe(key: string, fn: () => void) { if (unavailableSelectors.has(key)) throw new Error(`SELECTOR_UNKNOWN:${key}`); const rows = subscriptions.get(key) ?? new Set(); rows.add(fn); subscriptions.set(key, rows); return () => rows.delete(fn); },
    },
    permissions: { getGranted: () => grant(), request: async (permissions: string[]) => { requested.push(permissions); granted = [...new Set([...granted, ...permissions])]; } },
    host: { surfaces: {
      list(kinds: string[]) { return kinds.includes('entity_action') ? [{ kind: 'entity_action', id: 'switch_persona', invocable: granted.includes('personas') }] : [{ kind: 'drawer_tab', id: 'personas', invocable: true }]; },
      async invoke(ref: { id: string }, params: { personaId?: string }) { invoked.push({ ref, params }); if (ref.id === 'switch_persona') { activePersonaId = params.personaId!; emit('persona.activeId'); } },
    } },
  } as any, actions);
  return composer;
}
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html data-jb-composer="previous"><body><div id="native"><textarea name="chat-message">Untouched IME draft</textarea><button>Native Send</button></div></body></html>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document;
  nativeBefore = selector('#native').outerHTML;
  chatId = composerChatId = 'chat-1'; activePersonaId = 'one'; text = ''; mounted = true; stream = false;
  granted = ['generation', 'chats']; grant = async () => [...granted]; requested = []; invoked = []; fetches = [];
  callbacks = new Set(); subscriptions = new Map();
  unavailableSelectors = new Set();
  globalThis.fetch = (async (url, options) => {
    fetches.push({ url: String(url), signal: options?.signal });
    const found = String(url).match(/\/personas\/([^?]+)$/);
    return found ? json(people.find(person => person.id === decodeURIComponent(found[1]))) : json({ data: people, total: people.length });
  }) as typeof fetch;
});
afterEach(() => { composer?.destroy(); composer = undefined; globalThis.fetch = originalFetch; dom.window.close(); });

describe('familiar composer controls preserve native draft and Send', () => {
  test('matches the three writing actions and disables unavailable callbacks', async () => {
    setup(); await settle(); selector<HTMLButtonElement>('.jb-assist-toggle').click();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.jb-assist-action'));
    expect(buttons.map(button => button.textContent)).toEqual(['Enhance my draft', 'Write something for me', 'Summarize this chat']);
    expect(buttons.every(button => button.disabled)).toBe(true);
    expect(selector('#native').outerHTML).toBe(nativeBefore);
    expect(fetches.every(call => call.url.startsWith('/api/v1/personas/'))).toBe(true);
  });

  test('Enhance follows native draft state and callbacks never send or replace the textarea', async () => {
    let enhanced = 0; setup({ onEnhanceDraft: () => { enhanced++; }, onWriteForMe: () => {} }); await settle();
    expect(assistButton('Enhance my draft').disabled).toBe(true);
    text = 'Please improve this'; emit();
    expect(assistButton('Enhance my draft').disabled).toBe(false);
    selector<HTMLButtonElement>('.jb-assist-toggle').click(); assistButton('Enhance my draft').click(); await settle();
    expect(enhanced).toBe(1); expect(text).toBe('Please improve this');
    expect(selector('#native').outerHTML).toBe(nativeBefore);
    expect(invoked).toHaveLength(0); expect(selector<HTMLElement>('.jb-composer-popover').hidden).toBe(true);
  });

  test('mismatched current chat or streaming state cannot run writing callbacks', async () => {
    let writes = 0; setup({ onWriteForMe: () => { writes++; } }); await settle();
    composerChatId = 'old-chat'; emit(); expect(assistButton('Write something for me').disabled).toBe(true);
    assistButton('Write something for me').click(); expect(writes).toBe(0);
    composerChatId = chatId; stream = true; emit('setting:isStreaming');
    expect(assistButton('Write something for me').disabled).toBe(true);
    stream = false; emit('setting:isStreaming');
    expect(assistButton('Write something for me').disabled).toBe(false);
  });

  test('Escape and outside clicks close the menu and restore its accessible toggle', async () => {
    setup({ onWriteForMe() {} }); await settle();
    const button = selector<HTMLButtonElement>('.jb-assist-toggle'); button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(button);
    button.click(); selector('#native').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    expect(selector<HTMLElement>('.jb-composer-popover').hidden).toBe(true);
  });

  test('persona chip uses the native image and picker searches persona names and titles', async () => {
    setup(); await settle();
    expect(selector('.jb-composer-persona-name').textContent).toBe('Avery');
    expect(selector<HTMLImageElement>('.jb-composer-avatar img').getAttribute('src')).toBe('/api/v1/images/avatar-one?size=sm');
    selector<HTMLButtonElement>('.jb-composer-persona').click(); await settle();
    const search = selector<HTMLInputElement>('.jb-composer-persona-search'); search.value = 'historian'; search.dispatchEvent(new dom.window.Event('input'));
    expect(document.querySelectorAll('.jb-composer-persona-option')).toHaveLength(1);
    expect(personaOption('Alex').getAttribute('aria-checked')).toBe('false');
  });

  test('touch users can browse personas without automatically opening the search keyboard', async () => {
    Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: query === '(pointer: coarse)' }) });
    setup(); await settle();
    const picker = selector<HTMLButtonElement>('.jb-composer-persona');
    picker.focus(); picker.click(); await settle();
    const search = selector<HTMLInputElement>('.jb-composer-persona-search');
    expect(selector<HTMLElement>('.jb-composer-persona-menu').hidden).toBe(false);
    expect(document.activeElement).toBe(picker);
    expect(document.querySelectorAll('.jb-composer-persona-option')).toHaveLength(2);
    search.focus(); search.value = 'historian'; search.dispatchEvent(new dom.window.Event('input'));
    expect(document.activeElement).toBe(search);
    expect(document.querySelectorAll('.jb-composer-persona-option')).toHaveLength(1);
  });

  test('desktop persona search retains immediate keyboard focus', async () => {
    Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
    setup(); await settle(); selector<HTMLButtonElement>('.jb-composer-persona').click();
    expect(document.activeElement).toBe(selector('.jb-composer-persona-search'));
  });

  test('persona selection requires its exact permission and explicit Allow never silently selects', async () => {
    setup(); await settle(); selector<HTMLButtonElement>('.jb-composer-persona').click(); await settle();
    personaOption('Alex').click(); await settle(); expect(invoked).toHaveLength(0);
    expect(selector('.jb-composer-notice').textContent).toContain('Allow persona switching');
    const allow = Array.from(document.querySelectorAll<HTMLButtonElement>('.jb-composer-persona-footer button')).find(button => button.textContent === 'Allow persona switching')!;
    allow.click(); await settle(); expect(requested).toEqual([['personas']]); expect(invoked).toHaveLength(0);
    personaOption('Alex').click(); await settle();
    expect(invoked).toEqual([{ ref: { kind: 'entity_action', id: 'switch_persona' }, params: { personaId: 'two' } }]);
    expect(selector('.jb-composer-persona-name').textContent).toBe('Alex');
  });

  test('chat navigation during the persona permission check prevents switching the wrong chat', async () => {
    setup(); await settle(); selector<HTMLButtonElement>('.jb-composer-persona').click(); await settle();
    let resolve: (permissions: string[]) => void = () => {};
    grant = () => new Promise(done => { resolve = done; });
    personaOption('Alex').click(); chatId = composerChatId = 'chat-2'; emit('chat.active');
    resolve(['personas']); await settle();
    expect(invoked).toHaveLength(0); expect(selector<HTMLElement>('.jb-composer-popover').hidden).toBe(true);
  });

  test('destroy restores the marker, aborts fetches, removes owned roots and subscriptions', async () => {
    setup(); await settle(); expect(callbacks.size).toBe(1);
    composer!.destroy(); composer = undefined;
    expect(document.documentElement.getAttribute('data-jb-composer')).toBe('previous');
    expect(document.querySelectorAll('[data-mount]')).toHaveLength(0);
    expect(callbacks.size).toBe(0); expect([...subscriptions.values()].every(rows => rows.size === 0)).toBe(true);
    expect(fetches.every(call => call.signal?.aborted)).toBe(true);
    expect(selector('#native').outerHTML).toBe(nativeBefore);
  });

  test('an unavailable optional streaming selector cannot break composer setup', async () => {
    unavailableSelectors.add('setting:isStreaming');
    expect(() => setup({ onWriteForMe() {} })).not.toThrow(); await settle();
    expect(assistButton('Write something for me').disabled).toBe(false);
    expect(callbacks.size).toBe(1); expect(subscriptions.has('chat.active')).toBe(true);
  });
});
