import type { SpindleFrontendContext, SpindleHostSurfaceRef } from 'lumiverse-spindle-types';
import { icon } from './icons';

type Options = {
  invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean>;
  openImport: () => void;
};
type MemoryOptions = Pick<Options, 'invoke'>;
const memoryTools = {
  summary: { kind: 'drawer_tab', id: 'summary' },
  cortex: { kind: 'drawer_tab', id: 'cortex' },
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
  const root = make('section', 'jb-discover'); root.setAttribute('aria-label', 'Discover more of Lumiverse');
  const content = make('div', 'jb-discover-content');
  const eyebrow = make('p', 'jb-discover-eyebrow', 'A LITTLE MORE LUMIVERSE');
  const title = make('h2', 'jb-discover-title');
  const description = make('p', 'jb-discover-description');
  const actions = make('div', 'jb-discover-actions');
  const tryButton = make('button', 'jb-discover-primary'); tryButton.type = 'button';
  const importButton = make('button', 'jb-discover-import', 'Import chats and cards'); importButton.type = 'button';
  importButton.prepend(icon('import'));
  const cortexButton = make('button', 'jb-discover-import', 'Explore Memory Cortex'); cortexButton.type = 'button'; cortexButton.prepend(icon('embeddings'));
  actions.append(tryButton, cortexButton, importButton);
  const footer = make('div', 'jb-discover-footer');
  const progress = make('span', 'jb-discover-progress'); progress.setAttribute('aria-live', 'polite');
  const next = make('button', 'jb-discover-next', 'Next idea'); next.type = 'button'; next.append(icon('arrow'));
  footer.append(progress, next);
  const status = make('p', 'jb-discover-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const guide = make('details', 'jb-discover-guide');
  const guideSummary = make('summary', '', 'How to try it');
  const guideSteps = make('ol'); guide.append(guideSummary, guideSteps);
  content.append(eyebrow, title, description, actions, guide, footer, status);
  const art = make('div', 'jb-discover-art'); art.setAttribute('aria-hidden', 'true');
  for (const [picture, cls] of [['all-chats', 'back'], ['extension', 'middle'], ['embeddings', 'front']] as const) {
    const card = make('div', `jb-discover-card jb-discover-card-${cls}`);
    card.append(icon(picture), make('span', 'jb-discover-card-line'), make('span', 'jb-discover-card-line jb-discover-card-line-short'));
    art.append(card);
  }
  root.append(content, art);
  const ideas = [
    {
      name: 'Memory', title: 'Keep the important moments.',
      description: 'Your story keeps growing. Use Summary for a running recap, or explore Memory Cortex to help recall people, events, and relationships.',
      action: 'Set up summaries', picture: 'memory',
      steps: ['Open Summary to choose how recaps are created, or Memory Cortex to set up recall.', 'Choose the settings that suit your chat, then return to your story.'],
      open: () => options.invoke(memoryTools.summary),
    },
    {
      name: 'Import', title: 'Import your old chats and cards.',
      description: 'Your stories can come with you. Use JAR to bring your characters and conversations into Lumiverse, with a short guide for each step.',
      action: 'Start guided import', picture: 'import',
      steps: ['Open the import assistant and choose a card, a conversation, or both.', 'Follow the JAR connection or exported-file path, review the result, then import.'],
      open: async () => { options.openImport(); return true; },
    },
    {
      name: 'Lorebooks', title: 'Build a world beyond the character card.',
      description: 'Keep places, factions, and world rules in a Lorebook. Mention a keyword in chat to bring the matching detail into context.',
      action: 'Explore Lorebooks', picture: 'lorebook',
      steps: ['Create or import a Lorebook, then add an entry for a place, person, or world rule.', 'Give the entry a keyword, such as a place name, and write the details the character should know.', 'Activate the book globally or attach it to a character. Matching keywords bring entries into the chat context.'],
      open: () => options.invoke({ kind: 'drawer_tab', id: 'lorebook' }),
    },
    {
      name: 'Group chats', title: 'Put your characters in the same scene.',
      description: 'Chat with two or more of your cards together. Let the cast interact, and choose who replies next.',
      action: 'Explore group chats', picture: 'group',
      steps: ['In Character Browser, choose the Group Chat button.', 'Pick at least two character cards and create a separate group conversation.', 'Use the member bar in the chat to choose which character replies. Replies use your normal API connection.'],
      open: () => options.invoke({ kind: 'drawer_tab', id: 'characters' }),
    },
    {
      name: 'Voice', title: 'Hear their voice. Speak your replies.',
      description: 'Set up spoken replies or dictate your messages. Voice & Speech offers voice connections and on-device Whistle dictation.',
      action: 'Explore voice & dictation', picture: 'voice',
      steps: ['Open Voice & Speech and choose speech-to-text for dictation, or text-to-speech for spoken replies.', 'Whistle dictation runs on your device and needs microphone access. It uses device processing power.', 'Spoken replies need a configured voice connection. Cloud voice and transcription services may charge for usage.'],
      open: () => options.invoke({ kind: 'settings_tab', id: 'voice' }),
    },
    {
      name: 'Extensions', title: 'Add something new when you want it.',
      description: 'Janiverse is one extension. Add other tools from their GitHub links, and manage the extensions you already use in one place.',
      action: 'Manage extensions', picture: 'extension',
      steps: ['Open Extensions to see your installed tools.', 'To add another extension, use Add Extension and paste its GitHub repository link.', 'Review its requested access and enable the extension when you are ready.'],
      open: () => options.invoke({ kind: 'drawer_tab', id: 'spindle' }),
    },
  ] as const;
  function render() {
    const idea = ideas[index];
    eyebrow.textContent = idea.name === 'Memory' ? 'HELP YOUR CHARACTERS REMEMBER MORE' : idea.name === 'Import' ? 'PICK UP WHERE YOU LEFT OFF' : 'A LITTLE MORE LUMIVERSE';
    importButton.hidden = idea.name === 'Import' || idea.name === 'Memory'; cortexButton.hidden = idea.name !== 'Memory';
    root.dataset.idea = idea.name.toLowerCase(); title.textContent = idea.title; description.textContent = idea.description;
    guide.open = false;
    guideSteps.replaceChildren(...idea.steps.map(step => make('li', '', step)));
    tryButton.replaceChildren(icon(idea.picture), document.createTextNode(idea.action));
    progress.textContent = `${idea.name} · ${index + 1} of ${ideas.length}`;
    next.setAttribute('aria-label', `Next idea: ${ideas[(index + 1) % ideas.length].name}`); status.textContent = '';
    const front = art.querySelector('.jb-discover-card-front')!;
    front.querySelector('svg')?.replaceWith(icon(idea.picture));
  }
  next.addEventListener('click', () => { index = (index + 1) % ideas.length; render(); });
  tryButton.addEventListener('click', () => {
    if (disposed) return;
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
  importButton.addEventListener('click', () => { if (!disposed) options.openImport(); });
  render();
  return { root, destroy() { disposed = true; root.remove(); } };
}
