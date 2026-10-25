import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
type Json = Record<string, unknown>;
export type Binding = { preset_id: string; block_states: Record<string, boolean>; prompt_variables?: Json; linked_to_defaults?: boolean };
export type Resolved = { preset_id: string | null; binding: Binding | null; source?: string };
export type Scope = { kind: 'chat' | 'connection'; id: string; label: string; connectionId: string | null; raw: boolean; temporary: boolean };
export type NativePresetAPI = <T>(path: string, method?: string, body?: unknown, optional?: boolean) => Promise<T | null>;
const rec = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;

/** Shared read-only native scope resolution. It never creates a preset or binding. */
export function createNativePresetResolution(ctx: SpindleFrontendContext, api: NativePresetAPI) {
    async function getScope(): Promise<Scope> {
      const chatId = ctx.getActiveChat().chatId;
      const activeConnection = rec(ctx.state?.get('connections.active'));
      const profiles = ctx.state?.get('connections.profiles');
      const available = Array.isArray(profiles) ? profiles.map(rec) : [];
      let connectionId = string(activeConnection.activeProfileId);
      if (!available.some(p => p.id === connectionId)) connectionId = string(available.find(p => p.is_default === true)?.id) ?? string(available[0]?.id);
      if (chatId && location.pathname.startsWith('/chat/')) {
        const chat = await api<Json>(`/chats/${encodeURIComponent(chatId)}?messages=false`); const metadata = rec(chat?.metadata);
        const pinned = string(metadata.connection_profile_id);
        // A deleted pin falls back to the active configuration in the native resolver.
        if (pinned) {
          if (available.some(p => p.id === pinned)) connectionId = pinned;
        }
        return { kind: 'chat', id: chatId, label: 'This chat', connectionId, raw: metadata.temporary === true && metadata.no_preset === true, temporary: metadata.temporary === true };
      }
      if (!connectionId) throw new Error('no-connection');
      const connection = available.find(p => p.id === connectionId);
      return { kind: 'connection', id: connectionId, connectionId, label: `This API configuration${string(rec(connection).name) ? ` · ${String(rec(connection).name)}` : ''}`, raw: false, temporary: false };
    }
    async function effective(scope: Scope): Promise<Resolved> {
      const selectedId = string(ctx.state?.get('loom.activePresetId'));
      const profiles = ctx.state?.get('connections.profiles');
      const connection = Array.isArray(profiles) ? rec(profiles.find(p => rec(p).id === scope.connectionId)) : {};
      const fallbackId = selectedId ?? string(connection.preset_id);
      async function scopedBinding(kind: 'chat' | 'connection', id: string): Promise<Resolved | null> {
        const direct = await api<Binding>(`/preset-profiles/${kind}/${encodeURIComponent(id)}`, 'GET', undefined, true);
        if (!direct) return null;
        const binding = direct.linked_to_defaults ? await api<Binding>(`/preset-profiles/defaults?preset_id=${encodeURIComponent(direct.preset_id)}`, 'GET', undefined, true) : direct;
        return { preset_id: direct.preset_id, binding };
      }
      if (scope.kind === 'chat') {
        // Temporary chats are persona-less; the ordinary resolve REST route falls back to the default persona.
        if (scope.temporary) {
          const chat = await scopedBinding('chat', scope.id); if (chat) return chat;
          const linked = scope.connectionId ? await scopedBinding('connection', scope.connectionId) : null; if (linked) return linked;
          return { preset_id: fallbackId, binding: fallbackId ? await api<Binding>(`/preset-profiles/defaults?preset_id=${encodeURIComponent(fallbackId)}`, 'GET', undefined, true) : null };
        }
        const params = new URLSearchParams(); if (fallbackId) params.set('preset_id', fallbackId); if (scope.connectionId) params.set('connection_id', scope.connectionId);
        const personaId = string(ctx.state?.get('persona.activeId')); if (personaId) params.set('persona_id', personaId);
        return (await api<Resolved>(`/preset-profiles/resolve/${encodeURIComponent(scope.id)}?${params}`))!;
      }
      const linked = await scopedBinding('connection', scope.id); if (linked) return linked;
      let id = fallbackId;
      if (!id) { const liveConnection = await api<Json>(`/connections/${encodeURIComponent(scope.id)}`); id = string(liveConnection?.preset_id); }
      const defaults = id ? await api<Binding>(`/preset-profiles/defaults?preset_id=${encodeURIComponent(id)}`, 'GET', undefined, true) : null;
      return { preset_id: id, binding: defaults };
    }

  return { getScope, effective };
}
