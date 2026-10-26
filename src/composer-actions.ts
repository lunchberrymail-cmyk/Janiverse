import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { uuid } from './uuid';

type Action = 'enhance' | 'write' | 'summarize';
type Options = { openMemoryDraft: (chatId: string, text: string) => void };
type Session = { modal: SpindleModalHandle; id: string; chatId: string; closed: boolean; pending: boolean; timer?: ReturnType<typeof setTimeout> };
const channel = 'janitor_bridge:composer';
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', content = '') { const element = document.createElement(tag); element.className = cls; element.textContent = content; return element; }

/** Explicit writing assistance. Results stay in a review modal until the user applies them. */
export function createComposerActions(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false;
  let active: Session | undefined;
  let onResult: ((payload: Record<string, unknown>) => void) | undefined;
  const offBackend = ctx.onBackendMessage(payload => {
    const result = object(payload);
    if (result.type === channel && active?.pending && result.id === active.id && result.chatId === active.chatId && !active.closed) onResult?.(result);
  });
  const offComposer = ctx.composer?.onChange(state => {
    if (active && (!state.mounted || state.chatId !== active.chatId)) active.modal.dismiss();
  });
  function open(action: Action) {
    if (disposed) return;
    const composer = ctx.composer;
    const state = composer?.getState();
    const chatId = ctx.getActiveChat().chatId;
    if (!composer || !state?.mounted || !chatId || state.chatId !== chatId) return;
    active?.modal.dismiss();
    const title = action === 'enhance' ? 'Enhance my draft' : action === 'write' ? 'Write something for me' : 'Summarize this chat';
    const modal = ctx.ui.showModal({ title, width: 680, maxHeight: 780 });
    const session: Session = { modal, id: uuid(), chatId, closed: false, pending: false };
    active = session;
    const originalDraft = state.text;
    const current = () => !disposed && active === session && !session.closed && composer.getState().chatId === chatId && ctx.getActiveChat().chatId === chatId;
    modal.root.classList.add('jb-settings', 'jb-composer-assistance');
    const heading = node('h2', '', title);
    const help = node('p', 'jb-settings-help', action === 'summarize' ? 'Review the generated summary before opening it in Chat Memory. Saving stays your choice.' : 'Review and edit the suggestion before applying it to your message.');
    const label = node('label', 'jb-settings-field', action === 'summarize' ? 'Suggested memory' : 'Suggested message');
    const result = node('textarea', 'jb-settings-textarea'); result.name = 'composer-assistance-result'; result.rows = 11; result.disabled = true;
    label.append(result);
    const status = node('p', 'jb-settings-status', 'Preparing…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'jb-settings-actions');
    const cancel = node('button', 'jb-button', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => modal.dismiss());
    const allow = node('button', 'jb-button', 'Allow writing assistance'); allow.type = 'button'; allow.hidden = true;
    const generate = node('button', 'jb-button', 'Generate'); generate.type = 'button'; generate.hidden = true;
    const apply = node('button', 'jb-button jb-primary', action === 'summarize' ? 'Review in Chat Memory' : 'Apply to message'); apply.type = 'button'; apply.disabled = true;
    const overwriteLabel = node('label', 'jb-settings-checkbox'); const overwrite = node('input'); overwrite.type = 'checkbox'; overwrite.name = 'replace-changed-draft'; overwriteLabel.append(overwrite, node('span', '', 'Replace the message I edited while this was generating')); overwriteLabel.hidden = true;
    actions.append(cancel, allow, generate, apply); modal.root.append(heading, help, label, status, overwriteLabel, actions);
    const lock = (pending: boolean) => { session.pending = pending; apply.disabled = pending || !result.value.trim(); generate.disabled = pending; result.disabled = pending; };
    const cancelRequest = () => { if (session.pending) ctx.sendToBackend({ type: channel, command: 'cancel', id: session.id }); clearTimeout(session.timer); };
    modal.onDismiss(() => { cancelRequest(); session.closed = true; result.value = ''; if (active === session) { active = undefined; onResult = undefined; } });
    const complete = (payload: Record<string, unknown>) => {
      if (!current()) return;
      clearTimeout(session.timer); lock(false); generate.hidden = false; generate.textContent = 'Try again';
      const content = string(payload.content);
      if (content) { result.value = content; apply.disabled = false; status.textContent = 'Ready to review.'; result.focus(); }
      else status.textContent = payload.error === 'permission' ? 'Allow Chats and Generation before generating a suggestion.' : payload.error === 'connection-unavailable' ? 'Choose an API configuration first.' : payload.error === 'empty' ? 'The model returned no text. You can try again.' : payload.error === 'cancelled' ? 'Generation was cancelled or timed out. You can try again.' : 'Could not generate a suggestion. Check the API configuration and try again.';
    };
    onResult = complete;
    async function run() {
      if (!current() || session.pending) return;
      if (action === 'enhance' && !originalDraft.trim()) { status.textContent = 'Write a draft in your message first, then choose Enhance my draft.'; return; }
      lock(true); allow.hidden = true; generate.hidden = true; status.textContent = 'Using this chat’s API and context…';
      try {
        const granted = await ctx.permissions.getGranted();
        if (!current()) return;
        if (!granted.includes('generation') || !granted.includes('chats')) { lock(false); allow.hidden = false; generate.hidden = false; status.textContent = 'Allow Chats and Generation to use your configured API for this action.'; return; }
        if (!ctx.frontendSessionId) { lock(false); status.textContent = 'This Lumiverse version cannot safely route writing suggestions. Update Lumiverse and reload.'; return; }
        const connection = object(ctx.state?.get('connections.active'));
        session.id = uuid();
        ctx.sendToBackend({ type: channel, command: 'generate', id: session.id, action, chatId, draft: originalDraft,
          connectionId: string(connection.activeProfileId), personaId: string(ctx.state?.get('persona.activeId')), presetId: string(ctx.state?.get('loom.activePresetId')) });
        session.timer = setTimeout(() => { if (current() && session.pending) { cancelRequest(); complete({ error: 'cancelled' }); } }, 125_000);
      } catch { if (current()) { lock(false); generate.hidden = false; status.textContent = 'Could not start writing assistance. Try again.'; } }
    }
    allow.addEventListener('click', () => {
      allow.disabled = true;
      void ctx.permissions.request(['chats', 'generation'], { reason: 'Use your configured API to generate a writing suggestion or chat summary only when you choose it.' }).then(granted => {
        if (!current()) return;
        allow.hidden = granted.includes('chats') && granted.includes('generation'); status.textContent = allow.hidden ? 'Ready. Choose Generate to continue.' : 'Writing assistance needs Chats and Generation.';
      }).catch(() => { if (current()) status.textContent = 'Permission was not granted. Your message is unchanged.'; }).finally(() => { if (current()) allow.disabled = false; });
    });
    generate.addEventListener('click', () => void run());
    result.addEventListener('input', () => { if (!session.pending) apply.disabled = !result.value.trim(); });
    apply.addEventListener('click', () => {
      if (!current() || session.pending || !result.value.trim()) return;
      const value = result.value;
      if (action === 'summarize') { modal.dismiss(); options.openMemoryDraft(chatId, value); return; }
      if (composer.getState().text !== originalDraft && !overwrite.checked) { overwriteLabel.hidden = false; status.textContent = 'You edited your message while the suggestion was being generated. Confirm replacement to apply it.'; return; }
      composer.setText(value); modal.dismiss(); composer.focus();
    });
    void run();
  }
  return { enhanceDraft: () => open('enhance'), writeForMe: () => open('write'), summarizeChat: () => open('summarize'),
    destroy() { disposed = true; active?.modal.dismiss(); offBackend(); offComposer?.(); active = undefined; onResult = undefined; } };
}
