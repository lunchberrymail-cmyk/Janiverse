import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createStreamingSettings } from '../src/streaming-settings';

type Row = Record<string, any>;
const original = { fetch: globalThis.fetch, location: globalThis.location };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
let adapter: ReturnType<typeof createStreamingSettings>, ctx: any;
let calls: Array<{ path: string; method: string; body: any }>, grants: string[], requested: number;
let chatId: string | null, personaId: string | null, selectedId: string | null, activeConnection: string;
let metadata: Row, connections: Row[], reasoning: Row, presets: Map<string, Row>, binding: Row | null, inherited: Row | null;
let rejectBinding: boolean, postCount: number;
const writes = () => calls.filter(call => call.method !== 'GET');
function base(): Row {
  return { id: 'source', name: 'Native instructions', provider: 'loom', engine: 'classic', cache_revision: 7,
    parameters: { samplerOverrides: { enabled: false, temperature: .2, presencePenalty: .3, streaming: true, future: { preserve: true } }, customBody: { enabled: true, rawJson: '{"vendor":"keep"}' }, future: ['keep'] },
    prompts: { completionSettings: { assistantPrefill: 'Existing prefix' }, advancedSettings: { seed: 22 }, promptBehavior: { continueNudge: 'Keep this' } },
    metadata: { isDefault: true, modelProfiles: { another: { streaming: false } }, promptVariables: { tone: 'native' }, unknown: ['keep'] },
    prompt_order: [{ id: 'first', role: 'system', content: 'Full prompt', enabled: true, marker: null, position: 'pre_history', variables: [{ name: 'tone' }] }, { id: 'history', enabled: true, marker: 'chat_history', isLocked: true, unknown: 'kept' }],
  };
}
beforeEach(() => {
  globalThis.location = { pathname: '/chat/chat-1' } as Location;
  calls = []; grants = ['generation', 'presets', 'chats']; requested = 0; chatId = 'chat-1'; personaId = 'persona-1'; selectedId = 'source'; activeConnection = 'connection-1'; metadata = {}; reasoning = {};
  connections = [{ id: 'connection-1', preset_id: 'source', is_default: true, metadata: { reasoningBindings: {} } }, { id: 'pinned', preset_id: 'source', metadata: {} }];
  presets = new Map([['source', base()]]); binding = null; inherited = { preset_id: 'source', block_states: { first: false, history: true }, prompt_variables: { first: { tone: 'profile' } }, captured_at: 11 }; rejectBinding = false; postCount = 0;
  globalThis.fetch = (async (url: any, init: RequestInit = {}) => {
    const parsed = new URL(String(url), 'http://localhost'); const path = parsed.pathname.replace('/api/v1', ''); const method = init.method || 'GET'; const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: path + parsed.search, method, body }); expect(init.credentials).toBe('same-origin');
    if (path === '/chats/chat-1') return json({ id: 'chat-1', metadata });
    if (path === '/settings/reasoningSettings') return json({ key: 'reasoningSettings', value: reasoning });
    if (path === '/preset-profiles/resolve/chat-1') { const current = binding ?? inherited; return json({ preset_id: current?.preset_id ?? parsed.searchParams.get('preset_id'), binding: current, source: current ? 'persona' : 'none' }); }
    if (path === '/preset-profiles/chat/chat-1') {
      if (method === 'PUT') { if (rejectBinding) return json({}, 500); binding = { ...body, captured_at: 12 }; return json(binding); }
      return binding ? json(binding) : json({}, 404);
    }
    if (path === '/preset-profiles/connection/connection-1') return inherited ? json(inherited) : json({}, 404);
    if (path === '/preset-profiles/defaults') return inherited ? json(inherited) : json({}, 404);
    if (path === '/presets' && method === 'POST') { const result = { ...body, id: `copy-${++postCount}`, cache_revision: 1 }; presets.set(result.id, result); return json(result, 201); }
    if (path.startsWith('/presets/')) {
      const id = decodeURIComponent(path.slice('/presets/'.length)); const found = presets.get(id); if (!found) return json({}, 404);
      if (method === 'PUT') { if (body.expected_cache_revision !== found.cache_revision) return json({}, 409); const { expected_cache_revision, ...rest } = body; const result = { ...found, ...rest, cache_revision: found.cache_revision + 1 }; presets.set(id, result); return json(result); }
      return json(found);
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as typeof fetch;
  ctx = {
    getActiveChat: () => ({ chatId, characterId: 'character-1' }),
    state: { get(key: string) { if (key === 'loom.activePresetId') return selectedId; if (key === 'persona.activeId') return personaId; if (key === 'connections.active') return { activeProfileId: activeConnection }; if (key === 'connections.profiles') return connections; throw new Error(`Unexpected selector ${key}`); } },
    permissions: { getGranted: async () => [...grants], request: async () => { requested++; return [...grants]; } },
  };
  adapter = createStreamingSettings(ctx);
});
afterEach(() => { adapter.dispose(); globalThis.fetch = original.fetch; globalThis.location = original.location; });

test('read is inert, first save copies only the streaming field and effective block states, and later saves reuse its copy', async () => {
  const source = structuredClone(presets.get('source'));
  expect(await adapter.read('chat-1')).toEqual({ enabled: true, available: true }); expect(writes()).toEqual([]); expect(requested).toBe(0);
  expect(await adapter.save(false)).toEqual({ enabled: false, available: true });
  const copy = presets.get('copy-1')!;
  expect(presets.get('source')).toEqual(source); expect(copy.parameters).toEqual({ ...source!.parameters, samplerOverrides: { ...source!.parameters.samplerOverrides, streaming: false } });
  expect(copy.parameters.samplerOverrides.enabled).toBe(false); expect(copy.prompts).toEqual(source!.prompts); expect(copy.metadata.modelProfiles).toEqual(source!.metadata.modelProfiles);
  expect(copy.prompt_order).toEqual(source!.prompt_order.map((block: Row) => ({ ...block, enabled: inherited!.block_states[block.id] ?? block.enabled })));
  expect(binding?.prompt_variables).toEqual(inherited!.prompt_variables); expect(binding?.block_states).toEqual({ first: false, history: true }); expect(selectedId).toBe('source');
  expect(await adapter.save(true)).toEqual({ enabled: true, available: true }); expect(postCount).toBe(1); expect(presets.get('copy-1')!.parameters.samplerOverrides.streaming).toBe(true);
  expect(writes().map(call => call.path)).toEqual(['/presets', '/preset-profiles/chat/chat-1', '/presets/copy-1', '/preset-profiles/chat/chat-1']);
});

test('unchanged value does not create a native copy or binding', async () => { await adapter.read(); await adapter.save(true); expect(writes()).toEqual([]); });

test('read uses a valid chat connection pin and selected persona while a missing persona leaves native default resolution intact', async () => {
  metadata.connection_profile_id = 'pinned'; await adapter.read();
  const resolve = calls.find(call => call.path.startsWith('/preset-profiles/resolve'))!; const params = new URL(resolve.path, 'http://localhost').searchParams;
  expect(params.get('connection_id')).toBe('pinned'); expect(params.get('persona_id')).toBe('persona-1');
  personaId = null; calls = []; metadata.connection_profile_id = 'deleted-pin'; await adapter.read();
  const next = new URL(calls.find(call => call.path.startsWith('/preset-profiles/resolve'))!.path, 'http://localhost'); expect(next.searchParams.has('persona_id')).toBe(false); expect(next.searchParams.get('connection_id')).toBe('connection-1');
});

test('temporary chats bypass the default persona and preserve raw/empty preset behavior', async () => {
  metadata = { temporary: true, no_preset: true }; expect((await adapter.read()).available).toBe(false); expect(calls.some(call => call.path.startsWith('/preset-profiles/'))).toBe(false);
  await expect(adapter.save(false)).rejects.toThrow('Reload Customize'); expect(writes()).toEqual([]);
  metadata = { temporary: true }; presets.get('source')!.prompt_order = []; expect((await adapter.read()).available).toBe(true); expect(calls.some(call => call.path.startsWith('/preset-profiles/resolve'))).toBe(false);
  await adapter.save(false); expect(presets.get('copy-1')!.prompt_order).toEqual([]); expect(writes().some(call => call.path.includes('/connections/') || call.path.endsWith('/metadata'))).toBe(false);
});

test('missing preset and missing permissions return an unavailable reason without creating defaults or requesting access', async () => {
  grants = ['chats']; const denied = await adapter.read(); expect(denied.available).toBe(false); expect(denied.reason).toContain('Generation'); expect(calls).toEqual([]); expect(requested).toBe(0);
  grants = ['chats', 'presets', 'generation']; selectedId = null; connections.forEach(connection => connection.preset_id = null); inherited = null;
  expect((await adapter.read()).reason).toContain('Choose a native preset'); expect(writes()).toEqual([]);
});

test('a custom body transport override is unavailable, including native connection reasoning precedence', async () => {
  presets.get('source')!.parameters.customBody.rawJson = '{"_streaming":false}'; expect((await adapter.read()).reason).toContain('custom request body');
  reasoning = { customBody: { enabled: false, rawJson: '{}' } }; expect((await adapter.read()).available).toBe(true);
  connections[0].metadata.reasoningBindings.settings = { customBody: { enabled: true, rawJson: '{"_streaming":true}' } }; expect((await adapter.read()).available).toBe(false); expect(writes()).toEqual([]);
});

test('scope, effective binding, revision, and permission changes prevent stale native mutations', async () => {
  await adapter.read(); inherited!.captured_at++; await expect(adapter.save(false)).rejects.toThrow('binding changed'); expect(writes()).toEqual([]);
  await adapter.read(); presets.get('source')!.cache_revision++; await expect(adapter.save(false)).rejects.toThrow('preset changed'); expect(writes()).toEqual([]);
  await adapter.read(); metadata.connection_profile_id = 'pinned'; await expect(adapter.save(false)).rejects.toThrow('configuration changed'); expect(writes()).toEqual([]);
  await adapter.read(); grants = []; await expect(adapter.save(false)).rejects.toThrow('Enable Generation'); expect(writes()).toEqual([]);
  grants = ['chats', 'presets', 'generation']; await adapter.read(); chatId = 'another'; await expect(adapter.save(false)).rejects.toThrow('active chat changed'); expect(writes()).toEqual([]);
});

test('a failed chat binding retries the staged copy rather than creating another one', async () => {
  await adapter.read(); rejectBinding = true; await expect(adapter.save(false)).rejects.toThrow('Could not read or save'); expect(postCount).toBe(1);
  rejectBinding = false; expect(await adapter.save(false)).toEqual({ enabled: false, available: true }); expect(postCount).toBe(1); expect(binding?.preset_id).toBe('copy-1');
});

test('dispose while a permission recheck is pending prevents delayed writes', async () => {
  await adapter.read(); let finish!: (value: string[]) => void;
  ctx.permissions.getGranted = () => new Promise<string[]>(resolve => { finish = resolve; });
  const save = adapter.save(false); adapter.dispose(); finish(['presets', 'chats', 'generation']); await expect(save).rejects.toThrow('closed'); expect(writes()).toEqual([]);
});

test('an interrupted creation cannot silently retry and create duplicate preset copies', async () => {
  await adapter.read(); const transport = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: RequestInit) => { const response = await transport(url, init); if (String(url) === '/api/v1/presets' && init?.method === 'POST') throw new Error('Dropped after commit'); return response; }) as typeof fetch;
  await expect(adapter.save(false)).rejects.toThrow('may have been saved'); expect(postCount).toBe(1); expect(binding).toBeNull();
  await expect(adapter.save(false)).rejects.toThrow('Reload Customize'); expect(postCount).toBe(1);
});
