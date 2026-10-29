import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createChatMemory } from '../src/memory';

const originalFetch = globalThis.fetch;
let window: JSDOM['window'];
let memory: ReturnType<typeof createChatMemory>;
let roots: HTMLElement[];
let granted: string[];
let checks: number;
let calls: Array<{ url: string; options?: RequestInit }>;
let respond: (url: string, options?: RequestInit) => Promise<Response>;
let memoryCtx: any;

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const saveButton = (root = roots.at(-1)!) => root.querySelector<HTMLButtonElement>('.jb-primary')!;
const textarea = (root = roots.at(-1)!) => root.querySelector<HTMLTextAreaElement>('textarea')!;

beforeEach(() => {
  window = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:11113' }).window;
  globalThis.document = window.document;
  roots = []; granted = ['chats']; checks = 0; calls = [];
  respond = async (_url, options) => options?.method === 'PATCH' ? json({}) : json({ metadata: {} });
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), options });
    return respond(String(url), options);
  }) as typeof fetch;
  memoryCtx = {
    ui: { showModal: () => {
      const root = document.createElement('div'); document.body.append(root); roots.push(root);
      const callbacks: Array<() => void> = [];
      let dismissed = false;
      return { root, modalId: String(roots.length), setTitle() {},
        dismiss() { if (!dismissed) { dismissed = true; root.remove(); callbacks.forEach(fn => fn()); } },
        onDismiss(fn: () => void) { callbacks.push(fn); return () => {}; },
      };
    } },
    permissions: { async getGranted() { checks++; return [...granted]; } },
  };
  memory = createChatMemory(memoryCtx);
});

afterEach(() => { memory.destroy(); globalThis.fetch = originalFetch; window.close(); });

describe('native chat memory integration', () => {
  test('saves one metadata key atomically and preserves advanced note fields', async () => {
    respond = async (_url, options) => options?.method === 'PATCH' ? json({}) : json({ metadata: {
      authors_note: { content: 'Before', depth: 7, role: 'user', position: 2, custom: 'preserve' }, unrelated: 'keep',
    } });
    memory.open('captured/chat'); await settle();
    expect(textarea().value).toBe('Before');
    expect(roots[0].querySelector<HTMLSelectElement>('select')!.value).toBe('user');
    textarea().value = 'After'; saveButton().click(); await settle();
    expect(checks).toBe(1);
    expect(calls[1].url).toBe('/api/v1/chats/captured%2Fchat/metadata');
    expect(calls[1].options?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1].options?.body))).toEqual({ authors_note: {
      content: 'After', depth: 7, role: 'user', position: 2, custom: 'preserve',
    } });
    expect(roots[0].isConnected).toBe(false);
  });

  test('checks permission on every Save and keeps denied edits available', async () => {
    granted = []; memory.open('chat'); await settle();
    textarea().value = 'User facts'; saveButton().click(); await settle();
    expect(calls).toHaveLength(1);
    expect(textarea().value).toBe('User facts'); expect(saveButton().disabled).toBe(false); expect(roots[0].getAttribute('aria-busy')).toBe('false');
    expect(roots[0].textContent).toContain('Chats permission');
    granted = ['chats']; saveButton().click(); await settle();
    expect(checks).toBe(2); expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].options?.body))).toEqual({ authors_note: { content: 'User facts', depth: 4, role: 'system' } });
  });

  test('clears only the note and retains edits when the server rejects Save', async () => {
    respond = async (_url, options) => options?.method === 'PATCH' ? json({}, 500) : json({ metadata: { authors_note: { content: 'Before', depth: 3, role: 'assistant' } } });
    memory.open('chat'); await settle(); textarea().value = '   '; saveButton().click(); await settle();
    expect(JSON.parse(String(calls[1].options?.body))).toEqual({ authors_note: null });
    expect(roots[0].isConnected).toBe(true); expect(saveButton().disabled).toBe(false);
    expect(roots[0].textContent).toContain('Could not save'); expect(textarea().value).toBe('   ');
  });

  test('Cancel never writes and late loads cannot alter a replacement modal', async () => {
    let resolveFirst: (response: Response) => void = () => {};
    respond = async (url) => url.includes('/first?') ? new Promise(resolve => { resolveFirst = resolve; }) : json({ metadata: { authors_note: { content: 'Second' } } });
    memory.open('first'); const firstSignal = calls[0].options?.signal;
    memory.open('second'); await settle();
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst(json({ metadata: { authors_note: { content: 'Stale first' } } })); await settle();
    expect(textarea().value).toBe('Second');
    Array.from(roots[1].querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === 'Cancel')!.click();
    expect(calls.every(call => call.options?.method !== 'PATCH')).toBe(true);
    expect(roots[1].isConnected).toBe(false);
  });

  test('Cancel is unavailable after Save starts and returns if the write fails', async () => {
    let finish!: (value: Response) => void;
    respond = async (_url, options) => options?.method === 'PATCH' ? new Promise(resolve => { finish = resolve; }) : json({ metadata: {} });
    memory.open('chat'); await settle(); textarea().value = 'Facts'; saveButton().click(); await settle();
    const cancel = [...roots[0].querySelectorAll('button')].find(button => button.textContent === 'Cancel')!;
    expect(cancel.disabled).toBe(true); cancel.click(); expect(roots[0].isConnected).toBe(true);
    finish(json({}, 500)); await settle();
    expect(cancel.disabled).toBe(false); expect(textarea().value).toBe('Facts');
    cancel.click(); expect(roots[0].isConnected).toBe(false);
  });

  test('destroy during permission check prevents a pending write', async () => {
    let resolveGrant: (grant: string[]) => void = () => {};
    memory.destroy();
    memory = createChatMemory({ ui: { showModal: () => {
      const root = document.createElement('div'); document.body.append(root); roots.push(root);
      let dismissed = false; const callbacks: Array<() => void> = [];
      return { root, modalId: 'pending', setTitle() {}, dismiss() { if (!dismissed) { dismissed = true; root.remove(); callbacks.forEach(fn => fn()); } }, onDismiss(fn: () => void) { callbacks.push(fn); return () => {}; } };
    } }, permissions: { getGranted: () => new Promise(resolve => { resolveGrant = resolve; }) } } as any);
    memory.open('chat'); await settle(); textarea().value = 'Facts'; saveButton().click(); expect(roots.at(-1)!.getAttribute('aria-busy')).toBe('true'); memory.destroy();
    resolveGrant(['chats']); await settle();
    expect(calls).toHaveLength(1);
  });

  test('optional memory promotion mounts above the editor and cleans each session without saving its draft', async () => {
    memory.destroy();
    let mounted = 0, destroyed = 0;
    memory = createChatMemory(memoryCtx, { mountPromo: target => {
      mounted++; const card = document.createElement('section'); card.className = 'test-promo'; card.textContent = 'Memory tools'; target.append(card);
      return { destroy() { destroyed++; card.remove(); } };
    } });
    memory.open('first'); await settle(); textarea().value = 'Unsaved review';
    expect(roots[0].firstElementChild?.className).toBe('jb-memory-promo-slot');
    expect(mounted).toBe(1); expect(destroyed).toBe(0);
    memory.open('second'); await settle();
    expect(mounted).toBe(2); expect(destroyed).toBe(1);
    memory.destroy(); memory.destroy();
    expect(destroyed).toBe(2);
    expect(calls.every(call => call.options?.method !== 'PATCH')).toBe(true);
    expect(checks).toBe(0);
  });

  test('a missing optional promotion cannot prevent the native memory editor from working', async () => {
    memory.destroy();
    memory = createChatMemory(memoryCtx, { mountPromo: () => { throw new Error('optional card unavailable'); } });
    memory.open('chat'); await settle();
    expect(document.querySelector('.jb-memory-promo-slot')).toBeNull();
    expect(textarea().disabled).toBe(false); expect(saveButton().disabled).toBe(false);
    textarea().value = 'Important fact'; saveButton().click(); await settle();
    expect(JSON.parse(String(calls[1].options?.body))).toEqual({ authors_note: { content: 'Important fact', depth: 4, role: 'system' } });
  });
});
