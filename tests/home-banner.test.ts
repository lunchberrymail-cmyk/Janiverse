import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createHomeBanner, createMemoryPromo, createPresetPromo } from '../src/home-banner';

let dom: any, oldDocument: any, banner: ReturnType<typeof createHomeBanner>, imports: number;
let invoked: Array<{kind: string; id: string}>;
let ctx: any, modals: any[], tutorials: string[], invokeResult: () => Promise<boolean>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const find = (name: string) => [...document.querySelectorAll('button')].find(button => button.textContent === name)! as HTMLButtonElement;
beforeEach(() => {
  oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><html><body></body></html>'); globalThis.document = dom.window.document;
  imports = 0; invoked = []; modals = []; tutorials = []; invokeResult = async () => true;
  ctx = { ui: { showModal: ({ title }: { title: string }) => {
    const root = document.createElement('div'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', title); document.body.append(root);
    const listeners = new Set<() => void>(); let closed = false;
    const modal = { root, dismiss() { if (closed) return; closed = true; root.remove(); [...listeners].forEach(listener => listener()); listeners.clear(); }, onDismiss(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } };
    modals.push(modal); return modal;
  } } };
  banner = createHomeBanner(ctx, { invoke: async ref => { invoked.push(ref); return invokeResult(); }, openImport: () => { imports++; }, openTutorial: feature => { tutorials.push(feature); } });
  document.body.append(banner.root);
});
afterEach(() => { banner.destroy(); modals.forEach(modal => modal.dismiss()); dom.window.close(); globalThis.document = oldDocument; });

test('introduces one optional feature and opens it directly without changing configuration', async () => {
  expect(banner.root.querySelector('h2')!.textContent).toBe('Import your old chats and cards.');
  expect(banner.root.querySelector('.jb-lunch-picks')).toBeNull();
  expect(find('Import chats and cards')).toBeUndefined();
  expect(find('Explore Memory Cortex').hidden).toBe(true);
  expect(invoked).toEqual([]);
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Keep the important moments.');
  expect(find('Explore Memory Cortex').hidden).toBe(false);
  find('Set up summaries').click(); await flush();
  find('Explore Memory Cortex').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'summary' }, { kind: 'drawer_tab', id: 'cortex' }]);
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Build a world beyond the character card.');
  expect(find('Explore Memory Cortex').hidden).toBe(true);
  find('Explore Lorebooks').click(); await flush();
  expect(invoked[2]).toEqual({ kind: 'drawer_tab', id: 'lorebook' });
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Put your characters in the same scene.');
  find('Explore group chats').click(); await flush();
  expect(invoked[3]).toEqual({ kind: 'drawer_tab', id: 'characters' });
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Hear their voice. Speak your replies.');
  find('Explore voice & dictation').click(); await flush();
  expect(invoked[4]).toEqual({ kind: 'settings_tab', id: 'voice' });
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Add something new when you want it.');
  find('Manage extensions').click(); await flush();
  expect(invoked[5]).toEqual({ kind: 'drawer_tab', id: 'spindle' });
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Shameless ads by Lunch');
  expect(banner.root.querySelector('.jb-discover-progress')!.textContent).toBe('Lunch’s picks · 7 of 7');
  expect(find('Full tutorial').hidden).toBe(true);
  expect(banner.root.querySelector('.jb-lunch-picks')).toBeNull();
  find('See Lunch’s picks').click(); await flush();
  const picks = document.querySelector<HTMLElement>('.jb-lunch-panel')!;
  expect(picks.isConnected).toBe(true);
  expect([...picks.querySelectorAll('a')].map(link => link.href)).toEqual([
    'https://github.com/patatasbravasch-arch/Choir', 'https://github.com/AMousePad/LumiBooks',
    'https://github.com/japolino/cue-living-novel', 'https://github.com/kittyafterdark/Pocket',
    'https://github.com/kittyafterdark/Prism',
  ]);
  expect(invoked).toHaveLength(6);
  find('Open Extensions').click(); await flush();
  expect(invoked[6]).toEqual({ kind: 'drawer_tab', id: 'spindle' });
  expect(picks.isConnected).toBe(false);
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Import your old chats and cards.');
  expect(find('Full tutorial').hidden).toBe(false);
});

test('full tutorials open only on request with the right feature and preserve the banner selection', () => {
  expect(banner.root.querySelector('details')).toBeNull();
  expect(tutorials).toEqual([]);
  for (const feature of ['import', 'memory', 'lorebooks', 'group', 'voice', 'extensions']) {
    const idea = banner.root.dataset.idea;
    find('Full tutorial').click(); expect(tutorials.at(-1)).toBe(feature);
    expect(banner.root.dataset.idea).toBe(idea);
    find('Next idea').click();
  }
  expect(find('Full tutorial').hidden).toBe(true);
  find('Full tutorial').click(); expect(tutorials).toHaveLength(6);
  expect(invoked).toEqual([]); expect(imports).toBe(0);
  const oldTutorial = find('Full tutorial'); banner.destroy(); oldTutorial.click(); expect(tutorials).toHaveLength(6);
});

test('reopening Lunch picks replaces its window and disabling the banner closes it and stops old actions', async () => {
  for (let idea = 0; idea < 6; idea++) find('Next idea').click();
  find('See Lunch’s picks').click(); await flush(); const first = document.querySelector('.jb-lunch-panel')!;
  find('See Lunch’s picks').click(); await flush(); const second = document.querySelector('.jb-lunch-panel')!;
  expect(first.isConnected).toBe(false); expect(second).not.toBe(first); expect(document.querySelectorAll('.jb-lunch-panel')).toHaveLength(1);
  const oldManage = find('Open Extensions'), oldPrimary = find('See Lunch’s picks');
  banner.destroy(); expect(second.isConnected).toBe(false);
  oldManage.click(); oldPrimary.click(); await flush();
  expect(invoked).toEqual([]); expect(document.querySelector('.jb-lunch-panel')).toBeNull();
});

test('Lunch native setup failures keep the recommendations and show local recovery guidance', async () => {
  for (let idea = 0; idea < 6; idea++) find('Next idea').click();
  find('See Lunch’s picks').click(); await flush();
  const panel = document.querySelector('.jb-lunch-panel')!;
  invokeResult = async () => false;
  find('Open Extensions').click(); await flush();
  expect(panel.isConnected).toBe(true); expect(panel.textContent).toContain('sidebar');
  invokeResult = async () => { throw new Error('unavailable'); };
  find('Open Extensions').click(); await flush();
  expect(panel.textContent).toContain('Could not open Extensions');
  expect(panel.querySelectorAll('.jb-lunch-pick')).toHaveLength(5);
});

test('a late result from replaced Lunch picks cannot close or rewrite its replacement', async () => {
  for (let idea = 0; idea < 6; idea++) find('Next idea').click();
  let resolve!: (ok: boolean) => void;
  invokeResult = () => new Promise<boolean>(complete => { resolve = complete; });
  find('See Lunch’s picks').click(); await flush();
  const oldManage = find('Open Extensions'); oldManage.click(); oldManage.click(); await flush();
  expect(invoked).toHaveLength(1);
  find('See Lunch’s picks').click(); await flush();
  const replacement = document.querySelector('.jb-lunch-panel')!;
  oldManage.click(); resolve(false); await flush();
  expect(invoked).toHaveLength(1); expect(replacement.isConnected).toBe(true);
  expect(replacement.textContent).not.toContain('unavailable');
  expect(find('Open Extensions').disabled).toBe(false);
});

test('banner opens the import review window without importing or requesting access', async () => {
  const oldImportButton = find('Start guided import');
  oldImportButton.click(); await flush(); expect(imports).toBe(1); expect(invoked).toEqual([]);
  for (let idea = 0; idea < 6; idea++) {
    find('Next idea').click(); expect(find('Import chats and cards')).toBeUndefined();
  }
  find('Next idea').click();
  banner.destroy(); oldImportButton.click(); expect(imports).toBe(1);
  expect(document.querySelector('.jb-discover')).toBeNull();
});

test('unavailable memory destinations give an actionable fallback without selecting another feature', async () => {
  banner.destroy();
  banner = createHomeBanner({} as any, { invoke: async ref => { invoked.push(ref); return false; }, openImport: () => { imports++; } });
  document.body.append(banner.root);
  find('Next idea').click();
  find('Explore Memory Cortex').click(); await flush();
  expect(banner.root.querySelector('[role="status"]')!.textContent).toContain('You can still try Summary');
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'cortex' }]);
  expect(imports).toBe(0);
  expect(banner.root.dataset.idea).toBe('memory');
});

test('compact settings promo opens only native setup destinations and becomes inert when destroyed', async () => {
  banner.destroy();
  const promo = createMemoryPromo({} as any, { invoke: async ref => { invoked.push(ref); return true; } });
  document.body.append(promo.root);
  const buttons = [...promo.root.querySelectorAll('button')];
  expect(invoked).toEqual([]);
  buttons[0]!.click(); await flush(); buttons[1]!.click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'summary' }, { kind: 'drawer_tab', id: 'cortex' }]);
  promo.destroy(); buttons[0]!.click(); buttons[1]!.click(); await flush();
  expect(invoked).toHaveLength(2);
  expect(document.querySelector('.jb-memory-promo')).toBeNull();
});

test('compact memory promo handles native unavailability and invocation errors', async () => {
  banner.destroy();
  let fail = false;
  const promo = createMemoryPromo({} as any, { invoke: async () => { if (fail) throw new Error('not available'); return false; } });
  document.body.append(promo.root);
  const buttons = [...promo.root.querySelectorAll('button')];
  buttons[0]!.click(); await flush();
  expect(promo.root.querySelector('[role="status"]')!.textContent).toContain('unavailable');
  fail = true; buttons[1]!.click(); await flush();
  expect(promo.root.querySelector('[role="status"]')!.textContent).toContain('Could not open');
  promo.destroy();
});

test('late native results cannot rewrite a destroyed promo', async () => {
  banner.destroy();
  let resolve!: (ok: boolean) => void;
  const promo = createMemoryPromo({} as any, { invoke: () => new Promise<boolean>(r => { resolve = r; }) });
  document.body.append(promo.root);
  promo.root.querySelector('button')!.click();
  const status = promo.root.querySelector('[role="status"]')!;
  promo.destroy(); resolve(false); await flush();
  expect(status.textContent).toBe('');
});

test('preset promotion exposes only the specified public discovery destinations without loading or joining them', () => {
  const promo = createPresetPromo(); document.body.append(promo.root);
  const links = [...promo.root.querySelectorAll('a')];
  expect(links.map(link => [link.textContent, link.href])).toEqual([
    ['Browse presets', 'https://illarin.com/browse?type=preset'],
    ['Presets on Discord', 'https://discord.com/channels/1484149939167821915/1484156801447497792'],
    ['Join Discord', 'https://discord.gg/28rBWVFfCu'],
  ]);
  expect(links.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer' && link.referrerPolicy === 'no-referrer')).toBe(true);
  expect(promo.root.querySelector('iframe,img,script,link[rel=prefetch],link[rel=preconnect]')).toBeNull();
  expect(invoked).toEqual([]); expect(imports).toBe(0);
  promo.destroy(); expect(document.querySelector('.jb-preset-promo')).toBeNull();
});
