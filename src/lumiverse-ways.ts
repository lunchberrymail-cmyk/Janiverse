import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleModalHandle } from 'lumiverse-spindle-types';
import type { TutorialFeature } from './feature-tutorials';

export const LEARNED_KEY = 'graduation:learned_v1';

/** Where each Janiverse tool's work lives in plain Lumiverse, so people can keep going without Janiverse. */
export type LumiverseWay = { id: string; janiverse: string; lumiverse: string; where: string; tutorial?: TutorialFeature; ref?: SpindleHostSurfaceRef; needsChat?: boolean };
const drawer = (id: string): SpindleHostSurfaceRef => ({ kind: 'drawer_tab', id });

export const lumiverseWays: readonly LumiverseWay[] = [
  { id: 'memory', janiverse: 'Chat Memory', lumiverse: 'Author’s Note', where: 'In a chat: reply toolbar → Tools (wrench) → Author’s Note. It saves as you type.', tutorial: 'authorsNote', needsChat: true },
  { id: 'character', janiverse: 'Create a Character form', lumiverse: 'Character editor', where: 'Chars → + → Create New.', tutorial: 'character' },
  { id: 'import', janiverse: 'Import characters', lumiverse: 'Character import', where: 'Chars → + → Import File or Import URLs.', ref: drawer('characters') },
  { id: 'prompt', janiverse: 'Prompt and generation settings', lumiverse: 'Preset', where: 'Preset in the sidebar. Samplers holds temperature, context and reply length.', tutorial: 'presets' },
  { id: 'connections', janiverse: 'Setup checklist: your AI', lumiverse: 'Connections', where: 'Connections in the sidebar.', tutorial: 'connections' },
  { id: 'persona', janiverse: 'Create a persona', lumiverse: 'Personas', where: 'Personas in the sidebar.', ref: drawer('personas') },
  { id: 'home', janiverse: 'Janiverse Home and profiles', lumiverse: 'Chars', where: 'Chars in the sidebar lists every card.', ref: drawer('characters') },
  { id: 'myChats', janiverse: 'My Chats', lumiverse: 'Lumiverse Home', where: 'Lumiverse’s own Home page lists your recent chats.' },
  { id: 'customize', janiverse: 'Customize', lumiverse: 'Wallpaper & Theme', where: 'Wallpaper and Theme in the sidebar.', ref: drawer('wallpaper') },
];

export type WayActions = { show(way: LumiverseWay): void | boolean | Promise<void | boolean> };

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}
function showButton(way: LumiverseWay, actions: WayActions, status: HTMLElement, before?: () => void) {
  const show = make('button', 'jb-button', way.tutorial ? 'Show me how' : 'Show me where'); show.type = 'button';
  show.addEventListener('click', () => {
    if (show.disabled) return;
    show.disabled = true; status.textContent = '';
    before?.();
    void Promise.resolve().then(() => actions.show(way)).then(ok => { if (ok === false) status.textContent = `This shortcut is unavailable. ${way.where}`; },
      (error: unknown) => { status.textContent = error instanceof Error && error.message ? error.message : `Could not open it. ${way.where}`; })
      .finally(() => { show.disabled = false; });
  });
  return show;
}

/** A quiet note at the bottom of a Janiverse window: the same thing in plain Lumiverse. */
export function mountLumiverseWay(target: HTMLElement, id: string, actions: WayActions, close?: () => void) {
  const way = lumiverseWays.find(item => item.id === id); if (!way) return;
  const root = make('aside', 'jb-lumiverse-way'); root.setAttribute('aria-label', 'In plain Lumiverse');
  const text = make('p'); text.append('Leaving Janiverse later? In Lumiverse this is ', make('strong', '', way.lumiverse), `. ${way.where}`);
  const status = make('p', 'jb-status'); status.setAttribute('role', 'status');
  root.append(text);
  if (way.tutorial || way.ref) root.append(showButton(way, actions, status, close));
  root.append(status); target.append(root);
}

/** Help's checklist of every Janiverse tool and its native home, remembered per account. */
export function openLumiverseWays(ctx: SpindleFrontendContext, actions: WayActions): SpindleModalHandle {
  const modal = ctx.ui.showModal({ title: 'Use Lumiverse on its own', width: 640, maxHeight: 860 });
  modal.root.classList.add('jb-lumiverse-ways', 'jb-settings');
  let closed = false; modal.onDismiss(() => { closed = true; });
  const learned = new Set<string>();
  const intro = make('p', 'jb-settings-intro', 'Janiverse saves everything in Lumiverse itself, so you can keep going without it. Learn where each tool lives, then tick it off.');
  const progress = make('p', 'jb-lumiverse-ways-progress'); progress.setAttribute('aria-live', 'polite');
  const list = make('ul', 'jb-lumiverse-ways-list');
  const done = make('section', 'jb-lumiverse-ways-done');
  done.append(make('h3', '', 'Ready to go native'), make('p', '', 'To stop using Janiverse, open Extend in the sidebar and switch Janiverse off. Your cards, chats, presets and notes stay. Home, profiles, My Chats and Help are Janiverse-only. Switch it back on any time.'));
  const boxes: HTMLInputElement[] = [];
  function render() {
    progress.textContent = `${learned.size} of ${lumiverseWays.length} learned`;
    done.hidden = learned.size < lumiverseWays.length;
    for (const box of boxes) box.checked = learned.has(box.value);
  }
  for (const way of lumiverseWays) {
    const item = make('li', 'jb-lumiverse-way-row'), text = make('div'), status = make('p', 'jb-status'); status.setAttribute('role', 'status');
    const title = make('h4'); title.append(`${way.janiverse} → `, make('strong', '', way.lumiverse));
    text.append(title, make('p', '', way.where), status);
    const check = make('label', 'jb-lumiverse-way-check'), box = make('input'); box.type = 'checkbox'; box.value = way.id; boxes.push(box);
    check.append(box, 'I can find it');
    box.addEventListener('change', () => {
      if (box.checked) learned.add(way.id); else learned.delete(way.id);
      render();
      if (ctx.settings?.set) void Promise.resolve().then(() => ctx.settings.set(LEARNED_KEY, [...learned])).catch(() => { if (!closed) status.textContent = 'Could not save your progress. It still shows until you close this window.'; });
    });
    const controls = make('div', 'jb-lumiverse-way-controls');
    if (way.tutorial || way.ref) controls.append(showButton(way, actions, status, () => modal.dismiss()));
    controls.append(check); item.append(text, controls); list.append(item);
  }
  modal.root.append(intro, progress, list, done); render();
  if (ctx.settings?.get) void Promise.resolve().then(() => ctx.settings.get<unknown>(LEARNED_KEY)).then(value => {
    if (closed || !Array.isArray(value)) return;
    for (const id of value) if (typeof id === 'string' && lumiverseWays.some(way => way.id === id)) learned.add(id);
    render();
  }).catch(() => {});
  return modal;
}
