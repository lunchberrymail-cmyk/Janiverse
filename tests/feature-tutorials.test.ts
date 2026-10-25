import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { openFeatureTutorial, type TutorialFeature } from '../src/feature-tutorials';

let dom: any, oldDocument: any, ctx: any, handles: any[], invoked: unknown[], imports: number;
let result: (ref: unknown) => Promise<boolean>;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const pixel = 'data:image/png;base64,iVBORw0KGgo=';
const find = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name)! as HTMLButtonElement;
const options = () => ({ invoke: async (ref: unknown) => { invoked.push(ref); return result(ref); }, openImport: () => { imports++; } });
beforeEach(() => {
  oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:7860/' }); globalThis.document = dom.window.document;
  handles = []; invoked = []; imports = 0; result = async () => true;
  ctx = { ui: { showModal: (request: unknown) => {
    const root = document.createElement('div'); document.body.append(root);
    const callbacks = new Set<() => void>(); let closed = false;
    const handle = { request, root, dismiss() { if (closed) return; closed = true; root.remove(); for (const callback of callbacks) callback(); callbacks.clear(); }, onDismiss(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback); } };
    handles.push(handle); return handle;
  } } };
});
afterEach(() => { handles.forEach(handle => handle.dismiss()); dom.window.close(); globalThis.document = oldDocument; });

test('the group walkthrough explains actual creation, API, persona and turn controls without performing them', () => {
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots: {
    'group-select': { src: pixel, alt: 'Select Characters with two selected demonstration cards' },
    'group-greeting': { src: pixel, alt: 'Choose Opening Greeting in the native creator' },
    'group-settings': { src: pixel, alt: 'Native Group Settings before creating the conversation' },
  } });
  expect(tutorial.root.getAttribute('role')).toBe('dialog');
  expect(tutorial.root.getAttribute('aria-label')).toBe('Your first group chat');
  for (const instruction of ['Select Characters', 'Choose Opening Greeting', 'Create Group Chat', 'Save & Use', 'This chat', 'Connection Profile', 'persona picker', 'immediately requests a reply', 'Direct mentions respond first', 'long-press', 'at least two members']) expect(tutorial.root.textContent).toContain(instruction);
  expect(tutorial.root.querySelectorAll('.jb-tutorial-step')).toHaveLength(8);
  expect([...tutorial.root.querySelectorAll('img')].map(image => image.alt)).toEqual([
    'Select Characters with two selected demonstration cards', 'Choose Opening Greeting in the native creator', 'Native Group Settings before creating the conversation',
  ]);
  expect(invoked).toEqual([]); expect(imports).toBe(0);
});

test('native setup opens only on the named shortcut and successful opening closes the tutorial', async () => {
  openFeatureTutorial(ctx, 'group', options());
  expect(invoked).toEqual([]);
  find('Open Character Browser').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'characters' }]);
  expect(document.querySelector('.jb-feature-tutorial')).toBeNull();
});

test('unavailable or rejected native shortcuts retain the tutorial with actionable guidance', async () => {
  const tutorial = openFeatureTutorial(ctx, 'memory', options());
  result = async () => false;
  find('Open Memory Cortex settings').click(); await flush();
  expect(invoked).toEqual([{ kind: 'settings_tab', id: 'memoryCortex' }]);
  expect(tutorial.root.isConnected).toBe(true);
  expect(tutorial.root.textContent).toContain('This shortcut is unavailable. Open Lumiverse Settings → Memory Cortex.');
  result = async () => { throw new Error('not available'); };
  find('Open Summary').click(); await flush();
  expect(tutorial.root.textContent).toContain('Could not open that tool. Open Summary');
  expect(find('Open Summary').disabled).toBe(false);
});

test('closing during an explicit pending action stops late UI writes and suppresses duplicate opens', async () => {
  let resolve!: (value: boolean) => void;
  result = () => new Promise<boolean>(r => { resolve = r; });
  let closed = 0;
  const tutorial = openFeatureTutorial(ctx, 'voice', { ...options(), onClose: () => { closed++; } });
  const status = tutorial.root.querySelector('[role=status]')!;
  find('Open Voice & Speech').click(); find('Open Voice & Speech').click(); await flush();
  expect(invoked).toEqual([{ kind: 'settings_tab', id: 'voice' }]);
  find('Close tutorial').click(); resolve(false); await flush();
  expect(closed).toBe(1); expect(status.textContent).toBe('');
  tutorial.destroy(); expect(closed).toBe(1);
});

test('closing immediately cancels a shortcut before its deferred dispatch', async () => {
  const tutorial = openFeatureTutorial(ctx, 'extensions', options());
  find('Open Extensions').click(); tutorial.destroy(); await flush();
  expect(invoked).toEqual([]);
});

test('keyboard close restores the banner focus and tab navigation stays inside the tutorial', () => {
  const launcher = document.createElement('button'); launcher.textContent = 'Full tutorial'; document.body.append(launcher); launcher.focus();
  const tutorial = openFeatureTutorial(ctx, 'lorebooks', options());
  expect(document.activeElement).toBe(find('Close tutorial'));
  find('Close tutorial').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(find('Back to banner'));
  find('Back to banner').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(find('Close tutorial'));
  tutorial.root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.activeElement).toBe(launcher);
  expect(tutorial.root.isConnected).toBe(false); expect(invoked).toEqual([]);
});

test('screenshots are inert local rasters, can enlarge for reading, and fail without losing the written steps', () => {
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots: {
    'group-select': { src: pixel, alt: '<img src=x onerror=alert(1)>', caption: '<b>literal screenshot caption</b>' },
    'group-greeting': { src: 'https://remote.example/track.png', alt: 'Remote image' },
    'group-settings': { src: 'javascript:alert(1)', alt: 'Invalid image' },
    'group-chat': { src: 'data:image/svg+xml;base64,PHN2Zz4=', alt: 'Not a raster screenshot' },
  } });
  expect(tutorial.root.querySelectorAll('img')).toHaveLength(1);
  expect(tutorial.root.querySelector('figcaption')!.textContent).toBe('<b>literal screenshot caption</b>');
  expect(tutorial.root.querySelector('figcaption b,script,iframe')).toBeNull();
  find('Enlarge screenshot').click(); expect(tutorial.root.querySelector('.jb-tutorial-image-expanded')).not.toBeNull();
  expect(find('Fit screenshot').getAttribute('aria-pressed')).toBe('true');
  tutorial.root.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
  expect((tutorial.root.querySelector('.jb-tutorial-image-error') as HTMLElement).hidden).toBe(false);
  expect(tutorial.root.textContent).toContain('Select Characters');
  expect(invoked).toEqual([]);
});

test('summary and recall guidance includes the prompt placement required to make saved content usable', () => {
  const tutorial = openFeatureTutorial(ctx, 'memory', options());
  for (const instruction of ['{{loomSummary}}', '{{memories}}', 'Vectorise chat messages', 'Recompile Memories', 'per-chat Cortex toggle', 'sidecar LLM is optional']) expect(tutorial.root.textContent).toContain(instruction);
  expect(invoked).toEqual([]);
});

test('all feature guides are optional reads and missing screenshots leave a complete written guide', () => {
  for (const feature of ['import', 'memory', 'lorebooks', 'group', 'voice', 'extensions'] satisfies TutorialFeature[]) {
    const tutorial = openFeatureTutorial(ctx, feature, options());
    expect(tutorial.root.querySelectorAll('.jb-tutorial-step').length).toBeGreaterThanOrEqual(4);
    expect(tutorial.root.querySelector('img')).toBeNull();
    find('Back to banner').click(); expect(tutorial.root.isConnected).toBe(false);
  }
  expect(invoked).toEqual([]); expect(imports).toBe(0);
});

test('the importer opens only when requested and a missing importer callback keeps recovery guidance', async () => {
  openFeatureTutorial(ctx, 'import', options());
  expect(imports).toBe(0); find('Open import assistant').click(); await flush();
  expect(imports).toBe(1); expect(document.querySelector('.jb-feature-tutorial')).toBeNull();
  const tutorial = openFeatureTutorial(ctx, 'import', { invoke: options().invoke });
  find('Open import assistant').click(); await flush();
  expect(tutorial.root.isConnected).toBe(true); expect(tutorial.root.textContent).toContain('Start guided import');
});
