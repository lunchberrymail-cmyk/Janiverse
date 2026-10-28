import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { icon } from './icons';
import type { ImportGuideAttachment } from './import-tutorial';

type Character = { id: string; name: string; image_id?: string };
type Item = { key: number; source: string; kind: 'file' | 'link'; label: string; detail: string; file?: File; url?: string; state: 'queued' | 'importing' | 'success' | 'error' | 'uncertain'; message?: string; character?: Character };
type Options = { onImported?: () => void; openCharacter?: (id: string) => void };
type Session = { modal: SpindleModalHandle; abort: AbortController; closed: boolean };
const maximum = 20;
// Match known validation errors from before the host creates a character.
// HTTP 400 alone is insufficient: subsequent image and module writes can fail.
const preCreateErrors = new Set([
  'Invalid JSON in uploaded file', 'file is required',
  "Character card is missing required 'name' field",
  'Invalid character card: expected a JSON object',
  "PNG does not contain a character card (no 'chara' or 'ccv3' text chunk found)",
  'JPEG file does not contain embedded character card data', 'Not a valid PNG file',
]);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') { const element = document.createElement(tag); element.className = className; element.textContent = text; return element; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function fileSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function publicLink(value: string): URL | null {
  try { const url = new URL(value.trim()); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !!url.hostname ? url : null; }
  catch { return null; }
}
function linkLabel(url: URL) { return `${url.host}${url.pathname === '/' ? '' : url.pathname}`; }
function errorText(value: unknown, item: Item) {
  const body = record(value); const code = body.code;
  if (code === 'file_too_large') return 'This card exceeds Lumiverse’s file size limit.';
  if (code === 'archive_decompresses_too_large') return 'The unpacked card is too large to import.';
  if (code === 'invalid_archive') return 'This archive could not be read. Try downloading the CHARX file again.';
  if (code === 'invalid_card' || code === 'unsupported_format') return 'This file does not contain a supported character card.';
  if (item.kind === 'link') return 'This public link could not be imported. Try a downloaded card file if the source is unavailable.';
  const text = typeof body.error === 'string' ? body.error : '';
  // Do not echo URL credentials or query strings in a server-supplied error.
  return text ? text.replace(/https?:\/\/[^\s]+/gi, '[source link]').slice(0, 180) : 'Lumiverse could not read this card. Check that the file contains character data.';
}

/** A local import queue; all parsing, storage, and remote fetching belong to Lumiverse. */
export function createCardImport(ctx: SpindleFrontendContext, options: Options = {}) {
  let disposed = false, serial = 0;
  let active: Session | undefined;
  function open(guide?: ImportGuideAttachment) {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'Import character', width: 680, maxHeight: 820 });
    const session: Session = { modal, abort: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && active === session && !session.closed;
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); if (active === session) active = undefined; try { guide?.dismiss(); } catch { /* Guidance cannot interrupt importer cleanup. */ } });
    modal.root.classList.add('jb-settings', 'jb-card-import');
    const suffix = `jb-import-${++serial}`;
    let queue: Item[] = [], running = false, starting = false, attemptedPermission = false;
    const controls: Array<HTMLButtonElement | HTMLInputElement> = [];
    const button = (text: string, click: () => void, className = 'jb-button') => { const element = el('button', className, text); element.type = 'button'; element.addEventListener('click', click); return element; };
    const tabs = el('div', 'jb-settings-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Import source');
    const filesPanel = el('div', 'jb-import-panel'); filesPanel.id = `${suffix}-files`; filesPanel.setAttribute('role', 'tabpanel');
    const linkPanel = el('div', 'jb-import-panel'); linkPanel.id = `${suffix}-links`; linkPanel.setAttribute('role', 'tabpanel');
    const fileTab = button('File', () => show('file'), 'jb-settings-tab'); const linkTab = button('Link', () => show('link'), 'jb-settings-tab');
    for (const [tab, panel, key] of [[fileTab, filesPanel, 'file'], [linkTab, linkPanel, 'link']] as const) {
      tab.id = `${suffix}-${key}-tab`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', tab.id); tabs.append(tab);
    }
    function show(kind: 'file' | 'link') { filesPanel.hidden = kind !== 'file'; linkPanel.hidden = kind !== 'link'; fileTab.setAttribute('aria-selected', String(kind === 'file')); linkTab.setAttribute('aria-selected', String(kind === 'link')); fileTab.tabIndex = kind === 'file' ? 0 : -1; linkTab.tabIndex = kind === 'link' ? 0 : -1; }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      if (document.activeElement !== fileTab && document.activeElement !== linkTab) return;
      event.preventDefault(); const next = event.key === 'Home' ? fileTab : event.key === 'End' ? linkTab : document.activeElement === fileTab ? linkTab : fileTab; show(next === fileTab ? 'file' : 'link'); next.focus();
    });
    const heading = el('h2', '', 'Bring a character with you');
    const intro = el('p', 'jb-settings-intro', 'Add a character card to your Lumiverse library, then start chatting.');
    const drop = el('div', 'jb-import-drop');
    const dropIcon = el('div', 'jb-import-drop-icon'); dropIcon.append(icon('import'));
    const fileInput = el('input', 'jb-import-file'); fileInput.type = 'file'; fileInput.name = 'character-cards'; fileInput.id = `${suffix}-files-input`; fileInput.multiple = true; fileInput.accept = '.png,.json,.charx,.zip,.jpg,.jpeg,image/png,application/json,application/zip';
    const choose = button('Choose card files', () => fileInput.click(), 'jb-button jb-primary'); controls.push(choose, fileInput);
    drop.append(dropIcon, el('strong', '', 'Drop character cards here'), el('p', 'jb-settings-help', 'PNG, JSON, or CHARX · up to 20 at a time'), choose, fileInput);
    filesPanel.append(drop, el('p', 'jb-settings-help jb-import-file-hint', 'A regular portrait image is not a character card. Choose the card download or export from your source.'));
    fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files ?? [])); fileInput.value = ''; });
    for (const eventName of ['dragenter', 'dragover'] as const) drop.addEventListener(eventName, event => { event.preventDefault(); if (!running) drop.classList.add('jb-import-dragging'); });
    drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget as Node | null)) drop.classList.remove('jb-import-dragging'); });
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('jb-import-dragging'); if (!running) addFiles(Array.from(event.dataTransfer?.files ?? [])); });
    const urlField = el('label', 'jb-settings-field'); urlField.htmlFor = `${suffix}-url`;
    const urlInput = el('input', 'jb-settings-input'); urlInput.type = 'url'; urlInput.id = `${suffix}-url`; urlInput.name = 'character-card-url'; urlInput.placeholder = 'https://janitorai.com/characters/…'; urlInput.autocomplete = 'off'; urlInput.spellcheck = false;
    const urlHelp = el('small', 'jb-settings-help', 'Public JanitorAI, JannyAI, Chub, CharacterHub, BotBooru, or a direct card download link.'); urlHelp.id = `${suffix}-url-help`; urlInput.setAttribute('aria-describedby', urlHelp.id); urlField.append(el('span', 'jb-settings-label', 'Character link'), urlInput, urlHelp);
    const addLink = button('Add link', () => addUrl()); controls.push(urlInput, addLink);
    const urlRow = el('div', 'jb-import-url-row'); urlRow.append(urlField, addLink);
    linkPanel.append(urlRow, el('p', 'jb-settings-help', 'JanitorAI links are imported through Lumiverse’s JannyAI downloader and may be unavailable there. Private cards and accounts are not synced.'));
    urlInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addUrl(); } });
    const queueSection = el('section', 'jb-import-queue-section'); queueSection.hidden = true;
    const queueHeader = el('div', 'jb-import-queue-header'); const queueTitle = el('h3', '', 'Import queue'); const queueCount = el('span', 'jb-settings-help'); queueHeader.append(queueTitle, queueCount);
    const list = el('ul', 'jb-import-queue'); list.setAttribute('aria-label', 'Character import queue'); queueSection.append(queueHeader, list);
    const status = el('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const note = el('p', 'jb-settings-help jb-import-close-note', 'Closing stops the remaining queue. An import already sent may still finish; check your library before importing it again.'); note.hidden = true;
    const actions = el('div', 'jb-settings-actions');
    const allow = button('Enable character imports', () => { void requestPermission(); }); allow.hidden = true;
    const retry = button('Retry failed', () => { void run(true); }); retry.hidden = true;
    const close = button('Close', () => modal.dismiss(), 'jb-settings-cancel');
    const importButton = button('Import', () => { void run(false); }, 'jb-settings-save'); importButton.disabled = true;
    const library = button('Open character library', () => {
      const surfaces = ctx.host?.surfaces; const target = { kind: 'drawer_tab' as const, id: 'characters' };
      if (!surfaces?.list(['drawer_tab']).some(item => item.id === target.id && item.invocable !== false)) return;
      modal.dismiss(); try { void Promise.resolve(surfaces.invoke(target)).catch(() => {}); } catch { /* Native navigation is optional. */ }
    }, 'jb-settings-link');
    library.hidden = !ctx.host?.surfaces?.list(['drawer_tab']).some(item => item.id === 'characters' && item.invocable !== false);
    actions.append(library, allow, retry, close, importButton);
    if (guide) {
      const workspace = el('div', 'jb-import-workspace'); workspace.append(tabs, heading, intro, filesPanel, linkPanel, queueSection, status, note);
      workspace.addEventListener('pointerdown', () => guide.interact(), true); workspace.addEventListener('keydown', () => guide.interact(), true);
      modal.root.classList.add('jb-card-import-guided'); modal.root.append(workspace, guide.root, actions); guide.mounted(() => modal.dismiss());
    } else modal.root.append(tabs, heading, intro, filesPanel, linkPanel, queueSection, status, note, actions);
    show('file'); render();
    function message(text: string, tone = '') { if (current()) { status.textContent = text; status.dataset.tone = tone; } }
    function render() {
      if (!current()) return;
      list.replaceChildren(); queueSection.hidden = queue.length === 0; queueCount.textContent = `${queue.length} / ${maximum}`;
      for (const item of queue) {
        const row = el('li', `jb-import-item jb-import-${item.state}`); row.dataset.importState = item.state;
        const thumb = el('div', 'jb-import-thumb');
        if (item.character?.image_id) { const image = el('img'); image.alt = ''; image.src = `/api/v1/images/${encodeURIComponent(item.character.image_id)}?size=sm`; image.addEventListener('error', () => image.remove()); thumb.append(image); }
        else thumb.append(el('span', '', item.state === 'success' ? '✓' : item.kind === 'link' ? '↗' : item.detail.split(' · ')[0]));
        const info = el('div', 'jb-import-item-info'); info.append(el('strong', 'jb-import-item-name', item.character?.name || item.label), el('small', 'jb-import-item-detail', item.detail));
        const itemStatus = item.state === 'queued' ? 'Ready to import' : item.state === 'importing' ? 'Importing…' : item.state === 'success' ? 'Imported to your library' : item.message || 'Could not import';
        info.append(el('span', 'jb-import-item-status', itemStatus));
        const rowActions = el('div', 'jb-import-item-actions');
        if (item.character && options.openCharacter) rowActions.append(button('Open character', () => { const id = item.character!.id; modal.dismiss(); options.openCharacter?.(id); }, 'jb-settings-link'));
        if (item.state === 'uncertain') { const check = button('Retry after checking', () => { if (running || starting) return; item.state = 'queued'; item.message = undefined; render(); message('Ready to retry. Choose Import after checking your library.'); }, 'jb-settings-link'); check.disabled = running || starting; rowActions.append(check); }
        const remove = button('Remove', () => { if (running || starting) return; queue = queue.filter(other => other !== item); render(); }, 'jb-import-remove'); remove.setAttribute('aria-label', `Remove ${item.label}`); remove.disabled = running || starting; rowActions.append(remove);
        row.append(thumb, info, rowActions); list.append(row);
      }
      controls.forEach(control => control.disabled = running || starting);
      importButton.disabled = running || starting || !queue.some(item => item.state === 'queued');
      importButton.textContent = running ? 'Importing…' : 'Import';
      retry.hidden = !queue.some(item => item.state === 'error'); retry.disabled = running || starting;
      allow.disabled = running || starting; drop.setAttribute('aria-busy', String(running || starting));
      note.hidden = !running && !queue.some(item => item.state === 'uncertain');
      try { guide?.update({ queued: queue.filter(item => item.state === 'queued').length, saved: queue.filter(item => item.state === 'success').length, failed: queue.filter(item => item.state === 'error').length, uncertain: queue.filter(item => item.state === 'uncertain').length, busy: running || starting }); } catch { /* Guidance cannot change an import result. */ }
    }
    function addFiles(files: File[]) {
      if (!current() || running || starting) return;
      let added = 0, unsupported = 0, duplicate = 0, overflow = 0;
      for (const file of files) {
        if (!/\.(png|json|charx|zip|jpe?g)$/i.test(file.name) || !file.size) { unsupported++; continue; }
        const source = `file:${file.name}:${file.size}:${file.lastModified}`;
        if (queue.some(item => item.source === source)) { duplicate++; continue; }
        if (queue.length >= maximum) { overflow++; continue; }
        const extension = file.name.split('.').at(-1)!.toUpperCase();
        queue.push({ key: ++serial, source, kind: 'file', label: file.name, detail: `${extension} · ${fileSize(file.size)}`, file, state: 'queued' }); added++;
      }
      render(); message([added ? `${added} card${added === 1 ? '' : 's'} added. Choose Import when you’re ready.` : '', unsupported ? 'Choose a nonempty PNG, JSON, or CHARX card file.' : '', duplicate ? 'Files already in the queue were skipped.' : '', overflow ? 'Import up to 20 cards at a time.' : ''].filter(Boolean).join(' '), unsupported || overflow ? 'warning' : '');
    }
    function addUrl() {
      if (!current() || running || starting) return;
      const url = publicLink(urlInput.value);
      if (!url) { urlInput.setAttribute('aria-invalid', 'true'); message('Enter a public http:// or https:// card link without an embedded username or password.', 'error'); urlInput.focus(); return; }
      url.hash = ''; urlInput.removeAttribute('aria-invalid');
      if (queue.some(item => item.source === `link:${url.href}`)) { message('That link is already in your queue.'); return; }
      if (queue.length >= maximum) { message('Import up to 20 cards at a time.', 'warning'); return; }
      queue.push({ key: ++serial, source: `link:${url.href}`, kind: 'link', label: linkLabel(url), detail: 'Public character link', url: url.href, state: 'queued' }); urlInput.value = ''; render(); message('Link added. Choose Import when you’re ready.');
    }
    async function requestPermission(fromImport = false) {
      if (!current() || running || (starting && !fromImport)) return false;
      attemptedPermission = true; allow.disabled = true;
      try {
        const granted = await ctx.permissions.request(['characters'], { reason: 'Import the character cards you choose into your native Lumiverse library.' });
        if (!current()) return false;
        const grantedNow = granted.includes('characters'); allow.hidden = grantedNow;
        message(grantedNow ? 'Ready to import. Choose Import to continue.' : 'Character imports need the Characters permission. Your queue is still here.', grantedNow ? '' : 'warning'); return grantedNow;
      } catch { message('Character imports need the Characters permission. Your queue is still here.', 'warning'); if (current()) allow.hidden = false; return false; }
      finally { if (current()) allow.disabled = false; }
    }
    async function run(failedOnly: boolean) {
      if (!current() || running || starting) return;
      const pending = queue.filter(item => failedOnly ? item.state === 'error' : item.state === 'queued'); if (!pending.length) return;
      starting = true; render();
      try {
        let granted = await ctx.permissions.getGranted(); if (!current()) return;
        if (!granted.includes('characters')) {
          if (attemptedPermission || !await requestPermission(true)) { if (current()) { allow.hidden = false; message('Enable the Characters permission to import your queued cards.', 'warning'); } return; }
          granted = await ctx.permissions.getGranted(); if (!current()) return;
          if (!granted.includes('characters')) { allow.hidden = false; message('Enable the Characters permission to import your queued cards.', 'warning'); return; }
        }
      } catch { message('Could not check the Characters permission. Your queue is still here.', 'error'); return; }
      finally { starting = false; if (current()) render(); }
      if (!current()) return;
      running = true; render(); let imported = 0, failed = 0;
      try {
        for (const [index, item] of pending.entries()) {
          if (!current()) break;
          const granted = await ctx.permissions.getGranted(); if (!current()) break;
          if (!granted.includes('characters')) { allow.hidden = false; message('Characters permission was removed. The remaining cards have not been sent.', 'warning'); return; }
          item.state = 'importing'; item.message = undefined; render(); message(`Importing ${index + 1} of ${pending.length}…`);
          let response: Response;
          try {
            const body = item.kind === 'file' ? new FormData() : JSON.stringify({ url: item.url });
            if (body instanceof FormData) body.append('file', item.file!);
            response = await fetch(`/api/v1/characters/${item.kind === 'file' ? 'import' : 'import-url'}`, { method: 'POST', credentials: 'same-origin', signal: session.abort.signal, ...(item.kind === 'link' ? { headers: { 'Content-Type': 'application/json' } } : {}), body });
          } catch {
            if (!current()) return;
            item.state = 'uncertain'; item.message = 'The result could not be confirmed. Check your library before retrying.'; failed++; render(); continue;
          }
          if (!current()) return;
          let result: Record<string, unknown>;
          try { result = record(await response.json()); }
          catch { if (!current()) return; item.state = 'uncertain'; item.message = 'The result could not be confirmed. Check your library before retrying.'; failed++; render(); continue; }
          if (!current()) return;
          if (!response.ok) {
            const beforeCreate = item.kind === 'file' && (['file_too_large', 'archive_decompresses_too_large', 'invalid_archive', 'invalid_card', 'unsupported_format'].includes(String(result.code)) || preCreateErrors.has(String(result.error)));
            // Imports are not transactional: image/module work can fail after
            // the character was created. Do not automatically retry that row.
            item.state = beforeCreate ? 'error' : 'uncertain'; item.message = beforeCreate ? errorText(result, item) : `${errorText(result, item)} Check your library before retrying.`; failed++; render(); continue;
          }
          const character = record(result.character);
          if (typeof character.id !== 'string' || !character.id) { item.state = 'uncertain'; item.message = 'The result could not be confirmed. Check your library before retrying.'; failed++; render(); continue; }
          item.character = { id: character.id, name: typeof character.name === 'string' ? character.name : item.label, ...(typeof character.image_id === 'string' && character.image_id ? { image_id: character.image_id } : {}) }; item.state = 'success'; imported++; render();
          try { options.onImported?.(); } catch { /* A refresh failure must never retry an already imported card. */ }
        }
        if (current()) message(`${imported} character${imported === 1 ? '' : 's'} imported${failed ? `. ${failed} item${failed === 1 ? '' : 's'} need attention below` : '. Ready to chat'}.`, failed ? 'warning' : 'success');
      } catch { if (current()) message('Import stopped. Cards still marked Ready have not been sent. Your queue is still here.', 'error'); }
      finally { running = false; if (current()) render(); }
    }
  }
  function destroy() { disposed = true; active?.modal.dismiss(); active = undefined; }
  return { open, destroy };
}
