import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

export type ComposerLayout = 'lumiverse' | 'janitorai';
export const COMPOSER_LAYOUT_KEY = 'chat:composer_layout_v1';
type Options = {
  onLayoutChange(layout: ComposerLayout): void;
  openApi(): void;
  openMemory(): void;
  openPersonas(): void;
  openHone(): void | Promise<void>;
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}

/** Layout preferences and help never run generation or change a message draft. */
export function createChatTools(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, layout: ComposerLayout = 'lumiverse', revision = 0;
  let modal: SpindleModalHandle | undefined, render: (() => void) | undefined;
  let notice = '', writes = Promise.resolve();
  const oldTools = document.documentElement.getAttribute('data-jb-tools');
  function apply(value: ComposerLayout) {
    layout = value;
    document.documentElement.setAttribute('data-jb-tools', String(value === 'lumiverse'));
    options.onLayoutChange(value); render?.();
  }
  async function setLayout(value: ComposerLayout) {
    if (disposed) return;
    const ticket = ++revision;
    notice = ''; apply(value);
    const settings = ctx.settings;
    if (!settings?.set) { notice = 'This Lumiverse version cannot save this preference. Your choice lasts until reload.'; render?.(); return; }
    writes = writes.catch(() => {}).then(async () => {
      if (!disposed) await settings.set(COMPOSER_LAYOUT_KEY, value);
    });
    try { await writes; }
    catch { if (!disposed && revision === ticket) { notice = 'Your layout changed, but could not be saved. Choose it again to retry.'; render?.(); } }
  }
  apply('lumiverse');
  const ready = (async () => {
    const ticket = revision;
    try {
      const value = await ctx.settings?.get<unknown>(COMPOSER_LAYOUT_KEY);
      if (!disposed && ticket === revision && (value === 'lumiverse' || value === 'janitorai')) apply(value);
    } catch { /* A failed preference read leaves the complete native toolbar available. */ }
  })();

  function openHelp() {
    if (disposed) return;
    if (modal) { modal.root.querySelector<HTMLButtonElement>('.jb-chat-help-close')?.focus(); return; }
    const previousFocus = document.activeElement as HTMLElement | null;
    const current = ctx.ui.showModal({ title: 'Chat tools & help', width: 650, maxHeight: 850 }); modal = current;
    const root = current.root; root.classList.add('jb-settings', 'jb-chat-help');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Chat tools & help');
    const close = node('button', 'jb-button jb-chat-help-close', 'Close'); close.type = 'button'; close.addEventListener('click', () => current.dismiss());
    const heading = node('h2', '', 'Your chat, your way');
    const intro = node('p', 'jb-settings-help', 'Use all of Lumiverse’s chat tools, or choose a simpler composer inspired by JanitorAI. You can switch back at any time.');
    const choices = node('fieldset', 'jb-chat-layouts'); choices.append(node('legend', '', 'Chat composer'));
    const inputs = new Map<ComposerLayout, HTMLInputElement>();
    for (const [value, title, detail] of [
      ['lumiverse', 'Lumiverse tools', 'Default · Keep the native chat toolbar and your extension controls visible.'],
      ['janitorai', 'JanitorAI-style', 'A simpler message box with Writing tools and a persona picker. The native toolbar is tucked away.'],
    ] as const) {
      const label = node('label', 'jb-chat-layout'); const input = node('input'); input.type = 'radio'; input.name = 'jb-composer-layout'; input.value = value;
      const text = node('span'); text.append(node('strong', '', title), node('span', 'jb-chat-layout-detail', detail));
      label.append(input, text); choices.append(label); inputs.set(value, input);
      input.addEventListener('change', () => { if (input.checked) void setLayout(value); });
    }
    const status = node('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    render = () => { for (const [value, input] of inputs) { input.checked = value === layout; input.closest('label')?.classList.toggle('jb-selected', input.checked); } status.textContent = notice; };
    render();
    const help = node('section', 'jb-chat-help-links'); help.append(node('h3', '', 'Looking for something familiar?'));
    function link(title: string, detail: string, label: string, action: () => void | Promise<void>, needsChat = false) {
      const row = node('div', 'jb-chat-help-row'); const text = node('div'); text.append(node('h4', '', title), node('p', '', detail));
      const button = node('button', 'jb-button', label); button.type = 'button'; button.disabled = needsChat && !ctx.getActiveChat()?.chatId;
      if (button.disabled) button.title = 'Open a chat first.';
      button.addEventListener('click', () => { current.dismiss(); void Promise.resolve().then(() => { if (!disposed) return action(); }).catch(() => {}); });
      row.append(text, button); help.append(row);
    }
    link('API, prompt & generation', 'Choose the model, edit instructions, or adjust the reply settings.', 'Open settings', options.openApi);
    link('Chat memory', 'Keep important story facts in the Memory tab. It is also in the chat menu.', 'Open memory', options.openMemory, true);
    link('Your persona', 'Choose who you play. The JanitorAI-style layout also puts a picker beside your message.', 'Manage personas', options.openPersonas);
    link('Hone · optional', 'Already use Hone? Find its own draft button or follow its setup guide. Writing tools also work without Hone.', 'Find Hone', options.openHone, true);
    const writing = node('p', 'jb-settings-help', 'In JanitorAI-style mode, Writing tools can enhance a draft, suggest your next message, or prepare a summary. Review the result before applying it; sending stays your choice.');
    const actions = node('div', 'jb-settings-actions'); actions.append(close);
    root.append(heading, intro, choices, status, help, writing, actions);
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); current.dismiss(); return; }
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:checked')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener('keydown', keys);
    current.onDismiss(() => {
      root.removeEventListener('keydown', keys);
      if (modal === current) { modal = undefined; render = undefined; }
      if (!disposed && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
    inputs.get(layout)?.focus({ preventScroll: true });
  }
  return { openHelp, setLayout, ready, getLayout: () => layout, destroy() {
    if (disposed) return; disposed = true; modal?.dismiss(); modal = undefined; render = undefined;
    if (oldTools === null) document.documentElement.removeAttribute('data-jb-tools'); else document.documentElement.setAttribute('data-jb-tools', oldTools);
  } };
}
