import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCardImport } from '../src/card-import';

const originals = { document: globalThis.document, fetch: globalThis.fetch };
const settle = async () => { for (let i = 0; i < 70; i++) await Promise.resolve(); };
const json = (value: unknown, status = 201) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let dom: JSDOM, importer: ReturnType<typeof createCardImport>, roots: HTMLElement[], ctx: any;
let grants: string[], checks: number, permissionRequests: string[][], permissionResult: () => Promise<string[]>;
let requests: Array<{ url: string; init: RequestInit }>, respond: (url: string, init: RequestInit) => Promise<Response>;
let imported: number, opened: Array<{ id: string; connected: boolean }>, navigated: number;
const root = () => roots.at(-1)!;
function button(text: string, inRoot: ParentNode = root()): HTMLButtonElement { const found = [...inRoot.querySelectorAll('button')].find(item => item.textContent === text); if (!found) throw new Error(`Missing button ${text}`); return found; }
const file = (name = 'character.png', data = 'a native card') => new File([data], name, { type: name.endsWith('.json') ? 'application/json' : 'application/octet-stream', lastModified: 123 });
function choose(files: File[]) { const input = root().querySelector<HTMLInputElement>('input[type=file]')!; Object.defineProperty(input, 'files', { configurable: true, value: files }); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
function drop(files: File[]) { const event = new dom.window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { files } }); root().querySelector('.jb-import-drop')!.dispatchEvent(event); }
function addLink(value: string) { button('Link').click(); const input = root().querySelector<HTMLInputElement>('[name=character-card-url]')!; input.value = value; button('Add link').click(); }
function rows() { return [...root().querySelectorAll<HTMLElement>('.jb-import-item')]; }
async function run(text = 'Import') { button(text).click(); await settle(); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><main id="native">Existing app content</main></body>', { url: 'http://localhost:11113/' }); globalThis.document = dom.window.document;
  roots = []; grants = ['characters']; checks = 0; permissionRequests = []; requests = []; imported = 0; opened = []; navigated = 0;
  permissionResult = async () => ['characters'];
  respond = async (_url, init) => json({ character: { id: `native-${requests.length}`, name: 'Imported native card', image_id: 'avatar/id' } });
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { requests.push({ url: String(url), init }); return respond(String(url), init); }) as typeof fetch;
  ctx = {
    permissions: { async getGranted() { checks++; return [...grants]; }, async request(values: string[]) { permissionRequests.push(values); const result = await permissionResult(); grants = [...result]; return result; } },
    host: { surfaces: { list: () => [{ kind: 'drawer_tab', id: 'characters', invocable: true }], invoke: () => { navigated++; } } },
    ui: { showModal() { const node = document.createElement('section'); document.body.append(node); roots.push(node); let closed = false; const handlers: Array<() => void> = []; return { root: node, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; }, dismiss() { if (!closed) { closed = true; node.remove(); handlers.forEach(fn => fn()); } } }; } },
  };
  importer = createCardImport(ctx, { onImported: () => { imported++; }, openCharacter: id => { opened.push({ id, connected: root().isConnected }); } });
  importer.open();
});
afterEach(() => { importer.destroy(); dom.window.close(); globalThis.document = originals.document; globalThis.fetch = originals.fetch; });

test('open, file selection, drag/drop, links and tabs only prepare a queue without requests or permission prompts', () => {
  expect(checks).toBe(0); expect(permissionRequests).toEqual([]); expect(requests).toEqual([]);
  const picker = root().querySelector<HTMLInputElement>('input[type=file]')!; expect(picker.multiple).toBe(true); expect(picker.accept).toContain('.charx');
  choose([file('One.png')]); drop([file('Two.json')]); addLink('https://janitorai.com/characters/1234?public=card'); button('File').click();
  expect(rows()).toHaveLength(3); expect(rows()[0].textContent).toContain('One.png'); expect(rows()[0].textContent).toContain('PNG'); expect(rows()[0].textContent).toContain('B');
  expect(requests).toEqual([]); expect(checks).toBe(0); expect(permissionRequests).toEqual([]);
  expect(document.querySelector('#native')?.textContent).toBe('Existing app content');
});

test('queue limits, duplicate detection and removal keep the explicit batch bounded', () => {
  const files = Array.from({ length: 24 }, (_, index) => file(`card-${index}.json`)); choose(files); expect(rows()).toHaveLength(20); expect(root().textContent).toContain('up to 20');
  rows()[0].querySelector<HTMLButtonElement>('.jb-import-remove')!.click(); expect(rows()).toHaveLength(19);
  drop([files[1], file('not-a-card.exe'), file('empty.png', ''), file('new.charx')]); expect(rows()).toHaveLength(20); expect(root().textContent).toContain('already in the queue');
  expect(requests).toEqual([]); expect(checks).toBe(0);
});

test('native file imports use the original File and browser multipart boundary, then show native result safely', async () => {
  const selected = file('<script>name</script>.png'); choose([selected]);
  respond = async () => json({ character: { id: 'native card/id', name: '<img src=x onerror=evil()>', image_id: 'avatar/id' } });
  await run(); expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('/api/v1/characters/import'); expect(requests[0].init.method).toBe('POST'); expect(requests[0].init.credentials).toBe('same-origin'); expect(requests[0].init.headers).toBeUndefined();
  const form = requests[0].init.body as FormData; const uploaded = form.get('file') as File; expect(uploaded.name).toBe(selected.name); expect(uploaded.type).toBe(selected.type); expect(await uploaded.text()).toBe(await selected.text()); expect([...form.keys()]).toEqual(['file']); expect(checks).toBeGreaterThanOrEqual(2);
  expect(imported).toBe(1); expect(rows()[0].dataset.importState).toBe('success'); expect(root().querySelector('script')).toBeNull(); expect(root().querySelector('[onerror]')).toBeNull(); expect(rows()[0].textContent).toContain('<img src=x onerror=evil()>');
  expect(rows()[0].querySelector('img')?.getAttribute('src')).toBe('/api/v1/images/avatar%2Fid?size=sm');
  button('Open character').click(); expect(opened).toEqual([{ id: 'native card/id', connected: false }]);
});

test('public URL queries are passed intact to native import but never echoed in queue labels', async () => {
  const url = 'https://janitorai.com/characters/11111111-2222-3333-4444-555555555555?public=visible&download=card#section'; addLink(url);
  expect(rows()).toHaveLength(1); expect(rows()[0].textContent).not.toContain('download='); expect(rows()[0].textContent).not.toContain('public=');
  await run(); expect(requests).toHaveLength(1); expect(requests[0].url).toBe('/api/v1/characters/import-url'); expect(requests[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ url: url.split('#')[0] });
});

test('non-HTTP schemes and URL credentials cannot enter the import queue', () => {
  for (const value of ['file:///D:/secret.json', 'javascript:alert(1)', 'data:application/json,{}', 'ftp://example.com/card.png', 'https://user:password@example.com/card.png']) { addLink(value); expect(rows()).toHaveLength(0); }
  expect(requests).toHaveLength(0); expect(checks).toBe(0);
  addLink('https://chub.ai/characters/author/card'); expect(rows()).toHaveLength(1);
});

test('explicit Import requests only Characters when needed; denied permission leaves the queue intact', async () => {
  choose([file()]); grants = []; permissionResult = async () => { throw new Error('denied'); };
  await run(); expect(permissionRequests).toEqual([['characters']]); expect(requests).toHaveLength(0); expect(rows()[0].dataset.importState).toBe('queued');
  await run(); expect(permissionRequests).toHaveLength(1); expect(requests).toHaveLength(0);
  permissionResult = async () => ['characters']; await run('Enable character imports'); expect(permissionRequests).toHaveLength(2); expect(requests).toHaveLength(0);
  await run(); expect(requests).toHaveLength(1); expect(imported).toBe(1);
});

test('permission is checked before every POST and revocation stops the remaining queue', async () => {
  choose([file('first.png'), file('second.png')]);
  respond = async () => { grants = []; return json({ character: { id: 'first-native', name: 'First' } }); };
  await run(); expect(requests).toHaveLength(1); expect(rows().map(row => row.dataset.importState)).toEqual(['success', 'queued']); expect(root().textContent).toContain('remaining cards have not been sent');
});

test('retrying parser failures imports only failed rows and never reimports successful cards', async () => {
  choose([file('good.png'), file('bad.json')]);
  let failedOnce = false;
  respond = async (_url, init) => { const name = ((init.body as FormData).get('file') as File).name; if (name === 'bad.json' && !failedOnce) { failedOnce = true; return json({ code: 'invalid_card', error: 'Invalid card' }, 400); } return json({ character: { id: name, name } }); };
  await run(); expect(rows().map(row => row.dataset.importState)).toEqual(['success', 'error']); expect(imported).toBe(1);
  await run('Retry failed'); expect(requests).toHaveLength(3); expect(requests.map(request => ((request.init.body as FormData).get('file') as File).name)).toEqual(['good.png', 'bad.json', 'bad.json']); expect(imported).toBe(2);
  expect(button('Import').disabled).toBe(true); expect(button('Retry failed').hidden).toBe(true);
});

test('network or partially durable server errors require checking the library before any retry', async () => {
  choose([file('partial.png')]); respond = async () => json({ error: 'Image upload failed' }, 400);
  await run(); expect(rows()[0].dataset.importState).toBe('uncertain'); expect(button('Retry failed').hidden).toBe(true); expect(button('Import').disabled).toBe(true); expect(root().textContent).toContain('Check your library');
  button('Retry after checking').click(); expect(requests).toHaveLength(1); expect(rows()[0].dataset.importState).toBe('queued');
  respond = async () => { throw new TypeError('Network interrupted'); }; await run(); expect(requests).toHaveLength(2); expect(rows()[0].dataset.importState).toBe('uncertain'); expect(imported).toBe(0);
});

test('close during an in-flight import aborts the request, prevents later writes and ignores late success', async () => {
  choose([file('first.png'), file('second.png')]); const pending = deferred<Response>(); respond = async () => pending.promise;
  button('Import').click(); await settle(); expect(requests).toHaveLength(1); const signal = requests[0].init.signal!;
  button('Close').click(); expect(signal.aborted).toBe(true); pending.resolve(json({ character: { id: 'late', name: 'Late native creation' } })); await settle();
  expect(requests).toHaveLength(1); expect(imported).toBe(0); expect(root().isConnected).toBe(false);
  importer.open(); expect(rows()).toHaveLength(0); expect(requests).toHaveLength(1); expect(root().textContent).not.toContain('Late native');
});

test('close while checking permission prevents both the permission popup and import POST', async () => {
  choose([file()]); const pending = deferred<string[]>(); ctx.permissions.getGranted = () => pending.promise;
  button('Import').click(); button('Close').click(); pending.resolve([]); await settle(); expect(permissionRequests).toHaveLength(0); expect(requests).toHaveLength(0);
});

test('a quick double click while permission is pending cannot start duplicate native imports', async () => {
  choose([file()]); const pending = deferred<string[]>(); let first = true; ctx.permissions.getGranted = () => first ? (first = false, pending.promise) : Promise.resolve(['characters']);
  const importButton = button('Import'); importButton.click(); importButton.click(); pending.resolve(['characters']); await settle(); expect(requests).toHaveLength(1); expect(imported).toBe(1);
});

test('refresh callback failures cannot turn successful imports into retryable errors', async () => {
  importer.destroy(); importer = createCardImport(ctx, { onImported: () => { throw new Error('refresh unavailable'); } }); importer.open(); choose([file()]); await run();
  expect(rows()[0].dataset.importState).toBe('success'); expect(button('Import').disabled).toBe(true); expect(button('Retry failed').hidden).toBe(true); expect(requests).toHaveLength(1);
});
