import type { SpindleAPI, CharacterCreateDTO } from 'lumiverse-spindle-types';
import { libraryChannel, portraitLimit, type LibraryResult, type LibraryFailure } from './library-protocol';
import { soundCloudTrackUrl } from './soundcloud';
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textKeys = ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions', 'creator'] as const;
const arrays = ['tags', 'alternate_greetings', 'world_book_ids'] as const;

function characterInput(value: unknown): CharacterCreateDTO | undefined {
  if (!object(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return;
  const input: CharacterCreateDTO = { name: value.name };
  for (const key of textKeys) {
    if (value[key] !== undefined) { if (typeof value[key] !== 'string') return; input[key] = value[key]; }
  }
  for (const key of arrays) {
    if (value[key] !== undefined) { if (!Array.isArray(value[key]) || !value[key].every(item => typeof item === 'string')) return; input[key] = value[key]; }
  }
  if (value.extensions !== undefined) { if (!object(value.extensions)) return; input.extensions = value.extensions; }
  return input;
}

/** Explicit operations only; identity and permissions remain host-owned. */
export function registerLibraryHost(api: SpindleAPI): () => void {
  let disposed = false;
  const off = api.onFrontendMessage((payload, userId, frontendSessionId) => {
    if (disposed || !object(payload) || payload.type !== libraryChannel || typeof payload.requestId !== 'string'
      || !/^\d{1,16}$/.test(payload.requestId) || !userId || !frontendSessionId
      || !(api.host.capabilities['frontend-session-routing-v1'] >= 1)) return;
    const reply = (value: { result: LibraryResult } | { error: LibraryFailure }) => {
      if (disposed) return;
      try { api.sendToFrontend({ type: libraryChannel + ':result', requestId: payload.requestId, ...value }, userId, { frontendSessionId }); }
      catch { /* The requesting document has closed. Never redirect the result. */ }
    };
    void (async () => {
      try {
        let result: LibraryResult;
        if (payload.operation === 'persona.create') {
          const input = payload.input;
          if (!object(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200
            || typeof input.description !== 'string' || input.description.length > 10_000) { reply({ error: 'rejected' }); return; }
          if (typeof api.personas?.create !== 'function') { reply({ error: 'unavailable' }); return; }
          result = await api.personas.create({ name: input.name, description: input.description }, userId);
        } else if (payload.operation === 'character.create') {
          const input = characterInput(payload.input);
          if (!input) { reply({ error: 'rejected' }); return; }
          if (typeof api.characters?.create !== 'function') { reply({ error: 'unavailable' }); return; }
          result = await api.characters.create(input, userId);
        } else if (payload.operation === 'portrait.save') {
          if (typeof payload.characterId !== 'string' || !payload.characterId || payload.characterId.length > 128
            || typeof payload.uploadId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.uploadId)
            || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(payload.mimeType))) { reply({ error: 'rejected' }); return; }
          if (typeof api.uploads?.get !== 'function' || typeof api.uploads?.delete !== 'function') { reply({ error: 'unavailable' }); return; }
          try {
            if (typeof api.characters?.setAvatar !== 'function') { reply({ error: 'unavailable' }); return; }
            const upload = await api.uploads.get(payload.uploadId, userId);
            if (disposed) return;
            if (!upload || !upload.size || upload.size > portraitLimit || upload.data.byteLength !== upload.size) { reply({ error: 'rejected' }); return; }
            result = await api.characters.setAvatar(payload.characterId, { data: upload.data, filename: upload.fileName, mime_type: String(payload.mimeType) }, userId);
          } finally {
            // Ownership is checked by the host; cleanup failure cannot turn a saved avatar into an uncertain save.
            try { await api.uploads.delete(payload.uploadId, userId); } catch { /* Host TTL also reclaims interrupted uploads. */ }
          }
        } else if (payload.operation === 'soundtrack.save') {
          if (typeof payload.characterId !== 'string' || !payload.characterId || payload.characterId.length > 128
            || payload.track !== null && (typeof payload.track !== 'string' || soundCloudTrackUrl(payload.track) !== payload.track)) { reply({ error: 'rejected' }); return; }
          if (typeof api.characters?.get !== 'function' || typeof api.characters?.update !== 'function') { reply({ error: 'unavailable' }); return; }
          const current = await api.characters.get(payload.characterId, userId);
          if (disposed) return;
          if (!current) { reply({ error: 'rejected' }); return; }
          const data = object(current.extensions?.janiverse) ? current.extensions.janiverse : {};
          result = await api.characters.update(payload.characterId, { extensions: { janiverse: { ...data, soundcloud_track_id: payload.track } } }, userId);
        } else { reply({ error: 'rejected' }); return; }
        reply({ result });
      } catch (error) {
        // This prefix is documented by Spindle. Unknown failures may follow a committed write.
        reply({ error: error instanceof Error && error.message.startsWith('PERMISSION_DENIED:') ? 'rejected' : 'unknown' });
      }
    })();
  });
  return () => { disposed = true; off(); };
}
