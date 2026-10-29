import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { characterSoundCloudTrack, soundCloudTrackInput } from './soundcloud';
import { uuid } from './uuid';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Shared local-only input. Extracting a track never loads SoundCloud or pasted markup. */
export function createSoundtrackField() {
  const root = el('div', 'jb-soundtrack-field');
  const input = el('textarea', 'jb-settings-textarea'); input.name = 'soundcloud_track'; input.id = `jb-soundtrack-${uuid()}`; input.rows = 2; input.maxLength = 12_000;
  input.placeholder = 'SoundCloud track link or <iframe …></iframe>'; input.autocomplete = 'off'; input.spellcheck = false;
  const label = el('label', 'jb-settings-label', 'SoundCloud track'); label.htmlFor = input.id;
  const hint = el('p', 'jb-settings-help', 'Paste a public track link or its embed code. Single tracks only. Listeners choose Play; music never starts automatically.'); hint.id = `${input.id}-help`; input.setAttribute('aria-describedby', hint.id);
  const extract = el('button', 'jb-button', 'Extract track'); extract.type = 'button';
  const status = el('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const help = el('details', 'jb-soundtrack-help'); help.append(el('summary', '', 'Where do I find the embed code?'), el('p', 'jb-settings-help', 'On SoundCloud, open the track → Share → Embed → copy the iframe code. Your soundtrack is saved with the character and plays in its profile and chats.'));
  root.append(label, input, hint, extract, status, help);
  function validate(required = false) {
    if ((!required && !input.value.trim()) || soundCloudTrackInput(input.value)) { input.removeAttribute('aria-invalid'); status.textContent = ''; return true; }
    input.setAttribute('aria-invalid', 'true'); status.textContent = 'Use a public SoundCloud track link or its SoundCloud embed code. Playlists and private links are not supported.'; input.focus(); return false;
  }
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); status.textContent = ''; });
  extract.addEventListener('click', () => { if (!validate(true)) return; input.value = soundCloudTrackInput(input.value)!; status.textContent = 'Track ready. Save the character or soundtrack to keep it.'; });
  return { root, input, validate, getTrack: () => soundCloudTrackInput(input.value) };
}

/** Attach music to an existing native card, preserving every other extension field. */
export function mountSoundtrackEditor(ctx: SpindleFrontendContext, root: HTMLElement, character: Record<string, unknown>, onSaved: () => void) {
  const id = String(character.id), controller = new AbortController();
  let disposed = false, busy = false, saved = characterSoundCloudTrack(character), attemptedPermission = false;
  const panel = el('details', 'jb-soundtrack-editor');
  const title = el('summary');
  const field = createSoundtrackField(); field.input.value = saved ?? '';
  const fields = el('fieldset', 'jb-soundtrack-fields');
  const actions = el('div', 'jb-soundtrack-actions');
  const save = el('button', 'jb-button jb-primary', 'Save soundtrack'); save.type = 'button';
  const remove = el('button', 'jb-settings-link', 'Remove soundtrack'); remove.type = 'button';
  const enable = el('button', 'jb-button', 'Enable Characters permission'); enable.type = 'button'; enable.hidden = true;
  const status = el('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  actions.append(save, remove, enable); fields.append(field.root, actions); panel.append(title, fields, status); root.append(panel);
  const sync = () => { fields.disabled = busy; title.textContent = saved ? 'Change attached song' : 'Attach a song (optional)'; remove.hidden = !saved; save.textContent = busy ? 'Saving…' : 'Save soundtrack'; panel.setAttribute('aria-busy', String(busy)); };
  sync();
  async function permission(request: boolean) {
    let granted = await ctx.permissions.getGranted(); if (disposed) return false;
    if (!granted.includes('characters') && request) { attemptedPermission = true; await ctx.permissions.request(['characters'], { reason: 'Save the SoundCloud soundtrack on this character card.' }); if (disposed) return false; granted = await ctx.permissions.getGranted(); }
    if (disposed) return false;
    const allowed = granted.includes('characters'); enable.hidden = allowed;
    if (!allowed) status.textContent = 'Enable Characters permission to save this soundtrack. Your draft is still here.';
    return allowed;
  }
  enable.addEventListener('click', () => { if (disposed || busy) return; busy = true; sync(); void permission(true).catch(() => { if (!disposed) status.textContent = 'Characters permission could not be checked.'; }).finally(() => { busy = false; if (!disposed) sync(); }); });
  async function persist(track: string | null) {
    if (disposed || busy) return;
    busy = true; sync(); status.textContent = 'Saving soundtrack…';
    let sent = false;
    try {
      if (!await permission(!attemptedPermission) || disposed) return;
      // Read just before writing so imports, lorebooks, avatars and other extension metadata survive.
      const fresh = record(await ctx.characters.get(id)); if (disposed) return;
      if (fresh.id !== id) throw new Error('Character unavailable');
      const extensions = record(fresh.extensions);
      const next = { ...extensions, janiverse: { ...record(extensions.janiverse), soundcloud_track_id: track } };
      sent = true;
      const response = await fetch(`/api/v1/characters/${encodeURIComponent(id)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extensions: next }), signal: controller.signal });
      if (disposed) return;
      if (!response.ok) throw new Error('Save failed');
      const result = record(await response.json()); if (disposed) return;
      if (result.id !== id || characterSoundCloudTrack(result) !== track) throw new Error('Unconfirmed save');
      saved = track; field.input.value = track ?? ''; field.input.removeAttribute('aria-invalid');
      status.textContent = track ? 'Soundtrack saved. Use Play in this profile or chat.' : 'Soundtrack removed.';
      try { onSaved(); } catch { /* A refresh cannot turn a successful save into a failed write. */ }
    } catch {
      if (!disposed) status.textContent = sent ? 'The save could not be confirmed. Reopen the profile to check before trying again. Your draft is still here.' : 'Could not save this soundtrack. Your draft is still here.';
    } finally { busy = false; if (!disposed) sync(); }
  }
  save.addEventListener('click', () => { if (field.validate(true)) void persist(field.getTrack()); });
  remove.addEventListener('click', () => { void persist(null); });
  return () => { disposed = true; controller.abort(); panel.remove(); };
}
