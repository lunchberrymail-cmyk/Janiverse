import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { openPresetSamplerGuide } from '../src/preset-sampler-guide';

let dom: JSDOM, oldDocument: any, guide: ReturnType<typeof openPresetSamplerGuide> | undefined, ctx: any;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const click = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
beforeEach(() => { oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><body><footer></footer></body>'); globalThis.document = dom.window.document; ctx = { ui: { mount: () => document.querySelector('footer') } }; });
afterEach(() => { guide?.destroy(); guide = undefined; dom.window.close(); globalThis.document = oldDocument; });

test('guidance lives beside the native editor and teaches select, Samplers and automatic saving without editing a preset', async () => {
  let opens = 0; guide = openPresetSamplerGuide(ctx, { presetName: '<img src=x> Evening', openPreset: async () => { opens++; return true; } }); await settle();
  const nav = (name: string) => [...guide!.root.querySelectorAll<HTMLButtonElement>('nav button')].find(node => node.textContent === name)!;
  expect(opens).toBe(1); expect(guide.root.parentElement!.tagName).toBe('FOOTER'); expect(guide.root.textContent).toContain('1 / 3');
  expect(guide.root.textContent).toContain('<img src=x> Evening'); expect(guide.root.querySelector('img')).toBeNull(); expect(guide.root.textContent).toContain('other chats'); expect(nav('Back').disabled).toBe(true);
  nav('Next').click(); expect(guide.root.textContent).toContain('2 / 3'); expect(guide.root.textContent).toContain('Expand Samplers');
  nav('Next').click(); expect(guide.root.textContent).toContain('3 / 3'); expect(guide.root.textContent).toContain('Changes save automatically'); expect(guide.root.textContent).toContain('Model profiles');
  click('Minimize sampler guide'); expect(guide.root.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(true);
  click('Resume sampler guide'); expect(guide.root.querySelector<HTMLElement>('.jb-api-guide-body')!.hidden).toBe(false); expect(guide.root.textContent).toContain('3 / 3');
  nav('Back').click(); expect(guide.root.textContent).toContain('2 / 3'); nav('Next').click(); nav('Close guide').click(); expect(guide.root.isConnected).toBe(false);
});

test('missing native shortcuts and older hosts provide readable recovery and retry', async () => {
  ctx.ui.mount = () => { throw new Error('Older host'); }; let available = false, opens = 0;
  guide = openPresetSamplerGuide(ctx, { presetName: 'Evening', openPreset: async () => { opens++; return available; } }); await settle();
  expect(guide.root.classList.contains('jb-api-guide-fallback')).toBe(true); expect(guide.root.querySelector('[role=status]')!.textContent).toContain('Open Preset from Lumiverse’s sidebar');
  available = true; [...guide.root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Open Preset')!.click(); await settle();
  expect(opens).toBe(2); expect(guide.root.querySelector('[role=status]')!.textContent).toBe('');
});

test('a late failure after closing cannot recreate guidance or call its close handler twice', async () => {
  let reject!: (error: Error) => void, closes = 0;
  guide = openPresetSamplerGuide(ctx, { presetName: 'Evening', openPreset: () => new Promise((_resolve, fail) => { reject = fail; }), onClose: () => { closes++; } });
  click('Close sampler guide'); reject(new Error('Late')); await settle(); guide.destroy(); expect(closes).toBe(1); expect(guide.root.isConnected).toBe(false);
});
