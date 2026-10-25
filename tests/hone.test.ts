import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createHone, HONE_REPOSITORY } from '../src/hone';

let dom: JSDOM;
let hone: ReturnType<typeof createHone> | undefined;
let extensions: unknown[];
let surfaces: Array<{ kind: string; id: string; owner?: string; invocable?: boolean }>;
let calls: Array<{ url: string; options: RequestInit | undefined }>;
let invocations: unknown[];
let revealCount: number;
let roots: HTMLElement[];
let signals: AbortSignal[];
let read: () => Promise<Response>;
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const installed = (id = 'hone-id', enabled = true) => ({ id, identifier: 'hone', enabled, has_frontend: true, status: 'running' });
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!;

function setup(withReveal = true) {
  hone = createHone({
    ui: { showModal() {
      const root = document.createElement('section'); document.body.append(root); roots.push(root); const callbacks: Array<() => void> = [];
      let closed = false;
      return { root, onDismiss(callback: () => void) { callbacks.push(callback); return () => {}; }, dismiss() { if (closed) return; closed = true; callbacks.forEach(callback => callback()); root.remove(); } };
    } },
    host: { surfaces: {
      list(kinds?: string[]) { return surfaces.filter(surface => !kinds || kinds.includes(surface.kind)); },
      async invoke(ref: unknown) { invocations.push(ref); },
    } },
    permissions: { request() { throw new Error('Permission request is forbidden'); } },
    composer: { setText() { throw new Error('Draft writes are forbidden'); } },
    sendToBackend() { throw new Error('Generation is forbidden'); },
  } as any, withReveal ? { revealTools() { revealCount++; } } : {});
  return hone;
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><textarea>My unchanged draft</textarea></body></html>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document;
  extensions = []; surfaces = [{ kind: 'drawer_tab', id: 'spindle', invocable: true }]; calls = []; invocations = []; roots = []; signals = []; revealCount = 0;
  read = async () => Response.json({ extensions });
  globalThis.fetch = (async (url, options) => {
    calls.push({ url: String(url), options }); if (options?.signal) signals.push(options.signal); return read();
  }) as typeof fetch;
});
afterEach(() => { hone?.destroy(); hone = undefined; globalThis.fetch = originalFetch; dom.window.close(); globalThis.document = originalDocument; });

describe('Hone installation hand-off', () => {
  test('opens on an empty or unmounted composer, reads metadata only after click, and provides exact official links', async () => {
    setup(); expect(calls).toHaveLength(0); await hone!.enhanceDraft();
    expect(calls).toHaveLength(1); expect(calls[0].url).toBe('/api/v1/spindle'); expect(calls[0].options?.credentials).toBe('same-origin'); expect(calls[0].options?.cache).toBe('no-store'); expect(calls[0].options?.method).toBeUndefined(); expect(calls[0].options?.body).toBeUndefined();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Install Hone once');
    expect(document.querySelector<HTMLInputElement>('input')?.value).toBe(HONE_REPOSITORY);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) { expect(link.hostname).toBe('github.com'); expect(link.target).toBe('_blank'); expect(link.rel).toContain('noreferrer'); }
    expect(document.querySelectorAll('.jb-hone-steps li')).toHaveLength(3);
    expect(invocations).toHaveLength(0); expect(revealCount).toBe(0); expect(document.querySelector('textarea')?.value).toBe('My unchanged draft');
    button('Open Extensions').click(); await settle(); expect(invocations).toEqual([{ kind: 'drawer_tab', id: 'spindle' }]); expect(document.querySelector('.jb-hone')).toBeNull();
  });

  test('copy link selects the URL when clipboard access is unavailable', async () => {
    setup(); await hone!.enhanceDraft(); button('Copy link').click();
    const field = document.querySelector<HTMLInputElement>('input')!;
    expect(field.selectionStart).toBe(0); expect(field.selectionEnd).toBe(HONE_REPOSITORY.length);
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('link is selected'); expect(invocations).toHaveLength(0);
  });

  test('accounts without installation access get an actionable administrator instruction', async () => {
    read = async () => Response.json({ extensions: [], isPrivileged: false }); setup(); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-steps li')?.textContent).toContain('administrator');
    expect(document.querySelector('.jb-hone-notice')?.textContent).toContain('cannot install');
    expect(button('Open Extensions').disabled).toBe(false); expect(invocations).toHaveLength(0);
  });

  test('installed Hone exposes its own controls without invoking generation or an input action', async () => {
    extensions = [installed()]; surfaces.push({ kind: 'input_bar_action', id: 'hone-enhance', owner: 'hone-id', invocable: true }, { kind: 'drawer_tab', id: 'hone-settings', owner: 'hone-id', invocable: true });
    setup(); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Hone is installed'); expect(document.querySelector<HTMLOListElement>('.jb-hone-steps')?.hidden).toBe(true);
    expect(button('Show Hone controls').hidden).toBe(false); button('Show Hone controls').click();
    expect(revealCount).toBe(1); expect(invocations).toHaveLength(0); expect(document.querySelector('textarea')?.value).toBe('My unchanged draft');
    await hone!.enhanceDraft(); button('Open Hone').click(); await settle(); expect(invocations).toEqual([{ kind: 'drawer_tab', id: 'hone-settings' }]);
  });

  test('does not mistake an extension named Hone or a foreign drawer for the real installation', async () => {
    extensions = [{ id: 'impostor', name: 'Hone', identifier: 'other', enabled: true }]; surfaces.push({ kind: 'drawer_tab', id: 'hone', owner: 'impostor', invocable: true });
    setup(); await hone!.enhanceDraft(); expect(button('Open Hone').hidden).toBe(true); expect(button('Show Hone controls').hidden).toBe(true);
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Install Hone once'); expect(invocations).toHaveLength(0);
  });

  test('disabled or ambiguous installations direct the user to Extensions without guessing an action', async () => {
    extensions = [installed('disabled', false)]; setup(); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Enable it'); expect(button('Show Hone controls').hidden).toBe(true);
    extensions = [installed('first'), installed('second')]; await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('More than one'); expect(button('Show Hone controls').hidden).toBe(true); expect(invocations).toHaveLength(0);
  });

  test('rechecks ownership before opening a Hone drawer and handles missing native Extensions', async () => {
    extensions = [installed()]; surfaces.push({ kind: 'drawer_tab', id: 'hone-settings', owner: 'hone-id', invocable: true });
    setup(false); await hone!.enhanceDraft(); surfaces = [{ kind: 'drawer_tab', id: 'hone-settings', owner: 'someone-else', invocable: true }];
    button('Open Hone').click(); await settle(); button('Open Extensions').click(); await settle();
    expect(invocations).toHaveLength(0); expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Lumiverse’s menu');
  });

  test('failed or malformed reads leave install guidance usable', async () => {
    read = async () => new Response('error', { status: 500 }); setup(); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Could not check'); expect(button('Open Extensions').disabled).toBe(false);
    read = async () => Response.json({ extensions: 'invalid' }); await hone!.enhanceDraft();
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Could not check'); expect(document.querySelector('a')?.href).toBe(HONE_REPOSITORY);
  });

  test('replacement and shutdown abort pending reads and ignore late results', async () => {
    let release: ((response: Response) => void) | undefined; read = () => new Promise(resolve => { release = resolve; }); setup();
    const pending = hone!.enhanceDraft(); expect(roots).toHaveLength(1); const firstRoot = roots[0]; const firstSignal = signals[0];
    read = async () => Response.json({ extensions: [] }); await hone!.enhanceDraft(); expect(firstSignal.aborted).toBe(true); expect(firstRoot.isConnected).toBe(false);
    release!(Response.json({ extensions: [installed()] })); await pending;
    expect(document.querySelector('.jb-hone-state')?.textContent).toContain('Install Hone once');
    hone!.destroy(); expect(signals.every(signal => signal.aborted)).toBe(true); expect(document.querySelector('.jb-hone')).toBeNull();
    await hone!.enhanceDraft(); expect(calls).toHaveLength(2); expect(invocations).toHaveLength(0);
  });
});
