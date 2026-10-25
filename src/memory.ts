import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

type NoteRole = 'system' | 'user' | 'assistant';
type MemorySession = { modal: SpindleModalHandle; abort: AbortController; closed: boolean };

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Edits the native per-chat Author's Note through the atomic metadata endpoint. */
export function createChatMemory(ctx: SpindleFrontendContext) {
  let disposed = false;
  let active: MemorySession | undefined;
  let nextId = 0;

  function open(chatId: string, draft?: string) {
    if (disposed || !chatId) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'Chat Memory', width: 640, maxHeight: 780 });
    const session: MemorySession = { modal, abort: new AbortController(), closed: false };
    active = session;
    const current = () => !disposed && !session.closed && active === session;
    modal.root.classList.add('jb-memory');
    modal.onDismiss(() => {
      session.closed = true;
      session.abort.abort();
      if (active === session) active = undefined;
    });

    const suffix = `jb-memory-${++nextId}`;
    const heading = element('h2', 'jb-memory-heading', 'Summary of this chat');
    const help = element('p', 'jb-memory-help', draft === undefined
      ? 'Keep important facts, relationships, and events here. Saved to this conversation’s Author’s Note.'
      : 'Review this suggested summary. Save when you want to use it as this chat’s memory.');
    help.id = `${suffix}-help`;
    const label = element('label', 'jb-memory-label', 'Summary of this chat');
    const text = element('textarea', 'jb-memory-textarea');
    text.id = `${suffix}-text`;
    text.name = 'chat-memory';
    text.rows = 10;
    text.placeholder = 'Important facts about your characters, relationships, and story so far…';
    text.setAttribute('aria-describedby', help.id);
    text.disabled = true;
    label.htmlFor = text.id;
    const meta = element('div', 'jb-memory-meta');
    const tokens = element('span', 'jb-memory-tokens', 'Approx. 0 tokens');
    meta.append(tokens);

    const advanced = element('details', 'jb-memory-advanced');
    const advancedFields = element('div', 'jb-memory-advanced-fields');
    const depthField = element('label', 'jb-memory-field', 'Insertion depth');
    const depth = element('input');
    depth.type = 'number';
    depth.name = 'chat-memory-depth';
    depth.min = '0'; depth.max = '9999'; depth.step = '1'; depth.value = '4'; depth.disabled = true;
    depthField.append(depth);
    const depthHint = element('small', '', 'Chat messages back from the latest. 0 inserts after the latest message.');
    depthHint.id = `${suffix}-depth-hint`;
    depth.setAttribute('aria-describedby', depthHint.id);
    depthField.append(depthHint);
    const roleField = element('label', 'jb-memory-field', 'Message role');
    const role = element('select');
    role.name = 'chat-memory-role';
    role.disabled = true;
    for (const value of ['system', 'user', 'assistant'] as const) {
      const option = element('option', '', value.charAt(0).toUpperCase() + value.slice(1));
      option.value = value;
      role.append(option);
    }
    roleField.append(role);
    advancedFields.append(depthField, roleField);
    advanced.append(element('summary', '', 'Advanced'), advancedFields,
      element('p', 'jb-memory-caveat', 'Uses Lumiverse’s Author’s Note. Raw/no-block prompt modes may omit it.'));

    const status = element('p', 'jb-memory-status', 'Loading chat memory…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'jb-memory-actions');
    const cancel = element('button', 'jb-button', 'Cancel'); cancel.type = 'button';
    const save = element('button', 'jb-button jb-primary', 'Save'); save.type = 'button'; save.disabled = true;
    const retry = element('button', 'jb-button', 'Retry'); retry.type = 'button'; retry.hidden = true;
    cancel.addEventListener('click', () => modal.dismiss());
    actions.append(retry, cancel, save);
    modal.root.append(heading, help, label, text, meta, advanced, status, actions);

    let originalNote: Record<string, unknown> = {};
    let loaded = false;
    let saving = false;
    const countTokens = () => { tokens.textContent = `Approx. ${Math.ceil(text.value.length / 4).toLocaleString()} tokens`; };
    text.addEventListener('input', countTokens);
    const setEditable = (enabled: boolean) => {
      text.disabled = !enabled; depth.disabled = !enabled; role.disabled = !enabled; save.disabled = !enabled;
    };
    async function load() {
      if (!current()) return;
      loaded = false;
      setEditable(false);
      retry.hidden = true;
      status.textContent = 'Loading chat memory…';
      try {
        const response = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}?messages=false`, {
          credentials: 'same-origin', signal: session.abort.signal,
        });
        if (!response.ok) throw new Error('load');
        const chat = record(await response.json());
        if (!current()) return;
        originalNote = { ...record(record(chat.metadata).authors_note) };
        text.value = draft ?? (typeof originalNote.content === 'string' ? originalNote.content : '');
        depth.value = typeof originalNote.depth === 'number' && Number.isFinite(originalNote.depth)
          ? String(Math.max(0, Math.min(9999, Math.trunc(originalNote.depth)))) : '4';
        role.value = ['system', 'user', 'assistant'].includes(String(originalNote.role)) ? String(originalNote.role) : 'system';
        loaded = true;
        setEditable(true);
        countTokens();
        status.textContent = '';
        text.focus();
      } catch {
        if (!current()) return;
        status.textContent = 'Could not load chat memory. Try again.';
        retry.hidden = false;
      }
    }
    retry.addEventListener('click', () => { void load(); });
    save.addEventListener('click', () => { void persist(); });
    async function persist() {
      if (!current() || !loaded || saving) return;
      const numericDepth = depth.valueAsNumber;
      if (!Number.isInteger(numericDepth) || numericDepth < 0 || numericDepth > 9999) {
        advanced.open = true;
        status.textContent = 'Choose an insertion depth from 0 to 9999.';
        depth.focus();
        return;
      }
      const note = text.value.trim() ? { ...originalNote, content: text.value, depth: numericDepth, role: role.value as NoteRole } : null;
      saving = true;
      setEditable(false);
      status.textContent = 'Saving chat memory…';
      try {
        const granted = await ctx.permissions.getGranted();
        if (!current()) return;
        if (!granted.includes('chats')) {
          status.textContent = 'Enable Janiverse’s Chats permission in Extensions to save chat memory.';
          return;
        }
        const response = await fetch(`/api/v1/chats/${encodeURIComponent(chatId)}/metadata`, {
          method: 'PATCH', credentials: 'same-origin', signal: session.abort.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authors_note: note }),
        });
        if (!response.ok) throw new Error('save');
        if (current()) modal.dismiss();
      } catch {
        if (current()) status.textContent = 'Could not save chat memory. Your changes are still here; try again.';
      } finally {
        saving = false;
        if (current()) setEditable(true);
      }
    }
    void load();
  }

  function destroy() {
    disposed = true;
    active?.modal.dismiss();
    active = undefined;
  }
  return { open, destroy };
}
