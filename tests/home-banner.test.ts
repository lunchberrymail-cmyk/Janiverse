import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createHomeBanner } from '../src/home-banner';

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
  expect(banner.root.querySelector('h2')!.textContent).toBe('Import your old chats and cards.');
  expect(find('Import chats and cards').hidden).toBe(true);
  find('Next idea').click();
  expect(banner.root.querySelector('h2')!.textContent).toBe('Find the details that matter.');
  expect(invoked).toEqual([]);
  find('Explore embeddings').click(); await flush();
  expect(invoked).toEqual([{ kind: 'settings_tab', id: 'embeddings' }]);
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Add something new when you want it.');
  find('Explore extensions').click(); await flush();
  expect(invoked[1]).toEqual({ kind: 'drawer_tab', id: 'spindle' });
  find('Next idea').click(); expect(banner.root.querySelector('h2')!.textContent).toBe('Import your old chats and cards.');
});

test('banner opens the import review window without importing or requesting access', async () => {
  find('Start guided import').click(); await flush(); expect(imports).toBe(1); expect(invoked).toEqual([]);
  find('Next idea').click(); expect(find('Import chats and cards').hidden).toBe(false);
  find('Import chats and cards').click(); expect(imports).toBe(2);
  const oldImportButton = find('Import chats and cards'); banner.destroy(); oldImportButton.click(); expect(imports).toBe(2);
  expect(document.querySelector('.jb-discover')).toBeNull();
});
