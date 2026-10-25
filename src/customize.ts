import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { defaultAppearance, fontFamilies, loadCustomize, saveCustomize, type Appearance, type CustomizeSnapshot } from './customize-storage';
import { createStreamingSettings } from './streaming-settings';
import { icon } from './icons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; }
function button(text: string, action: () => void, cls = '') { const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node; }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Navigation = { settings(): void; memory(chatId: string): void };

/** A non-modal, extension-owned chat panel. Drafts preview here; only Save persists them. */
export function createCustomize(ctx: SpindleFrontendContext, navigation: Navigation) {
  let disposed = false, close: (() => void) | undefined;
  function open() {
    if (disposed) return;
    const activeChatId = ctx.getActiveChat()?.chatId;
    if (!activeChatId) return;
    const chatId: string = activeChatId;
    close?.();
    const abort = new AbortController(), streaming = createStreamingSettings(ctx);
    let closed = false, busy = false, writing = false, collapsed = false, needsReload = false, resetText = false, snapshot: CustomizeSnapshot | undefined;
    let initialStreaming: boolean | undefined, canStream = false, pendingFile: File | undefined, removeBackground = false, previewUrl: string | undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    const current = () => !closed && !disposed && ctx.getActiveChat()?.chatId === chatId;
    const panel = el('aside', 'jb-customize'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Chat settings · Customize'); panel.setAttribute('aria-modal', 'false');
    const header = el('header', 'jb-customize-header');
    const dismiss = button('×', () => finish(), 'jb-customize-icon'); dismiss.setAttribute('aria-label', 'Close panel');
    const minimize = button('−', () => { collapsed = !collapsed; panel.classList.toggle('jb-customize-collapsed', collapsed); content.hidden = collapsed; footer.hidden = collapsed; minimize.textContent = collapsed ? '+' : '−'; minimize.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel'); minimize.setAttribute('aria-expanded', String(!collapsed)); }, 'jb-customize-icon'); minimize.setAttribute('aria-label', 'Collapse panel'); minimize.setAttribute('aria-expanded', 'true');
    const tabs = el('nav', 'jb-customize-tabs'); tabs.setAttribute('aria-label', 'Chat settings sections');
    const settings = button('Settings', () => { if (!busy) { finish(); navigation.settings(); } });
    const memory = button('Memory', () => { if (!busy) { finish(); navigation.memory(chatId); } });
    const selected = button('Customize', () => {}); selected.setAttribute('aria-current', 'page');
    tabs.append(settings, memory, selected); header.append(dismiss, minimize, tabs);
    const content = el('div', 'jb-customize-content'), footer = el('footer', 'jb-customize-footer');
    const status = el('p', 'jb-customize-status', 'Loading saved customization…'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const save = button('Save', () => { void persist(); }, 'jb-customize-save'); save.disabled = true;
    footer.append(status, save);
    const controls: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [];
    function section(title: string) { const node = el('section', 'jb-customize-section'); node.append(el('h3', '', title)); content.append(node); return node; }
    const options = section('Options');
    const streamLabel = el('label', 'jb-customize-toggle-row');
    const streamCopy = el('span'); streamCopy.append(el('span', '', 'Text streaming'));
    const streamHint = el('small', '', 'Determines if text comes all at once or bit by bit. Turning this off may improve performance.'); streamCopy.append(streamHint);
    const stream = el('input', 'jb-customize-switch'); stream.type = 'checkbox'; stream.setAttribute('aria-label', 'Text streaming'); stream.disabled = true; stream.addEventListener('change', update);
    streamLabel.append(streamCopy, stream); options.append(streamLabel, el('p', 'jb-customize-note', 'Auto-scroll follows replies when you’re at the bottom. Scroll up to pause it.'));
    const background = section('Background image');
    background.append(el('p', 'jb-customize-help', 'For this chat. Opacity and blur apply to your Lumiverse backgrounds.'));
    const upload = button('', () => file.click(), 'jb-customize-upload'); upload.setAttribute('aria-label', 'Choose background image');
    const image = el('img', 'jb-customize-background-preview'); image.alt = 'Background preview'; image.hidden = true;
    const uploadLabel = el('span', '', 'Drag & drop an image here, or click to select'); const camera = el('span', 'jb-customize-camera'); camera.setAttribute('aria-hidden', 'true'); camera.append(icon('camera'));
    upload.append(image, camera, uploadLabel);
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true; file.setAttribute('aria-label', 'Background image file');
    const backgroundActions = el('div', 'jb-customize-background-actions');
    const clearBackground = button('Remove chat background', () => { pendingFile = undefined; removeBackground = true; revokePreview(); renderBackground(); update(); }, 'jb-customize-link');
    backgroundActions.append(clearBackground); background.append(upload, file, backgroundActions); controls.push(upload, clearBackground);
    function acceptFile(chosen?: File) {
      if (!chosen || busy || !current() || !snapshot?.canEditBackground) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(chosen.type) || !chosen.size || chosen.size > 10 * 1024 * 1024) { message('Choose a PNG, JPEG, or WebP image up to 10 MiB.', 'error'); return; }
      revokePreview(); pendingFile = chosen; removeBackground = false; previewUrl = URL.createObjectURL(chosen); renderBackground(); message('Background selected. Save to use it in this chat.'); update();
    }
    file.addEventListener('change', () => { acceptFile(file.files?.[0]); file.value = ''; });
    upload.addEventListener('dragover', event => { event.preventDefault(); if (!busy) upload.classList.add('jb-dragging'); });
    upload.addEventListener('dragleave', () => upload.classList.remove('jb-dragging'));
    upload.addEventListener('drop', event => { event.preventDefault(); upload.classList.remove('jb-dragging'); acceptFile(event.dataTransfer?.files[0]); });
    upload.addEventListener('paste', event => { const pasted = [...event.clipboardData?.items ?? []].find(item => item.kind === 'file')?.getAsFile(); if (pasted) { event.preventDefault(); acceptFile(pasted); } });
    function range(parent: HTMLElement, title: string, min: number, max: number, value: number, unit: string, step = 1) {
      const row = el('div', 'jb-customize-range'); const label = el('label', '', title); const input = el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.setAttribute('aria-label', `${title} slider`);
      const number = el('input', 'jb-customize-number'); number.type = 'number'; number.min = String(min); number.max = String(max); number.step = String(step); number.value = String(value); number.setAttribute('aria-label', `${title} value`);
      const numeric = el('span', 'jb-customize-number-wrap'); numeric.append(number, el('span', '', unit)); label.append(input); row.append(label, numeric); parent.append(row); controls.push(input, number);
      input.addEventListener('input', () => { number.value = input.value; preview(); update(); });
      number.addEventListener('input', () => { if (number.value !== '' && number.validity.valid) input.value = number.value; preview(); update(); });
      return { input, number, get: () => Number(number.value), set(value: number) { input.value = number.value = String(value); }, valid: () => number.value !== '' && number.validity.valid };
    }
    const opacity = range(background, 'Background opacity', 0, 100, 10, '%');
    const blur = range(background, 'Background blur', 0, 8, 0, 'px', .1);
    const text = section('Text settings');
    const sample = el('div', 'jb-customize-preview'); const sampleTitle = el('div', 'jb-customize-preview-title', 'PREVIEW');
    const sampleBody = el('div', 'jb-customize-sample'); const regular = el('span', '', 'This is regular text. '), italic = el('em', '', 'This is italic text. '), bold = el('strong', '', 'This is bold text. '), code = el('code', '', 'code'), dialogue = el('span', '', ' “dialogue”'); sampleBody.append(regular, italic, bold, code, dialogue); sample.append(sampleTitle, sampleBody); text.append(sample);
    const fontSize = range(text, 'Font size', 8, 24, defaultAppearance.fontSize, 'px');
    const familyRow = el('label', 'jb-customize-select-row', 'Font family'); const family = el('select'); family.setAttribute('aria-label', 'Font family');
    for (const value of Object.keys(fontFamilies)) { const option = el('option', '', value); option.value = value; family.append(option); }
    familyRow.append(family); text.append(familyRow); controls.push(family); family.addEventListener('change', () => { preview(); update(); });
    const colors = new Map<string, { color: HTMLInputElement; hex: HTMLInputElement }>();
    const reset = button('Reset text settings', () => { resetText = true; fillAppearance(defaultAppearance); preview(); update(); }, 'jb-customize-link'); text.append(reset); controls.push(reset);
    for (const [key, title] of [['text', 'Text color'], ['italic', 'Italic text color'], ['bold', 'Bold text color'], ['code', 'Code color'], ['dialogue', 'Dialogue color']] as const) {
      const detail = el('details', 'jb-customize-color'); const summary = el('summary'); const swatch = el('span', 'jb-customize-swatch'); summary.append(el('span', '', title), swatch); detail.append(summary);
      const color = el('input'); color.type = 'color'; color.setAttribute('aria-label', `${title} picker`);
      const hex = el('input', 'jb-customize-hex'); hex.type = 'text'; hex.maxLength = 7; hex.pattern = '#[0-9a-fA-F]{6}'; hex.setAttribute('aria-label', `${title} hex`);
      const fields = el('div', 'jb-customize-color-fields'); fields.append(color, hex); detail.append(fields); text.append(detail); controls.push(color, hex); colors.set(key, { color, hex });
      color.addEventListener('input', () => { hex.value = color.value; swatch.style.background = color.value; preview(); update(); });
      hex.addEventListener('input', () => { if (/^#[\da-f]{6}$/i.test(hex.value)) { color.value = hex.value; swatch.style.background = hex.value; } preview(); update(); });
    }
    const appearanceNotice = el('p', 'jb-customize-help'); appearanceNotice.hidden = true; text.append(appearanceNotice, el('p', 'jb-customize-help', 'Text appearance applies to messages across your chats. Your other Lumiverse screens keep their own sizing.'));
    const reload = button('Reload saved settings', () => { if (!busy) void load(); }, 'jb-customize-link jb-customize-reload'); content.append(reload);
    panel.append(header, content, footer); document.body.append(panel); close = finish;
    const stopChat = ctx.state?.subscribe('chat.active', () => { if (ctx.getActiveChat()?.chatId !== chatId) finish(); });
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && panel.contains(event.target as Node)) { event.stopPropagation(); finish(); } }; panel.addEventListener('keydown', onEscape);
    function finish() { if (closed) return; closed = true; abort.abort(); streaming.dispose(); stopChat?.(); revokePreview(); panel.remove(); if (close === finish) close = undefined; if (previousFocus?.isConnected) previousFocus.focus(); }
    function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = undefined; }
    function message(value: string, tone = '') { if (!closed) { status.textContent = value; status.dataset.tone = tone; } }
    function appearance(): Appearance { const result = structuredClone(snapshot?.appearance ?? defaultAppearance); result.fontSize = fontSize.get(); result.fontFamily = family.value; for (const [key, value] of colors) (result.colors as unknown as Record<string, string>)[key] = value.hex.value.toLowerCase(); return result; }
    function fillAppearance(value: Appearance) { fontSize.set(value.fontSize); family.value = value.fontFamily; for (const [key, inputs] of colors) { const color = (value.colors as unknown as Record<string, string>)[key]; inputs.color.value = inputs.hex.value = color; (inputs.color.closest('details')!.querySelector('.jb-customize-swatch') as HTMLElement).style.background = color; } }
    function preview() {
      const value = appearance(); if (fontSize.valid()) sampleBody.style.fontSize = `${value.fontSize}px`; sampleBody.style.fontFamily = fontFamilies[value.fontFamily] || fontFamilies.Default;
      for (const [node, key] of [[regular, 'text'], [italic, 'italic'], [bold, 'bold'], [code, 'code'], [dialogue, 'dialogue']] as const) if (/^#[\da-f]{6}$/i.test(value.colors[key])) node.style.color = value.colors[key];
      if (opacity.valid()) image.style.opacity = String(opacity.get() / 100); if (blur.valid()) image.style.filter = `blur(${blur.get()}px)`;
    }
    function renderBackground() {
      const ref = !removeBackground && snapshot?.chatWallpaper;
      const inherited = snapshot?.wallpaper.global;
      const shown = ref || inherited;
      const id = shown?.type === 'image' ? shown.image_id : undefined;
      const src = previewUrl || (id ? `/api/v1/images/${encodeURIComponent(id)}` : '');
      image.hidden = !src; if (src) image.src = src; else image.removeAttribute('src'); camera.hidden = !!src;
      uploadLabel.textContent = pendingFile ? pendingFile.name : removeBackground ? 'Chat background removed · Save to apply' : src ? 'Click to change background image' : 'Drag & drop an image here, or click to select';
      clearBackground.hidden = !pendingFile && !snapshot?.chatWallpaper;
      upload.disabled = clearBackground.disabled = busy || !snapshot?.canEditBackground;
      const canAdjust = !!src || !!shown; for (const node of [opacity.input, opacity.number, blur.input, blur.number]) node.disabled = busy || !snapshot || !canAdjust;
      preview();
    }
    function valid() { return fontSize.valid() && opacity.valid() && blur.valid() && [...colors.values()].every(value => /^#[\da-f]{6}$/i.test(value.hex.value)); }
    function changes() { return !!snapshot && (resetText || !equal(appearance(), snapshot.appearance) || opacity.get() !== Math.round(snapshot.wallpaper.opacity * 100) || blur.get() !== snapshot.wallpaper.blur || !!pendingFile || removeBackground || (canStream && stream.checked !== initialStreaming)); }
    function update() { for (const control of controls) control.disabled = busy || !snapshot; stream.disabled = busy || !canStream; settings.disabled = memory.disabled = busy; reload.disabled = busy; save.disabled = busy || needsReload || !snapshot || !valid() || !changes(); save.textContent = writing ? 'Saving…' : 'Save'; panel.setAttribute('aria-busy', String(busy)); renderBackground(); }
    async function load() {
      busy = true; update(); message('Loading saved customization…');
      const results = await Promise.allSettled([loadCustomize(ctx, chatId!, abort.signal), streaming.read(chatId!)]);
      if (!current()) return;
      if (results[0].status === 'fulfilled') { snapshot = results[0].value; fillAppearance(snapshot.appearance); opacity.set(Math.round(snapshot.wallpaper.opacity * 100)); blur.set(snapshot.wallpaper.blur); pendingFile = undefined; removeBackground = false; resetText = needsReload = false; revokePreview(); appearanceNotice.hidden = snapshot.appearanceEnabled; appearanceNotice.textContent = 'This saved text style is disabled in Lumiverse. Saving text changes enables it again.'; message(snapshot.canEditBackground ? 'Changes preview here. Save when you’re happy.' : 'Enable Janiverse’s Chats permission to change this chat’s background.'); }
      else { snapshot = undefined; message(results[0].reason instanceof Error ? results[0].reason.message : 'Could not load customization. Reload to try again.', 'error'); }
      if (results[1].status === 'fulfilled') { canStream = results[1].value.available; initialStreaming = results[1].value.enabled; stream.checked = initialStreaming; if (!canStream) streamHint.textContent = results[1].value.reason || 'Choose a native prompt preset in Settings to control streaming.'; }
      else { canStream = false; streamHint.textContent = 'Streaming settings could not be loaded. Reload saved settings to try again.'; }
      busy = false; update();
    }
    async function persist() {
      if (busy || needsReload || !snapshot || !current() || !valid() || !changes()) return;
      busy = writing = true; update(); message('Saving customization…');
      try {
        const value = appearance();
        const draft = { ...(resetText || !equal(value, snapshot.appearance) ? { appearance: value } : {}), ...(opacity.get() !== Math.round(snapshot.wallpaper.opacity * 100) || blur.get() !== snapshot.wallpaper.blur ? { wallpaper: { opacity: opacity.get() / 100, blur: blur.get() } } : {}), ...(pendingFile ? { background: { file: pendingFile } } : removeBackground ? { background: { remove: true as const } } : {}) };
        if (Object.keys(draft).length) {
          await saveCustomize(ctx, chatId, draft, abort.signal);
          if (!current()) return;
          snapshot = await loadCustomize(ctx, chatId, abort.signal);
          if (!current()) return;
          pendingFile = undefined; removeBackground = false; resetText = false; revokePreview();
        }
        if (canStream && stream.checked !== initialStreaming) { const result = await streaming.save(stream.checked); if (!current()) return; initialStreaming = result.enabled; }
        message('Saved. Your chat uses these Lumiverse settings.', 'success');
      } catch (error) { if (current()) { needsReload = true; message(`${error instanceof Error ? error.message : 'Could not save.'} Reload saved settings before trying again; some changes may already be saved.`, 'error'); } }
      finally { if (current()) { busy = writing = false; update(); } }
    }
    fillAppearance(defaultAppearance); preview(); void load(); dismiss.focus();
    return panel;
  }
  return { open, close() { close?.(); }, destroy() { disposed = true; close?.(); } };
}
