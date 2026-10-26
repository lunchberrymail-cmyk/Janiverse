import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createPromptSettings } from '../src/prompt-settings';
import { createCustomDefault } from '../src/custom-default';

const originals = { document: globalThis.document, location: globalThis.location, fetch: globalThis.fetch };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
type Row = Record<string, any>;
let dom: JSDOM, editor: ReturnType<typeof createPromptSettings>, ctx: any, root: HTMLElement;
let grants: string[], requested: string[][], calls: Array<{ path: string; method: string; body: any }>;
let presets: Map<string, Row>, bindings: Map<string, Row>, selectedId: string | null, chatId: string | null, metadata: Row, connection: Row;
let inherited: Row | null, conflict: boolean, rejectBinding: boolean, count: number;
let presetDefaults: Map<string, Row>;

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
function nativeDefault(): Row {
  return { id: 'native-default', name: 'Default', provider: 'loom', engine: 'classic', cache_revision: 4,
    parameters: { samplerOverrides: { enabled: true, temperature: null, maxTokens: null, contextSize: null, nativeDefaultFuture: 'preserve' }, customBody: { enabled: false, rawJson: '{}' } },
    prompts: { completionSettings: { useSystemPrompt: true, assistantPrefill: '', namesBehavior: 0, nativeDefaultCompletion: 'preserve' }, nativeDefaultBehavior: { preserve: true } },
    metadata: { _lumiverse_preset_slug: 'lumiverse-builtin-default-loom', isDefault: true, schemaVersion: 1, modelProfiles: {}, nativeDefaultMetadata: { preserve: true } },
    prompt_order: [
      { id: '019e62a4-7dba-7001-a422-10836ade35dd', name: 'System Prompt', content: 'Write the next reply in this roleplay.', role: 'system', enabled: true, position: 'pre_history', marker: null, isLocked: false, futureNativeBlock: true },
      { id: 'native-persona-category', name: 'Persona & Scenario', marker: 'category', categoryMode: 'checkbox', enabled: true, role: 'system', content: '', position: 'pre_history' },
      { id: 'native-persona', name: 'Persona', marker: 'persona_description', enabled: true, role: 'system', content: '', position: 'pre_history', isLocked: true },
      { id: 'native-character', name: 'Character', marker: 'char_description', enabled: true, role: 'system', content: '', position: 'pre_history', isLocked: true },
      { id: 'native-scenario', name: 'Scenario', marker: 'scenario', enabled: true, role: 'system', content: '', position: 'pre_history', isLocked: true },
      { id: 'native-history', name: 'Chat History', marker: 'chat_history', enabled: true, role: 'system', content: '', position: 'pre_history', isLocked: true },
    ],
  };
}
function button(text: string): HTMLButtonElement { const found = [...root.querySelectorAll('button')].find(b => b.textContent === text); if (!found) throw new Error(`Missing ${text}`); return found; }
function input(name: string): HTMLInputElement { return root.querySelector<HTMLInputElement>(`[name="${name}"]`)!; }
function change(name: string, value: string) {
  // Editing a saved preset now requires the same explicit copy action as the UI.
  // Tests that only choose/save a normal preset do not use this helper.
  const field = input(name);
  if (field.disabled) {
    const copy = [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Customize a copy' && !b.hidden && !b.disabled);
    copy?.click();
  }
  expect(field.disabled).toBe(false); field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}
async function choose(name: string, value: string) { const field = input(name); field.value = value; field.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await settle(); }
function writes() { return calls.filter(call => call.method !== 'GET'); }
async function start(tab: 'prompt' | 'generation' = 'prompt') { editor.open(tab); await settle(); }
async function mount() {
  const target = document.createElement('section'); target.id = 'outer-settings'; document.body.append(target);
  ctx.ui.showModal = () => { throw new Error('Inline preferences must not open another modal'); };
  const session = editor.mount(target); root = target.querySelector<HTMLElement>('.jb-prompt-settings-inline')!; await settle(); return { target, session };
}
async function save() { button('Save settings').click(); await settle(); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body><div id="native">Preserve native</div></body>', { url: 'http://localhost/chat/chat-1' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  grants = ['chats', 'presets', 'generation']; requested = []; calls = []; presets = new Map([['original', base()], ['native-default', nativeDefault()]]); bindings = new Map(); presetDefaults = new Map();
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
    if (path.startsWith('/preset-profiles/defaults')) { const result = presetDefaults.get(parsed.searchParams.get('preset_id') || ''); return result ? json(result) : json({}, 404); }
    if (path.startsWith('/preset-profiles/')) {
      const key = path.replace('/preset-profiles/', '');
      if (method === 'PUT') { if (rejectBinding) return json({}, 500); const result = { ...body, captured_at: 200 }; bindings.set(key, result); return json(result); }
      return bindings.has(key) ? json(bindings.get(key)) : json({}, 404);
    }
    if (path === '/presets/registry' && method === 'GET') {
      const rows = [...presets.values()].filter(p => p.provider === 'loom').map(({ id, name, provider }) => ({ id, name, provider })); const offset = Number(parsed.searchParams.get('offset') || 0), limit = Number(parsed.searchParams.get('limit') || 100);
      return json({ data: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
    }
    if (path === '/presets' && method === 'GET') { const rows = [...presets.values()]; const offset = Number(parsed.searchParams.get('offset') || 0), limit = Number(parsed.searchParams.get('limit') || 100); return json({ data: rows.slice(offset, offset + limit), total: rows.length, offset, limit }); }
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

test('a normal saved preset stays unchanged, read-only, and keeps native inherited state without any duplicate or unnecessary binding', async () => {
  const original = structuredClone(presets.get('original')); const profile = structuredClone(inherited);
  await start();
  expect(input('prompt-source').value).toBe('preset'); expect(input('prompt-preset').value).toBe('original');
  for (const name of ['global-prompt', 'assistant-prefill', 'temperature', 'sampler-overrides']) expect(input(name).disabled).toBe(true);
  expect(button('Customize a copy').hidden).toBe(false); expect(button('Customize a copy').disabled).toBe(false);
  expect(root.querySelector('.jb-settings-prompt-source-help')?.textContent).toContain('linked regex');
  await save(); await save();
  expect(writes()).toHaveLength(0); expect(count).toBe(0); expect(bindings.size).toBe(0); expect(inherited).toEqual(profile);
  expect(presets.get('original')).toEqual(original); expect(selectedId).toBe('original');
  expect(root.textContent).toContain('already uses the saved preset unchanged');
});

test('choosing another saved preset binds its actual identity and native values, variables and enabled states without preset or regex mutations', async () => {
  const alternate = { ...base(), id: 'threadbare', name: 'ThreadBare', cache_revision: 4 };
  // These are valid native/provider settings beyond this simplified editor's
  // copy-edit limits. Applying the unmodified preset must never reject them.
  alternate.parameters.samplerOverrides.maxTokens = 262144; alternate.parameters.samplerOverrides.topK = 700;
  alternate.metadata.regex = { sourceOwned: true }; presets.set(alternate.id, alternate);
  const profile = { preset_id: alternate.id, block_states: { first: false, second: true, history: true, category: true }, prompt_variables: { first: { tone: 'saved variable' } }, captured_at: 3 };
  presetDefaults.set(alternate.id, profile); const original = structuredClone(alternate);
  await start(); await choose('prompt-preset', alternate.id); await save();
  expect(count).toBe(0); expect(presets.get(alternate.id)).toEqual(original); expect(input('prompt-preset').value).toBe(alternate.id);
  expect(bindings.get('chat/chat-1')).toMatchObject({ preset_id: alternate.id, block_states: profile.block_states, prompt_variables: profile.prompt_variables });
  expect(writes().map(call => call.path)).toEqual(['/preset-profiles/chat/chat-1']);
  expect(calls.some(call => call.path.includes('regex'))).toBe(false); expect(selectedId).toBe('original');
  expect(input('maxTokens').value).toBe('262144'); expect(input('maxTokens').disabled).toBe(true);
  const before = writes().length; await save(); expect(writes()).toHaveLength(before);
});

test('Customize a copy is an explicit draft action, with no mutation until Save and a warning about original preset-linked regex', async () => {
  await start(); button('Customize a copy').click();
  expect(writes()).toHaveLength(0); expect(input('global-prompt').disabled).toBe(false); expect(input('temperature').disabled).toBe(false);
  expect(root.querySelector('.jb-settings-status')?.textContent).toContain('Preset-linked regex stays with the original');
  change('global-prompt', 'Explicit isolated change'); await save();
  expect(count).toBe(1); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1');
  expect(presets.get('original')?.prompt_order).toEqual(base().prompt_order);
});

test('choosing an unchanged saved preset abandons a copy draft without applying its prompt or generation edits', async () => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Original imported preset' });
  await start(); change('global-prompt', 'Do not carry this draft into the saved source'); change('temperature', '1.9');
  await choose('prompt-preset', 'alternate');
  expect(input('global-prompt').value).toBe(''); expect(input('temperature').value).toBe('0.8'); expect(input('global-prompt').disabled).toBe(true);
  await save(); expect(count).toBe(0); expect(bindings.get('chat/chat-1')?.preset_id).toBe('alternate');
  expect(presets.get('alternate')?.parameters).toEqual(base().parameters);
});

test('a failed direct saved-preset binding retries the same original identity and never creates a copy', async () => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Native source' });
  await start(); await choose('prompt-preset', 'alternate'); rejectBinding = true; await save();
  expect(count).toBe(0); expect(bindings.size).toBe(0); expect(root.textContent).toContain('Could not finish');
  rejectBinding = false; await save(); expect(count).toBe(0); expect(bindings.get('chat/chat-1')?.preset_id).toBe('alternate');
  expect(writes().every(call => call.path === '/preset-profiles/chat/chat-1')).toBe(true);
});

test('users can replace a legacy Janiverse duplicate with its original preset without deleting either row or creating another', async () => {
  const legacy = { ...base(), id: 'legacy-copy', name: 'Janiverse · Chat · ThreadBare', metadata: { ...base().metadata, _janitor_bridge: { owner: 'janitor_bridge', scope: 'chat:chat-1', sourcePresetId: 'original', promptMode: 'preset' } } };
  presets.set(legacy.id, legacy); inherited = { ...inherited!, preset_id: legacy.id }; const oldCopy = structuredClone(legacy);
  await start(); await choose('prompt-preset', 'original'); await save();
  expect(count).toBe(0); expect(bindings.get('chat/chat-1')?.preset_id).toBe('original'); expect(presets.get(legacy.id)).toEqual(oldCopy);
  expect(writes().map(call => call.path)).toEqual(['/preset-profiles/chat/chat-1']);
});

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
  expect(requested).toEqual([['presets', 'chats', 'generation']]); expect(input('prompt-preset').disabled).toBe(false); expect(input('global-prompt').disabled).toBe(true);
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

test('first run copies the real native Default, including its future settings, and adds a missing connection fallback', async () => {
  selectedId = null; connection.preset_id = null; inherited = null; presets.clear(); presets.set('native-default', nativeDefault());
  const originalDefault = structuredClone(presets.get('native-default'));
  await start(); change('global-prompt', 'Write as the character'); await save();
  const result = presets.get('copy-1')!;
  expect(result.provider).toBe('loom'); expect(result.engine).toBe('classic');
  expect(result.prompt_order).toEqual(originalDefault!.prompt_order.map((b: Row) => b.id === '019e62a4-7dba-7001-a422-10836ade35dd' ? { ...b, content: 'Write as the character' } : b));
  expect(result.prompt_order[0].content).toBe('Write as the character');
  expect(result.parameters).toEqual(originalDefault!.parameters); expect(result.prompts).toEqual(originalDefault!.prompts); expect(presets.get('native-default')).toEqual(originalDefault);
  expect(result.metadata._lumiverse_preset_slug).toBeUndefined(); expect(result.metadata.nativeDefaultMetadata).toEqual({ preserve: true }); expect(result.metadata._janitor_bridge).toMatchObject({ sourcePresetId: 'native-default', promptMode: 'custom' });
  expect(result.prompts.completionSettings).toMatchObject({ useSystemPrompt: true, assistantPrefill: '', namesBehavior: 0 });
  expect(connection.preset_id).toBe(result.id); expect(connection.metadata).toEqual({ keep: true }); expect(selectedId).toBe(null);
  expect(writes().find(call => call.path === '/connections/connection-1')?.body).toEqual({ preset_id: result.id });
  expect(bindings.get('chat/chat-1')?.preset_id).toBe(result.id);
});

test('an existing empty raw hierarchy becomes a complete native copy without dropping advanced maps', async () => {
  const original = presets.get('original')!; original.prompt_order = []; inherited = null;
  await start(); change('global-prompt', 'The new main prompt'); await save();
  const copied = presets.get('copy-1')!;
  expect(original.prompt_order).toEqual([]); expect(copied.prompt_order[1].content).toBe('The new main prompt');
  expect(copied.prompt_order.slice(2)).toEqual(nativeDefault().prompt_order);
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

test('raw temporary chats can opt in from Generation and never inherit a persona preset', async () => {
  metadata = { temporary: true, no_preset: true, unrelated: 'keep' }; selectedId = null; connection.preset_id = null;
  await start('generation'); expect(input('enable-chat-preset').checked).toBe(false); expect(input('enable-chat-preset').closest('[hidden]')).toBeNull(); await save(); expect(writes()).toHaveLength(0);
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
  button('Save settings').click(); expect(root.getAttribute('aria-busy')).toBe('true'); editor.destroy(); allow(['presets', 'generation', 'chats']); await settle();
  expect(writes()).toHaveLength(0); expect(root.isConnected).toBe(false);
});

test('inline preferences mount prompt and generation together and save without closing their outer settings', async () => {
  const { target, session } = await mount();
  expect(root.querySelector('[role="tablist"]')).toBeNull(); expect(root.querySelector('[role="tabpanel"]')).toBeNull();
  expect(input('global-prompt').closest('[hidden]')).toBeNull(); expect(input('temperature').closest('[hidden]')).toBeNull();
  const promptEditor = root.querySelector<HTMLDetailsElement>('.jb-settings-global-prompt')!;
  expect(promptEditor.open).toBe(false); expect(promptEditor.querySelector('summary')?.textContent).toContain('Global prompt');
  expect(input('assistant-prefill').closest('.jb-settings-global-prompt')).toBe(promptEditor);
  expect(button('Reload saved settings').closest('details')?.querySelector('summary')?.textContent).toBe('How these settings are saved');
  expect([...root.querySelectorAll('button')].some(item => item.textContent === 'Close')).toBe(false);
  expect(root.querySelectorAll('.jb-settings-save')).toHaveLength(1);
  change('global-prompt', 'Inline instructions'); await save();
  expect(root.textContent).toContain('Saved for this conversation.'); expect(root.isConnected).toBe(true); expect(target.isConnected).toBe(true);
  expect(presets.get('copy-1')?.prompt_order[1].content).toBe('Inline instructions');
  session.destroy(); expect(root.isConnected).toBe(false); expect(target.isConnected).toBe(true); expect(document.querySelector('#native')?.textContent).toBe('Preserve native');
});

test('inline sliders reflect extended native values without changing them and pair with number edits', async () => {
  const preset = presets.get('original')!; preset.parameters.samplerOverrides.maxTokens = 128000; preset.parameters.samplerOverrides.contextSize = 1048576; preset.parameters.samplerOverrides.temperature = null;
  await mount();
  expect(input('maxTokens-slider').max).toBe('128000'); expect(input('maxTokens-slider').value).toBe('128000'); expect(input('maxTokens').value).toBe('128000');
  expect(input('contextSize-slider').max).toBe('1048576'); expect(input('contextSize').value).toBe('1048576');
  expect(input('temperature-slider').getAttribute('aria-valuetext')).toBe('Default'); expect(input('temperature').value).toBe('');
  change('global-prompt', 'Only instructions changed'); await save();
  expect(presets.get('copy-1')?.parameters).toEqual(preset.parameters);
  change('maxTokens', '100000'); expect(input('maxTokens-slider').value).toBe('100000'); expect(input('maxTokens-slider').max).toBe('128000');
  change('maxTokens', ''); expect(input('maxTokens').value).toBe(''); expect(input('maxTokens-slider').getAttribute('aria-valuetext')).toBe('Default');
  change('temperature-slider', '1.25'); change('contextSize-slider', '65536'); await save();
  expect(input('temperature').value).toBe('1.25'); expect(input('contextSize').value).toBe('65536');
  expect(presets.get('copy-1')?.parameters.samplerOverrides).toMatchObject({ temperature: 1.25, maxTokens: null, contextSize: 65536, vendorSwitch: 'keep', minP: .12 });
  expect(presets.get('copy-1')?.parameters.customBody).toEqual(preset.parameters.customBody);
});

test('inline numeric validation keeps both sections available and never silently clips an invalid draft', async () => {
  await mount(); change('maxTokens', '128001');
  expect(input('maxTokens').value).toBe('128001'); expect(input('maxTokens-slider').value).toBe('128000');
  await save(); expect(writes()).toHaveLength(0); expect(input('maxTokens').getAttribute('aria-invalid')).toBe('true');
  expect(input('global-prompt').closest('[hidden]')).toBeNull(); expect(input('maxTokens').closest('[hidden]')).toBeNull();
  change('maxTokens-slider', '4096'); expect(input('maxTokens').getAttribute('aria-invalid')).toBeNull(); await save();
  expect(presets.get('copy-1')?.parameters.samplerOverrides.maxTokens).toBe(4096);
});

test('destroying an inline session cancels pending writes without dismissing its outer settings or newer editor', async () => {
  const { target, session } = await mount(); change('global-prompt', 'Draft'); let allow!: (permissions: string[]) => void;
  ctx.permissions.getGranted = () => new Promise<string[]>(resolve => { allow = resolve; });
  button('Save settings').click(); expect(root.getAttribute('aria-busy')).toBe('true');
  session.destroy(); allow(['presets', 'generation', 'chats']); await settle(); expect(writes()).toHaveLength(0); expect(target.isConnected).toBe(true);
  ctx.permissions.getGranted = async () => [...grants]; const newer = editor.mount(target); root = target.querySelector<HTMLElement>('.jb-prompt-settings-inline')!; await settle();
  session.destroy(); expect(root.isConnected).toBe(true); expect(input('prompt-preset').disabled).toBe(false); expect(input('global-prompt').disabled).toBe(true);
  newer.destroy(); expect(target.isConnected).toBe(true); expect(target.children).toHaveLength(0);
});

test('inline refresh loads a newly available first API connection without requiring a hidden manual reload', async () => {
  dom.reconfigure({ url: 'http://localhost/' }); chatId = null; let connected = false;
  const state = ctx.state.get;
  ctx.state.get = (key: string) => !connected && ['connections.active', 'connections.profiles'].includes(key) ? null : state(key);
  const { session } = await mount(); expect(input('global-prompt').disabled).toBe(true); expect(root.textContent).toContain('Add or select an API configuration above');
  connected = true; session.refresh(); await settle();
  expect(input('prompt-preset').disabled).toBe(false); expect(input('global-prompt').disabled).toBe(true); expect(input('temperature').value).toBe('0.8'); expect(root.textContent).toContain('This API configuration · My model');
  expect(writes()).toHaveLength(0); change('global-prompt', 'Instructions for the first connection'); await save();
  expect(bindings.get('connection/connection-1')?.preset_id).toBe('copy-1'); expect(root.textContent).toContain('Saved for this API configuration');
});

test('inline refresh preserves unsaved prompt, reply prefix and generation drafts and reveals a clear reload warning', async () => {
  const { session } = await mount(); change('global-prompt', 'Keep this draft'); change('assistant-prefill', 'Keep this prefix'); change('temperature', '1.3');
  const before = calls.length; session.refresh(); await settle();
  expect(calls).toHaveLength(before); expect(writes()).toHaveLength(0); expect(input('global-prompt').value).toBe('Keep this draft');
  expect(input('assistant-prefill').value).toBe('Keep this prefix'); expect(input('temperature').value).toBe('1.3');
  expect(button('Reload saved settings').closest('details')?.open).toBe(true);
  expect(root.querySelector('.jb-settings-status')?.getAttribute('data-tone')).toBe('warning'); expect(root.textContent).toContain('API configuration changed. Your unsaved prompt and generation settings are still here.');
  button('Reload saved settings').click(); await settle(); expect(input('global-prompt').value).toBe(''); expect(input('temperature').value).toBe('0.8');
});

test('a slower initial native read cannot overwrite an inline refresh, and refresh stops after destruction', async () => {
  const fetchSaved = globalThis.fetch; let finish!: (response: Response) => void; let pending = true;
  const stale = structuredClone(presets.get('original'));
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (String(url) === '/api/v1/presets/original' && pending) { pending = false; return new Promise<Response>(resolve => { finish = resolve; }); }
    return fetchSaved(url, init);
  }) as typeof fetch;
  const { session } = await mount(); expect(input('temperature').disabled).toBe(true);
  presets.get('original')!.parameters.samplerOverrides.temperature = 1.7; session.refresh(); await settle(); expect(input('temperature').value).toBe('1.7');
  finish(json(stale)); await settle(); expect(input('temperature').value).toBe('1.7'); expect(input('temperature').disabled).toBe(true); expect(input('prompt-preset').disabled).toBe(false);
  session.destroy(); const before = calls.length; session.refresh(); await settle(); expect(calls).toHaveLength(before); expect(root.isConnected).toBe(false);
});

test('existing full presets remain selected until an explicit source choice, and long custom prompts use the real Default base', async () => {
  const original = structuredClone(presets.get('original')); const defaultBase = structuredClone(presets.get('native-default'));
  await mount(); expect(input('prompt-source').value).toBe('preset'); expect(input('prompt-preset').value).toBe('original'); expect(writes()).toHaveLength(0);
  await choose('prompt-source', 'custom'); expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').value).toBe(defaultBase!.prompt_order[0].content); expect(writes()).toHaveLength(0);
  const longPrompt = 'A long roleplay instruction with {{char}} and {{user}}.\n'.repeat(12000); change('global-prompt', longPrompt); await save();
  const result = presets.get('copy-1')!; expect(result.prompt_order[0].content).toBe(longPrompt); expect(result.prompt_order.slice(1)).toEqual(defaultBase!.prompt_order.slice(1));
  expect(result.parameters).toEqual(defaultBase!.parameters); expect(result.prompts).toEqual(defaultBase!.prompts); expect(result.metadata._lumiverse_preset_slug).toBeUndefined();
  expect(result.metadata._janitor_bridge).toMatchObject({ sourcePresetId: 'native-default', promptMode: 'custom' }); expect(presets.get('original')).toEqual(original); expect(presets.get('native-default')).toEqual(defaultBase); expect(selectedId).toBe('original');
  expect((input('global-prompt') as unknown as HTMLTextAreaElement).maxLength).toBe(-1);
});

test('the current built-in Default opens in simple mode while keeping its complete category hierarchy', async () => {
  selectedId = 'native-default'; connection.preset_id = 'native-default'; inherited = null;
  await start(); expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').value).toBe(nativeDefault().prompt_order[0].content); expect(writes()).toHaveLength(0);
  change('global-prompt', 'My writing style'); await save(); expect(presets.get('copy-1')?.prompt_order.slice(1)).toEqual(nativeDefault().prompt_order.slice(1));
});

test('explicitly customizing a saved preset copies its complete hierarchy, native defaults and variables without changing the original', async () => {
  const alternate = { ...base(), id: 'alternate', name: 'Imported story', cache_revision: 3 }; alternate.metadata = { ...alternate.metadata, _lumiverse_install_source: 'illarin', _lumiverse_illarin_asset_id: 'asset-123' };
  alternate.prompt_order = alternate.prompt_order.map((block: Row) => ({ ...block, id: `alt-${block.id}`, content: `Imported: ${block.content}`, sealedProvenance: { preserve: true } })); presets.set(alternate.id, alternate);
  const sourceBinding = { preset_id: 'alternate', block_states: { 'alt-first': false, 'alt-second': true, 'alt-history': true, 'alt-category': true }, prompt_variables: { 'alt-first': { tone: 'imported tone' } }, captured_at: 300 }; presetDefaults.set('alternate', sourceBinding);
  const original = structuredClone(alternate); await start(); await choose('prompt-preset', 'alternate'); expect(writes()).toHaveLength(0); expect(input('prompt-preset').value).toBe('alternate');
  change('global-prompt', 'Extra instructions'); await save();
  const copied = presets.get('copy-1')!; expect(copied.prompt_order.slice(2)).toEqual(original.prompt_order.map((b: Row) => ({ ...b, enabled: sourceBinding.block_states[b.id as keyof typeof sourceBinding.block_states] ?? b.enabled })));
  expect(copied.parameters).toEqual(original.parameters); expect(copied.prompts).toEqual(original.prompts); expect(copied.metadata._lumiverse_install_source).toBe('local');
  expect(bindings.get('chat/chat-1')?.prompt_variables).toEqual(sourceBinding.prompt_variables); expect(copied.metadata._janitor_bridge.sourcePresetId).toBe('alternate'); expect(presets.get('alternate')).toEqual(original); expect(selectedId).toBe('original');
});

test('changed selected-preset defaults block a stale source copy before any mutation', async () => {
  const alternate = { ...base(), id: 'alternate', name: 'Other preset' }; presets.set('alternate', alternate);
  presetDefaults.set('alternate', { preset_id: 'alternate', block_states: { history: false }, prompt_variables: { first: { tone: 'old' } }, captured_at: 10 });
  await start(); await choose('prompt-preset', 'alternate'); change('global-prompt', 'Keep my draft');
  presetDefaults.set('alternate', { preset_id: 'alternate', block_states: { history: true }, prompt_variables: { first: { tone: 'new' } }, captured_at: 11 });
  await save(); expect(writes()).toHaveLength(0); expect(root.textContent).toContain('changed while you were editing'); expect(input('global-prompt').value).toBe('Keep my draft');
});

test.each(['original', 'alternate'])('revision changes in %s block an explicitly staged preset switch', async id => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Other preset' }); await start(); await choose('prompt-preset', 'alternate');
  presets.get(id)!.cache_revision++; await save(); expect(writes()).toHaveLength(0); expect(root.textContent).toContain('changed while you were editing');
});

test('a failed selected-source binding retry reuses its scoped copy and preserves the selected source defaults', async () => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Other preset' }); presetDefaults.set('alternate', { preset_id: 'alternate', block_states: { history: false }, prompt_variables: { first: { tone: 'keep' } }, captured_at: 10 });
  await start(); await choose('prompt-preset', 'alternate'); change('global-prompt', 'New source instructions'); rejectBinding = true; await save(); expect(count).toBe(1);
  rejectBinding = false; await save(); expect(count).toBe(1); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1'); expect(bindings.get('chat/chat-1')?.block_states.history).toBe(false); expect(bindings.get('chat/chat-1')?.prompt_variables).toEqual({ first: { tone: 'keep' } });
});

test('source choices keep dirty text and generation values and remain drafts across an API refresh', async () => {
  const { session } = await mount(); change('global-prompt', 'Unsaved prompt'); change('assistant-prefill', 'Prefix draft'); change('temperature', '1.3'); await choose('prompt-source', 'custom');
  expect(input('global-prompt').value).toBe('Unsaved prompt'); expect(input('assistant-prefill').value).toBe('Prefix draft'); expect(input('temperature').value).toBe('1.3'); expect(writes()).toHaveLength(0);
  const before = calls.length; session.refresh(); await settle(); expect(calls).toHaveLength(before); expect(root.textContent).toContain('API configuration changed'); expect(input('prompt-source').value).toBe('custom');
});

test('optional examples append only on explicit action and native manager callbacks never write or switch presets', async () => {
  let managed = 0, connected = 0; editor.destroy(); editor = createPromptSettings(ctx, { openPresetManager: () => { managed++; }, openIllarinSettings: () => { connected++; } });
  await start(); expect(root.querySelector<HTMLDetailsElement>('.jb-settings-prompt-help')?.open).toBe(false); expect(root.querySelector<HTMLDetailsElement>('.jb-settings-prompt-examples')?.open).toBe(false);
  change('global-prompt', 'Keep my own text'); button('Append writing style example').click(); expect(input('global-prompt').value).toStartWith('Keep my own text\n\n'); expect(writes()).toHaveLength(0);
  button('Manage / import presets').click(); button('Connect Illarin').click(); expect(managed).toBe(1); expect(connected).toBe(1); expect(selectedId).toBe('original'); expect(writes()).toHaveLength(0);
  let allow!: (permissions: string[]) => void; ctx.permissions.getGranted = () => new Promise<string[]>(resolve => { allow = resolve; });
  button('Save settings').click(); expect(button('Manage / import presets').disabled).toBe(true); expect(button('Connect Illarin').disabled).toBe(true); editor.destroy(); allow(grants); await settle(); expect(writes()).toHaveLength(0);
});

test('missing native Default opens an editable unsaved custom draft and still permits choosing a saved preset directly', async () => {
  selectedId = null; connection.preset_id = null; inherited = null; presets.delete('native-default'); let managed = 0;
  editor.destroy(); editor = createPromptSettings(ctx, { openPresetManager: () => { managed++; } }); await start();
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false); expect(button('Save settings').disabled).toBe(false); expect(root.textContent).toContain('saved only when you choose Save settings'); expect(writes()).toHaveLength(0);
  expect(button('Manage / import presets').disabled).toBe(false); button('Manage / import presets').click(); expect(managed).toBe(1);
  await choose('prompt-source', 'preset'); expect(input('prompt-preset').disabled).toBe(false); expect(input('global-prompt').disabled).toBe(true); expect(input('prompt-preset').value).toBe('original'); await save(); expect(bindings.get('chat/chat-1')?.preset_id).toBe('original'); expect(count).toBe(0);
});

test('Default discovery checks the native identity across pages and uses an independent draft for ambiguous identities', async () => {
  selectedId = null; connection.preset_id = null; inherited = null; const real = presets.get('native-default')!; real.name = 'Renamed native starter'; presets.clear();
  for (let i = 0; i < 101; i++) presets.set(`filler-${i}`, { ...base(), id: `filler-${i}`, name: i ? `Preset ${i}` : 'Default' }); presets.set(real.id, real);
  await start(); expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').value).toBe(real.prompt_order[0].content); expect(calls.some(call => call.path === '/presets?limit=100&offset=100')).toBe(true); expect(writes()).toHaveLength(0);
  presets.set('duplicate-default', { ...structuredClone(real), id: 'duplicate-default' }); button('Reload saved settings').click(); await settle();
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false); expect(root.textContent).toContain('saved only when you choose Save settings'); expect(writes()).toHaveLength(0);
  expect(input('global-prompt').value).toBe(createCustomDefault().prompt_order[0].content); expect(input('prompt-preset').value).toBe('filler-0');
});

test('the bundled custom draft has native character, persona, scenario, examples, memory and history assembly without an installed identity', () => {
  const draft = createCustomDefault(); const another = createCustomDefault();
  expect(draft.id).toBe(''); expect(draft.provider).toBe('loom'); expect(draft.engine).toBe('classic'); expect(draft.metadata._lumiverse_preset_slug).toBeUndefined();
  const main = draft.prompt_order.find(b => b.id === '019e62a4-7dba-7001-a422-10836ade35dd')!;
  expect(main).toMatchObject({ enabled: true, marker: null, role: 'system', isLocked: false });
  const content = draft.prompt_order.map(b => b.content).join('\n'); const markers = draft.prompt_order.map(b => b.marker);
  expect(markers).toContain('chat_history');
  for (const [marker, macro] of [['char_description', '{{description}}'], ['char_personality', '{{personality}}'], ['persona_description', '{{persona}}'], ['scenario', '{{scenario}}'], ['dialogue_examples', '{{mesExamples}}']]) {
    expect(markers.includes(marker) || content.includes(macro)).toBe(true);
  }
  expect(content).toContain('{{loomSummary}}'); expect(content).toContain('{{memories}}');
  for (const macro of ['{{cortexActive}}', '{{entities}}', '{{relationships}}', '{{arc}}', '{{memorySalience}}']) expect(content).toContain(macro);
  expect(new Set(draft.prompt_order.map(b => b.id)).size).toBe(draft.prompt_order.length);
  expect(draft.prompts.completionSettings).toMatchObject({ useSystemPrompt: true });
  main.content = 'Mutated draft'; expect(another.prompt_order[0].content).not.toBe(main.content);
});

test.each(['missing', 'ambiguous', 'empty-layout'])('%s Default still accepts a long custom paste and saves a new native binding only on Save', async condition => {
  if (condition === 'missing') presets.delete('native-default');
  if (condition === 'ambiguous') presets.set('duplicate-default', { ...nativeDefault(), id: 'duplicate-default' });
  if (condition === 'empty-layout') presets.get('native-default')!.prompt_order = [];
  const originals = structuredClone([...presets]); const currentBinding = structuredClone(inherited);
  await start(); await choose('prompt-source', 'custom');
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false); expect(input('prompt-preset').value).toBe('original');
  expect(writes()).toHaveLength(0); expect(inherited).toEqual(currentBinding); expect(bindings.size).toBe(0);
  const longPrompt = 'My own full prompt. {{char}} responds to {{user}}.\n'.repeat(12000); change('global-prompt', longPrompt); await save();
  const saved = presets.get('copy-1')!;
  expect(saved.prompt_order.find((b: Row) => b.id === '019e62a4-7dba-7001-a422-10836ade35dd').content).toBe(longPrompt);
  expect(saved.prompt_order.slice(1)).toEqual(createCustomDefault().prompt_order.slice(1));
  expect(saved.metadata._janitor_bridge).toMatchObject({ sourcePresetId: null, promptMode: 'custom' });
  expect(bindings.get('chat/chat-1')?.preset_id).toBe(saved.id); expect(count).toBe(1); expect(selectedId).toBe('original');
  for (const [id, value] of originals) expect(presets.get(id)).toEqual(value);
  expect(calls.some(call => call.path === '/presets/' || call.path === '/preset-profiles/defaults?preset_id=')).toBe(false);
  await save(); expect(count).toBe(1); expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBeNull();
});

test.each(['list-error', 'list-network', 'defaults-error'])('custom selection remains editable with %s and preserves dirty copy edits', async condition => {
  const fetchSaved = globalThis.fetch; let failDiscovery = false;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const path = String(url);
    if (failDiscovery && condition.startsWith('list') && path.startsWith('/api/v1/presets?')) {
      if (condition === 'list-network') throw new TypeError('Network error');
      return json({}, 503);
    }
    if (failDiscovery && condition === 'defaults-error' && path === '/api/v1/preset-profiles/defaults?preset_id=native-default') return json({}, 503);
    return fetchSaved(url, init);
  }) as typeof fetch;
  await start(); change('global-prompt', 'Unsaved custom prompt'); change('assistant-prefill', 'Unsaved prefix'); change('temperature', '1.4');
  failDiscovery = true; await choose('prompt-source', 'custom');
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false); expect(input('global-prompt').value).toBe('Unsaved custom prompt');
  expect(input('assistant-prefill').value).toBe('Unsaved prefix'); expect(input('temperature').value).toBe('1.4'); expect(writes()).toHaveLength(0);
  await save(); expect(count).toBe(1); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1'); expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBeNull();
});

test.each(['scope-binding', 'source-revision', 'scope'])('a fallback custom draft retains the %s conflict check before any mutation', async conflictKind => {
  presets.delete('native-default'); await start(); await choose('prompt-source', 'custom'); change('global-prompt', 'Keep my unsaved text');
  if (conflictKind === 'scope-binding') inherited = { ...inherited!, captured_at: 999 };
  if (conflictKind === 'source-revision') presets.get('original')!.cache_revision++;
  if (conflictKind === 'scope') chatId = 'chat-2';
  await save(); expect(writes()).toHaveLength(0); expect(input('global-prompt').value).toBe('Keep my unsaved text');
  expect(root.textContent).toContain(conflictKind === 'scope' ? 'active chat or API configuration changed' : 'changed while you were editing');
});

test('a failed fallback binding Save reuses its created native preset on retry without inventing source provenance', async () => {
  presets.delete('native-default'); await start(); await choose('prompt-source', 'custom'); change('global-prompt', 'My draft');
  rejectBinding = true; await save(); expect(count).toBe(1); expect(bindings.size).toBe(0);
  rejectBinding = false; await save(); expect(count).toBe(1); expect(bindings.get('chat/chat-1')?.preset_id).toBe('copy-1');
  expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBeNull();
});

test('revoked permissions keep an editable fallback draft and prevent all native writes', async () => {
  presets.delete('native-default'); await start(); await choose('prompt-source', 'custom'); change('global-prompt', 'Keep draft'); grants = [];
  await save(); expect(writes()).toHaveLength(0); expect(input('global-prompt').value).toBe('Keep draft'); expect(button('Enable permissions').hidden).toBe(false);
});

test('a first-run standard base stays local until Save and then binds a real native preset to the API configuration', async () => {
  selectedId = null; connection.preset_id = null; inherited = null; presets.delete('native-default'); chatId = null;
  dom.reconfigure({ url: 'http://localhost/' }); await start();
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false); expect(writes()).toHaveLength(0);
  change('global-prompt', 'My first custom prompt'); await save();
  expect(count).toBe(1); expect(bindings.get('connection/connection-1')?.preset_id).toBe('copy-1'); expect(connection.preset_id).toBe('copy-1'); expect(selectedId).toBeNull();
  expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBeNull(); expect(root.querySelector('.jb-settings-prompt-source-help')?.textContent).toContain('standard base');
  expect(calls.some(call => call.path === '/presets/' || call.path === '/preset-profiles/defaults?preset_id=')).toBe(false);
});

test.each(['success', 'failure'])('the latest Custom selection wins over a slower saved-preset %s response', async responseKind => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Slow saved preset' });
  const fetchSaved = globalThis.fetch; let finish!: (response: Response) => void; let pending = true;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (String(url) === '/api/v1/presets/alternate' && pending) { pending = false; return new Promise<Response>(resolve => { finish = resolve; }); }
    return fetchSaved(url, init);
  }) as typeof fetch;
  await start(); await choose('prompt-preset', 'alternate'); expect(input('global-prompt').disabled).toBe(true);
  await choose('prompt-source', 'custom'); expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').disabled).toBe(false);
  change('global-prompt', 'The latest custom draft'); finish(responseKind === 'success' ? json(presets.get('alternate')) : json({}, 503)); await settle();
  expect(input('prompt-source').value).toBe('custom'); expect(input('global-prompt').value).toBe('The latest custom draft'); expect(input('global-prompt').disabled).toBe(false); expect(writes()).toHaveLength(0);
  expect(root.querySelector('label[for$="-global-prompt"] .jb-settings-label')?.textContent).toBe('Your prompt');
});

test('a newer saved-preset selection wins over slower Custom discovery without applying any draft', async () => {
  presets.set('alternate', { ...base(), id: 'alternate', name: 'Chosen saved preset' });
  const fetchSaved = globalThis.fetch; let finish!: (response: Response) => void; let pending = true;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    if (String(url) === '/api/v1/presets?limit=100&offset=0' && pending) { pending = false; return new Promise<Response>(resolve => { finish = resolve; }); }
    return fetchSaved(url, init);
  }) as typeof fetch;
  await start(); await choose('prompt-source', 'custom'); await choose('prompt-preset', 'alternate');
  finish(json({ data: [...presets.values()], total: presets.size, offset: 0, limit: 100 })); await settle();
  expect(input('prompt-source').value).toBe('preset'); expect(input('prompt-preset').value).toBe('alternate'); expect(input('global-prompt').disabled).toBe(true); expect(writes()).toHaveLength(0);
});

test('legacy Janiverse copies retaining the builtin slug do not hide the genuine Default or get modified on discovery', async () => {
  const legacy = { ...nativeDefault(), id: 'legacy-janiverse', name: 'Old Janiverse chat' }; legacy.metadata = { ...legacy.metadata, _janitor_bridge: { owner: 'janitor_bridge', scope: 'chat:old-chat', blockId: legacy.prompt_order[0].id } };
  presets.set(legacy.id, legacy); const originalLegacy = structuredClone(legacy); await start(); await choose('prompt-source', 'custom');
  expect(root.textContent).not.toContain('More than one preset'); expect(input('prompt-preset').value).toBe('native-default'); expect(writes()).toHaveLength(0); expect(presets.get(legacy.id)).toEqual(originalLegacy);
  await save(); expect(presets.get('copy-1')?.metadata._janitor_bridge.sourcePresetId).toBe('native-default'); expect(presets.get(legacy.id)).toEqual(originalLegacy);
});

test('changing raw-chat mode while editing blocks saving before any native mutation', async () => {
  metadata = { temporary: true, no_preset: true }; await start(); input('enable-chat-preset').checked = true; change('global-prompt', 'Draft'); metadata = { temporary: true, no_preset: false };
  await save(); expect(writes()).toHaveLength(0); expect(root.textContent).toContain('active chat or API configuration changed');
});
