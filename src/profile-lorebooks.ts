import { uuid } from './uuid';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const plain = (value: unknown) => text(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', value = '') { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; }
function button(value: string, action: () => void, cls = 'jb-button') { const node = el('button', cls, value); node.type = 'button'; node.addEventListener('click', action); return node; }

/** Follow Lumiverse's authoritative attachments, including its legacy single-book field. */
export function linkedLorebookIds(extensions: unknown): string[] {
  const ext = record(extensions);
  const ids = Array.isArray(ext.world_book_ids) ? ext.world_book_ids : [ext.world_book_id];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id.trim()))];
}

/** An attached-book reader; all requests are authenticated reads and stay local. */
export function mountProfileLorebooks(root: HTMLElement, extensions: unknown) {
  let disposed = false; const abort = new AbortController(); const cleanups: Array<() => void> = [];
  root.setAttribute('aria-label', 'Attached lorebooks');
  root.append(el('h2', 'jb-profile-definition-title', 'Attached lorebooks'));
  const ids = linkedLorebookIds(extensions);
  if (!ids.length) root.append(el('p', 'jb-profile-definition-help', 'No lorebooks attached to this saved card.'));
  async function get(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('Read failed'); return response.json();
  }
  for (const id of ids) {
    const block = el('div', 'jb-profile-book-block'); root.append(block);
    const card = button('', () => { if (disposed || !book) return; opened = !opened; card.setAttribute('aria-expanded', String(opened)); reader.hidden = !opened; if (opened) { offset = 0; void loadEntries(); } else { generation++; entryAbort?.abort(); } }, 'jb-profile-book');
    card.disabled = true; card.setAttribute('aria-expanded', 'false');
    const title = el('strong', '', 'Loading lorebook…'); const badge = el('span', 'jb-profile-book-badge', 'Lorebook');
    const top = el('span', 'jb-profile-book-heading'); top.append(title, badge);
    const description = el('span', 'jb-profile-book-description'); const meta = el('span', 'jb-profile-book-meta');
    card.append(top, description, meta);
    const status = el('p', 'jb-status'); status.setAttribute('role', 'status');
    const retryBook = button('Retry lorebook', () => { void loadBook(); }); retryBook.hidden = true;
    const reader = el('section', 'jb-profile-book-reader'); reader.id = `jb-profile-book-${uuid()}`; reader.hidden = true; card.setAttribute('aria-controls', reader.id);
    const tools = el('form', 'jb-profile-reader-tools');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Search entries…'; search.maxLength = 256; search.setAttribute('aria-label', 'Search lorebook entries');
    const submit = el('button', 'jb-button', 'Search'); submit.type = 'submit'; tools.append(search, submit);
    const entryStatus = el('p', 'jb-status'); entryStatus.setAttribute('role', 'status');
    const retryEntries = button('Retry entries', () => { void loadEntries(); }); retryEntries.hidden = true;
    const entries = el('div', 'jb-profile-book-entries');
    const paging = el('div', 'jb-profile-reader-paging');
    const previous = button('Previous entries', () => { offset = Math.max(0, offset - 20); void loadEntries(); });
    const next = button('Next entries', () => { offset += 20; void loadEntries(); });
    const page = el('span'); paging.append(previous, page, next);
    reader.append(tools, entryStatus, retryEntries, entries, paging); block.append(card, status, retryBook, reader);
    let book: Record<string, unknown> | undefined, opened = false, offset = 0, generation = 0, entryAbort: AbortController | undefined;
    const current = (version: number) => !disposed && opened && generation === version;
    function bookMeta(count?: number) {
      const updated = book?.updated_at; const date = typeof updated === 'number' && Number.isFinite(updated) && updated > 0 ? new Date(updated * 1000) : null;
      meta.textContent = [date && Number.isFinite(date.getTime()) ? `Updated ${date.toLocaleDateString(undefined, { dateStyle: 'medium' })}` : '', count === undefined ? 'Read entries →' : `${count} ${count === 1 ? 'entry' : 'entries'} · Read entries →`].filter(Boolean).join(' · ');
    }
    async function loadBook() {
      if (disposed) return;
      card.disabled = true; retryBook.hidden = true; status.textContent = '';
      try {
        const value = record(await get(`/world-books/${encodeURIComponent(id)}`, abort.signal));
        if (disposed) return;
        if (value.id !== id || !text(value.name)) throw new Error('Wrong book');
        book = value; title.textContent = text(value.name); description.textContent = plain(value.description).slice(0, 220) || 'Attached to this character';
        card.setAttribute('aria-label', `Read lorebook ${text(value.name)}`); reader.setAttribute('aria-label', `Entries in ${text(value.name)}`); search.setAttribute('aria-label', `Search entries in ${text(value.name)}`); bookMeta(); card.disabled = false;
      } catch { if (!disposed) { title.textContent = 'Lorebook unavailable'; description.textContent = 'This saved attachment could not be read.'; retryBook.hidden = false; } }
    }
    async function loadEntries() {
      if (disposed || !opened) return;
      const version = ++generation; entryAbort?.abort(); entryAbort = new AbortController();
      entries.replaceChildren(); entryStatus.textContent = 'Loading entries…'; retryEntries.hidden = true; paging.hidden = true;
      previous.disabled = true; next.disabled = true;
      try {
        const params = new URLSearchParams({ limit: '20', offset: String(offset), sort_by: 'order', sort_dir: 'asc' });
        if (search.value.trim()) params.set('search', search.value.trim());
        const value = record(await get(`/world-books/${encodeURIComponent(id)}/entries?${params}`, entryAbort.signal));
        if (!current(version)) return;
        if (!Array.isArray(value.data) || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0) throw new Error('Invalid entries');
        if (value.total > 0 && offset >= value.total) { offset = Math.floor((value.total - 1) / 20) * 20; void loadEntries(); return; }
        for (const item of value.data) {
          const entry = record(item); if (typeof entry.id !== 'string' || typeof entry.world_book_id === 'string' && entry.world_book_id !== id) throw new Error('Invalid entry');
          const field = el('details', 'jb-profile-book-entry'); const heading = el('summary', '', text(entry.comment).trim() || (Array.isArray(entry.key) ? entry.key.filter(key => typeof key === 'string').join(', ') : '') || `Entry ${text(entry.uid) || entry.id}`);
          if (entry.enabled === false) heading.append(el('small', '', ' · Disabled'));
          field.append(heading, el('p', '', text(entry.content) || 'No content.')); entries.append(field);
        }
        const total = value.total;
        entryStatus.textContent = total ? '' : search.value.trim() ? 'No entries match your search.' : 'This lorebook has no entries.';
        if (!search.value.trim()) bookMeta(total);
        page.textContent = total ? `${offset + 1}–${Math.min(offset + value.data.length, total)} of ${total}` : '0 entries';
        previous.disabled = offset === 0; next.disabled = offset + 20 >= total; paging.hidden = total <= 20;
      } catch { if (current(version)) { entries.replaceChildren(); entryStatus.textContent = 'Could not load these entries. Try again.'; retryEntries.hidden = false; } }
    }
    tools.addEventListener('submit', event => { event.preventDefault(); if (disposed || !opened) return; offset = 0; void loadEntries(); });
    cleanups.push(() => { generation++; entryAbort?.abort(); });
    void loadBook();
  }
  return () => { disposed = true; abort.abort(); cleanups.forEach(cleanup => cleanup()); root.replaceChildren(); };
}
