import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { createNativePresetResolution, type Binding, type Resolved, type Scope } from './native-preset-scope';

type Json = Record<string, unknown>;
type Preset = { id: string; name: string; provider: string; engine: string; cache_revision: number; parameters: Json; prompts: Json; metadata: Json; prompt_order: Json[] };
export type StreamingSetting = { enabled: boolean; available: boolean; reason?: string };
type Snapshot = { scope: Scope; resolved: Resolved; preset: Preset; enabled: boolean; pending?: Preset };
const rec = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const permissions = ['generation', 'presets', 'chats'];
const unavailable = (reason: string, enabled = true): StreamingSetting => ({ enabled, available: false, reason });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(value: T): T => structuredClone(value);
const savedPresetGuidance = 'Streaming follows this saved preset. Edit it in Advanced Presets, or open Settings → Global prompt → Customize a copy and save that copy before changing streaming here. Keeping the original preset preserves its linked regex.';
function presetGuidance(preset: Preset) {
  return preset.metadata._lumiverse_preset_slug === 'lumiverse-builtin-default-loom'
    ? 'Streaming follows the saved Default preset. Edit it in Advanced Presets to keep its original identity and linked regex. For a separate chat copy, open Settings → Global prompt, choose Custom prompt · Default base, then Save settings and reopen Customize.'
    : savedPresetGuidance;
}

/** A chat-scoped streaming editor for an already-created Janiverse copy. Never clones a normal saved preset. */
export function createStreamingSettings(ctx: SpindleFrontendContext) {
  let disposed = false, saving = false, generation = 0;
  let snapshot: Snapshot | undefined;
  let readOnlyReason: string | undefined;
  let abort = new AbortController();
  function alive() { if (disposed || abort.signal.aborted) throw new Error('This customization window was closed. Reopen it before saving.'); }
  function activeChat(id: string) {
    alive();
    if (!location.pathname.startsWith('/chat/') || ctx.getActiveChat().chatId !== id) throw new Error('The active chat changed. Reopen Customize before saving.');
  }
  async function allowed() {
    alive(); const granted = await ctx.permissions.getGranted(); alive();
    if (permissions.some(permission => !granted.includes(permission))) throw new Error('Enable Generation, Presets, and Chats for Janiverse to change streaming.');
  }
  async function api<T>(path: string, method = 'GET', body?: unknown, optional = false): Promise<T | null> {
    alive();
    if (method !== 'GET') { await allowed(); if (snapshot) activeChat(snapshot.scope.id); }
    alive();
    const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    alive();
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(response.status === 409 ? 'The native preset changed. Reopen Customize before saving.' : 'Could not read or save native streaming settings. Reopen Customize and try again.');
    return await response.json() as T;
  }
  const resolver = createNativePresetResolution(ctx, api);
  async function bodyOverride(scope: Scope, preset: Preset): Promise<boolean> {
    const profiles = ctx.state?.get('connections.profiles');
    const connection = Array.isArray(profiles) ? rec(profiles.find(profile => rec(profile).id === scope.connectionId)) : {};
    const bound = rec(rec(connection.metadata).reasoningBindings).settings;
    const reasoning = bound && typeof bound === 'object' && !Array.isArray(bound)
      ? rec(bound) : rec((await api<{ value?: unknown }>('/settings/reasoningSettings', 'GET', undefined, true))?.value);
    const body = rec(Object.hasOwn(reasoning, 'customBody') ? reasoning.customBody : preset.parameters.customBody);
    if (!body.enabled || typeof body.rawJson !== 'string') return false;
    try { return Object.hasOwn(rec(JSON.parse(body.rawJson)), '_streaming'); } catch { return false; }
  }
  function validPreset(value: Preset | null): value is Preset {
    return !!value?.id && typeof value.cache_revision === 'number' && Array.isArray(value.prompt_order) && !!value.parameters && !!value.prompts && !!value.metadata;
  }
  function editablePreset(preset: Preset, scope: Scope) {
    const marker = rec(preset.metadata._janitor_bridge);
    return marker.owner === 'janitor_bridge' && marker.scope === `chat:${scope.id}`;
  }
  async function read(chatId?: string): Promise<StreamingSetting> {
    if (saving) return unavailable('Wait for the current settings save to finish.');
    const ticket = ++generation; snapshot = undefined; readOnlyReason = undefined; abort.abort(); abort = new AbortController();
    try {
      alive(); const pinned = chatId || ctx.getActiveChat().chatId;
      if (!pinned) return unavailable('Open a chat to customize text streaming.');
      activeChat(pinned); await allowed();
      const scope = await resolver.getScope(); activeChat(pinned);
      if (scope.kind !== 'chat' || scope.id !== pinned) return unavailable('The active chat changed. Reopen Customize.');
      if (scope.raw) return unavailable('This temporary chat bypasses presets. Choose a native preset in Settings before changing streaming.');
      const resolved = await resolver.effective(scope);
      if (!resolved?.preset_id) return unavailable('Choose a native preset in Settings before changing streaming.');
      const preset = await api<Preset>(`/presets/${encodeURIComponent(resolved.preset_id)}`);
      if (!validPreset(preset) || preset.id !== resolved.preset_id) return unavailable('This native preset cannot be edited here. Open Advanced Presets to check it.');
      const enabled = rec(preset.parameters.samplerOverrides).streaming !== false;
      if (await bodyOverride(scope, preset)) return unavailable('A custom request body controls streaming. Edit it in Lumiverse’s advanced settings.', enabled);
      activeChat(pinned); if (ticket !== generation) return unavailable('Reload Customize to read the active settings.');
      if (!editablePreset(preset, scope)) { readOnlyReason = presetGuidance(preset); return unavailable(readOnlyReason, enabled); }
      snapshot = { scope, resolved: clone(resolved), preset: clone(preset), enabled };
      return { enabled, available: true };
    } catch (error) { return unavailable(error instanceof Error ? error.message : 'Could not read native streaming settings.'); }
  }
  async function checkCurrent(loaded: Snapshot) {
    activeChat(loaded.scope.id); await allowed();
    const currentScope = await resolver.getScope();
    if (!same(currentScope, loaded.scope)) throw new Error('The chat or API configuration changed. Reopen Customize before saving.');
    const current = await resolver.effective(currentScope);
    if (current.preset_id !== loaded.resolved.preset_id || !same(current.binding, loaded.resolved.binding)) throw new Error('The chat’s native preset or binding changed. Reopen Customize before saving.');
    activeChat(loaded.scope.id);
  }
  async function save(enabled: boolean): Promise<StreamingSetting> {
    alive(); if (saving) throw new Error('A streaming settings save is already in progress.');
    if (typeof enabled !== 'boolean' || !snapshot) throw new Error(readOnlyReason || 'Reload Customize before changing streaming.');
    const loaded = snapshot; saving = true; let attemptedUpdate = false;
    try {
      await checkCurrent(loaded);
      if (enabled === loaded.enabled && !loaded.pending) return { enabled, available: true };
      let source = await api<Preset>(`/presets/${encodeURIComponent(loaded.preset.id)}`);
      if (!validPreset(source) || source.id !== loaded.preset.id || source.cache_revision !== loaded.preset.cache_revision) throw new Error('The native preset changed. Reopen Customize before saving.');
      if (!editablePreset(source, loaded.scope)) throw new Error(presetGuidance(source));
      if (await bodyOverride(loaded.scope, source)) throw new Error('A custom request body now controls streaming. Reopen Customize to review it.');
      const pending = loaded.pending;
      let next = clone(pending || source);
      if (pending) {
        const fresh = await api<Preset>(`/presets/${encodeURIComponent(pending.id)}`);
        if (!validPreset(fresh) || fresh.id !== pending.id || fresh.cache_revision !== pending.cache_revision) throw new Error('The saved preset copy changed. Reopen Customize before saving.');
        next = fresh;
      }
      if (!editablePreset(next, loaded.scope)) throw new Error(presetGuidance(next));
      next.prompt_order = next.prompt_order.map(block => ({ ...block, ...(Object.hasOwn(loaded.resolved.binding?.block_states ?? {}, String(block.id)) ? { enabled: loaded.resolved.binding!.block_states[String(block.id)] } : {}) }));
      next.parameters = { ...next.parameters, samplerOverrides: { ...rec(next.parameters.samplerOverrides), streaming: enabled } };
      const body = { name: next.name, provider: next.provider, engine: next.engine, parameters: next.parameters, prompts: next.prompts, metadata: next.metadata, prompt_order: next.prompt_order };
      await checkCurrent(loaded);
      attemptedUpdate = true;
      const saved = await api<Preset>(`/presets/${encodeURIComponent(next.id)}`, 'PUT', { ...body, expected_cache_revision: next.cache_revision });
      if (!validPreset(saved)) throw new Error('The native preset save could not be confirmed. Reopen Customize before retrying.');
      attemptedUpdate = false;
      loaded.pending = clone(saved);
      // An owned copy was updated in place; retain its new revision even if binding fails.
      if (saved.id === loaded.preset.id) loaded.preset = clone(saved);
      await checkCurrent(loaded);
      const states = Object.fromEntries(saved.prompt_order.filter(block => typeof block.id === 'string').map(block => [String(block.id), block.enabled === true]));
      const binding = await api<Binding>(`/preset-profiles/chat/${encodeURIComponent(loaded.scope.id)}`, 'PUT', { preset_id: saved.id, block_states: states, ...(loaded.resolved.binding?.prompt_variables ? { prompt_variables: clone(loaded.resolved.binding.prompt_variables) } : {}) });
      if (!binding) throw new Error('The native chat binding could not be confirmed. Reopen Customize.');
      const verified = await resolver.effective(loaded.scope);
      if (verified.preset_id !== saved.id) throw new Error('The settings were saved, but the chat binding could not be verified. Reopen Customize.');
      loaded.preset = clone(saved); loaded.resolved = { preset_id: saved.id, binding: clone(binding) }; loaded.enabled = enabled; loaded.pending = undefined;
      return { enabled, available: true };
    } catch (error) {
      if (attemptedUpdate) {
        snapshot = undefined;
        throw new Error('The native preset update could not be confirmed. Reopen Customize before retrying.');
      }
      throw error;
    } finally { saving = false; }
  }
  return { read, save, dispose() { disposed = true; generation++; snapshot = undefined; abort.abort(); } };
}
