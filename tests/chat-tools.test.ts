import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { COMPOSER_LAYOUT_KEY, createChatTools, type ComposerLayout } from '../src/chat-tools';

const original = { document: globalThis.document };
let dom: JSDOM, tools: ReturnType<typeof createChatTools> | undefined;
let layouts: ComposerLayout[], actions: string[], saves: unknown[][];
let ctx: any;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
function setup() {
  tools = createChatTools(ctx, { onLayoutChange: layout => layouts.push(layout),
    openSettings: () => { actions.push('settings'); }, openGeneration: () => { actions.push('generation'); }, openMemory: () => { actions.push('memory'); },
    openPersonas: () => { actions.push('personas'); }, invoke: async ref => { actions.push(ref.kind + ':' + ref.id); return true; },
  }); return tools;
}
function choose(value: ComposerLayout) { button('Explore').click(); document.querySelector<HTMLDetailsElement>('.jb-chat-layout-preferences')!.open = true; document.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click(); }
function button(text: string) { return [...document.querySelectorAll('button')].find(button => button.textContent === text)!; }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><html data-jb-tools="previous"><body><button id="help">Help</button><textarea id="draft">Unsent story draft</textarea></body></html>');
  globalThis.document = dom.window.document; layouts = []; actions = []; saves = [];
  ctx = { getActiveChat: () => ({ chatId: 'chat-1' }), settings: {
    get: async () => undefined, set: async (...args: unknown[]) => { saves.push(args); },
  }, ui: { showModal() {
    const root = document.createElement('section'); document.body.append(root);
    let closed = false; const handlers: (() => void)[] = [];
    return { root, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; }, dismiss() {
      if (closed) return; closed = true; root.remove(); handlers.forEach(fn => fn());
    } };
  } } };
});
afterEach(() => { tools?.destroy(); tools = undefined; dom.window.close(); Object.assign(globalThis, original); });

test('default and help leave all native tools available without saving or invoking Hone', async () => {
  setup(); await tools!.ready; tools!.openHelp();
  expect(tools!.getLayout()).toBe('lumiverse'); expect(document.documentElement.dataset.jbTools).toBe('true');
  expect(document.querySelector<HTMLInputElement>('input[value="lumiverse"]')!.checked).toBe(true);
  expect(saves).toEqual([]); expect(actions).toEqual([]);
  expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
});

test('saved layout restores without another write and choosing a layout persists through the host account settings', async () => {
  ctx.settings.get = async () => 'janitorai'; setup(); await tools!.ready;
  expect(tools!.getLayout()).toBe('janitorai'); expect(document.documentElement.dataset.jbTools).toBe('false'); expect(saves).toEqual([]);
  tools!.openHelp(); choose('lumiverse'); await settle();
  expect(saves).toEqual([[COMPOSER_LAYOUT_KEY, 'lumiverse']]); expect(actions).toEqual([]);
});

test('a late preference read cannot undo a new choice and a read after disable cannot alter the host', async () => {
  const read = deferred<unknown>(); ctx.settings.get = () => read.promise;
  setup(); tools!.openHelp(); choose('janitorai'); read.resolve('lumiverse'); await tools!.ready;
  expect(tools!.getLayout()).toBe('janitorai');
  tools!.destroy(); expect(document.documentElement.dataset.jbTools).toBe('previous');
  tools = undefined;
  const late = deferred<unknown>(); ctx.settings.get = () => late.promise;
  setup(); tools!.destroy(); late.resolve('janitorai'); await tools!.ready;
  expect(document.documentElement.dataset.jbTools).toBe('previous');
});

test('rapid changes serialize preference writes so the latest layout remains saved', async () => {
  const first = deferred<void>(); let stored: unknown;
  ctx.settings.set = async (_key: string, value: unknown) => { saves.push([value]); if (saves.length === 1) await first.promise; stored = value; };
  setup(); await tools!.ready; tools!.openHelp(); choose('janitorai'); await settle(); choose('lumiverse'); await settle();
  expect(saves).toEqual([['janitorai']]); first.resolve(); await settle();
  expect(saves).toEqual([['janitorai'], ['lumiverse']]); expect(stored).toBe('lumiverse');
});

test('a save failure is visible and retry preserves the chosen layout and draft', async () => {
  ctx.settings.set = async () => { throw new Error('Unavailable'); };
  setup(); await tools!.ready; tools!.openHelp(); choose('janitorai'); await settle();
  expect(document.querySelector('.jb-settings-status')!.textContent).toContain('could not be saved');
  expect(tools!.getLayout()).toBe('janitorai'); expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
  ctx.settings.set = async (...args: unknown[]) => { saves.push(args); };
  await tools!.setLayout('janitorai'); expect(document.querySelector('.jb-settings-status')!.textContent).toBe('');
  expect(saves).toEqual([[COMPOSER_LAYOUT_KEY, 'janitorai']]);
});

test('native helper opens real Summary and Cortex setup surfaces only on request', async () => {
  setup(); await tools!.ready; tools!.openHelp();
  expect(document.querySelector('.jb-toolbar-tips')!.textContent).toContain('Regenerate');
  button('Story tools').click(); document.querySelector<HTMLDetailsElement>('.jb-chat-more-memory')!.open = true;
  button('Open Summary').click(); await settle();
  expect(actions).toEqual(['drawer_tab:summary']); expect(document.querySelector('.jb-chat-help')).toBeNull();
  tools!.openHelp('story'); document.querySelector<HTMLDetailsElement>('.jb-chat-more-memory')!.open = true; button('Set up Memory Cortex').click(); await settle();
  expect(actions).toEqual(['drawer_tab:summary', 'settings_tab:memoryCortex']);
  ctx.getActiveChat = () => ({ chatId: null }); tools!.openHelp('story');
  expect(button('Open Summary').disabled).toBe(true); expect(button('Open memory').disabled).toBe(true);
  expect(button('Set up Memory Cortex').disabled).toBe(false);
});

test.each([
  ['Enhance my draft', 'Hone', 'https://github.com/AMousePad/Hone'],
  ['Remember long stories', 'LumiBooks', 'https://github.com/AMousePad/LumiBooks'],
  ['Hear character voices', 'Choir', 'https://github.com/patatasbravasch-arch/Choir'],
  ['Color character dialogue', 'Prism', 'https://github.com/kittyafterdark/Prism'],
  ['Read it like a visual novel', 'Cue — Living Novel', 'https://github.com/japolino/cue-living-novel'],
  ['Add an in-world phone', 'Pocket', 'https://github.com/kittyafterdark/Pocket'],
])('discovery recommends %s without installing or running it', async (goal, name, url) => {
  setup(); await tools!.ready; tools!.openHelp('extensions'); button(goal).click();
  const result = document.querySelector('.jb-extension-result')!;
  expect(result.querySelector('h3')!.textContent).toBe(name);
  expect(result.querySelector('a')!.href).toBe(url);
  button('Copy link').click();
  expect(result.querySelector('[role="status"]')!.textContent).toContain('Link selected');
  expect(actions).toEqual([]); expect(saves).toEqual([]);
  expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
  button('Open Extensions').click(); await settle();
  expect(actions).toEqual(['drawer_tab:spindle']); expect(document.querySelector('.jb-chat-help')).toBeNull();
});

test('unavailable extension manager keeps the recommendation and allows retry', async () => {
  tools = createChatTools(ctx, { onLayoutChange() {}, openSettings() {}, openGeneration() {}, openMemory() {}, openPersonas() {}, invoke: async () => false });
  tools.openHelp('extensions'); button('Enhance my draft').click(); button('Open Extensions').click(); await settle();
  expect(document.querySelector('.jb-extension-result h3')!.textContent).toBe('Hone');
  expect(document.querySelector('.jb-chat-guide-status')!.textContent).toContain('unavailable');
  expect(button('Open Extensions').disabled).toBe(false);
});

test('Escape closes help before the host generation shortcut and returns focus to Help', async () => {
  let stops = 0; const host = () => { stops++; }; document.addEventListener('keydown', host);
  const opener = document.querySelector<HTMLButtonElement>('#help')!; opener.focus(); setup(); tools!.openHelp();
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.querySelector('.jb-chat-help')).toBeNull(); expect(stops).toBe(0); expect(document.activeElement).toBe(opener);
  document.removeEventListener('keydown', host);
});

test('help topics show one compact panel and leave the draft and settings untouched', async () => {
  setup(); await tools!.ready; tools!.openHelp();
  expect(document.querySelector<HTMLElement>('.jb-native-guide')!.hidden).toBe(false);
  expect(document.querySelector<HTMLElement>('.jb-generation-guide')!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>('.jb-chat-layout-preferences')!.hidden).toBe(true);
  expect(document.querySelectorAll('.jb-chat-guide-card svg')).toHaveLength(4);
  expect(document.querySelectorAll('.jb-chat-guide-card button')).toHaveLength(0);
  for (const topic of ['Start here', 'AI settings', 'Story tools', 'Explore', 'Replies']) button(topic).click();
  const panels = ['.jb-start-guide', '.jb-native-guide', '.jb-generation-guide', '.jb-story-guide', '.jb-extension-guide'];
  expect(panels.filter(selector => !document.querySelector<HTMLElement>(selector)!.hidden)).toEqual(['.jb-native-guide']);
  expect(actions).toEqual([]); expect(saves).toEqual([]);
  expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
});

test('sampler help opens generation directly, while prompt and Loom have distinct destinations', async () => {
  setup(); await tools!.ready; tools!.openHelp('generation');
  expect(document.querySelector('.jb-sampler-terms')!.textContent).toContain('Context size');
  button('Open generation settings').click(); await settle();
  expect(actions).toEqual(['generation']); expect(document.querySelector('.jb-chat-help')).toBeNull();
  tools!.openHelp('generation'); button('Open prompt').click(); await settle();
  expect(actions).toEqual(['generation', 'settings']);
  tools!.openHelp('generation'); document.querySelector<HTMLDetailsElement>('.jb-chat-preset-editor')!.open = true; button('Open preset editor').click(); await settle();
  expect(actions).toEqual(['generation', 'settings', 'drawer_tab:loom']); expect(saves).toEqual([]);
});

test('simple-layout users can restore the reply toolbar explicitly without generating or replacing the draft', async () => {
  ctx.settings.get = async () => 'janitorai'; setup(); await tools!.ready; tools!.openHelp();
  expect(document.querySelector<HTMLElement>('.jb-chat-toolbar-notice')!.hidden).toBe(false);
  expect(saves).toEqual([]); button('Show reply toolbar').click(); await settle();
  expect(tools!.getLayout()).toBe('lumiverse'); expect(document.querySelector<HTMLElement>('.jb-chat-toolbar-notice')!.hidden).toBe(true);
  expect(saves).toEqual([[COMPOSER_LAYOUT_KEY, 'lumiverse']]); expect(actions).toEqual([]);
  expect(document.querySelector<HTMLTextAreaElement>('#draft')!.value).toBe('Unsent story draft');
});

test('Start here gathers setup guides, the checklist and persona creation in the one Help', async () => {
  tools = createChatTools(ctx, { onLayoutChange() {}, openSettings() {}, openGeneration() {}, openMemory() {}, openPersonas() {},
    openTutorial: feature => { actions.push('guide:' + feature); }, openChecklist: () => { actions.push('checklist'); }, openPersonaCreate: () => { actions.push('persona-create'); },
    invoke: async ref => { actions.push(ref.kind + ':' + ref.id); return true; } });
  tools.openHelp('start');
  const help = document.querySelector('.jb-chat-help')!;
  expect(help.getAttribute('aria-label')).toBe('Help');
  expect(document.querySelector<HTMLElement>('.jb-start-guide')!.hidden).toBe(false);
  expect([...document.querySelectorAll('.jb-start-guide button')].map(node => node.textContent)).toEqual(['Show checklist', 'API connection guide', 'Card import guide', 'Old chat import guide', 'Create a persona']);
  for (const [label, view] of [['Show checklist', 'start'], ['API connection guide', 'start'], ['Card import guide', 'start'], ['Old chat import guide', 'start'], ['Create a persona', 'start'], ['Group chat guide', 'extensions'], ['Voices & dictation guide', 'extensions'], ['Extension guide', 'extensions']] as const) {
    tools.openHelp(view); button(label).click(); await settle(); expect(document.querySelector('.jb-chat-help')).toBeNull();
  }
  expect(actions).toEqual(['checklist', 'guide:connections', 'guide:import', 'guide:history', 'persona-create', 'guide:group', 'guide:voice', 'guide:extensions']);
  expect(saves).toEqual([]);
});

test('Explore lists every pick by Lunch in one place', async () => {
  setup(); tools!.openHelp('extensions');
  const goals = [...document.querySelectorAll('.jb-extension-goals button')].map(node => node.textContent);
  expect(goals).toEqual(['Enhance my draft', 'Remember long stories', 'Hear character voices', 'Color character dialogue', 'Read it like a visual novel', 'Add an in-world phone']);
  expect(document.querySelector('.jb-extension-picks-title')!.textContent).toBe('Extensions picked by Lunch');
});
