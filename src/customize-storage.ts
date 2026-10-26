import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

type Json = Record<string, unknown>;
export type Appearance = {
  fontSize: number;
  fontFamily: string;
  colors: { text: string; italic: string; bold: string; code: string; dialogue: string; edited: string };
};
export type WallpaperRef = { image_id: string; type: 'image' | 'video' };
export type WallpaperSettings = Json & { global: WallpaperRef | null; mobile?: WallpaperRef | null; opacity: number; blur: number; fit: 'cover' | 'contain' | 'fill' };
export type CustomizeSnapshot = { appearance: Appearance; appearanceEnabled: boolean; wallpaper: WallpaperSettings; chatWallpaper: WallpaperRef | null; fallbackWallpaper?: WallpaperRef | null; canEditBackground: boolean };
export type CustomizeChanges = { appearance?: Appearance; wallpaper?: { opacity?: number; blur?: number; fit?: 'cover' | 'contain' | 'fill' }; background?: { file: File } | { remove: true } };
export const appearanceOverrideName = 'JanitorBridgeChatAppearance';
export const fontFamilies: Record<string, string> = {
  Default: 'Arial, Helvetica, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  'Courier New': '"Courier New", Courier, monospace',
  Georgia: 'Georgia, "Times New Roman", serif',
  'Comic Sans': '"Comic Sans MS", "Comic Sans", cursive',
  Impact: 'Impact, Haettenschweiler, sans-serif',
  'Trebuchet MS': '"Trebuchet MS", Arial, sans-serif',
};
export const defaultAppearance: Appearance = { fontSize: 15, fontFamily: 'Default', colors: { text: '#e4e3e7', italic: '#d3d0da', bold: '#efedf2', code: '#d2b7ea', dialogue: '#e4e3e7', edited: '#b39acb' } };
const defaultWallpaper: WallpaperSettings = { global: null, opacity: .1, blur: 0, fit: 'cover' };
const marker = 'janitor-bridge-appearance:v1';
function rec(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('Closed', 'AbortError'); }
function finite(value: unknown, min: number, max: number, label: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be between ${min} and ${max}.`); return value; }
function reference(value: unknown): WallpaperRef | null { const item = rec(value); return typeof item.image_id === 'string' && item.image_id && (item.type === 'image' || item.type === 'video') ? { image_id: item.image_id, type: item.type } : null; }
function validateAppearance(value: unknown): Appearance {
  const item = rec(value), colors = rec(item.colors);
  const fontSize = finite(item.fontSize, 8, 24, 'Font size');
  if (!Number.isInteger(fontSize)) throw new Error('Font size must be a whole number.');
  if (typeof item.fontFamily !== 'string' || !Object.hasOwn(fontFamilies, item.fontFamily)) throw new Error('Choose a supported font family.');
  const result = { fontSize, fontFamily: item.fontFamily, colors: {} as Appearance['colors'] };
  for (const name of Object.keys(defaultAppearance.colors) as Array<keyof Appearance['colors']>) {
    if (typeof colors[name] !== 'string' || !/^#[0-9a-f]{6}$/i.test(colors[name] as string)) throw new Error('Use six-digit HEX text colors.');
    result.colors[name] = (colors[name] as string).toLowerCase();
  }
  return result;
}
function appearanceFromCSS(css: unknown): Appearance {
  if (typeof css !== 'string') return structuredClone(defaultAppearance);
  const match = css.match(/\/\* janitor-bridge-appearance:v1 (\{[^*]*\}) \*\//);
  try { return match ? validateAppearance(JSON.parse(match[1])) : structuredClone(defaultAppearance); }
  catch { return structuredClone(defaultAppearance); }
}
export function appearanceCSS(value: Appearance): string {
  const item = validateAppearance(value), color = item.colors;
  // A fixed native component selector and validated values only. No author CSS,
  // URL, font downloads, TSX, or user-provided selector is interpolated.
  return `/* ${marker} ${JSON.stringify(item)} */\n[data-component="MessageContent"][data-component] { font-size: ${item.fontSize}px !important; font-family: ${fontFamilies[item.fontFamily]} !important; color: ${color.text} !important; --lumiverse-prose-italic: ${color.italic} !important; --lumiverse-prose-bold: ${color.bold} !important; --lumiverse-prose-dialogue: ${color.dialogue} !important; }\n[data-component="MessageContent"][data-component] code { color: ${color.code} !important; }`;
}
async function request(path: string, signal?: AbortSignal, method = 'GET', body?: unknown, optional = false): Promise<unknown> {
  abortIfNeeded(signal);
  const form = body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal, ...(form ? {} : { headers: { 'Content-Type': 'application/json' } }), ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) });
  if (optional && response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Could not ${method === 'GET' ? 'read' : 'save'} customization (${response.status}).`);
  return response.json();
}
async function setting(key: string, signal?: AbortSignal): Promise<unknown> { return rec(await request(`/settings/${encodeURIComponent(key)}`, signal, 'GET', undefined, true)).value; }
function wallpaperValue(value: unknown): WallpaperSettings {
  const item = rec(value);
  return { ...item, global: reference(item.global), ...(Object.hasOwn(item, 'mobile') ? { mobile: reference(item.mobile) } : {}), opacity: typeof item.opacity === 'number' && Number.isFinite(item.opacity) ? Math.min(1, Math.max(0, item.opacity)) : defaultWallpaper.opacity, blur: typeof item.blur === 'number' && Number.isFinite(item.blur) ? Math.min(8, Math.max(0, item.blur)) : 0, fit: ['cover', 'contain', 'fill'].includes(String(item.fit)) ? item.fit as WallpaperSettings['fit'] : 'cover' };
}
export async function loadCustomize(ctx: SpindleFrontendContext, chatId: string, signal?: AbortSignal, mobile = false): Promise<CustomizeSnapshot> {
  const [overridesValue, wallpaper, grants] = await Promise.all([setting('componentOverrides', signal), setting('wallpaper', signal), ctx.permissions.getGranted()]);
  abortIfNeeded(signal);
  const entry = rec(rec(overridesValue)[appearanceOverrideName]);
  const canEditBackground = !!chatId && grants.includes('chats');
  const chat = canEditBackground ? rec(await request(`/chats/${encodeURIComponent(chatId)}?messages=false`, signal)) : {};
  const metadata = rec(chat.metadata), settings = wallpaperValue(wallpaper);
  return { appearance: appearanceFromCSS(entry.css), appearanceEnabled: entry.enabled !== false, wallpaper: settings, chatWallpaper: reference(metadata[mobile ? 'mobile_wallpaper' : 'wallpaper']), fallbackWallpaper: mobile ? reference(metadata.wallpaper) ?? settings.mobile ?? settings.global : settings.global, canEditBackground };
}
export class CustomizeSaveError extends Error {
  readonly saved: string[];
  readonly uploadedImageId?: string;
  constructor(message: string, saved: string[], uploadedImageId?: string) { super(message); this.name = 'CustomizeSaveError'; this.saved = [...saved]; this.uploadedImageId = uploadedImageId; }
}
/** Save only chosen categories, merging fresh native settings immediately before writes. */
export async function saveCustomize(ctx: SpindleFrontendContext, chatId: string, changes: CustomizeChanges, signal?: AbortSignal, mobile = false): Promise<{ saved: string[] }> {
  const appearance = changes.appearance === undefined ? undefined : validateAppearance(changes.appearance);
  const patch: Json = {};
  if (changes.wallpaper?.opacity !== undefined) patch.opacity = finite(changes.wallpaper.opacity, 0, 1, 'Background opacity');
  if (changes.wallpaper?.blur !== undefined) patch.blur = finite(changes.wallpaper.blur, 0, 8, 'Background blur');
  if (changes.wallpaper?.fit !== undefined) { if (!['cover', 'contain', 'fill'].includes(changes.wallpaper.fit)) throw new Error('Choose a supported background fit.'); patch.fit = changes.wallpaper.fit; }
  const file = changes.background && 'file' in changes.background ? changes.background.file : undefined;
  if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024)) throw new Error('Choose a PNG, JPEG, or WebP image up to 10 MiB.');
  if (changes.background && (!chatId || !(await ctx.permissions.getGranted()).includes('chats'))) throw new Error('Enable Chats permission to save this chat’s background.');
  abortIfNeeded(signal);
  const saved: string[] = []; let uploadedImageId: string | undefined;
  try {
    if (appearance) {
      const overrides = rec(await setting('componentOverrides', signal));
      const own = rec(overrides[appearanceOverrideName]);
      if (typeof own.tsx === 'string' && own.tsx.trim() && own.enabled !== true) throw new Error('This disabled appearance entry contains custom component code. Review it in Lumiverse’s component editor before enabling text changes.');
      await request('/settings/componentOverrides', signal, 'PUT', { value: { ...overrides, [appearanceOverrideName]: { ...own, css: appearanceCSS(appearance), tsx: typeof own.tsx === 'string' ? own.tsx : '', enabled: true } } });
      saved.push('text');
    }
    if (Object.keys(patch).length) {
      const current = rec(await setting('wallpaper', signal));
      await request('/settings/wallpaper', signal, 'PUT', { value: { ...defaultWallpaper, ...current, ...patch } });
      saved.push('background appearance');
    }
    if (changes.background) {
      if (!(await ctx.permissions.getGranted()).includes('chats')) throw new Error('Chats permission is no longer enabled.');
      let wallpaper: WallpaperRef | null = null;
      if (file) {
        const form = new FormData(); form.append('image', file);
        const uploaded = rec(await request('/images/wallpapers', signal, 'POST', form));
        if (typeof uploaded.id !== 'string' || !uploaded.id) throw new Error('Lumiverse did not confirm the uploaded background image.');
        uploadedImageId = uploaded.id; wallpaper = { image_id: uploadedImageId, type: 'image' };
      }
      if (!(await ctx.permissions.getGranted()).includes('chats')) throw new Error('Chats permission is no longer enabled.');
      await request(`/chats/${encodeURIComponent(chatId)}/metadata`, signal, 'PATCH', { [mobile ? 'mobile_wallpaper' : 'wallpaper']: wallpaper });
      saved.push('chat background');
    }
    return { saved };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Customization could not be saved.';
    throw new CustomizeSaveError(`${saved.length ? `Saved ${saved.join(' and ')}. ` : ''}${reason}${uploadedImageId ? ' The image was uploaded but was not assigned; check the background before retrying.' : ''}`, saved, uploadedImageId);
  }
}
