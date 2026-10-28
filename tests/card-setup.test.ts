import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createCardSetup } from '../src/card-setup';

let dom: JSDOM, oldDocument: any, oldFetch: any, guide: ReturnType<typeof createCardSetup>;
let menus: number, importers: number, characters: number, highlighted: boolean, calls: number;
let openCharacters: () => Promise<boolean>, mount: HTMLElement, ctx: any;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const button = (name: string, scope: ParentNode = document) => {
  const match = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name);
  if (!match) throw new Error(`Missing ${name}`); return match;
};
beforeEach(() => {
  oldDocument = globalThis.document; oldFetch = globalThis.fetch;
  dom = new JSDOM('<!doctype html><body><div id="footer"></div></body>'); globalThis.document = dom.window.document;
  menus = importers = characters = calls = 0; highlighted = false; mount = document.querySelector('#footer')!;
  globalThis.fetch = async () => { calls++; throw new Error('Menu guidance must not import anything'); };
  openCharacters = async () => true;
  ctx = { ui: {
    mount: () => mount,
    showModal: () => {
      const root = document.createElement('div'); document.body.append(root); let dismissed = false; const listeners: Array<() => void> = [];
      return { root, onDismiss: (fn: () => void) => listeners.push(fn), dismiss() { if (dismissed) return; dismissed = true; root.remove(); listeners.forEach(fn => fn()); } };
    },
  } };
  guide = createCardSetup(ctx, {
    showImportMenu: () => { menus++; highlighted = true; }, clearImportMenu: () => { highlighted = false; },
    openImportGuide: () => { importers++; }, openCharacters: () => { characters++; return openCharacters(); },
  });
});
afterEach(() => { guide.destroy(); dom.window.close(); globalThis.document = oldDocument; globalThis.fetch = oldFetch; });

test('Basics teaches the real menu immediately without a branded chooser or launching an importer', async () => {
  guide.open(); await settle();
  expect(document.body.textContent).toContain('More → Import characters'); expect(button('Use Chars → + instead')).not.toBeNull();
  expect(document.body.textContent).not.toMatch(/Janiverse way|Lumiverse way/); expect(document.querySelector('.jb-card-methods')).toBeNull();
  expect(menus).toBe(1); expect(importers + characters + calls).toBe(0);
});

test('Janiverse guide waits for the actual Import characters menu action before opening the importer', async () => {
  guide.open(); await settle();
  expect(document.querySelector('.jb-card-methods')).toBeNull(); expect(highlighted).toBe(true); expect(menus).toBe(1); expect(importers).toBe(0);
  button('Show More menu').click(); expect(menus).toBe(2);
  expect(guide.consumeMenuImport()).toBe(true); expect(importers).toBe(1); expect(highlighted).toBe(false); expect(document.querySelector('.jb-card-menu-guide')).toBeNull();
  expect(guide.consumeMenuImport()).toBe(false); expect(calls + characters).toBe(0);
});

test('closing menu guidance removes its highlight and leaves later imports ordinary', () => {
  guide.open(); button('Close card guide').click();
  expect(highlighted).toBe(false); expect(guide.consumeMenuImport()).toBe(false); expect(importers).toBe(0);
});

test('traditional guide lives beside Characters and describes native saving without marking setup complete', async () => {
  guide.open(); button('Use Chars → + instead').click(); await settle();
  const panel = mount.querySelector<HTMLElement>('.jb-card-menu-guide')!;
  expect(panel).not.toBeNull(); expect(characters).toBe(1); expect(importers + calls).toBe(0); expect(button('Back', panel).disabled).toBe(true); expect(highlighted).toBe(false);
  button('Next', panel).click(); expect(panel.textContent).toContain('One file imports immediately'); expect(panel.textContent).toContain('then choose Import');
  button('Next', panel).click(); expect(panel.textContent).toContain('Already there? Use that copy'); button('Close guide', panel).click();
  expect(panel.isConnected).toBe(false); expect(calls).toBe(0);
});

test('switching methods cancels a pending menu handoff; minimizing leaves controls accessible', async () => {
  guide.open(); button('Use Chars → + instead').click();
  expect(highlighted).toBe(false); expect(guide.consumeMenuImport()).toBe(false);
  await settle(); button('Minimize card guide').click();
  expect(document.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(true);
  button('Resume card guide').click(); expect(document.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(false); expect(importers).toBe(0);
  button('Use More → Import instead').click(); expect(highlighted).toBe(true); expect(guide.consumeMenuImport()).toBe(true); expect(importers).toBe(1);
});

test('unavailable native shortcuts offer the sidebar path and a retry', async () => {
  openCharacters = async () => false; guide.open(); button('Use Chars → + instead').click(); await settle();
  expect(document.querySelector('[role=status]')!.textContent).toContain('Open Chars in Lumiverse’s sidebar');
  openCharacters = async () => true; button('Open Characters').click(); await settle();
  expect(document.querySelector('[role=status]')!.textContent).toBe(''); expect(characters).toBe(2); expect(calls).toBe(0);
});

test('late drawer failure cannot resurrect dismissed guidance or affect a new method', async () => {
  let reject!: (error: Error) => void; openCharacters = () => new Promise((_resolve, fail) => { reject = fail; });
  guide.open(); button('Use Chars → + instead').click(); button('Use More → Import instead').click();
  reject(new Error('Late failure')); await settle(); expect(document.body.textContent).not.toContain('Couldn’t open Characters');
  expect(highlighted).toBe(true); guide.destroy(); expect(highlighted).toBe(false); expect(guide.consumeMenuImport()).toBe(false); guide.open();
  expect(document.querySelector('.jb-card-methods')).toBeNull(); expect(calls).toBe(0);
});

test('older hosts without a footer keep readable traditional guidance and clean up on Escape', async () => {
  ctx.ui.mount = () => { throw new Error('Unavailable'); }; guide.open(); button('Use Chars → + instead').click(); await settle();
  const panel = document.querySelector<HTMLElement>('.jb-card-menu-guide')!; expect(panel.classList.contains('jb-api-guide-fallback')).toBe(true);
  panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(panel.isConnected).toBe(false); expect(calls).toBe(0);
});

test('a covering native panel is explained before the Home menu and the instruction follows its Close control', async () => {
  let changed: ((value: { open: boolean }) => void) | undefined, stopped = 0;
  ctx.ui.events = { getDrawerState: () => ({ open: true, tabId: 'characters' }), onDrawerChange: (fn: typeof changed) => { changed = fn; return () => { stopped++; }; } };
  guide.open(); expect(document.querySelector('h3')!.textContent).toBe('Close the side panel'); expect(button('Show More menu').hidden).toBe(true);
  expect(document.body.textContent).toContain('× → More → Import characters'); expect(importers).toBe(0);
  changed!({ open: false }); expect(document.querySelector('h3')!.textContent).toBe('Open Import characters'); expect(button('Show More menu').hidden).toBe(false);
  guide.close(); expect(stopped).toBe(1); changed!({ open: true }); expect(document.querySelector('.jb-card-menu-guide')).toBeNull(); expect(calls).toBe(0);
});
