import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { consumePersonaSetupHandoff, createPersonaCreate, reloadForPersonaSetup } from '../src/persona-create';

const originals = { document: globalThis.document, fetch: globalThis.fetch };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let dom: any, ctx: any, creator: ReturnType<typeof createPersonaCreate>, roots: HTMLElement[], dismiss: () => void;
let grants: string[], checks: number, permissionRequests: string[][], permissionResult: () => Promise<string[]>;
let requests: Array<{ url: string; init: RequestInit }>, respond: () => Promise<Response>;
let opened: number, finished: number, nativeResult: () => Promise<boolean>, finishAction: () => void;
const root = () => roots.at(-1)!;
const control = (name: string) => root().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
const button = (text: string) => [...root().querySelectorAll('button')].find(node => node.textContent === text)!;
function submit() { root().querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
function draft() { control('name').value = 'Mira'; control('description').value = 'Mira is a curious traveler.'; }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><main>Existing app</main></body>', { url: 'http://localhost:7860/' }); globalThis.document = dom.window.document;
  roots = []; grants = ['personas']; checks = 0; permissionRequests = []; requests = []; opened = 0; finished = 0;
  permissionResult = async () => ['personas']; respond = async () => json({ id: 'saved-persona', name: 'Mira' }); nativeResult = async () => true; finishAction = () => { finished++; };
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { requests.push({ url: String(url), init }); return respond(); }) as typeof fetch;
  ctx = {
    permissions: { async getGranted() { checks++; return [...grants]; }, async request(values: string[]) { permissionRequests.push(values); grants = await permissionResult(); return [...grants]; } },
    ui: { showModal({ title }: { title: string }) {
      const node = document.createElement('section'); node.setAttribute('role', 'dialog'); node.setAttribute('aria-label', title); document.body.append(node); roots.push(node);
      let closed = false; const handlers: Array<() => void> = [];
      dismiss = () => { if (closed) return; closed = true; node.remove(); handlers.forEach(fn => fn()); };
      return { root: node, dismiss, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; } };
    } },
  };
  creator = createPersonaCreate(ctx, { openPersonas: () => { opened++; return nativeResult(); }, finishSetup: () => finishAction() }); creator.open();
});
afterEach(() => { creator.destroy(); dom.window.close(); globalThis.document = originals.document; globalThis.fetch = originals.fetch; });

test('opening explains persona versus character, provides editable examples, and does no host work', () => {
  expect(root().textContent).toContain('your persona is who you play');
  expect(root().textContent).toContain('pronouns, appearance, personality, or background');
  expect(root().textContent).toContain('portrait');
  expect(document.activeElement).toBe(control('name'));
  button('Use example').click();
  expect(control('name').value).toBe('Alex'); expect(control('description').value).toContain('they/them');
  expect(checks).toBe(0); expect(permissionRequests).toEqual([]); expect(requests).toEqual([]); expect(opened + finished).toBe(0);
});

test('the example fills only blank fields and uses a name the user already supplied', () => {
  control('name').value = 'Mira'; button('Use example').click();
  expect(control('description').value).toStartWith('Mira uses');
  control('name').value = ''; control('description').value = 'My own writing.';
  control('name').dispatchEvent(new dom.window.Event('input', { bubbles: true })); button('Use example').click();
  expect(control('description').value).toBe('My own writing.'); expect(control('name').value).toBe('Alex');
});

test('Create saves one normal persona without activating it or changing default and chat settings', async () => {
  draft(); control('name').value = ' Mira '; control('description').value = '  My description\n{{user}} is a traveler.  ';
  submit(); await settle();
  expect(requests).toHaveLength(1);
  const request = requests[0]; expect(request.url).toBe('/api/v1/personas'); expect(request.init.method).toBe('POST'); expect(request.init.credentials).toBe('same-origin'); expect(request.init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(request.init.body))).toEqual({ name: 'Mira', description: '  My description\n{{user}} is a traveler.  ' });
  expect(root().querySelector('form')!.hidden).toBe(true); expect(root().textContent).toContain('Select Mira in Personas');
  expect(finished + opened).toBe(0); submit(); await settle(); expect(requests).toHaveLength(1);
  button('Reload and open Personas').click(); expect(finished).toBe(1); expect(requests).toHaveLength(1);
});

test('a name is required, description is optional, and validation happens before permissions', async () => {
  submit(); await settle(); expect(control('name').getAttribute('aria-invalid')).toBe('true'); expect(checks).toBe(0); expect(requests).toEqual([]);
  control('name').value = 'Alex'; submit(); await settle();
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ name: 'Alex', description: '' });
});

test('the separate sticky footer submits its associated form and hides after saving', async () => {
  draft(); const create = button('Create persona');
  expect(create.form).toBe(root().querySelector('form'));
  expect(create.parentElement!.parentElement).toBe(root());
  create.click(); await settle();
  expect(requests).toHaveLength(1); expect(create.parentElement!.hidden).toBe(true);
});

test('permission denial keeps the draft, does not repeat prompts, and enabling alone never saves', async () => {
  draft(); grants = []; permissionResult = async () => [];
  submit(); await settle(); submit(); await settle();
  expect(permissionRequests).toEqual([['personas']]); expect(requests).toEqual([]); expect(control('description').value).toBe('Mira is a curious traveler.');
  permissionResult = async () => ['personas']; button('Enable Personas permission').click(); await settle();
  expect(requests).toEqual([]); expect(root().querySelector('[role=status]')!.textContent).toBe('');
  submit(); await settle(); expect(requests).toHaveLength(1);
});

test('duplicate submissions are blocked during permission and save requests', async () => {
  draft(); grants = []; const permission = deferred<string[]>(); permissionResult = () => permission.promise;
  submit(); submit(); await settle(); expect(permissionRequests).toHaveLength(1);
  const pending = deferred<Response>(); respond = () => pending.promise; permission.resolve(['personas']); await settle(); submit(); submit();
  expect(requests).toHaveLength(1); expect(root().querySelector('form')!.getAttribute('aria-busy')).toBe('true');
  pending.resolve(json({ id: 'only-once' })); await settle(); expect(root().querySelector('.jb-persona-success')!.hasAttribute('hidden')).toBe(false);
});

test('revocation immediately before the write stops creation', async () => {
  draft(); ctx.permissions.getGranted = async () => ++checks === 1 ? ['personas'] : [];
  submit(); await settle(); expect(checks).toBe(2); expect(requests).toEqual([]); expect(control('name').value).toBe('Mira');
});

test('a confirmed validation rejection allows correcting and retrying the draft', async () => {
  draft(); respond = async () => json({ error: 'Rejected' }, 400); submit(); await settle();
  expect(control('name').closest('fieldset')!.disabled).toBe(false); expect(root().textContent).toContain('Check your name');
  respond = async () => json({ id: 'fixed' }); submit(); await settle(); expect(requests).toHaveLength(2);
});

for (const failure of ['network', 'server', 'missing id', 'invalid JSON'] as const) test(`an uncertain ${failure} result blocks duplicate creation and offers checking Personas`, async () => {
  draft(); respond = async () => {
    if (failure === 'network') throw new Error('Disconnected');
    if (failure === 'invalid JSON') return new Response('not json', { status: 201 });
    return failure === 'server' ? json({}, 500) : json({});
  };
  submit(); await settle(); submit(); await settle();
  expect(requests).toHaveLength(1); expect(control('name').closest('fieldset')!.disabled).toBe(true);
  expect(button('Reload and check Personas').hidden).toBe(false); expect(root().textContent).toContain('could not be confirmed');
  button('Reload and check Personas').click(); expect(finished).toBe(1);
});

test('dismissal during permission checking prevents writes and old controls cannot act', async () => {
  draft(); grants = []; const pending = deferred<string[]>(); permissionResult = () => pending.promise;
  const oldExample = button('Use example'); submit(); await settle(); dismiss(); pending.resolve(['personas']); await settle(); oldExample.click();
  expect(requests).toEqual([]); expect(finished + opened).toBe(0); expect(root().isConnected).toBe(false);
});

test('dismissal aborts an in-flight save and late results cannot open or replace anything', async () => {
  draft(); const pending = deferred<Response>(); respond = () => pending.promise;
  submit(); await settle(); const oldRoot = root(); dismiss(); creator.open(); const replacement = root();
  expect(requests[0].init.signal!.aborted).toBe(true);
  pending.resolve(json({ id: 'late-save' })); await settle();
  expect(oldRoot.isConnected).toBe(false); expect(replacement.isConnected).toBe(true); expect(replacement.querySelector('form')!.hidden).toBe(false); expect(opened + finished).toBe(0);
});

test('repeated opening keeps a draft, and disabling closes it and stops further actions', () => {
  draft(); creator.open(); expect(roots).toHaveLength(1); expect(control('name').value).toBe('Mira');
  const native = button('Open existing personas'); creator.destroy(); native.click(); creator.open();
  expect(roots).toHaveLength(1); expect(root().isConnected).toBe(false); expect(opened + finished).toBe(0);
});

test('native management failure retains the form and a later successful invocation closes it', async () => {
  draft(); nativeResult = async () => false; button('Open existing personas').click(); await settle();
  expect(root().textContent).toContain('sidebar'); expect(control('name').value).toBe('Mira');
  nativeResult = async () => true; button('Open existing personas').click(); await settle();
  expect(opened).toBe(2); expect(root().isConnected).toBe(false); expect(requests).toEqual([]);
});

test('saved names and descriptions remain text, and a failed reload never permits duplicate creation', async () => {
  control('name').value = '<img src=x onerror=alert(1)>'; control('description').value = '<script>alert(1)</script>';
  submit(); await settle(); expect(root().querySelector('img, script')).toBeNull();
  finishAction = () => { throw new Error('Storage unavailable'); }; button('Reload and open Personas').click();
  expect(root().textContent).toContain('Your persona is saved. Reload Janiverse'); submit(); await settle(); expect(requests).toHaveLength(1);
});

test('reload handoff contains no persona data, is consumed once, and expires', () => {
  const storage = dom.window.sessionStorage; let reloaded = 0;
  reloadForPersonaSetup(storage, () => { reloaded++; }); expect(reloaded).toBe(1); expect(storage.length).toBe(1);
  const key = storage.key(0)!; expect(Number.isFinite(Number(storage.getItem(key)))).toBe(true);
  expect(consumePersonaSetupHandoff(storage)).toBe(true); expect(consumePersonaSetupHandoff(storage)).toBe(false);
  storage.setItem(key, String(Date.now() - 10 * 60_000)); expect(consumePersonaSetupHandoff(storage)).toBe(false); expect(storage.length).toBe(0);
  storage.setItem(key, 'malformed'); expect(consumePersonaSetupHandoff(storage)).toBe(false);
});
