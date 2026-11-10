import { LibrarySaveError } from '../src/library-client';
import type { LibrarySave } from '../src/library-protocol';

/** A test-only backend transport. Production sends JSON messages, never these mock Responses. */
export function withHostLibrary<T extends object>(context: T, respond: (request: LibrarySave) => Promise<unknown>): T {
  const listeners = new Set<(value: unknown) => void>();
  const original = context as any;
  return { ...context,
    onBackendMessage(handler: (value: unknown) => void) {
      listeners.add(handler); const off = original.onBackendMessage?.(handler);
      return () => { listeners.delete(handler); off?.(); };
    },
    sendToBackend(payload: any) {
      if (payload?.type !== 'janitor_bridge:library') { original.sendToBackend?.(payload); return; }
      void respond(payload).then(result => {
        for (const handler of [...listeners]) handler({ type: 'janitor_bridge:library:result', requestId: payload.requestId, result });
      }, error => {
        for (const handler of [...listeners]) handler({ type: 'janitor_bridge:library:result', requestId: payload.requestId, error: error instanceof LibrarySaveError ? error.kind : 'unknown' });
      });
    },
  };
}
export async function mockSaveReply(response: Response): Promise<unknown> {
  if (!response.ok) throw new LibrarySaveError(response.status < 500 ? 'rejected' : 'unknown');
  return response.json();
}
