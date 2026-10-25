import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createHone, HONE_REPOSITORY, type HoneOptions } from '../src/hone';

let dom: JSDOM;
let hone: ReturnType<typeof createHone> | undefined;
let extensions: unknown[];
let surfaces: Array<{ kind: string; id: string; owner?: string; invocable?: boolean }>;
let calls: Array<{ url: string; options: RequestInit | undefined }>;
let invocations: unknown[];
let invokeError: boolean;
let revealCount: number;
let roots: HTMLElement[];
let signals: AbortSignal[];
let mountPoints: string[];
let mounted: HTMLElement;
let activeChat: string | null;
let composerHandlers: Set<(state: { mounted: boolean; chatId: string | null; text: string }) => void>;
let navigationHandlers: Set<() => void>;
let read: () => Promise<Response>;
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const installed = (id = 'hone-id', enabled = true) => ({ id, identifier: 'hone', enabled, has_frontend: true, status: 'running' });
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!;
const state = () => document.querySelector('.jb-hone-state')?.textContent ?? '';
const hint = () => document.querySelector('.jb-hone-hint-status')?.textContent ?? '';
const escape = () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

function toolbar(title = 'Hone your draft', parent = document.querySelector('[data-component="InputArea"]')!) {
  const node = document.createElement('button'); node.dataset.honeInputBtn = ''; node.title = title; node.setAttribute('aria-disabled', 'false');
  node.getClientRects = () => [{ width: 25, height: 25 }] as any;
  parent.append(node); return node;
}
function setup(options: HoneOptions = { revealTools() { revealCount++; } }) {
  hone = createHone({
    getActiveChat() { return { chatId: activeChat, characterId: activeChat ? 'card' : null }; },
    ui: {
      mount(point: string) { mountPoints.push(point); return mounted; },
      showModal() {
        const root = document.createElement('section'); document.body.append(root); roots.push(root); const callbacks: Array<() => void> = [];
        let closed = false;
        return { root, onDismiss(callback: () => void) { callbacks.push(callback); return () => {}; }, dismiss() { if (closed) return; closed = true; callbacks.forEach(callback => callback()); root.remove(); } };
      },
    },
    host: { surfaces: {
      list(kinds?: string[]) { return surfaces.filter(surface => !kinds || kinds.includes(surface.kind)); },
      async invoke(ref: unknown) { if (invokeError) throw new Error('Unavailable'); invocations.push(ref); },
    } },
    permissions: { request() { throw new Error('Permission request is forbidden'); } },
    composer: {
      onChange(handler: (state: any) => void) { composerHandlers.add(handler); return () => composerHandlers.delete(handler); },
      setText() { throw new Error('Draft writes are forbidden'); }, send() { throw new Error('Sending is forbidden'); },
    },
    state: { subscribe(_key: string, handler: () => void) { navigationHandlers.add(handler); return () => navigationHandlers.delete(handler); } },
    events: { on(_event: string, handler: () => void) { navigationHandlers.add(handler); return () => navigationHandlers.delete(handler); } },
    sendToBackend() { throw new Error('Generation is forbidden'); },
  } as any, options);
  return hone;
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div data-component="InputArea"><textarea>My unchanged draft</textarea><div id="mount"><div id="composer-sibling">Existing writing tools</div></div></div></body></html>', { url: 'http://localhost:11113/chat/current' });
  globalThis.document = dom.window.document;
  mounted = document.querySelector('#mount')!; activeChat = 'current'; composerHandlers = new Set(); navigationHandlers = new Set();
  extensions = []; surfaces = [{ kind: 'drawer_tab', id: 'spindle', invocable: true }]; calls = []; invocations = []; roots = []; signals = []; mountPoints = []; revealCount = 0; invokeError = false;
  read = async () => Response.json({ extensions });
  globalThis.fetch = (async (url, options) => { calls.push({ url: String(url), options }); if (options?.signal) signals.push(options.signal); return read(); }) as typeof fetch;
});
afterEach(() => { hone?.destroy(); hone = undefined; globalThis.fetch = originalFetch; dom.window.close(); globalThis.document = originalDocument; });

describe('Hone toolbar hand-off', () => {
  test('enabled Hone leads straight to its visible manual button, keeping draft, models and composer siblings untouched', async () => {
    extensions = [installed()]; const native = toolbar(); let clicks = 0, scrolled = 0; native.addEventListener('click', () => clicks++); native.scrollIntoView = () => { scrolled++; };
    // A matching button outside the current native InputArea is not the target.
    const foreign = toolbar('Hone your draft', document.body);
    setup(); expect(calls).toHaveLength(0); await hone!.enhanceDraft();
    expect(roots).toHaveLength(0); expect(revealCount).toBe(1); expect(mountPoints).toEqual(['chat_composer_above']);
    expect(native.classList.contains('jb-hone-target')).toBe(true); expect(foreign.classList.contains('jb-hone-target')).toBe(false);
    expect(document.activeElement).toBe(native); expect(scrolled).toBe(1); expect(hint()).toContain('Click the highlighted Hone button'); expect(hint()).toContain('Send separately');
    expect(clicks).toBe(0); expect(invocations).toHaveLength(0); expect(document.querySelector('textarea')?.value).toBe('My unchanged draft');
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe('/api/v1/spindle'); expect(calls[0].options?.credentials).toBe('same-origin'); expect(calls[0].options?.cache).toBe('no-store'); expect(calls[0].options?.method).toBeUndefined(); expect(calls[0].options?.body).toBeUndefined();
    button('Dismiss').click(); expect(native.classList.contains('jb-hone-target')).toBe(false); expect(document.querySelector('.jb-hone-hint')).toBeNull(); expect(document.querySelector('#composer-sibling')?.isConnected).toBe(true); expect(signals[0].aborted).toBe(true);
  });

  test('busy and Undo controls explain their actual actions without focusing, cancelling or restoring anything', async () => {
    extensions = [installed()]; const native = toolbar('Honing... (click to cancel)'); let clicks = 0; native.addEventListener('click', () => clicks++);
    setup(); await hone!.enhanceDraft(); expect(hint()).toContain('clicking its button now cancels'); expect(document.activeElement).not.toBe(native);
    native.title = 'Undo Hone (restore your original draft)'; await settle(); expect(hint()).toContain('restores your original draft'); expect(hint()).toContain('Send separately');
    native.title = 'Hone your draft'; native.setAttribute('aria-disabled', 'true'); await settle(); expect(hint()).toContain('not ready'); expect(hint()).not.toContain('Click the highlighted');
    native.setAttribute('aria-disabled', 'false'); await settle(); expect(hint()).toContain('Click the highlighted'); expect(clicks).toBe(0); expect(invocations).toHaveLength(0);
    escape(); expect(document.querySelector('.jb-hone-hint')).toBeNull(); expect(native.classList.contains('jb-hone-target')).toBe(false);
    native.title = 'Honing... (click to cancel)'; await settle(); expect(document.querySelector('.jb-hone-hint')).toBeNull();
  });

  test('missing, hidden and multiple toolbar buttons offer help without guessing which button to activate', async () => {
    extensions = [installed()]; const hidden = toolbar(); hidden.hidden = true;
    setup(); await hone!.enhanceDraft(); expect(hint()).toContain('not visible'); expect(hidden.classList.contains('jb-hone-target')).toBe(false);
    button('Setup guide').click(); expect(document.querySelector('.jb-hone-progress')?.textContent).toBe('Step 2 of 4'); expect(document.querySelector('.jb-hone-hint')).toBeNull();
    hidden.hidden = false; toolbar(); await hone!.enhanceDraft(); expect(hint()).toContain('Several Hone buttons'); expect(document.querySelectorAll('.jb-hone-target')).toHaveLength(0); expect(invocations).toHaveLength(0);
  });

  test('not-ready or unknown-version controls are never presented as ready to enhance', async () => {
    extensions = [installed()]; const native = toolbar(); native.setAttribute('aria-disabled', 'true'); setup(); await hone!.enhanceDraft(); expect(hint()).toContain('not ready'); expect(document.activeElement).not.toBe(native);
    native.title = 'Future Hone action'; native.setAttribute('aria-disabled', 'false'); await settle(); expect(hint()).toContain('this version'); expect(hint()).not.toContain('Click the highlighted'); expect(invocations).toHaveLength(0);
  });

  test('late Hone injection and toolbar replacement update the hand-off without stealing typing focus', async () => {
    extensions = [installed()]; setup(); await hone!.enhanceDraft(); expect(hint()).toContain('not visible');
    const draft = document.querySelector('textarea')!; draft.focus(); const native = toolbar(); await settle();
    expect(hint()).toContain('Click the highlighted'); expect(native.classList.contains('jb-hone-target')).toBe(true); expect(document.activeElement).toBe(draft);
    native.remove(); const replacement = toolbar('Undo Hone (restore your original draft)'); await settle();
    expect(native.classList.contains('jb-hone-target')).toBe(false); expect(replacement.classList.contains('jb-hone-target')).toBe(true); expect(hint()).toContain('restores your original draft'); expect(document.activeElement).toBe(draft);
    replacement.remove(); await settle(); expect(hint()).toContain('not visible'); button('Dismiss').click();
    const afterDismiss = toolbar(); await settle(); expect(afterDismiss.classList.contains('jb-hone-target')).toBe(false); expect(document.querySelector('.jb-hone-hint')).toBeNull();
  });

  test('composer unmount, changed chat and route changes abort the session and clear the hint/highlight', async () => {
    extensions = [installed()]; const native = toolbar(); setup(); await hone!.enhanceDraft();
    composerHandlers.forEach(handler => handler({ mounted: true, chatId: 'current', text: 'Edited normally' })); expect(document.querySelector('.jb-hone-hint')).not.toBeNull();
    composerHandlers.forEach(handler => handler({ mounted: false, chatId: null, text: '' })); expect(document.querySelector('.jb-hone-hint')).toBeNull(); expect(signals[0].aborted).toBe(true); expect(native.classList.contains('jb-hone-target')).toBe(false);
    await hone!.enhanceDraft(); activeChat = 'other'; navigationHandlers.forEach(handler => handler()); expect(document.querySelector('.jb-hone-hint')).toBeNull();
    await hone!.enhanceDraft(); dom.window.history.pushState({}, '', '/'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); expect(document.querySelector('.jb-hone-hint')).toBeNull();
    expect(document.querySelector('#composer-sibling')).not.toBeNull(); hone!.destroy(); expect(composerHandlers.size).toBe(0); expect(navigationHandlers.size).toBe(0);
  });
});

describe('Hone setup wizard', () => {
  test('uses a short exact native install / Models / Input / draft path, with no automatic install or model call', async () => {
    activeChat = null; setup(); await hone!.enhanceDraft(); expect(roots).toHaveLength(1); expect(state()).toContain('Install Hone once'); expect(document.querySelector('.jb-hone-progress')?.textContent).toBe('Step 1 of 4');
    expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('Extensions → Add Extension'); expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('GitHub repo URL...');
    expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('Writing tools → Enhance my draft'); expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('Setup guide');
    expect(document.querySelector<HTMLInputElement>('input')?.value).toBe(HONE_REPOSITORY); expect(button('Back').disabled).toBe(true);
    button('Next').click(); expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('Hone → Models'); expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('Model Profile: Default'); expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('Duplicate or + New');
    button('Next').click(); expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('Hone Input Preset:'); expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('Input Single Pass 1.0'); expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('no separate Save');
    button('Next').click(); expect(document.querySelector('.jb-hone-progress')?.textContent).toBe('Step 4 of 4'); expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('Undo'); expect(button('Next').hidden).toBe(true);
    button('Back').click(); expect(document.querySelector('.jb-hone-progress')?.textContent).toBe('Step 3 of 4'); expect(document.activeElement).toBe(document.querySelector('.jb-hone-heading'));
    expect(document.body.textContent).not.toContain('Auto-Enhance User'); expect(document.body.textContent).not.toContain('General'); expect(invocations).toHaveLength(0); expect(revealCount).toBe(0);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) { expect(link.hostname).toBe('github.com'); expect(link.target).toBe('_blank'); expect(link.rel).toBe('noopener noreferrer'); expect(link.referrerPolicy).toBe('no-referrer'); }
    escape(); expect(document.querySelector('.jb-hone')).toBeNull();
  });

  test('copy fallback selects the public repo and keeps the exact native install shortcut explicit', async () => {
    setup(); await hone!.enhanceDraft(); button('Copy repository link').click(); const field = document.querySelector<HTMLInputElement>('input')!;
    expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(HONE_REPOSITORY.length); expect(state()).toContain('link is selected');
    expect(invocations).toHaveLength(0); button('Open Extensions').click(); await settle(); expect(invocations).toEqual([{ kind: 'drawer_tab', id: 'spindle' }]); expect(document.querySelector('.jb-hone')).toBeNull();
  });

  test('wizard initially focuses inside its named dialog, contains keyboard navigation and restores a safe composer focus', async () => {
    const draft = document.querySelector('textarea')!; draft.getClientRects = () => [{ width: 200, height: 50 }] as any; draft.focus();
    setup(); await hone!.enhanceDraft(); const root = document.querySelector<HTMLElement>('.jb-hone')!;
    expect(root.getAttribute('role')).toBe('dialog'); expect(root.getAttribute('aria-modal')).toBe('true'); expect(root.getAttribute('aria-label')).toBe('Set up Hone');
    expect(document.activeElement).toBe(document.querySelector('.jb-hone-heading'));
    root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(document.activeElement === document.querySelector('input')).toBe(true);
    document.querySelector<HTMLInputElement>('input')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(document.activeElement?.textContent).toBe('Hone documentation');
    document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(document.activeElement).toBe(document.querySelector('input'));
    escape(); expect(document.querySelector('.jb-hone')).toBeNull(); expect(document.activeElement).toBe(draft);
  });

  test('installation access, identifier identity, disabled and ambiguous installs get honest usable guidance', async () => {
    read = async () => Response.json({ extensions: [{ id: 'impostor', identifier: 'other', name: 'Hone', enabled: true }], isPrivileged: false }); setup(); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-instruction')?.textContent).toContain('administrator'); expect(document.querySelector('.jb-hone-detail')?.textContent).toContain('cannot install'); expect(revealCount).toBe(0);
    read = async () => Response.json({ extensions: [installed('disabled', false)] }); await hone!.enhanceDraft(); expect(state()).toContain('Enable it');
    read = async () => Response.json({ extensions: [installed('first'), installed('second')] }); await hone!.enhanceDraft(); expect(state()).toContain('More than one'); expect(document.querySelector('.jb-hone-hint')).toBeNull(); expect(invocations).toHaveLength(0);
  });

  test('explicit recheck only refreshes status; explicit Find Hone button then hands off without triggering Hone', async () => {
    setup(); await hone!.enhanceDraft(); const native = toolbar(); let clicks = 0; native.addEventListener('click', () => clicks++); extensions = [installed()];
    button('Recheck Hone').click(); await settle(); expect(state()).toContain('Hone is enabled'); expect(revealCount).toBe(0); expect(document.querySelector('.jb-hone')).not.toBeNull();
    button('Next').click(); button('Next').click(); button('Next').click(); button('Find Hone button').click(); await settle();
    expect(document.querySelector('.jb-hone')).toBeNull(); expect(hint()).toContain('Click the highlighted'); expect(revealCount).toBe(1); expect(clicks).toBe(0); expect(invocations).toHaveLength(0);
  });

  test('native Hone drawer identity is owner-checked again at click time and input actions are never invoked', async () => {
    extensions = [installed()]; surfaces.push({ kind: 'input_bar_action', id: 'hone-enhance', owner: 'hone-id', invocable: true }, { kind: 'drawer_tab', id: 'hone-settings', owner: 'hone-id', invocable: true });
    setup(); await hone!.enhanceDraft(); button('Setup guide').click(); const stale = button('Open Hone');
    surfaces = [{ kind: 'drawer_tab', id: 'hone-settings', owner: 'someone-else', invocable: true }]; stale.click(); await settle(); expect(invocations).toHaveLength(0); expect(state()).toContain('Lumiverse’s menu');
    surfaces = [{ kind: 'drawer_tab', id: 'hone-settings', owner: 'hone-id', invocable: true }]; button('Open Hone').click(); await settle(); expect(invocations).toEqual([{ kind: 'drawer_tab', id: 'hone-settings' }]); expect(document.querySelector('.jb-hone')).toBeNull();
    stale.click(); await settle(); expect(invocations).toHaveLength(1);
  });

  test('failed reads and unavailable native panels retain recovery instructions', async () => {
    read = async () => new Response('error', { status: 500 }); setup(); await hone!.enhanceDraft(); expect(state()).toContain('Could not check');
    surfaces = []; button('Open Extensions').click(); await settle(); expect(state()).toContain('Lumiverse’s menu'); expect(invocations).toHaveLength(0);
    surfaces = [{ kind: 'drawer_tab', id: 'spindle' }]; invokeError = true; button('Open Extensions').click(); await settle(); expect(state()).toContain('could not open'); expect(document.querySelector('.jb-hone')).not.toBeNull();
    read = async () => Response.json({ extensions: 'invalid' }); await hone!.enhanceDraft(); expect(state()).toContain('Could not check');
  });

  test('actual screenshot hooks show an accurate bounded target and reject remote or malformed assets', async () => {
    setup({ screenshots: {
      'hone-install': { src: 'data:image/png;base64,aGVsbG8=', alt: 'Extensions Add Extension screen', highlight: { x: 5, y: 10, w: 80, h: 30 } },
      'hone-models': { src: 'https://tracker.invalid/screen.png', alt: 'Remote image' },
      'hone-input': { src: '/input.png', alt: 'Input preset picker', highlight: { x: 90, y: 5, w: 20, h: 20 } },
      'hone-toolbar': { src: 'javascript:alert(1)', alt: '<img src=x onerror=alert(1)>' },
    } }); await hone!.enhanceDraft();
    expect(document.querySelector('img')?.alt).toBe('Extensions Add Extension screen'); expect(document.querySelector<HTMLElement>('.jb-hone-highlight')?.style.width).toBe('80%');
    button('Next').click(); expect(document.querySelector('img')).toBeNull(); button('Next').click(); expect(document.querySelector('img')?.alt).toBe('Input preset picker'); expect(document.querySelector('.jb-hone-highlight')).toBeNull();
    button('Next').click(); expect(document.querySelector('img')).toBeNull(); expect(document.querySelector('[onerror]')).toBeNull(); expect(invocations).toHaveLength(0);
  });

  test('replacement, route navigation and shutdown abort pending reads and ignore stale responses and controls', async () => {
    let release: ((response: Response) => void) | undefined; read = () => new Promise(resolve => { release = resolve; }); setup();
    const pending = hone!.enhanceDraft(); expect(roots).toHaveLength(0); const firstSignal = signals[0];
    read = async () => Response.json({ extensions: [] }); await hone!.enhanceDraft(); expect(firstSignal.aborted).toBe(true); const oldOpen = button('Open Extensions');
    release!(Response.json({ extensions: [installed()] })); await pending; expect(state()).toContain('Install Hone once'); expect(revealCount).toBe(0);
    dom.window.history.pushState({}, '', '/'); dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate')); expect(document.querySelector('.jb-hone')).toBeNull(); oldOpen.click(); await settle(); expect(invocations).toHaveLength(0);
    let late: ((response: Response) => void) | undefined; read = () => new Promise(resolve => { late = resolve; }); const final = hone!.enhanceDraft(); hone!.destroy(); late!(Response.json({ extensions: [installed()] })); await final;
    expect(signals.every(signal => signal.aborted)).toBe(true); expect(document.querySelector('.jb-hone-hint')).toBeNull(); expect(document.querySelector('.jb-hone')).toBeNull(); await hone!.enhanceDraft(); expect(calls).toHaveLength(3);
  });
});
