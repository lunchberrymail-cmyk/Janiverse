import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { createNativePresetResolution, type Binding, type Scope } from './native-preset-scope';

type Json = Record<string, unknown>;
type Preset = { id: string; name: string; provider: string; engine: string; parameters: Json; prompts: Json; metadata: Json; prompt_order: Json[]; cache_revision: number };
type Loaded = { scope: Scope; preset: Preset; binding: Binding | null; blockId: string | null; sourceId: string | null };
const owner = 'janitor_bridge';
const markerKey = '_janitor_bridge';
const samplerFields = [
  { key: 'temperature', title: 'Temperature', min: 0, max: 2, step: .01, hint: 'Blank uses 1.0. Native value 0 leaves temperature out of the request.' },
  { key: 'maxTokens', title: 'Max new tokens', min: 1, max: 128000, step: 1, hint: 'Maximum response length. Blank uses the native 16,384 token default.' },
  { key: 'contextSize', title: 'Context size', min: 1024, max: 2097152, step: 1, hint: 'Total prompt budget, including the conversation. Blank uses the model’s context.' },
  { key: 'topP', title: 'Top P', min: 0, max: 1, step: .01, hint: 'Blank or 0 omits Top P. Some providers reject it together with temperature.' },
  { key: 'topK', title: 'Top K', min: 0, max: 500, step: 1, hint: 'Blank omits Top K; 0 explicitly sends 0.' },
  { key: 'repetitionPenalty', title: 'Repetition penalty', min: 0, max: 2, step: .01, hint: 'Provider dependent. Blank or 0 leaves it out of the request.' },
  { key: 'frequencyPenalty', title: 'Frequency penalty', min: 0, max: 2, step: .01, hint: 'Provider dependent. Blank or 0 leaves it out of the request.' },
] as const;
function rec(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function copy<T>(value: T): T { return structuredClone(value); }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}
function string(value: unknown) { return typeof value === 'string' && value.trim() ? value : null; }
function block(name: string, marker: string | null = null): Json {
  return { id: crypto.randomUUID(), name, content: '', role: 'system', enabled: true, position: 'pre_history', depth: 0, marker, isLocked: !!marker, color: null, injectionTrigger: [], characterTagTrigger: [], group: null, categoryMode: null };
}
function newPreset(): Preset {
  return {
    id: '', name: 'Janiverse', provider: 'loom', engine: 'classic', cache_revision: 0,
    parameters: { samplerOverrides: { enabled: true, maxTokens: null, contextSize: null, temperature: null, topP: null, minP: null, topK: null, frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null, streaming: true }, customBody: { enabled: false, rawJson: '{}' } },
    prompts: { completionSettings: { assistantPrefill: '', reasoningPrefill: '', assistantImpersonation: '', continuePrefill: false, continuePostfix: ' ', namesBehavior: 0, squashSystemMessages: false, useSystemPrompt: true, enableWebSearch: false, sendInlineMedia: true, enableFunctionCalling: true, includeUsage: false }, advancedSettings: { seed: -1, customStopStrings: [], collapseMessages: false, trimIncompleteWords: false } },
    metadata: { source: null, isDefault: false, schemaVersion: 1, modelProfiles: {}, lastProfileKey: null, promptVariables: {} },
    prompt_order: [block('System Prompt'), { ...block('Character System Prompt'), content: '{{system}}', isLocked: true }, block('World Info (Before)', 'world_info_before'), block('Character Description', 'char_description'), block('Character Personality', 'char_personality'), block('Scenario', 'scenario'), block('Your Persona', 'persona_description'), block('World Info (After)', 'world_info_after'), block('Example Messages', 'dialogue_examples'), block('Chat History', 'chat_history')],
  };
}
function editablePrompt(preset: Preset): string | null {
  const ownedId = string(rec(preset.metadata[markerKey]).blockId);
  if (ownedId && preset.prompt_order.some(b => b.id === ownedId && !b.sealed)) return ownedId;
  if (preset.prompt_order.some(b => b.marker === 'category')) return null;
  const candidates = preset.prompt_order.filter(b => b.enabled !== false && !b.sealed && !b.isLocked && !b.marker && b.role === 'system' && b.position === 'pre_history' && !(Array.isArray(b.variables) && b.variables.length) && !(Array.isArray(b.injectionTrigger) && b.injectionTrigger.length) && !(Array.isArray(b.characterTagTrigger) && b.characterTagTrigger.length));
  return candidates.length === 1 ? string(candidates[0].id) : null;
}

/** A small editor for real native Loom presets and native scope bindings. */
export function createPromptSettings(ctx: SpindleFrontendContext, options: { openConnection?: () => void } = {}) {
  let disposed = false;
  let active: { modal: SpindleModalHandle; abort: AbortController; closed: boolean } | undefined;
  let ids = 0;
  function open(initial: 'prompt' | 'generation' = 'prompt') {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'API Settings', width: 720, maxHeight: 880 });
    const session = { modal, abort: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && active === session && !session.closed;
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); if (active === session) active = undefined; });
    modal.root.classList.add('jb-settings');
    const suffix = `jb-prompt-${++ids}`;
    let loaded: Loaded | undefined, saving = false, selected = initial;
    let promptDirty = false, prefillDirty = false, samplersDirty = false;
    const heading = node('h2', '', 'Instructions');
    const intro = node('p', 'jb-settings-intro', 'Set how your character responds.');
    const tabs = node('div', 'jb-settings-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'API Settings');
    const promptPanel = node('div', 'jb-settings-panel'); const generationPanel = node('div', 'jb-settings-panel');
    promptPanel.id = `${suffix}-prompt`; generationPanel.id = `${suffix}-generation`;
    const tabButtons: Array<{ button: HTMLButtonElement; tab: 'prompt' | 'generation' }> = [];
    const button = (label: string, fn: () => void, cls = 'jb-button') => { const result = node('button', cls, label); result.type = 'button'; result.addEventListener('click', fn); return result; };
    if (options.openConnection) tabs.append(button('Connection', () => { modal.dismiss(); options.openConnection?.(); }, 'jb-settings-tab'));
    for (const [label, tab] of [['Instructions', 'prompt'], ['Generation', 'generation']] as const) {
      const item = button(label, () => show(tab), 'jb-settings-tab'); item.setAttribute('role', 'tab'); item.id = `${suffix}-tab-${tab}`; item.setAttribute('aria-controls', `${suffix}-${tab}`); tabButtons.push({ button: item, tab }); tabs.append(item);
    }
    function show(tab: 'prompt' | 'generation') {
      selected = tab; promptPanel.hidden = tab !== 'prompt'; generationPanel.hidden = tab !== 'generation';
      heading.textContent = tab === 'prompt' ? 'Instructions' : 'Generation settings';
      intro.textContent = tab === 'prompt' ? 'Set how your character responds.' : 'Adjust reply length and creativity.';
      for (const item of tabButtons) { item.button.setAttribute('aria-selected', String(item.tab === tab)); item.button.tabIndex = item.tab === tab ? 0 : -1; }
    }
    for (const [panel, tab] of [[promptPanel, 'prompt'], [generationPanel, 'generation']] as const) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${suffix}-tab-${tab}`); }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const index = tabButtons.findIndex(t => t.button === document.activeElement); if (index < 0) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
      show(tabButtons[next].tab); tabButtons[next].button.focus();
    });
    const scopeInfo = node('p', 'jb-settings-config', 'Loading saved settings…');
    function field(title: string, control: HTMLInputElement | HTMLTextAreaElement, hint: string) {
      const label = node('label', 'jb-settings-field'); const text = node('span', 'jb-settings-label', title); const help = node('small', 'jb-settings-help', hint);
      control.id = `${suffix}-${control.name}`; help.id = `${control.id}-help`; control.setAttribute('aria-describedby', help.id); label.htmlFor = control.id; label.append(text, control, help); return label;
    }
    const prompt = node('textarea', 'jb-settings-textarea jb-settings-prompt'); prompt.name = 'global-prompt'; prompt.rows = 9; prompt.placeholder = 'How should the character write and behave?';
    const promptHelp = 'Instructions that guide your character’s writing and behavior. Your character details and conversation are already included.';
    const prefill = node('textarea', 'jb-settings-textarea jb-settings-prefill'); prefill.name = 'assistant-prefill'; prefill.rows = 3; prefill.placeholder = 'Optional beginning of the assistant’s reply';
    prompt.addEventListener('input', () => { promptDirty = true; }); prefill.addEventListener('input', () => { prefillDirty = true; });
    promptPanel.append(field('Global prompt', prompt, promptHelp), field('Assistant prefill', prefill, 'Optional text to begin each reply.'));
    const nativeInfo = node('p', 'jb-settings-help', 'Your character, persona, and chat memory stay included.'); promptPanel.append(nativeInfo);
    const rawLabel = node('label', 'jb-settings-checkbox'); const raw = node('input'); raw.type = 'checkbox'; raw.name = 'enable-chat-preset'; rawLabel.append(raw, node('span', '', 'Use a native preset for this raw test chat')); rawLabel.hidden = true;
    promptPanel.append(rawLabel);
    const enabledLabel = node('label', 'jb-settings-checkbox'); const enabled = node('input'); enabled.type = 'checkbox'; enabled.name = 'sampler-overrides'; enabled.addEventListener('change', () => { samplersDirty = true; }); enabledLabel.append(enabled, node('span', '', 'Use these generation controls')); generationPanel.append(enabledLabel);
    const grid = node('div', 'jb-settings-grid'); const inputs = new Map<string, HTMLInputElement>();
    const advancedGeneration = node('details', 'jb-settings-advanced jb-settings-generation-advanced');
    const advancedGrid = node('div', 'jb-settings-grid');
    advancedGeneration.append(node('summary', '', 'Advanced generation controls'), advancedGrid);
    const basicHints: Record<string, string> = { temperature: 'Lower is steadier; higher adds variety.', maxTokens: 'How long a reply can be.', contextSize: 'How much conversation the model can use.' };
    for (const item of samplerFields) {
      const input = node('input', 'jb-settings-input'); input.type = 'number'; input.name = item.key; input.min = String(item.min); input.max = String(item.max); input.step = String(item.step); input.placeholder = 'Default'; input.title = item.hint; input.addEventListener('input', () => { samplersDirty = true; input.removeAttribute('aria-invalid'); }); inputs.set(item.key, input);
      (basicHints[item.key] ? grid : advancedGrid).append(field(item.title, input, basicHints[item.key] || item.hint));
    }
    advancedGeneration.append(node('p', 'jb-settings-help', 'Blank temperature uses 1.0; 0 omits it from the request. Blank max new tokens uses 16,384. Blank context size uses the model’s context. Providers support different controls. Existing advanced options, model profiles, and custom request body remain intact; a custom body can override these values.'));
    generationPanel.append(grid, advancedGeneration);
    const advanced = node('details', 'jb-settings-advanced');
    const presetInfo = node('p', 'jb-settings-help');
    advanced.append(node('summary', '', 'Advanced'), presetInfo, node('p', 'jb-settings-help', 'The first save makes a separate native Loom preset, leaving the source intact. Later saves edit that copy. Existing prompt blocks, model profiles, and custom request body are preserved. This chat uses a chat binding; an API configuration uses a connection binding. Chat, persona, and character bindings take priority over an API configuration. No universal default is replaced. If no preset was selected, this API configuration receives the new preset as its fallback.'), node('p', 'jb-settings-help', 'Assistant prefill follows your connection’s existing reply prefix. Continue uses the message being continued instead.'));
    const status = node('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const requestButton = button('Enable permissions', () => { void enablePermissions(); }); requestButton.hidden = true;
    const reloadButton = button('Reload saved settings', () => { void load(); }, 'jb-settings-cancel');
    const cancel = button('Close', () => modal.dismiss(), 'jb-settings-cancel'); const save = button('Save settings', () => { void saveSettings(); }, 'jb-settings-save');
    const actions = node('div', 'jb-settings-actions'); actions.append(requestButton, reloadButton, cancel, save);
    modal.root.append(tabs, heading, intro, scopeInfo, promptPanel, generationPanel, advanced, status, actions); show(selected);
    const editable = [prompt, prefill, enabled, raw, ...inputs.values()];
    function lock(value: boolean) { editable.forEach(input => input.disabled = value); save.disabled = value; reloadButton.disabled = saving; }
    function message(text: string, tone = '') { status.textContent = text; status.dataset.tone = tone; }
    function requiredPermissions() { return loaded?.scope.kind === 'chat' || (!!ctx.getActiveChat().chatId && location.pathname.startsWith('/chat/')) ? ['presets', 'chats', 'generation'] : ['presets', 'generation']; }
    async function permissions() {
      const granted = await ctx.permissions.getGranted(); if (!current()) return false;
      const missing = requiredPermissions().filter(permission => !granted.includes(permission));
      requestButton.hidden = !missing.length;
      if (missing.length) { message(`Enable ${missing.join(' and ')} permission to read and save these native settings.`, 'warning'); return false; }
      return true;
    }
    async function enablePermissions() {
      requestButton.disabled = true;
      try { await ctx.permissions.request(requiredPermissions(), { reason: 'Read and save your native prompt preset and its chat or API configuration binding.' }); if (current()) await load(); }
      catch { if (current()) message('Permission was not enabled. Your existing native settings are unchanged.', 'warning'); }
      finally { if (current()) requestButton.disabled = false; }
    }
    async function api<T>(path: string, method = 'GET', body?: unknown, optional = false): Promise<T | null> {
      if (!current()) throw new DOMException('Closed', 'AbortError');
      if (method !== 'GET' && !await permissions()) throw new Error('permission');
      if (!current()) throw new DOMException('Closed', 'AbortError');
      const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: session.abort.signal, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (optional && response.status === 404) return null;
      if (!response.ok) { const error = new Error(response.status === 409 ? 'conflict' : `request-${response.status}`); throw error; }
      return await response.json() as T;
    }
    const { getScope, effective } = createNativePresetResolution(ctx, api);
    async function load() {
      lock(true); loaded = undefined; message('');
      try {
        if (!await permissions()) return;
        const scope = await getScope(); const resolved = scope.raw ? { preset_id: null, binding: null } : await effective(scope);
        let preset = resolved.preset_id ? await api<Preset>(`/presets/${encodeURIComponent(resolved.preset_id)}`) : newPreset();
        if (!current() || !preset) return;
        if (!Array.isArray(preset.prompt_order) || !preset.parameters || !preset.prompts || !preset.metadata) throw new Error('invalid-preset');
        // An empty hierarchy uses legacy/raw assembly. Adding just one text block
        // would drop that fallback's history; convert the copy to a complete native layout.
        if (!preset.prompt_order.length) preset = { ...preset, prompt_order: newPreset().prompt_order };
        const projection = { ...preset, prompt_order: preset.prompt_order.map(b => ({ ...b, ...(Object.hasOwn(resolved.binding?.block_states ?? {}, String(b.id)) ? { enabled: resolved.binding!.block_states[String(b.id)] } : {}) })) };
        loaded = { scope, preset, binding: resolved.binding, blockId: editablePrompt(projection), sourceId: resolved.preset_id };
        const target = preset.prompt_order.find(b => b.id === loaded?.blockId); prompt.value = typeof target?.content === 'string' ? target.content : '';
        prefill.value = typeof rec(preset.prompts.completionSettings).assistantPrefill === 'string' ? String(rec(preset.prompts.completionSettings).assistantPrefill) : '';
        const sampler = rec(preset.parameters.samplerOverrides); enabled.checked = sampler.enabled === true;
        for (const item of samplerFields) { const input = inputs.get(item.key)!; input.value = typeof sampler[item.key] === 'number' ? String(sampler[item.key]) : ''; }
        scopeInfo.textContent = `Applies to: ${scope.label}`; presetInfo.textContent = `Native preset: ${preset.id ? preset.name : 'Created on first save'}`;
        rawLabel.hidden = !scope.raw; raw.checked = false; promptDirty = prefillDirty = samplersDirty = false; lock(false);
        if (scope.raw) message('This temporary test chat bypasses presets. Tick “Use a native preset” to apply these settings.', 'warning');
        else if (!loaded.blockId) message('Additional instructions. Your existing instructions are kept.');
      } catch (error) {
        if (current()) message((error as Error).message === 'no-connection' ? 'Add or select an API configuration in the Connection tab first.' : 'Could not load native settings. Try reloading saved settings.', 'error');
      }
    }
    async function saveSettings() {
      if (!loaded || saving) return;
      if (loaded.scope.raw && !raw.checked) { message('Tick “Use a native preset” to apply settings to this raw test chat.', 'warning'); raw.focus(); return; }
      const values: Json = {};
      for (const item of samplerFields) {
        const input = inputs.get(item.key)!; const value = input.value.trim() === '' ? null : Number(input.value);
        if (value !== null && (!Number.isFinite(value) || value < item.min || value > item.max || (item.step === 1 && !Number.isInteger(value)))) { show('generation'); if (!basicHints[item.key]) advancedGeneration.open = true; input.setAttribute('aria-invalid', 'true'); message(`${item.title} must be ${item.step === 1 ? 'a whole number ' : ''}between ${item.min} and ${item.max}.`, 'error'); input.focus(); return; }
        values[item.key] = value;
      }
      saving = true; lock(true); message('Saving to your native preset…');
      try {
        if (!await permissions() || !current()) return;
        const visibleChatId = location.pathname.startsWith('/chat/') ? ctx.getActiveChat().chatId : null;
        if ((loaded.scope.kind === 'chat' && visibleChatId !== loaded.scope.id) || (loaded.scope.kind === 'connection' && visibleChatId)) throw new Error('scope-changed');
        const scopeNow = await getScope();
        if (scopeNow.kind !== loaded.scope.kind || scopeNow.id !== loaded.scope.id || scopeNow.connectionId !== loaded.scope.connectionId) throw new Error('scope-changed');
        if (!loaded.scope.raw) {
          const effectiveNow = await effective(loaded.scope);
          if (effectiveNow.preset_id !== loaded.sourceId || JSON.stringify(effectiveNow.binding) !== JSON.stringify(loaded.binding)) throw new Error('conflict');
        }
        let preset = loaded.preset;
        if (preset.id) {
          const fresh = await api<Preset>(`/presets/${encodeURIComponent(preset.id)}`);
          if (!fresh || fresh.cache_revision !== preset.cache_revision) throw new Error('conflict');
          preset = fresh;
        }
        const next = copy(preset); const owned = rec(next.metadata[markerKey]);
        if (!next.prompt_order.length) next.prompt_order = copy(loaded.preset.prompt_order);
        // Binding state remains authoritative on every Save, including later
        // edits after the native editor changed a checkbox in this copy.
        next.prompt_order = next.prompt_order.map(b => ({ ...b, ...(Object.hasOwn(loaded!.binding?.block_states ?? {}, String(b.id)) ? { enabled: loaded!.binding!.block_states[String(b.id)] } : {}) }));
        const scopeKey = `${loaded.scope.kind}:${loaded.scope.id}`;
        const reuse = owned.owner === owner && owned.scope === scopeKey;
        if (!reuse) {
          next.id = ''; next.name = `Janiverse · ${loaded.scope.kind === 'chat' ? 'Chat' : 'API'} · ${preset.name}`;
          // Preserve every native block/property and effective profile state, including variables.
          next.metadata = { ...next.metadata, isDefault: false };
        }
        let promptId = loaded.blockId;
        if (!promptId && (promptDirty || prompt.value)) {
          const section = { ...block('Janiverse'), marker: 'category', categoryMode: 'checkbox', isLocked: false };
          const added: Json = { ...block('Global prompt'), content: prompt.value };
          // Leading category isolates the new instructions from any radio category in the source.
          next.prompt_order.unshift(section, added); promptId = String(added.id);
        } else if (promptId && promptDirty) {
          next.prompt_order = next.prompt_order.map(b => b.id === promptId ? { ...b, content: prompt.value } : b);
        }
        if (prefillDirty) next.prompts = { ...next.prompts, completionSettings: { ...rec(next.prompts.completionSettings), assistantPrefill: prefill.value } };
        if (samplersDirty) next.parameters = { ...next.parameters, samplerOverrides: { ...rec(next.parameters.samplerOverrides), ...values, enabled: enabled.checked } };
        next.metadata = { ...next.metadata, [markerKey]: { ...owned, owner, scope: scopeKey, sourcePresetId: reuse ? owned.sourcePresetId : loaded.sourceId, blockId: promptId } };
        const body = { name: next.name, provider: next.provider, engine: next.engine, parameters: next.parameters, prompts: next.prompts, metadata: next.metadata, prompt_order: next.prompt_order };
        const saved = next.id ? await api<Preset>(`/presets/${encodeURIComponent(next.id)}`, 'PUT', { ...body, expected_cache_revision: preset.cache_revision }) : await api<Preset>('/presets', 'POST', body);
        if (!saved || !current()) return;
        // Keep the new row for retry if the subsequent binding request fails.
        loaded.preset = saved; loaded.blockId = promptId;
        if (!await permissions() || !current()) return;
        const states = Object.fromEntries(saved.prompt_order.filter(b => typeof b.id === 'string').map(b => [String(b.id), b.enabled === true]));
        const bindingBody = { preset_id: saved.id, block_states: states, ...(loaded.binding?.prompt_variables ? { prompt_variables: loaded.binding.prompt_variables } : {}) };
        const binding = await api<Binding>(`/preset-profiles/${loaded.scope.kind}/${encodeURIComponent(loaded.scope.id)}`, 'PUT', bindingBody);
        if (!current()) return;
        loaded.binding = binding; loaded.sourceId = saved.id;
        if (loaded.scope.connectionId && !string(ctx.state?.get('loom.activePresetId'))) {
          const connection = await api<Json>(`/connections/${encodeURIComponent(loaded.scope.connectionId)}`);
          if (!string(connection?.preset_id)) await api<Json>(`/connections/${encodeURIComponent(loaded.scope.connectionId)}`, 'PUT', { preset_id: saved.id });
        }
        if (!current()) return;
        if (loaded.scope.raw) { await api<Json>(`/chats/${encodeURIComponent(loaded.scope.id)}/metadata`, 'PATCH', { no_preset: false }); if (!current()) return; loaded.scope.raw = false; rawLabel.hidden = true; }
        const resolved = await effective(loaded.scope);
        if (!current()) return;
        if (resolved.preset_id !== saved.id) throw new Error('binding-not-active');
        promptDirty = prefillDirty = samplersDirty = false; scopeInfo.textContent = `Applies to: ${loaded.scope.label}`; presetInfo.textContent = `Native preset: ${saved.name}`;
        message(loaded.scope.kind === 'chat' ? 'Saved for this conversation.' : 'Saved for this API configuration. Chats with their own instructions keep them.', 'success');
      } catch (error) {
        if (!current()) return;
        const why = (error as Error).message;
        if (why === 'permission') return;
        message(why === 'conflict' ? 'The native preset changed while you were editing. Your draft is still here. Reload saved settings before trying again.' : why === 'scope-changed' ? 'The active chat or API configuration changed. Reload saved settings before saving.' : why === 'binding-not-active' ? 'The preset was saved, but its native binding could not be verified. Reload saved settings before using it.' : 'Could not finish saving native settings. Your draft is still here; try again.', 'error');
      } finally { saving = false; if (current()) lock(!loaded); }
    }
    lock(true); void load();
  }
  function destroy() { disposed = true; active?.modal.dismiss(); active = undefined; }
  return { open, destroy };
}
