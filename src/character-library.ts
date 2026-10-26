/** Native saved-card summaries. A gallery group never replaces their record IDs. */
export type CharacterSummary = {
  id: string;
  name: string;
  description?: string;
  preview_description?: string;
  creator?: string;
  creator_notes?: string;
  folder?: string;
  tags?: string[];
  image_id?: string | null;
  library_scope?: 'mine' | 'shared';
  created_at?: number;
  updated_at?: number;
  has_alternate_greetings?: boolean;
};
export type CharacterGroup = { character: CharacterSummary; copies: CharacterSummary[] };
export type CharacterSignatureCache = Map<string, { revision: number; signature: string }>;
const MAX_CACHED_SIGNATURES = 500;
const TEXT_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator', 'creator_notes', 'system_prompt', 'post_history_instructions'] as const;
const LOCAL_FIELDS = new Set(['id', 'avatar_path', 'image_id', 'created_at', 'updated_at', 'user_id', 'deleting', 'folder', 'library_scope']);
// These describe an import or a local attachment, rather than an edited card.
// Copies remain individually selectable, including their lorebooks and images.
const LOCAL_EXTENSIONS = new Set(['jar_bridge', 'jar_companion', 'janitorai', 'janitor', 'janitor_public_view', 'character_version', 'world_book_id', 'world_book_ids', '_lumiverse_library_scope', 'original_image_id', 'avatar_crop_image_id']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const revision = (summary: CharacterSummary) => typeof summary.updated_at === 'number' && Number.isFinite(summary.updated_at) ? summary.updated_at : undefined;
const cancelled = () => new DOMException('The character library changed while loading.', 'AbortError');

/** Stable JSON preserves every array position and every authored string. */
function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Unsupported card data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map(item => canonical(item, seen)).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}

function signature(value: unknown, summary: CharacterSummary): string | undefined {
  if (!record(value) || value.id !== summary.id || TEXT_FIELDS.some(key => typeof value[key] !== 'string') || !strings(value.tags) || !strings(value.alternate_greetings) || !record(value.extensions)) return;
  // A concurrent native edit must not be grouped using the earlier summary.
  const expected = revision(summary);
  if (expected !== undefined && value.updated_at !== expected) return;
  const core: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) if (!LOCAL_FIELDS.has(key) && key !== 'extensions') core[key] = field;
  core.extensions = Object.fromEntries(Object.entries(value.extensions).filter(([key]) => !LOCAL_EXTENSIONS.has(key)));
  // Unknown authored fields and extension settings are included conservatively,
  // so future prompt overrides cannot silently disappear into another tile.
  return canonical(core);
}

function candidateKey(summary: CharacterSummary): string {
  const label = (value = '') => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return JSON.stringify([label(summary.name), label(summary.creator), summary.description ?? '']);
}

/**
 * Group identical card contents without deleting, editing or reading any chat.
 * Only candidate collisions need full records. Every saved copy stays reachable.
 */
export async function groupCharacters(
  summaries: readonly CharacterSummary[],
  getFull: (id: string) => Promise<unknown>,
  cache: CharacterSignatureCache,
  isCurrent: () => boolean = () => true,
): Promise<CharacterGroup[]> {
  if (!isCurrent()) throw cancelled();
  // Retain the first native summary and its position, even if pages overlap.
  const seenIds = new Set<string>();
  const rows: CharacterSummary[] = [];
  for (const summary of summaries) if (!seenIds.has(summary.id)) { seenIds.add(summary.id); rows.push(summary); }
  const buckets = new Map<string, CharacterSummary[]>();
  for (const row of rows) {
    const key = candidateKey(row), bucket = buckets.get(key) ?? [];
    bucket.push(row); buckets.set(key, bucket);
  }
  const candidates = [...buckets.values()].filter(bucket => bucket.length > 1).flat();
  const signatures = new Map<string, string>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (next < candidates.length) {
      if (!isCurrent()) throw cancelled();
      const row = candidates[next++], expected = revision(row), saved = cache.get(row.id);
      if (expected !== undefined && saved?.revision === expected) { signatures.set(row.id, saved.signature); continue; }
      if (saved) cache.delete(row.id);
      try {
        const full = await getFull(row.id);
        if (!isCurrent()) throw cancelled();
        const value = signature(full, row);
        if (value === undefined) continue;
        signatures.set(row.id, value);
        if (expected !== undefined) {
          cache.set(row.id, { revision: expected, signature: value });
          while (cache.size > MAX_CACHED_SIGNATURES) cache.delete(cache.keys().next().value!);
        }
      } catch (error) { if (!isCurrent() || error instanceof DOMException && error.name === 'AbortError') throw cancelled(); }
    }
  }));
  if (!isCurrent()) throw cancelled();
  const groups: CharacterGroup[] = [], joined = new Map<string, Map<string, CharacterGroup>>();
  for (const row of rows) {
    const value = signatures.get(row.id), key = candidateKey(row);
    const bucket = joined.get(key) ?? new Map<string, CharacterGroup>();
    const existing = value === undefined ? undefined : bucket.get(value);
    if (existing) existing.copies.push(row);
    else {
      const group = { character: row, copies: [row] };
      groups.push(group);
      if (value !== undefined) { bucket.set(value, group); joined.set(key, bucket); }
    }
  }
  return groups;
}
