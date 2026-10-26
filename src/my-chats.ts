import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleGroupedRecentChat, SpindleRecentChat, SpindleRecentChatsQuery } from 'lumiverse-spindle-types';
import { icon } from './icons';

type Summary = { id: string; name: string; message_count: number; created_at: number; updated_at: number; last_message_preview: string; metadata?: Record<string, unknown> };
type Page<T> = { data: T[]; total: number };
export interface MyChatsOptions {
  invoke(ref: SpindleHostSurfaceRef, params?: Record<string, string>): Promise<boolean>;
  openCharacter(id: string): void;
  startChat(characterId: string): void | Promise<boolean>;
}
const PAGE_SIZE = 12;
const MAX_PROFILE_CHARS = 100_000;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function button(text: string, action: () => void, cls = 'jb-button') {
  const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function plain(value: unknown): string { return text(value).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function count(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
function dateValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : 0; }
function dateLabel(value: unknown): string {
  const timestamp = dateValue(value); if (!timestamp) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) { const minutes = Math.floor(seconds / 60); return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`; }
  if (seconds < 86400) { const hours = Math.floor(seconds / 3600); return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function dateGroup(value: unknown): string {
  const timestamp = dateValue(value); if (!timestamp) return 'Older';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  return timestamp >= today.getTime() ? 'Today' : timestamp >= yesterday.getTime() ? 'Yesterday' : 'Older';
}
function select(label: string) {
  const node = el('select', 'jb-mc-sort'); node.setAttribute('aria-label', label);
  for (const [value, labelText] of [['latest', 'Latest'], ['oldest', 'Oldest'], ['name', 'Name A–Z']]) {
    const option = el('option', '', labelText); option.value = value; node.append(option);
  }
  return node;
}
function avatar(characterId: string, imageId: unknown, name: string, cls: string) {
  const wrapper = el('span', cls); wrapper.setAttribute('aria-hidden', 'true');
  wrapper.append(el('span', 'jb-mc-avatar-fallback', name.slice(0, 1).toUpperCase() || '?'));
  if (!characterId) return wrapper;
  const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  img.src = text(imageId) ? `/api/v1/images/${encodeURIComponent(text(imageId))}?size=sm` : `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=sm`;
  img.addEventListener('error', () => img.remove()); wrapper.append(img); return wrapper;
}
function safeUrl(value: string, image: boolean): string | null {
  try {
    if (!value.trim()) return null;
    const parsed = new URL(value, location.origin); if (parsed.username || parsed.password) return null;
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    if (image && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  } catch { /* Invalid profile resource. */ }
  return null;
}

/** Build inert, local formatting before the host sanitizes the final injection. */
export function profileMarkup(source: string): string {
  const holder = el('div');
  source = source.slice(0, MAX_PROFILE_CHARS);
  let nodes = 0, images = 0;
  const allowed = new Set(['P', 'DIV', 'SPAN', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'BLOCKQUOTE', 'PRE', 'CODE', 'UL', 'OL', 'LI', 'A', 'IMG', 'DETAILS', 'SUMMARY', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TH', 'TD']);
  const discarded = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH']);
  function copy(node: Node, parent: Node, depth = 0) {
    if (++nodes > 4000 || depth > 24) return;
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent || '')); return; }
    if (node.nodeType !== 1) return;
    const original = node as Element;
    if (discarded.has(original.tagName)) return;
    if (!allowed.has(original.tagName)) { original.childNodes.forEach(child => copy(child, parent, depth + 1)); return; }
    const target = document.createElement(original.tagName.toLowerCase());
    if (original.tagName === 'IMG') {
      if (++images > 24) return;
      const src = safeUrl(original.getAttribute('src') || '', true); if (!src) return;
      target.setAttribute('src', src); target.setAttribute('alt', original.getAttribute('alt') || '');
      target.setAttribute('loading', 'lazy'); target.setAttribute('referrerpolicy', 'no-referrer');
    }
    if (original.tagName === 'A') {
      const href = safeUrl(original.getAttribute('href') || '', false);
      if (href) { target.setAttribute('href', href); target.setAttribute('target', '_blank'); target.setAttribute('rel', 'noopener noreferrer'); }
    }
    original.childNodes.forEach(child => copy(child, target, depth + 1)); parent.appendChild(target);
  }
  if (/<\/?[a-z][\s\S]*?>/i.test(source)) {
    const parsed = new DOMParser().parseFromString(source, 'text/html'); parsed.body.childNodes.forEach(node => copy(node, holder));
  } else {
    // Keep common card Markdown readable, including its public illustration links.
    for (const paragraph of source.split(/\n\s*\n/)) {
      const p = el('p'); const tokens = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;
      let cursor = 0;
      for (let match = tokens.exec(paragraph); match; match = tokens.exec(paragraph)) {
        p.append(document.createTextNode(paragraph.slice(cursor, match.index)));
        if (match[2]) {
          const src = safeUrl(match[2], true); if (src && ++images <= 24) { const img = el('img'); img.src = src; img.alt = match[1] || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; p.append(img); }
        } else if (match[4]) {
          const href = safeUrl(match[4], false); if (href) { const a = el('a', '', match[3]); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); } else p.append(match[3]);
        } else p.append(el('strong', '', match[5]));
        cursor = tokens.lastIndex;
      }
      p.append(document.createTextNode(paragraph.slice(cursor))); holder.append(p);
    }
  }
  return holder.innerHTML;
}

/** A read-only conversation browser. Opening a row never creates or changes a chat. */
export function createMyChats(ctx: SpindleFrontendContext, options: MyChatsOptions) {
  let disposed = false, active = false, offset = 0, query = '', request = 0, detailRequest = 0;
  let groupedTotal = 0, chatTotal = 0, hasGroups = false, expanded = '';
  let searchTimer: ReturnType<typeof setTimeout> | undefined, refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pageAbort: AbortController | undefined, detailAbort: AbortController | undefined;
  let profileInjection: Element | undefined;
  let profileCleanup: (() => void) | undefined;
  const personaNames = new Map<string, string>();
  const cleanups: Array<() => void> = [];
  const root = el('section', 'jb-my-chats'); root.hidden = true; root.setAttribute('aria-label', 'My Chats');
  const sidebar = el('aside', 'jb-mc-sidebar'); sidebar.append(el('h1', '', 'My Chats'));
  const navCount = el('span', 'jb-mc-count', '0');
  const all = button('', () => { search.value = ''; query = ''; sort.value = 'latest'; offset = 0; void load(); }, 'jb-mc-all-nav');
  all.setAttribute('aria-current', 'page'); const allLabel = el('span'); allLabel.append(icon('new-chat'), el('span', '', 'All chats')); all.append(allLabel, navCount); sidebar.append(all);
  const main = el('div', 'jb-mc-main'); const heading = el('div', 'jb-mc-heading');
  const summary = el('p', 'jb-mc-summary jb-mc-count'); heading.append(el('h2', '', 'All chats'), summary);
  const controls = el('div', 'jb-mc-controls'); const searchLabel = el('label', 'jb-mc-search');
  searchLabel.append(el('span', 'jb-sr-only', 'Search character'));
  const search = el('input'); search.type = 'search'; search.placeholder = 'Search character…'; search.maxLength = 256; search.setAttribute('aria-label', 'Search character'); searchLabel.append(search);
  const searchIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); searchIcon.setAttribute('viewBox', '0 0 24 24'); searchIcon.setAttribute('fill', 'none'); searchIcon.setAttribute('stroke', 'currentColor'); searchIcon.setAttribute('stroke-width', '2'); searchIcon.setAttribute('aria-hidden', 'true');
  const searchPath = document.createElementNS(searchIcon.namespaceURI, 'path'); searchPath.setAttribute('d', 'M21 21l-6-6M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'); searchIcon.append(searchPath); searchLabel.prepend(searchIcon);
  const sort = select('Sort characters'); sort.className = ''; const sortField = el('div', 'jb-mc-sort'); sortField.append(sort); controls.append(searchLabel, sortField);
  const resumeHeading = el('h3', 'jb-mc-resume-heading', 'Continue'); const resume = el('div', 'jb-mc-resume-grid');
  const listHeading = el('h3', 'jb-mc-list-heading', 'All chats'); const status = el('div', 'jb-mc-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = el('div', 'jb-mc-character-list'); const pagination = el('div', 'jb-mc-pagination'); const pageLabel = el('span');
  const previous = button('← Previous', () => { offset = Math.max(0, offset - PAGE_SIZE); void load(); });
  const next = button('Next →', () => { offset += PAGE_SIZE; void load(); }); pagination.append(previous, pageLabel, next);
  main.append(heading, controls, resumeHeading, resume, listHeading, status, list, pagination); root.append(sidebar, main);

  async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error('Native read unavailable'); return await response.json() as T;
  }
  function params(options: SpindleRecentChatsQuery) { return new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])).toString(); }
  function readGrouped(options: SpindleRecentChatsQuery, signal: AbortSignal): Promise<Page<SpindleGroupedRecentChat>> {
    return ctx.chats.listRecentGrouped ? ctx.chats.listRecentGrouped(options) : get(`/chats/recent-grouped?${params(options)}`, signal);
  }
  function readRecent(signal: AbortSignal): Promise<Page<SpindleRecentChat>> {
    const options = { limit: 3, offset: 0, sort: 'recent' as const, direction: 'desc' as const };
    return ctx.chats.listRecent ? ctx.chats.listRecent(options) : get(`/chats/recent?${params(options)}`, signal);
  }
  function clearProfile() {
    profileCleanup?.(); profileCleanup = undefined;
    if (profileInjection) { try { ctx.dom.uninject(profileInjection); } catch { profileInjection.remove(); } profileInjection = undefined; }
  }
  function stopDetail() { detailRequest++; detailAbort?.abort(); detailAbort = undefined; clearProfile(); expanded = ''; }
  function updateSummary() {
    navCount.textContent = chatTotal.toLocaleString();
    summary.textContent = `${groupedTotal.toLocaleString()} ${hasGroups ? 'characters & groups' : groupedTotal === 1 ? 'character' : 'characters'} · ${chatTotal.toLocaleString()} ${chatTotal === 1 ? 'chat' : 'chats'}`;
  }
  function openChat(id: string) {
    if (!active || disposed || !id) return;
    void options.invoke({ kind: 'route', id: '/chat/:chatId' }, { chatId: id }).then(ok => {
      if (!ok && active && !disposed) status.textContent = 'Could not open this chat. Try again.';
    }).catch(() => { if (active && !disposed) status.textContent = 'Could not open this chat. Try again.'; });
  }
  function persona(row: unknown): string {
    // Only the saved native chat binding is eligible. Never substitute the
    // globally active persona or a copied/imported display-name field.
    const metadata = record(record(row).metadata);
    return personaNames.get(text(metadata.active_persona_id)) || '';
  }
  async function resolvePersonas(rows: unknown[], signal: AbortSignal) {
    const wanted = new Set(rows.map(row => text(record(record(row).metadata).active_persona_id)).filter(id => id && !personaNames.has(id)));
    if (!wanted.size) return;
    let personaOffset = 0;
    while (wanted.size && !signal.aborted) {
      const page = await get<Page<{ id: string; name?: string }>>(`/personas?limit=200&offset=${personaOffset}`, signal);
      if (!Array.isArray(page.data)) return;
      for (const item of page.data) { const id = text(record(item).id), name = text(record(item).name); if (id && name) { personaNames.set(id, name); wanted.delete(id); } }
      personaOffset += page.data.length;
      if (!page.data.length || personaOffset >= count(page.total)) break;
    }
  }
  async function readChatMetadata(characterId: string, signal: AbortSignal): Promise<Map<string, Record<string, unknown>>> {
    const metadata = new Map<string, Record<string, unknown>>(); let chatOffset = 0;
    while (!signal.aborted) {
      const page = await get<Page<{ id: string; metadata?: unknown }>>(`/chats?characterId=${encodeURIComponent(characterId)}&limit=200&offset=${chatOffset}`, signal);
      if (!Array.isArray(page.data)) return metadata;
      for (const item of page.data) { if (text(record(item).id)) metadata.set(item.id, record(item.metadata)); }
      chatOffset += page.data.length;
      if (!page.data.length || chatOffset >= count(page.total)) break;
    }
    return metadata;
  }
  async function recentWithMetadata(rows: SpindleRecentChat[], signal: AbortSignal): Promise<SpindleRecentChat[]> {
    // Some running host bundles omit metadata from the recent DTO. Limit the
    // compatibility reads to the three Continue cards and never load messages.
    return await Promise.all(rows.slice(0, 3).map(async row => {
      const metadata = record(row.metadata);
      if (Object.prototype.hasOwnProperty.call(metadata, 'active_persona_id') || signal.aborted) return row;
      try {
        const chat = record(await get(`/chats/${encodeURIComponent(row.id)}?messages=false`, signal));
        if (signal.aborted || chat.id !== row.id || (chat.character_id && chat.character_id !== row.character_id)) return row;
        return { ...row, metadata: { ...metadata, ...record(chat.metadata) } };
      } catch { return row; }
    }));
  }
  function addPersona(parent: HTMLElement, row: unknown) { const name = persona(row); if (name) parent.append(el('span', 'jb-mc-persona', `as ${name}`)); }
  function renderResume(rows: SpindleRecentChat[]) {
    resume.replaceChildren(); resumeHeading.hidden = resume.hidden = rows.length === 0;
    for (const chat of rows.slice(0, 3)) {
      const isGroup = record(chat.metadata).group === true;
      const name = isGroup ? text(chat.name) || 'Group chat' : text(chat.character_name) || text(chat.name) || 'Untitled chat';
      const card = button('', () => openChat(chat.id), 'jb-mc-resume-card'); card.setAttribute('aria-label', `Continue ${name}`);
      card.append(avatar(chat.character_id, chat.character_image_id, name, 'jb-mc-resume-avatar'), el('strong', 'jb-mc-resume-name', name), el('time', 'jb-mc-resume-date', dateLabel(chat.updated_at)), el('p', 'jb-mc-resume-preview', plain(chat.last_message_preview) || 'No messages yet.'));
      const meta = el('span', 'jb-mc-resume-meta'); addPersona(meta, chat); card.append(meta); resume.append(card);
    }
  }
  function rowKey(row: SpindleGroupedRecentChat) { return row.is_group ? `group:${row.latest_chat_id}` : `character:${row.character_id}`; }
  function renderRows(rows: SpindleGroupedRecentChat[]) {
    list.replaceChildren();
    if (!rows.length) { list.append(el('p', 'jb-mc-empty', query ? 'No characters match your search.' : 'Your conversations will appear here.')); return; }
    for (const row of rows) {
      const name = row.is_group ? text(row.group_name) || text(row.latest_chat_name) || 'Group chat' : text(row.character_name) || 'Unnamed character';
      const article = el('article', 'jb-mc-character'); const header = button('', () => { void expand(row, article, header, body); }, 'jb-mc-character-header');
      header.setAttribute('aria-expanded', 'false'); header.setAttribute('aria-label', `${name}, ${count(row.chat_count)} chats`);
      const info = el('span', 'jb-mc-character-text'); info.append(el('strong', 'jb-mc-character-name', name), el('span', 'jb-mc-chat-count', `${row.is_group ? 'group chats' : 'chats'}: ${count(row.chat_count)}`));
      header.append(avatar(row.character_id, row.character_image_id, name, 'jb-mc-character-avatar'), info, el('span', 'jb-mc-chevron', '⌄'));
      const body = el('div', 'jb-mc-expanded'); body.hidden = true; article.append(header, body); list.append(article);
    }
  }
  function localError(body: HTMLElement, retry: () => void, message = 'Could not load this character’s chats.') {
    body.replaceChildren(el('p', 'jb-mc-status', message), button('Retry', retry));
  }
  async function expand(row: SpindleGroupedRecentChat, article: HTMLElement, header: HTMLButtonElement, body: HTMLElement) {
    if (!active || disposed) return;
    const key = rowKey(row); const collapse = expanded === key; stopDetail();
    for (const old of list.querySelectorAll<HTMLButtonElement>('.jb-mc-character-header')) old.setAttribute('aria-expanded', 'false');
    for (const old of list.querySelectorAll<HTMLElement>('.jb-mc-expanded')) old.hidden = true;
    if (collapse) return;
    expanded = key; header.setAttribute('aria-expanded', 'true'); body.hidden = false; body.replaceChildren(el('p', 'jb-mc-status', 'Loading chats…'));
    const generation = detailRequest; const abort = new AbortController(); detailAbort = abort;
    const current = () => active && !disposed && generation === detailRequest && expanded === key && article.parentElement === list;
    if (row.is_group) {
      body.replaceChildren(el('p', 'jb-mc-status', 'This is a Lumiverse group conversation.'), button('Continue group chat', () => openChat(row.latest_chat_id), 'jb-button jb-primary'));
      return;
    }
    try {
      const runtimeChats = ctx.chats as typeof ctx.chats & { listForCharacter?(id: string): Promise<Summary[]> };
      const [characterValue, summaries, hiddenValue] = await Promise.all([
        ctx.characters.get(row.character_id),
        runtimeChats.listForCharacter ? runtimeChats.listForCharacter(row.character_id) : get<Summary[]>(`/chats/character-chats/${encodeURIComponent(row.character_id)}`, abort.signal),
        get<Array<{ id: string }>>('/chats/hidden-from-recent', abort.signal),
      ]);
      if (!current()) return;
      const character = record(characterValue); if (text(character.id) && character.id !== row.character_id) throw new Error('Wrong native character');
      if (!Array.isArray(summaries) || !Array.isArray(hiddenValue)) throw new Error('Invalid native list');
      const hiddenIds = new Set(hiddenValue.map(item => text(record(item).id)));
      const chats = summaries.filter(item => text(record(item).id) && !hiddenIds.has(item.id)).map(item => ({ ...item }));
      body.replaceChildren(); const profile = el('section', 'jb-mc-profile');
      const creator = text(character.creator).trim(); if (creator) profile.append(el('p', 'jb-mc-creator', creator.startsWith('@') ? creator : `@${creator}`));
      const note = el('section', 'jb-mc-note'); note.setAttribute('aria-label', 'Creator’s Note');
      note.append(el('h3', 'jb-mc-note-title', 'Creator’s Note'));
      const description = el('div', 'jb-mc-description');
      description.id = `jb-mc-note-${encodeURIComponent(row.character_id)}`;
      description.dataset.expanded = 'false';
      const profileText = text(character.creator_notes).trim();
      if (profileText) {
        if (typeof ctx.dom.inject === 'function') {
          try { profileInjection = ctx.dom.inject(description, profileMarkup(profileText)); }
          catch { description.textContent = plain(profileText).slice(0, MAX_PROFILE_CHARS); }
        } else description.textContent = plain(profileText).slice(0, MAX_PROFILE_CHARS);
      } else description.append(el('p', '', 'No creator’s note.'));
      if (profileText.length > MAX_PROFILE_CHARS) description.append(el('p', 'jb-mc-status', 'This creator’s note was shortened for display.'));
      note.append(description);
      if (profileText) {
        const toggle = el('button', 'jb-mc-note-toggle', 'Read full creator note'); toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', description.id);
        const toggleNote = () => {
          if (!current()) return;
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(open)); description.dataset.expanded = String(open);
          toggle.textContent = open ? 'Show less' : 'Read full creator note';
          if (!open) description.scrollTop = 0;
        };
        toggle.addEventListener('click', toggleNote); profileCleanup = () => toggle.removeEventListener('click', toggleNote);
        note.append(toggle);
      }
      profile.append(note); const actions = el('div', 'jb-mc-character-actions');
      const start = button('＋ Start new chat', () => {
        if (!current() || start.disabled) return; start.disabled = true;
        void (async () => await options.startChat(row.character_id))().then(ok => {
          if (!current()) return; start.disabled = false; if (ok === false) detailStatus.textContent = 'Could not start a chat. Check the extension’s Chats permission and try again.';
        }).catch(() => { if (current()) { start.disabled = false; detailStatus.textContent = 'Could not start a chat. Please try again.'; } });
      }, 'jb-button jb-primary');
      actions.append(start, button('View character →', () => { if (current()) options.openCharacter(row.character_id); }, 'jb-text-button jb-mc-profile-link'));
      const detailStatus = el('p', 'jb-mc-status'); detailStatus.setAttribute('role', 'status'); profile.append(actions, detailStatus); body.append(profile);
      const conversationHeading = el('div', 'jb-mc-conversations-heading'); const conversationSort = select('Sort conversations');
      conversationHeading.append(el('h3', '', 'Chats'), conversationSort); const conversationList = el('div', 'jb-mc-conversations'); body.append(conversationHeading, conversationList);
      const renderConversations = () => {
        if (!current()) return; conversationList.replaceChildren();
        const sorted = [...chats].sort((a, b) => conversationSort.value === 'name' ? text(a.name).localeCompare(text(b.name)) : (conversationSort.value === 'oldest' ? 1 : -1) * (count(a.updated_at) - count(b.updated_at)));
        const dateGroups = conversationSort.value === 'oldest' ? ['Older', 'Yesterday', 'Today'] : ['Today', 'Yesterday', 'Older'];
        for (const group of dateGroups) {
          const grouped = sorted.filter(chat => dateGroup(chat.updated_at) === group); if (!grouped.length) continue;
          conversationList.append(el('h4', 'jb-mc-date-heading', group));
          for (const chat of grouped) {
          const card = button('', () => openChat(chat.id), 'jb-mc-conversation-card'); card.setAttribute('aria-label', `Continue ${text(chat.name) || 'Untitled chat'}`);
          const meta = el('span', 'jb-mc-conversation-meta'); meta.append(el('time', 'jb-mc-conversation-date', dateLabel(chat.updated_at))); addPersona(meta, chat);
            const messageCount = count(chat.message_count); card.append(meta, el('strong', 'jb-mc-conversation-name', text(chat.name) || 'Untitled chat'), el('p', 'jb-mc-conversation-preview', plain(chat.last_message_preview) || 'No messages yet.'), el('span', 'jb-mc-conversation-count', `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`)); conversationList.append(card);
          }
        }
        if (!chats.length) conversationList.append(el('p', 'jb-mc-empty', 'No visible chats for this character.'));
      };
      conversationSort.addEventListener('change', renderConversations); renderConversations();
      // The summary DTO intentionally omits metadata. Read it once for this
      // expanded character, never fetch messages or one request per chat.
      void readChatMetadata(row.character_id, abort.signal).then(async metadata => {
        if (!current()) return;
        for (const chat of chats) chat.metadata = metadata.get(chat.id);
        await resolvePersonas(chats, abort.signal); if (current()) renderConversations();
      }).catch(() => { /* Missing optional identity must leave the badge absent. */ });
    } catch {
      if (current()) localError(body, () => { expanded = ''; void expand(row, article, header, body); });
    }
  }
  async function load() {
    if (!active || disposed) return;
    const generation = ++request; pageAbort?.abort(); const abort = new AbortController(); pageAbort = abort; stopDetail();
    root.setAttribute('aria-busy', 'true'); status.textContent = 'Loading chats…'; previous.disabled = next.disabled = true;
    const current = () => active && !disposed && generation === request;
    const options: SpindleRecentChatsQuery = { limit: PAGE_SIZE, offset, ...(query ? { search: query } : {}), sort: sort.value === 'name' ? 'name' : 'recent', direction: sort.value === 'oldest' || sort.value === 'name' ? 'asc' : 'desc' };
    const results = await Promise.allSettled([
      Promise.resolve().then(() => { if (!current()) throw new Error('Inactive view'); return readGrouped(options, abort.signal); }),
      Promise.resolve().then(() => { if (!current()) throw new Error('Inactive view'); return readRecent(abort.signal); }),
    ]);
    if (!current()) return; root.setAttribute('aria-busy', 'false'); status.replaceChildren();
    const [grouped, recent] = results;
    if (recent.status === 'fulfilled' && Array.isArray(recent.value.data)) {
      chatTotal = count(recent.value.total); const rows = recent.value.data.filter(row => text(record(row).id)).slice(0, 3); renderResume(rows);
      void recentWithMetadata(rows, abort.signal).then(async enriched => {
        if (!current()) return; await resolvePersonas(enriched, abort.signal); if (current()) renderResume(enriched);
      }).catch(() => { /* A name is shown only when its native binding resolves. */ });
    } else { renderResume([]); status.append(el('p', '', 'Could not load your recent chats.')); }
    if (grouped.status === 'fulfilled' && Array.isArray(grouped.value.data)) {
      groupedTotal = count(grouped.value.total); const rows = grouped.value.data.filter(row => text(record(row).character_id) && text(record(row).latest_chat_id)); hasGroups = rows.some(row => row.is_group);
      if (offset && offset >= groupedTotal) { offset = Math.max(0, Math.floor(Math.max(0, groupedTotal - 1) / PAGE_SIZE) * PAGE_SIZE); void load(); return; }
      renderRows(rows); previous.disabled = offset === 0; next.disabled = offset + PAGE_SIZE >= groupedTotal;
      pageLabel.textContent = groupedTotal ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, groupedTotal)} of ${groupedTotal}` : '';
      pagination.hidden = groupedTotal <= PAGE_SIZE;
    } else { list.replaceChildren(); pagination.hidden = true; status.append(el('p', '', 'Could not load your chats.'), button('Retry', () => { void load(); })); }
    updateSummary();
  }
  function setSearch(value: string) {
    if (disposed) return; clearTimeout(searchTimer); search.value = value.slice(0, 256); query = search.value.trim(); offset = 0; if (active) void load();
  }
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setSearch(search.value), 200); });
  sort.addEventListener('change', () => { offset = 0; void load(); });
  function refresh() { if (!disposed && active) void load(); }
  if (ctx.events?.on) for (const event of ['CHAT_CREATED', 'CHAT_CHANGED', 'CHAT_DELETED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_AVATAR_CHANGED', 'PERSONA_CREATED', 'PERSONA_EDITED', 'PERSONA_DELETED', 'jar_bridge:imported', 'jar_bridge:chat_imported']) {
    cleanups.push(ctx.events.on(event, () => { if (event.startsWith('PERSONA_')) personaNames.clear(); clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 300); }));
  }
  return {
    root,
    activate() { if (disposed || active) return; active = true; root.hidden = false; void load(); },
    deactivate() { active = false; root.hidden = true; request++; pageAbort?.abort(); stopDetail(); clearTimeout(searchTimer); clearTimeout(refreshTimer); root.removeAttribute('aria-busy'); },
    refresh, setSearch,
    destroy() { if (disposed) return; disposed = true; active = false; request++; pageAbort?.abort(); stopDetail(); clearTimeout(searchTimer); clearTimeout(refreshTimer); cleanups.reverse().forEach(cleanup => cleanup()); root.remove(); },
  };
}
