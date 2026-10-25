import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

export const HONE_REPOSITORY = 'https://github.com/AMousePad/Hone';
export const HONE_QUICK_START = 'https://github.com/AMousePad/Hone/wiki/Quick-Start';
export interface HoneOptions { revealTools?: () => void }

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function external(label: string, url: string) {
  const link = element('a', 'jb-button', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}

/** A hand-off to Hone's own installation and controls. Never runs generation or changes the draft. */
export function createHone(ctx: SpindleFrontendContext, options: HoneOptions = {}) {
  let disposed = false;
  let active: { modal: SpindleModalHandle; controller: AbortController; closed: boolean } | undefined;

  async function enhanceDraft() {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'Enhance with Hone', width: 550, maxHeight: 680 });
    const session = { modal, controller: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && !session.closed && active === session;
    modal.onDismiss(() => { session.closed = true; session.controller.abort(); if (active === session) active = undefined; });
    modal.root.classList.add('jb-settings', 'jb-hone');
    const intro = element('p', 'jb-hone-intro', 'Hone is a Lumiverse extension that helps polish your message before you send it. You choose its model and writing instructions.');
    const state = element('p', 'jb-hone-state', 'Checking whether Hone is installed…'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
    const steps = element('ol', 'jb-hone-steps');
    for (const text of [
      'Open Extensions → Add Extension → Install from Source. Paste the Hone repository link below.',
      'Open Hone and choose a model plus an Input pipeline or preset.',
      'Write a message, then use Hone’s button beside the message box. Review the result before sending.',
    ]) steps.append(element('li', '', text));
    const repositoryLabel = element('label', 'jb-hone-repository', 'Hone repository');
    const repository = element('input'); repository.type = 'text'; repository.readOnly = true; repository.value = HONE_REPOSITORY; repository.setAttribute('aria-label', 'Hone repository URL'); repository.addEventListener('focus', () => repository.select()); repositoryLabel.append(repository);
    const links = element('div', 'jb-hone-actions');
    const copy = element('button', 'jb-button', 'Copy link'); copy.type = 'button';
    const extensions = element('button', 'jb-button jb-primary', 'Open Extensions'); extensions.type = 'button';
    links.append(extensions, copy, external('View Hone', HONE_REPOSITORY), external('Setup guide', HONE_QUICK_START));
    const nativeActions = element('div', 'jb-hone-actions'); nativeActions.hidden = true;
    const openHone = element('button', 'jb-button', 'Open Hone'); openHone.type = 'button'; openHone.hidden = true;
    const showTools = element('button', 'jb-button jb-primary', 'Show Hone controls'); showTools.type = 'button'; showTools.hidden = true;
    nativeActions.append(openHone, showTools);
    const notice = element('p', 'jb-hone-notice', 'Installing and configuring Hone stays in Lumiverse’s Extensions. Your current message is kept as it is.');
    modal.root.append(intro, state, steps, repositoryLabel, links, nativeActions, notice);

    const drawer = (id: string) => ctx.host?.surfaces?.list(['drawer_tab']).find(surface => surface.id === id && surface.invocable !== false);
    const invokeDrawer = async (id: string, owner?: string) => {
      if (!current()) return;
      try {
        const target = drawer(id);
        if (!target || (owner !== undefined && target.owner !== owner)) { state.textContent = 'Open Lumiverse’s menu and choose Extensions to manage Hone.'; return; }
        await ctx.host.surfaces!.invoke({ kind: 'drawer_tab', id });
        if (current()) modal.dismiss();
      } catch { if (current()) state.textContent = 'Could not open that panel. Open Extensions from Lumiverse’s menu.'; }
    };
    extensions.addEventListener('click', () => void invokeDrawer('spindle'));
    copy.addEventListener('click', () => {
      repository.focus(); repository.select();
      const clipboard = document.defaultView?.navigator.clipboard;
      if (!clipboard?.writeText) { state.textContent = 'The repository link is selected. Copy it, then paste it into Extensions.'; return; }
      void clipboard.writeText(HONE_REPOSITORY).then(() => { if (current()) state.textContent = 'Hone repository link copied. Paste it into Extensions → Add Extension → Install from Source.'; }).catch(() => { if (current()) state.textContent = 'The repository link is selected. Copy it, then paste it into Extensions.'; });
    });
    showTools.addEventListener('click', () => {
      if (!current()) return;
      try { options.revealTools?.(); modal.dismiss(); }
      catch { state.textContent = 'Could not show Hone’s controls. Open Hone from Extensions.'; }
    });

    try {
      const response = await fetch('/api/v1/spindle', { credentials: 'same-origin', cache: 'no-store', signal: session.controller.signal });
      if (!response.ok) throw new Error('Could not read installed extensions');
      const payload = object(await response.json());
      if (!Array.isArray(payload.extensions)) throw new Error('Invalid installed extension list');
      if (!current()) return;
      // The manifest identifier is stable; names and arbitrary action labels are not identities.
      const matches = payload.extensions.map(object).filter(extension => extension.identifier === 'hone' && typeof extension.id === 'string');
      const running = matches.filter(extension => extension.enabled === true && extension.has_frontend !== false && extension.status !== 'error');
      if (running.length === 1) {
        state.textContent = 'Hone is installed. Use Hone’s own button beside the message box to enhance a draft; its settings stay in Hone.';
        steps.hidden = true;
        showTools.hidden = !options.revealTools;
        const honePanel = ctx.host?.surfaces?.list(['drawer_tab']).filter(surface => surface.owner === running[0].id && surface.invocable !== false);
        if (honePanel?.length === 1) { openHone.hidden = false; openHone.addEventListener('click', () => void invokeDrawer(honePanel[0].id, running[0].id as string)); }
        nativeActions.hidden = openHone.hidden && showTools.hidden;
      } else if (matches.length) {
        state.textContent = running.length > 1 ? 'More than one Hone installation is enabled. Choose the one you want to use in Extensions.' : 'Hone is installed. Enable it in Extensions, then open Hone to finish its setup.';
        steps.hidden = true;
      } else {
        state.textContent = 'Install Hone once to add its writing tools to this message box.';
        if (payload.isPrivileged === false) {
          steps.firstElementChild!.textContent = 'Ask this Lumiverse instance’s administrator to install Hone using the repository link below.';
          notice.textContent = 'This Lumiverse account cannot install extensions. Your administrator can add Hone from Extensions → Add Extension → Install from Source.';
        }
      }
    } catch {
      if (current()) state.textContent = 'Could not check installed extensions. Open Extensions to find or install Hone using the link below.';
    }
  }
  return { enhanceDraft, destroy() { if (disposed) return; disposed = true; active?.modal.dismiss(); active = undefined; } };
}
