import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

type Options = {
  showImportMenu(): void;
  clearImportMenu(): void;
  openImportGuide(): void;
  openCharacters(): Promise<boolean>;
};
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };
const nativeSteps = [
  ['Find the + menu', 'Chars → +', 'In Characters, use the + button beside the search box (Add character).'],
  ['Choose your card', '+ → Import File / Import URLs', 'Import File: select a PNG, JSON or CHARX card. One file imports immediately. Import URLs: paste a supported public character link, then choose Import.'],
  ['Find your saved character', 'Characters → your card', 'Wait for the result, then open the saved card. You can also find it on Home. Already there? Use that copy instead of importing it again.'],
] as const;

/** Teaches real entry points. No file selection, import requests or permission grants. */
export function createCardSetup(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, root: HTMLElement | undefined;
  let pendingMenu = false, epoch = 0;
  function close() {
    epoch++; pendingMenu = false; options.clearImportMenu(); root?.remove(); root = undefined;
  }
  function companion(native: boolean) {
    close(); const session = ++epoch;
    const panel = make('section', 'jb-api-guide jb-card-menu-guide'); root = panel;
    panel.setAttribute('role', 'complementary'); panel.setAttribute('aria-label', native ? 'Lumiverse card guide' : 'Find the card importer');
    const header = make('header', 'jb-api-guide-header'), count = make('span', 'jb-api-guide-progress');
    const minimize = make('button', 'jb-api-guide-icon', '−'), dismiss = make('button', 'jb-api-guide-icon', '×');
    minimize.type = dismiss.type = 'button'; minimize.setAttribute('aria-label', 'Minimize card guide'); minimize.setAttribute('aria-expanded', 'true'); dismiss.setAttribute('aria-label', 'Close card guide'); header.append(count, minimize, dismiss);
    const body = make('div', 'jb-api-guide-body'), title = make('h3', 'jb-api-guide-title'), path = make('p', 'jb-card-menu-path'), instruction = make('p', 'jb-api-guide-instruction'), status = make('p', 'jb-api-guide-status'); status.setAttribute('role', 'status');
    const actions = make('div', 'jb-api-guide-actions'), reopen = make('button', '', native ? 'Open Characters' : 'Show More menu'), methods = make('button', '', native ? 'Use More → Import instead' : 'Use Chars → + instead'); reopen.type = methods.type = 'button'; actions.append(reopen, methods);
    body.append(title, path, instruction, status, actions); panel.append(header, body);
    let index = 0, minimized = false, opening = false;
    const current = () => !disposed && epoch === session;
    const back = make('button', '', 'Back'), next = make('button', 'jb-api-guide-primary', 'Next'); back.type = next.type = 'button';
    function render() {
      count.textContent = native ? `Character menu · ${index + 1} / ${nativeSteps.length}` : 'Import a card · Find the menu';
      const scene = native ? nativeSteps[index] : ['Open Import characters', 'More → Import characters', 'Choose the highlighted item. Then select a card file or link, review the queue, and choose Import.'];
      title.textContent = scene[0]; path.textContent = scene[1]; instruction.textContent = scene[2]; back.disabled = index === 0; next.textContent = index === nativeSteps.length - 1 ? 'Close guide' : 'Next';
    }
    async function show() {
      if (!current() || opening) return;
      if (!native) { options.showImportMenu(); return; }
      opening = true; reopen.disabled = true; status.textContent = '';
      try { if (!await options.openCharacters() && current()) status.textContent = 'Open Chars in Lumiverse’s sidebar, then +. This shortcut is unavailable here.'; }
      catch { if (current()) status.textContent = 'Couldn’t open Characters. Use Chars in Lumiverse’s sidebar, then +.'; }
      finally { if (current()) { opening = false; reopen.disabled = false; } }
    }
    if (native) {
      const navigation = make('nav', 'jb-api-guide-nav'); navigation.setAttribute('aria-label', 'Lumiverse import steps'); navigation.append(back, next); body.append(navigation);
      const note = make('p', 'jb-card-menu-note', 'Use a character card export, not a screenshot. Cards don’t need JAR. The checklist updates when a card is actually saved.'); body.append(note);
      let mount: HTMLElement | undefined;
      try { mount = ctx.ui.mount('drawer_footer'); } catch { /* Older hosts use a floating companion. */ }
      if (mount) { mount.classList.add('jb-api-guide-mount'); mount.append(panel); }
      else { panel.classList.add('jb-api-guide-fallback'); document.body.append(panel); }
    } else { pendingMenu = true; panel.classList.add('jb-api-guide-fallback'); document.body.append(panel); }
    minimize.addEventListener('click', () => {
      if (!current()) return; minimized = !minimized; body.hidden = minimized; minimize.textContent = minimized ? '+' : '−'; minimize.setAttribute('aria-expanded', String(!minimized)); minimize.setAttribute('aria-label', minimized ? 'Resume card guide' : 'Minimize card guide');
    });
    dismiss.addEventListener('click', () => { if (current()) close(); }); methods.addEventListener('click', () => { if (current()) companion(!native); }); reopen.addEventListener('click', () => { void show(); });
    back.addEventListener('click', () => { if (current() && index > 0) { index--; render(); } });
    next.addEventListener('click', () => { if (!current()) return; if (index === nativeSteps.length - 1) close(); else { index++; render(); } });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); if (current()) close(); } });
    render(); void show();
  }
  function open() {
    if (!disposed) companion(false);
  }
  return {
    open, close,
    consumeMenuImport() {
      if (disposed || !pendingMenu) return false;
      close(); options.openImportGuide(); return true;
    },
    destroy() { if (disposed) return; disposed = true; close(); },
  };
}
