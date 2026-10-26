import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleModalHandle } from 'lumiverse-spindle-types';
import { icon } from './icons';
import { createLunchPicks } from './lunch-picks';
import type { TutorialFeature } from './feature-tutorials';

type Options = {
  invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean>;
  openApi: () => void;
  openImport: () => void;
  openPersona: () => void;
  openPrompt: () => void;
  openTutorial?: (feature: TutorialFeature) => void;
};
type MemoryOptions = Pick<Options, 'invoke'>;
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
  const description = make('p', '', 'Keep a recap with Summary, or recall important facts with Memory Cortex.');
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

/** A quiet, user-paced introduction: one idea and one next step at a time. */
export function createHomeBanner(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, index = 0;
  let picksModal: SpindleModalHandle | undefined;
  const root = make('section', 'jb-discover'); root.setAttribute('aria-label', 'Discover more of Lumiverse');
  const content = make('div', 'jb-discover-content');
  const eyebrow = make('p', 'jb-discover-eyebrow', 'A LITTLE MORE LUMIVERSE');
  const title = make('h2', 'jb-discover-title');
  const description = make('p', 'jb-discover-description');
  const actions = make('div', 'jb-discover-actions');
  const tryButton = make('button', 'jb-discover-primary'); tryButton.type = 'button';
  const cardButton = make('button', 'jb-discover-import', '2. Add a card'); cardButton.type = 'button'; cardButton.prepend(icon('import'));
  const personaButton = make('button', 'jb-discover-import', '3. Create a persona'); personaButton.type = 'button'; personaButton.prepend(icon('persona'));
  const promptButton = make('button', 'jb-discover-import', '4. Preset or prompt (optional)'); promptButton.type = 'button'; promptButton.prepend(icon('prompt'));
  const cortexButton = make('button', 'jb-discover-import', 'Explore Memory Cortex'); cortexButton.type = 'button'; cortexButton.prepend(icon('embeddings'));
  actions.append(tryButton, cardButton, personaButton, promptButton, cortexButton);
  const footer = make('div', 'jb-discover-footer');
  const progress = make('span', 'jb-discover-progress'); progress.setAttribute('aria-live', 'polite');
  const next = make('button', 'jb-discover-next', 'Next idea'); next.type = 'button'; next.append(icon('arrow'));
  const tutorial = make('button', 'jb-discover-tutorial', 'Full tutorial'); tutorial.type = 'button';
  footer.append(progress, tutorial, next);
  const status = make('p', 'jb-discover-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  content.append(eyebrow, title, description, actions, footer, status);
  const art = make('div', 'jb-discover-art'); art.setAttribute('aria-hidden', 'true');
  for (const [picture, cls] of [['all-chats', 'back'], ['extension', 'middle'], ['embeddings', 'front']] as const) {
    const card = make('div', `jb-discover-card jb-discover-card-${cls}`);
    card.append(icon(picture), make('span', 'jb-discover-card-line'), make('span', 'jb-discover-card-line jb-discover-card-line-short'));
    art.append(card);
  }
  root.append(content, art);
  function openLunchPicks() {
    if (disposed) return;
    picksModal?.dismiss();
    const modal = ctx.ui.showModal({ title: 'Shameless ads by Lunch', width: 760, maxHeight: 850 }); picksModal = modal;
    modal.root.classList.add('jb-lunch-panel');
    const intro = make('p', '', 'A few favorite extensions, picked by Lunch. Follow a link to read about one before choosing to install it.');
    const manage = make('button', 'jb-button jb-primary', 'Open Extensions'); manage.type = 'button';
    const notice = make('p', 'jb-lunch-status'); notice.setAttribute('role', 'status');
    const current = () => !disposed && picksModal === modal;
    manage.addEventListener('click', () => {
      if (!current() || manage.disabled) return;
      manage.disabled = true; notice.textContent = '';
      void options.invoke({ kind: 'drawer_tab', id: 'spindle' }).then(ok => {
        if (!current()) return;
        if (ok) modal.dismiss(); else notice.textContent = 'Extensions is unavailable. Open it from Lumiverse’s sidebar.';
      }).catch(() => { if (current()) notice.textContent = 'Could not open Extensions. Open it from Lumiverse’s sidebar.'; })
        .finally(() => { if (current()) manage.disabled = false; });
    });
    modal.root.append(intro, createLunchPicks(), manage, notice);
    modal.onDismiss(() => { if (picksModal === modal) picksModal = undefined; if (!disposed && tryButton.isConnected) tryButton.focus(); });
  }
  const ideas = [
    {
      name: 'Basics', title: 'Let’s do the basics.',
      description: 'Connect your AI, add a character card, and create the persona you’ll chat as. A preset or prompt is optional.',
      action: '1. Add API connection', picture: 'settings',
      tutorial: 'import',
      open: async () => { options.openApi(); return true; },
    },
    {
      name: 'Memory', title: 'Keep the important moments.',
      description: 'Keep a running recap with Summary, or recall people and events with Memory Cortex.',
      action: 'Set up summaries', picture: 'memory',
      tutorial: 'memory',
      open: () => options.invoke(memoryTools.summary),
    },
    {
      name: 'Lorebooks', title: 'Build a world beyond the character card.',
      description: 'Save places, people, and world rules. Matching keywords bring the right details into your chat.',
      action: 'Explore Lorebooks', picture: 'lorebook',
      tutorial: 'lorebooks',
      open: () => options.invoke({ kind: 'drawer_tab', id: 'lorebook' }),
    },
    {
      name: 'Group chats', title: 'Put your characters in the same scene.',
      description: 'Chat with two or more of your cards together. Let the cast interact, and choose who replies next.',
      action: 'Explore group chats', picture: 'group',
      tutorial: 'group',
      open: () => options.invoke({ kind: 'drawer_tab', id: 'characters' }),
    },
    {
      name: 'Voice', title: 'Hear their voice. Speak your replies.',
      description: 'Listen to spoken replies or dictate your messages with Voice & Speech.',
      action: 'Explore voice & dictation', picture: 'voice',
      tutorial: 'voice',
      open: () => options.invoke({ kind: 'settings_tab', id: 'voice' }),
    },
    {
      name: 'Extensions', title: 'Add something new when you want it.',
      description: 'Add tools from GitHub and manage the extensions you use, all in one place.',
      action: 'Manage extensions', picture: 'extension',
      tutorial: 'extensions',
      open: () => options.invoke({ kind: 'drawer_tab', id: 'spindle' }),
    },
    {
      name: 'Lunch’s picks', title: 'Shameless ads by Lunch',
      description: 'A few favorite extensions, picked by Lunch. Take a look and see what suits your stories.',
      action: 'See Lunch’s picks', picture: 'extension', tutorial: null,
      open: async () => { openLunchPicks(); return true; },
    },
  ] as const;
  function render() {
    const idea = ideas[index];
    const isLunch = idea.name === 'Lunch’s picks';
    const isBasics = idea.name === 'Basics';
    eyebrow.textContent = isLunch ? 'LUNCH’S PICKS' : idea.name === 'Memory' ? 'HELP YOUR CHARACTERS REMEMBER MORE' : isBasics ? 'START HERE' : 'A LITTLE MORE LUMIVERSE';
    tutorial.hidden = isLunch;
    tutorial.textContent = isBasics ? 'Card import guide' : 'Full tutorial';
    root.classList.toggle('jb-discover-lunch', isLunch);
    root.classList.toggle('jb-discover-basics', isBasics);
    cardButton.hidden = personaButton.hidden = promptButton.hidden = !isBasics;
    cortexButton.hidden = idea.name !== 'Memory';
    root.dataset.idea = idea.name.toLowerCase(); title.textContent = idea.title; description.textContent = idea.description;
    tryButton.replaceChildren(icon(idea.picture), document.createTextNode(idea.action));
    progress.textContent = `${idea.name} · ${index + 1} of ${ideas.length}`;
    next.setAttribute('aria-label', `Next idea: ${ideas[(index + 1) % ideas.length].name}`); status.textContent = '';
    const front = art.querySelector('.jb-discover-card-front')!;
    front.querySelector('svg')?.replaceWith(icon(idea.picture));
  }
  tutorial.addEventListener('click', () => {
    if (disposed) return;
    const feature = ideas[index].tutorial;
    if (feature) options.openTutorial?.(feature);
  });
  next.addEventListener('click', () => { index = (index + 1) % ideas.length; render(); });
  tryButton.addEventListener('click', () => {
    if (disposed) return;
    status.textContent = '';
    void ideas[index].open().then(ok => {
      if (!disposed && !ok) status.textContent = 'This tool is unavailable right now. You can try another idea.';
    }).catch(() => { if (!disposed) status.textContent = 'Could not open this tool. Please try again from Lumiverse’s sidebar.'; });
  });
  cortexButton.addEventListener('click', () => {
    if (disposed) return;
    void options.invoke(memoryTools.cortex).then(ok => {
      if (!disposed && !ok) status.textContent = 'Memory Cortex is unavailable right now. You can still try Summary.';
    }).catch(() => { if (!disposed) status.textContent = 'Could not open Memory Cortex. Please try again from Lumiverse’s sidebar.'; });
  });
  function openBasicStep(action: () => void) {
    if (disposed || index !== 0) return;
    status.textContent = '';
    try { action(); }
    catch { status.textContent = 'Could not open this setup step. Please try again from Janiverse’s More menu.'; }
  }
  cardButton.addEventListener('click', () => openBasicStep(options.openImport));
  personaButton.addEventListener('click', () => openBasicStep(options.openPersona));
  promptButton.addEventListener('click', () => openBasicStep(options.openPrompt));
  render();
  return { root, destroy() { disposed = true; picksModal?.dismiss(); root.remove(); } };
}
