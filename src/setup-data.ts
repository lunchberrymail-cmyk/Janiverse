import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { readOptionalState, subscribeOptionalState } from './optional-state';

export type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
export type Connection = { id: string; name: string; provider: string; model: string; presetId: string; source: 'chat' | 'active' | 'default'; roulette?: boolean };
export type Prompt = { id: string; name: string; source: string };
const providers: Record<string, string> = { custom: 'Custom API', openai: 'OpenAI', openrouter: 'OpenRouter', nanogpt: 'NanoGPT', google_vertex: 'Vertex', google: 'Gemini', anthropic: 'Claude', deepseek: 'DeepSeek', zai: 'Z.AI', chutes: 'Chutes', model_roulette: 'Model roulette' };
export const providerName = (value: string) => providers[value] || value || 'API';

/** Authenticated native reads only. No connection tests, generation or credential access. */
export async function readSetupJson(path: string, signal: AbortSignal, optional = false): Promise<unknown> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin', cache: 'no-store', signal });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error('Setup information unavailable');
  return response.json();
}

export async function readConnection(ctx: SpindleFrontendContext, signal: AbortSignal, metadata: Row = {}): Promise<Connection | null> {
  const profiles: Row[] = []; let offset = 0;
  for (;;) {
    const page = record(await readSetupJson(`/connections?limit=200&offset=${offset}`, signal));
    if (!Array.isArray(page.data) || typeof page.total !== 'number' || !Number.isFinite(page.total) || page.total < 0 || (!page.data.length && offset < page.total)) throw new Error('Invalid connections');
    profiles.push(...page.data.map(record)); offset += page.data.length;
    if (!page.data.length || offset >= page.total || signal.aborted) break;
  }
  const activeId = text(record(readOptionalState(ctx, 'connections.active', {})).activeProfileId);
  const pinned = profiles.find(profile => text(profile.id) && profile.id === text(metadata.connection_profile_id));
  const active = profiles.find(profile => text(profile.id) && profile.id === activeId);
  const profile = pinned || active || profiles.find(profile => profile.is_default === true || profile.is_default === 1) || profiles.find(profile => text(profile.id));
  if (!profile) return null;
  if (profile.provider === 'model_roulette') {
    const ids = record(record(profile.metadata).connection_roulette).connection_ids;
    const configured = Array.isArray(ids) && profiles.some(candidate => ids.includes(candidate.id) && candidate.id !== profile.id && text(candidate.provider) && candidate.provider !== 'model_roulette' && text(candidate.model));
    return { id: text(profile.id), name: text(profile.name), provider: 'model_roulette', model: configured ? 'Selected per reply' : '', presetId: '', source: pinned ? 'chat' : active ? 'active' : 'default', roulette: true };
  }
  return { id: text(profile.id), name: text(profile.name), provider: text(profile.provider),
    // Native generation ignores a model override when its pinned profile was deleted.
    model: (pinned ? text(metadata.connection_model) : '') || text(profile.model), presetId: text(profile.preset_id), source: pinned ? 'chat' : active ? 'active' : 'default' };
}

export async function readPrompt(ctx: SpindleFrontendContext, signal: AbortSignal, connection: Connection | null, chat?: { id: string; metadata: Row }): Promise<Prompt | null> {
  if (chat?.metadata.temporary === true && chat.metadata.no_preset === true) return { id: '', name: 'No preset · Raw chat', source: 'Raw chat' };
  // The chosen member profile (and its preset binding) is not known until generation.
  if (connection?.roulette) return chat ? { id: '', name: 'Resolved per reply', source: 'Model roulette' } : null;
  const selectedId = text(readOptionalState(ctx, 'loom.activePresetId', '')) || connection?.presetId || '';
  let resolved: Row = {};
  if (chat && chat.metadata.temporary !== true) {
    const params = new URLSearchParams();
    if (selectedId) params.set('preset_id', selectedId);
    if (connection) params.set('connection_id', connection.id);
    const personaId = text(readOptionalState(ctx, 'persona.activeId', ''));
    if (personaId) params.set('persona_id', personaId);
    resolved = record(await readSetupJson(`/preset-profiles/resolve/${encodeURIComponent(chat.id)}?${params}`, signal));
  } else {
    // Temporary chats have no persona or character preset binding.
    if (chat) {
      const binding = record(await readSetupJson(`/preset-profiles/chat/${encodeURIComponent(chat.id)}`, signal, true));
      if (text(binding.preset_id)) resolved = { ...binding, source: 'chat' };
    }
    if (!text(resolved.preset_id) && connection) {
      const binding = record(await readSetupJson(`/preset-profiles/connection/${encodeURIComponent(connection.id)}`, signal, true));
      if (text(binding.preset_id)) resolved = { ...binding, source: 'connection' };
    }
    if (!text(resolved.preset_id)) resolved = { preset_id: selectedId, source: 'none' };
  }
  const id = text(resolved.preset_id); if (!id) return null;
  const preset = record(await readSetupJson(`/presets/${encodeURIComponent(id)}`, signal));
  if (preset.id !== id || !text(preset.name)) throw new Error('Invalid preset');
  const sources: Record<string, string> = { chat: 'This chat', persona: 'This persona', character: 'This character', connection: 'This connection', defaults: 'Preset defaults', none: 'Selected preset' };
  return { id, name: text(preset.name), source: sources[text(resolved.source)] || 'Selected preset' };
}

export async function readSetupPage(path: string, signal: AbortSignal): Promise<{ first: Row | null; total: number }> {
  const page = record(await readSetupJson(path, signal));
  if (!Array.isArray(page.data) || typeof page.total !== 'number' || !Number.isFinite(page.total) || page.total < 0) throw new Error('Invalid library');
  const first = page.data.map(record).find(row => text(row.id)) || null;
  if (page.total > 0 && !first) throw new Error('Incomplete library');
  return { first, total: page.total };
}

export function watchSetup(ctx: SpindleFrontendContext, changed: () => void) {
  const cleanups = ['connections.active', 'connections.profiles', 'persona.activeId', 'loom.activePresetId', 'chat.active'].map(selector => subscribeOptionalState(ctx, selector, changed));
  if (ctx.events?.on) for (const event of ['CHARACTER_CREATED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_LIBRARY_CHANGED', 'PERSONA_CHANGED', 'CONNECTION_PROFILE_LOADED', 'PRESET_CHANGED', 'PRESET_DELETED', 'PRESET_PROFILE_CHANGED', 'CHAT_CHANGED', 'jar_bridge:imported']) {
    try { cleanups.push(ctx.events.on(event, changed)); } catch { /* Older hosts may not expose every event. */ }
  }
  return () => cleanups.reverse().forEach(cleanup => cleanup());
}
