import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleModalHandle } from 'lumiverse-spindle-types';

/** Janiverse's own shortcuts; native sidebar tabs use a host ref instead. */
export type GlossaryAction = 'home' | 'myChats' | 'createCharacter' | 'importCards' | 'importHistory' | 'prompt' | 'generation' | 'memory' | 'customize' | 'replies';
type Target = { action: GlossaryAction } | { ref: SpindleHostSurfaceRef };
export type GlossaryEntry = {
  janitor: string;
  aliases?: string[];
  lumiverse: string;
  detail: string;
  show?: Target & { label?: string; needsChat?: boolean };
};
type Options = {
  invoke(ref: SpindleHostSurfaceRef): Promise<boolean>;
  actions: Record<GlossaryAction, () => void | boolean | Promise<void | boolean>>;
};

export const glossary: GlossaryEntry[] = [
  { janitor: 'Bots', aliases: ['characters', 'bot list'], lumiverse: 'Characters', detail: 'Your saved cards. Janiverse Home shows them as a gallery; the Chars tab in Lumiverse’s sidebar is the full library.', show: { ref: { kind: 'drawer_tab', id: 'characters' }, label: 'Open Characters' } },
  { janitor: 'Create a Character', aliases: ['make a bot', 'new bot'], lumiverse: 'Create a Character', detail: 'Janiverse’s form saves a normal Lumiverse card. Lumiverse’s Creator Workshop has more fields.', show: { action: 'createCharacter' } },
  { janitor: 'Bot link or card file', aliases: ['import', 'download bot', 'png card'], lumiverse: 'Import characters', detail: 'Bring JanitorAI cards over as files or links. Cards don’t include old messages.', show: { action: 'importCards', label: 'Import characters' } },
  { janitor: 'Old chat history', aliases: ['export chat', 'chat history', 'jar'], lumiverse: 'Import old chats (JAR Bridge)', detail: 'Old conversations need the optional JAR Bridge extension; cards and chats import separately.', show: { action: 'importHistory', label: 'Import old chats' } },
  { janitor: 'My Chats', aliases: ['recent chats', 'chat list'], lumiverse: 'My Chats', detail: 'Every conversation grouped by character. Lumiverse’s own Home also lists recent chats.', show: { action: 'myChats', label: 'Open My Chats' } },
  { janitor: 'Favorites', aliases: ['heart', 'liked bots'], lumiverse: 'Favorites', detail: 'The heart on a card saves it to Lumiverse’s favorites. Use ♥ Favorites on Home to filter.', show: { action: 'home', label: 'Open Home' } },
  { janitor: 'API Settings', aliases: ['proxy', 'openai', 'api key', 'model'], lumiverse: 'Connections', detail: 'Each connection holds a provider, key and model. Choose one as active.', show: { ref: { kind: 'drawer_tab', id: 'connections' }, label: 'Open Connections' } },
  { janitor: 'JanitorLLM (JLLM)', aliases: ['free model', 'jllm'], lumiverse: 'No built-in model', detail: 'Lumiverse doesn’t include a free model. Add a connection to an AI provider you choose; availability and cost depend on that provider.', show: { ref: { kind: 'drawer_tab', id: 'connections' }, label: 'Open Connections' } },
  { janitor: 'Generation Settings', aliases: ['temperature', 'max new tokens', 'context size', 'samplers'], lumiverse: 'Preset samplers', detail: 'Temperature, reply length and context size live in your preset. Janiverse’s Generation tab edits the common ones.', show: { action: 'generation', label: 'Open Generation' } },
  { janitor: 'Advanced Prompts', aliases: ['custom prompt', 'system prompt', 'jailbreak'], lumiverse: 'Preset (Loom)', detail: 'Paste a JanitorAI custom prompt in Janiverse’s Prompt settings. Full presets are edited in the Preset tab.', show: { action: 'prompt', label: 'Open Prompt' } },
  { janitor: 'Chat Memory', aliases: ['memory', 'pinned facts'], lumiverse: 'Author’s Note', detail: 'Janiverse’s Chat Memory saves to this chat’s Author’s Note.', show: { action: 'memory', label: 'Open Chat Memory', needsChat: true } },
  { janitor: 'Auto summary', aliases: ['summarize', 'long memory'], lumiverse: 'Summary & Memory Cortex', detail: 'Lumiverse can summarize long chats and recall older events automatically. Both are optional.', show: { ref: { kind: 'drawer_tab', id: 'summary' }, label: 'Open Summary' } },
  { janitor: 'Personas', aliases: ['user persona', 'who i play'], lumiverse: 'Personas', detail: 'Same idea: who you play. Pick one per chat or set a default.', show: { ref: { kind: 'drawer_tab', id: 'personas' }, label: 'Open Personas' } },
  { janitor: 'Scripts', aliases: ['lorebook', 'advanced scripts'], lumiverse: 'Lorebook (World Info)', detail: 'Entries that add details when keywords appear. JanitorAI script logic does not carry over; lorebook entries do.', show: { ref: { kind: 'drawer_tab', id: 'lorebook' }, label: 'Open Lorebook' } },
  { janitor: 'Reroll', aliases: ['regenerate', 'swipe', 'rewrite', 'arrows'], lumiverse: 'Regenerate & swipes', detail: 'Regenerate makes another version; ‹ and › on the reply switch between versions.', show: { action: 'replies', label: 'Show reply controls' } },
  { janitor: 'Edit or delete a message', aliases: ['edit message', 'delete message'], lumiverse: 'Message actions', detail: 'Use the pencil or trash on the message itself.', show: { action: 'replies', label: 'Show reply controls' } },
  { janitor: 'Customize', aliases: ['chat appearance', 'background', 'font', 'text streaming'], lumiverse: 'Customize, Wallpaper & Theme', detail: 'Janiverse Customize changes this chat’s background and text. Lumiverse’s Theme and Wallpaper tabs go further.', show: { action: 'customize', label: 'Open Customize', needsChat: true } },
  { janitor: 'Bot profile', aliases: ['creator’s note', 'creator note', 'bot page'], lumiverse: 'Character profile', detail: 'Click a card on Home to read its Creator’s Note and definition, then start or continue a chat.', show: { action: 'home', label: 'Open Home' } },
];

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}
const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '');

/** Read-only JanitorAI → Lumiverse map; Show me opens the native or Janiverse tool. */
export function openGlossary(ctx: SpindleFrontendContext, options: Options, entries: GlossaryEntry[] = glossary): SpindleModalHandle {
  const modal = ctx.ui.showModal({ title: 'Where did it go?', width: 560, maxHeight: 760 });
  const root = modal.root; root.classList.add('jb-settings', 'jb-glossary'); root.setAttribute('aria-label', 'JanitorAI to Lumiverse glossary');
  let closed = false; modal.onDismiss(() => { closed = true; });
  const intro = make('p', 'jb-glossary-intro', 'Find a JanitorAI feature by its familiar name. Show me opens where it lives here.');
  const search = make('input', 'jb-glossary-search'); search.type = 'search'; search.placeholder = 'Search JanitorAI terms…'; search.setAttribute('aria-label', 'Search JanitorAI terms');
  const status = make('p', 'jb-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = make('div', 'jb-glossary-list'), empty = make('p', 'jb-glossary-empty', 'No match. Try another word, or open Help for setup guides.'); empty.hidden = true;
  const rows: Array<{ row: HTMLElement; text: string }> = [];
  for (const entry of entries) {
    const row = make('article', 'jb-glossary-row'), names = make('div', 'jb-glossary-names');
    names.append(make('h3', 'jb-glossary-janitor', entry.janitor), make('span', 'jb-glossary-arrow', '→'), make('strong', 'jb-glossary-lumiverse', entry.lumiverse));
    row.append(names, make('p', 'jb-glossary-detail', entry.detail));
    if (entry.show) {
      const show = entry.show, action = make('button', 'jb-button', show.label ?? 'Show me'); action.type = 'button';
      if (show.needsChat && !ctx.getActiveChat()?.chatId) { action.disabled = true; action.title = 'Open a chat first.'; }
      action.addEventListener('click', () => {
        if (closed || action.disabled) return;
        action.disabled = true; status.textContent = '';
        void Promise.resolve().then(() => 'ref' in show ? options.invoke(show.ref) : options.actions[show.action]())
          .then(opened => { if (closed) return; if (opened === false) status.textContent = 'Could not open that tool here. Open it from Lumiverse’s sidebar instead.'; else modal.dismiss(); })
          .catch(error => { if (!closed) status.textContent = error instanceof Error && error.message ? error.message : 'Could not open that tool. Please try again.'; })
          .finally(() => { if (!closed) action.disabled = false; });
      });
      row.append(action);
    }
    list.append(row); rows.push({ row, text: normalize([entry.janitor, entry.lumiverse, ...(entry.aliases ?? [])].join(' ')) });
  }
  search.addEventListener('input', () => {
    const query = normalize(search.value.trim()); let shown = 0;
    for (const { row, text } of rows) { row.hidden = !!query && !text.includes(query); if (!row.hidden) shown++; }
    empty.hidden = shown > 0;
  });
  root.append(intro, search, status, list, empty); search.focus({ preventScroll: true });
  return modal;
}
