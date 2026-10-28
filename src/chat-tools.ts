import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleModalHandle } from 'lumiverse-spindle-types';
import { lunchPicks, type LunchPick } from './lunch-picks';
import { icon } from './icons';

export type ComposerLayout = 'lumiverse' | 'janitorai';
type GuideView = 'lumiverse' | 'generation' | 'story' | 'extensions';
export const COMPOSER_LAYOUT_KEY = 'chat:composer_layout_v1';
type Options = {
  onLayoutChange(layout: ComposerLayout): void;
  openSettings(): void;
  openGeneration(): void;
  openMemory(): void;
  openPersonas(): void | Promise<boolean>;
  invoke(ref: SpindleHostSurfaceRef): Promise<boolean>;
};
const recommendations: Array<{ goal: string; pick: LunchPick }> = [
  { goal: 'Polish my writing', pick: { name: 'Hone', url: 'https://github.com/AMousePad/Hone', note: 'Refine AI replies or enhance your own drafts with a separate editing pass.' } },
  ...[
    ['Remember long stories', 'LumiBooks'], ['Hear character voices', 'Choir'], ['Color character dialogue', 'Prism'],
  ].map(([goal, name]) => ({ goal, pick: lunchPicks.find(pick => pick.name === name)! })),
];
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}
/** Discover existing tools without generating, installing, or changing a draft. */
export function createChatTools(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, layout: ComposerLayout = 'lumiverse', revision = 0;
  let modal: SpindleModalHandle | undefined, render: (() => void) | undefined;
  let selectView: ((view: GuideView) => void) | undefined;
  let notice = '', writes = Promise.resolve();
  const oldTools = document.documentElement.getAttribute('data-jb-tools');
  function apply(value: ComposerLayout) {
    layout = value;
    document.documentElement.setAttribute('data-jb-tools', String(value === 'lumiverse'));
    options.onLayoutChange(value); render?.();
  }
  async function setLayout(value: ComposerLayout) {
    if (disposed) return;
    const ticket = ++revision; notice = ''; apply(value);
    const settings = ctx.settings;
    if (!settings?.set) { notice = 'This Lumiverse version cannot save this preference. Your choice lasts until reload.'; render?.(); return; }
    writes = writes.catch(() => {}).then(async () => { if (!disposed) await settings.set(COMPOSER_LAYOUT_KEY, value); });
    try { await writes; }
    catch { if (!disposed && revision === ticket) { notice = 'Your layout changed, but could not be saved. Choose it again to retry.'; render?.(); } }
  }
  apply('lumiverse');
  const ready = (async () => {
    const ticket = revision;
    try {
      const value = await ctx.settings?.get<unknown>(COMPOSER_LAYOUT_KEY);
      if (!disposed && ticket === revision && (value === 'lumiverse' || value === 'janitorai')) apply(value);
    } catch { /* A failed preference read leaves the native toolbar available. */ }
  })();

  function openHelp(view: GuideView = 'lumiverse') {
    if (disposed) return;
    if (modal) { selectView?.(view); return; }
    const previousFocus = document.activeElement as HTMLElement | null;
    const current = ctx.ui.showModal({ title: 'Chat help', width: 600, maxHeight: 760 }); modal = current;
    const root = current.root; root.classList.add('jb-settings', 'jb-chat-help');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Chat help');
    const active = () => !disposed && modal === current;
    const heading = node('p', 'jb-chat-guide-intro', 'Coming from JanitorAI? Find your familiar controls here.');
    const tabs = node('nav', 'jb-chat-guide-tabs'); tabs.setAttribute('aria-label', 'Chat help topics');
    const native = node('section', 'jb-native-guide'), generation = node('section', 'jb-generation-guide'), story = node('section', 'jb-story-guide'), extensions = node('section', 'jb-extension-guide');
    const sections = new Map<GuideView, HTMLElement>([['lumiverse', native], ['generation', generation], ['story', story], ['extensions', extensions]]);
    const preferences = node('details', 'jb-chat-layout-preferences');
    const viewButtons = new Map<GuideView, HTMLButtonElement>();
    selectView = value => {
      for (const [key, section] of sections) section.hidden = value !== key;
      preferences.hidden = value !== 'extensions';
      actionStatus.textContent = '';
      for (const [key, button] of viewButtons) button.setAttribute('aria-pressed', String(value === key));
      viewButtons.get(value)?.focus({ preventScroll: true });
    };
    for (const [value, title] of [['lumiverse', 'Replies'], ['generation', 'AI settings'], ['story', 'Story tools'], ['extensions', 'Extras']] as const) {
      const button = node('button', 'jb-button', title); button.type = 'button'; button.addEventListener('click', () => selectView?.(value));
      viewButtons.set(value, button); tabs.append(button);
    }
    const actionStatus = node('p', 'jb-chat-guide-status'); actionStatus.setAttribute('role', 'status'); actionStatus.setAttribute('aria-live', 'polite');
    function actionButton(title: string, action: () => void | boolean | Promise<void | boolean>, needsChat = false) {
      const button = node('button', 'jb-button', title); button.type = 'button'; button.disabled = needsChat && !ctx.getActiveChat()?.chatId;
      if (button.disabled) button.title = 'Open a chat first.';
      button.addEventListener('click', () => {
        if (!active() || button.disabled) return;
        button.disabled = true; actionStatus.textContent = '';
        void Promise.resolve().then(() => active() ? action() : false).then(opened => {
          if (!active()) return;
          if (opened !== false) current.dismiss();
          else actionStatus.textContent = 'This tool is unavailable. Open it from Lumiverse’s sidebar or settings.';
        }).catch(() => { if (active()) actionStatus.textContent = 'Could not open this tool. Please try again.'; })
          .finally(() => { if (active()) button.disabled = false; });
      });
      return button;
    }
    native.append(node('p', 'jb-chat-guide-location', 'Look for these icons in the toolbar above your message box.'));
    const tips = node('div', 'jb-toolbar-tips');
    for (const [picture, title, detail, location] of [
      ['regenerate', 'Regenerate', 'Try another version of the last AI reply.', 'Message toolbar · circular arrow'],
      ['continue', 'Continue', 'Extend the last AI reply without sending a new message.', 'Message toolbar · bent arrow'],
      ['message', 'Impersonate', 'Let the AI draft your reply as your persona. Review it in the message box before sending.', 'Message toolbar · speech bubble'],
      ['swipes', 'Browse reply versions', 'Use ‹ and › to choose a version. At the newest version, › can generate another.', 'On the AI reply · ‹ 1 / 2 ›'],
    ] as const) {
      const card = node('article', 'jb-chat-guide-card'), titleRow = node('h3'); titleRow.append(icon(picture), node('span', '', title));
      card.append(titleRow, node('p', '', detail), node('small', '', location)); tips.append(card);
    }
    const editing = node('p', 'jb-chat-guide-editing'); editing.append(node('span', '', 'On a message:'), icon('edit'), node('span', '', 'Edit'), icon('trash'), node('span', '', 'Remove'));
    native.append(tips, editing);
    const hiddenToolbar = node('div', 'jb-chat-toolbar-notice');
    const showToolbar = node('button', 'jb-button', 'Show reply toolbar'); showToolbar.type = 'button'; showToolbar.addEventListener('click', () => { void setLayout('lumiverse'); });
    hiddenToolbar.append(node('p', '', 'Your simple layout hides this toolbar.'), showToolbar); native.append(hiddenToolbar);
    native.append(node('p', 'jb-settings-help', 'Missing an icon? Open Customize composer (sliders) above the message box to show hidden actions.'));
    function row(target: HTMLElement, title: string, detail: string, label: string, action: () => void | boolean | Promise<void | boolean>, needsChat = false) {
      const row = node('div', 'jb-chat-help-row'), text = node('div'); text.append(node('h4', '', title), node('p', '', detail));
      row.append(text, actionButton(label, action, needsChat)); target.append(row);
    }
    const settingsPath = node('p', 'jb-chat-guide-location'); settingsPath.append(icon('menu'), node('span', '', 'Chat menu → Generation settings'));
    const samplerTerms = node('dl', 'jb-sampler-terms');
    for (const [name, detail] of [
      ['Temperature', 'Lower is steadier; higher adds variety.'],
      ['Context size', 'The token budget for the prompt and conversation sent to the AI.'],
      ['Max new tokens', 'The maximum length of one AI reply.'],
    ]) samplerTerms.append(node('dt', '', name), node('dd', '', detail));
    const samplerActions = node('div', 'jb-chat-guide-shortcuts'); samplerActions.append(actionButton('Open generation settings', options.openGeneration));
    generation.append(settingsPath, samplerTerms, samplerActions, node('p', 'jb-settings-help', 'Turn on “Use these generation controls”, adjust the values, then save. Advanced controls include Top P, Top K and penalties; support depends on your provider.'));
    row(generation, 'Preset & prompt', 'Choose a preset in Instructions. Customize a copy unlocks its prompt and sampler controls.', 'Open prompt', options.openSettings);
    row(generation, 'Advanced Presets', 'Lumiverse calls its full preset editor Loom. Find block order and its sampler controls here.', 'Open preset editor', () => options.invoke({ kind: 'drawer_tab', id: 'loom' }));
    row(story, 'Your persona', 'Choose who you play in the conversation.', 'Manage personas', options.openPersonas);
    row(story, 'Chat Memory', 'Like a pinned note: facts you want included in this chat’s prompt.', 'Open memory', options.openMemory, true);
    row(story, 'Lorebooks', 'World details that can be recalled through matching keywords.', 'Open Lorebooks', () => options.invoke({ kind: 'drawer_tab', id: 'lorebook' }));
    const moreMemory = node('details', 'jb-chat-more-memory'); moreMemory.append(node('summary', '', 'Summaries & automatic memory'));
    row(moreMemory, 'Summary', 'Review or update a recap of the conversation.', 'Open Summary', () => options.invoke({ kind: 'drawer_tab', id: 'summary' }), true);
    row(moreMemory, 'Memory Cortex', 'Set up automatic recall of people, relationships, and events.', 'Set up Memory Cortex', () => options.invoke({ kind: 'settings_tab', id: 'memoryCortex' })); story.append(moreMemory);

    extensions.append(node('p', 'jb-settings-help', 'Choose what you want to add. These optional extensions each have their own setup.'));
    const goals = node('div', 'jb-extension-goals'); goals.setAttribute('aria-label', 'What would you like to add?');
    const result = node('article', 'jb-extension-result'); result.setAttribute('aria-live', 'polite'); result.hidden = true;
    for (const { goal, pick } of recommendations) {
      const button = node('button', 'jb-button', goal); button.type = 'button'; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (!active()) return;
        for (const option of goals.querySelectorAll('button')) option.setAttribute('aria-pressed', String(option === button));
        const link = node('a', '', 'Read about ' + pick.name); link.href = pick.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
        const url = node('input', 'jb-extension-url'); url.type = 'text'; url.readOnly = true; url.value = pick.url; url.setAttribute('aria-label', pick.name + ' repository URL');
        const copy = node('button', 'jb-button', 'Copy link'); copy.type = 'button';
        const copied = node('p', 'jb-settings-help'); copied.setAttribute('role', 'status');
        copy.addEventListener('click', () => {
          url.focus(); url.select();
          const clipboard = document.defaultView?.navigator.clipboard;
          if (!clipboard?.writeText) { copied.textContent = 'Link selected. Use your device’s Copy command.'; return; }
          void clipboard.writeText(pick.url).then(() => { if (active()) copied.textContent = 'Link copied.'; })
            .catch(() => { if (active()) copied.textContent = 'Link selected. Use your device’s Copy command.'; });
        });
        const actions = node('div', 'jb-extension-actions'); actions.append(copy, actionButton('Open Extensions', () => options.invoke({ kind: 'drawer_tab', id: 'spindle' })));
        result.replaceChildren(node('h3', '', pick.name), node('p', '', pick.note), link,
          node('p', 'jb-settings-help', 'Copy the repository link, open Extensions, and install from that URL. Review its permissions, enable it, then follow its setup guide. Already installed? Open Extensions to manage it.'), url, actions, copied);
        result.hidden = false; actionStatus.textContent = '';
      });
      goals.append(button);
    }
    extensions.append(goals, result);
    preferences.append(node('summary', '', 'Choose your chat layout'));
    const choices = node('fieldset', 'jb-chat-layouts'); choices.append(node('legend', '', 'Chat composer'));
    const inputs = new Map<ComposerLayout, HTMLInputElement>();
    for (const [value, title, detail] of [
      ['lumiverse', 'Lumiverse tools', 'Default · Native chat toolbar and extension controls.'],
      ['janitorai', 'JanitorAI-style', 'A simpler message box with extension discovery and a persona picker.'],
    ] as const) {
      const label = node('label', 'jb-chat-layout'), input = node('input'); input.type = 'radio'; input.name = 'jb-composer-layout'; input.value = value;
      const text = node('span'); text.append(node('strong', '', title), node('span', 'jb-chat-layout-detail', detail)); label.append(input, text); choices.append(label); inputs.set(value, input);
      input.addEventListener('change', () => { if (input.checked) void setLayout(value); });
    }
    const status = node('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    render = () => { for (const [value, input] of inputs) { input.checked = value === layout; input.closest('label')?.classList.toggle('jb-selected', input.checked); } status.textContent = notice; hiddenToolbar.hidden = layout !== 'janitorai'; };
    render(); preferences.append(choices);
    const close = node('button', 'jb-button jb-chat-help-close', 'Close'); close.type = 'button'; close.addEventListener('click', () => current.dismiss());
    const actions = node('div', 'jb-settings-actions'); actions.append(close);
    root.append(heading, tabs, native, generation, story, extensions, actionStatus, status, preferences, actions); selectView(view);
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); current.dismiss(); return; }
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], summary')].filter(item => {
        if (item.closest('[hidden]')) return false;
        const collapsed = item.closest('details:not([open])'); return !collapsed || item === collapsed.firstElementChild;
      });
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.addEventListener('keydown', keys);
    current.onDismiss(() => {
      root.removeEventListener('keydown', keys);
      if (modal === current) { modal = undefined; render = undefined; selectView = undefined; }
      if (!disposed && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  }
  return { openHelp, setLayout, ready, getLayout: () => layout, destroy() {
    if (disposed) return; disposed = true; modal?.dismiss(); modal = undefined; render = undefined; selectView = undefined;
    if (oldTools === null) document.documentElement.removeAttribute('data-jb-tools'); else document.documentElement.setAttribute('data-jb-tools', oldTools);
  } };
}
