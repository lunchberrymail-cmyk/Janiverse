import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createPromptSettings } from '../src/prompt-settings';

const originals = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
type Row = Record<string, any>;
let dom: JSDOM, editor: ReturnType<typeof createPromptSettings>, ctx: any, root: HTMLElement;
let grants: string[], requested: string[][], calls: Array<{ path: string; method: string; body: any }>;
let presets: Map<string, Row>, bindings: Map<string, Row>, selectedId: string | null, chatId: string | null, metadata: Row, connection: Row;
let inherited: Row | null, conflict: boolean, rejectBinding: boolean, count: number;

function base(): Row {
  return { id: 'original', name: 'My advanced preset', provider: 'loom', engine: 'classic', cache_revision: 7,
    parameters: { samplerOverrides: { enabled: true, temperature: .8, minP: .12, topP: .9, topK: 40, maxTokens: 2500, contextSize: 32000, presencePenalty: .3, repetitionPenalty: 1.1, frequencyPenalty: .2, streaming: false, vendorSwitch: 'keep' }, customBody: { enabled: true, rawJson: '{"vendor":true}' }, extra: { nested: 'keep' } },
    prompts: { completionSettings: { assistantPrefill: 'Existing prefix', continuePrefill: true, reasoningPrefill: 'Reason', namesBehavior: 2, nativeFuture: true }, advancedSettings: { seed: 123, customStopStrings: ['STOP'] }, promptBehavior: { emptySendNudge: 'Nudge' }, unknown: ['keep'] },
    metadata: { isDefault: true, schemaVersion: 3, description: 'Original', modelProfiles: { model: { temperature: .2 } }, promptVariables: { first: { tone: 'native' } }, unknownMetadata: { preserve: true } },
    prompt_order: [
      { id: 'category', marker: 'category', categoryMode: 'radio', enabled: true, role: 'system', content: '', name: 'Styles', position: 'pre_history' },
      { id: 'first', marker: null, role: 'system', content: 'Original instructions', enabled: true, position: 'pre_history', variables: [{ name: 'tone', type: 'text' }], future: { keep: true } },
      { id: 'second', marker: null, role: 'system', content: 'Other instructions', enabled: false, position: 'pre_history' },
      { id: 'history', marker: 'chat_history', enabled: true, role: 'system', position: 'pre_history', content: '', isLocked: true },
    ],
  };
}
function button(text: string): HTMLButtonElement { const found = [...root.querySelectorAll('button')].find(b => b.textContent === text); if (!found) throw new Error(`Missing ${text}`); return found; }
function input(name: string): HTMLInputElement { return root.querySelector<HTMLInputElement>(`[name="${name}"]`)!; }
function change(name: string, value: string) { const field = input(name); field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
function writes() { return calls.filter(call => call.method !== 'GET'); }
async function start(tab: 'prompt' | 'generation' = 'prompt') { editor.open(tab); await settle(); }
async function save() { button('Save settings').click(); await settle(); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><div id="native">Preserve native</div></body>', { url: 'http://localhost/chat/chat-1' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  grants = ['chats', 'presets', 'generation']; requested = []; calls = []; presets = new Map([['original', base()]]); bindings = new Map();
  selectedId = 'original'; chatId = 'chat-1'; metadata = {}; connection = { id: 'connection-1', name: 'My model', preset_id: 'original', is_default: true, metadata: { keep: true } };
  inherited = { preset_id: 'original', block_states: { first: false, second: true, history: true, category: true }, prompt_variables: { first: { tone: 'profile value' } }, captured_at: 100 };
  conflict = false; rejectBinding = false; count = 0;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://localhost'); const path = parsed.pathname.replace('/api/v1', ''); const method = init.method || 'GET'; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: path + parsed.search, method, body }); expect(init.credentials).toBe('same-origin');
    if (path === '/chats/chat-1' && method === 'GET') return json({ id: 'chat-1', name: 'A story', metadata });
    if (path === '/chats/chat-1/metadata' && method === 'PATCH') { metadata = { ...metadata, ...body }; return json({}); }
    if (path === '/connections/connection-1') {
      if (method === 'PUT') connection = { ...connection, ...body };
      return json(connection);
    }
    if (path === '/preset-profiles/resolve/chat-1') {
      const binding = bindings.get('chat/chat-1') ?? inherited;
      return json({ preset_id: binding?.preset_id ?? parsed.searchParams.get('preset_id'), binding, source: binding ? 'chat' : 'none' });
    }
    if (path.startsWith('/preset-profiles/defaults')) return json({}, 404);
    if (path.startsWith('/preset-profiles/')) {
      const key = path.replace('/preset-profiles/', '');
      if (method === 'PUT') { if (rejectBinding) return json({}, 500); const result = { ...body, captured_at: 200 }; bindings.set(key, result); return json(result); }
      return bindings.has(key) ? json(bindings.get(key)) : json({}, 404);
    }
    if (path === '/presets' && method === 'POST') { const result = { ...body, id: `copy-${++count}`, cache_revision: 1 }; presets.set(result.id, result); return json(result, 201); }
    if (path.startsWith('/presets/')) {
      const id = decodeURIComponent(path.slice('/presets/'.length)); const found = presets.get(id); if (!found) return json({}, 404);
      if (method === 'PUT') {
        if (conflict || body.expected_cache_revision !== found.cache_revision) return json({ code: 'PRESET_REVISION_CONFLICT' }, 409);
        const { expected_cache_revision, ...fields } = body; const result = { ...found, ...fields, cache_revision: found.cache_revision + 1 }; presets.set(id, result); return json(result);
      }
      return json(found);
    }
    throw new Error(`Unexpected ${method} ${path}${parsed.search}`);
  }) as typeof fetch;
  ctx = {
    state: { get(key: string) { return key === 'loom.activePresetId' ? selectedId : key === 'persona.activeId' ? 'persona-1' : key === 'connections.active' ? { activeProfileId: connection.id } : key === 'connections.profiles' ? [connection] : null; } },
    getActiveChat: () => ({ chatId, characterId: 'char-1' }),
    permissions: { getGranted: async () => [...grants], request: async (permissions: string[]) => { requested.push(permissions); grants = [...permissions]; return [...grants]; } },
    ui: { showModal() {
      root = document.createElement('section'); root.setAttribute('role', 'dialog'); document.body.append(root); let closed = false; const handlers: Array<() => void> = [];
      return { root, dismiss() { if (!closed) { closed = true; root.remove(); handlers.forEach(fn => fn()); } }, onDismiss(fn: () => void) { handlers.push(fn); return () => {}; } };
    } },
  };
  editor = createPromptSettings(ctx);
});
afterEach(() => { editor.destroy(); dom.window.close(); globalThis.fetch = originals.fetch; globalThis.document = originals.document; globalThis.location = originals.location; });

test('first Save copies the effective hierarchy and maps, preserves the original, binds real native state, then reuses its copy', async () => {
  const original = structuredClone(presets.get('original'));
  await start(); expect(input('global-prompt').value).toBe(''); expect(input('assistant-prefill').value).toBe('Existing prefix');
  change('global-prompt', 'New writing instructions'); change('assistant-prefill', 'New prefix'); await save();
  expect(presets.get('original')).toEqual(original); expect(count).toBe(1);
  const copied = presets.get('copy-1')!;
  expect(copied.parameters).toEqual(original!.parameters);
  expect(copied.prompts).toEqual({ ...original!.prompts, completionSettings: { ...original!.prompts.completionSettings, assistantPrefill: 'New prefix' } });
  expect(copied.metadata.modelProfiles).toEqual(original!.metadata.modelProfiles); expect(copied.metadata.unknownMetadata).toEqual(original!.metadata.unknownMetadata); expect(copied.metadata.isDefault).toBe(false);
  expect(copied.prompt_order.slice(2)).toEqual(original!.prompt_order.map((b: Row) => ({ ...b, enabled: inherited!.block_states[b.id] ?? b.enabled })));
  expect(copied.prompt_order[0].categoryMode).toBe('checkbox'); expect(copied.prompt_order[1].content).toBe('New writing instructions');
  expect(bindings.get('chat/chat-1')?.prompt_variables).toEqual(inherited!.prompt_variables);
  expect(bindings.get('chat/chat-1')?.block_states.first).toBe(false); expect(bindings.get('chat/chat-1')?.block_states.second).toBe(true);
  expect(root.textContent).toContain('Saved for this conversation.'); expect(selectedId).toBe('original');
  change('global-prompt', 'Edited again'); await save();
  expect(count).toBe(1); expect(presets.get('copy-1')?.cache_revision).toBe(2); expect(presets.get('copy-1')?.prompt_order[1].content).toBe('Edited again');
  expect(writes().find(call => call.method === 'PUT' && call.path === '/presets/copy-1')?.body.expected_cache_revision).toBe(1);
  expect(writes().some(call => call.path.includes('/defaults'))).toBe(false); expect(document.querySelector('#native')?.textContent).toBe('Preserve native');
});

test('a simple main system prompt edits only its copied block and preserves untouched samplers', async () => {
  const preset = presets.get('original')!; preset.prompt_order = [preset.prompt_order[1], preset.prompt_order[3]]; delete preset.prompt_order[0].variables; inherited = null;
  await start(); expect(input('global-prompt').value).toBe('Original instructions'); change('global-prompt', 'Better instructions'); await save();
  expect(presets.get('copy-1')?.prompt_order).toEqual([{ ...preset.prompt_order[0], content: 'Better instructions' }, preset.prompt_order[1]]);
  expect(presets.get('copy-1')?.parameters).toEqual(preset.parameters);
});

test('native sampler names and values are merged while advanced controls survive', async () => {
  await start('generation'); change('temperature', '1.2'); change('topK', '0'); change('topP', ''); change('maxTokens', '4096'); await save();
  const sampler = presets.get('copy-1')?.parameters.samplerOverrides;
  expect(sampler).toMatchObject({ temperature: 1.2, topK: 0, topP: null, maxTokens: 4096, minP: .12, presencePenalty: .3, streaming: false, vendorSwitch: 'keep' });
  expect(presets.get('copy-1')?.parameters.customBody).toEqual(base().parameters.customBody);
});

test('permissions are never requested on open and every denied Save avoids writes', async () => {
  grants = ['chats']; await start(); expect(requested).toEqual([]); expect(writes()).toHaveLength(0); expect(input('global-prompt').disabled).toBe(true);
  expect(root.textContent).toContain('presets and generation'); button('Enable permissions').click(); await settle();
  expect(requested).toEqual([['presets', 'chats', 'generation']]); expect(input('global-prompt').disabled).toBe(false);
  change('global-prompt', 'Draft'); grants = ['chats']; await save(); expect(writes()).toHaveLength(0); expect(input('global-prompt').value).toBe('Draft');
});

test('a native revision conflict retains the draft and never overwrites or rebinds', async () => {
  await start(); change('global-prompt', 'First'); await save(); const initialWrites = writes().length;
  change('global-prompt', 'Uncommitted draft'); conflict = true; await save();
  expect(root.textContent).toContain('changed while you were editing'); expect(input('global-prompt').value).toBe('Uncommitted draft');
  expect(writes().slice(initialWrites)).toHaveLength(1); expect(writes().at(-1)?.path).toBe('/presets/copy-1'); expect(presets.get('copy-1')?.cache_revision).toBe(1);
});

test('an effective binding or preset revision changed elsewhere blocks a stale clone', async () => {
  await start(); change('global-prompt', 'Keep my draft'); inherited = { ...inherited, captured_at: 101 } as Row; await save();
  expect(writes()).toHaveLength(0); expect(root.textContent).toContain('changed while you were editing');
  button('Reload saved settings').click(); await settle(); change('global-prompt', 'Draft two'); presets.get('original')!.cache_revision++; await save(); expect(writes()).toHaveLength(0);
});

test('a failed binding retry reuses the saved native row instead of cloning again', async () => {
  await start(); change('global-prompt', 'Draft'); rejectBinding = true; await save(); expect(count).toBe(1); expect(root.textContent).toContain('Could not finish');
  rejectBinding = false; await save(); expect(count).toBe(1); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1'); expect(root.textContent).toContain('Saved for this conversation.');
});

test('later edits preserve native checkbox overrides made on the copied preset', async () => {
  await start(); change('global-prompt', 'Draft'); await save();
  const savedBinding = bindings.get('chat/chat-1')!; savedBinding.block_states = { ...savedBinding.block_states, history: false, first: true, second: false }; savedBinding.captured_at++;
  button('Reload saved settings').click(); await settle(); change('assistant-prefill', 'New prefix'); await save();
  expect(bindings.get('chat/chat-1')?.block_states).toMatchObject({ history: false, first: true, second: false });
  expect(presets.get('copy-1')?.prompt_order.find((b: Row) => b.id === 'history').enabled).toBe(false);
});

test('first run creates normal structural markers, memory-compatible native defaults and a missing connection fallback', async () => {
  selectedId = null; connection.preset_id = null; inherited = null; presets.clear();
  await start(); change('global-prompt', 'Write as the character'); await save();
  const result = presets.get('copy-1')!;
  expect(result.provider).toBe('loom'); expect(result.engine).toBe('classic');
  expect(result.prompt_order.map((b: Row) => b.marker)).toEqual([null, null, 'world_info_before', 'char_description', 'char_personality', 'scenario', 'persona_description', 'world_info_after', 'dialogue_examples', 'chat_history']);
  expect(result.prompt_order[0].content).toBe('Write as the character');
  expect(result.prompt_order[1]).toMatchObject({ content: '{{system}}', isLocked: true, enabled: true, position: 'pre_history', role: 'system' });
  expect(result.prompt_order.filter((b: Row) => b.marker).every((b: Row) => b.enabled && b.isLocked)).toBe(true);
  expect(result.prompts.completionSettings).toMatchObject({ useSystemPrompt: true, assistantPrefill: '', namesBehavior: 0 });
  expect(connection.preset_id).toBe(result.id); expect(connection.metadata).toEqual({ keep: true }); expect(selectedId).toBe(null);
  expect(writes().find(call => call.path === '/connections/connection-1')?.body).toEqual({ preset_id: result.id });
  expect(bindings.get('chat/chat-1')?.preset_id).toBe(result.id);
});

test('an existing empty raw hierarchy becomes a complete native copy without dropping advanced maps', async () => {
  const original = presets.get('original')!; original.prompt_order = []; inherited = null;
  await start(); change('global-prompt', 'The new main prompt'); await save();
  const copied = presets.get('copy-1')!;
  expect(original.prompt_order).toEqual([]); expect(copied.prompt_order[0].content).toBe('The new main prompt');
  expect(copied.prompt_order.some((b: Row) => b.marker === 'chat_history' && b.enabled)).toBe(true);
  expect(copied.prompt_order.some((b: Row) => b.marker === 'persona_description' && b.enabled)).toBe(true);
  expect(copied.parameters).toEqual(original.parameters); expect(copied.prompts).toEqual(original.prompts);
});

test('API scope uses only its connection binding and never rewrites existing association or global selection', async () => {
  dom.reconfigure({ url: 'http://localhost/' }); chatId = null;
  await start(); change('global-prompt', 'API instructions'); await save();
  expect(bindings.get('connection/connection-1')?.preset_id).toBe('copy-1'); expect(bindings.has('chat/chat-1')).toBe(false);
  expect(writes().some(call => call.path === '/connections/connection-1')).toBe(false); expect(connection.preset_id).toBe('original'); expect(selectedId).toBe('original');
  expect(root.textContent).toContain('Saved for this API configuration');
});

test('linked connection profiles retain their own preset even if their default snapshot is absent', async () => {
  dom.reconfigure({ url: 'http://localhost/' }); chatId = null;
  const linked = { ...base(), id: 'linked', name: 'Linked native', cache_revision: 3 }; presets.set('linked', linked); bindings.set('connection/connection-1', { preset_id: 'linked', linked_to_defaults: true, block_states: {} });
  await start(); expect(root.querySelector('.jb-settings-advanced:not(.jb-settings-generation-advanced)')?.textContent).toContain('Linked native');
  change('global-prompt', 'Instructions'); await save(); expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBe('linked');
});

test('raw temporary chats explicitly opt into native settings and never inherit a persona preset', async () => {
  metadata = { temporary: true, no_preset: true, unrelated: 'keep' }; selectedId = null; connection.preset_id = null;
  await start(); expect(input('enable-chat-preset').checked).toBe(false); await save(); expect(writes()).toHaveLength(0);
  input('enable-chat-preset').checked = true; change('global-prompt', 'Test instructions'); await save();
  expect(metadata).toEqual({ temporary: true, no_preset: false, unrelated: 'keep' }); expect(connection.preset_id).toBe('copy-1');
  expect(calls.some(call => call.path.startsWith('/preset-profiles/resolve'))).toBe(false); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1');
});

test('invalid generation inputs prevent writes and scope changes retain drafts', async () => {
  await start('generation'); change('maxTokens', '0'); await save(); expect(writes()).toHaveLength(0); expect(input('maxTokens').getAttribute('aria-invalid')).toBe('true');
  change('maxTokens', '2000'); chatId = 'different-chat'; await save(); expect(writes()).toHaveLength(0); expect(root.textContent).toContain('changed');
});

test('closing during an awaited permission check prevents a delayed native mutation', async () => {
  await start(); change('global-prompt', 'Draft'); let allow!: (permissions: string[]) => void;
  ctx.permissions.getGranted = () => new Promise<string[]>(resolve => { allow = resolve; });
  button('Save settings').click(); editor.destroy(); allow(['presets', 'generation', 'chats']); await settle();
  expect(writes()).toHaveLength(0); expect(root.isConnected).toBe(false);
});
