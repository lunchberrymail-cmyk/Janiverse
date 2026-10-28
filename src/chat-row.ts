import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { icon } from './icons';

type Chat = { id: string; name: string };
type Options = {
  current(): boolean;
  renamed(name: string): void;
  deleted(): void;
  refresh(): void;
  closed(): void;
};

/** Row actions are siblings of Continue, so editing never opens the conversation. */
export function addChatRowActions(ctx: SpindleFrontendContext, row: HTMLElement, chat: Chat, options: Options) {
  const actions = document.createElement('div'); actions.className = 'jb-mc-row-actions';
  const editor = document.createElement('form'); editor.className = 'jb-mc-conversation-editor'; editor.hidden = true;
  let busy = false, mode: 'rename' | 'delete' = 'rename';
  const current = () => options.current() && row.isConnected;
  function action(label: string, glyph: 'edit' | 'trash', run: () => void) {
    const node = document.createElement('button'); node.type = 'button'; node.className = `jb-mc-row-action jb-mc-${glyph}`;
    node.title = label; node.setAttribute('aria-label', `${label}: ${chat.name || 'Untitled chat'}`); node.append(icon(glyph));
    node.addEventListener('click', () => { if (current() && !busy) run(); }); return node;
  }
  const rename = action('Rename chat', 'edit', () => open('rename'));
  const remove = action('Delete chat', 'trash', () => open('delete'));
  actions.append(rename, remove); row.append(actions, editor);
  function close() {
    if (busy) return;
    editor.hidden = true; editor.replaceChildren(); (mode === 'rename' ? rename : remove).focus(); options.closed();
  }
  function open(next: typeof mode) {
    mode = next; editor.replaceChildren(); editor.hidden = false;
    const label = document.createElement('label'); label.className = 'jb-mc-editor-label';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 200; input.value = chat.name;
    input.setAttribute('aria-label', 'Chat name'); input.autocomplete = 'off'; input.required = true;
    if (mode === 'rename') { label.append('Chat name', input); editor.append(label); }
    else { const message = document.createElement('p'); message.className = 'jb-mc-delete-warning'; message.textContent = `Delete “${chat.name || 'Untitled chat'}”? This permanently deletes this conversation and its messages.`; editor.append(message); }
    const status = document.createElement('p'); status.className = 'jb-mc-editor-status'; status.setAttribute('role', 'status');
    const controls = document.createElement('div'); controls.className = 'jb-mc-editor-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', close);
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = mode === 'rename' ? 'Save name' : 'Delete chat'; save.className = mode === 'delete' ? 'jb-mc-delete-confirm' : 'jb-mc-save-name';
    const enable = document.createElement('button'); enable.type = 'button'; enable.textContent = 'Enable Chats permission'; enable.hidden = true;
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Refresh chats'; refresh.hidden = true;
    refresh.addEventListener('click', () => { if (current() && !busy) options.refresh(); });
    controls.append(cancel, enable, refresh, save); editor.append(status, controls);
    function pending(value: boolean) {
      busy = value; row.setAttribute('aria-busy', String(value));
      for (const control of [rename, remove, cancel, enable, save, refresh, input]) control.disabled = value;
    }
    enable.addEventListener('click', async () => {
      if (!current() || busy) return; pending(true);
      try {
        await ctx.permissions.request(['chats'], { reason: 'Rename or delete the conversation you select in My Chats.' });
        if (!current()) return;
        const granted = await ctx.permissions.getGranted(); if (!current()) return;
        enable.hidden = granted.includes('chats'); save.disabled = !enable.hidden;
        status.textContent = enable.hidden ? 'Chats permission enabled. Confirm your change below.' : 'Chats permission is still disabled.';
      } catch { if (current()) status.textContent = 'Could not enable Chats permission. Try again.'; }
      finally { if (current()) { pending(false); save.disabled = !enable.hidden; } }
    });
    editor.onsubmit = async event => {
      event.preventDefault(); if (!current() || busy) return;
      const name = input.value.trim(); if (mode === 'rename' && !name) { status.textContent = 'Enter a chat name.'; input.focus(); return; }
      pending(true); status.textContent = '';
      let submitted = false;
      try {
        const granted = await ctx.permissions.getGranted(); if (!current()) return;
        if (!granted.includes('chats')) { enable.hidden = false; status.textContent = 'Enable Chats permission to save this change.'; return; }
        submitted = true;
        if (mode === 'rename') {
          const result = await ctx.chats.update(chat.id, { name });
          if (!current()) return;
          if (result?.id !== chat.id || typeof result.name !== 'string') throw new Error('Unexpected chat response');
          chat.name = result.name;
          rename.setAttribute('aria-label', `Rename chat: ${chat.name || 'Untitled chat'}`);
          remove.setAttribute('aria-label', `Delete chat: ${chat.name || 'Untitled chat'}`);
          pending(false); close();
          options.renamed(result.name);
        } else { await ctx.chats.delete(chat.id); if (current()) options.deleted(); }
      } catch {
        if (!current()) return;
        status.textContent = submitted ? 'Could not confirm the change. Refresh chats to check before trying again.' : 'Could not check Chats permission. Try again.';
        refresh.hidden = !submitted; save.hidden = submitted;
      } finally { if (current()) { pending(false); save.disabled = !enable.hidden; } }
    };
    editor.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    (mode === 'rename' ? input : cancel).focus(); if (mode === 'rename') input.select();
  }
}
