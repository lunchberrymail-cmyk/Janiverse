import { expect, test } from 'bun:test';
import { groupCharacters, type CharacterSignatureCache, type CharacterSummary } from '../src/character-library';

const summary = (id: string, values: Partial<CharacterSummary> = {}): CharacterSummary => ({ id, name: 'The observatory keeper', creator: 'An Author', description: 'A quiet astronomer.', created_at: 10, updated_at: 20, tags: ['astronomy'], ...values });
const full = (row: CharacterSummary, values: Record<string, unknown> = {}) => ({ ...row, personality: 'Patient and curious.', scenario: 'An observatory.', first_mes: 'Welcome to the observatory.', mes_example: '', creator_notes: 'A fictional character.', system_prompt: '', post_history_instructions: '', alternate_greetings: [], extensions: {}, ...values });
const cache = (): CharacterSignatureCache => new Map();
const ids = (groups: Awaited<ReturnType<typeof groupCharacters>>) => groups.map(group => group.copies.map(row => row.id));

test('unique cards never fetch full definitions and retain the native order', async () => {
  const rows = [summary('z'), summary('a', { name: 'The lighthouse keeper' })];
  let reads = 0;
  const groups = await groupCharacters(rows, async () => { reads++; throw new Error('unneeded read'); }, cache());
  expect(reads).toBe(0); expect(ids(groups)).toEqual([['z'], ['a']]);
  expect(groups[0].character).toBe(rows[0]);
});

test('identical imported cards have one tile while retaining each original copy and sort representative', async () => {
  const rows = [summary('new', { created_at: 30, image_id: 'portrait-new' }), summary('middle', { image_id: 'portrait-middle' }), summary('old', { image_id: 'portrait-old' })];
  const before = JSON.stringify(rows);
  const cards = new Map(rows.map(row => [row.id, full(row, { avatar_path: `${row.id}.png`, extensions: row.id === 'old' ? { jar_companion: { url: 'https://janitorai.com/characters/example', importedAt: 1 }, world_book_ids: ['old-lorebook'], _lumiverse_library_scope: 'mine' } : { jar_bridge: { source: 'janitorai', soundcloud_track_id: '123' }, character_version: '2' } })]));
  const groups = await groupCharacters(rows, async id => cards.get(id), cache());
  expect(ids(groups)).toEqual([['new', 'middle', 'old']]);
  expect(groups[0].character).toBe(rows[0]); expect(JSON.stringify(rows)).toBe(before);
});

test('a duplicate native ID is rendered once without fetching or replacing the first summary', async () => {
  const original = summary('same'), later = summary('same', { name: 'A later overlapping response' });
  let reads = 0;
  const groups = await groupCharacters([original, later], async () => { reads++; return full(original); }, cache());
  expect(reads).toBe(0); expect(ids(groups)).toEqual([['same']]); expect(groups[0].character).toBe(original);
});

test('matching names with a different creator or description stay distinct without full reads', async () => {
  const rows = [summary('one'), summary('two', { creator: 'Another Author' }), summary('three', { description: 'A different card.' })];
  let reads = 0;
  const groups = await groupCharacters(rows, async () => { reads++; return undefined; }, cache());
  expect(reads).toBe(0); expect(ids(groups)).toEqual([['one'], ['two'], ['three']]);
});

test('edits to each authored field keep a card distinct even when the gallery summary matches', async () => {
  for (const [key, value] of Object.entries({ name: 'Edited name', creator: 'Edited author', description: 'Edited description', personality: 'Edited personality', scenario: 'Edited scenario', first_mes: 'Edited greeting', mes_example: 'Edited examples', creator_notes: 'Edited notes', system_prompt: 'Edited prompt', post_history_instructions: 'Edited history instructions', tags: ['different'], alternate_greetings: ['New alternate greeting'], talkativeness: 0.8 })) {
    const rows = [summary('one'), summary('two')];
    const groups = await groupCharacters(rows, async id => full(rows.find(row => row.id === id)!, id === 'two' ? { [key]: value } : {}), cache());
    expect(ids(groups)).toEqual([['one'], ['two']]);
  }
});

test('native prompt overrides, embedded lorebook content, and unknown extension edits stay distinct', async () => {
  for (const extensions of [{ depth_prompt: 'Whisper carefully.' }, { alternate_character_name: 'Astronomer' }, { character_book: { entries: [{ content: 'An authored fact.' }] } }, { future_prompt_override: { enabled: true } }]) {
    const rows = [summary('one'), summary('two')];
    const groups = await groupCharacters(rows, async id => full(rows.find(row => row.id === id)!, { extensions: id === 'two' ? extensions : {} }), cache());
    expect(ids(groups)).toEqual([['one'], ['two']]);
  }
});

test('object property order does not create a false variant; authored array ordering does', async () => {
  const rows = [summary('one'), summary('two')];
  const grouped = await groupCharacters(rows, async id => full(rows.find(row => row.id === id)!, { extensions: id === 'one' ? { depth_prompt: { role: 'system', content: 'Whisper.' } } : { depth_prompt: { content: 'Whisper.', role: 'system' } } }), cache());
  expect(ids(grouped)).toEqual([['one', 'two']]);
  const different = await groupCharacters(rows, async id => full(rows.find(row => row.id === id)!, { alternate_greetings: id === 'one' ? ['First', 'Second'] : ['Second', 'First'] }), cache());
  expect(ids(different)).toEqual([['one'], ['two']]);
});

test('failed, mismatched, incomplete, and concurrently edited full reads remain separate', async () => {
  for (const value of [null, { id: 'two' }, full(summary('another')), full(summary('two'), { updated_at: 21 })]) {
    const rows = [summary('one'), summary('two')];
    const groups = await groupCharacters(rows, async id => id === 'one' ? full(rows[0]) : value, cache());
    expect(ids(groups)).toEqual([['one'], ['two']]);
  }
  const rows = [summary('one'), summary('two')];
  const groups = await groupCharacters(rows, async id => { if (id === 'two') throw new Error('Read failed'); return full(rows[0]); }, cache());
  expect(ids(groups)).toEqual([['one'], ['two']]);
});

test('same revisions reuse signatures while an edited revision is read again and stays distinct', async () => {
  const saved = cache(), rows = [summary('one'), summary('two')];
  let reads: string[] = [];
  const read = async (id: string) => { reads.push(id); return full(rows.find(row => row.id === id)!, id === 'two' && rows[1].updated_at === 21 ? { creator_notes: 'Updated notes.' } : {}); };
  expect(ids(await groupCharacters(rows, read, saved))).toEqual([['one', 'two']]);
  expect(reads).toEqual(['one', 'two']); reads = [];
  expect(ids(await groupCharacters(rows, read, saved))).toEqual([['one', 'two']]); expect(reads).toEqual([]);
  rows[1] = summary('two', { updated_at: 21 });
  expect(ids(await groupCharacters(rows, read, saved))).toEqual([['one'], ['two']]); expect(reads).toEqual(['two']);
});

test('summaries without a native revision are never cached', async () => {
  const rows = [summary('one', { updated_at: undefined }), summary('two', { updated_at: undefined })], saved = cache();
  let reads = 0;
  const read = async (id: string) => { reads++; return full(rows.find(row => row.id === id)!); };
  await groupCharacters(rows, read, saved); await groupCharacters(rows, read, saved);
  expect(reads).toBe(4); expect(saved.size).toBe(0);
});

test('collision comparisons are globally bounded to four concurrent reads', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => summary(String(index), { name: `Keeper ${index % 2}` }));
  let active = 0, maxActive = 0;
  const groups = await groupCharacters(rows, async id => { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 1)); active--; return full(rows.find(row => row.id === id)!); }, cache());
  expect(maxActive).toBe(4); expect(groups).toHaveLength(2); expect(groups.flatMap(group => group.copies)).toHaveLength(12);
});

test('cancelled work rejects without caching late reads or starting the next queued comparison', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => summary(String(index))), saved = cache();
  let current = true, reads = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = groupCharacters(rows, async id => { reads++; await gate; return full(rows.find(row => row.id === id)!); }, saved, () => current);
  expect(reads).toBe(4); current = false; release();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(reads).toBe(4); expect(saved.size).toBe(0);
});

test('signature cache is bounded even when many imported copies collide', async () => {
  const rows = Array.from({ length: 520 }, (_, index) => summary(String(index))), saved = cache();
  expect(ids(await groupCharacters(rows, async id => full(rows.find(row => row.id === id)!), saved))[0]).toHaveLength(520);
  expect(saved.size).toBe(500);
});
