import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { readOptionalState } from './optional-state';
import { providerName, readConnection, readPrompt, readSetupJson, record, text, watchSetup, type Row } from './setup-data';

type Options = { openPersona(): void; openApi(): void; openPrompt(): void };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };

/** A view of the next reply's saved selections. Opening it performs no writes. */
export function createChatSetup(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, epoch = 0, chatId = '';
  let abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const root = make('section', 'jb-chat-setup'); root.setAttribute('aria-label', 'Current chat setup'); root.hidden = true;
  function chip(label: string, action: () => void) {
    const button = make('button', 'jb-chat-setup-chip'); button.type = 'button';
    const caption = make('span', 'jb-chat-setup-label', label), value = make('span', 'jb-chat-setup-value', 'Loading…'), source = make('span', 'jb-chat-setup-source');
    button.append(caption, value, source); root.append(button);
    button.addEventListener('click', () => { if (!disposed && chatId && currentChat() === chatId && !button.disabled) action(); });
    return { button, value, source, set(name: string, scope: string) { value.textContent = name; source.textContent = scope; button.title = `${label}: ${name}${scope ? ` · ${scope}` : ''}`; button.setAttribute('aria-label', `${label}: ${name}. ${scope ? `${scope}. ` : ''}Change ${label === 'Playing as' ? 'persona' : label.toLowerCase()}.`); } };
  }
  const persona = chip('Playing as', options.openPersona), model = chip('Model', options.openApi), prompt = chip('Prompt', options.openPrompt);
  const notice = make('p', 'jb-chat-setup-notice'); notice.setAttribute('role', 'status'); notice.hidden = true;
  const retry = make('button', 'jb-chat-setup-retry', 'Refresh setup'); retry.type = 'button'; retry.hidden = true; root.append(notice, retry);
  function currentChat() { return document.defaultView?.location.pathname.startsWith('/chat/') ? ctx.getActiveChat()?.chatId || '' : ''; }
  function reset() { persona.set('Loading…', ''); model.set('Loading…', ''); prompt.set('Loading…', ''); persona.button.disabled = false; }
  async function refresh() {
    if (disposed) return;
    const id = currentChat();
    if (chatId !== id) { chatId = id; reset(); }
    const generation = ++epoch; abort?.abort(); root.hidden = !id; if (!id) return;
    abort = new AbortController(); const signal = abort.signal;
    const current = () => !disposed && generation === epoch && currentChat() === id;
    notice.hidden = retry.hidden = true;
    let metadata: Row;
    try {
      const chat = record(await readSetupJson(`/chats/${encodeURIComponent(id)}?messages=false`, signal));
      if (!current()) return;
      if (chat.id !== id) throw new Error('Wrong conversation');
      metadata = record(chat.metadata);
    } catch {
      if (current()) { persona.set('Unavailable', ''); model.set('Unavailable', ''); prompt.set('Unavailable', ''); notice.textContent = 'Couldn’t read this chat’s setup.'; notice.hidden = retry.hidden = false; }
      return;
    }
    const connectionTask = readConnection(ctx, signal, metadata);
    const personaId = metadata.temporary === true ? '' : text(readOptionalState(ctx, 'persona.activeId', text(metadata.active_persona_id)));
    const results = await Promise.allSettled([
      personaId ? readSetupJson(`/personas/${encodeURIComponent(personaId)}`, signal).then(value => { const row = record(value); if (row.id !== personaId || !text(row.name)) throw new Error('Invalid persona'); return row; }) : Promise.resolve(null),
      connectionTask, connectionTask.then(connection => readPrompt(ctx, signal, connection, { id, metadata })),
    ]);
    if (!current()) return;
    const [identity, connection, selection] = results;
    if (identity.status === 'fulfilled') {
      persona.set(identity.value ? text(identity.value.name) : 'No persona', metadata.temporary === true ? 'Temporary chat' : identity.value && text(metadata.active_persona_id) === personaId ? 'This chat' : 'Current selection');
      persona.button.disabled = metadata.temporary === true;
    } else persona.set('Unavailable', 'Open Personas');
    if (connection.status === 'fulfilled') {
      const value = connection.value;
      model.set(value?.model || 'Choose a model', value ? `${providerName(value.provider)} · ${value.source === 'chat' ? 'This chat' : value.source === 'active' ? 'Active connection' : 'Default connection'}` : 'Set up a connection');
    } else model.set('Unavailable', 'Open API settings');
    if (selection.status === 'fulfilled') prompt.set(selection.value?.name || 'No preset selected', selection.value?.source || 'Optional');
    else prompt.set('Unavailable', 'Open prompt settings');
    if (results.some(result => result.status === 'rejected')) { notice.textContent = 'Some setup details couldn’t be checked.'; notice.hidden = retry.hidden = false; }
  }
  retry.addEventListener('click', () => { void refresh(); });
  const stop = watchSetup(ctx, () => { if (!disposed && currentChat()) { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 100); } else sync(); });
  function sync() { if (!disposed && currentChat() !== chatId) { clearTimeout(timer); void refresh(); } }
  return { root, refresh, sync, destroy() { disposed = true; epoch++; abort?.abort(); clearTimeout(timer); stop(); root.remove(); } };
}
