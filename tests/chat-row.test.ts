import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { addChatRowActions } from '../src/chat-row';

let dom: JSDOM, saved: Document, row: HTMLElement, ctx: any, renamed: string[], deleted: number;
beforeEach(() => {
  saved = globalThis.document; dom = new JSDOM('<!doctype html><body></body>'); globalThis.document = dom.window.document;
  row = document.createElement('article'); document.body.append(row); renamed = []; deleted = 0;
  ctx = { permissions: { getGranted: async () => ['chats'] }, chats: {} };
  addChatRowActions(ctx, row, { id: 'chat', name: 'Old name' }, { current: () => true, renamed: name => { renamed.push(name); }, deleted: () => { deleted++; }, closed() {}, refresh() {} });
});
afterEach(() => { dom.window.close(); globalThis.document = saved; });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function submit(mode: 'rename' | 'delete') {
  row.querySelector<HTMLButtonElement>(mode === 'rename' ? '.jb-mc-edit' : '.jb-mc-trash')!.click();
  row.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
}
for (const mode of ['rename', 'delete'] as const) test(`missing optional chat ${mode} method gives guidance without reporting success`, async () => {
  submit(mode); await settle(); expect(row.textContent).toContain('Open the native chat list'); expect(renamed).toEqual([]); expect(deleted).toBe(0); expect(row.getAttribute('aria-busy')).toBe('false');
});
test('a false deletion result never removes the chat row or reports success', async () => {
  ctx.chats.delete = async () => false; submit('delete'); await settle();
  expect(deleted).toBe(0); expect(row.isConnected).toBe(true); expect(row.textContent).toContain('Could not confirm the change');
  expect(row.querySelector<HTMLButtonElement>('.jb-mc-delete-confirm')!.hidden).toBe(true);
});
test('the current host void success result remains a successful deletion', async () => {
  ctx.chats.delete = async () => {}; submit('delete'); await settle(); expect(deleted).toBe(1);
});
