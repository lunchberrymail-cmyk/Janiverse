export type CreatorAttribution = { name: string; profileUrl?: string };

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const creatorId = new RegExp(`^${uuid}$`, 'i');
const profilePath = new RegExp(`^/profiles/(${uuid})(?:[-_][^/]*)?/?$`, 'i');
const importerNames = /^janitor-lorebook-extractor$/i;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function name(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}
function authorName(value: unknown): string {
  const text = name(value);
  return importerNames.test(text) ? '' : text;
}
function normalizedName(value: string): string { return value.replace(/^@/, '').normalize('NFKC').toLowerCase(); }

/** Accept only explicit JanitorAI profile routes; never turn a display name into a username URL. */
export function janitorCreatorProfileUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['janitorai.com', 'www.janitorai.com'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port) return;
    const match = profilePath.exec(url.pathname);
    if (!match) return;
    return `https://janitorai.com/profiles/${match[1].toLowerCase()}`;
  } catch { return; }
}

type Provenance = { name: string; profileUrl?: string };
function provenance(value: unknown): Provenance | undefined {
  const row = object(value), creator = object(row.creator), author = object(row.author);
  const creatorName = authorName(row.creator_name ?? row.creatorName ?? row.janitor_creator_name ?? creator.name ?? creator.display_name ?? row.author_name ?? author.name ?? (typeof row.creator === 'string' ? row.creator : undefined));
  if (!creatorName) return;
  const explicit = janitorCreatorProfileUrl(row.creator_profile_url ?? row.creatorProfileUrl ?? row.creator_url ?? row.author_url ?? creator.profile_url ?? creator.profileUrl ?? creator.url ?? author.profile_url);
  const id = row.creator_id ?? row.creatorId ?? row.janitor_creator_id ?? creator.id ?? author.id;
  const fromId = typeof id === 'string' && creatorId.test(id) ? `https://janitorai.com/profiles/${id.toLowerCase()}` : undefined;
  const profileUrl = explicit && fromId && explicit !== fromId ? undefined : explicit ?? fromId;
  return { name: creatorName, ...(profileUrl ? { profileUrl } : {}) };
}

/** Read only declared public author fields, never creator notes, chat data, or arbitrary nested metadata. */
export function creatorAttribution(value: unknown): CreatorAttribution | undefined {
  const outer = object(value);
  const card = /^chara_card_v[23]$/.test(String(outer.spec)) ? object(outer.data) : outer;
  const directProfile = janitorCreatorProfileUrl(card.creator);
  const nativeName = directProfile ? '' : authorName(card.creator);
  const extensions = object(card.extensions);
  const candidates: Provenance[] = [];
  for (const key of ['jar_bridge', 'jar_companion', 'janitorai', 'janitor', 'janitor_public_view']) {
    const row = object(extensions[key]);
    for (const data of [row, object(row.meta)]) {
      const found = provenance(data);
      if (found) candidates.push(found);
    }
  }
  // Datacat's exported CCv2 keeps these declared public fields in top-level
  // metadata; the native importer may retain only the creator profile URL.
  const exported = provenance(object(outer.metadata));
  if (exported) candidates.push(exported);
  if (directProfile) {
    const matched = candidates.filter(candidate => candidate.profileUrl === directProfile);
    const names = new Set(matched.map(candidate => normalizedName(candidate.name)));
    return { name: names.size === 1 ? matched[0].name : 'Creator profile', profileUrl: directProfile };
  }
  // A native creator field wins over imported display metadata. Never attach a
  // different author's profile merely because the card retained old provenance.
  if (nativeName) {
    const matches = candidates.filter(candidate => normalizedName(candidate.name) === normalizedName(nativeName));
    const urls = [...new Set(matches.map(candidate => candidate.profileUrl).filter((url): url is string => !!url))];
    return { name: nativeName, ...(urls.length === 1 ? { profileUrl: urls[0] } : {}) };
  }
  if (!candidates.length) return;
  const distinctNames = new Set(candidates.map(candidate => normalizedName(candidate.name)));
  if (distinctNames.size !== 1) return;
  const urls = [...new Set(candidates.map(candidate => candidate.profileUrl).filter((url): url is string => !!url))];
  return { name: candidates[0].name, ...(urls.length === 1 ? { profileUrl: urls[0] } : {}) };
}
