import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { subscribeOptionalState } from './optional-state';

export type SettingsSection = 'settings' | 'memory' | 'customize';
type ModalOptions = Parameters<SpindleFrontendContext['ui']['showModal']>[0];
type Child = { root: HTMLElement; handle: SpindleModalHandle; closed: boolean; dismiss(): void };
type WindowState = { modal: SpindleModalHandle; content: HTMLElement; tabs: Map<SettingsSection, HTMLButtonElement>; collapse: HTMLButtonElement; frame?: HTMLElement; child?: Child; section: SettingsSection; scroll: Map<SettingsSection, number>; stopRestore?: () => void; collapsed: boolean; closed: boolean; closePending: boolean; chatId: string | null; pathname: string | null; previousFocus: HTMLElement | null };
let nextWindowId = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}

/** One host-owned window; editor sessions still own their cancellation and native saves. */
export function createSettingsWindow(ctx: SpindleFrontendContext, options: { navigate(section: SettingsSection): void; hasChat(): boolean }) {
  let disposed = false, current: WindowState | undefined;
  const contexts = new Map<SettingsSection, SpindleFrontendContext>();

  // Editors mark native writes with data-jb-saving; closing waits so they can finish and report partial failures.
  const saving = (window: WindowState) => !!window.child?.root.querySelector('[data-jb-saving="true"]') || window.child?.root.getAttribute('data-jb-saving') === 'true';
  function updateNavigation(window: WindowState) {
    if (window.closePending && !saving(window)) { window.modal.dismiss(); return; }
    const busy = !!window.child?.root.querySelector('[aria-busy="true"]') || window.child?.root.getAttribute('aria-busy') === 'true';
    for (const [section, tab] of window.tabs) {
      tab.setAttribute('aria-selected', String(section === window.section)); tab.tabIndex = section === window.section ? 0 : -1;
      const needsChat = section !== 'settings' && !options.hasChat();
      tab.disabled = busy || needsChat;
      tab.title = needsChat ? `Open a chat to ${section === 'memory' ? 'edit its memory' : 'customize it'}.` : '';
    }
  }
  function setCollapsed(window: WindowState, value: boolean) {
    window.collapsed = value; window.content.hidden = value;
    window.modal.root.classList.toggle('jb-settings-window-collapsed', value); window.frame?.classList.toggle('jb-settings-window-collapsed', value);
    window.collapse.textContent = value ? '+' : '−'; window.collapse.setAttribute('aria-label', value ? 'Expand settings' : 'Collapse settings'); window.collapse.setAttribute('aria-expanded', String(!value));
  }
  function close() { if (current && saving(current)) current.closePending = true; else current?.modal.dismiss(); }
  function makeWindow(section: SettingsSection): WindowState {
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = ctx.ui.showModal({ title: 'Chat settings', width: 520, maxHeight: 960 });
    const root = modal.root; root.classList.add('jb-settings-window-root'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Chat settings'); root.setAttribute('aria-modal', 'false');
    const body = root.parentElement, frame = body?.parentElement, layer = frame?.parentElement;
    // Only skin the host's dedicated modal hierarchy. Simple test/mock roots or
    // future different host structures retain the normal modal presentation.
    const hasHostFrame = !!body && !!frame && !!layer && layer.parentElement === document.body && body !== document.body;
    if (hasHostFrame) {
      body.classList.add('jb-settings-window-body'); frame.classList.add('jb-settings-window-frame'); layer.classList.add('jb-settings-window-layer');
      frame.firstElementChild?.classList.add('jb-settings-window-native-header');
    }
    const header = element('header', 'jb-settings-window-header');
    const dismiss = element('button', 'jb-settings-window-icon', '×'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Close settings'); dismiss.addEventListener('click', close);
    const collapse = element('button', 'jb-settings-window-icon', '−'); collapse.type = 'button'; collapse.setAttribute('aria-label', 'Collapse settings'); collapse.setAttribute('aria-expanded', 'true');
    const tabs = element('nav', 'jb-settings-window-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Chat settings sections');
    const content = element('div', 'jb-settings-window-content'); content.id = `jb-settings-window-${++nextWindowId}`; content.setAttribute('role', 'tabpanel');
    const window: WindowState = { modal, content, tabs: new Map(), collapse, frame: hasHostFrame ? frame : undefined, section, scroll: new Map(), collapsed: false, closed: false, closePending: false, chatId: ctx.getActiveChat()?.chatId ?? null, pathname: typeof location === 'undefined' ? null : location.pathname, previousFocus };
    for (const [label, key] of [['Settings', 'settings'], ['Memory', 'memory'], ['Customize', 'customize']] as const) {
      const tab = element('button', '', label); tab.type = 'button'; tab.id = `${content.id}-${key}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', content.id);
      tab.addEventListener('click', () => {
        if (disposed || window.closed || tab.disabled) return;
        setCollapsed(window, false);
        if (window.section !== key) options.navigate(key);
      });
      window.tabs.set(key, tab); tabs.append(tab);
    }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const available = [...window.tabs.values()].filter(tab => !tab.disabled), index = available.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !available.length) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + available.length) % available.length;
      available[next].focus();
    });
    collapse.addEventListener('click', () => setCollapsed(window, !window.collapsed));
    header.append(dismiss, collapse, tabs); root.append(header, content);
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
    modal.onDismiss(() => {
      if (window.closed) return;
      window.closed = true; window.stopRestore?.(); window.child?.dismiss();
      if (current === window) current = undefined;
      if (window.previousFocus?.isConnected) window.previousFocus.focus({ preventScroll: true });
    });
    current = window; updateNavigation(window); return window;
  }
  function show(section: SettingsSection, request: ModalOptions): SpindleModalHandle {
    if (disposed) throw new Error('Settings window has been destroyed.');
    const window = current && !current.closed ? current : makeWindow(section);
    window.child?.dismiss(); window.stopRestore?.(); window.section = section; window.content.dataset.section = section;
    window.content.setAttribute('aria-labelledby', window.tabs.get(section)!.id); setCollapsed(window, false);
    const root = element('section', 'jb-settings-window-editor'); root.setAttribute('aria-label', request.title); window.content.append(root);
    const listeners = new Set<() => void>();
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => updateNavigation(window)) : undefined;
    const child: Child = { root, closed: false, handle: undefined as unknown as SpindleModalHandle, dismiss() {
      if (child.closed) return;
      window.scroll.set(section, window.content.scrollTop);
      child.closed = true; observer?.disconnect(); window.stopRestore?.();
      if (window.child === child) window.child = undefined;
      for (const handler of [...listeners]) { try { handler(); } catch {} }
      listeners.clear(); root.remove();
      // Navigation callbacks dismiss the old editor before opening its next
      // section. Keep the host mounted for that same turn, without keeping any
      // dismissed editor, draft API key or pending request alive.
      queueMicrotask(() => { if (!disposed && current === window && !window.closed && !window.child) window.modal.dismiss(); });
    } };
    child.handle = { root, modalId: `${window.modal.modalId || window.content.id}-editor`, dismiss: child.dismiss,
      setTitle(title: string) { if (!child.closed) root.setAttribute('aria-label', title); },
      onDismiss(handler: () => void) { if (!child.closed) listeners.add(handler); return () => listeners.delete(handler); },
    };
    window.child = child; observer?.observe(root, { attributes: true, attributeFilter: ['aria-busy', 'data-jb-saving'], childList: true, subtree: true }); updateNavigation(window); window.tabs.get(section)?.focus({ preventScroll: true });
    // Editors share this window. Removing a long editor clamps scrollTop before
    // its replacement has loaded. Restore after layout, then leave scrolling
    // entirely to the user; never keep a scroll-restoration loop running.
    const target = window.scroll.get(section) ?? 0;
    window.content.scrollTop = target;
    if (target > 0 && typeof MutationObserver === 'function') {
      let stopped = false;
      const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
      const stop = () => {
        if (stopped) return; stopped = true; restoreObserver.disconnect();
        for (const event of events) window.content.removeEventListener(event, stop);
        if (window.stopRestore === stop) window.stopRestore = undefined;
      };
      const restore = () => {
        if (stopped || child.closed || window.closed) { stop(); return; }
        window.content.scrollTop = target;
        if (root.childElementCount && root.getAttribute('aria-busy') !== 'true' && !root.querySelector('[aria-busy="true"]')) stop();
      };
      const restoreObserver = new MutationObserver(restore);
      restoreObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'hidden'] });
      for (const event of events) window.content.addEventListener(event, stop, { passive: true });
      window.stopRestore = stop; queueMicrotask(restore);
    }
    return child.handle;
  }
  const stopChat = subscribeOptionalState(ctx, 'chat.active', () => { if (current && current.chatId !== (ctx.getActiveChat()?.chatId ?? null)) close(); });
  return {
    context(section: SettingsSection) {
      let context = contexts.get(section);
      if (!context) { context = { ...ctx, ui: { ...ctx.ui, showModal: request => show(section, request) } }; contexts.set(section, context); }
      return context;
    },
    adoptCustomize(panel: HTMLElement, dismiss: () => void) {
      if (disposed) { dismiss(); return; }
      const handle = show('customize', { title: 'Customize' }); panel.classList.add('jb-customize-embedded'); panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'Customize this chat'); handle.root.append(panel);
      const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (panel.parentElement !== handle.root) handle.dismiss(); }) : undefined;
      observer?.observe(handle.root, { childList: true });
      handle.onDismiss(() => { observer?.disconnect(); dismiss(); });
    },
    getEditorRoot() { return current?.child?.root; },
    dismissEditor() { current?.child?.dismiss(); },
    syncRoute() { if (current && current.pathname !== (typeof location === 'undefined' ? null : location.pathname)) close(); },
    close,
    destroy() { if (disposed) return; disposed = true; stopChat?.(); current?.modal.dismiss(); contexts.clear(); },
  };
}
