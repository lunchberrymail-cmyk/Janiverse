import type { SpindleFrontendContext, SpindleHostSurfaceRef } from 'lumiverse-spindle-types';
import { icon } from './icons';

type Options = {
  invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean>;
  openImport: () => void;
};

/** A quiet, user-paced introduction: one idea and one next step at a time. */
export function createHomeBanner(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, index = 0;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
    const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
  };
  const root = make('section', 'jb-discover'); root.setAttribute('aria-label', 'Discover more of Lumiverse');
  const content = make('div', 'jb-discover-content');
  const eyebrow = make('p', 'jb-discover-eyebrow', 'A LITTLE MORE LUMIVERSE');
  const title = make('h2', 'jb-discover-title');
  const description = make('p', 'jb-discover-description');
  const actions = make('div', 'jb-discover-actions');
  const tryButton = make('button', 'jb-discover-primary'); tryButton.type = 'button';
  const importButton = make('button', 'jb-discover-import', 'Import chats and cards'); importButton.type = 'button';
  importButton.prepend(icon('import'));
  actions.append(tryButton, importButton);
  const footer = make('div', 'jb-discover-footer');
  const progress = make('span', 'jb-discover-progress'); progress.setAttribute('aria-live', 'polite');
  const next = make('button', 'jb-discover-next', 'Next idea'); next.type = 'button'; next.append(icon('arrow'));
  footer.append(progress, next);
  const status = make('p', 'jb-discover-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  content.append(eyebrow, title, description, actions, footer, status);
  const art = make('div', 'jb-discover-art'); art.setAttribute('aria-hidden', 'true');
  for (const [picture, cls] of [['all-chats', 'back'], ['extension', 'middle'], ['embeddings', 'front']] as const) {
    const card = make('div', `jb-discover-card jb-discover-card-${cls}`);
    card.append(icon(picture), make('span', 'jb-discover-card-line'), make('span', 'jb-discover-card-line jb-discover-card-line-short'));
    art.append(card);
  }
  root.append(content, art);
  const ideas = [
    {
      name: 'Import', title: 'Import your old chats and cards.',
      description: 'Your stories can come with you. Use JAR to bring your characters and conversations into Lumiverse, with a short guide for each step.',
      action: 'Start guided import', picture: 'import',
      open: async () => { options.openImport(); return true; },
    },
    {
      name: 'Embeddings', title: 'Find the details that matter.',
      description: 'Embeddings help Lumiverse find relevant information by meaning. Use them with reference documents and chat memories to bring useful details back into reach.',
      action: 'Explore embeddings', picture: 'embeddings',
      open: () => options.invoke({ kind: 'settings_tab', id: 'embeddings' }),
    },
    {
      name: 'Extensions', title: 'Add something new when you want it.',
      description: 'Extensions add tools and new ways to use Lumiverse. Explore what you can add, then choose the features that fit the way you like to chat.',
      action: 'Explore extensions', picture: 'extension',
      open: () => options.invoke({ kind: 'drawer_tab', id: 'spindle' }),
    },
  ] as const;
  function render() {
    const idea = ideas[index];
    eyebrow.textContent = index === 0 ? 'PICK UP WHERE YOU LEFT OFF' : 'A LITTLE MORE LUMIVERSE';
    importButton.hidden = index === 0;
    root.dataset.idea = idea.name.toLowerCase(); title.textContent = idea.title; description.textContent = idea.description;
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
    });
  });
  importButton.addEventListener('click', () => { if (!disposed) options.openImport(); });
  render();
  return { root, destroy() { disposed = true; root.remove(); } };
}
