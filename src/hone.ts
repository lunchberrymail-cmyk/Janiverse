import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { subscribeOptionalState } from './optional-state';

export const HONE_REPOSITORY = 'https://github.com/AMousePad/Hone';
export const HONE_QUICK_START = 'https://github.com/AMousePad/Hone/wiki/Quick-Start';
export type HoneScreenshotKey = 'hone-install' | 'hone-models' | 'hone-input' | 'hone-toolbar';
export interface HoneScreenshot {
  src: string;
  alt: string;
  /** A rectangle in percentages of the unmodified screenshot. */
  highlight?: { x: number; y: number; w: number; h: number };
}
export interface HoneOptions {
  revealTools?: () => void;
  screenshots?: Partial<Record<HoneScreenshotKey, HoneScreenshot>>;
}
type Installation = { runningId?: string; notice: string; administrator?: boolean };
type Session = {
  controller: AbortController; closed: boolean; chatId: string | null; path: string; read: number;
  installation?: Installation; modal?: SpindleModalHandle; hint?: HTMLElement;
  target?: HTMLButtonElement; observer?: MutationObserver; step: number; skipRestore?: boolean;
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function button(label: string, primary = false) {
  const node = element('button', `jb-button${primary ? ' jb-primary' : ''}`, label); node.type = 'button'; return node;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function external(label: string, url: string) {
  const link = element('a', 'jb-button', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; return link;
}
function screenshot(value: HoneScreenshot | undefined) {
  if (!value || !value.src || !value.alt) return;
  try {
    const url = new URL(value.src, document.baseURI);
    const bundled = /^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(value.src);
    if (!bundled && (url.origin !== document.location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password)) return;
    const figure = element('figure', 'jb-hone-figure');
    const image = element('img'); image.src = value.src; image.alt = value.alt; image.decoding = 'async'; figure.append(image);
    const rect = value.highlight;
    if (rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 && rect.x + rect.w <= 100 && rect.y + rect.h <= 100) {
      const mark = element('span', 'jb-hone-highlight'); mark.setAttribute('aria-hidden', 'true');
      mark.style.left = `${rect.x}%`; mark.style.top = `${rect.y}%`; mark.style.width = `${rect.w}%`; mark.style.height = `${rect.h}%`; figure.append(mark);
    }
    return figure;
  } catch { return; }
}

/** Finds Hone's own manual control. This hand-off never clicks it, runs a model, or edits the draft. */
export function createHone(ctx: SpindleFrontendContext, options: HoneOptions = {}) {
  let disposed = false, active: Session | undefined;
  const cleanups: Array<() => void> = [];
  const chatId = () => ctx.getActiveChat?.()?.chatId ?? null;
  const path = () => document.defaultView?.location.pathname ?? '';

  function clearTarget(session: Session) {
    session.observer?.disconnect(); session.observer = undefined;
    session.target?.classList.remove('jb-hone-target'); session.target = undefined;
  }
  function close(session: Session) {
    if (session.closed) return;
    session.closed = true; session.controller.abort(); clearTarget(session); session.hint?.remove(); session.hint = undefined;
    const modal = session.modal; session.modal = undefined; modal?.dismiss();
    if (active === session) active = undefined;
  }
  function current(session: Session) {
    if (disposed || session.closed || active !== session) return false;
    if (session.chatId !== chatId() || session.path !== path()) { session.skipRestore = true; close(session); return false; }
    return true;
  }
  function checkNavigation() { if (active) current(active); }
  if (ctx.composer?.onChange) cleanups.push(ctx.composer.onChange(state => {
    if (!active) return;
    if (active.chatId && (!state.mounted || state.chatId !== active.chatId)) { active.skipRestore = true; close(active); }
    else checkNavigation();
  }));
  cleanups.push(subscribeOptionalState(ctx, 'chat.active', checkNavigation));
  if (ctx.events?.on) cleanups.push(ctx.events.on('CHAT_CHANGED', checkNavigation));
  const win = document.defaultView;
  win?.addEventListener('popstate', checkNavigation); win?.addEventListener('hashchange', checkNavigation);
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !active || !current(active)) return;
    event.preventDefault(); event.stopPropagation(); close(active);
  };
  document.addEventListener('keydown', escape);

  const drawer = (id: string, owner?: string) => ctx.host?.surfaces?.list(['drawer_tab']).find(surface => surface.id === id && surface.invocable !== false && (owner === undefined || surface.owner === owner));
  function honePanel(session: Session) {
    if (!session.installation?.runningId) return;
    const matches = ctx.host?.surfaces?.list(['drawer_tab']).filter(surface => surface.owner === session.installation!.runningId && surface.invocable !== false);
    return matches?.length === 1 ? matches[0] : undefined;
  }
  async function invoke(session: Session, id: string, status: HTMLElement, owner?: string) {
    if (!current(session)) return;
    try {
      if (!drawer(id, owner)) { status.textContent = 'Open Lumiverse’s menu and choose Extensions, then open Hone’s controls there.'; return; }
      await ctx.host.surfaces!.invoke({ kind: 'drawer_tab', id });
      if (current(session)) { session.skipRestore = true; close(session); }
    } catch { if (current(session)) status.textContent = 'That panel could not open. Use Lumiverse’s menu → Extensions, or Hone in the sidebar.'; }
  }

  async function readInstallation(session: Session): Promise<Installation | undefined> {
    const revision = ++session.read;
    try {
      const response = await fetch('/api/v1/spindle', { credentials: 'same-origin', cache: 'no-store', signal: session.controller.signal });
      if (!response.ok) throw new Error('Could not read installed extensions');
      const payload = object(await response.json());
      if (!Array.isArray(payload.extensions)) throw new Error('Invalid installed extension list');
      if (!current(session) || revision !== session.read) return;
      // Match the manifest identifier, never an extension's display name or an arbitrary action label.
      const matches = payload.extensions.map(object).filter(extension => extension.identifier === 'hone' && typeof extension.id === 'string');
      const running = matches.filter(extension => extension.enabled === true && extension.has_frontend !== false && extension.status !== 'error');
      const result: Installation = running.length === 1
        ? { runningId: running[0].id as string, notice: 'Hone is enabled. Its manual button refines your draft; you still choose when to send.' }
        : running.length > 1
          ? { notice: 'More than one Hone installation is enabled. Choose one in Extensions before using its controls.' }
          : matches.length
            ? { notice: 'Hone is installed. Enable it in Extensions and check its startup status.' }
            : { notice: 'Install Hone once to add its writing tools beside the message box.', administrator: payload.isPrivileged === false };
      session.installation = result; return result;
    } catch {
      if (!current(session) || revision !== session.read) return;
      return session.installation = { notice: 'Could not check installed extensions. Open Extensions to find or install Hone.' };
    }
  }

  function visible(node: HTMLElement) {
    if (!node.isConnected || node.closest('[hidden], [inert], [aria-hidden="true"]') || !node.getClientRects().length) return false;
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      const style = document.defaultView?.getComputedStyle(parent);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    return true;
  }
  function focusTarget(node: HTMLButtonElement) {
    try { node.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' }); } catch { /* An older browser can still focus it. */ }
    try { node.focus({ preventScroll: true }); } catch { node.focus(); }
  }
  function showHint(session: Session) {
    if (!current(session)) return;
    session.hint?.remove(); clearTarget(session);
    try { options.revealTools?.(); } catch { openGuide(session, 3, 'Could not reveal Lumiverse’s tools. Open Hone from the sidebar to check its setup.'); return; }
    const inputAreas = Array.from(document.querySelectorAll('[data-component="InputArea"]'));
    const hint = element('section', 'jb-hone-hint'); hint.setAttribute('aria-label', 'Hone draft help');
    const status = element('p', 'jb-hone-hint-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'jb-hone-actions');
    const guide = button('Setup guide'), dismiss = button('Dismiss');
    actions.append(guide, dismiss); hint.append(status, actions);
    const update = () => {
      if (!current(session)) return;
      const targets = inputAreas.flatMap(area => Array.from(area.querySelectorAll<HTMLButtonElement>('button[data-hone-input-btn]'))).filter(visible);
      const target = targets.length === 1 ? targets[0] : undefined;
      if (session.target !== target) {
        session.target?.classList.remove('jb-hone-target'); session.target = target; target?.classList.add('jb-hone-target');
      }
      if (!target || !visible(target)) {
        status.textContent = targets.length > 1 ? 'Several Hone buttons are visible. Use the one in this chat, or check Setup guide.' : 'Hone is enabled, but its button is not visible in this chat. Check Setup guide, then try again.';
      } else if (target.title === 'Honing... (click to cancel)') {
        status.textContent = 'Hone is already refining a draft. Wait for it to finish; clicking its button now cancels that request.';
      } else if (target.title === 'Undo Hone (restore your original draft)') {
        status.textContent = 'Your refined draft is ready. Review or edit it, then Send separately. Hone’s button currently restores your original draft.';
      } else if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
        status.textContent = 'Hone’s button is not ready. Wait for any current reply to finish, then check its model and Input preset in Setup guide.';
      } else if (target.title === 'Hone your draft') {
        status.textContent = 'Click the highlighted Hone button beside the message box. Review its refined draft, then Send separately. The same button offers Undo afterward.';
      } else {
        status.textContent = 'Hone’s controls are visible. Check Setup guide before using this version’s draft button.';
      }
    };
    guide.addEventListener('click', () => { if (current(session)) openGuide(session, 1); });
    dismiss.addEventListener('click', () => { if (current(session)) close(session); });
    try {
      const mount = ctx.ui.mount('chat_composer_above');
      if (!mount.isConnected) { openGuide(session, 3, 'Open a chat to find Hone’s button beside the message box.'); return; }
      mount.append(hint); session.hint = hint;
    } catch { openGuide(session, 3, 'Open a chat to find Hone’s button beside the message box.'); return; }
    update();
    const Observer = document.defaultView?.MutationObserver;
    if (Observer) {
      session.observer = new Observer(records => {
        // The shared mount also contains this hint. Its own status rendering must not trigger another update.
        if (records.some(record => !hint.contains(record.target))) update();
      });
      for (const area of inputAreas) session.observer.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'aria-disabled', 'disabled', 'hidden', 'style', 'class'] });
    }
    // Later injection/replacement updates the hint without stealing focus from someone typing.
    const target = session.target;
    // A busy button cancels, and an Undo button restores text: never move keyboard activation to either.
    if (target && !target.disabled && target.getAttribute('aria-disabled') !== 'true' && target.title === 'Hone your draft') focusTarget(target);
  }

  function openGuide(session: Session, index = 0, notice?: string) {
    if (!current(session)) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    session.hint?.remove(); session.hint = undefined; clearTarget(session);
    if (session.modal) { session.step = index; return; }
    const modal = ctx.ui.showModal({ title: 'Set up Hone', width: 620, maxHeight: 760 }); session.modal = modal; session.step = index;
    session.skipRestore = false;
    modal.root.classList.add('jb-settings', 'jb-hone'); modal.root.setAttribute('role', 'dialog'); modal.root.setAttribute('aria-modal', 'true'); modal.root.setAttribute('aria-label', 'Set up Hone');
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const candidates = Array.from(modal.root.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')).filter(node => !('disabled' in node && node.disabled) && !node.hidden && !node.closest('[hidden], [inert]'));
      const first = candidates[0], last = candidates.at(-1);
      if (!first || !last) { event.preventDefault(); heading.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !candidates.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !candidates.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    modal.root.addEventListener('keydown', trap);
    modal.onDismiss(() => {
      modal.root.removeEventListener('keydown', trap);
      if (session.modal === modal) { session.modal = undefined; close(session); }
      if (!session.skipRestore && session.chatId === chatId() && session.path === path()) {
        const previous = previousFocus && !previousFocus.matches('[data-hone-input-btn]') && visible(previousFocus) ? previousFocus : undefined;
        const input = document.querySelector<HTMLTextAreaElement>('[data-component="InputArea"] textarea');
        const target = previous ?? (input && visible(input) ? input : undefined);
        target?.focus({ preventScroll: true });
      }
    });
    const progress = element('p', 'jb-hone-progress');
    const heading = element('h3', 'jb-hone-heading'); heading.tabIndex = -1;
    const visual = element('div', 'jb-hone-visual');
    const instruction = element('p', 'jb-hone-instruction');
    const detail = element('p', 'jb-hone-detail');
    const tools = element('div', 'jb-hone-step-tools');
    const status = element('p', 'jb-hone-state', notice ?? session.installation?.notice ?? 'Check Hone in Extensions.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const navigation = element('div', 'jb-hone-navigation');
    const back = button('Back'), next = button('Next', true), recheck = button('Recheck Hone'), done = button('Close');
    navigation.append(back, next, recheck, done);
    const documentation = external('Hone documentation', HONE_QUICK_START);
    const footer = element('p', 'jb-hone-notice', 'Setup opens Hone’s own controls. Choosing Enhance here never sends your message.'); footer.append(document.createTextNode(' '), documentation);
    modal.root.append(progress, heading, visual, instruction, detail, tools, status, navigation, footer);
    let checking = false;
    const isOpen = () => current(session) && session.modal === modal;

    function render(moveFocus = false) {
      if (!isOpen()) return;
      const data = [
        { title: 'Install and enable Hone', instruction: session.installation?.administrator ? 'Ask this Lumiverse instance’s administrator to install Hone with the repository below.' : 'Open Extensions → Add Extension. Paste the repository into GitHub repo URL... and choose Install from Source.', detail: session.installation?.administrator ? 'This account cannot install extensions. Your administrator can use Extensions → Add Extension → Install from Source.' : 'Keep the Default branch. Enable Hone and review its permissions. Return to your chat → Writing tools → Enhance my draft; Setup guide is available there for the remaining steps.', image: 'hone-install' },
        { title: 'Choose the model', instruction: 'Open Hone → Models. Leave Model Profile: Default to use Lumiverse’s default connection.', detail: 'Have a working Lumiverse API connection first. For a different model, choose Duplicate or + New, then select its Connection. Changes save as you choose them.', image: 'hone-models' },
        { title: 'Choose the draft instructions', instruction: 'In Hone → Input, find Hone Input Preset: and choose Input Single Pass 1.0.', detail: 'This is the built-in default. Selecting a preset activates it immediately; there is no separate Save. These instructions refine your own draft, separately from AI-reply settings.', image: 'hone-input' },
        { title: 'Refine, review, then send', instruction: 'Return to your chat and type an unsent draft. Click Hone’s button beside the message box.', detail: 'Hone replaces the draft with its revision. Review or edit it; the same button offers Undo. Use Send only when you are ready. Clicking Hone while it is working cancels that request.', image: 'hone-toolbar' },
      ][session.step];
      progress.textContent = `Step ${session.step + 1} of 4`;
      heading.textContent = data.title; instruction.textContent = data.instruction; detail.textContent = data.detail;
      visual.replaceChildren(); const image = screenshot(options.screenshots?.[data.image as HoneScreenshotKey]); if (image) visual.append(image); visual.hidden = !image;
      tools.replaceChildren(); tools.className = 'jb-hone-step-tools jb-hone-actions';
      if (session.step === 0) {
        const label = element('label', 'jb-hone-repository', 'Hone repository');
        const repository = element('input'); repository.type = 'text'; repository.readOnly = true; repository.value = HONE_REPOSITORY; repository.setAttribute('aria-label', 'Hone repository URL'); repository.addEventListener('focus', () => repository.select()); label.append(repository);
        const copy = button('Copy repository link');
        copy.addEventListener('click', () => {
          if (!isOpen()) return; repository.focus(); repository.select();
          const clipboard = document.defaultView?.navigator.clipboard;
          if (!clipboard?.writeText) { status.textContent = 'The repository link is selected. Copy it and paste it into GitHub repo URL... in Extensions.'; return; }
          void clipboard.writeText(HONE_REPOSITORY).then(() => { if (isOpen()) status.textContent = 'Repository copied. In Extensions, choose Add Extension, paste it, then Install from Source.'; }).catch(() => { if (isOpen()) status.textContent = 'The repository link is selected. Copy it and paste it into Extensions.'; });
        });
        const extensions = button('Open Extensions', true); extensions.addEventListener('click', () => { if (isOpen()) void invoke(session, 'spindle', status); });
        tools.append(label, extensions, copy, external('View Hone', HONE_REPOSITORY));
      } else if (session.step < 3) {
        const panel = honePanel(session);
        const open = button('Open Hone', true);
        open.addEventListener('click', () => {
          if (!isOpen()) return;
          if (!panel) { status.textContent = 'Open Hone from Lumiverse’s sidebar after enabling it. If it is missing, return to Step 1 and open Extensions.'; return; }
          void invoke(session, panel.id, status, session.installation?.runningId);
        });
        tools.append(open);
      } else {
        const show = button('Find Hone button', true); show.addEventListener('click', () => { if (isOpen()) void check(true); }); tools.append(show);
      }
      back.disabled = session.step === 0; next.hidden = session.step === 3;
      if (moveFocus) { heading.focus({ preventScroll: true }); try { heading.scrollIntoView?.({ block: 'start', behavior: 'instant' }); } catch { /* Focus still identifies the new step. */ } }
    }
    async function check(handoff: boolean) {
      if (!isOpen() || checking) return;
      checking = true; recheck.disabled = true; status.textContent = 'Checking Hone…';
      const result = await readInstallation(session);
      if (!isOpen()) return;
      checking = false; recheck.disabled = false;
      if (!result) return;
      status.textContent = result.notice;
      if (handoff && result.runningId) {
        session.skipRestore = true; session.modal = undefined; modal.dismiss(); showHint(session);
      } else render();
    }
    back.addEventListener('click', () => { if (isOpen() && session.step > 0) { session.step--; render(true); } });
    next.addEventListener('click', () => { if (isOpen() && session.step < 3) { session.step++; render(true); } });
    recheck.addEventListener('click', () => { void check(false); }); done.addEventListener('click', () => { if (isOpen()) close(session); });
    render(); heading.focus({ preventScroll: true });
  }

  async function enhanceDraft() {
    if (disposed) return;
    if (active) { active.skipRestore = true; close(active); }
    const session: Session = { controller: new AbortController(), closed: false, chatId: chatId(), path: path(), read: 0, step: 0 }; active = session;
    const installation = await readInstallation(session);
    if (!current(session) || !installation) return;
    if (installation.runningId) showHint(session); else openGuide(session);
  }
  return {
    enhanceDraft,
    destroy() {
      if (disposed) return; disposed = true; if (active) { active.skipRestore = true; close(active); }
      cleanups.splice(0).forEach(cleanup => cleanup());
      win?.removeEventListener('popstate', checkNavigation); win?.removeEventListener('hashchange', checkNavigation); document.removeEventListener('keydown', escape);
    },
  };
}
