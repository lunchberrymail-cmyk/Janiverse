import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createApiSettings, type ApiSettingsNavigation } from '../src/api-settings';

type Call = { url: string; options?: RequestInit };
type Profile = { id: string; name: string; provider: string; api_url: string; model: string; has_api_key: boolean; is_default: boolean; metadata: Record<string, unknown> };
const originalFetch = globalThis.fetch;
const originalObserver = globalThis.MutationObserver;
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
let navigation: ApiSettingsNavigation;
let catalog: Array<{ id: string; name: string; default_url: string; capabilities?: { apiKeyRequired: boolean } }>;

const root = () => roots.at(-1)!;
const control = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(name: string) => root().querySelector<T>(`[name="${name}"]`)!;
const button = (label: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!;
function choose(name: string, value: string) { const input = control(name); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:11113' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  roots = []; calls = []; updates = []; activeSwitches = []; modelLoads = []; applied = 0;
  granted = ['generation', 'chats'];
  currentChat = { chatId: 'chat/one', characterId: 'character' };
  metadata = { connection_profile_id: 'bound', connection_model: 'chat-model', authors_note: { content: 'Keep this' }, unrelated: 42 };
  profiles = [
    { id: 'primary', name: 'Main provider', provider: 'openai', api_url: 'https://api.openai.com/v1', model: 'global-model', has_api_key: true, is_default: true, metadata: { preserve: 'global' } },
    { id: 'bound', name: 'Chat provider', provider: 'openrouter', api_url: 'https://openrouter.ai/api/v1', model: 'profile-model', has_api_key: true, is_default: false, metadata: { reasoningBindings: { promptBias: 'Keep prefix' }, preserve: 'bound' } },
  ];
  catalog = [
    { id: 'openai', name: 'OpenAI', default_url: 'https://api.openai.com/v1' },
    { id: 'openrouter', name: 'OpenRouter', default_url: 'https://openrouter.ai/api/v1' },
    { id: 'nanogpt', name: 'NanoGPT', default_url: 'https://nano-gpt.com/api/v1' },
    { id: 'anthropic', name: 'Anthropic', default_url: 'https://api.anthropic.com' },
    { id: 'google', name: 'Google Gemini', default_url: 'https://generativelanguage.googleapis.com' },
    { id: 'pollinations_text', name: 'Pollinations (Text)', default_url: 'https://text.pollinations.ai/openai', capabilities: { apiKeyRequired: false } },
    { id: 'custom', name: 'Custom (OpenAI-compatible)', default_url: '', capabilities: { apiKeyRequired: false } },
    { id: 'google_vertex', name: 'Google Vertex AI', default_url: 'https://aiplatform.googleapis.com' },
    { id: 'bedrock', name: 'Amazon Bedrock', default_url: 'https://bedrock-mantle.us-east-1.api.aws/v1' },
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
    if (url === '/api/v1/providers') return json({ providers: catalog });
    if (options?.method === 'PATCH') {
      Object.assign(metadata, JSON.parse(String(options.body)));
      return json({ metadata });
    }
    if (url.startsWith('/api/v1/settings/')) return json({});
    if (url.startsWith('/api/v1/chats/')) return json({ id: currentChat?.chatId, metadata });
    throw new Error(`Unexpected fetch ${options?.method ?? 'GET'} ${url}`);
  };
  globalThis.fetch = (async (url, options) => { calls.push({ url: String(url), options }); return respond(String(url), options); }) as typeof fetch;
  navigation = { onApplied: () => { applied++; } };
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
  } as any, navigation);
});
afterEach(() => { api.destroy(); globalThis.fetch = originalFetch; globalThis.MutationObserver = originalObserver; dom.window.close(); });

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

  test('new configurations use the native provider catalog and its current base URLs', async () => {
    catalog.find(provider => provider.id === 'nanogpt')!.default_url = 'https://native-nano.example/api/v2';
    catalog.push({ id: 'chutes', name: 'Chutes', default_url: 'https://llm.chutes.ai/v1' });
    api.open(); await settle(); button('+ New').click();
    const providers = control<HTMLSelectElement>('api-provider');
    expect([...providers.options].map(option => option.textContent)).toContain('NanoGPT');
    expect([...providers.options].map(option => option.textContent)).toContain('Chutes');
    expect(root().querySelector('.jb-api-provider-card')!.contains(providers)).toBe(true);
    expect(root().querySelector('.jb-api-config-card')!.contains(control('api-connection'))).toBe(true);
    choose('api-provider', 'nanogpt');
    expect(control('api-base-url').value).toBe('https://native-nano.example/api/v2');
    expect(control('api-profile-name').value).toBe('NanoGPT');
    choose('api-provider', 'anthropic'); expect(control('api-base-url').value).toBe('https://api.anthropic.com');
    choose('api-provider', 'google'); expect(control('api-base-url').value).toBe('https://generativelanguage.googleapis.com');
    expect(calls.every(call => !call.options?.method)).toBe(true);
    expect(updates).toHaveLength(0); expect(modelLoads).toHaveLength(0);
  });

  test('NanoGPT previews use its native provider and only run when Load models is clicked', async () => {
    const previousRespond = respond;
    respond = async (url, options) => url === '/api/v1/connections/models/preview' ? json({ models: ['native-nano-model'] }) : previousRespond(url, options);
    api.open(); await settle(); choose('api-connection', ''); choose('api-provider', 'nanogpt');
    control('api-key').value = 'synthetic-nano-key';
    expect(calls.every(call => !call.options?.method)).toBe(true);
    button('Load models').click(); await settle();
    const preview = calls.find(call => call.url.endsWith('/models/preview'))!;
    expect(preview.options?.method).toBe('POST');
    expect(JSON.parse(String(preview.options?.body))).toEqual({ provider: 'nanogpt', api_url: 'https://nano-gpt.com/api/v1', api_key: 'synthetic-nano-key' });
    expect(root().querySelector('datalist option')?.getAttribute('value')).toBe('native-nano-model');
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0);
  });

  test('NanoGPT retains native subscription, caching, routing and saved credentials on chat apply', async () => {
    profiles[1].provider = 'nanogpt'; profiles[1].api_url = '';
    profiles[1].metadata = { use_subscription_api: true, nanogpt: { model_overrides: { 'profile-model': { only: ['saved-provider'] } } }, nanogpt_caching: { enabled: true }, reasoningBindings: { promptBias: 'keep' } };
    const original = structuredClone(profiles[1].metadata);
    api.open(); await settle();
    expect(control('api-key').disabled).toBe(false);
    control('api-model').value = 'nano-chat-model'; button('Save & Use').click(); await settle();
    expect(updates[0].input.provider).toBe('nanogpt');
    expect(updates[0].input).not.toHaveProperty('api_key'); expect(updates[0].input).not.toHaveProperty('metadata'); expect(updates[0].input).not.toHaveProperty('model');
    expect(profiles[1].metadata).toEqual(original); expect(profiles[1].has_api_key).toBe(true);
    expect(metadata.connection_model).toBe('nano-chat-model'); expect(modelLoads).toHaveLength(0);
  });

  test('native key requirements allow a keyless provider to create a normal saved configuration', async () => {
    let created: Record<string, unknown> | undefined;
    const previousRespond = respond;
    respond = async (url, options) => {
      if (url === '/api/v1/connections' && options?.method === 'POST') {
        created = JSON.parse(String(options.body));
        const saved = { id: 'keyless', ...created, has_api_key: false, is_default: false, metadata: {} } as Profile;
        profiles.push(saved); return json(saved);
      }
      return previousRespond(url, options);
    };
    api.open(); await settle(); choose('api-connection', ''); choose('api-provider', 'pollinations_text');
    control('api-model').value = 'keyless-model'; button('Save & Use').click(); await settle();
    expect(created).toEqual({ name: 'Pollinations (Text)', provider: 'pollinations_text', api_url: 'https://text.pollinations.ai/openai', model: 'keyless-model' });
    expect(metadata.connection_profile_id).toBe('keyless'); expect(applied).toBe(1);
  });

  test('regional providers use native advanced setup rather than creating incomplete credentials', async () => {
    let nativeOpened = 0; navigation.openNativeConnections = () => { nativeOpened++; };
    api.open(); await settle(); choose('api-connection', ''); choose('api-provider', 'google_vertex');
    expect(button('Save & Use').disabled).toBe(true); expect(button('Load models').disabled).toBe(true);
    expect(control('api-key').disabled).toBe(true); expect(control('api-base-url').disabled).toBe(true);
    expect(root().textContent).toContain('Set up Google Vertex AI in Advanced provider settings');
    expect(calls.every(call => !call.options?.method)).toBe(true);
    button('Advanced provider settings').click();
    expect(nativeOpened).toBe(1); expect(root().isConnected).toBe(false); expect(updates).toHaveLength(0);
  });

  test('catalog failure keeps basic providers usable without blocking saved configurations', async () => {
    const previousRespond = respond;
    respond = async (url, options) => url === '/api/v1/providers' ? json({}, 404) : previousRespond(url, options);
    api.open(); await settle(); expect(control('api-connection').value).toBe('bound');
    button('+ New').click(); choose('api-provider', 'nanogpt');
    expect(control('api-base-url').value).toBe('https://nano-gpt.com/api/v1');
    expect(control('api-provider').disabled).toBe(false); expect(button('Save & Use').disabled).toBe(false);
    expect(root().textContent).not.toContain('Could not load API settings');
  });

  test('combined settings retain preference drafts after applying a configuration and clean up on close', async () => {
    let destroyed = 0;
    navigation.mountPreferences = target => {
      const draft = document.createElement('textarea'); draft.value = 'Unsaved writing instructions'; target.append(draft);
      return { destroy() { destroyed++; } };
    };
    api.open(); await settle(); const preferences = root().querySelector<HTMLElement>('.jb-settings-preferences')!;
    const textarea = preferences.querySelector('textarea')!;
    button('Save & Use').click(); await settle();
    expect(root().isConnected).toBe(true); expect(textarea.isConnected).toBe(true); expect(textarea.value).toBe('Unsaved writing instructions');
    expect(root().textContent).toContain('Configuration saved and selected.'); expect(destroyed).toBe(0); expect(applied).toBe(1);
    button('Cancel').click(); expect(destroyed).toBe(1); expect(root().isConnected).toBe(false);
  });

  test('combined API and preferences prevent overlapping saves while either operation is busy', async () => {
    let preferenceEditor: HTMLElement;
    navigation.mountPreferences = target => { preferenceEditor = document.createElement('div'); target.append(preferenceEditor); return { destroy() {} }; };
    api.open(); await settle();
    preferenceEditor!.setAttribute('aria-busy', 'true'); await settle();
    expect(button('Save & Use').disabled).toBe(true); expect(button('+ New').disabled).toBe(true);
    button('Save & Use').click(); expect(updates).toHaveLength(0);
    preferenceEditor!.setAttribute('aria-busy', 'false'); await settle(); expect(button('Save & Use').disabled).toBe(false);
    let finish: (value: unknown) => void = () => {}; update = () => new Promise(resolve => { finish = resolve; });
    button('Save & Use').click(); await settle();
    expect(root().querySelector<HTMLElement>('.jb-settings-preferences')!.inert).toBe(true);
    finish(structuredClone(profiles[1])); await settle();
    expect(root().querySelector<HTMLElement>('.jb-settings-preferences')!.inert).toBe(false);
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
    expect(calls.map(call => call.url)).toEqual(['/api/v1/chats/chat%2Fone?messages=false', '/api/v1/providers']);
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0); expect(modelLoads).toHaveLength(0);
  });

  test('a saved API opens connection details and tools by default without contacting its provider', async () => {
    api.open(); await settle();
    const details = root().querySelector<HTMLDetailsElement>('.jb-settings-connection-details')!;
    const help = root().querySelector<HTMLDetailsElement>('.jb-settings-connection-help')!;
    expect(details.open).toBe(true); expect(help.open).toBe(true);
    expect(details.contains(control('api-model'))).toBe(false);
    expect(details.contains(control('api-connection'))).toBe(false);
    expect(details.contains(control('api-scope'))).toBe(false);
    expect(details.contains(control('api-key'))).toBe(false);
    expect(control('api-provider').disabled).toBe(false);
    expect(root().querySelector('.jb-settings-connection-summary')!.textContent).toBe('OpenRouter · Saved credentials');
    expect(help.contains(button('Test connection'))).toBe(true);
    expect(help.contains(button('Load models'))).toBe(false);
    details.open = false; help.open = false; await settle();
    expect(calls.map(call => call.url)).toEqual(['/api/v1/chats/chat%2Fone?messages=false', '/api/v1/providers']);
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0); expect(modelLoads).toHaveLength(0);
  });

  test('new connections expose provider setup and invalid hidden connection fields reopen before saving', async () => {
    api.open(); await settle(); choose('api-connection', '');
    const details = root().querySelector<HTMLDetailsElement>('.jb-settings-connection-details')!;
    expect(details.open).toBe(true);
    expect(control('api-provider').disabled).toBe(false);
    choose('api-provider', 'custom');
    control('api-base-url').value = 'not a URL';
    control('api-model').value = 'test-model';
    details.open = false;
    button('Save & Use').click(); await settle();
    expect(details.open).toBe(true);
    expect(root().textContent).toContain('Enter a valid API base URL.');
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0);
    expect(calls.every(call => !call.options?.method)).toBe(true);
  });

  test('scope and key hints describe the draft without displaying secrets or changing saved settings', async () => {
    api.open(); await settle();
    expect(root().textContent).toContain('Use this API and model for this chat.');
    choose('api-scope', 'default');
    expect(root().textContent).toContain('Use this API by default for chats without an override.');
    control('api-key').value = 'synthetic-replacement-key';
    control('api-key').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(root().querySelector('.jb-settings-connection-summary')!.textContent).toBe('OpenRouter · Key entered');
    expect(root().textContent).not.toContain('synthetic-replacement-key');
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0); expect(modelLoads).toHaveLength(0);
    expect(calls.every(call => !call.options?.method)).toBe(true);
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

  test('changing a saved provider starts a clean new configuration and leaves the original untouched', async () => {
    const original = structuredClone(profiles);
    let created: Record<string, unknown> | undefined;
    const previousRespond = respond;
    respond = async (url, options) => {
      if (url === '/api/v1/connections' && options?.method === 'POST') {
        created = JSON.parse(String(options.body));
        const saved = { id: 'new-nano', ...created, has_api_key: true, is_default: false, metadata: {} } as Profile;
        profiles.push(saved); return json(saved);
      }
      return previousRespond(url, options);
    };
    api.open(); await settle();
    expect(control('api-provider').disabled).toBe(false);
    expect(control('api-provider').value).toBe('openrouter');
    control('api-profile-name').value = 'Unsaved old name'; control('api-key').value = 'unsaved-old-key';
    choose('api-provider', 'nanogpt');
    expect(control('api-provider').value).toBe('nanogpt');
    expect(control('api-connection').value).toBe('');
    expect(control('api-profile-name').value).toBe('NanoGPT');
    expect(control('api-base-url').value).toBe('https://nano-gpt.com/api/v1');
    expect(control('api-key').value).toBe(''); expect(control('api-model').value).toBe('');
    expect(control('api-key').placeholder).toBe('Enter your API key');
    expect(root().querySelector<HTMLDetailsElement>('.jb-settings-connection-details')!.open).toBe(true);
    expect(button('Test connection').disabled).toBe(true);
    expect(profiles).toEqual(original); expect(updates).toHaveLength(0); expect(calls).toHaveLength(2);
    control('api-model').value = 'new-nano-model'; button('Save & Use').click(); await settle();
    expect(created).toBeUndefined(); expect(updates).toHaveLength(0);
    control('api-key').value = 'new-nano-key'; button('Save & Use').click(); await settle();
    expect(created).toEqual({ name: 'NanoGPT', provider: 'nanogpt', api_url: 'https://nano-gpt.com/api/v1', model: 'new-nano-model', api_key: 'new-nano-key' });
    expect(profiles.slice(0, 2)).toEqual(original);
    expect(updates).toEqual([{ id: 'new-nano', input: { name: 'NanoGPT' } }]);
    expect(metadata.connection_profile_id).toBe('new-nano');
  });

  test('switching a saved regional provider also starts a draft and advanced choices cannot save incomplete setup', async () => {
    profiles[1].provider = 'google_vertex';
    const original = structuredClone(profiles[1]);
    api.open(); await settle();
    expect(control('api-provider').disabled).toBe(false);
    choose('api-provider', 'openrouter');
    expect(control('api-connection').value).toBe(''); expect(control('api-profile-name').value).toBe('OpenRouter');
    expect(control('api-model').value).toBe(''); expect(control('api-key').value).toBe('');
    choose('api-provider', 'bedrock');
    expect(control('api-connection').value).toBe(''); expect(control('api-profile-name').value).toBe('Amazon Bedrock');
    expect(button('Save & Use').disabled).toBe(true); expect(button('Load models').disabled).toBe(true);
    expect(control('api-key').disabled).toBe(true); expect(profiles[1]).toEqual(original);
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(2);
  });

  test('revoked generation or chats permissions prevent every save write', async () => {
    api.open(); await settle();
    granted = ['chats']; button('Save & Use').click(); await settle();
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(2);
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
    expect(updates).toHaveLength(0); expect(calls).toHaveLength(2);
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
    expect(calls).toHaveLength(2); expect(applied).toBe(0);
  });

  test('the shared window can detect pending API work until its result finishes', async () => {
    api.open(); await settle();
    let finishUpdate: (value: unknown) => void = () => {};
    update = () => new Promise(resolve => { finishUpdate = resolve; });
    button('Save & Use').click(); await settle();
    expect(root().getAttribute('aria-busy')).toBe('true');
    expect(button('Save & Use').disabled).toBe(true);
    finishUpdate(undefined); await settle();
    expect(root().getAttribute('aria-busy')).toBe('false');
    expect(root().isConnected).toBe(true);
    expect(updates).toHaveLength(0); expect(activeSwitches).toHaveLength(0);
  });

  test('destroy during permission resolution prevents the pending write and clears a typed key', async () => {
    api.open(); await settle(); control('api-key').value = 'typed-secret';
    let grant: (permissions: string[]) => void = () => {};
    getGranted = () => new Promise(resolve => { grant = resolve; });
    const key = control('api-key'); button('Save & Use').click(); api.destroy();
    grant(['generation', 'chats']); await settle();
    expect(key.value).toBe(''); expect(updates).toHaveLength(0); expect(calls).toHaveLength(2);
    expect(applied).toBe(0);
  });
});

test('changing scope preserves a new connection model draft', async () => {
  api.open(); await settle(); choose('api-connection','');
  control('api-model').value = 'my-typed-model';
  choose('api-scope','default');
  expect(control('api-model').value).toBe('my-typed-model');
});
test('changing scope preserves a saved connection model draft', async () => {
  api.open(); await settle();
  control('api-model').value = 'my-typed-model'; choose('api-scope','default');
  expect(control('api-model').value).toBe('my-typed-model');
});
test('failed chat reads leave the default-scope connection editor usable', async () => {
  const originalRespond = respond;
  respond = async (url, options) => url.startsWith('/api/v1/chats/') ? json({},404) : originalRespond(url,options);
  api.open(); await settle();
  expect(button('Save & Use').disabled).toBe(false);
  expect(control('api-scope').disabled).toBe(false);
  expect(control('api-scope').value).toBe('default');
  expect(root().textContent).toContain('This chat could not be loaded');
});
test('Generation-only grant leaves Chats permission recovery visible', async () => {
  granted = ['generation']; api.open(); await settle();
  expect(button('Save & Use').disabled).toBe(false);
  const permissionButton = [...root().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('Allow'))!;
  expect(permissionButton.closest('[hidden]')).toBeNull();
  button('Save & Use').click(); await settle();
  expect(root().textContent).toContain('Enable Janiverse’s Chats permission');
});
