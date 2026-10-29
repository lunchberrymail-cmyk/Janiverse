import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCharacterCreate } from '../src/character-create';

const originals = { document: globalThis.document, fetch: globalThis.fetch, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
const settle = async () => { for (let i = 0; i < 90; i++) await Promise.resolve(); };
const json = (value: unknown, status = 201) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let dom: JSDOM, creator: ReturnType<typeof createCharacterCreate>, roots: HTMLElement[], ctx: any;
let grants: string[], checks: number, permissionRequests: string[][], permissionResult: () => Promise<string[]>;
let requests: Array<{ url: string; init: RequestInit }>, respond: (url: string, init: RequestInit) => Promise<Response>;
let createdIds: string[], opened: Array<{ id: string; connected: boolean }>, navigated: number, revoked: string[], previewCount: number;
const root = () => roots.at(-1)!;
const control = (name: string) => root().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
function button(text: string): HTMLButtonElement { const found = [...root().querySelectorAll('button')].find(item => item.textContent === text); if (!found) throw new Error(`Missing button ${text}`); return found; }
function draft() { control('name').value = 'Mira'; control('description').value = 'A thoughtful explorer.'; control('first_mes').value = 'Welcome aboard, {{user}}.'; }
function submit() { root().querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
const picture = (name = 'portrait.png', type = 'image/png', data = 'picture') => new File([data], name, { type });
function choose(file?: File) { const input = control('portrait') as HTMLInputElement; Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] }); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><main id="native">Existing app content</main></body>', { url: 'http://localhost:11113/' }); globalThis.document = dom.window.document;
  roots = []; grants = ['characters']; checks = 0; permissionRequests = []; requests = []; createdIds = []; opened = []; navigated = 0; revoked = []; previewCount = 0;
  permissionResult = async () => ['characters']; respond = async url => json({ id: 'native card/id', name: 'Mira', image_id: url.endsWith('/avatar') ? 'new-image' : null });
  URL.createObjectURL = () => `blob:portrait-${++previewCount}`; URL.revokeObjectURL = value => { revoked.push(String(value)); };
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => { requests.push({ url: String(url), init }); return respond(String(url), init); }) as typeof fetch;
  ctx = {
    permissions: { async getGranted() { checks++; return [...grants]; }, async request(values: string[]) { permissionRequests.push(values); const result = await permissionResult(); grants = [...result]; return result; } },
    host: { surfaces: { list: () => [{ kind: 'drawer_tab', id: 'characters', invocable: true }], invoke: () => { navigated++; } } },
    ui: { showModal() { const node = document.createElement('section'); document.body.append(node); roots.push(node); let closed = false; const handlers: Array<() => void> = []; return { root: node, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; }, dismiss() { if (!closed) { closed = true; node.remove(); handlers.forEach(fn => fn()); } } }; } },
  };
  creator = createCharacterCreate(ctx, { onCreated: id => { createdIds.push(id); }, openCharacter: id => { opened.push({ id, connected: root().isConnected }); } }); creator.open();
});
afterEach(() => { creator.destroy(); dom.window.close(); globalThis.document = originals.document; globalThis.fetch = originals.fetch; URL.createObjectURL = originals.createObjectURL; URL.revokeObjectURL = originals.revokeObjectURL; });

test('opening and preparing a card is local, with clearly separate creator bio and AI definition', () => {
  draft(); control('creator_notes').value = '<b>A public story hook.</b>'; choose(picture());
  expect(checks).toBe(0); expect(requests).toEqual([]); expect(permissionRequests).toEqual([]);
  expect(control('creator_notes').closest('label')?.textContent).toContain('Shown on your character card');
  expect(control('description').closest('label')?.textContent).toContain('guides the AI');
  expect(root().querySelector('details')?.open).toBe(false);
  expect(root().querySelector('img')?.getAttribute('src')).toBe('blob:portrait-1');
  expect(root().querySelector('b')).toBeNull(); expect(document.querySelector('#native')?.textContent).toBe('Existing app content');
});

test('Create saves a normal native card, preserving prompt text and keeping creator notes out of definition', async () => {
  draft(); control('name').value = ' Mira '; control('chat_name').value = ' Captain Mira '; control('creator_notes').value = 'Public bio only.';
  control('description').value = '  Model definition\n{{char}} respects {{user}}.  '; control('first_mes').value = '\n*{{char}} smiles.*\n';
  control('scenario').value = 'A quiet harbour.'; control('mes_example').value = '<START>\n{{user}}: Hello\n{{char}}: Welcome.'; control('creator').value = ' Author '; control('tags').value = 'fantasy, adventure, fantasy, , original';
  submit(); await settle(); expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('/api/v1/characters'); expect(requests[0].init.method).toBe('POST'); expect(requests[0].init.credentials).toBe('same-origin'); expect(requests[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(String(requests[0].init.body))).toEqual({ name: 'Mira', creator_notes: 'Public bio only.', description: '  Model definition\n{{char}} respects {{user}}.  ', first_mes: '\n*{{char}} smiles.*\n', scenario: 'A quiet harbour.', mes_example: '<START>\n{{user}}: Hello\n{{char}}: Welcome.', creator: 'Author', alternate_greetings: [], tags: ['fantasy', 'adventure', 'original'], library_scope: 'mine', extensions: { alternate_character_name: 'Captain Mira' } });
  expect(createdIds).toEqual(['native card/id']); expect(control('name').closest('fieldset')?.disabled).toBe(true); expect(button('Create Character').hidden).toBe(true);
  submit(); await settle(); expect(requests).toHaveLength(1);
  button('View character').click(); expect(opened).toEqual([{ id: 'native card/id', connected: false }]);
});

test('required fields validate before any permission check or native write', async () => {
  submit(); await settle(); expect(control('name').getAttribute('aria-invalid')).toBe('true');
  control('name').value = 'Mira'; submit(); await settle(); expect(control('description').getAttribute('aria-invalid')).toBe('true');
  control('description').value = 'Explorer'; control('first_mes').value = '   '; submit(); await settle(); expect(control('first_mes').getAttribute('aria-invalid')).toBe('true');
  expect(checks).toBe(0); expect(requests).toHaveLength(0); expect(permissionRequests).toEqual([]);
});

test('an optional song accepts embed code, saves only its track, and never starts playback', async () => {
  draft(); control('soundcloud_track').value = '<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123&amp;auto_play=true"></iframe>';
  submit(); await settle();
  expect(JSON.parse(String(requests[0].init.body)).extensions).toEqual({ janiverse: { soundcloud_track_id: 'https://api.soundcloud.com/tracks/123' } });
  expect(root().querySelector('iframe,script')).toBeNull(); expect(requests).toHaveLength(1);
});

test('invalid optional songs reveal the attachment field before permissions or character creation', async () => {
  draft(); control('soundcloud_track').value = 'https://soundcloud.com/artist/sets/playlist'; submit(); await settle();
  expect(control('soundcloud_track').getAttribute('aria-invalid')).toBe('true'); expect(control('soundcloud_track').closest('details')?.open).toBe(true);
  expect(checks).toBe(0); expect(requests).toEqual([]);
});

test('only explicit Create can request Characters, denial preserves the draft, and enabling alone does not save', async () => {
  draft(); grants = []; permissionResult = async () => [];
  submit(); await settle(); expect(permissionRequests).toEqual([['characters']]); expect(requests).toHaveLength(0); expect(control('name').value).toBe('Mira'); expect(control('name').closest('fieldset')?.disabled).toBe(false);
  submit(); await settle(); expect(permissionRequests).toHaveLength(1);
  permissionResult = async () => ['characters']; button('Enable Characters permission').click(); await settle(); expect(permissionRequests).toHaveLength(2); expect(requests).toHaveLength(0);
  submit(); await settle(); expect(requests).toHaveLength(1); expect(createdIds).toHaveLength(1);
});

test('duplicate submission stays blocked while permissions or native creation are pending', async () => {
  draft(); grants = []; const permission = deferred<string[]>(); permissionResult = () => permission.promise;
  submit(); submit(); await settle(); expect(permissionRequests).toHaveLength(1); expect(requests).toHaveLength(0);
  const pending = deferred<Response>(); respond = () => pending.promise; permission.resolve(['characters']); await settle(); expect(requests).toHaveLength(1);
  submit(); submit(); await settle(); expect(requests).toHaveLength(1); expect(root().querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  pending.resolve(json({ id: 'only-once' })); await settle(); expect(createdIds).toEqual(['only-once']);
});

test('portrait uploads use the Characters avatar endpoint after native creation and use the original file', async () => {
  draft(); const file = picture(); choose(file); submit(); await settle(); expect(requests).toHaveLength(2);
  const upload = requests[1]; expect(upload.url).toBe('/api/v1/characters/native%20card%2Fid/avatar'); expect(upload.init.method).toBe('POST'); expect(upload.init.credentials).toBe('same-origin'); expect(upload.init.headers).toBeUndefined();
  const body = upload.init.body as FormData; expect([...body.keys()]).toEqual(['avatar']); const uploaded = body.get('avatar') as File; expect(uploaded.name).toBe(file.name); expect(uploaded.type).toBe(file.type); expect(await uploaded.text()).toBe(await file.text());
  expect(permissionRequests).toEqual([]); expect(checks).toBeGreaterThanOrEqual(3); expect(createdIds).toEqual(['native card/id']); expect(root().textContent).toContain('ready to chat');
});

test('portrait failure retries only the avatar of the already saved character', async () => {
  draft(); choose(picture()); let fail = true; respond = async url => url.endsWith('/avatar') && fail ? json({ error: 'Image failure' }, 500) : json({ id: 'saved' });
  submit(); await settle(); expect(requests).toHaveLength(2); expect(root().textContent).toContain('Character created. The portrait could not be saved'); expect(createdIds).toEqual(['saved']);
  submit(); await settle(); expect(requests).toHaveLength(2); fail = false; button('Retry portrait').click(); await settle();
  expect(requests.map(item => item.url)).toEqual(['/api/v1/characters', '/api/v1/characters/saved/avatar', '/api/v1/characters/saved/avatar']); expect(createdIds).toEqual(['saved']); expect(button('Retry portrait').hidden).toBe(true);
});

test('revocation before the native write stops Create and revocation after it prevents the portrait write', async () => {
  draft(); ctx.permissions.getGranted = async () => { checks++; return checks === 1 ? ['characters'] : []; };
  submit(); await settle(); expect(requests).toHaveLength(0); expect(control('name').closest('fieldset')?.disabled).toBe(false);
  checks = 0; ctx.permissions.getGranted = async () => [...grants]; choose(picture()); respond = async () => { grants = []; return json({ id: 'saved-without-image' }); };
  submit(); await settle(); expect(requests).toHaveLength(1); expect(createdIds).toEqual(['saved-without-image']); expect(root().textContent).toContain('Your character is saved'); expect(button('Retry portrait').hidden).toBe(false);
});

test('unknown network or server outcomes block blind Create retry and offer library navigation', async () => {
  draft(); respond = async () => { throw new TypeError('network interrupted'); }; submit(); await settle(); expect(requests).toHaveLength(1); expect(root().textContent).toContain('Check your library'); expect(button('Create Character').disabled).toBe(true);
  submit(); await settle(); expect(requests).toHaveLength(1); expect(createdIds).toEqual([]); button('Open character library').click(); await settle(); expect(navigated).toBe(1); expect(root().isConnected).toBe(false);
  creator.open(); draft(); respond = async () => json({ error: 'unknown server error' }, 500); submit(); await settle(); expect(requests).toHaveLength(2); expect(button('Create Character').disabled).toBe(true);
});

test('malformed success response is unconfirmed, while explicit validation rejection permits editing and retry', async () => {
  draft(); respond = async () => json({ error: 'invalid input' }, 400); submit(); await settle(); expect(button('Create Character').disabled).toBe(false); expect(control('name').value).toBe('Mira');
  respond = async () => json({ name: 'missing native id' }); submit(); await settle(); expect(requests).toHaveLength(2); expect(button('Create Character').disabled).toBe(true); expect(createdIds).toEqual([]);
});

test('closing during permission approval prevents all writes and closing a pending creation aborts and ignores late result', async () => {
  draft(); grants = []; const approval = deferred<string[]>(); permissionResult = () => approval.promise; submit(); await settle(); button('Cancel').click(); approval.resolve(['characters']); await settle(); expect(requests).toHaveLength(0);
  creator.open(); draft(); choose(picture()); const pending = deferred<Response>(); respond = () => pending.promise; submit(); await settle(); expect(requests).toHaveLength(1); const signal = requests[0].init.signal!;
  button('Cancel').click(); expect(signal.aborted).toBe(true); pending.resolve(json({ id: 'late-result' })); await settle(); expect(requests).toHaveLength(1); expect(createdIds).toEqual([]); expect(revoked).toContain('blob:portrait-1');
});

test('destroy during portrait upload aborts it, clears preview, and ignores late callbacks', async () => {
  draft(); choose(picture()); const upload = deferred<Response>(); respond = async url => url.endsWith('/avatar') ? upload.promise : json({ id: 'created-before-close' });
  submit(); await settle(); expect(requests).toHaveLength(2); creator.destroy(); expect(requests[1].init.signal?.aborted).toBe(true); upload.resolve(json({ id: 'created-before-close' })); await settle();
  expect(createdIds).toEqual([]); expect(revoked).toEqual(['blob:portrait-1']); const count = roots.length; creator.open(); expect(roots).toHaveLength(count);
});

test('portrait validation is local and object URLs are revoked on replacement, removal and reopening', () => {
  choose(picture('unsafe.svg', 'image/svg+xml')); expect(previewCount).toBe(0); expect(root().textContent).toContain('Choose a PNG');
  choose(picture('empty.png', 'image/png', '')); expect(previewCount).toBe(0);
  choose(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })); expect(previewCount).toBe(0);
  choose(picture()); choose(picture('two.webp', 'image/webp')); expect(revoked).toEqual(['blob:portrait-1']); button('Remove image').click(); expect(revoked).toEqual(['blob:portrait-1', 'blob:portrait-2']); expect(root().querySelector('img')?.hasAttribute('src')).toBe(false);
  choose(picture()); creator.open(); expect(revoked).toEqual(['blob:portrait-1', 'blob:portrait-2', 'blob:portrait-3']); expect(requests).toHaveLength(0); expect(checks).toBe(0);
});

test('portrait selection leaves multipart headroom below the native 10 MiB request limit', () => {
  choose(new File([new Uint8Array(10 * 1024 * 1024)], 'exact-limit.png', { type: 'image/png' }));
  expect(previewCount).toBe(0); expect(root().textContent).toContain('9.9 MiB');
  choose(new File([new Uint8Array(10 * 1024 * 1024 - 64 * 1024)], 'fits.png', { type: 'image/png' }));
  expect(previewCount).toBe(1); expect(requests).toHaveLength(0);
});

test('a server portrait limit preserves the created character and explains the recovery', async () => {
  draft(); choose(picture());
  respond = async url => url.endsWith('/avatar') ? json({}, 413) : json({ id: 'created' });
  submit(); await settle();
  expect(createdIds).toEqual(['created']);
  expect(root().textContent).toContain('server’s upload limit');
  expect(root().textContent).toContain('smaller picture');
  submit(); await settle(); expect(requests).toHaveLength(2);
});

test('refresh callback failure cannot turn a saved card into a retryable Create', async () => {
  creator.destroy(); creator = createCharacterCreate(ctx, { onCreated: () => { throw new Error('refresh failed'); } }); creator.open(); draft(); submit(); await settle();
  expect(requests).toHaveLength(1); expect(root().textContent).toContain('ready to chat'); expect(button('Create Character').hidden).toBe(true); submit(); await settle(); expect(requests).toHaveLength(1);
});

test('General and Definition navigation uses accessible local anchors and follows the original field order', () => {
  const nav = root().querySelector('nav[aria-label="Character creation sections"]')!;
  const general = [...nav.querySelectorAll('a')].find(item => item.textContent === 'General')!; const definition = [...nav.querySelectorAll('a')].find(item => item.textContent === 'Definition')!;
  expect(general.getAttribute('aria-current')).toBe('location'); definition.click(); expect(definition.getAttribute('aria-current')).toBe('location'); expect(general.hasAttribute('aria-current')).toBe(false); expect(document.activeElement?.textContent).toBe('Definition'); expect(dom.window.location.hash).toBe('');
  general.click(); expect(document.activeElement?.textContent).toBe('Create a character');
  expect([...root().querySelectorAll('.jb-character-fields input:not([type=file]), .jb-character-fields textarea')].map(item => item.getAttribute('name'))).toEqual(['name', 'chat_name', 'creator_notes', 'tags', 'soundcloud_track', 'description', 'scenario', 'first_mes', 'mes_example', 'creator']);
  expect(control('name').closest('label')?.textContent).toContain('Title'); expect(control('creator_notes').closest('label')?.textContent).toContain('Bio'); expect(control('scenario').closest('details')).toBeNull(); expect(control('mes_example').closest('details')).toBeNull();
  expect(requests).toHaveLength(0); expect(checks).toBe(0);
});

test('live card preview uses title, public Bio, tags and portrait with safe text, without saving', () => {
  const input = (name: string, value: string) => { control(name).value = value; control(name).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  input('name', '<img onerror=evil()>'); input('creator_notes', '<script>public hook</script>'); input('description', 'Private model definition'); input('tags', 'fantasy, fantasy, <b>tag</b>');
  const preview = root().querySelector('[aria-label="Character card preview"]')!; expect(preview.textContent).toContain('<script>public hook</script>'); expect(preview.textContent).not.toContain('Private model definition'); expect(preview.querySelector('script')).toBeNull(); expect(preview.querySelector('[onerror]')).toBeNull(); expect(preview.querySelectorAll('.jb-character-card-tags > span')).toHaveLength(2);
  choose(picture()); expect(preview.querySelector('img')?.getAttribute('src')).toBe('blob:portrait-1'); expect(requests).toHaveLength(0); expect(checks).toBe(0);
});

test('alternative initial-message tabs support keyboard navigation and save native alternate greetings once', async () => {
  draft(); button('+ Add another message').click(); const alternative = root().querySelector<HTMLTextAreaElement>('textarea[name^=alternate_greeting_]')!; alternative.value = '\nAn alternate {{char}} opening for {{user}}.\n';
  const tabs = [...root().querySelectorAll<HTMLButtonElement>('[role=tab]')]; expect(tabs).toHaveLength(2); expect(tabs[1].getAttribute('aria-selected')).toBe('true'); expect(control('first_mes').closest<HTMLElement>('[role=tabpanel]')?.hidden).toBe(true);
  tabs[1].focus(); tabs[1].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); expect(tabs[0].getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(tabs[0]);
  tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })); expect(document.activeElement).toBe(tabs[1]); expect(tabs[1].getAttribute('aria-controls')).toBe(alternative.closest('[role=tabpanel]')?.id);
  submit(); submit(); await settle(); expect(requests).toHaveLength(1); const saved = JSON.parse(String(requests[0].init.body)); expect(saved.first_mes).toBe('Welcome aboard, {{user}}.'); expect(saved.alternate_greetings).toEqual(['\nAn alternate {{char}} opening for {{user}}.\n']); expect(createdIds).toHaveLength(1);
});

test('empty alternatives validate before saving, can be removed, and never replace the default message', async () => {
  draft(); button('+ Add another message').click(); submit(); await settle(); expect(requests).toHaveLength(0); expect(checks).toBe(0); expect(root().textContent).toContain('Write this alternate initial message');
  button('Remove this message').click(); expect(root().querySelectorAll('[role=tab]')).toHaveLength(1); expect(control('first_mes').value).toBe('Welcome aboard, {{user}}.');
  submit(); await settle(); expect(requests).toHaveLength(1); expect(JSON.parse(String(requests[0].init.body)).alternate_greetings).toEqual([]);
});

test('the image drop area prepares one portrait locally and rejects multiple files', () => {
  const drop = (files: File[]) => { const event = new dom.window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { files } }); root().querySelector('.jb-character-portrait-preview')!.dispatchEvent(event); };
  drop([picture(), picture('two.png')]); expect(previewCount).toBe(0); expect(root().textContent).toContain('Choose one character picture'); drop([picture()]); expect(previewCount).toBe(1); expect(requests).toHaveLength(0); expect(checks).toBe(0);
});

test('a library shortcut that fails keeps the dialog open with a message instead of closing silently', async () => {
  ctx.host.surfaces.invoke = async () => { throw new Error('drawer unavailable'); };
  draft(); respond = async () => { throw new TypeError('network interrupted'); }; submit(); await settle();
  button('Open character library').click(); await settle(); expect(root().isConnected).toBe(true); expect(root().textContent).toContain('Could not open the character library');
});
