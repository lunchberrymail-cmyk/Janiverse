import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

export type ComposerActions = {
  onDiscover?: () => void;
};
type Persona = { id: string; name: string; title: string; imageId: string | null };
let composerSequence = 0;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function persona(value: unknown): Persona | null {
  const row = record(value);
  return typeof row.id === 'string' && typeof row.name === 'string'
    ? { id: row.id, name: row.name, title: typeof row.title === 'string' ? row.title : '', imageId: typeof row.image_id === 'string' ? row.image_id : null }
    : null;
}
function sparkle() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const [path, color] of [['M10 3 12 8 17 10 12 12 10 17 8 12 3 10 8 8Z', '#bca1e6'], ['M19 13 20.3 16.7 24 18 20.3 19.3 19 23 17.7 19.3 14 18 17.7 16.7Z', '#de95bf'], ['M20 0 20.9 2.1 23 3 20.9 3.9 20 6 19.1 3.9 17 3 19.1 2.1Z', '#9bc4ef']]) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); shape.setAttribute('fill', color); svg.append(shape);
  }
  return svg;
}

/** Familiar composer controls around Lumiverse's existing IME-aware input and Send button. */
export function createComposer(ctx: SpindleFrontendContext, actions: ComposerActions = {}, options: { enabled?: boolean } = {}) {
  let enabled = options.enabled ?? false;
  let disposed = false, busy = false, popover: 'persona' | null = null;
  let personas: Persona[] = [], personaRequest = 0, listRequest = 0;
  let currentChatId = ctx.getActiveChat()?.chatId ?? null;
  const cleanups: Array<() => void> = [];
  const abort = new AbortController();
  const toolsRoot = ctx.ui.mount('chat_input_tools_left');
  const popoverRoot = ctx.ui.mount('chat_composer_above');
  const oldMarker = document.documentElement.getAttribute('data-jb-composer');
  document.documentElement.setAttribute('data-jb-composer', String(enabled));
  toolsRoot.toggleAttribute('hidden', !enabled); popoverRoot.toggleAttribute('hidden', !enabled);
  toolsRoot.classList.add('jb-composer-tools-root'); popoverRoot.classList.add('jb-composer-popover-root');
  const tools = node('div', 'jb-composer-tools');
  const assist = node('button', 'jb-assist-toggle'); assist.type = 'button'; assist.append(sparkle());
  assist.setAttribute('aria-label', 'Find helpful extensions'); assist.setAttribute('aria-haspopup', 'dialog'); assist.title = 'What are you looking for?';
  const picker = node('button', 'jb-composer-persona'); picker.type = 'button';
  const chipAvatar = node('span', 'jb-composer-avatar');
  const chipName = node('span', 'jb-composer-persona-name', 'My persona');
  const chevron = node('span', 'jb-composer-chevron', '⌄'); chevron.setAttribute('aria-hidden', 'true');
  picker.append(chipAvatar, chipName, chevron); picker.setAttribute('aria-haspopup', 'menu'); picker.setAttribute('aria-expanded', 'false'); picker.setAttribute('aria-label', 'Choose your persona');
  tools.append(assist, picker); toolsRoot.append(tools);
  const popup = node('div', 'jb-composer-popover'); popup.hidden = true;
  const status = node('p', 'jb-composer-notice'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const prefix = `jb-composer-${++composerSequence}`;
  const personaMenu = node('div', 'jb-composer-persona-menu'); personaMenu.hidden = true;
  personaMenu.id = `${prefix}-personas`; picker.setAttribute('aria-controls', personaMenu.id);
  const search = node('input', 'jb-composer-persona-search'); search.type = 'search'; search.placeholder = 'Search personas'; search.setAttribute('aria-label', 'Search personas');
  const personaList = node('div', 'jb-composer-persona-list'); personaList.setAttribute('role', 'menu'); personaList.setAttribute('aria-label', 'Choose a persona');
  const personaFooter = node('div', 'jb-composer-persona-footer');
  const allow = node('button', '', 'Allow persona switching'); allow.type = 'button'; allow.hidden = true;
  const manage = node('button', '', 'Manage personas'); manage.type = 'button';
  personaFooter.append(allow, manage); personaMenu.append(search, personaList, personaFooter); popup.append(status, personaMenu); popoverRoot.append(popup);

  function activePersonaId(): string | null { try { const id = ctx.state?.get('persona.activeId'); return typeof id === 'string' ? id : null; } catch { return null; } }
  function avatar(target: HTMLElement, value: Persona | null) {
    target.replaceChildren();
    if (value?.imageId) {
      const image = node('img'); image.alt = ''; image.src = `/api/v1/images/${encodeURIComponent(value.imageId)}?size=sm`;
      image.addEventListener('error', () => { image.remove(); }); target.append(image);
    }
    target.append(node('span', '', value?.name.slice(0, 1).toUpperCase() || 'U'));
  }
  function renderChip(value: Persona | null) {
    chipName.textContent = value?.name || 'My persona'; avatar(chipAvatar, value);
    picker.title = value ? `Persona: ${value.name}` : 'Choose your persona';
    picker.setAttribute('aria-label', value ? `Choose your persona, currently ${value.name}` : 'Choose your persona');
  }
  function close(focus = false) {
    popover = null; popup.hidden = true; status.textContent = '';
    picker.setAttribute('aria-expanded', 'false');
    if (focus) picker.focus();
  }
  function sync() {
    if (disposed) return;
    const chatId = ctx.getActiveChat()?.chatId ?? null;
    if (chatId !== currentChatId) { currentChatId = chatId; busy = false; close(); if (enabled) void refreshPersona(); }
    assist.disabled = !enabled || !actions.onDiscover; picker.disabled = !enabled || !chatId || busy;
  }
  function open(which: 'persona') {
    if (disposed || !enabled || busy) return;
    if (popover === which) { close(); return; }
    popover = which; popup.hidden = false; status.textContent = '';
    personaMenu.hidden = false;
    picker.setAttribute('aria-expanded', 'true');
    sync();
    if (which === 'persona') {
      search.value = ''; void loadPersonas();
      // A phone user can browse personas without opening the soft keyboard.
      // Search remains a normal tappable input; desktop keyboard flow is unchanged.
      const coarsePointer = document.defaultView?.matchMedia?.('(pointer: coarse)').matches === true;
      if (coarsePointer) picker.focus(); else search.focus();
    }
  }
  async function readJson(path: string): Promise<unknown> {
    const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', signal: abort.signal });
    if (!response.ok) throw new Error('Could not load personas'); return response.json();
  }
  async function refreshPersona() {
    const id = activePersonaId(); const request = ++personaRequest;
    if (!id) { renderChip(null); return; }
    const cached = personas.find(row => row.id === id);
    if (cached) { renderChip(cached); renderPersonas(); return; }
    try {
      const value = persona(await readJson(`/personas/${encodeURIComponent(id)}`));
      if (!disposed && request === personaRequest && activePersonaId() === id) renderChip(value);
    } catch { if (!disposed && request === personaRequest) renderChip(null); }
  }
  async function loadPersonas() {
    const chatId = ctx.getActiveChat()?.chatId; const request = ++listRequest;
    personaList.replaceChildren(node('p', 'jb-composer-empty', 'Loading personas…'));
    try {
      const rows: Persona[] = []; let offset = 0;
      for (;;) {
        const result = await readJson(`/personas?limit=200&offset=${offset}`); const data = record(result);
        const page = Array.isArray(result) ? result : data.data;
        if (!Array.isArray(page)) throw new Error('Invalid persona list');
        rows.push(...page.map(persona).filter((value): value is Persona => !!value)); offset += page.length;
        if (!page.length || Array.isArray(result) || typeof data.total !== 'number' || offset >= data.total) break;
      }
      if (disposed || request !== listRequest || popover !== 'persona' || ctx.getActiveChat()?.chatId !== chatId) return;
      personas = [...new Map(rows.map(row => [row.id, row])).values()]; renderPersonas();
      const active = personas.find(row => row.id === activePersonaId()); if (active) renderChip(active);
      const granted = await ctx.permissions.getGranted(); if (!disposed && request === listRequest && popover === 'persona') allow.hidden = granted.includes('personas');
    } catch { if (!disposed && request === listRequest && popover === 'persona') personaList.replaceChildren(node('p', 'jb-composer-empty', 'Could not load personas. Close and reopen this picker to retry.')); }
  }
  function renderPersonas() {
    const term = search.value.trim().toLowerCase(); const activeId = activePersonaId();
    const matches = personas.filter(row => `${row.name} ${row.title}`.toLowerCase().includes(term));
    personaList.replaceChildren();
    for (const row of matches) {
      const button = node('button', 'jb-composer-persona-option'); button.type = 'button'; button.setAttribute('role', 'menuitemradio'); button.setAttribute('aria-checked', String(row.id === activeId));
      const image = node('span', 'jb-composer-avatar'); avatar(image, row);
      const name = node('span', 'jb-composer-persona-option-name', row.name); if (row.title) name.append(node('small', '', row.title));
      button.append(image, name); button.addEventListener('click', () => { void switchPersona(row); }); personaList.append(button);
    }
    if (!matches.length) personaList.append(node('p', 'jb-composer-empty', term ? 'No personas match your search.' : 'No personas yet. Create one in Manage personas.'));
  }
  async function switchPersona(value: Persona) {
    const chatId = ctx.getActiveChat()?.chatId;
    if (disposed || busy || !chatId) return;
    busy = true; sync();
    try {
      const granted = await ctx.permissions.getGranted();
      if (disposed || ctx.getActiveChat()?.chatId !== chatId) return;
      if (!granted.includes('personas')) { allow.hidden = false; status.textContent = 'Allow persona switching, then choose your persona.'; return; }
      const surfaces = ctx.host.surfaces;
      const action = surfaces?.list(['entity_action']).find(surface => surface.id === 'switch_persona');
      if (!surfaces || !action || action.invocable === false) { status.textContent = 'Persona switching is unavailable. Check the extension’s Personas permission.'; return; }
      await surfaces.invoke({ kind: 'entity_action', id: 'switch_persona' }, { personaId: value.id });
      if (!disposed && ctx.getActiveChat()?.chatId === chatId) { renderChip(value); close(); }
    } catch { if (!disposed && ctx.getActiveChat()?.chatId === chatId) status.textContent = 'Could not switch personas. Your previous persona is still selected.'; }
    finally { if (!disposed) { busy = false; sync(); } }
  }
  allow.addEventListener('click', () => { void (async () => {
    if (disposed || busy) return; busy = true; allow.disabled = true;
    try {
      await ctx.permissions.request(['personas'], { reason: 'Choose a native Lumiverse persona from the chat composer. The selection is saved on this chat.' });
      if (disposed) return;
      const granted = await ctx.permissions.getGranted(); if (disposed) return;
      allow.hidden = granted.includes('personas'); status.textContent = allow.hidden ? 'Persona switching enabled. Choose a persona.' : 'Persona switching remains disabled.';
    } catch { if (!disposed) status.textContent = 'Could not enable persona switching.'; }
    finally { if (!disposed) { busy = false; allow.disabled = false; sync(); } }
  })(); });
  manage.addEventListener('click', () => { void (async () => {
    const surfaces = ctx.host.surfaces;
    const action = surfaces?.list(['drawer_tab']).find(surface => surface.id === 'personas' && surface.invocable !== false);
    if (!surfaces || !action) { status.textContent = 'Persona management is unavailable.'; return; }
    close(); await surfaces.invoke({ kind: 'drawer_tab', id: 'personas' });
  })().catch(() => { if (!disposed) { popup.hidden = false; status.textContent = 'Could not open persona management.'; } }); });
  assist.addEventListener('click', () => { if (disposed || !enabled) return; close(); actions.onDiscover?.(); }); picker.addEventListener('click', () => open('persona'));
  search.addEventListener('input', renderPersonas);
  const outside = (event: Event) => { const target = event.target as Node | null; if (target && !tools.contains(target) && !popup.contains(target)) close(); };
  const keys = (event: KeyboardEvent) => {
    if (popup.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target === search) return;
    const choices = Array.from(personaList.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!choices.length) return;
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    event.preventDefault(); choices[next]?.focus();
  };
  document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true);
  cleanups.push(() => document.removeEventListener('pointerdown', outside, true), () => document.removeEventListener('keydown', keys, true));
  if (ctx.events?.on) {
    cleanups.push(ctx.events.on('PERSONA_CHANGED', () => { personas = []; if (enabled) void refreshPersona(); if (popover === 'persona') void loadPersonas(); }));
  }
  if (ctx.composer?.onChange) cleanups.push(ctx.composer.onChange(sync));
  if (ctx.state?.subscribe) {
    for (const [selector, handler] of [
      ['chat.active', sync], ['persona.activeId', () => { if (enabled) void refreshPersona(); }],
    ] as const) {
      try { cleanups.push(ctx.state.subscribe(selector, handler)); } catch { /* Optional selectors differ by Lumiverse version. */ }
    }
  }
  renderChip(null); sync(); if (enabled) void refreshPersona();
  return { setEnabled(value: boolean) {
    if (disposed || value === enabled) return;
    const ownedFocus = toolsRoot.contains(document.activeElement) || popoverRoot.contains(document.activeElement);
    enabled = value; close(); toolsRoot.toggleAttribute('hidden', !enabled); popoverRoot.toggleAttribute('hidden', !enabled);
    document.documentElement.setAttribute('data-jb-composer', String(enabled)); sync();
    if (enabled) void refreshPersona();
    else if (ownedFocus) ctx.composer?.focus();
  }, destroy() {
    if (disposed) return; disposed = true; ++personaRequest; ++listRequest; abort.abort();
    cleanups.splice(0).forEach(cleanup => cleanup()); tools.remove(); popup.remove(); toolsRoot.remove(); popoverRoot.remove();
    if (oldMarker === null) document.documentElement.removeAttribute('data-jb-composer'); else document.documentElement.setAttribute('data-jb-composer', oldMarker);
  } };
}
