import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { savePortraitUpload } from '../src/portrait-upload';
import { portraitLimit } from '../src/library-protocol';
import { withHostLibrary } from './host-library-fixture';

const original = { document: globalThis.document, fetch: globalThis.fetch };
let dom: JSDOM, requests: any[], messages: any[], response: (url: string, init: RequestInit) => Promise<Response>, ctx: any;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://192.168.1.2:7860/' }); globalThis.document = dom.window.document;
  requests = []; messages = [];
  response = async (_url, init) => init.method === 'POST' ? new Response(null, { status: 201, headers: { Location: '/api/v1/spindle-uploads/staged-id' } }) : new Response(null, { status: 204, headers: { 'Upload-Offset': String((init.body as File).size) } });
  globalThis.fetch = (async (url: string, init: RequestInit) => { requests.push({ url, init }); return response(url, init); }) as typeof fetch;
  ctx = withHostLibrary({}, async request => { messages.push(request); return { id: 'card', image_id: 'saved' }; });
});
afterEach(() => { dom.window.close(); globalThis.document = original.document; globalThis.fetch = original.fetch; });
const file = () => new File([new Uint8Array([1, 2, 3])], '猫🎵.png', { type: 'image/png' });
const save = (value = file(), signal = new AbortController().signal) => savePortraitUpload(ctx, 'card', value, signal);

test('documented tus headers scope uploads to Janiverse and send the original bytes on plain HTTP', async () => {
  const image = file(); await expect(save(image)).resolves.toMatchObject({ image_id: 'saved' });
  expect(requests.map(request => [request.url, request.init.method, request.init.credentials, request.init.redirect])).toEqual([
    ['/api/v1/spindle-uploads', 'POST', 'same-origin', 'error'], ['/api/v1/spindle-uploads/staged-id', 'PATCH', 'same-origin', 'error'],
  ]);
  const headers = requests[0].init.headers;
  expect(headers['Tus-Resumable']).toBe('1.0.0'); expect(headers['Upload-Length']).toBe('3');
  const meta = Object.fromEntries(headers['Upload-Metadata'].split(',').map((item: string) => { const [key, value] = item.split(' '); return [key, new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))]; }));
  expect(meta).toEqual({ extension: 'janitor_bridge', filename: image.name });
  expect(requests[1].init.body).toBe(image); expect(requests[1].init.headers).toEqual({ 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' });
  expect(messages[0]).toMatchObject({ operation: 'portrait.save', characterId: 'card', uploadId: 'staged-id', mimeType: 'image/png' });
  expect(JSON.stringify(messages[0]).length).toBeLessThan(300);
});

test('images exceeding the message cap use the same bounded upload flow without base64 image messages', async () => {
  const image = new File([new Uint8Array(portraitLimit)], 'large.png', { type: 'image/png' });
  await save(image); expect(requests[1].init.body).toBe(image); expect(messages[0].uploadId).toBe('staged-id');
  expect(JSON.stringify(messages).length).toBeLessThan(300);
});

test('foreign, redirected, malformed and unrelated upload locations never receive image data', async () => {
  for (const location of ['https://evil.test/api/v1/spindle-uploads/id', '//evil.test/api/v1/spindle-uploads/id', '/api/v1/characters/id', '/api/v1/spindle-uploads/id?secret=x', '/api/v1/spindle-uploads/id#x', '/api/v1/spindle-uploads/a%2Fb']) {
    requests = []; response = async () => new Response(null, { status: 201, headers: { Location: location } });
    await expect(save()).rejects.toThrow(); expect(requests).toHaveLength(1); expect(messages).toEqual([]);
  }
});

test('failed or incomplete transfers do not request an avatar save', async () => {
  const normal = response;
  for (const status of [400, 413, 500]) {
    response = async () => new Response(null, { status }); await expect(save()).rejects.toHaveProperty('status', status);
  }
  response = async (url, init) => init.method === 'POST' ? normal(url, init) : new Response(null, { status: 204, headers: { 'Upload-Offset': '2' } });
  await expect(save()).rejects.toThrow(); expect(messages).toEqual([]);
});

test('cancelling before or during an upload never sends a late avatar save', async () => {
  const cancelled = new AbortController(); cancelled.abort(); await expect(save(file(), cancelled.signal)).rejects.toHaveProperty('name', 'AbortError'); expect(requests).toEqual([]);
  const abort = new AbortController(), normal = response;
  response = async (url, init) => { const result = await normal(url, init); if (init.method === 'PATCH') abort.abort(); return result; };
  await expect(save(file(), abort.signal)).rejects.toHaveProperty('name', 'AbortError'); expect(messages).toEqual([]);
});
