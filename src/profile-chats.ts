import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { uuid } from './uuid';

type Chat = { id: string; name?: string; last_message_preview?: string; updated_at?: number; created_at?: number; message_count?: number; metadata?: Record<string, unknown> };
const PAGE_SIZE = 8;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const plain = (value: unknown) => text(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', value = '') { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; }
function button(value: string, action: () => void, cls = 'jb-button') { const node = el('button', cls, value); node.type = 'button'; node.addEventListener('click', action); return node; }

/** Reading history is lazy. Only picking a row navigates to an existing chat. */
export function mountProfileChats(ctx: SpindleFrontendContext, root: HTMLElement, characterId: string, options: { openChat(id: string): Promise<boolean> }) {
  let disposed = false, opened = false, loading = false, navigating = false, request = 0, offset = 0;
  let rows: Chat[] = [], abort: AbortController | undefined;
  const toggle = button('Continue old chat', () => { if (!disposed && !navigating) { opened = !opened; toggle.setAttribute('aria-expanded', String(opened)); panel.hidden = !opened; if (opened) void load(); else { request++; abort?.abort(); } } }, 'jb-button jb-profile-continue');
  const panel = el('section', 'jb-profile-chat-picker'); panel.id = `jb-profile-chats-${uuid()}`; panel.hidden = true; panel.setAttribute('aria-label', 'Choose an old chat');
  toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-expanded', 'false');
  const heading = el('h3', '', 'Choose an old chat');
  const tools = el('div', 'jb-profile-reader-tools');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Search your chats…'; search.maxLength = 256; search.setAttribute('aria-label', 'Search old chats');
  const sort = el('select'); sort.setAttribute('aria-label', 'Sort old chats');
  for (const [value, label] of [['latest', 'Latest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z']]) { const option = el('option', '', label); option.value = value; sort.append(option); }
  tools.append(search, sort);
  const status = el('p', 'jb-status'); status.setAttribute('role', 'status');
  const list = el('div', 'jb-profile-chat-list');
  const paging = el('div', 'jb-profile-reader-paging');
  const previous = button('Previous chats', () => { offset = Math.max(0, offset - PAGE_SIZE); render(); });
  const next = button('Next chats', () => { offset += PAGE_SIZE; render(); });
  const page = el('span'); paging.append(previous, page, next);
  const retry = button('Retry chats', () => { void load(); }); retry.hidden = true;
  panel.append(heading, tools, status, retry, list, paging); root.append(toggle, panel);
  const current = (generation: number) => !disposed && opened && generation === request;
  function render() {
    if (disposed || !opened) return;
    const query = search.value.trim().toLocaleLowerCase();
    const matches = rows.filter(row => `${text(row.name)} ${plain(row.last_message_preview)}`.toLocaleLowerCase().includes(query));
    matches.sort((a, b) => sort.value === 'name' ? text(a.name).localeCompare(text(b.name)) : (sort.value === 'oldest' ? 1 : -1) * (timestamp(a.updated_at) - timestamp(b.updated_at)) || a.id.localeCompare(b.id));
    if (offset >= matches.length) offset = Math.max(0, Math.floor((matches.length - 1) / PAGE_SIZE) * PAGE_SIZE);
    list.replaceChildren();
    status.textContent = matches.length ? '' : rows.length ? 'No chats match your search.' : 'No old chats for this saved card yet.';
    for (const row of matches.slice(offset, offset + PAGE_SIZE)) {
      const item = button('', () => { void resume(row.id); }, 'jb-profile-chat-row'); item.setAttribute('aria-label', `Continue ${text(row.name) || 'Untitled chat'}`);
      item.append(el('strong', '', text(row.name) || 'Untitled chat'), el('p', '', plain(row.last_message_preview).slice(0, 240) || 'No messages yet.'));
      const meta = el('small'); const date = new Date(timestamp(row.updated_at) * 1000);
      const count = typeof row.message_count === 'number' && Number.isFinite(row.message_count) ? Math.max(0, Math.floor(row.message_count)) : undefined;
      meta.textContent = [timestamp(row.updated_at) && Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '', count === undefined ? '' : `${count} ${count === 1 ? 'message' : 'messages'}`].filter(Boolean).join(' · ');
      item.append(meta); item.disabled = navigating; list.append(item);
    }
    tools.hidden = !rows.length; paging.hidden = matches.length <= PAGE_SIZE;
    previous.disabled = navigating || offset === 0; next.disabled = navigating || offset + PAGE_SIZE >= matches.length;
    page.textContent = `${Math.floor(offset / PAGE_SIZE) + 1} / ${Math.max(1, Math.ceil(matches.length / PAGE_SIZE))}`;
  }
  async function load() {
    if (disposed || !opened || navigating) return;
    const generation = ++request; abort?.abort(); abort = new AbortController(); loading = true;
    status.textContent = 'Loading your old chats…'; retry.hidden = true; tools.hidden = true; paging.hidden = true; list.replaceChildren();
    try {
      const runtime = ctx.chats as typeof ctx.chats & { listForCharacter?(id: string): Promise<Chat[]> };
      let value: unknown;
      if (runtime?.listForCharacter) value = await runtime.listForCharacter(characterId);
      else { const response = await fetch(`/api/v1/chats/character-chats/${encodeURIComponent(characterId)}`, { credentials: 'same-origin', signal: abort.signal }); if (!response.ok) throw new Error('read'); value = await response.json(); }
      if (!current(generation)) return;
      if (!Array.isArray(value)) throw new Error('Invalid chats');
      const unique = new Map<string, Chat>();
      for (const row of value) if (row && typeof row === 'object' && typeof row.id === 'string' && row.id && row.metadata?.group !== true && row.metadata?.temporary !== true) unique.set(row.id, row);
      rows = [...unique.values()]; offset = 0; render();
    } catch { if (current(generation)) { status.textContent = 'Could not load your old chats. Try again.'; retry.hidden = false; } }
    finally { if (current(generation)) loading = false; }
  }
  async function resume(id: string) {
    if (disposed || !opened || loading || navigating || !rows.some(row => row.id === id)) return;
    navigating = true; search.disabled = sort.disabled = true; render(); status.textContent = 'Opening chat…'; const generation = request;
    try { const ok = await options.openChat(id); if (current(generation) && !ok) status.textContent = 'Could not open this chat. Please try again.'; }
    catch { if (current(generation)) status.textContent = 'Could not open this chat. Please try again.'; }
    finally { if (current(generation)) { navigating = false; search.disabled = sort.disabled = false; const message = status.textContent; render(); status.textContent = message === 'Opening chat…' ? 'Chat opened.' : message; } }
  }
  search.addEventListener('input', () => { offset = 0; render(); }); sort.addEventListener('change', () => { offset = 0; render(); });
  return () => { disposed = true; request++; abort?.abort(); root.replaceChildren(); };
}
