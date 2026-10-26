import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createComposerActions } from '../src/composer-actions';
import { setupComposerBackend } from '../src/backend';

const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
let cleanup: Array<() => void> = [];
afterEach(() => { cleanup.reverse().forEach(fn => fn()); cleanup = []; });
function backend() {
  let receive: (payload: unknown, userId: string, session?: string) => void = () => {};
  const replies: any[] = []; const calls: any[] = [];
  let granted = ['chats', 'generation'];
  let quiet = async (input: any) => { calls.push(['quiet', input]); return { content: 'Suggested text' }; };
  let assemble = async (input: any, user: string) => { calls.push(['assemble', input, user]); return { messages: [{ role: 'system', content: 'Native card, persona, memory' }, { role: 'user', content: 'History' }], model: 'chat-model', parameters: { temperature: 0.7 } }; };
  let profiles = [{ id: 'default', is_default: true }, { id: 'pinned' }];
  let getConnection = async (id: string, _user: string) => profiles.find(p => p.id === id) ?? null;
  const stop = setupComposerBackend({
    onFrontendMessage(fn: typeof receive) { receive = fn; return () => {}; },
    sendToFrontend(...args: any[]) { replies.push(args); },
    permissions: { async getGranted() { return granted; } },
    chats: { async get(id: string, user: string) { calls.push(['chat', id, user]); return { id, metadata: { connection_profile_id: 'pinned', connection_model: 'chat-model' } }; } },
    connections: { async list(user: string) { calls.push(['profiles', user]); return profiles; }, async get(id: string, user: string) { calls.push(['profile', id, user]); return getConnection(id, user); } },
    generate: {
      async dryRun(input: any, user: string) { return assemble(input, user); },
      async quiet(input: any) { return quiet(input); },
    },
  } as any);
  cleanup.push(stop);
  const request = (overrides = {}, user = 'user-1', session: string | undefined = 'session-1') => receive({ type: 'janitor_bridge:composer', command: 'generate', id: 'request-1', chatId: 'chat-1', action: 'enhance', draft: 'My draft', connectionId: 'default', presetId: 'selected', personaId: 'persona', ...overrides }, user, session);
  return { request, replies, calls, setGranted(v: string[]) { granted = v; }, setQuiet(fn: typeof quiet) { quiet = fn; }, setAssemble(fn: typeof assemble) { assemble = fn; }, setProfiles(v: typeof profiles) { profiles = v; }, setGetConnection(fn: typeof getConnection) { getConnection = fn; } };
}
describe('composer backend native context and account routing', () => {
  test('uses chat pin, assembled native context/model, and replies only to sender document', async () => {
    const h = backend(); h.request(); await settle();
    expect(h.calls.find(c => c[0] === 'assemble')).toEqual(['assemble', { chatId: 'chat-1', connectionId: 'pinned', personaId: 'persona', presetId: 'selected', generationType: 'normal' }, 'user-1']);
    const input = h.calls.find(c => c[0] === 'quiet')[1];
    expect(input.connection_id).toBe('pinned'); expect(input.userId).toBe('user-1');
    expect(input.parameters).toEqual({ temperature: 0.7, model: 'chat-model' });
    expect(input.messages[0].content).toBe('Native card, persona, memory');
    expect(input.messages.at(-1).content).toContain('My draft');
    expect(h.replies).toEqual([[{ type: 'janitor_bridge:composer', id: 'request-1', chatId: 'chat-1', content: 'Suggested text' }, 'user-1', { frontendSessionId: 'session-1' }]]);
  });
  test('fails closed without trusted session and without generation permission', async () => {
    const h = backend(); h.request({}, 'user-1', ''); await settle(); expect(h.calls).toHaveLength(0);
    h.setGranted(['chats']); h.request(); await settle(); expect(h.calls).toHaveLength(0); expect(h.replies[0][0].error).toBe('permission');
  });
  test('cancel from another document cannot abort, owner cancel aborts and suppresses stale reply', async () => {
    const h = backend(); const pending = deferred<any>(); let signal: AbortSignal | undefined;
    h.setQuiet(async input => { signal = input.signal; return pending.promise; });
    h.request(); await settle(); expect(signal?.aborted).toBe(false);
    h.request({ command: 'cancel' }, 'user-1', 'other-session'); expect(signal?.aborted).toBe(false);
    h.request({ command: 'cancel' }); expect(signal?.aborted).toBe(true);
    pending.resolve({ content: 'Late' }); await settle(); expect(h.replies).toHaveLength(0);
  });
  test('Chats permission revoked while assembling prevents sending chat context to the provider', async () => {
    const h = backend(); const assembly = deferred<any>(); h.setAssemble(async () => assembly.promise);
    h.request(); await settle(); h.setGranted(['generation']);
    assembly.resolve({ messages: [{ role: 'user', content: 'Private conversation' }], model: 'chat-model', parameters: {} }); await settle();
    expect(h.calls.some(c => c[0] === 'quiet')).toBe(false); expect(h.replies[0][0].error).toBe('permission');
  });
  test('cancellation during assembly prevents any provider call after assembly finishes', async () => {
    const h = backend(); const assembly = deferred<any>(); h.setAssemble(async () => assembly.promise);
    h.request(); await settle(); h.request({ command: 'cancel' });
    assembly.resolve({ messages: [], model: 'chat-model', parameters: {} }); await settle();
    expect(h.calls.some(c => c[0] === 'quiet')).toBe(false); expect(h.replies).toHaveLength(0);
  });
  test('requests from separate users and documents retain separate cancellation authority', async () => {
    const h = backend(); const pending = deferred<any>(); const dispatched: any[] = [];
    h.setQuiet(async input => { dispatched.push(input); return pending.promise; });
    h.request({}, 'alice', 'document-a'); h.request({}, 'bob', 'document-b'); await settle();
    expect(dispatched.map(input => input.userId).sort()).toEqual(['alice', 'bob']);
    h.request({ command: 'cancel' }, 'alice', 'document-a');
    expect(dispatched.find(input => input.userId === 'alice').signal.aborted).toBe(true); expect(dispatched.find(input => input.userId === 'bob').signal.aborted).toBe(false);
    pending.resolve({ content: 'Only Bob receives this' }); await settle();
    expect(h.replies).toHaveLength(1); expect(h.replies[0][1]).toBe('bob'); expect(h.replies[0][2]).toEqual({ frontendSessionId: 'document-b' });
  });
  test('a valid chat connection outside the first list page still supplies context and generation', async () => {
    const h = backend(); h.setProfiles([{ id: 'default', is_default: true }]); h.setGetConnection(async id => id === 'pinned' ? { id: 'pinned' } : { id: 'default', is_default: true });
    h.request(); await settle();
    expect(h.calls.find(c => c[0] === 'assemble')[1].connectionId).toBe('pinned'); expect(h.calls.find(c => c[0] === 'quiet')[1].connection_id).toBe('pinned');
  });
  test('a deleted selected API fails instead of sending private chat context to a different default API', async () => {
    const h = backend(); h.setGetConnection(async () => null);
    h.request({ connectionId: 'deleted-active' }); await settle();
    expect(h.calls.some(c => c[0] === 'assemble' || c[0] === 'quiet' || c[0] === 'profiles')).toBe(false);
    expect(h.replies[0][0].error).toBe('connection-unavailable');
  });
});

function frontend() {
  const originalDocument = globalThis.document;
  const window = new JSDOM('<!doctype html><body></body>').window;
  globalThis.document = window.document;
  let state = { mounted: true, chatId: 'chat-1', text: 'Original draft' };
  let granted = ['chats', 'generation']; let listener: (value: unknown) => void = () => {}; let changed: (state: any) => void = () => {};
  const sent: any[] = []; const roots: HTMLElement[] = []; const memory: any[] = [];
  const actions = createComposerActions({
    getActiveChat() { return { chatId: state.chatId }; }, frontendSessionId: 'session-1',
    composer: { getState() { return state; }, onChange(fn: typeof changed) { changed = fn; return () => {}; }, setText(value: string) { state = { ...state, text: value }; }, focus() {} },
    permissions: { async getGranted() { return granted; }, async request() { granted = ['chats', 'generation']; return granted; } },
    state: { get(key: string) { return key === 'connections.active' ? { activeProfileId: 'default' } : key === 'persona.activeId' ? 'persona' : 'preset'; } },
    sendToBackend(payload: unknown) { sent.push(payload); }, onBackendMessage(fn: typeof listener) { listener = fn; return () => {}; },
    ui: { showModal() { const root = document.createElement('div'); document.body.append(root); roots.push(root); let dismissed = false; const callbacks: Array<() => void> = []; return { root, modalId: '1', setTitle() {}, dismiss() { if (dismissed) return; dismissed = true; root.remove(); callbacks.forEach(fn => fn()); }, onDismiss(fn: () => void) { callbacks.push(fn); return () => {}; } }; } },
  } as any, { openMemoryDraft(...args) { memory.push(args); } });
  cleanup.push(() => { actions.destroy(); window.close(); globalThis.document = originalDocument; });
  return { actions, roots, sent, memory, get state() { return state; }, edit(value: string) { state = { ...state, text: value }; }, switchChat() { state = { ...state, chatId: 'chat-2' }; changed(state); }, setGranted(v: string[]) { granted = v; }, reply(content = 'Suggestion') { listener({ type: 'janitor_bridge:composer', id: sent.at(-1).id, chatId: 'chat-1', content }); } };
}
describe('composer frontend review semantics', () => {
  test('writing assistance renders and dispatches on LAN HTTP without secure-context UUID APIs', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: crypto.getRandomValues.bind(crypto) } });
    try {
      const h = frontend(); h.actions.writeForMe(); await settle();
      expect(h.roots[0].querySelector('textarea')).not.toBeNull();
      expect(h.sent).toHaveLength(1); expect(h.state.text).toBe('Original draft');
    } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
  });

  test('preserves original draft and requires explicit replacement after concurrent editing', async () => {
    const h = frontend(); h.actions.enhanceDraft(); await settle(); expect(h.state.text).toBe('Original draft'); expect(h.sent).toHaveLength(1);
    h.edit('New edited draft'); h.reply(); const root = h.roots[0]; root.querySelector<HTMLButtonElement>('.jb-primary')!.click();
    expect(h.state.text).toBe('New edited draft'); expect(root.querySelector<HTMLLabelElement>('.jb-settings-checkbox')!.hidden).toBe(false);
    root.querySelector<HTMLInputElement>('[name=replace-changed-draft]')!.checked = true; root.querySelector<HTMLButtonElement>('.jb-primary')!.click();
    expect(h.state.text).toBe('Suggestion'); expect(root.isConnected).toBe(false);
  });
  test('summary remains reviewable and only opens Chat Memory on explicit apply', async () => {
    const h = frontend(); h.actions.summarizeChat(); await settle(); h.reply('Memory draft'); expect(h.memory).toHaveLength(0); expect(h.state.text).toBe('Original draft');
    h.roots[0].querySelector<HTMLButtonElement>('.jb-primary')!.click(); expect(h.memory).toEqual([['chat-1', 'Memory draft']]); expect(h.state.text).toBe('Original draft');
  });
  test('chat switch cancels generation and ignores the late result', async () => {
    const h = frontend(); h.actions.writeForMe(); await settle(); h.switchChat(); expect(h.sent.at(-1).command).toBe('cancel'); h.reply('Late'); expect(h.state.text).toBe('Original draft'); expect(h.roots[0].isConnected).toBe(false);
  });
  test('missing permission opens approval affordance without dispatching or modifying draft', async () => {
    const h = frontend(); h.setGranted(['chats']); h.actions.enhanceDraft(); await settle(); expect(h.sent).toHaveLength(0); expect(h.state.text).toBe('Original draft');
    const allow = Array.from(h.roots[0].querySelectorAll('button')).find(b => b.textContent === 'Allow writing assistance')!; expect(allow.hidden).toBe(false); allow.click(); await settle(); expect(h.sent).toHaveLength(0);
  });
  test('duplicate or queued results after completion cannot overwrite the reviewed suggestion', async () => {
    const h = frontend(); h.actions.enhanceDraft(); await settle(); h.reply('First suggestion');
    const textarea = h.roots[0].querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'My edits to the suggestion'; textarea.dispatchEvent(new textarea.ownerDocument.defaultView!.Event('input', { bubbles: true }));
    h.reply('Late duplicate'); expect(textarea.value).toBe('My edits to the suggestion'); expect(h.state.text).toBe('Original draft');
  });
});
