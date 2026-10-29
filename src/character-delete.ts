import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { uuid } from './uuid';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; }

/** One selected saved record, confirmed by the host's durable deletion operation. */
export function mountCharacterDelete(ctx: SpindleFrontendContext, root: HTMLElement, character: { id: string; name: string }, onDeleted: () => void, buttonHost: HTMLElement = root) {
  let disposed = false, busy = false, operationId: string | undefined;
  const controller = new AbortController();
  const open = el('button', 'Delete card', 'jb-button jb-delete-card'); open.type = 'button';
  const confirmation = el('section', '', 'jb-delete-confirmation'); confirmation.hidden = true; confirmation.setAttribute('aria-label', 'Confirm card deletion');
  const warning = el('p', `Delete “${character.name}”? This deletes this saved copy and its chats, and removes it from groups. Other saved copies stay in your library.`);
  const identity = el('small', `Selected copy: ${character.id}`), status = el('p', '', 'jb-status'); status.setAttribute('role', 'status');
  const remove = el('button', 'Delete this copy', 'jb-button jb-delete-card'), cancel = el('button', 'Cancel', 'jb-button'); remove.type = cancel.type = 'button';
  confirmation.append(warning, identity, remove, cancel, status); buttonHost.append(open); root.append(confirmation);
  const render = () => { remove.disabled = cancel.disabled = busy; remove.textContent = busy ? 'Deleting…' : operationId ? 'Check deletion status' : 'Delete this copy'; };
  open.addEventListener('click', () => { if (disposed || busy) return; open.hidden = true; confirmation.hidden = false; cancel.focus(); });
  cancel.addEventListener('click', () => { if (disposed || busy) return; confirmation.hidden = true; open.hidden = false; open.focus(); });
  async function check(value: unknown): Promise<boolean> {
    if (disposed) return false;
    const operation = record(value);
    if (operation.operationId !== operationId || operation.entityId !== character.id || operation.entity !== 'character') return false;
    if (operation.status === 'completed') { onDeleted(); return true; }
    // The host reports a failed operation as final, so a new deletion attempt is safe.
    if (operation.status === 'failed') { operationId = undefined; throw new Error('Deletion failed. Your library may need refreshing before trying again.'); }
    return false;
  }
  async function run() {
    if (disposed || busy) return;
    busy = true; status.textContent = 'Deleting this saved copy…'; render();
    try {
      if (!operationId) {
        let granted = await ctx.permissions.getGranted(); if (disposed) return;
        if (!granted.includes('characters')) {
          await ctx.permissions.request(['characters'], { reason: 'Delete the saved character copy you confirmed.' }); if (disposed) return;
          granted = await ctx.permissions.getGranted(); if (disposed) return;
          if (!granted.includes('characters')) throw new Error('Enable Janiverse’s Characters permission in Extensions to delete cards.');
        }
        const value = record(await ctx.characters.get(character.id));
        if (disposed) return;
        if (value.id !== character.id || value.name !== character.name) throw new Error('This card changed. Reopen its profile before deleting it.');
        operationId = uuid();
        try {
          const response = await fetch(`/api/v1/characters/${encodeURIComponent(character.id)}?operation_id=${encodeURIComponent(operationId)}`, { method: 'DELETE', credentials: 'same-origin', signal: controller.signal });
          if (disposed) return;
          if (!response.ok) { if (response.status >= 400 && response.status < 500) operationId = undefined; throw new Error('The card could not be deleted. Refresh your library and try again.'); }
          if (await check(await response.json())) return;
        } catch (error) { if (disposed || !operationId) throw error; /* Lost response: query the same operation; never repeat DELETE. */ }
      }
      for (let attempt = 0; attempt < 30 && !disposed; attempt++) {
        try {
          const response = await fetch(`/api/v1/characters/deletions/${encodeURIComponent(operationId!)}`, { credentials: 'same-origin', signal: controller.signal });
          if (disposed) return;
          if (response.ok && await check(await response.json())) return;
          if ([401, 403].includes(response.status)) throw new Error('You do not have permission to delete this card.');
        } catch (error) { if (disposed) return; if (error instanceof Error && /Deletion failed|permission/.test(error.message)) throw error; }
        await new Promise<void>(resolve => { const timer = setTimeout(done, 1000); function done() { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); } controller.signal.addEventListener('abort', done, { once: true }); });
      }
      if (!disposed) status.textContent = 'Deletion is not confirmed yet. Check its status or refresh your library before trying again.';
    } catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : 'Could not confirm deletion. Refresh your library.'; }
    finally { busy = false; if (!disposed) render(); }
  }
  remove.addEventListener('click', () => { void run(); });
  return () => { disposed = true; controller.abort(); open.remove(); confirmation.remove(); };
}
