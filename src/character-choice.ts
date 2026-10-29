import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

type Options = { openForm(): void; openEditor(): void | boolean | Promise<void | boolean> };
function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}

/** Lets a new user pick the familiar form or Lumiverse's own editor. Choosing never creates a card by itself. */
export function openCharacterChoice(ctx: SpindleFrontendContext, options: Options): SpindleModalHandle {
  const modal = ctx.ui.showModal({ title: 'Create a character', width: 620, maxHeight: 640 });
  const root = modal.root; root.classList.add('jb-settings', 'jb-character-choice'); root.setAttribute('aria-label', 'Choose how to create a character');
  let closed = false; modal.onDismiss(() => { closed = true; });
  const status = make('p', 'jb-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const list = make('div', 'jb-character-choice-list');
  function option(title: string, detail: string, label: string, run: () => void | boolean | Promise<void | boolean>, primary = false) {
    const card = make('article', 'jb-character-choice-option'), action = make('button', `jb-button${primary ? ' jb-primary' : ''}`, label); action.type = 'button';
    card.append(make('h3', '', title), make('p', '', detail), action); list.append(card);
    action.addEventListener('click', () => {
      if (closed || action.disabled) return;
      action.disabled = true; status.textContent = '';
      void Promise.resolve().then(run)
        .then(opened => { if (closed) return; if (opened === false) status.textContent = 'Could not open the Lumiverse editor here. Open Chars from Lumiverse’s sidebar, then + → Create New.'; else modal.dismiss(); })
        .catch(error => { if (!closed) status.textContent = error instanceof Error && error.message ? error.message : 'Could not open that. Please try again.'; })
        .finally(() => { if (!closed) action.disabled = false; });
    });
  }
  option('JanitorAI-style form', 'One page with the fields you know: name, portrait, personality, scenario, first message and example dialogs.', 'Use the familiar form', options.openForm, true);
  option('Lumiverse editor, with a guide', 'The full editor with every field, like alternate greetings, tags and expressions. A guide stays beside it and shows where each JanitorAI field goes.', 'Open with a guide', options.openEditor);
  root.append(make('p', 'jb-settings-intro', 'Both save a normal Lumiverse character. You can edit it later with either one.'), list, status);
  return modal;
}
