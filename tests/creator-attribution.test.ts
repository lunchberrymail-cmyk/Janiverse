import { expect, test } from 'bun:test';
import { creatorAttribution, janitorCreatorProfileUrl } from '../src/creator-attribution';

const id = 'fcd544f1-182a-43d9-a9e1-0a1de8fe0fb9';
const profileUrl = `https://janitorai.com/profiles/${id}`;

test('keeps a native creator as text without inventing their JanitorAI username', () => {
  expect(creatorAttribution({ creator: '  An Author ♡  ' })).toEqual({ name: 'An Author ♡' });
  expect(creatorAttribution({ creator: '@Author' })).toEqual({ name: '@Author' });
  expect(creatorAttribution({ creator: '<b>Author</b>' })).toEqual({ name: '<b>Author</b>' });
});

test('recovers JAR public attribution and profile from an exact saved creator id', () => {
  expect(creatorAttribution({ creator: '', extensions: { jar_bridge: { source: 'janitorai', creator_name: 'Bride4corpse', creator_id: id, soundcloud_track_id: '123' } } })).toEqual({ name: 'Bride4corpse', profileUrl });
  expect(creatorAttribution({ creator: 'janitor-lorebook-extractor', extensions: { jar_bridge: { creator_name: 'Bride4corpse', creator_id: id } } })).toEqual({ name: 'Bride4corpse', profileUrl });
  expect(creatorAttribution({ spec: 'chara_card_v2', data: { creator: 'Bride4corpse', extensions: { jar_bridge: { creator_name: 'Bride4corpse', creator_id: id } } } })).toEqual({ name: 'Bride4corpse', profileUrl });
});

test('reads explicit author provenance from supported legacy extension containers', () => {
  for (const key of ['jar_companion', 'janitorai', 'janitor', 'janitor_public_view']) {
    expect(creatorAttribution({ extensions: { [key]: { meta: { creator_name: 'Author', creator_profile_url: `${profileUrl}_author?tracking=ignored#section` } } } })).toEqual({ name: 'Author', profileUrl });
  }
  expect(creatorAttribution({ extensions: { jar_bridge: { creator: { name: 'Author', id } } } })).toEqual({ name: 'Author', profileUrl });
});

test('supports actual Datacat public metadata and creator URL without deriving a username', () => {
  expect(creatorAttribution({ spec: 'chara_card_v2', data: { creator: profileUrl }, metadata: { janitor_creator_name: 'Author 🌼', janitor_creator_id: id } })).toEqual({ name: 'Author 🌼', profileUrl });
  expect(creatorAttribution({ creator: profileUrl })).toEqual({ name: 'Creator profile', profileUrl });
  expect(creatorAttribution({ spec: 'chara_card_v2', data: { creator: profileUrl }, metadata: { janitor_creator_name: 'Wrong Author', janitor_creator_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } })).toEqual({ name: 'Creator profile', profileUrl });
});

test('missing attribution is unknown, never guessed from card name, character id, notes, or importer', () => {
  for (const card of [null, undefined, [], { creator: '' }, { creator: 'janitor-lorebook-extractor' }, { name: 'By Author', creator_notes: `@Author ${profileUrl}` }, { extensions: { jar_bridge: { soundcloud_track_id: '123', character_id: id }, arbitrary: { creator_name: 'Wrong' } } }]) expect(creatorAttribution(card)).toBeUndefined();
});

test('a native edited author never inherits a different author profile and ambiguous provenance is not guessed', () => {
  expect(creatorAttribution({ creator: 'New Author', extensions: { jar_bridge: { creator_name: 'Old Author', creator_id: id } } })).toEqual({ name: 'New Author' });
  expect(creatorAttribution({ creator: '@Author', extensions: { jar_bridge: { creator_name: 'author', creator_id: id } } })).toEqual({ name: '@Author', profileUrl });
  expect(creatorAttribution({ extensions: { jar_bridge: { creator_name: 'First', creator_id: id }, janitor: { creator_name: 'Second', creator_id: id } } })).toBeUndefined();
  expect(creatorAttribution({ creator: 'Author', extensions: { jar_bridge: { creator_name: 'Author', creator_id: id }, janitor: { creator_name: 'Author', creator_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } })).toEqual({ name: 'Author' });
  expect(creatorAttribution({ extensions: { jar_bridge: { creator_name: 'Author', creator_id: id, creator_profile_url: 'https://janitorai.com/profiles/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } })).toEqual({ name: 'Author' });
});

test('allows only credential-free HTTPS JanitorAI profile UUID routes', () => {
  expect(janitorCreatorProfileUrl(`https://www.janitorai.com/profiles/${id.toUpperCase()}_A%20Name?ref=card`)).toBe(profileUrl);
  for (const url of ['javascript:alert(1)', `http://janitorai.com/profiles/${id}`, `https://janitorai.com.evil.test/profiles/${id}`, `https://evil.test/profiles/${id}`, `https://user:pass@janitorai.com/profiles/${id}`, `https://janitorai.com:4577/profiles/${id}`, `https://janitorai.com/characters/${id}`, 'https://janitorai.com/profiles/Author', `https://janitorai.com/profiles/${id}/other`, `https://janitorai.com\\profiles\\${id}`, ` https://janitorai.com/profiles/${id}`]) expect(janitorCreatorProfileUrl(url)).toBeUndefined();
});

test('invalid creator id or link retains honest attribution without a guessed link', () => {
  for (const creator_id of ['Author Name', `../${id}`, 123, { id }, '']) expect(creatorAttribution({ extensions: { jar_bridge: { creator_name: 'Author', creator_id, creator_profile_url: 'javascript:bad()' } } })).toEqual({ name: 'Author' });
});
