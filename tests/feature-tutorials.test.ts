import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { openFeatureTutorial, type TutorialFeature } from '../src/feature-tutorials';

let dom: any, oldDocument: any, ctx: any, handles: any[], invoked: unknown[], imports: number;
let result: (ref: unknown) => Promise<boolean>;
let oldSetTimeout: typeof globalThis.setTimeout, oldClearTimeout: typeof globalThis.clearTimeout;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const pixel = 'data:image/png;base64,iVBORw0KGgo=';
const find = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name)! as HTMLButtonElement;
const options = () => ({ invoke: async (ref: unknown) => { invoked.push(ref); return result(ref); }, openImport: () => { imports++; } });
beforeEach(() => {
  oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:7860/', pretendToBeVisual: true }); globalThis.document = dom.window.document;
  oldSetTimeout = globalThis.setTimeout; oldClearTimeout = globalThis.clearTimeout;
  handles = []; invoked = []; imports = 0; result = async () => true;
  ctx = { ui: { showModal: (request: unknown) => {
    const root = document.createElement('div'); document.body.append(root);
    const callbacks = new Set<() => void>(); let closed = false;
    const handle = { request, root, dismiss() { if (closed) return; closed = true; root.remove(); for (const callback of callbacks) callback(); callbacks.clear(); }, onDismiss(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback); } };
    handles.push(handle); return handle;
  } } };
});
afterEach(() => { handles.forEach(handle => handle.dismiss()); globalThis.setTimeout = oldSetTimeout; globalThis.clearTimeout = oldClearTimeout; dom.window.close(); globalThis.document = oldDocument; });
function demoClock() {
  const pending = new Map<number, () => void>(); let serial = 0;
  globalThis.setTimeout = ((callback: any, delay?: number, ...args: any[]) => {
    if (delay !== 6500) return oldSetTimeout(callback, delay, ...args);
    const id = ++serial; pending.set(id, () => callback(...args)); return id;
  }) as any;
  globalThis.clearTimeout = ((id: any) => { if (!pending.delete(id)) oldClearTimeout(id); }) as any;
  return { pending, tick() { const entry = pending.entries().next().value as [number, () => void] | undefined; if (!entry) throw new Error('No demo timer'); pending.delete(entry[0]); entry[1](); } };
}

test('the group demo shows the entry point then one cast, greeting, settings or chat scene at a time', () => {
  const screenshots = Object.fromEntries(['group-start', 'group-select', 'group-greeting', 'group-settings', 'group-chat', 'group-mention', 'group-member-menu'].map(key => [key, { src: pixel, alt: key }]));
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots });
  expect(tutorial.root.getAttribute('role')).toBe('dialog'); expect(tutorial.root.getAttribute('aria-label')).toBe('Your first group chat');
  expect(tutorial.root.querySelectorAll('.jb-tutorial-scene')).toHaveLength(1);
  expect(tutorial.root.querySelectorAll('details[open]')).toHaveLength(0);
  expect(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent).toContain('New Group Chat');
  expect(find('Back').disabled).toBe(true);
  const seen: string[] = [];
  for (let scene = 0; scene < 7; scene++) {
    expect(tutorial.root.querySelectorAll('img')).toHaveLength(1); seen.push(tutorial.root.querySelector('img')!.alt);
    expect(tutorial.root.querySelector('.jb-tutorial-progress')!.getAttribute('aria-label')).toBe(`Scene ${scene + 1} of 7`);
    if (scene < 6) find('Next').click();
  }
  expect(seen).toEqual(['group-start', 'group-select', 'group-greeting', 'group-settings', 'group-chat', 'group-mention', 'group-member-menu']);
  expect(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent).toContain('long-press');
  expect(tutorial.root.querySelector('.jb-tutorial-result')!.textContent).toContain('immediately requests a reply');
  expect(find('Next').disabled).toBe(true); find('Next').click(); expect(tutorial.root.dataset.scene).toBe('7');
  find('Back').click(); expect(tutorial.root.dataset.screenshot).toBe('group-mention');
  expect(invoked).toEqual([]); expect(imports).toBe(0);
});

test('native controls open only on the explicit shortcut and successful opening closes the demo', async () => {
  const tutorial = openFeatureTutorial(ctx, 'group', options());
  find('Next').click(); find('Back').click(); expect(invoked).toEqual([]);
  find('Open Character Browser').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'characters' }]); expect(tutorial.root.isConnected).toBe(false);
});

test('voice connection setup remains optional and opens the native Connections drawer only when chosen', async () => {
  const tutorial = openFeatureTutorial(ctx, 'voice', options());
  const before = tutorial.root.querySelector<HTMLDetailsElement>('.jb-tutorial-before')!;
  expect(before.open).toBe(false); expect(invoked).toEqual([]);
  before.open = true; find('Open Connections').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'connections' }]); expect(tutorial.root.isConnected).toBe(false);
});

test('unavailable or rejected shortcuts retain the scene and show actionable recovery', async () => {
  const tutorial = openFeatureTutorial(ctx, 'memory', options());
  for (let step = 0; step < 3; step++) find('Next').click();
  result = async () => false; find('Open Memory Cortex settings').click(); await flush();
  expect(invoked).toEqual([{ kind: 'settings_tab', id: 'memoryCortex' }]); expect(tutorial.root.dataset.scene).toBe('4');
  expect(tutorial.root.textContent).toContain('This shortcut is unavailable. Open Lumiverse Settings → Memory Cortex.');
  for (let step = 0; step < 3; step++) find('Back').click();
  result = async () => { throw new Error('not available'); }; find('Open Summary').click(); await flush();
  expect(tutorial.root.textContent).toContain('Could not open that tool. Open Summary'); expect(find('Open Summary').disabled).toBe(false);
});

test('closing during a pending shortcut suppresses duplicate dispatch and late UI writes', async () => {
  let resolve!: (value: boolean) => void; result = () => new Promise<boolean>(r => { resolve = r; }); let closed = 0;
  const tutorial = openFeatureTutorial(ctx, 'voice', { ...options(), onClose: () => { closed++; } }); const status = tutorial.root.querySelector('[role=status]')!;
  find('Open Voice & Speech').click(); find('Open Voice & Speech').click(); find('Next').click(); await flush();
  expect(tutorial.root.dataset.scene).toBe('1'); expect(invoked).toEqual([{ kind: 'settings_tab', id: 'voice' }]);
  find('Close tutorial').click(); resolve(false); await flush(); expect(closed).toBe(1); expect(status.textContent).toBe('');
  tutorial.destroy(); expect(closed).toBe(1);
});

test('closing immediately cancels a shortcut before deferred dispatch and old controls become inert', async () => {
  const tutorial = openFeatureTutorial(ctx, 'extensions', options()); const action = find('Open Extensions'), next = find('Next');
  action.click(); tutorial.destroy(); action.click(); next.click(); await flush(); expect(invoked).toEqual([]); expect(tutorial.root.dataset.scene).toBe('1');
});

test('keyboard close restores launcher focus and Tab stays inside visible controls', () => {
  const launcher = document.createElement('button'); launcher.textContent = 'Full tutorial'; document.body.append(launcher); launcher.focus();
  const tutorial = openFeatureTutorial(ctx, 'group', options()); expect(document.activeElement?.textContent).toBe('Close tutorial');
  find('Close tutorial').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(document.activeElement?.textContent).toBe('Instructions & help');
  document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(document.activeElement?.textContent).toBe('Close tutorial');
  tutorial.root.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); expect(document.activeElement === launcher).toBe(true); expect(tutorial.root.isConnected).toBe(false);
});

test('screenshots, scene overrides and normalized highlights render safely; failures preserve instructions', () => {
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots: {
    'group-start': { src: pixel, alt: '<img src=x onerror=alert(1)>', caption: '<b>literal caption</b>', highlight: { x: 10, y: 20, width: 30, height: 10 }, instruction: 'Click the named control.', result: '<i>A real next screen.</i>' },
    'group-select': { src: 'https://remote.example/track.png', alt: 'Remote image' },
    'group-greeting': { src: 'javascript:alert(1)', alt: 'Invalid image' },
    'group-settings': { src: 'data:image/svg+xml;base64,PHN2Zz4=', alt: 'Not a raster screenshot' },
    'group-chat': { src: pixel, alt: 'Native group chat', highlight: { x: 90, y: 20, width: 30, height: 10 } },
  } });
  expect(tutorial.root.querySelector('figcaption')!.textContent).toBe('<b>literal caption</b>'); expect(tutorial.root.querySelector('figcaption b,script,iframe,i')).toBeNull();
  expect(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent).toBe('Click the named control.');
  expect((tutorial.root.querySelector('.jb-tutorial-highlight') as HTMLElement).style.left).toBe('10%'); expect(tutorial.root.querySelector('.jb-tutorial-arrows line')).not.toBeNull();
  find('Enlarge screenshot').click(); expect(tutorial.root.querySelector('.jb-tutorial-image-expanded')).not.toBeNull(); expect(find('Fit screenshot').getAttribute('aria-pressed')).toBe('true');
  tutorial.root.querySelector('img')!.dispatchEvent(new dom.window.Event('error')); expect((tutorial.root.querySelector('.jb-tutorial-image-error') as HTMLElement).hidden).toBe(false); expect(tutorial.root.textContent).toContain('Click the named control.');
  for (let scene = 0; scene < 3; scene++) { find('Next').click(); expect(tutorial.root.querySelector('img')).toBeNull(); }
  find('Next').click(); expect(tutorial.root.querySelector('img')).not.toBeNull(); expect(tutorial.root.querySelector('.jb-tutorial-highlight')).toBeNull(); expect(invoked).toEqual([]);
});

test('overview fallbacks never reuse a different scene’s pointer or instruction override', () => {
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots: { 'group-chat': { src: pixel, alt: 'Chat overview', highlight: { x: 10, y: 20, width: 30, height: 10 }, instruction: 'Choose your persona.' } } });
  for (let scene = 0; scene < 4; scene++) find('Next').click(); expect(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent).toBe('Choose your persona.');
  find('Next').click(); expect(tutorial.root.querySelector('img')!.alt).toBe('Chat overview'); expect(tutorial.root.querySelector('.jb-tutorial-highlight')).toBeNull(); expect(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent).toContain('Type @');
});

test('every feature has a short navigable path; memory retains prompt placement and optional help', () => {
  for (const feature of ['import', 'history', 'memory', 'lorebooks', 'group', 'voice', 'extensions'] satisfies TutorialFeature[]) {
    const tutorial = openFeatureTutorial(ctx, feature, options()); const instructions: string[] = [];
    expect(tutorial.root.querySelectorAll('details[open]')).toHaveLength(0);
    while (true) { instructions.push(tutorial.root.querySelector('.jb-tutorial-instruction')!.textContent!); if (find('Next').disabled) break; find('Next').click(); }
    expect(instructions.length).toBeGreaterThanOrEqual(3);
    if (feature === 'memory') { expect(instructions.join(' ')).toContain('{{loomSummary}}'); expect(instructions.join(' ')).toContain('Vectorize chat messages'); expect(instructions.join(' ')).toContain('Recompile Memories'); expect(tutorial.root.querySelector('.jb-tutorial-help')!.textContent).toContain('{{memories}}'); }
    find('Back to banner').click(); expect(tutorial.root.isConnected).toBe(false);
  }
  expect(invoked).toEqual([]); expect(imports).toBe(0);
});

test('API guidance separates saving, selection and credential testing while keeping the native workspace available', async () => {
  const tutorial = openFeatureTutorial(ctx, 'connections', options());
  expect(tutorial.root.querySelector('.jb-tutorial-play')).toBeNull();
  expect(invoked).toEqual([]);
  find('Next').click(); expect(tutorial.root.textContent).toContain('OpenRouter uses its provider URL automatically');
  find('Next').click(); expect(tutorial.root.textContent).toContain('Refresh models');
  find('Next').click(); expect(tutorial.root.textContent).toContain('Scroll to the bottom');
  find('Next').click(); expect(tutorial.root.textContent).toContain('click the connection’s name to make it active');
  find('Next').click(); expect(tutorial.root.textContent).toContain('Test selected connection');
  expect(tutorial.root.querySelector('.jb-api-guide-help')!.textContent).toContain('does not guarantee access to every model');
  while (!find('Back').disabled) find('Back').click();
  find('Open Connections').click(); await flush();
  expect(invoked).toEqual([{ kind: 'drawer_tab', id: 'connections' }]); expect(tutorial.root.isConnected).toBe(true); tutorial.destroy();
});

test('guides stay on the chosen screenshot until Back or Next is selected', () => {
  const clock = demoClock(), tutorial = openFeatureTutorial(ctx, 'group', options());
  expect(tutorial.root.querySelector('video, audio, .jb-tutorial-play')).toBeNull(); expect(clock.pending.size).toBe(0);
  document.dispatchEvent(new dom.window.Event('visibilitychange')); expect(tutorial.root.dataset.scene).toBe('1');
  find('Next').click(); expect(tutorial.root.dataset.scene).toBe('2'); expect(clock.pending.size).toBe(0);
  const oldNext=find('Next'); tutorial.destroy(); oldNext.click(); expect(tutorial.root.dataset.scene).toBe('2'); expect(invoked).toEqual([]);
});

test('the API companion keeps instructions and navigation visible while its example screenshot is optional', () => {
  const tutorial = openFeatureTutorial(ctx, 'connections', { ...options(), screenshots: { 'api-connection-open': { src: pixel, alt: 'Connections' } } });
  expect(handles).toHaveLength(0);
  const picture = tutorial.root.querySelector<HTMLDetailsElement>('.jb-api-guide-picture')!;
  expect(picture.open).toBe(false); expect(tutorial.root.querySelector('.jb-api-guide-instruction')!.closest('details')).toBeNull();
  expect(tutorial.root.querySelector('.jb-api-guide-result')!.closest('details')).toBeNull();
  expect(find('Next').closest('details')).toBeNull();
  find('Next').click(); expect(find('Back').disabled).toBe(false); expect(picture.open).toBe(false); tutorial.destroy();
});

test('numbered arrows match readable instructions, reject invalid coordinates, and never run native actions', () => {
  const tutorial=openFeatureTutorial(ctx, 'group', { ...options(), screenshots: { 'group-start': { src:pixel, width: 800, height: 600, alt:'Native controls', callouts:[
    {label:'Choose New Group Chat',x:10,y:15,targetX:80,targetY:60},
    {label:'<b>Literal instruction</b>',x:20,y:25,targetX:40,targetY:50},
    {label:'Outside screenshot',x:120,y:20,targetX:10,targetY:10},
    {label:'Invalid',x:NaN,y:20,targetX:10,targetY:10},
  ] } } });
  expect([...tutorial.root.querySelectorAll('.jb-tutorial-number')].map(node=>node.textContent)).toEqual(['1','2']);
  expect(tutorial.root.querySelectorAll('.jb-tutorial-arrows line')).toHaveLength(2);
  expect(tutorial.root.querySelector('img')!.width).toBe(800);
  expect(tutorial.root.querySelector('img')!.height).toBe(600);
  expect(tutorial.root.querySelector('.jb-tutorial-arrows line')!.getAttribute('x2')).toBe('80%');
  const legend=tutorial.root.querySelector('.jb-tutorial-callouts')!;
  expect(legend.textContent).toContain('Choose New Group Chat'); expect(legend.textContent).toContain('<b>Literal instruction</b>'); expect(legend.querySelector('b')).toBeNull();
  expect(tutorial.root.querySelector('.jb-tutorial-scene-title')!.textContent).toStartWith('Step 1.');
  find('Enlarge screenshot').click(); expect(tutorial.root.querySelectorAll('.jb-tutorial-number')).toHaveLength(2);
  find('Next').click(); expect(tutorial.root.querySelector('.jb-tutorial-arrows, .jb-tutorial-callouts')).toBeNull(); expect(invoked).toEqual([]);
});

test('changed scenes reveal their start without stealing focus or resetting same-scene work', async () => {
  const scrolls: Array<{ scene: string | undefined; options: unknown }> = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function(settings: unknown) {
    scrolls.push({ scene: this.closest('.jb-feature-tutorial')?.getAttribute('data-scene') ?? undefined, options: settings });
  };
  const tutorial = openFeatureTutorial(ctx, 'group', { ...options(), screenshots: { 'group-start': { src: pixel, alt: 'Native character browser' } } });
  expect(scrolls).toHaveLength(0);
  const next = find('Next'); next.focus(); next.click();
  expect(scrolls.at(-1)).toEqual({ scene: '2', options: { block: 'start', inline: 'nearest', behavior: 'instant' } });
  expect(document.activeElement === next).toBe(true);
  find('Back').click(); expect(scrolls.at(-1)?.scene).toBe('1');
  const beforeSameScene = scrolls.length; result = async () => false;
  find('Open Character Browser').click(); await flush();
  tutorial.root.querySelector('img')!.dispatchEvent(new dom.window.Event('load'));
  tutorial.root.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
  expect(scrolls).toHaveLength(beforeSameScene);
  tutorial.destroy();
});

test('the importer opens only on request and a missing callback gives recovery', async () => {
  openFeatureTutorial(ctx, 'import', options()); expect(imports).toBe(0); find('Open card importer').click(); await flush(); expect(imports).toBe(1); expect(document.querySelector('.jb-feature-tutorial')).toBeNull();
  const tutorial = openFeatureTutorial(ctx, 'import', { invoke: options().invoke }); find('Open card importer').click(); await flush(); expect(tutorial.root.isConnected).toBe(true); expect(tutorial.root.textContent).toContain('Add a card');
});

test('card guidance does not require JAR and its history guide is a separate explicit action', async () => {
  let histories = 0;
  const tutorial = openFeatureTutorial(ctx, 'import', { ...options(), openHistoryTutorial: () => histories++ });
  expect(tutorial.root.textContent).toContain('You do not need JAR or JAR Bridge');
  expect(tutorial.root.querySelector('.jb-tutorial-play')).toBeNull();
  find('Next').click(); expect(tutorial.root.textContent).toContain('Choose card files');
  find('Next').click(); expect(tutorial.root.textContent).toContain('Imported to your library');
  expect(imports).toBe(0); expect(histories).toBe(0); expect(invoked).toEqual([]);
  find('Need your old messages too?').click(); expect(histories).toBe(1);
});

test('history uses only its explicit callback and explains missing JAR separately', async () => {
  let histories = 0;
  const tutorial = openFeatureTutorial(ctx, 'history', { ...options(), openHistory: async () => { histories++; return false; } });
  expect(histories).toBe(0); expect(imports).toBe(0);
  find('Open history importer').click(); await flush();
  expect(histories).toBe(1); expect(imports).toBe(0); expect(tutorial.root.isConnected).toBe(true);
  expect(tutorial.root.textContent).toContain('Install and enable JAR Bridge');
});
