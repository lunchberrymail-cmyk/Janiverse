import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createHomeBanner, createMemoryPromo, createPresetPromo } from '../src/home-banner';

let dom: any, oldDocument: any, banner: ReturnType<typeof createHomeBanner>, imports: number;
let invoked: Array<{kind: string; id: string}>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const find = (name: string) => [...document.querySelectorAll('button')].find(button => button.textContent === name)! as HTMLButtonElement;
beforeEach(() => {
  oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><html><body></body></html>'); globalThis.document = dom.window.document;
  imports = 0; invoked = [];
  banner = createHomeBanner({} as any, { invoke: async ref => { invoked.push(ref); return true; }, openImport: () => { imports++; } });
  document.body.append(banner.root);
});
afterEach(() => { banner.destroy(); dom.window.close(); globalThis.document = oldDocument; });

test('introduces one optional feature and opens it directly without changing configuration', async () => {
  expect(banner.root.querySelector('h2')!.textContent).toBe('Keep the important moments.');
  expect(find('Import chats and cards').hidden).toBe(true);
  expect(find('Explore Memory Cortex').hidden).toBe(false);
  expect(invoked).toEqual([]);
  find('Set up summaries').click(); await flush();
  find('Explore Memory Cortex').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'summary' }, { kind: 'drawer_tab', id: 'cortex' }]);
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Import your old chats and cards.');
  expect(find('Explore Memory Cortex').hidden).toBe(true);
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Build a world beyond the character card.');
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
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Keep the important moments.');
});

test('feature help stays optional, opens no tool, and resets between ideas', async () => {
  const guide = banner.root.querySelector<HTMLDetailsElement>('.jb-discover-guide')!;
  expect(guide.open).toBe(false);
  find('Next idea').click(); find('Next idea').click();
  expect(banner.root.dataset.idea).toBe('lorebooks');
  expect(guide.textContent).toContain('keyword');
  expect(banner.root.textContent).not.toContain('Explore embeddings');
  guide.open = true; await flush();
  expect(invoked).toEqual([]); expect(imports).toBe(0);
  find('Next idea').click();
  expect(guide.open).toBe(false);
  expect(guide.textContent).toContain('at least two');
  expect(guide.textContent).not.toContain('keyword');
  find('Next idea').click();
  expect(guide.textContent).toContain('may charge');
  expect(guide.textContent).toContain('microphone access');
  expect(invoked).toEqual([]);
});

test('banner opens the import review window without importing or requesting access', async () => {
  find('Next idea').click();
  find('Start guided import').click(); await flush(); expect(imports).toBe(1); expect(invoked).toEqual([]);
  find('Next idea').click(); expect(find('Import chats and cards').hidden).toBe(false);
  find('Import chats and cards').click(); expect(imports).toBe(2);
  const oldImportButton = find('Import chats and cards'); banner.destroy(); oldImportButton.click(); expect(imports).toBe(2);
  expect(document.querySelector('.jb-discover')).toBeNull();
});

test('unavailable memory destinations give an actionable fallback without selecting another feature', async () => {
  banner.destroy();
  banner = createHomeBanner({} as any, { invoke: async ref => { invoked.push(ref); return false; }, openImport: () => { imports++; } });
  document.body.append(banner.root);
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
