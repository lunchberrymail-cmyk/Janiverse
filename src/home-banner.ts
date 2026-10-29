import type { SpindleFrontendContext, SpindleHostSurfaceRef } from 'lumiverse-spindle-types';
import { createSetupChecklist } from './setup-checklist';

type Options = {
  openApi: () => void;
  openImport: () => void;
  openPersona: () => void;
  openPrompt: () => void;
  chooseCharacter: () => void;
  openHelp: () => void;
};
type MemoryOptions = { invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean> };
const memoryTools = {
  summary: { kind: 'drawer_tab', id: 'summary' },
  cortex: { kind: 'settings_tab', id: 'memoryCortex' },
} as const satisfies Record<string, SpindleHostSurfaceRef>;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}

/** A compact invitation for the chat/settings ad space. Opening setup never runs a summary. */
export function createMemoryPromo(_ctx: SpindleFrontendContext, options: MemoryOptions) {
  let disposed = false;
  const root = make('section', 'jb-memory-promo'); root.setAttribute('aria-label', 'Improve chat memory');
  const title = make('h3', '', 'Give your characters more memory.');
  const description = make('p', '', 'Keep a recap with Summary, or recall important facts with Memory Cortex. Pick one; they don’t mix.');
  const actions = make('div', 'jb-memory-promo-actions');
  const status = make('p', 'jb-memory-promo-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  for (const [label, ref] of [['Set up summaries', memoryTools.summary], ['Explore Memory Cortex', memoryTools.cortex]] as const) {
    const button = make('button', '', label); button.type = 'button';
    button.addEventListener('click', () => {
      if (disposed) return;
      void options.invoke(ref).then(ok => {
        if (!disposed) status.textContent = ok ? '' : 'This memory tool is unavailable. Try opening it from Lumiverse’s sidebar.';
      }).catch(() => { if (!disposed) status.textContent = 'Could not open this memory tool. Please try again from Lumiverse’s sidebar.'; });
    });
    actions.append(button);
  }
  root.append(title, description, actions, status);
  return { root, destroy() { disposed = true; root.remove(); } };
}

/** Preset discovery links stay ordinary links; no requests run until a user follows one. */
export function createPresetPromo(_ctx?: SpindleFrontendContext) {
  const root = make('section', 'jb-memory-promo jb-preset-promo'); root.setAttribute('aria-label', 'Explore writing presets');
  const title = make('h3', '', 'Try a new preset.');
  const description = make('p', '', 'Find a writing style you like on Illarin or in the community’s Discord presets channel.');
  const actions = make('div', 'jb-memory-promo-actions');
  function link(label: string, url: string, className = 'jb-promo-link') {
    const anchor = make('a', className, label); anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
    anchor.referrerPolicy = 'no-referrer'; return anchor;
  }
  actions.append(
    link('Browse presets', 'https://illarin.com/browse?type=preset'),
    link('Presets on Discord', 'https://discord.com/channels/1484149939167821915/1484156801447497792'),
  );
  const invite = make('p', 'jb-preset-promo-invite', 'New to the server? ');
  invite.append(link('Join Discord', 'https://discord.gg/28rBWVFfCu', ''));
  root.append(title, description, actions, invite);
  return { root, destroy() { root.remove(); } };
}

/** The one setup checklist. Guides and later ideas live in Help. */
export function createHomeBanner(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false;
  const root = make('section', 'jb-discover jb-discover-basics'); root.setAttribute('aria-label', 'Your setup checklist'); root.dataset.idea = 'basics';
  const content = make('div', 'jb-discover-content');
  const eyebrow = make('p', 'jb-discover-eyebrow', 'START HERE');
  const title = make('h2', 'jb-discover-title', 'Let’s do the basics.');
  const description = make('p', 'jb-discover-description', 'Connect your AI and add a character card to start chatting. A persona and prompt are optional.');
  const footer = make('div', 'jb-discover-footer');
  const help = make('button', 'jb-discover-tutorial', 'Guides & help'); help.type = 'button';
  footer.append(help);
  const checklist = createSetupChecklist(ctx, { ...options, dismissed: () => { if (!disposed) root.hidden = true; } });
  content.append(eyebrow, title, description, checklist.root, footer); root.append(content);
  help.addEventListener('click', () => { if (!disposed) options.openHelp(); });
  return { root,
    activate() { if (!disposed) checklist.activate(); },
    deactivate() { checklist.deactivate(); },
    reviewSetup() { if (disposed) return; root.hidden = false; checklist.review(); },
    destroy() { disposed = true; checklist.destroy(); root.remove(); },
  };
}
