import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { icon } from './icons';

type Options = { onCreated?: (id: string) => void; openCharacter?: (id: string) => void };
type Session = { modal: SpindleModalHandle; abort: AbortController; closed: boolean; previewUrl?: string };
type NativeCharacter = { id: string; name?: string };
const portraitLimit = 10 * 1024 * 1024;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** Familiar card fields, persisted by the host's normal character and avatar APIs. */
export function createCharacterCreate(ctx: SpindleFrontendContext, options: Options = {}) {
  let disposed = false, serial = 0;
  let active: Session | undefined;
  function open() {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'New Character', width: 1100, maxHeight: 1000 });
    const session: Session = { modal, abort: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && active === session && !session.closed;
    function clearPreview() { if (session.previewUrl) { URL.revokeObjectURL(session.previewUrl); session.previewUrl = undefined; } }
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); clearPreview(); if (active === session) active = undefined; });
    modal.root.classList.add('jb-settings', 'jb-character-create');
    const prefix = `jb-create-${++serial}`;
    let busy = false, attemptedPermission = false, uncertain = false, created: NativeCharacter | undefined, portrait: File | undefined, notified = false, portraitPending = false;
    const form = el('form', 'jb-character-form'); form.noValidate = true;
    const fields = el('fieldset', 'jb-character-fields');
    const heading = el('h2', '', 'Create a character'); heading.id = `${prefix}-general`; heading.tabIndex = -1;
    const intro = el('p', 'jb-settings-intro', 'Bring your character to life. You can edit every detail later.');
    const button = (text: string, click: () => void, className = 'jb-button') => { const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', click); return node; };
    function field(name: string, label: string, help: string, multiline = false, required = false) {
      const wrap = el('label', 'jb-settings-field'); const input = multiline ? el('textarea', 'jb-settings-textarea') : el('input', 'jb-settings-input');
      input.name = name; input.id = `${prefix}-${name}`; input.required = required; input.autocomplete = 'off'; wrap.htmlFor = input.id;
      const title = el('span', 'jb-settings-label', label); if (required) title.append(el('small', '', 'Required'));
      const hint = el('small', 'jb-settings-help', help); hint.id = `${input.id}-help`; input.setAttribute('aria-describedby', hint.id); wrap.append(title, input, hint);
      input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
      return { wrap, input };
    }
    const name = field('name', 'Title', 'The name shown on your character card.', false, true); name.input.maxLength = 200; name.input.placeholder = 'Give your character a title';
    const chatName = field('chat_name', 'Chat name', 'Optional. The name your character uses in conversation.'); chatName.input.maxLength = 200; chatName.input.placeholder = 'Same as title';
    const rail = el('aside', 'jb-character-rail'); const nav = el('nav', 'jb-character-nav'); nav.setAttribute('aria-label', 'Character creation sections');
    const generalLink = el('a', 'jb-character-nav-link', 'General'); generalLink.href = `#${heading.id}`; generalLink.setAttribute('aria-current', 'location');
    const definitionHeading = el('h3', 'jb-character-section-heading', 'Definition'); definitionHeading.id = `${prefix}-definition`; definitionHeading.tabIndex = -1;
    const definitionLink = el('a', 'jb-character-nav-link', 'Definition'); definitionLink.href = `#${definitionHeading.id}`;
    for (const [link, target] of [[generalLink, heading], [definitionLink, definitionHeading]] as const) link.addEventListener('click', event => { event.preventDefault(); generalLink.removeAttribute('aria-current'); definitionLink.removeAttribute('aria-current'); link.setAttribute('aria-current', 'location'); target.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); target.focus({ preventScroll: true }); });
    nav.append(generalLink, definitionLink);
    const card = el('article', 'jb-character-card-preview'); card.setAttribute('aria-label', 'Character card preview');
    const cardTitle = el('strong', 'jb-character-card-title', 'Your character'); const cardMedia = el('div', 'jb-character-card-media'); const cardImage = el('img'); cardImage.alt = 'Card preview portrait'; cardImage.hidden = true;
    const cardLetter = el('span', 'jb-character-card-letter', '?'); cardMedia.append(cardImage, cardLetter); const cardBio = el('p', 'jb-character-card-bio', 'Your character’s bio will appear here.'); const cardTags = el('div', 'jb-character-card-tags');
    card.append(cardTitle, cardMedia, cardBio, cardTags); rail.append(nav, el('p', 'jb-character-preview-label', 'Card preview'), card);
    const portraitBox = el('div', 'jb-character-portrait');
    const preview = el('button', 'jb-character-portrait-preview'); preview.type = 'button'; preview.setAttribute('aria-label', 'Upload character image'); const placeholder = el('div', 'jb-character-portrait-placeholder'); placeholder.append(icon('camera'), el('span', '', 'Click to upload or drag & drop'), el('small', '', 'PNG, JPG, WebP or GIF · up to 10 MB'));
    const image = el('img'); image.alt = 'Selected character portrait'; image.hidden = true; preview.append(placeholder, image);
    const fileInput = el('input', 'jb-character-portrait-file'); fileInput.type = 'file'; fileInput.name = 'portrait'; fileInput.id = `${prefix}-portrait`; fileInput.accept = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif'; fileInput.setAttribute('aria-label', 'Choose character portrait');
    const remove = button('Remove image', () => selectPortrait(undefined), 'jb-settings-link'); remove.hidden = true;
    portraitBox.append(preview, remove, fileInput); preview.addEventListener('click', () => fileInput.click());
    for (const eventName of ['dragenter', 'dragover'] as const) preview.addEventListener(eventName, event => { event.preventDefault(); if (!busy && !created && !uncertain) preview.classList.add('jb-character-dragging'); });
    preview.addEventListener('dragleave', event => { if (!preview.contains(event.relatedTarget as Node | null)) preview.classList.remove('jb-character-dragging'); });
    preview.addEventListener('drop', event => { event.preventDefault(); preview.classList.remove('jb-character-dragging'); const files = Array.from(event.dataTransfer?.files ?? []); if (files.length > 1) { message('Choose one character picture.', 'error'); return; } if (files[0]) selectPortrait(files[0]); });
    function selectPortrait(file: File | undefined) {
      if (busy || created || uncertain) return;
      if (file && (!/\.(?:png|jpe?g|webp|gif)$/i.test(file.name) || (file.type && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)))) { message('Choose a PNG, JPG, WebP or GIF picture.', 'error'); return; }
      if (file && (!file.size || file.size > portraitLimit)) { message('Choose a picture between 1 byte and 10 MB.', 'error'); return; }
      clearPreview(); portrait = file; image.removeAttribute('src'); cardImage.removeAttribute('src'); image.hidden = !file; cardImage.hidden = !file; cardLetter.hidden = !!file; placeholder.hidden = !!file; remove.hidden = !file;
      if (file) { try { session.previewUrl = URL.createObjectURL(file); image.src = session.previewUrl; cardImage.src = session.previewUrl; } catch { image.hidden = true; cardImage.hidden = true; cardLetter.hidden = false; placeholder.hidden = false; } }
      message('');
    }
    fileInput.addEventListener('change', () => { selectPortrait(fileInput.files?.[0]); fileInput.value = ''; });
    const bio = field('creator_notes', 'Bio', 'Shown on your character card as the creator’s note. Introduce the character and the story to your readers.', true); bio.input.placeholder = 'A short introduction, story hook, or a note for the people chatting with your character…'; bio.input.classList.add('jb-character-bio');
    const tags = field('tags', 'Tags', 'Optional. Separate tags with commas.'); tags.input.placeholder = 'fantasy, original character, adventure'; tags.input.maxLength = 1000;
    const definition = field('description', 'Personality', 'Describe who they are, how they speak, and how they behave. This guides the AI.', true, true); definition.input.placeholder = 'Name, appearance, personality, background, relationships, speaking style…'; definition.input.classList.add('jb-character-definition');
    const messages = el('section', 'jb-character-initial-messages'); const messagesLabel = el('div', 'jb-settings-label', 'Initial messages'); messagesLabel.id = `${prefix}-messages-label`; messagesLabel.append(el('small', '', 'Required'));
    const messagesHelp = el('p', 'jb-settings-help', 'The first message that starts a new chat. Add alternatives to offer different openings. Use {{char}} for your character and {{user}} for the user.');
    const messageTabs = el('div', 'jb-character-message-tabs'); messageTabs.setAttribute('role', 'tablist'); messageTabs.setAttribute('aria-labelledby', messagesLabel.id);
    const greeting = field('first_mes', 'Initial message 1', 'The opening used by default.', true, true); greeting.input.placeholder = '*{{char}} looks up as {{user}} enters…*'; greeting.input.classList.add('jb-character-greeting');
    let greetingSerial = 0;
    const greetingItems: Array<{ field: ReturnType<typeof field>; tab: HTMLButtonElement; panel: HTMLDivElement; remove?: HTMLButtonElement }> = [];
    const greetingPanels = el('div', 'jb-character-message-panels');
    function showGreeting(index: number) { greetingItems.forEach((item, position) => { item.panel.hidden = position !== index; item.tab.setAttribute('aria-selected', String(position === index)); item.tab.tabIndex = position === index ? 0 : -1; }); }
    function appendGreeting(first = false) {
      const number = ++greetingSerial; const itemField = first ? greeting : field(`alternate_greeting_${number}`, `Initial message ${greetingItems.length + 1}`, 'An alternate opening for a new chat.', true);
      itemField.input.classList.add('jb-character-greeting');
      const panel = el('div', 'jb-character-message-panel'); panel.id = `${prefix}-message-panel-${number}`; panel.setAttribute('role', 'tabpanel');
      const tab = button(`Message ${greetingItems.length + 1}`, () => showGreeting(greetingItems.findIndex(item => item.tab === tab)), 'jb-character-message-tab'); tab.id = `${prefix}-message-tab-${number}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', tab.id);
      const item: (typeof greetingItems)[number] = { field: itemField, tab, panel }; panel.append(itemField.wrap);
      if (!first) { item.remove = button('Remove this message', () => { if (busy || created || uncertain) return; const index = greetingItems.indexOf(item); greetingItems.splice(index, 1); panel.remove(); tab.remove(); greetingItems.forEach((entry, position) => { entry.tab.textContent = `Message ${position + 1}`; entry.field.wrap.querySelector('.jb-settings-label')!.firstChild!.textContent = `Initial message ${position + 1}`; }); showGreeting(Math.min(index, greetingItems.length - 1)); }, 'jb-settings-link'); panel.append(item.remove); }
      greetingItems.push(item); messageTabs.append(tab); greetingPanels.append(panel); showGreeting(greetingItems.length - 1);
    }
    appendGreeting(true);
    const addGreeting = button('+ Add another message', () => { if (busy || created || uncertain) return; appendGreeting(); greetingItems.at(-1)!.field.input.focus(); }, 'jb-settings-link jb-character-add-message');
    messageTabs.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; const index = greetingItems.findIndex(item => item.tab === document.activeElement); if (index < 0) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? greetingItems.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + greetingItems.length) % greetingItems.length; showGreeting(next); greetingItems[next].tab.focus(); });
    messages.append(messagesLabel, messagesHelp, messageTabs, greetingPanels, addGreeting);
    const advanced = el('details', 'jb-settings-advanced'); advanced.append(el('summary', '', 'Creator credit'));
    const advancedFields = el('div', 'jb-character-advanced-fields');
    const scenario = field('scenario', 'Scenario', 'Optional. The setting, current situation, and relationship with {{user}}.', true);
    const examples = field('mes_example', 'Example dialogs', 'Optional. Show the writing style and voice you want the AI to follow.', true); examples.input.placeholder = '<START>\n{{user}}: Hello.\n{{char}}: …';
    const creator = field('creator', 'Creator Name', 'Optional. The author credit shown on your character card.'); creator.input.maxLength = 200;
    advancedFields.append(creator.wrap); advanced.append(advancedFields);
    const definitionIntro = el('p', 'jb-settings-help jb-character-definition-intro', 'Shape how your character behaves and the story they share with the user.');
    fields.append(portraitBox, name.wrap, chatName.wrap, bio.wrap, tags.wrap, definitionHeading, definitionIntro, definition.wrap, scenario.wrap, messages, examples.wrap, advanced);
    function updateCard() { const title = name.input.value.trim(); cardTitle.textContent = title || 'Your character'; cardLetter.textContent = title ? Array.from(title)[0].toLocaleUpperCase() : '?'; cardBio.textContent = bio.input.value.trim() || 'Your character’s bio will appear here.'; cardTags.replaceChildren(...[...new Set(tags.input.value.split(',').map(value => value.trim()).filter(Boolean))].slice(0, 6).map(tag => el('span', '', tag))); }
    for (const input of [name.input, bio.input, tags.input]) input.addEventListener('input', updateCard);
    const status = el('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.id = `${prefix}-status`; form.setAttribute('aria-describedby', status.id);
    const pendingNote = el('p', 'jb-settings-help jb-character-close-note', 'If you close while saving, a request already sent may still finish. Check your library before creating the character again.'); pendingNote.hidden = true;
    const actions = el('div', 'jb-settings-actions jb-character-actions');
    const allow = button('Enable Characters permission', () => { void enablePermission(); }); allow.hidden = true;
    const retryPortrait = button('Retry portrait', () => { void retryImage(); }); retryPortrait.hidden = true;
    const cancel = button('Cancel', () => modal.dismiss(), 'jb-settings-cancel');
    const view = button('View character', () => { if (!created || !options.openCharacter) return; const id = created.id; modal.dismiss(); try { options.openCharacter(id); } catch { /* The card remains saved even if navigation fails. */ } }, 'jb-settings-save'); view.hidden = true;
    const create = el('button', 'jb-settings-save', 'Create Character'); create.type = 'submit';
    const library = button('Open character library', () => {
      const surfaces = ctx.host?.surfaces; if (!surfaces?.list(['drawer_tab']).some(item => item.id === 'characters' && item.invocable !== false)) return;
      modal.dismiss(); try { void Promise.resolve(surfaces.invoke({ kind: 'drawer_tab', id: 'characters' })).catch(() => {}); } catch { /* Navigation is optional. */ }
    }, 'jb-settings-link'); library.hidden = true;
    const content = el('div', 'jb-character-content'); content.append(heading, intro, fields, status, pendingNote); const layout = el('div', 'jb-character-create-layout'); layout.append(rail, content);
    actions.append(library, allow, retryPortrait, cancel, view, create); form.append(layout, actions); modal.root.append(form);
    function message(text: string, tone = '') { if (current()) { status.textContent = text; status.dataset.tone = tone; } }
    function sync() {
      if (!current()) return;
      fields.disabled = busy || !!created || uncertain; create.disabled = busy || !!created || uncertain; create.hidden = !!created;
      create.textContent = busy && !created ? 'Creating…' : 'Create Character'; form.setAttribute('aria-busy', String(busy));
      allow.disabled = busy; retryPortrait.hidden = !created || !portraitPending; retryPortrait.disabled = busy;
      view.hidden = !created || !options.openCharacter; view.disabled = busy; cancel.textContent = created || uncertain ? 'Done' : 'Cancel'; pendingNote.hidden = !busy;
      library.hidden = !uncertain || !ctx.host?.surfaces?.list(['drawer_tab']).some(item => item.id === 'characters' && item.invocable !== false);
    }
    async function enablePermission() {
      if (!current() || busy) return;
      busy = true; sync(); await permission(true); if (current()) { busy = false; sync(); }
    }
    async function permission(request = false): Promise<boolean> {
      try {
        let granted = await ctx.permissions.getGranted(); if (!current()) return false;
        if (!granted.includes('characters') && request) { attemptedPermission = true; await ctx.permissions.request(['characters'], { reason: 'Save the character you create and its portrait in your Lumiverse library.' }); if (!current()) return false; granted = await ctx.permissions.getGranted(); if (!current()) return false; }
        const allowed = granted.includes('characters'); allow.hidden = allowed;
        if (!allowed) message(created ? 'Your character is saved. Enable Characters permission to add its portrait.' : 'Enable Characters permission to save your character. Your draft is still here.', 'warning');
        return allowed;
      } catch { if (current()) { allow.hidden = false; message(created ? 'Your character is saved. Characters permission could not be checked for the portrait.' : 'Characters permission could not be checked. Your draft is still here.', 'error'); } return false; }
    }
    function validate() {
      for (const [input, text] of [[name.input, 'Give your character a title.'], [definition.input, 'Add a personality for your character.'], [greeting.input, 'Add an initial message to start the conversation.']] as const) {
        if (!input.value.trim()) { if (input === greeting.input) showGreeting(0); input.setAttribute('aria-invalid', 'true'); input.focus(); message(text, 'error'); return false; }
      }
      const emptyGreeting = greetingItems.findIndex((item, index) => index > 0 && !item.field.input.value.trim());
      if (emptyGreeting > 0) { showGreeting(emptyGreeting); greetingItems[emptyGreeting].field.input.setAttribute('aria-invalid', 'true'); greetingItems[emptyGreeting].field.input.focus(); message('Write this alternate initial message, or remove it.', 'error'); return false; }
      return true;
    }
    function notify() { if (!current() || !created || notified) return; notified = true; try { options.onCreated?.(created.id); } catch { /* A refresh callback must never turn a saved card into a retryable create. */ } }
    function portraitFailed() { portraitPending = true; message('Character created. The portrait could not be saved. Retry the portrait, or open the character to finish editing.', 'warning'); }
    async function savePortrait() {
      if (!created || !portrait || !current()) return;
      portraitPending = true; if (!await permission()) return;
      if (!current()) return;
      message('Character created. Saving portrait…');
      const body = new FormData(); body.append('avatar', portrait);
      try {
        const response = await fetch(`/api/v1/characters/${encodeURIComponent(created.id)}/avatar`, { method: 'POST', credentials: 'same-origin', body, signal: session.abort.signal });
        if (!current()) return;
        if (!response.ok) { portraitFailed(); return; }
        portraitPending = false; message('Character created and ready to chat.', 'success');
      } catch { if (current()) portraitFailed(); }
    }
    async function retryImage() {
      if (!current() || busy || !created || !portrait || !portraitPending) return;
      busy = true; sync();
      try { if (await permission(!attemptedPermission)) await savePortrait(); }
      finally { if (current()) { busy = false; sync(); } }
    }
    async function submit() {
      if (!current() || busy || created || uncertain || !validate()) return;
      busy = true; sync(); let sent = false;
      // Snapshot the draft before awaiting permissions; the visible form is now locked.
      const input = {
        name: name.input.value.trim(), creator_notes: bio.input.value, description: definition.input.value, first_mes: greeting.input.value,
        scenario: scenario.input.value, mes_example: examples.input.value, creator: creator.input.value.trim(), alternate_greetings: greetingItems.slice(1).map(item => item.field.input.value),
        tags: [...new Set(tags.input.value.split(',').map(value => value.trim()).filter(Boolean))], library_scope: 'mine',
        extensions: chatName.input.value.trim() ? { alternate_character_name: chatName.input.value.trim() } : {},
      };
      try {
        if (!await permission(!attemptedPermission) || !await permission() || !current()) return;
        sent = true; message('Creating your character…');
        const response = await fetch('/api/v1/characters', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: session.abort.signal });
        if (!current()) return;
        if (!response.ok) {
          if ([400, 401, 403, 404, 422].includes(response.status)) { message('Lumiverse could not save this character. Check your fields and Characters permission, then try again.', 'error'); return; }
          uncertain = true; message('The save result could not be confirmed. Check your library before creating this character again.', 'warning'); return;
        }
        const result = record(await response.json()); if (!current()) return;
        if (typeof result.id !== 'string' || !result.id) { uncertain = true; message('The save result could not be confirmed. Check your library before creating this character again.', 'warning'); return; }
        created = { id: result.id, name: typeof result.name === 'string' ? result.name : input.name };
        message('Character created and ready to chat.', 'success');
        if (portrait) await savePortrait();
        notify();
      } catch {
        if (!current()) return;
        if (created) { portraitFailed(); notify(); }
        else if (sent) { uncertain = true; message('The save result could not be confirmed. Check your library before creating this character again.', 'warning'); }
        else message('Your character could not be saved. Your draft is still here.', 'error');
      } finally { if (current()) { busy = false; sync(); } }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    name.input.focus();
  }
  function destroy() { disposed = true; active?.modal.dismiss(); active = undefined; }
  return { open, destroy };
}
