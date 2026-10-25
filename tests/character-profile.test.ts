import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { mountCharacterProfile } from '../src/character-profile';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));
let dom: any, root: HTMLElement, cleanup: (() => void) | undefined;
let originalDocument: any, originalLocation: any, originalDOMParser: any;
let reads: string[], injections: Element[], removed: Element[], ctx: any;
let result: (id: string) => Promise<unknown>;
beforeEach(() => {
  originalDocument = globalThis.document; originalLocation = globalThis.location; originalDOMParser = globalThis.DOMParser;
  dom = new JSDOM('<!doctype html><html><body><main></main></body></html>', { url: 'http://localhost:7860/' });
  globalThis.document = dom.window.document; globalThis.location = dom.window.location; globalThis.DOMParser = dom.window.DOMParser;
  root = document.querySelector('main')!; reads = []; injections = []; removed = [];
  result = async id => ({ id, name: 'Selected card', creator: 'Author', creator_notes: 'Full creator note.', description: 'Private definition.', tags: ['Adventure'] });
  ctx = {
    characters: { get: (id: string) => { reads.push(id); return result(id); } },
    dom: {
      inject: (target: HTMLElement, markup: string) => { const node = document.createElement('div'); node.innerHTML = markup; target.append(node); injections.push(node); return node; },
      uninject: (node: Element) => { removed.push(node); node.remove(); },
    },
  };
});
afterEach(() => {
  cleanup?.(); cleanup = undefined; dom.window.close();
  globalThis.document = originalDocument; globalThis.location = originalLocation; globalThis.DOMParser = originalDOMParser;
});

test('reads the exact selected character and shows full notes with the definition collapsed separately', async () => {
  cleanup = mountCharacterProfile(ctx, root, 'selected-id'); await flush();
  expect(reads).toEqual(['selected-id']); expect(root.querySelector('h2')!.textContent).toBe('Selected card');
  expect(root.querySelector('img')!.getAttribute('src')).toBe('/api/v1/characters/selected-id/avatar?size=lg');
  expect(root.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.');
  expect(root.querySelector('.jb-profile-notes')!.textContent).not.toContain('Private definition.');
  expect(root.querySelector('.jb-profile-details')!.textContent).toContain('Private definition.');
  expect((root.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  expect(root.hasAttribute('aria-busy')).toBe(false);
});

test('public pictures and links survive while scripts, event handlers, frames and dangerous URLs are removed', async () => {
  result = async id => ({ id, name: '<img src=x onerror=alert(1)>', creator_notes: '<script>bad()</script><iframe src="https://example.com"></iframe><p onclick="bad()">Read <strong>this</strong>.</p><img src="https://example.com/art.png" onerror="bad()"><a href="javascript:bad()">bad link</a><a href="https://example.com/page">Good link</a>', description: '<script>Definition is text</script>' });
  cleanup = mountCharacterProfile(ctx, root, 'safe'); await flush();
  const notes = root.querySelector('.jb-profile-notes')!;
  expect(root.querySelector('h2')!.textContent).toBe('<img src=x onerror=alert(1)>');
  expect(notes.querySelectorAll('script,iframe,[onclick],[onerror]')).toHaveLength(0);
  expect(notes.querySelector('img')!.getAttribute('src')).toBe('https://example.com/art.png');
  expect(notes.querySelector('a')!.hasAttribute('href')).toBe(false);
  expect(notes.querySelectorAll('a')[1].getAttribute('rel')).toBe('noopener noreferrer');
  expect(notes.querySelector('strong')!.textContent).toBe('this');
  expect(root.querySelector('.jb-profile-details script')).toBeNull();
});

test('empty creator notes never expose the definition as their fallback', async () => {
  result = async id => ({ id, name: 'Empty note', creator_notes: '', description: 'Definition only' });
  cleanup = mountCharacterProfile(ctx, root, 'empty'); await flush();
  expect(root.querySelector('.jb-profile-notes')!.textContent).toBe('Creator’s NoteNo creator’s note.');
  expect(injections).toHaveLength(0);
});

test('mismatched responses show a retry without exposing another card', async () => {
  result = async () => ({ id: 'wrong-id', name: 'Wrong character', creator_notes: 'Wrong note' });
  cleanup = mountCharacterProfile(ctx, root, 'selected'); await flush();
  expect(root.textContent).toContain('Could not load'); expect(root.textContent).not.toContain('Wrong');
  result = async id => ({ id, name: 'Correct character', creator_notes: 'Correct note' });
  root.querySelector('button')!.click(); await flush();
  expect(reads).toEqual(['selected', 'selected']); expect(root.textContent).toContain('Correct character');
});

test('dismissal clears injected content and a late read cannot restore it', async () => {
  cleanup = mountCharacterProfile(ctx, root, 'loaded'); await flush();
  cleanup(); expect(removed).toHaveLength(1); expect(root.childNodes).toHaveLength(0);
  let finish!: (value: unknown) => void;
  result = () => new Promise(resolve => { finish = resolve; });
  cleanup = mountCharacterProfile(ctx, root, 'late'); cleanup();
  finish({ id: 'late', name: 'Late result', creator_notes: 'Should not appear' }); await flush();
  expect(root.childNodes).toHaveLength(0); expect(injections).toHaveLength(1);
});

test('injection failure keeps the note readable as inert text', async () => {
  ctx.dom.inject = () => { throw new Error('Unavailable'); };
  result = async id => ({ id, name: 'Fallback', creator_notes: '<b>Readable note</b>' });
  cleanup = mountCharacterProfile(ctx, root, 'fallback'); await flush();
  expect(root.querySelector('.jb-profile-rich')!.textContent).toBe('<b>Readable note</b>');
  expect(root.querySelector('.jb-profile-rich b')).toBeNull();
});

test('card preview keeps notes as a short inert introduction while preserving the separate full-notes reader', async () => {
  result = async id => ({ id, name: 'Card preview', creator_notes: '<p>' + 'Story '.repeat(100) + '</p><img src="https://example.com/art.png">', description: 'Card definition' });
  cleanup = mountCharacterProfile(ctx, root, 'preview', { notesPreview: true }); await flush();
  const content = root.querySelector('.jb-profile-rich')!;
  expect(content.textContent!.length).toBe(351); expect(content.textContent!.endsWith('…')).toBe(true);
  expect(content.querySelector('img')).toBeNull(); expect(injections).toHaveLength(0);
  expect((root.querySelector('.jb-profile-details') as HTMLDetailsElement).open).toBe(false);
  cleanup(); cleanup = mountCharacterProfile(ctx, root, 'preview'); await flush();
  expect(root.querySelector('.jb-profile-notes img')).not.toBeNull();
  expect(root.querySelector('.jb-profile-rich')!.textContent!.length).toBeGreaterThan(350);
});
