import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCardImport } from '../src/card-import';
import { openFeatureTutorial } from '../src/feature-tutorials';
import { CARD_GUIDE_KEY } from '../src/import-tutorial';

let dom: JSDOM, oldDocument: any, oldFetch: any, ctx: any, importer: ReturnType<typeof createCardImport>, guide: ReturnType<typeof openFeatureTutorial> | undefined;
let roots: HTMLElement[], requests: Array<{ url: string; init: RequestInit }>, writes: any[], stored: unknown, permissions: number, savedCards: number, histories: number, closed: number;
let respond: () => Promise<Response>;
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const button = (name: string, scope: ParentNode = document) => { const match = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name); if (!match) throw new Error(`Missing ${name}`); return match; };
function start(extra = {}) { guide = openFeatureTutorial(ctx, 'import', { invoke: async () => { throw new Error('Card guidance does not use JAR'); }, openImport: attachment => importer.open(attachment), openHistoryTutorial: () => histories++, onClose: () => closed++, ...extra }); return guide; }
function choose(name = 'private-original.json') { const input = roots.at(-1)!.querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { configurable: true, value: [new File(['{"name":"Mira"}'], name, { type: 'application/json', lastModified: 123 })] }); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
beforeEach(() => {
  oldDocument = globalThis.document; oldFetch = globalThis.fetch; dom = new JSDOM('<!doctype html><body><button id="launch">Card import guide</button></body>', { url: 'http://localhost:7860/', pretendToBeVisual: true }); globalThis.document = dom.window.document;
  roots = []; requests = []; writes = []; stored = undefined; permissions = savedCards = histories = closed = 0;
  respond = async () => new Response(JSON.stringify({ character: { id: 'card-one', name: 'Mira' } }), { status: 201 });
  globalThis.fetch = (async (url, init) => { requests.push({ url: String(url), init: init! }); return respond(); }) as typeof fetch;
  ctx = { permissions: { async getGranted() { permissions++; return ['characters']; }, async request() { throw new Error('No guide permission prompts'); } },
    settings: { get: async () => stored, set: async (key: string, value: unknown) => { writes.push({ key, value: structuredClone(value) }); stored = value; } },
    ui: { showModal() { const root = document.createElement('section'); root.setAttribute('role', 'dialog'); document.body.append(root); roots.push(root); let closed = false; const listeners: Array<() => void> = []; return { root, onDismiss(fn: () => void) { listeners.push(fn); }, dismiss() { if (closed) return; closed = true; root.remove(); listeners.forEach(fn => fn()); } }; } },
  };
  importer = createCardImport(ctx, { onImported: () => savedCards++, openCharacter: () => {} });
});
afterEach(() => { guide?.destroy(); importer.destroy(); guide = undefined; dom.window.close(); globalThis.document = oldDocument; globalThis.fetch = oldFetch; });

test('opens one ordinary importer with visible companion guidance and no uploads or permission requests', async () => {
  const view = start(); await settle(); expect(roots).toHaveLength(1); expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(view.root.closest('.jb-card-import')).toBe(roots[0]); expect(view.root.getAttribute('role')).toBe('complementary'); expect(view.root.textContent).toContain('You do not need JAR or JAR Bridge');
  expect(view.root.querySelector('.jb-api-guide-instruction')!.closest('details')).toBeNull(); expect(view.root.querySelector('details')!.open).toBe(false); expect(requests).toEqual([]); expect(permissions).toBe(0);
});

test('selection advances to review while navigation, minimizing and closing the guide preserve the unsent queue', async () => {
  const view = start(); await settle(); choose(); expect(view.root.dataset.scene).toBe('2'); expect(requests).toEqual([]);
  button('Next', view.root).click(); button('Minimize card guide', view.root).click(); expect(view.root.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(true);
  button('Resume card guide', view.root).click(); expect(view.root.dataset.scene).toBe('3'); button('Close tutorial', view.root).click();
  expect(roots[0].isConnected).toBe(true); expect(roots[0].querySelector('.jb-import-item')!.textContent).toContain('Ready to import'); expect(roots[0].querySelector('.jb-import-item')!.textContent).toContain('private-original.json'); expect(requests).toEqual([]); expect(closed).toBe(1);
  button('Import', roots[0]).click(); await settle(); expect(savedCards).toBe(1); expect(requests).toHaveLength(1);
});

test('only a confirmed native save completes the card guide, and finishing leaves the saved card and importer available', async () => {
  const view = start(); await settle(); button('Next', view.root).click(); button('Next', view.root).click(); button('Next', view.root).click(); expect(button('Finish guide', view.root).disabled).toBe(true);
  choose(); button('Import', roots[0]).click(); await settle(); expect(requests).toHaveLength(1); expect(requests[0].url).toBe('/api/v1/characters/import'); expect(requests[0].init.method).toBe('POST');
  expect(view.root.dataset.scene).toBe('4'); expect(button('Finish guide', view.root).disabled).toBe(false); expect(view.root.textContent).toContain('1 card saved in this session'); button('Finish guide', view.root).click();
  expect(roots[0].isConnected).toBe(true); expect(roots[0].textContent).toContain('Imported to your library'); expect(savedCards).toBe(1); expect(histories).toBe(0);
});

for (const uncertain of [false, true]) test(`a ${uncertain ? 'lost response' : 'rejected card'} never reports a successful import`, async () => {
  const view = start(); await settle(); choose(); respond = uncertain ? async () => { throw new Error('Disconnected'); } : async () => new Response(JSON.stringify({ error: 'Invalid JSON in uploaded file' }), { status: 400 });
  button('Import', roots[0]).click(); await settle(); while (!button('Next', view.root).hidden) button('Next', view.root).click();
  expect(button('Finish guide', view.root).disabled).toBe(true); expect(view.root.textContent).toContain(uncertain ? 'Check the library before retrying' : 'Read their queue messages'); expect(savedCards).toBe(0); expect(requests).toHaveLength(1);
});

test('reopening resumes instructions with a fresh queue, without persisting files, links, results or invented completion', async () => {
  let view = start(); await settle(); choose(); button('Next', view.root).click(); await settle(); button('Close', roots[0]).click(); expect(view.root.isConnected).toBe(false);
  view = start(); await settle(); expect(view.root.dataset.scene).toBe('3'); expect(roots[1].querySelectorAll('.jb-import-item')).toHaveLength(0);
  expect(view.root.querySelector('.jb-api-guide-status')!.textContent).toContain('Queue is empty'); expect(view.root.querySelector('.jb-api-guide-status')!.textContent).toContain('Already saved? Find it on Home.');
  expect(writes.at(-1)).toEqual({ key: CARD_GUIDE_KEY, value: { step: 2 } }); expect(JSON.stringify(writes)).not.toMatch(/private-original|Mira|card-one|success|https/);
  button('Next', view.root).click(); expect(button('Finish guide', view.root).disabled).toBe(true); expect(closed).toBe(1);
});

test('late stored progress cannot replace either native form interaction or a queued selection', async () => {
  const pending = deferred<unknown>(); ctx.settings.get = () => pending.promise; const view = start(); await settle();
  roots[0].querySelector('.jb-import-workspace')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); pending.resolve({ step: 3 }); await settle(); expect(view.root.dataset.scene).toBe('1');
  view.destroy(); const later = deferred<unknown>(); ctx.settings.get = () => later.promise; const other = start(); await settle(); choose(); later.resolve({ step: 0 }); await settle(); expect(other.root.dataset.scene).toBe('2');
});

test('old messages are a separate explicit path, and handing off closes the unsent card workspace exactly once', async () => {
  const view = start(); await settle(); choose(); const history = button('Need your old messages too?', view.root); history.click(); history.click(); await settle();
  expect(histories).toBe(1); expect(closed).toBe(1); expect(roots[0].isConnected).toBe(false); expect(requests).toEqual([]); expect(permissions).toBe(0);
});

test('history and step navigation wait while an actual import is in flight', async () => {
  const pending = deferred<Response>(); respond = () => pending.promise; const view = start(); await settle(); choose(); button('Import', roots[0]).click(); await settle();
  expect(button('Need your old messages too?', view.root).disabled).toBe(true); expect(button('Next', view.root).disabled).toBe(true); button('Need your old messages too?', view.root).click(); expect(histories).toBe(0);
  pending.resolve(new Response(JSON.stringify({ character: { id: 'saved', name: 'Mira' } }), { status: 201 })); await settle(); expect(view.root.dataset.scene).toBe('4'); expect(savedCards).toBe(1);
});

test('closing the importer aborts pending work and discards a late import result', async () => {
  const pending = deferred<Response>(); respond = () => pending.promise; const view = start(); await settle(); choose(); button('Import', roots[0]).click(); await settle(); button('Close', roots[0]).click();
  expect(requests[0].init.signal!.aborted).toBe(true); expect(view.root.isConnected).toBe(false); pending.resolve(new Response(JSON.stringify({ character: { id: 'late' } }), { status: 201 })); await settle(); expect(savedCards).toBe(0); expect(closed).toBe(1);
});

test('missing import controls give recovery, and closing before launch cancels the deferred opening', async () => {
  let launches = 0; let view = start({ openImport: undefined }); await settle(); expect(roots).toHaveLength(0); expect(view.root.textContent).toContain('More → Import characters'); view.destroy();
  view = start({ openImport: () => launches++ }); view.destroy(); await settle(); expect(launches).toBe(0); expect(requests).toEqual([]);
});

test('unsafe screenshots are rejected and image failure leaves readable instructions available', async () => {
  const view = start({ screenshots: { 'card-import-open': { src: 'javascript:alert(1)', alt: 'Unsafe' }, 'card-import-queue': { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'Queue', callouts: [{ label: '<script>literal</script>', x: 20, y: 20, targetX: 50, targetY: 50 }] } } }); await settle();
  expect(view.root.querySelector('img')).toBeNull(); button('Next', view.root).click(); expect(view.root.querySelector('.jb-tutorial-callouts')!.closest('details')).toBe(view.root.querySelector('.jb-api-guide-picture')); expect(view.root.querySelector('script')).toBeNull();
  view.root.querySelector('img')!.dispatchEvent(new dom.window.Event('error')); expect(view.root.textContent).toContain('Screenshot unavailable'); expect(view.root.querySelector('.jb-api-guide-instruction')!.closest('details')).toBeNull(); expect(requests).toEqual([]);
});
