import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

/** The host adds the extension namespace and authenticated user scope. */
export const WELCOME_COMPLETED_KEY = 'onboarding:welcome_completed_v1';
export interface WelcomeOptions {
  openHome(): Promise<boolean>;
  openGlossary(): boolean;
}
type Session = { modal: SpindleModalHandle; closed: boolean; busy: boolean; acknowledgeOnClose: boolean };
const DIALOG_SELECTOR = '[data-spindle-modal], [role="dialog"], [aria-modal="true"], dialog[open]';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function button(label: string, primary = false) {
  const node = element('button', `jb-button${primary ? ' jb-primary' : ''}`, label); node.type = 'button'; return node;
}

/** An optional orientation screen. Reads never navigate, grant permissions or acknowledge it. */
export function createWelcome(ctx: SpindleFrontendContext, options: WelcomeOptions) {
  let disposed = false, attempted = false, acknowledged = false, epoch = 0;
  let current: Session | undefined, stopPending: (() => void) | undefined;
  const pathname = () => document.defaultView?.location.pathname ?? '';
  const inChat = () => /^\/chat(?:\/|$)/.test(pathname());
  function hasDialog() {
    return [...document.querySelectorAll(DIALOG_SELECTOR)].some(node => !node.closest('[hidden], [aria-hidden="true"]'));
  }
  function cancelPending() { epoch++; stopPending?.(); stopPending = undefined; }
  function acknowledge() {
    if (disposed || acknowledged) return;
    acknowledged = true;
    // A missing/older settings surface or failed persistence must never break
    // navigation or create an unhandled rejection after a user closes this screen.
    try { void ctx.settings?.set(WELCOME_COMPLETED_KEY, true).catch(() => {}); } catch {}
  }
  function show(): boolean {
    if (disposed) return false;
    if (current && !current.closed) { current.modal.root.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); return true; }
    let modal: SpindleModalHandle;
    try { modal = ctx.ui.showModal({ title: 'Welcome to Janiverse', width: 560, maxHeight: 720 }); } catch { return false; }
    const session: Session = { modal, closed: false, busy: false, acknowledgeOnClose: true }; current = session;
    modal.root.classList.add('jb-welcome'); modal.root.setAttribute('role', 'dialog'); modal.root.setAttribute('aria-label', 'Welcome to Janiverse');
    const lead = element('p', 'jb-welcome-lead', 'A familiar way to use Lumiverse.');
    const steps = element('ul', 'jb-welcome-steps');
    for (const text of ['Janiverse Home has your characters, My Chats and a short setup checklist: connect your AI, then add a card.', 'Coming from JanitorAI? “Where did it go?” finds familiar features by their old names.', 'Guides for everything else are in Help.']) steps.append(element('li', '', text));
    const permissions = element('p', 'jb-welcome-hint', 'No permissions enabled yet? That’s normal. Janiverse asks when you choose a feature.');
    const panel = element('p', 'jb-welcome-hint', 'If the Extensions panel is covering the page, close it with its ×.');
    const data = element('p', 'jb-welcome-data', 'Your characters, chats and settings stay in Lumiverse.');
    const status = element('p', 'jb-welcome-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = element('div', 'jb-welcome-actions');
    const home = button('Open Janiverse Home', true), glossary = button('Where did it go?'), later = button('Got it');
    const allButtons = [home, glossary, later];
    const alive = () => !disposed && current === session && !session.closed;
    const setBusy = (value: boolean) => { session.busy = value; for (const node of allButtons) node.disabled = value; modal.root.setAttribute('aria-busy', String(value)); };
    async function act(action: () => boolean | void | Promise<boolean | void>, kind: 'home' | 'glossary') {
      if (!alive() || session.busy) return;
      setBusy(true); status.textContent = kind === 'home' ? 'Opening Janiverse Home…' : '';
      try {
        const result = await action();
        if (!alive()) return;
        if (result === false || (kind === 'home' && result !== true)) throw new Error('Destination unavailable');
        acknowledge(); modal.dismiss();
      } catch {
        if (!alive()) return;
        status.textContent = kind === 'home' ? 'Janiverse Home could not open. Try again.' : 'Could not open “Where did it go?”. Try again.';
        if (kind === 'home') home.textContent = 'Retry opening Janiverse Home';
      } finally { if (alive()) setBusy(false); }
    }
    home.addEventListener('click', () => { void act(() => options.openHome(), 'home'); });
    glossary.addEventListener('click', () => { void act(() => options.openGlossary(), 'glossary'); });
    later.addEventListener('click', () => { if (alive()) modal.dismiss(); });
    actions.append(home, glossary, later); modal.root.append(lead, steps, permissions, panel, data, status, actions);
    modal.onDismiss(() => {
      if (session.closed) return; session.closed = true;
      if (current === session) current = undefined;
      if (session.acknowledgeOnClose) acknowledge();
    });
    return true;
  }
  function open() { cancelPending(); attempted = true; return show(); }
  async function maybeOpen(): Promise<boolean> {
    if (disposed || attempted || acknowledged || current || inChat() || hasDialog()) return false;
    attempted = true;
    if (!ctx.settings?.get || !ctx.permissions?.getGranted) return false;
    const generation = ++epoch, path = pathname(), cleanups: Array<() => void> = [];
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; for (const cleanup of cleanups) cleanup(); if (stopPending === stop) stopPending = undefined; };
    stopPending = stop;
    for (const name of ['pointerdown', 'click', 'keydown', 'wheel', 'touchstart']) {
      document.addEventListener(name, cancelPending, { capture: true, passive: true });
      cleanups.push(() => document.removeEventListener(name, cancelPending, true));
    }
    const win = document.defaultView;
    for (const name of ['popstate', 'hashchange']) {
      win?.addEventListener(name, cancelPending); cleanups.push(() => win?.removeEventListener(name, cancelPending));
    }
    const Observer = win?.MutationObserver;
    if (Observer) {
      const isDialog = (node: Node) => node.nodeType === 1 && ((node as Element).matches(DIALOG_SELECTOR) || !!(node as Element).querySelector(DIALOG_SELECTOR));
      const observer = new Observer(records => {
        if (hasDialog() || records.some(record => [...record.addedNodes].some(isDialog))) cancelPending();
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'open', 'data-spindle-modal'] });
      cleanups.push(() => observer.disconnect());
    }
    try {
      const [completed, granted] = await Promise.all([ctx.settings.get<unknown>(WELCOME_COMPLETED_KEY), ctx.permissions.getGranted()]);
      if (disposed || generation !== epoch || current || acknowledged || path !== pathname() || inChat() || hasDialog() || completed !== undefined || !Array.isArray(granted) || granted.length !== 0) return false;
      stop(); return show();
    } catch { return false; }
    finally { stop(); }
  }
  return {
    maybeOpen, open,
    destroy() {
      if (disposed) return; disposed = true; cancelPending();
      if (current) { current.acknowledgeOnClose = false; current.modal.dismiss(); current = undefined; }
    },
  };
}
