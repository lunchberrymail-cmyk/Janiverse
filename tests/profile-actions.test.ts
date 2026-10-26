import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { mountProfileChats } from '../src/profile-chats';
import { linkedLorebookIds, mountProfileLorebooks } from '../src/profile-lorebooks';

const flush = () => new Promise(resolve => setTimeout(resolve, 6));
let dom: JSDOM, root: HTMLElement, cleanup: (() => void) | undefined, savedDocument: any, savedFetch: any;
let requests: { url: URL; init: RequestInit }[], result: (url: URL, init: RequestInit) => Promise<any>;
const response = (value: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
const book = (id = 'book-1') => ({ id, name: 'Voltara', description: '<b>A world of stories.</b>', updated_at: 100 });
const entry = (id: number) => ({ id: `entry-${id}`, comment: `Entry ${id}`, content: `<script>Inert content ${id}</script>`, enabled: true });
const chats = Array.from({ length: 10 }, (_, index) => ({ id: `chat-${index}`, name: `Story ${index}`, last_message_preview: '<b>Saved scene</b><img src=x onerror=bad()>', updated_at: 100 + index, message_count: index }));
beforeEach(() => {
  savedDocument = globalThis.document; savedFetch = globalThis.fetch;
  dom = new JSDOM('<!doctype html><body><main></main>', { url: 'http://localhost:7860/' }); globalThis.document = dom.window.document; root = document.querySelector('main')!; requests = [];
  result = async url => response(url.pathname.endsWith('/entries') ? { data: [entry(1)], total: 1 } : book(decodeURIComponent(url.pathname.split('/').at(-1)!)));
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => { const url = new URL(String(input), 'http://localhost:7860'); requests.push({ url, init }); return result(url, init); }) as any;
});
afterEach(() => { cleanup?.(); cleanup = undefined; dom.window.close(); globalThis.document = savedDocument; globalThis.fetch = savedFetch; });
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!;

test('only explicit native lorebook attachments are read, with canonical-array precedence and deduplication', async () => {
  expect(linkedLorebookIds({ world_book_ids: ['book-1', '', null, 'book-1', 'book/2'], world_book_id: 'ignored', jar_bridge: { book_id: 'external' } })).toEqual(['book-1', 'book/2']);
  expect(linkedLorebookIds({ world_book_ids: [], world_book_id: 'ignored' })).toEqual([]);
  expect(linkedLorebookIds({ world_book_id: 'legacy' })).toEqual(['legacy']);
  cleanup = mountProfileLorebooks(root, { world_book_ids: ['book-1', 'book/2', 'book-1'] }); await flush();
  expect(requests.map(item => item.url.pathname)).toEqual(['/api/v1/world-books/book-1', '/api/v1/world-books/book%2F2']);
  expect(root.querySelectorAll('.jb-profile-book')).toHaveLength(2); expect(root.textContent).toContain('A world of stories.'); expect(root.querySelector('b')).toBeNull();
  expect(requests.every(item => item.init.credentials === 'same-origin' && !item.init.method)).toBe(true);
  expect(root.querySelector('.jb-profile-book-entries')!.childNodes).toHaveLength(0);
});

test('missing attachments show an honest empty state without scanning the library', () => {
  cleanup = mountProfileLorebooks(root, { jar_bridge: { lorebook_url: 'https://example.com/book' } });
  expect(root.textContent).toContain('No lorebooks attached'); expect(requests).toHaveLength(0);
});

test('reading a linked book loads paginated entries lazily and treats entry content as inert text', async () => {
  result = async url => response(url.pathname.endsWith('/entries') ? { data: [entry(Number(url.searchParams.get('offset')) + 1)], total: 21 } : book());
  cleanup = mountProfileLorebooks(root, { world_book_id: 'book-1' }); await flush();
  button('Read lorebook Voltara').click(); await flush();
  expect(requests[1].url.searchParams.get('limit')).toBe('20'); expect(requests[1].url.searchParams.get('offset')).toBe('0');
  expect(root.querySelector('.jb-profile-book-entry')!.textContent).toContain('<script>Inert content 1</script>'); expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('.jb-profile-book-meta')!.textContent).toContain('21 entries');
  button('Next entries').click(); await flush(); expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('20'); expect(root.textContent).toContain('Entry 21');
  button('Previous entries').click(); await flush(); expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0');
  const search = root.querySelector<HTMLInputElement>('input')!; search.value = 'castle & queen'; root.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); await flush();
  expect(requests.at(-1)!.url.searchParams.get('search')).toBe('castle & queen'); expect(requests.at(-1)!.url.searchParams.get('offset')).toBe('0');
  expect(requests.every(item => !item.init.method)).toBe(true);
});

test('one unavailable book does not hide another attachment and both metadata and entry failures can retry', async () => {
  let failBook = true, failEntries = true;
  result = async url => url.pathname.endsWith('/entries') ? failEntries ? response({}, 503) : response({ data: [], total: 0 }) : url.pathname.endsWith('bad') && failBook ? response({}, 404) : response(book(url.pathname.split('/').at(-1)!));
  cleanup = mountProfileLorebooks(root, { world_book_ids: ['bad', 'good'] }); await flush();
  expect(root.textContent).toContain('Lorebook unavailable'); expect(root.querySelectorAll('.jb-profile-book:not(:disabled)')).toHaveLength(1);
  failBook = false; button('Retry lorebook').click(); await flush(); expect(root.querySelectorAll('.jb-profile-book:not(:disabled)')).toHaveLength(2);
  root.querySelector<HTMLButtonElement>('.jb-profile-book')!.click(); await flush(); expect(root.textContent).toContain('Could not load these entries');
  failEntries = false; button('Retry entries').click(); await flush(); expect(root.textContent).toContain('This lorebook has no entries.');
});

test('closing a book ignores a late entry response and disposal aborts all active reads', async () => {
  let finish!: (value: unknown) => void;
  result = async url => url.pathname.endsWith('/entries') ? new Promise(resolve => { finish = resolve; }) : response(book());
  cleanup = mountProfileLorebooks(root, { world_book_id: 'book-1' }); await flush();
  const card = button('Read lorebook Voltara'); card.click(); await flush(); const entrySignal = requests.at(-1)!.init.signal;
  card.click(); finish(response({ data: [entry(1)], total: 1 })); await flush();
  expect(entrySignal!.aborted).toBe(true); expect(root.querySelector('.jb-profile-book-entries')!.childNodes).toHaveLength(0);
  cleanup(); expect(requests[0].init.signal!.aborted).toBe(true); expect(root.childNodes).toHaveLength(0);
});

test('mismatched lorebooks and entries never expose another book and disposed retries cannot issue reads', async () => {
  result = async () => response({ ...book('wrong'), description: 'Other book description' });
  cleanup = mountProfileLorebooks(root, { world_book_id: 'book-1' }); await flush();
  expect(root.textContent).not.toContain('Other book description'); expect(root.textContent).toContain('Lorebook unavailable');
  result = async url => response(url.pathname.endsWith('/entries') ? { data: [{ ...entry(1), world_book_id: 'wrong' }], total: 1 } : book());
  button('Retry lorebook').click(); await flush(); button('Read lorebook Voltara').click(); await flush();
  expect(root.querySelector('.jb-profile-book-entries')!.textContent).toBe(''); expect(root.textContent).toContain('Could not load these entries');
  const retry = button('Retry entries'); const before = requests.length; cleanup(); retry.dispatchEvent(new dom.window.Event('click')); await flush(); expect(requests).toHaveLength(before);
});

test('old chats load only after Continue old chat and choosing a row resumes its exact native id', async () => {
  const reads: string[] = [], opened: string[] = [];
  cleanup = mountProfileChats({ chats: { listForCharacter: async (id: string) => { reads.push(id); return chats; } } } as any, root, 'card-exact', { openChat: async id => { opened.push(id); return true; } });
  expect(reads).toHaveLength(0); expect(opened).toHaveLength(0);
  button('Continue old chat').click(); await flush(); expect(reads).toEqual(['card-exact']); expect(root.querySelectorAll('.jb-profile-chat-row')).toHaveLength(8);
  expect(root.querySelector('.jb-profile-chat-row strong')!.textContent).toBe('Story 9'); expect(root.querySelector('img')).toBeNull();
  button('Continue Story 9').click(); await flush(); expect(opened).toEqual(['chat-9']); expect(requests).toHaveLength(0);
});

test('old chat search, sorting and pagination stay within the selected character summaries', async () => {
  let reads = 0;
  cleanup = mountProfileChats({ chats: { listForCharacter: async () => { reads++; return [...chats, chats[0], { id: 'group', metadata: { group: true } }, { id: 'temporary', metadata: { temporary: true } }]; } } } as any, root, 'card', { openChat: async () => true });
  button('Continue old chat').click(); await flush(); button('Next chats').click(); expect(root.querySelectorAll('.jb-profile-chat-row')).toHaveLength(2);
  const search = root.querySelector<HTMLInputElement>('input')!; search.value = 'story 2'; search.dispatchEvent(new dom.window.Event('input'));
  expect(root.querySelectorAll('.jb-profile-chat-row')).toHaveLength(1); expect(root.querySelector('.jb-profile-chat-row strong')!.textContent).toBe('Story 2');
  search.value = ''; search.dispatchEvent(new dom.window.Event('input')); const sort = root.querySelector<HTMLSelectElement>('select')!; sort.value = 'oldest'; sort.dispatchEvent(new dom.window.Event('change'));
  expect(root.querySelector('.jb-profile-chat-row strong')!.textContent).toBe('Story 0'); expect(reads).toBe(1);
});

test('history errors retry, empty lists stay explicit, and closing ignores a pending response', async () => {
  let reject = true; let finish!: (value: unknown) => void;
  const ctx = { chats: { listForCharacter: async () => { if (reject) throw new Error('Unavailable'); return new Promise(resolve => { finish = resolve; }); } } };
  cleanup = mountProfileChats(ctx as any, root, 'card', { openChat: async () => true });
  button('Continue old chat').click(); await flush(); expect(root.textContent).toContain('Could not load your old chats');
  reject = false; button('Retry chats').click(); await flush(); button('Continue old chat').click(); finish(chats); await flush(); expect(root.querySelectorAll('.jb-profile-chat-row')).toHaveLength(0);
  button('Continue old chat').click(); await flush(); finish([]); await flush(); expect(root.textContent).toContain('No old chats for this saved card yet.');
  cleanup(); expect(root.childNodes).toHaveLength(0);
});

test('history fallback uses an authenticated character-scoped read and failed navigation can be retried', async () => {
  result = async () => response(chats); let calls = 0; let finish!: (ok: boolean) => void;
  cleanup = mountProfileChats({ chats: {} } as any, root, 'card / one', { openChat: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  button('Continue old chat').click(); await flush(); expect(requests[0].url.pathname).toBe('/api/v1/chats/character-chats/card%20%2F%20one'); expect(requests[0].init.credentials).toBe('same-origin');
  const row = button('Continue Story 9'); row.click(); row.click(); await flush(); expect(calls).toBe(1); finish(false); await flush();
  expect(root.textContent).toContain('Could not open this chat'); expect(row.disabled).toBe(false);
  row.click(); await flush(); expect(calls).toBe(2); cleanup(); finish(true); await flush(); expect(root.childNodes).toHaveLength(0);
});
