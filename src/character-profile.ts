import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { profileMarkup } from './my-chats';
import { creatorAttribution } from './creator-attribution';
import { mountProfileLorebooks } from './profile-lorebooks';
import { createSoundCloud } from './soundcloud';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Read a selected card without leaving the home view or changing the active chat. */
export function mountCharacterProfile(ctx: SpindleFrontendContext, root: HTMLElement, characterId: string, options: { notesPreview?: boolean; controls?: HTMLElement } = {}) {
  let disposed = false, request = 0, injection: Element | undefined;
  let stopNotes: (() => void) | undefined;
  let stopLorebooks: (() => void) | undefined;
  let soundtrack: ReturnType<typeof createSoundCloud> | undefined;
  root.classList.add('jb-character-profile');
  function clear() {
    stopNotes?.(); stopNotes = undefined;
    stopLorebooks?.(); stopLorebooks = undefined;
    soundtrack?.destroy(); soundtrack = undefined;
    if (injection) {
      try { ctx.dom.uninject(injection); } catch { injection.remove(); }
      injection = undefined;
    }
    root.replaceChildren();
  }
  async function load() {
    const generation = ++request;
    clear(); root.setAttribute('aria-busy', 'true');
    const status = el('p', 'jb-status', 'Loading character profile…'); status.setAttribute('role', 'status'); root.append(status);
    if (options.controls) root.append(options.controls);
    try {
      const value = await ctx.characters.get(characterId);
      if (disposed || generation !== request) return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid character');
      const character = value as Record<string, unknown>;
      if (character.id !== characterId || !text(character.name)) throw new Error('Character mismatch');
      clear();
      const layout = el('div', 'jb-profile-layout');
      const card = el('div', 'jb-profile-card');
      const sidebar = el('div', 'jb-profile-sidebar');
      const header = el('header', 'jb-profile-heading');
      header.append(el('h2', 'jb-profile-title', text(character.name)));
      const portrait = el('div', 'jb-profile-media');
      const fallback = el('span', 'jb-profile-avatar-fallback', text(character.name).slice(0, 1).toUpperCase()); fallback.setAttribute('aria-hidden', 'true'); portrait.append(fallback);
      const img = el('img', 'jb-profile-portrait'); img.alt = text(character.name); img.decoding = 'async';
      img.src = `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg`;
      img.addEventListener('error', () => { img.remove(); portrait.classList.add('jb-profile-no-image'); }); portrait.append(img); header.append(portrait);
      const creator = creatorAttribution(character); const attribution = el('p', 'jb-profile-creator');
      attribution.append(el('span', '', 'by: '));
      if (creator) {
        const name = creator.name === 'Creator profile' || creator.name.startsWith('@') ? creator.name : `@${creator.name}`;
        if (creator.profileUrl) { const link = el('a', '', name); link.href = creator.profileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.append(link); }
        else attribution.append(name);
      } else attribution.textContent = 'Creator not recorded';
      header.append(attribution); card.append(header);
      const tags = el('div', 'jb-profile-tags'); tags.setAttribute('aria-label', 'Character tags');
      if (Array.isArray(character.tags)) for (const tag of character.tags.slice(0, 64)) if (typeof tag === 'string') tags.append(el('span', '', tag));
      const notes = el('details', 'jb-profile-notes'); notes.setAttribute('aria-label', 'Creator’s Note');
      notes.open = !options.notesPreview;
      notes.append(el('summary', '', 'Creator’s Note'));
      const content = el('div', 'jb-profile-rich'); notes.append(content); card.append(notes);
      const note = text(character.creator_notes);
      let notesLoaded = false;
      const showNotes = () => {
        if (!notes.open || notesLoaded || disposed || generation !== request) return;
        notesLoaded = true;
        if (note.trim() && options.notesPreview) {
          const preview = note.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          content.textContent = preview.slice(0, 350) + (preview.length > 350 ? '…' : '');
        } else if (note.trim()) {
          try { injection = ctx.dom.inject(content, profileMarkup(note)); }
          catch { content.textContent = note; }
        } else content.append(el('p', '', 'No creator’s note.'));
      };
      notes.addEventListener('toggle', showNotes);
      stopNotes = () => notes.removeEventListener('toggle', showNotes);
      showNotes();
      const meta = el('div', 'jb-profile-meta');
      for (const [key, label] of [['created_at', 'Added'], ['updated_at', 'Updated']]) {
        const value = character[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
        const date = new Date(value * 1000); if (!Number.isFinite(date.getTime())) continue;
        const time = el('time', '', `${label} ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`); time.dateTime = date.toISOString(); meta.append(time);
      }
      if (tags.childElementCount) meta.append(tags);
      if (meta.childElementCount) card.append(meta);
      soundtrack = createSoundCloud(ctx, { characterId, character }); sidebar.append(soundtrack.root);
      if (options.controls) sidebar.append(options.controls);
      const lorebooks = el('section', 'jb-profile-lorebooks'); sidebar.append(lorebooks);
      stopLorebooks = mountProfileLorebooks(lorebooks, character.extensions);
      const details = el('section', 'jb-profile-details'); details.setAttribute('aria-label', 'Character definition');
      details.append(el('h2', 'jb-profile-definition-title', 'Character definition'), el('p', 'jb-profile-definition-help', 'The saved details and opening messages for this character.'));
      function field(label: string, values: Array<{ label: string; value: string }>, count?: number) {
        const present = values.filter(item => item.value.trim());
        const section = el('details', 'jb-profile-field');
        const summary = el('summary'); summary.append(el('span', '', label));
        if (count !== undefined) summary.append(el('small', 'jb-profile-field-count', String(count)));
        section.append(summary); const body = el('div', 'jb-profile-field-body');
        if (!present.length) body.append(el('p', 'jb-profile-empty', 'Not provided in this card.'));
        for (const item of present) {
          if (present.length > 1) body.append(el('h3', '', item.label));
          body.append(el('p', '', item.value));
        }
        section.append(body); details.append(section); return body;
      }
      field('Scenario', [{ label: 'Scenario', value: text(character.scenario) }]);
      field('Personality', [{ label: 'Description', value: text(character.description) }, { label: 'Personality', value: text(character.personality) }]);
      const messages = [{ label: 'First message', value: text(character.first_mes) }];
      if (Array.isArray(character.alternate_greetings)) character.alternate_greetings.forEach((value, index) => {
        if (typeof value === 'string' && value.trim()) messages.push({ label: `Alternate greeting ${index + 1}`, value });
      });
      const available = messages.filter(item => item.value.trim());
      const greetingBody = field('Initial messages', [], available.length);
      if (available.length) {
        let index = 0;
        const navigation = el('div', 'jb-profile-greeting-nav'); navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Browse greetings');
        const previous = el('button', 'jb-button', '‹'); previous.type = 'button'; previous.setAttribute('aria-label', 'Previous greeting');
        const next = el('button', 'jb-button', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next greeting');
        const position = el('span', 'jb-profile-greeting-position'); position.setAttribute('aria-live', 'polite');
        navigation.append(previous, position, next);
        const label = el('h3', 'jb-profile-greeting-label'); const greeting = el('p', 'jb-profile-greeting-text');
        function showGreeting() { position.textContent = `Greeting ${index + 1} of ${available.length}`; label.textContent = available[index].label; greeting.textContent = available[index].value; greeting.scrollTop = 0; }
        previous.disabled = next.disabled = available.length < 2;
        previous.addEventListener('click', () => { if (!disposed && generation === request) { index = (index + available.length - 1) % available.length; showGreeting(); } });
        next.addEventListener('click', () => { if (!disposed && generation === request) { index = (index + 1) % available.length; showGreeting(); } });
        greetingBody.replaceChildren(navigation, label, greeting); showGreeting();
      }
      field('Example dialogs', [{ label: 'Example dialogue', value: text(character.mes_example) }]);
      for (const [key, label] of [['system_prompt', 'System prompt'], ['post_history_instructions', 'Post-history instructions']]) {
        if (text(character[key]).trim()) field(label, [{ label, value: text(character[key]) }]);
      }
      sidebar.append(details); layout.append(card, sidebar); root.append(layout);
    } catch {
      if (disposed || generation !== request) return;
      clear(); const error = el('p', 'jb-status', 'Could not load this character’s profile.'); error.setAttribute('role', 'status');
      const retry = el('button', 'jb-button', 'Retry'); retry.type = 'button'; retry.addEventListener('click', () => { void load(); });
      root.append(error, retry); if (options.controls) root.append(options.controls);
    } finally {
      if (!disposed && generation === request) root.removeAttribute('aria-busy');
    }
  }
  void load();
  return () => { if (disposed) return; disposed = true; request++; clear(); root.removeAttribute('aria-busy'); };
}
