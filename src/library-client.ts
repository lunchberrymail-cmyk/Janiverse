import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { libraryChannel, type LibrarySave, type LibraryResult, type LibraryFailure } from './library-protocol';

type Context = Pick<SpindleFrontendContext, 'sendToBackend' | 'onBackendMessage' | 'onTeardown'>;
let sequence = 0;
export class LibrarySaveError extends Error {
  constructor(readonly kind: LibraryFailure) {
    super(kind === 'rejected' ? 'The host rejected this save. Check your fields and extension permissions.'
      : kind === 'unavailable' ? 'This host does not support this extension save. Use its native editor.'
      : 'The save could not be confirmed. Check your library before trying again.');
  }
  get uncertain() { return this.kind === 'unknown'; }
}

/** Transport only. Durable writes are performed by the host's permission-gated Spindle APIs. */
export function saveLibrary(ctx: Context, save: LibrarySave, signal?: AbortSignal): Promise<LibraryResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const requestId = String(++sequence);
    let settled = false, sent = false, off: (() => void) | undefined, offTeardown: (() => void) | undefined;
    const timer = setTimeout(() => finish(new LibrarySaveError(sent ? 'unknown' : 'unavailable')), 30_000);
    function finish(error?: Error, value?: LibraryResult) {
      if (settled) return;
      settled = true; clearTimeout(timer); off?.(); offTeardown?.(); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value!);
    }
    function abort() { finish(new DOMException('Cancelled', 'AbortError')); }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      off = ctx.onBackendMessage(payload => {
        const reply = payload as { type?: unknown; requestId?: unknown; result?: LibraryResult; error?: unknown } | null;
        if (!reply || reply.type !== libraryChannel + ':result' || reply.requestId !== requestId) return;
        if (reply.error === 'rejected' || reply.error === 'unavailable' || reply.error === 'unknown') finish(new LibrarySaveError(reply.error));
        else if (reply.result && typeof reply.result.id === 'string' && reply.result.id) finish(undefined, reply.result);
        else finish(new LibrarySaveError('unknown'));
      });
      if (settled) { off?.(); return; }
      offTeardown = ctx.onTeardown?.(abort);
      if (settled) { offTeardown?.(); return; }
      sent = true; ctx.sendToBackend({ type: libraryChannel, requestId, ...save });
    } catch { finish(new LibrarySaveError(sent ? 'unknown' : 'unavailable')); }
  });
}
