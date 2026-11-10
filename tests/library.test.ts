import { expect, test } from 'bun:test';
import { registerLibraryHost } from '../src/library-host';
import { LibrarySaveError, saveLibrary } from '../src/library-client';
import { libraryChannel } from '../src/library-protocol';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness() {
  let receive: any, granted = true;
  const calls: any[] = [], replies: any[] = [], listeners = new Set<(value: any) => void>();
  let current: any = { id: 'card', extensions: { janiverse: { other: 'fresh' }, jar_bridge: { creator: 'Author' }, world_book_ids: ['book'] } };
  const gate = () => { if (!granted) throw new Error('PERMISSION_DENIED: revoked'); };
  const api: any = {
    host: { capabilities: { 'frontend-session-routing-v1': 1 } },
    personas: { async create(...args: any[]) { gate(); calls.push(['persona', ...args]); return { id: 'persona', ...args[0] }; } },
    characters: {
      async create(...args: any[]) { gate(); calls.push(['character', ...args]); return { id: 'created', ...args[0] }; },
      async get(...args: any[]) { gate(); calls.push(['get', ...args]); return current; },
      async update(...args: any[]) { gate(); calls.push(['update', ...args]); current = { ...current, extensions: { ...current.extensions, ...args[1].extensions } }; return current; },
      async setAvatar(...args: any[]) { gate(); calls.push(['avatar', ...args]); return { id: args[0], image_id: 'image' }; },
    },
    uploads: {
      async get(...args: any[]) { calls.push(['upload.get', ...args]); return { fileName: 'portrait.png', size: 3, data: new Uint8Array([1, 2, 3]) }; },
      async delete(...args: any[]) { calls.push(['upload.delete', ...args]); return true; },
    },
    onFrontendMessage(fn: any) { receive = fn; return () => {}; },
    sendToFrontend(...args: any[]) { replies.push(args); for (const fn of [...listeners]) fn(args[0]); },
  };
  const stop = registerLibraryHost(api);
  const ctx: any = {
    onBackendMessage(fn: any) { listeners.add(fn); return () => listeners.delete(fn); },
    sendToBackend(value: any) { receive(value, 'real-user', 'real-document'); },
  };
  return { api, ctx, calls, replies, listeners, stop, receive: (...args: any[]) => receive(...args), revoke() { granted = false; }, current: () => current };
}

test('creation uses host-gated APIs with authenticated identity and document-targeted responses', async () => {
  const h = harness();
  try {
    await expect(saveLibrary(h.ctx, { operation: 'persona.create', input: { name: 'Mira', description: 'Traveler' } })).resolves.toMatchObject({ id: 'persona' });
    h.receive({ type: libraryChannel, requestId: '99', operation: 'character.create', userId: 'forged', frontendSessionId: 'forged', input: { name: 'Card', description: 'Text', library_scope: 'unverified', extensions: { janiverse: { other: 1 } } } }, 'real-user', 'real-document');
    await settle();
    expect(h.calls).toEqual([
      ['persona', { name: 'Mira', description: 'Traveler' }, 'real-user'],
      ['character', { name: 'Card', description: 'Text', extensions: { janiverse: { other: 1 } } }, 'real-user'],
    ]);
    for (const reply of h.replies) expect(reply.slice(1)).toEqual(['real-user', { frontendSessionId: 'real-document' }]);
    expect(h.listeners.size).toBe(0);
  } finally { h.stop(); }
});

test('soundtrack updates read fresh data and send only the owned extension namespace', async () => {
  const h = harness();
  try {
    const track = 'https://api.soundcloud.com/tracks/123';
    const result = await saveLibrary(h.ctx, { operation: 'soundtrack.save', characterId: 'card', track });
    expect(h.calls).toEqual([['get', 'card', 'real-user'], ['update', 'card', { extensions: { janiverse: { other: 'fresh', soundcloud_track_id: track } } }, 'real-user']]);
    expect((result as any).extensions).toEqual({ janiverse: { other: 'fresh', soundcloud_track_id: track }, jar_bridge: { creator: 'Author' }, world_book_ids: ['book'] });
    await saveLibrary(h.ctx, { operation: 'soundtrack.save', characterId: 'card', track: null });
    expect(h.current().extensions.janiverse.soundcloud_track_id).toBeNull();
  } finally { h.stop(); }
});

test('portraits use scoped staged bytes and the official avatar API, then release the upload', async () => {
  const h = harness();
  try {
    const result = await saveLibrary(h.ctx, { operation: 'portrait.save', characterId: 'card', uploadId: 'staged', mimeType: 'image/png' });
    expect(result).toMatchObject({ id: 'card', image_id: 'image' });
    expect(h.calls).toEqual([
      ['upload.get', 'staged', 'real-user'],
      ['avatar', 'card', { data: new Uint8Array([1, 2, 3]), filename: 'portrait.png', mime_type: 'image/png' }, 'real-user'],
      ['upload.delete', 'staged', 'real-user'],
    ]);
  } finally { h.stop(); }
});

test('portrait denial, missing uploads, oversize data and unavailable methods never bypass the host', async () => {
  const request = { operation: 'portrait.save', characterId: 'card', uploadId: 'staged', mimeType: 'image/png' } as const;
  for (const failure of ['denied', 'missing', 'oversize', 'unsupported'] as const) {
    const h = harness();
    try {
      if (failure === 'denied') h.revoke();
      if (failure === 'missing') h.api.uploads.get = async () => null;
      if (failure === 'oversize') h.api.uploads.get = async () => ({ size: 11 * 1024 * 1024, data: new Uint8Array(0) });
      if (failure === 'unsupported') h.api.characters.setAvatar = undefined;
      await expect(saveLibrary(h.ctx, request)).rejects.toHaveProperty('kind', failure === 'unsupported' ? 'unavailable' : 'rejected');
      expect(h.calls.some(call => call[0] === 'avatar')).toBe(false);
      expect(h.calls.at(-1)).toEqual(['upload.delete', 'staged', 'real-user']);
    } finally { h.stop(); }
  }
});

test('upload cleanup failures never turn a successful avatar into a retryable failed write', async () => {
  const h = harness(); h.api.uploads.delete = async () => { throw new Error('temporary cleanup failure'); };
  try {
    await expect(saveLibrary(h.ctx, { operation: 'portrait.save', characterId: 'card', uploadId: 'staged', mimeType: 'image/png' })).resolves.toMatchObject({ image_id: 'image' });
  } finally { h.stop(); }
});

test('permission revocation is enforced by the host and returns no private error details', async () => {
  const h = harness(); h.revoke();
  try {
    await expect(saveLibrary(h.ctx, { operation: 'character.create', input: { name: 'Card' } })).rejects.toHaveProperty('kind', 'rejected');
    expect(h.calls).toEqual([]); expect(JSON.stringify(h.replies)).not.toContain('revoked');
    h.api.personas.create = async () => { throw new Error('PRIVATE server failure'); };
    await expect(saveLibrary(h.ctx, { operation: 'persona.create', input: { name: 'Name', description: '' } })).rejects.toHaveProperty('kind', 'unknown');
    expect(JSON.stringify(h.replies)).not.toContain('PRIVATE');
    h.api.personas.create = undefined;
    await expect(saveLibrary(h.ctx, { operation: 'persona.create', input: { name: 'Name', description: '' } })).rejects.toHaveProperty('kind', 'unavailable');
  } finally { h.stop(); }
});

test('invalid operations, fields, private songs and playlist URLs never write', async () => {
  const h = harness();
  try {
    for (const payload of [
      { operation: 'characters.delete' }, { operation: 'persona.create', input: { name: '', description: '' } },
      { operation: 'character.create', input: { name: 'Card', tags: [42] } },
      ...['https://soundcloud.com/artist/sets/playlist', 'https://soundcloud.com/artist/song?secret_token=private', 'https://evil.test/track'].map(track => ({ operation: 'soundtrack.save', characterId: 'card', track })),
    ]) await expect(saveLibrary(h.ctx, payload as any)).rejects.toHaveProperty('kind', 'rejected');
    expect(h.calls).toEqual([]);
  } finally { h.stop(); }
});

test('unroutable or unauthenticated requests are never broadcast or executed', async () => {
  const h = harness(), payload = { type: libraryChannel, requestId: '1', operation: 'character.create', input: { name: 'Card' } };
  try {
    h.receive(payload, undefined, 'document'); h.receive(payload, 'user', undefined);
    h.api.host.capabilities = {}; h.receive(payload, 'user', 'document');
    await settle(); expect(h.calls).toEqual([]); expect(h.replies).toEqual([]);
    h.stop(); h.receive(payload, 'user', 'document'); expect(h.calls).toEqual([]);
  } finally { h.stop(); }
});

test('teardown while reading prevents a later soundtrack write and a closed document never redirects a result', async () => {
  const h = harness(); let release!: (value: any) => void;
  h.api.characters.get = () => new Promise(resolve => { release = resolve; });
  h.receive({ type: libraryChannel, requestId: '1', operation: 'soundtrack.save', characterId: 'card', track: null }, 'real-user', 'real-document');
  h.stop(); release(h.current()); await settle(); expect(h.calls).toEqual([]); expect(h.replies).toEqual([]);
  const closed = harness(); closed.api.sendToFrontend = () => { throw new Error('document closed'); };
  closed.receive({ type: libraryChannel, requestId: '2', operation: 'persona.create', input: { name: 'Mira', description: '' } }, 'real-user', 'closed-document');
  await settle(); expect(closed.calls).toHaveLength(1); closed.stop();
});

test('client ignores mismatched replies, removes listeners on abort, and ignores late completion', async () => {
  let receive: any, sent: any, off = 0, teardown: any;
  const ctx: any = { onBackendMessage(fn: any) { receive = fn; return () => { off++; }; }, onTeardown(fn: any) { teardown = fn; return () => {}; }, sendToBackend(value: any) { sent = value; } };
  const abort = new AbortController(), pending = saveLibrary(ctx, { operation: 'character.create', input: { name: 'Card' } }, abort.signal);
  receive({ type: libraryChannel + ':result', requestId: 'wrong', result: { id: 'wrong' } }); expect(off).toBe(0);
  abort.abort(); await expect(pending).rejects.toHaveProperty('name', 'AbortError'); expect(off).toBe(1);
  receive({ type: libraryChannel + ':result', requestId: sent.requestId, result: { id: 'late' } }); expect(off).toBe(1);
  const unloading = saveLibrary(ctx, { operation: 'character.create', input: { name: 'Card' } }); teardown();
  await expect(unloading).rejects.toHaveProperty('name', 'AbortError'); expect(off).toBe(2);
});

test('malformed replies and timeouts stay uncertain rather than encouraging duplicate creation', async () => {
  let receive: any, sent: any;
  const ctx: any = { onBackendMessage(fn: any) { receive = fn; return () => {}; }, sendToBackend(value: any) { sent = value; } };
  const pending = saveLibrary(ctx, { operation: 'character.create', input: { name: 'Card' } });
  receive({ type: libraryChannel + ':result', requestId: sent.requestId, result: {} });
  await expect(pending).rejects.toHaveProperty('uncertain', true);
  const saved = globalThis.setTimeout; let expire!: () => void;
  try {
    globalThis.setTimeout = ((fn: () => void) => { expire = fn; return 0; }) as any;
    const timeout = saveLibrary(ctx, { operation: 'character.create', input: { name: 'Card' } }); expire();
    await expect(timeout).rejects.toBeInstanceOf(LibrarySaveError); await expect(timeout).rejects.toHaveProperty('kind', 'unknown');
  } finally { globalThis.setTimeout = saved; }
});
