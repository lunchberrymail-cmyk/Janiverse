import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

export type ApiSettingsNavigation = {
  openInstructions?: () => void;
  openGeneration?: () => void;
  onApplied?: () => void;
};
type Profile = { id: string; name: string; provider: string; api_url: string; model: string; has_api_key: boolean; is_default: boolean };
type ProfileInput = { name: string; provider: string; api_url: string; model?: string; api_key?: string };
type NativeConnections = {
  list?: () => unknown | Promise<unknown>;
  getActive?: () => unknown;
  update?: (id: string, input: Partial<ProfileInput>) => Promise<unknown>;
  models?: (id: string) => Promise<unknown>;
  setActiveAcknowledged?: (id: string | null) => void | Promise<void>;
  setActive?: (id: string | null) => void | Promise<void>;
};
const providers = [
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'custom', label: 'Proxy / Custom', url: '' },
];
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag); result.className = className; result.textContent = text; return result;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function profile(value: unknown): Profile | null {
  const row = object(value);
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.provider !== 'string') return null;
  return { id: row.id, name: row.name, provider: row.provider, api_url: typeof row.api_url === 'string' ? row.api_url : '',
    model: typeof row.model === 'string' ? row.model : '', has_api_key: row.has_api_key === true, is_default: row.is_default === true };
}
function endpoint(value: string, providerId: string) {
  const candidate = value.trim() || providers.find(p => p.id === providerId)?.url || '';
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { throw new Error('Enter a valid API base URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error('Use an HTTP or HTTPS base URL without a login, query, or fragment.');
  }
  parsed.pathname = parsed.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

/** Owns the settings UI; saved profiles, credentials, and chat bindings belong to Lumiverse. */
export function createApiSettings(ctx: SpindleFrontendContext, navigation: ApiSettingsNavigation = {}) {
  let disposed = false;
  let sequence = 0;
  let active: { modal: SpindleModalHandle; abort: AbortController; closed: boolean } | undefined;
  const connections = ctx.connections as unknown as NativeConnections | undefined;

  function open() {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'API Settings', width: 700, maxHeight: 830 });
    const session = { modal, abort: new AbortController(), closed: false };
    active = session;
    const current = () => !disposed && !session.closed && active === session;
    const prefix = `jb-api-${++sequence}`;
    const chatId = ctx.getActiveChat()?.chatId ?? null;
    let rows: Profile[] = [], selected: Profile | undefined, providerId = 'openai';
    let boundId = '', boundModel = '', globalId = '', loaded = false, busy = false, hasGeneration = false;
    let savedFields = '';
    modal.root.classList.add('jb-settings', 'jb-api-settings');
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); key.value = ''; if (active === session) active = undefined; });
    const button = (text: string, action: () => void, className = 'jb-button') => {
      const result = node('button', className, text); result.type = 'button'; result.addEventListener('click', action); return result;
    };
    const tabs = node('div', 'jb-settings-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'API settings sections');
    const connectionTab = button('Connection', () => {}, 'jb-settings-tab'); connectionTab.setAttribute('role', 'tab'); connectionTab.setAttribute('aria-selected', 'true');
    connectionTab.id = `${prefix}-tab`; connectionTab.setAttribute('aria-controls', `${prefix}-panel`); tabs.append(connectionTab);
    const callbackTabs: HTMLButtonElement[] = [];
    for (const [label, callback] of [['Instructions', navigation.openInstructions], ['Generation', navigation.openGeneration]] as const) {
      if (!callback) continue;
      const tab = button(label, () => { modal.dismiss(); callback(); }, 'jb-settings-tab'); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1; callbackTabs.push(tab); tabs.append(tab);
    }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const available = [connectionTab, ...callbackTabs].filter(tab => !tab.disabled);
      const index = available.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + available.length) % available.length;
      event.preventDefault(); available[next]?.focus();
    });
    const panel = node('section', 'jb-settings-section'); panel.id = `${prefix}-panel`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', connectionTab.id);
    panel.append(node('h2', '', 'Choose your API'), node('p', 'jb-settings-help', 'Use a saved connection or add your provider below. Settings are saved in Lumiverse.'));
    const grid = node('div', 'jb-settings-grid');
    function field(label: string, control: HTMLElement, full = false) {
      const wrapper = node('label', `jb-settings-field${full ? ' jb-settings-field-full' : ''}`);
      control.setAttribute('aria-label', label);
      wrapper.append(node('span', 'jb-settings-label', label), control); grid.append(wrapper); return wrapper;
    }
    const saved = node('select', 'jb-settings-select'); saved.name = 'api-connection'; field('Saved connection', saved);
    const scope = node('select', 'jb-settings-select'); scope.name = 'api-scope';
    if (chatId) { const option = node('option', '', 'This chat'); option.value = 'chat'; scope.append(option); }
    const defaultScope = node('option', '', 'Default connection'); defaultScope.value = 'default'; scope.append(defaultScope); field('Apply to', scope);
    const scopeHelp = node('p', 'jb-settings-help'); scopeHelp.classList.add('jb-settings-field-full'); grid.append(scopeHelp);
    const providerPills = node('div', 'jb-provider-tabs'); providerPills.setAttribute('role', 'group'); providerPills.setAttribute('aria-label', 'API provider');
    const pills = providers.map(provider => {
      const pill = button(provider.label, () => {
        const oldProvider = providers.find(p => p.id === providerId);
        providerId = provider.id;
        if (!name.value.trim() || name.value === oldProvider?.label) name.value = provider.label;
        url.value = provider.url; key.value = ''; model.value = ''; modelOptions.replaceChildren(); renderProvider();
      }, 'jb-provider-pill');
      pill.setAttribute('aria-pressed', 'false'); providerPills.append(pill); return pill;
    });
    const providerNotice = node('p', 'jb-settings-help');
    const config = node('div', 'jb-settings-config'); config.append(providerPills, providerNotice);
    const name = node('input', 'jb-settings-input'); name.name = 'api-profile-name'; name.maxLength = 120; field('Connection name', name);
    const url = node('input', 'jb-settings-input'); url.name = 'api-base-url'; url.type = 'url'; url.autocomplete = 'off'; url.placeholder = 'https://your-provider.example/v1'; field('API base URL', url);
    const key = node('input', 'jb-settings-input'); key.name = 'api-key'; key.type = 'password'; key.autocomplete = 'new-password'; key.spellcheck = false; field('API key', key, true);
    const keyHelp = node('p', 'jb-settings-help'); keyHelp.classList.add('jb-settings-field-full'); grid.append(keyHelp);
    const model = node('input', 'jb-settings-input'); model.name = 'api-model'; model.placeholder = 'Enter a model ID'; model.autocomplete = 'off'; model.setAttribute('list', `${prefix}-models`);
    const modelOptions = node('datalist'); modelOptions.id = `${prefix}-models`; field('Model', model, true);
    const remoteActions = node('div', 'jb-settings-actions');
    const models = button('Load models', () => { void run(loadModels); });
    const test = button('Test connection', () => { void run(testConnection); }); remoteActions.append(models, test);
    const remoteHelp = node('p', 'jb-settings-help', 'Load models and Test connection contact your selected provider only when clicked. Testing uses the saved connection.');
    const access = node('div', 'jb-settings-section');
    access.append(node('p', 'jb-settings-help', 'Allow connection settings to save API configuration, choose connections, and contact providers when requested.'));
    const allow = button('Allow connection settings', () => { void run(requestPermission); }); access.append(allow);
    const status = node('p', 'jb-settings-status', 'Loading connections…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = node('div', 'jb-settings-actions');
    const cancel = button('Cancel', () => modal.dismiss());
    const apply = button('Save & Use', () => { void run(saveAndUse); }, 'jb-button jb-primary');
    const retry = button('Retry loading', () => { void initialize(); }); retry.hidden = true;
    actions.append(retry, cancel, apply);
    panel.append(config, grid, modelOptions, remoteActions, remoteHelp, access, status, actions); modal.root.append(tabs, panel);
    const editable = () => providers.some(p => p.id === providerId);
    const fieldsSignature = () => JSON.stringify([name.value, providerId, url.value, model.value, key.value]);
    function controls() {
      saved.disabled = scope.disabled = !loaded || busy;
      for (const control of [name, url, key]) control.disabled = !loaded || busy || !editable();
      model.disabled = !loaded || busy;
      // Keep a saved secret paired with its provider. Switching providers is a
      // new connection, rather than retargeting an existing credential.
      pills.forEach(pill => { pill.disabled = !loaded || busy || !!selected; });
      for (const tab of callbackTabs) tab.disabled = busy;
      allow.disabled = busy; access.hidden = hasGeneration;
      apply.disabled = !loaded || busy || !hasGeneration;
      apply.textContent = 'Save & Use';
      models.disabled = !loaded || busy || !hasGeneration;
      test.disabled = !loaded || busy || !hasGeneration || !selected;
      retry.disabled = busy;
    }
    function renderProvider() {
      pills.forEach((pill, index) => pill.setAttribute('aria-pressed', String(providers[index].id === providerId)));
      providerNotice.textContent = editable() ? 'OpenAI-compatible proxies use a base URL, not a chat/completions endpoint.' : `Saved provider: ${providerId}. Choose its model here. Its existing credentials and advanced provider configuration are preserved.`;
      key.placeholder = selected?.has_api_key ? 'Saved key — leave blank to keep it' : 'Enter an API key (optional for a custom proxy)';
      keyHelp.textContent = !editable() ? 'This provider’s saved credentials stay in Lumiverse. Changing its model does not change credentials or provider options.' : selected?.has_api_key ? 'A key is saved in Lumiverse. Blank keeps it unchanged; enter a replacement to update it.' : 'Your key is stored by Lumiverse and is never read back or displayed here.';
      controls();
    }
    function renderScope() {
      scopeHelp.textContent = scope.value === 'chat'
        ? 'Applies the selected connection and model to this chat. API keys, URLs, and connection names are shared profile settings.'
        : chatId ? 'Changes the native default. Chats with their own connection keep that override.' : 'Uses this connection as Lumiverse’s default for chats without an override.';
    }
    function selectProfile(id: string) {
      selected = rows.find(row => row.id === id); providerId = selected?.provider ?? 'openai';
      name.value = selected?.name ?? 'OpenAI';
      url.value = selected?.api_url || providers.find(p => p.id === providerId)?.url || '';
      key.value = '';
      model.value = scope.value === 'chat' && selected?.id === boundId && boundModel ? boundModel : selected?.model ?? '';
      modelOptions.replaceChildren(); saved.value = selected?.id ?? '';
      savedFields = fieldsSignature(); renderProvider(); renderScope(); status.textContent = '';
    }
    function savedOptions() {
      saved.replaceChildren();
      const add = node('option', '', '+ New connection'); add.value = ''; saved.append(add);
      for (const row of rows) { const option = node('option', '', `${row.name}${row.id === globalId ? ' · Default selected' : ''}`); option.value = row.id; saved.append(option); }
      saved.value = selected?.id ?? '';
    }
    saved.addEventListener('change', () => selectProfile(saved.value));
    scope.addEventListener('change', () => {
      const unchanged = fieldsSignature() === savedFields;
      model.value = scope.value === 'chat' && selected?.id === boundId && boundModel ? boundModel : selected?.model ?? '';
      if (unchanged) savedFields = fieldsSignature();
      renderScope();
    });
    async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
      const response = await fetch(`/api/v1${path}`, { ...options, credentials: 'same-origin', signal: session.abort.signal });
      if (!response.ok) throw new Error('Could not complete the request. Check your settings and try again.');
      return response.json() as Promise<T>;
    }
    async function permissions(needChat = false) {
      const granted = await ctx.permissions.getGranted();
      if (!current()) return false;
      hasGeneration = granted.includes('generation'); controls();
      if (!hasGeneration) { status.textContent = 'Allow connection settings before saving, switching, loading models, or testing.'; return false; }
      if (needChat && !granted.includes('chats')) { status.textContent = 'Enable Janiverse’s Chats permission to apply a connection to this chat.'; return false; }
      return true;
    }
    async function run(action: () => Promise<void>) {
      if (!current() || busy || !loaded) return;
      busy = true; controls();
      try { await action(); }
      catch (error) {
        if (current()) status.textContent = error instanceof Error && error.name === 'ApiSettingsInputError' ? error.message : 'Could not complete this action. Your settings are still here; check them and try again.';
      } finally { busy = false; if (current()) controls(); }
    }
    function inputError(message: string): never { const error = new Error(message); error.name = 'ApiSettingsInputError'; throw error; }
    function draft(requireModel = true): ProfileInput {
      if (!name.value.trim()) inputError('Enter a connection name.');
      if (requireModel && !model.value.trim()) inputError('Enter or choose a model ID.');
      let apiUrl: string;
      try { apiUrl = endpoint(url.value, providerId); } catch (error) { inputError((error as Error).message); }
      if (providerId !== 'custom' && !key.value.trim() && (!selected?.has_api_key || selected.provider !== providerId)) inputError('Enter an API key for this provider.');
      const input: ProfileInput = { name: name.value.trim(), provider: providerId, api_url: apiUrl, model: model.value.trim() };
      if (key.value.trim()) input.api_key = key.value.trim();
      return input;
    }
    async function requestPermission() {
      status.textContent = 'Waiting for permission approval…';
      await ctx.permissions.request(['generation'], { reason: 'Save native API profiles and credentials, choose connections, and load models or test a provider only when you click those actions.' });
      if (!current()) return;
      if (await permissions()) status.textContent = 'Connection settings enabled. Choose Save & Use when ready.';
    }
    async function loadModels() {
      if (!await permissions()) return;
      status.textContent = 'Loading available models…';
      let result: unknown;
      if (selected && (!editable() || fieldsSignature() === savedFields) && connections?.models) result = await connections.models(selected.id);
      else {
        if (!editable()) inputError('Select a supported provider to preview models.');
        const input = draft(false);
        result = await request('/connections/models/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: input.provider, api_url: input.api_url, ...(selected ? { connection_id: selected.id } : {}), ...(input.api_key ? { api_key: input.api_key } : {}) }) });
      }
      if (!current()) return;
      const data = object(result);
      if (data.error) inputError('Could not load models. Check the API URL and key, or enter a model ID manually.');
      const available = Array.isArray(data.models) ? data.models.filter((item): item is string => typeof item === 'string').slice(0, 2000) : [];
      modelOptions.replaceChildren(...available.map(id => { const option = node('option'); option.value = id; return option; }));
      status.textContent = available.length ? `${available.length} models loaded. Choose or type a model ID.` : 'No models returned. You can enter a model ID manually.';
    }
    async function testConnection() {
      if (!await permissions() || !selected) return;
      if (fieldsSignature() !== savedFields) inputError('Save your changes before testing. Test connection uses the saved profile.');
      status.textContent = 'Testing the saved connection…';
      const result = object(await request(`/connections/${encodeURIComponent(selected.id)}/test`, { method: 'POST' }));
      if (current()) status.textContent = result.success === true ? 'Connection test successful.' : 'Connection test failed. Check the provider, URL, and API key.';
    }
    async function waitForNativeProfile(id: string) {
      if (!connections?.list) return;
      const until = Date.now() + 2500;
      while (current()) {
        const value = await connections.list();
        if (Array.isArray(value) && value.some(row => object(row).id === id)) return;
        if (Date.now() >= until) inputError('Connection saved in Lumiverse. Reload the page to finish using this new connection.');
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); session.abort.signal.removeEventListener('abort', done); resolve(); };
          const timer = setTimeout(done, 50); session.abort.signal.addEventListener('abort', done, { once: true });
          if (session.abort.signal.aborted) done();
        });
      }
    }
    async function saveAndUse() {
      const useChat = scope.value === 'chat' && !!chatId;
      if (!await permissions(useChat)) return;
      let result = selected;
      const chosenModel = model.value.trim();
      if (!chosenModel) inputError('Enter or choose a model ID.');
      if (editable()) {
        const input = draft();
        if (selected && useChat) delete input.model;
        status.textContent = 'Saving connection in Lumiverse…';
        const value = selected
          ? connections?.update ? await connections.update(selected.id, input) : await request(`/connections/${encodeURIComponent(selected.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
          : await request('/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        if (!current()) return;
        result = profile(value) ?? undefined;
        if (!result) inputError('The connection could not be confirmed. Reopen API Settings before trying again.');
        const created = !selected;
        selected = result; rows = [result, ...rows.filter(row => row.id !== result!.id)];
        key.value = ''; url.value = result.api_url || input.api_url;
        savedOptions(); savedFields = fieldsSignature(); renderProvider();
        if (created) {
          // The native create route does not emit its profile-loaded event. A normal
          // same-name update publishes it, so native pickers learn about the new row.
          if (connections?.update) await connections.update(result.id, { name: result.name });
          else await request(`/connections/${encodeURIComponent(result.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: result.name }) });
          if (!current()) return;
          await waitForNativeProfile(result.id);
        }
      } else if (selected && !useChat && chosenModel !== selected.model) {
        // Native providers can have credential/metadata schemas that this editor
        // does not own. Change only their model and preserve every other field.
        status.textContent = 'Saving model in Lumiverse…';
        const input = { model: chosenModel };
        const value = connections?.update ? await connections.update(selected.id, input)
          : await request(`/connections/${encodeURIComponent(selected.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        if (!current()) return;
        result = profile(value) ?? undefined;
        if (!result) inputError('The connection could not be confirmed. Reopen API Settings before trying again.');
        selected = result;
        rows = [result, ...rows.filter(row => row.id !== result!.id)];
        savedOptions(); savedFields = fieldsSignature(); renderProvider();
      }
      if (!result || !current()) return;
      if (!await permissions(useChat)) return;
      if (useChat) {
        status.textContent = 'Applying connection to this chat…';
        await request(`/chats/${encodeURIComponent(chatId!)}/metadata`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connection_profile_id: result.id, connection_model: chosenModel && chosenModel !== result.model ? chosenModel : null }) });
      } else {
        const activate = connections?.setActiveAcknowledged ?? connections?.setActive;
        if (!activate) inputError('Connection saved. This Lumiverse version does not support selecting it from an extension.');
        await activate.call(connections, result.id);
        if (!current() || !await permissions()) return;
        // The current host's acknowledged helper updates native state but its
        // persistence is fire-and-forget. Await the same native setting write.
        await request('/settings/activeProfileId', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: result.id }) });
      }
      if (!current()) return;
      modal.dismiss(); navigation.onApplied?.();
    }
    async function initialize() {
      loaded = false; retry.hidden = true; controls(); status.textContent = 'Loading connections…';
      try {
        const [profilesValue, granted, chatValue] = await Promise.all([
          connections?.list ? connections.list() : request('/connections?limit=100&offset=0'),
          ctx.permissions.getGranted(),
          chatId ? request(`/chats/${encodeURIComponent(chatId)}?messages=false`) : Promise.resolve(null),
        ]);
        if (!current()) return;
        const list = Array.isArray(profilesValue) ? profilesValue : object(profilesValue).data;
        rows = Array.isArray(list) ? list.map(profile).filter((item): item is Profile => !!item) : [];
        hasGeneration = granted.includes('generation');
        const metadata = object(object(chatValue).metadata);
        boundId = typeof metadata.connection_profile_id === 'string' ? metadata.connection_profile_id : '';
        boundModel = typeof metadata.connection_model === 'string' ? metadata.connection_model : '';
        let activeValue: Record<string, unknown> = {};
        try { activeValue = object(connections?.getActive?.() ?? ctx.state?.get('connections.active')); } catch { /* Defaults remain selectable. */ }
        globalId = typeof activeValue.activeProfileId === 'string' ? activeValue.activeProfileId : '';
        selected = rows.find(row => row.id === boundId) ?? rows.find(row => row.id === globalId) ?? rows.find(row => row.is_default) ?? rows[0];
        loaded = true; savedOptions(); selectProfile(selected?.id ?? '');
      } catch { if (current()) { status.textContent = 'Could not load API settings. Try again.'; retry.hidden = false; } }
    }
    void initialize();
  }
  return { open, destroy() { disposed = true; active?.modal.dismiss(); active = undefined; } };
}
