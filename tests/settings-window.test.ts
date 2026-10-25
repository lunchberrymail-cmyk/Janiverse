import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createSettingsWindow, type SettingsSection } from '../src/settings-window';

const original = { document: globalThis.document, location: globalThis.location, MutationObserver: globalThis.MutationObserver };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let dom: JSDOM, window: ReturnType<typeof createSettingsWindow>, ctx: any;
let activeChat: string | null, hasChat: boolean, hostCalls: number, hostCloses: number;
let nativeHeader: HTMLElement, nativeFrame: HTMLElement, nativeLayer: HTMLElement;
let subscriptions: Set<() => void>, navigation: SettingsSection[], bareHost: boolean;

function topTab(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('.jb-settings-window-tabs button')].find(tab => tab.textContent === name)!;
}
function action(label: string) { return document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!; }
function editor(section: SettingsSection = 'settings', title = 'Connection') { return window.context(section).ui.showModal({ title }); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><button id="opener">Open settings</button><main id="native">Native chat</main></body>', { url: 'http://localhost/chat/chat-1' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.MutationObserver = dom.window.MutationObserver;
  activeChat = 'chat-1'; hasChat = true; hostCalls = hostCloses = 0; subscriptions = new Set(); navigation = []; bareHost = false;
  ctx = {
    getActiveChat: () => ({ chatId: activeChat }),
    chats: { nativeCapability: true },
    state: { subscribe(name: string, handler: () => void) { expect(name).toBe('chat.active'); subscriptions.add(handler); return () => subscriptions.delete(handler); } },
    ui: { nativeCapability: true, showModal() {
      hostCalls++; const root = document.createElement('div');
      nativeLayer = document.createElement('div'); nativeFrame = document.createElement('div'); nativeHeader = document.createElement('header'); const body = document.createElement('div');
      if (bareHost) document.body.append(root);
      else { body.append(root); nativeFrame.append(nativeHeader, body); nativeLayer.append(nativeFrame); document.body.append(nativeLayer); }
      let closed = false; const listeners = new Set<() => void>();
      return { root, modalId: `host-${hostCalls}`, setTitle() {}, onDismiss(handler: () => void) { listeners.add(handler); return () => listeners.delete(handler); }, dismiss() {
        if (closed) return; closed = true; hostCloses++; for (const handler of [...listeners]) handler(); root.remove(); nativeLayer.remove();
      } };
    } },
  };
  window = createSettingsWindow(ctx, { hasChat: () => hasChat, navigate: section => { navigation.push(section); editor(section, section); } });
});

afterEach(async () => {
  window.destroy(); await settle(); dom.window.close(); globalThis.document = original.document; globalThis.location = original.location; globalThis.MutationObserver = original.MutationObserver;
});

test('wraps only modal creation and skins the dedicated host frame', () => {
  const context = window.context('settings'); expect(context).toBe(window.context('settings')); expect(context.chats).toBe(ctx.chats); expect((context.ui as any).nativeCapability).toBe(true);
  const child = editor(); expect(hostCalls).toBe(1); expect(child.modalId).toBe('host-1-editor');
  expect(nativeLayer.classList.contains('jb-settings-window-layer')).toBe(true); expect(nativeFrame.classList.contains('jb-settings-window-frame')).toBe(true); expect(nativeHeader.classList.contains('jb-settings-window-native-header')).toBe(true);
  expect(document.querySelectorAll('.jb-settings-window-root')).toHaveLength(1); expect(document.querySelector('#native')!.textContent).toBe('Native chat');
  expect(child.root.closest('.jb-settings-window-content')?.getAttribute('aria-labelledby')).toBe(topTab('Settings').id);
  expect(topTab('Settings').getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(topTab('Settings'));
});

test('does not style the document body for a simpler host implementation', () => {
  bareHost = true; editor(); expect(document.body.className).toBe(''); expect(document.querySelector('.jb-settings-window-root')).not.toBeNull();
});

test('synchronous tab transitions reuse one host and immediately discard the previous session', async () => {
  const first = editor(); const key = document.createElement('input'); key.type = 'password'; key.value = 'synthetic draft'; first.root.append(key);
  const abort = new AbortController(); let dismissed = 0;
  first.onDismiss(() => { dismissed++; abort.abort(); key.value = ''; });
  first.dismiss(); const second = editor('memory', 'Chat Memory'); await settle();
  expect(hostCalls).toBe(1); expect(hostCloses).toBe(0); expect(dismissed).toBe(1); expect(abort.signal.aborted).toBe(true); expect(key.value).toBe(''); expect(first.root.isConnected).toBe(false);
  expect(second.root.isConnected).toBe(true); expect(topTab('Memory').getAttribute('aria-selected')).toBe('true');
  first.dismiss(); expect(dismissed).toBe(1);
});

test('an editor dismiss without a replacement closes the shared host', async () => {
  const child = editor(); child.dismiss(); expect(child.root.isConnected).toBe(false); await settle(); expect(hostCloses).toBe(1); expect(document.querySelector('.jb-settings-window-root')).toBeNull();
});

test('close and Escape each clean up once and restore the opener', async () => {
  const opener = document.querySelector<HTMLButtonElement>('#opener')!; opener.focus(); const first = editor(); let dismissed = 0; first.onDismiss(() => dismissed++);
  action('Close settings').click(); await settle(); expect(dismissed).toBe(1); expect(hostCloses).toBe(1); expect(document.activeElement).toBe(opener);
  const second = editor(); second.onDismiss(() => dismissed++); const field = document.createElement('textarea'); second.root.append(field); field.focus();
  field.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); expect(dismissed).toBe(2); expect(hostCloses).toBe(2); expect(document.activeElement).toBe(opener);
});

test('collapse preserves draft content and scroll until expanded', () => {
  const child = editor(); const draft = document.createElement('textarea'); draft.value = 'Unsaved instructions'; child.root.append(draft); const content = child.root.parentElement!; content.scrollTop = 123;
  action('Collapse settings').click(); expect(content.hidden).toBe(true); expect(nativeFrame.classList.contains('jb-settings-window-collapsed')).toBe(true); expect(draft.isConnected).toBe(true);
  action('Expand settings').click(); expect(content.hidden).toBe(false); expect(content.scrollTop).toBe(123); expect(draft.value).toBe('Unsaved instructions'); expect(hostCalls).toBe(1);
});

test('top tabs navigate within the window and keyboard focus does not discard drafts', async () => {
  const first = editor(); topTab('Settings').focus(); topTab('Settings').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(document.activeElement).toBe(topTab('Memory')); expect(first.root.isConnected).toBe(true); expect(navigation).toEqual([]);
  topTab('Memory').click(); await settle(); expect(navigation).toEqual(['memory']); expect(first.root.isConnected).toBe(false); expect(hostCalls).toBe(1); expect(hostCloses).toBe(0);
  expect(topTab('Memory').getAttribute('aria-selected')).toBe('true'); expect(topTab('Settings').getAttribute('aria-selected')).toBe('false');
});

test('home clearly disables chat-only tabs without invoking their editors', () => {
  activeChat = null; hasChat = false; editor(); expect(topTab('Memory').disabled).toBe(true); expect(topTab('Customize').disabled).toBe(true); expect(topTab('Memory').title).toContain('Open a chat');
  topTab('Memory').click(); topTab('Customize').click(); expect(navigation).toEqual([]); expect(topTab('Settings').disabled).toBe(false);
});

test('saving editors lock section navigation until their existing operation finishes', async () => {
  const child = editor(); const form = document.createElement('form'); child.root.append(form); form.setAttribute('aria-busy', 'true'); await settle();
  expect(topTab('Memory').disabled).toBe(true); expect(topTab('Settings').disabled).toBe(true); topTab('Memory').click(); expect(navigation).toEqual([]);
  form.setAttribute('aria-busy', 'false'); await settle(); expect(topTab('Memory').disabled).toBe(false); expect(topTab('Settings').disabled).toBe(false);
});

test('chat changes close scoped drafts, while unrelated active-chat notifications preserve them', async () => {
  const child = editor('memory', 'Chat Memory'); let dismissed = 0; child.onDismiss(() => dismissed++);
  for (const notify of [...subscriptions]) notify(); expect(child.root.isConnected).toBe(true);
  activeChat = 'chat-2'; for (const notify of [...subscriptions]) notify(); await settle(); expect(dismissed).toBe(1); expect(hostCloses).toBe(1);
  window.destroy(); expect(subscriptions.size).toBe(0);
});

test('route changes close old drafts but preserve an editor opened on the new route before the next poll', async () => {
  const old = editor(); dom.window.history.pushState({}, '', '/'); window.syncRoute(); await settle(); expect(old.root.isConnected).toBe(false); expect(hostCloses).toBe(1);
  const fresh = editor(); window.syncRoute(); await settle(); expect(fresh.root.isConnected).toBe(true); expect(hostCloses).toBe(1);
});

test('Customize adoption preserves its owner cleanup and closes when that owner removes it', async () => {
  const first = editor(); let oldDismissed = 0; first.onDismiss(() => oldDismissed++); const panel = document.createElement('aside'); document.body.append(panel); let cleanup = 0;
  window.adoptCustomize(panel, () => { cleanup++; panel.remove(); }); await settle();
  expect(oldDismissed).toBe(1); expect(hostCalls).toBe(1); expect(hostCloses).toBe(0); expect(panel.classList.contains('jb-customize-embedded')).toBe(true); expect(panel.getAttribute('role')).toBe('group'); expect(topTab('Customize').getAttribute('aria-selected')).toBe('true');
  panel.remove(); await settle(); expect(cleanup).toBe(1); expect(hostCloses).toBe(1);
});

test('preparing a replacement Customize cleans the old owner before a new panel is created', async () => {
  let panel: HTMLElement | undefined, cleanups = 0;
  const customize = () => { window.dismissEditor(); panel = document.createElement('aside'); document.body.append(panel); window.adoptCustomize(panel, () => { cleanups++; panel?.remove(); }); return panel; };
  const first = customize(), second = customize(); await settle(); expect(cleanups).toBe(1); expect(first.isConnected).toBe(false); expect(second.isConnected).toBe(true); expect(hostCalls).toBe(1); expect(hostCloses).toBe(0);
  window.close(); await settle(); expect(cleanups).toBe(2); expect(second.isConnected).toBe(false);
});

test('destroy invalidates saved wrapper contexts and removes the active editor once', async () => {
  const context = window.context('settings'), child = editor(); let dismissed = 0; child.onDismiss(() => dismissed++);
  window.destroy(); window.destroy(); await settle(); expect(dismissed).toBe(1); expect(hostCloses).toBe(1); expect(subscriptions.size).toBe(0); expect(() => context.ui.showModal({ title: 'Late editor' })).toThrow('destroyed'); expect(hostCalls).toBe(1);
});
