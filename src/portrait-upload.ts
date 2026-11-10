import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { saveLibrary } from './library-client';
import { portraitLimit } from './library-protocol';

export class PortraitUploadError extends Error {
  constructor(readonly status: number) { super('The portrait upload could not be completed.'); }
}
const metadata = (text: string) => btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
const abortIfNeeded = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };

/** Documented Spindle tus 1.0 creation + one bounded PATCH; image bytes never enter frontend messages. */
export async function savePortraitUpload(ctx: SpindleFrontendContext, characterId: string, file: File, signal: AbortSignal) {
  abortIfNeeded(signal);
  if (!file.size || file.size > portraitLimit) throw new PortraitUploadError(413);
  const endpoint = new URL('/api/v1/spindle-uploads', document.location.href);
  const created = await fetch(endpoint.pathname, { method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
    headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': String(file.size), 'Upload-Metadata': `extension ${metadata('janitor_bridge')},filename ${metadata(file.name)}` },
  });
  abortIfNeeded(signal);
  if (created.status !== 201) throw new PortraitUploadError(created.status);
  const location = created.headers.get('Location');
  if (!location) throw new PortraitUploadError(0);
  const target = new URL(location, endpoint);
  const match = /^\/api\/v1\/spindle-uploads\/([a-zA-Z0-9_-]{1,128})$/.exec(target.pathname);
  if (target.origin !== endpoint.origin || target.username || target.password || target.search || target.hash || !match) throw new PortraitUploadError(0);
  const transferred = await fetch(target.pathname, { method: 'PATCH', credentials: 'same-origin', redirect: 'error', signal, body: file,
    headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
  });
  abortIfNeeded(signal);
  if (transferred.status !== 204 || transferred.headers.get('Upload-Offset') !== String(file.size)) throw new PortraitUploadError(transferred.status);
  const result = await saveLibrary(ctx, { operation: 'portrait.save', characterId, uploadId: match[1], mimeType: file.type || 'image/png' }, signal);
  if (result.id !== characterId) throw new PortraitUploadError(0);
  return result;
}
