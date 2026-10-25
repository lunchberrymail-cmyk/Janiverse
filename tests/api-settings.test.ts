import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createApiSettings } from '../src/api-settings';

type Call = { url: string; options?: RequestInit };
type Profile = { id: string; name: string; provider: string; api_url: string; model: string; has_api_key: boolean; is_default: boolean; metadata: Record<string, unknown> };
const originalFetch = globalThis.fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); };
let dom: JSDOM;
let api: ReturnType<typeof createApiSettings>;
let roots: HTMLElement[];
let granted: string[];
let calls: Call[];
let updates: Array<{ id: string; input: Record<string, unknown> }>;
let activeSwitches: string[];
let modelLoads: string[];
let profiles: Profile[];
let currentChat: { chatId: string; characterId: string } | null;
let metadata: Record<string, unknown>;
let respond: (url: string, options?: RequestInit) => Promise<Response>;
let update: (id: string, input: Record<string, unknown>) => Promise<unknown>;
let getGranted: () => Promise<string[]>;
let applied: number;

const root = () => roots.at(-1)!;
const control = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string) => root().querySelector<T>(`[name="${name}"]`)!;
const button = (label: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!;
function choose(name: string, value: string) { const input = control(name); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document;
  roots = []; calls = []; updates = []; activeSwitches = []; modelLoads = []; applied = 0;
  granted = ['generation', 'chats'];
  currentChat = { chatId: 'chat/one', characterId: 'character' };
  metadata = { connection_profile_id: 'bound', connection_model: 'chat-model', authors_note: { content: 'Keep this' }, unrelated: 42 };
  profiles = [
    { id: 'primary', name: 'Main provider', provider: 'openai', api_url: 'https://api.openai.com/v1', model: 'global-model', has_api_key: true, is_default: true, metadata: { preserve: 'global' } },
    { id: 'bound', name: 'Chat provider', provider: 'openrouter', api_url: 'https://openrouter.ai/api/v1', model: 'profile-model', has_api_key: true, is_default: false, metadata: { reasoningBindings: { promptBias: 'Keep prefix' }, preserve: 'bound' } },
  ];
  getGranted = async () => [...granted];
  update = async (id, input) => {
    updates.push({ id, input: structuredClone(input) });
    const existing = profiles.find(profile => profile.id === id)!;
    Object.assign(existing, input);
    if (input.api_key) existing.has_api_key = true;
    return structuredClone(existing);
  };
  respond = async (url, options) => {
    if (options?.method === 'PATCH') {
      Object.assign(metadata, JSON.parse(String(options.body)));
      return json({ metadata });
    }
    if (url.startsWith('/api/v1/settings/')) return json({});
    if (url.startsWith('/api/v1/chats/')) return json({ id: currentChat?.chatId, metadata });
    throw new Error(`Unexpected fetch ${options?.method ?? 'GET'} ${url}`);
  };
  globalThis.fetch = (async (url, options) => { calls.push({ url: String(url), options }); return respond(String(url), options); }) as typeof fetch;
  api = createApiSettings({
    getActiveChat: () => currentChat,
    state: { get: () => ({ activeProfileId: 'primary', model: 'global-model', provider: 'openai' }) },
    permissions: { getGranted: () => getGranted(), request: async () => {} },
    connections: {
      list: () => structuredClone(profiles),
      getActive: () => ({ activeProfileId: 'primary', model: 'global-model', provider: 'openai' }),
      update: (id: string, input: Record<string, unknown>) => update(id, input),
      models: async (id: string) => { modelLoads.push(id); return { models: ['profile-model', 'other-model'] }; },
      setActiveAcknowledged: async (id: string) => { activeSwitches.push(id); },
    },
    ui: { showModal: () => {
      const container = document.createElement('div'); document.body.append(container); roots.push(container);
      const callbacks: Array<() => void> = []; let dismissed = false;
      return { root: container, modalId: String(roots.length), setTitle() {},
        dismiss() { if (!dismissed) { dismissed = true; container.remove(); callbacks.forEach(fn => fn()); } },
        onDismiss(fn: () => void) { callbacks.push(fn); return () => {}; },
      };
    } },
  } as any, { onApplied: () => { applied++; } });
});
afterEach(() => { api.destroy(); globalThis.fetch = originalFetch; dom.window.close(); });

describe('API settings preserve native connection and chat scope', () => {
  test('saved Vertex models are editable for this chat without changing provider credentials or shared model', async () => {
    profiles[1].provider = 'vertex';
    profiles[1].metadata = { project_id: 'keep-project', region: 'keep-region', credential: { native: 'keep' } };
    const before = structuredClone(profiles[1]);
    api.open(); await settle();
    expect(control('api-model').disabled).toBe(false);
    expect(control('api-key').disabled).toBe(true); expect(control('api-base-url').disabled).toBe(true); expect(control('api-profile-name').disabled).toBe(true);
    control('api-model').value = 'vertex-chat-model'; button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(profiles[1]).toEqual(before);
    const patch = calls.find(call => call.options?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.options?.body))).toEqual({ connection_profile_id: 'bound', connection_model: 'vertex-chat-model' });
    expect(activeSwitches).toHaveLength(0); expect(modelLoads).toHaveLength(0);
    expect(calls.every(call => !call.url.includes('/test') && !call.url.includes('/models'))).toBe(true);
    expect(applied).toBe(1);
  });

  test('saved Vertex default model writes only model before native activation and keeps chat overrides', async () => {
    profiles[1].provider = 'vertex';
    profiles[1].metadata = { project_id: 'keep-project', region: 'keep-region', credential: { native: 'keep' } };
    const providerOptions = structuredClone(profiles[1].metadata); const chatBefore = structuredClone(metadata);
    api.open(); await settle(); choose('api-scope', 'default');
    control('api-model').value = 'vertex-default-model'; button('Save & Use').click(); await settle();
    expect(updates).toEqual([{ id: 'bound', input: { model: 'vertex-default-model' } }]);
    expect(profiles[1].metadata).toEqual(providerOptions); expect(profiles[1].has_api_key).toBe(true); expect(profiles[1].provider).toBe('vertex');
    expect(activeSwitches).toEqual(['bound']); expect(metadata).toEqual(chatBefore);
    expect(calls.some(call => call.options?.method === 'PATCH')).toBe(false);
    expect(calls.some(call => call.url === '/api/v1/settings/activeProfileId' && call.options?.method === 'PUT')).toBe(true);
    expect(modelLoads).toHaveLength(0); expect(calls.every(call => !call.url.includes('/test') && !call.url.includes('/models'))).toBe(true);
    expect(applied).toBe(1);
  });

  test('saved unsupported providers require a nonempty model before applying', async () => {
    profiles[1].provider = 'vertex'; api.open(); await settle(); control('api-model').value = '  ';
    button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0);
    expect(calls.some(call => ['PUT', 'PATCH', 'POST'].includes(call.options?.method ?? 'GET'))).toBe(false);
    expect(root().textContent).toContain('Enter or choose a model ID.');
  });

  test('new profiles enter native storage, synchronize through the native event path, and bind this chat', async () => {
    const previousRespond = respond;
    let created: Record<string, unknown> | undefined;
    respond = async (url, options) => {
      if (url === '/api/v1/connections' && options?.method === 'POST') {
        created = JSON.parse(String(options.body));
        const profile = { id: 'created-native', ...created, has_api_key: true, is_default: false, metadata: {} } as Profile;
        profiles.push(profile);
        return json(profile);
      }
      return previousRespond(url, options);
    };
    api.open(); await settle(); choose('api-connection', '');
    control('api-profile-name').value = 'My new API';
    control('api-key').value = 'new-secret'; control('api-model').value = 'new-model';
    button('Save & Use').click(); await settle();
    expect(created).toMatchObject({ name: 'My new API', provider: 'openai', model: 'new-model', api_key: 'new-secret' });
    expect(updates).toEqual([{ id: 'created-native', input: { name: 'My new API' } }]);
    const patch = calls.find(call => call.options?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.options?.body))).toEqual({ connection_profile_id: 'created-native', connection_model: null });
    expect(activeSwitches).toHaveLength(0); expect(applied).toBe(1); expect(root().isConnected).toBe(false);
    expect(control('api-key').value).toBe('');
  });

  test('opening and changing fields never contacts the provider or mutates configuration', async () => {
    api.open(); await settle();
    expect(control('api-connection').value).toBe('bound');
    expect(control('api-model').value).toBe('chat-model');
    expect(control('api-key').value).toBe('');
    control('api-base-url').value = 'https://proxy.example/v1';
    control('api-key').value = 'replacement-key';
    control('api-model').value = 'other-model';
    await settle();
    expect(calls.map(call => call.url)).toEqual(['/api/v1/chats/chat%2Fone?messages=false']);
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0); expect(modelLoads).toHaveLength(0);
  });

  test('blank stored credential is omitted, shared metadata and profile model survive chat apply', async () => {
    const originalMetadata = structuredClone(profiles[1].metadata);
    api.open(); await settle();
    control('api-profile-name').value = 'Renamed chat provider';
    control('api-model').value = 'new-chat-model';
    button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('bound');
    expect(updates[0].input).not.toHaveProperty('api_key');
    expect(updates[0].input).not.toHaveProperty('model');
    expect(updates[0].input).not.toHaveProperty('metadata');
    expect(profiles[1].model).toBe('profile-model');
    expect(profiles[1].metadata).toEqual(originalMetadata);
    const patch = calls.find(call => call.options?.method === 'PATCH')!;
    expect(patch.url).toBe('/api/v1/chats/chat%2Fone/metadata');
    expect(JSON.parse(String(patch.options?.body))).toEqual({ connection_profile_id: 'bound', connection_model: 'new-chat-model' });
    expect(metadata.authors_note).toEqual({ content: 'Keep this' }); expect(metadata.unrelated).toBe(42);
    expect(activeSwitches).toHaveLength(0); expect(applied).toBe(1); expect(root().isConnected).toBe(false);
  });

  test('using the profile model clears an old chat override without changing the default connection', async () => {
    api.open(); await settle(); control('api-model').value = 'profile-model';
    button('Save & Use').click(); await settle();
    const patch = calls.find(call => call.options?.method === 'PATCH')!;
    expect(JSON.parse(String(patch.options?.body))).toEqual({ connection_profile_id: 'bound', connection_model: null });
    expect(activeSwitches).toHaveLength(0);
  });

  test('default scope activates the native profile and leaves the current chat pin intact', async () => {
    const originalMetadata = structuredClone(metadata);
    api.open(); await settle(); choose('api-scope', 'default'); choose('api-connection', 'primary');
    control('api-model').value = 'updated-global-model';
    button('Save & Use').click(); await settle();
    expect(activeSwitches).toEqual(['primary']);
    expect(profiles[0].model).toBe('updated-global-model');
    expect(calls.some(call => call.options?.method === 'PATCH')).toBe(false);
    const persisted = calls.find(call => call.url === '/api/v1/settings/activeProfileId')!;
    expect(persisted.options?.method).toBe('PUT');
    expect(JSON.parse(String(persisted.options?.body))).toEqual({ value: 'primary' });
    expect(metadata).toEqual(originalMetadata);
    expect(applied).toBe(1);
  });

  test('existing providers are immutable so a saved key cannot silently move to another provider', async () => {
    api.open(); await settle();
    const pills = Array.from(root().querySelectorAll<HTMLButtonElement>('.jb-provider-pill'));
    expect(pills.every(pill => pill.disabled)).toBe(true);
    expect(pills.find(pill => pill.textContent === 'OpenRouter')?.getAttribute('aria-pressed')).toBe('true');
    choose('api-connection', '');
    expect(pills.every(pill => !pill.disabled)).toBe(true);
    pills.find(pill => pill.textContent === 'Proxy / Custom')!.click();
    expect(control('api-key').value).toBe('');
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(1);
  });

  test('revoked generation or chats permissions prevent every save write', async () => {
    api.open(); await settle();
    granted = ['chats']; button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(1);
    expect(root().textContent).toContain('Allow connection settings');
    granted = ['generation']; api.open(); await settle(); button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(calls.every(call => !call.options?.method)).toBe(true);
    expect(root().textContent).toContain('Chats permission');
  });

  test('model loading is explicit and Test connection refuses unsaved changes', async () => {
    api.open(); await settle(); button('Load models').click(); await settle();
    expect(modelLoads).toEqual(['bound']);
    expect(root().querySelectorAll('datalist option')).toHaveLength(2);
    control('api-base-url').value = 'https://changed.example/v1';
    button('Test connection').click(); await settle();
    expect(calls.some(call => call.url.endsWith('/test'))).toBe(false);
    expect(root().textContent).toContain('Save your changes before testing');
    expect(updates).toHaveLength(0);
  });

  test('invalid endpoint blocks save before any credential or chat write', async () => {
    api.open(); await settle();
    control('api-base-url').value = 'https://user:password@proxy.example/v1?key=secret';
    control('api-key').value = 'new-secret'; button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(1);
    expect(root().isConnected).toBe(true);
    expect(control('api-key').value).toBe('new-secret');
    expect(root().textContent).toContain('without a login, query, or fragment');
  });

  test('failed save retains the form and does not apply a chat connection', async () => {
    update = async () => { throw new Error('Rejected by server'); };
    api.open(); await settle(); control('api-profile-name').value = 'Keep my edit';
    button('Save & Use').click(); await settle();
    expect(root().isConnected).toBe(true); expect(control('api-profile-name').value).toBe('Keep my edit');
    expect(button('Save & Use').disabled).toBe(false);
    expect(calls).toHaveLength(1); expect(applied).toBe(0);
  });

  test('destroy during permission resolution prevents the pending write and clears a typed key', async () => {
    api.open(); await settle(); control('api-key').value = 'typed-secret';
    let grant: (permissions: string[]) => void = () => {};
    getGranted = () => new Promise(resolve => { grant = resolve; });
    const key = control('api-key'); button('Save & Use').click(); api.destroy();
    grant(['generation', 'chats']); await settle();
    expect(key.value).toBe(''); expect(updates).toHaveLength(0); expect(calls).toHaveLength(1);
    expect(applied).toBe(0);
  });
});
