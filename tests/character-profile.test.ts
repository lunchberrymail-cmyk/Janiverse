import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { mountCharacterProfile } from '../src/character-profile';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));
async function openNotes() {
  const notes = root.querySelector('.jb-profile-notes') as HTMLDetailsElement;
  notes.open = true; notes.dispatchEvent(new dom.window.Event('toggle')); await flush(); return notes;
}
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

test('opens the selected full introduction immediately while keeping definition panels individually collapsed', async () => {
  cleanup = mountCharacterProfile(ctx, root, 'selected-id'); await flush();
  expect(reads).toEqual(['selected-id']); expect(root.querySelector('h2')!.textContent).toBe('Selected card');
  expect(root.querySelector('img')!.getAttribute('src')).toBe('/api/v1/characters/selected-id/avatar?size=lg');
  expect((root.querySelector('.jb-profile-notes') as HTMLDetailsElement).open).toBe(true);
  expect(root.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.'); expect(injections).toHaveLength(1);
  const notes = await openNotes();
  expect(root.querySelector('.jb-profile-notes')!.textContent).toContain('Full creator note.');
  expect(root.querySelector('.jb-profile-notes')!.textContent).not.toContain('Private definition.');
  expect(root.querySelector('.jb-profile-details')!.textContent).toContain('Private definition.');
  expect([...root.querySelectorAll<HTMLDetailsElement>('.jb-profile-field')].every(field => !field.open)).toBe(true);
  notes.open = false; notes.dispatchEvent(new dom.window.Event('toggle')); await flush(); await openNotes();
  expect(injections).toHaveLength(1);
  expect(root.hasAttribute('aria-busy')).toBe(false);
});

test('public pictures and links survive while scripts, event handlers, frames and dangerous URLs are removed', async () => {
  result = async id => ({ id, name: '<img src=x onerror=alert(1)>', creator_notes: '<script>bad()</script><iframe src="https://example.com"></iframe><p onclick="bad()">Read <strong>this</strong>.</p><img src="https://example.com/art.png" onerror="bad()"><a href="javascript:bad()">bad link</a><a href="https://example.com/page">Good link</a>', description: '<script>Definition is text</script>' });
  cleanup = mountCharacterProfile(ctx, root, 'safe'); await flush();
  const notes = await openNotes();
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
  cleanup = mountCharacterProfile(ctx, root, 'empty'); await flush(); await openNotes();
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
  cleanup = mountCharacterProfile(ctx, root, 'loaded'); await flush(); await openNotes();
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
  cleanup = mountCharacterProfile(ctx, root, 'fallback'); await flush(); await openNotes();
  expect(root.querySelector('.jb-profile-rich')!.textContent).toBe('<b>Readable note</b>');
  expect(root.querySelector('.jb-profile-rich b')).toBeNull();
});

test('card preview keeps notes as a short inert introduction while preserving the separate full-notes reader', async () => {
  result = async id => ({ id, name: 'Card preview', creator_notes: '<p>' + 'Story '.repeat(100) + '</p><img src="https://example.com/art.png">', description: 'Card definition' });
  cleanup = mountCharacterProfile(ctx, root, 'preview', { notesPreview: true }); await flush(); await openNotes();
  const content = root.querySelector('.jb-profile-rich')!;
  expect(content.textContent!.length).toBe(351); expect(content.textContent!.endsWith('…')).toBe(true);
  expect(content.querySelector('img')).toBeNull(); expect(injections).toHaveLength(0);
  expect([...root.querySelectorAll<HTMLDetailsElement>('.jb-profile-field')].every(field => !field.open)).toBe(true);
  cleanup(); cleanup = mountCharacterProfile(ctx, root, 'preview'); await flush(); await openNotes();
  expect(root.querySelector('.jb-profile-notes img')).not.toBeNull();
  expect(root.querySelector('.jb-profile-rich')!.textContent!.length).toBeGreaterThan(350);
});

test('closing the reader releases the introduction and detached disclosures cannot load it again', async () => {
  result = async id => ({ id, name: 'Lazy pictures', creator_notes: '<img src="https://example.com/art.png">' });
  cleanup = mountCharacterProfile(ctx, root, 'lazy'); await flush();
  const notes = root.querySelector('.jb-profile-notes') as HTMLDetailsElement;
  expect(notes.querySelector('img')).not.toBeNull(); expect(injections).toHaveLength(1); cleanup();
  notes.open = true; notes.dispatchEvent(new dom.window.Event('toggle')); await flush();
  expect(injections).toHaveLength(1); expect(removed).toHaveLength(1); expect(root.childNodes).toHaveLength(0);
});

test('all saved initial messages remain readable without changing the card or selecting a greeting', async () => {
  result = async id => ({ id, name: 'Multiple openings', description: 'Saved description', personality: 'Saved personality', scenario: 'Saved scenario', first_mes: 'Original opening', alternate_greetings: ['Second opening', null, '', '<script>Inert third opening</script>'], mes_example: 'Example dialog', system_prompt: 'Custom instruction', post_history_instructions: 'Last instruction' });
  cleanup = mountCharacterProfile(ctx, root, 'openings'); await flush();
  const fields = [...root.querySelectorAll<HTMLDetailsElement>('.jb-profile-field')];
  expect(fields.map(field => field.querySelector('summary span')!.textContent)).toEqual(['Scenario', 'Personality', 'Initial messages', 'Example dialogs', 'System prompt', 'Post-history instructions']);
  const messages = fields[2]; expect(messages.querySelector('.jb-profile-field-count')!.textContent).toBe('3');
  expect(messages.textContent).toContain('Original opening'); expect(messages.textContent).toContain('Second opening');
  expect(messages.textContent).toContain('Alternate greeting 4'); expect(messages.querySelector('script')).toBeNull();
  expect(fields[1].textContent).toContain('Saved description'); expect(fields[1].textContent).toContain('Saved personality');
  messages.open = true; messages.dispatchEvent(new dom.window.Event('toggle')); await flush();
  expect(fields[0].open).toBe(false); expect(reads).toEqual(['openings']);
});

test('a failed portrait retains its fallback and missing fields do not borrow creator notes', async () => {
  result = async id => ({ id, name: 'No artwork', creator_notes: 'Public introduction only', first_mes: '', alternate_greetings: [] });
  cleanup = mountCharacterProfile(ctx, root, 'no-art'); await flush();
  root.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
  expect(root.querySelector('.jb-profile-media img')).toBeNull();
  expect(root.querySelector('.jb-profile-avatar-fallback')!.textContent).toBe('N');
  expect(root.querySelectorAll('.jb-profile-empty')).toHaveLength(4);
  expect(root.querySelector('.jb-profile-details')!.textContent).not.toContain('Public introduction only');
  expect(root.querySelector('.jb-profile-field-count')!.textContent).toBe('0');
});

test('retry preserves functional action controls while late content is still discarded on dismissal', async () => {
  let clicks = 0; const controls = document.createElement('div'); controls.className = 'jb-profile-controls';
  const action = document.createElement('button'); action.textContent = 'Start new chat'; action.onclick = () => clicks++; controls.append(action);
  result = async () => { throw new Error('Unavailable'); };
  cleanup = mountCharacterProfile(ctx, root, 'retry', { controls }); await flush();
  expect(controls.isConnected).toBe(true);
  result = async id => ({ id, name: 'Recovered', creator_notes: 'Recovered note' });
  [...root.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click(); await flush();
  expect(controls.parentElement!.className).toBe('jb-profile-sidebar'); action.click(); expect(clicks).toBe(1);
  expect(root.querySelectorAll('.jb-profile-controls')).toHaveLength(1);
  cleanup(); expect(root.childNodes).toHaveLength(0); expect(removed).toHaveLength(1);
});
