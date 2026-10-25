import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { profileMarkup } from './my-chats';
import { creatorAttribution } from './creator-attribution';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Read a selected card without leaving the home view or changing the active chat. */
export function mountCharacterProfile(ctx: SpindleFrontendContext, root: HTMLElement, characterId: string, options: { notesPreview?: boolean } = {}) {
  let disposed = false, request = 0, injection: Element | undefined;
  root.classList.add('jb-character-profile');
  function clear() {
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
    try {
      const value = await ctx.characters.get(characterId);
      if (disposed || generation !== request) return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid character');
      const character = value as Record<string, unknown>;
      if (character.id !== characterId || !text(character.name)) throw new Error('Character mismatch');
      clear();
      const header = el('header', 'jb-profile-heading');
      const img = el('img', 'jb-profile-portrait'); img.alt = text(character.name); img.decoding = 'async';
      img.src = `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg`;
      img.addEventListener('error', () => img.remove()); header.append(img);
      const identity = el('div'); identity.append(el('h2', '', text(character.name)));
      const creator = creatorAttribution(character); const attribution = el('p', 'jb-profile-creator');
      if (creator) {
        const name = creator.name === 'Creator profile' || creator.name.startsWith('@') ? creator.name : `@${creator.name}`;
        if (creator.profileUrl) { const link = el('a', '', name); link.href = creator.profileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.append(link); }
        else attribution.textContent = name;
      } else attribution.textContent = 'Creator not recorded';
      identity.append(attribution);
      const tags = el('div', 'jb-profile-tags'); tags.setAttribute('aria-label', 'Character tags');
      if (Array.isArray(character.tags)) for (const tag of character.tags.slice(0, 64)) if (typeof tag === 'string') tags.append(el('span', '', tag));
      identity.append(tags); header.append(identity); root.append(header);
      const notes = el('section', 'jb-profile-notes'); notes.setAttribute('aria-label', 'Creator’s Note');
      notes.append(el('h3', '', 'Creator’s Note'));
      const content = el('div', 'jb-profile-rich'); notes.append(content); root.append(notes);
      const note = text(character.creator_notes);
      if (note.trim() && options.notesPreview) {
        const preview = note.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        content.textContent = preview.slice(0, 350) + (preview.length > 350 ? '…' : '');
      } else if (note.trim()) {
        try { injection = ctx.dom.inject(content, profileMarkup(note)); }
        catch { content.textContent = note; }
      } else content.append(el('p', '', 'No creator’s note.'));
      const details = el('details', 'jb-profile-details'); details.append(el('summary', '', 'Character details'));
      for (const [key, label] of [
        ['description', 'Description'], ['personality', 'Personality'], ['scenario', 'Scenario'],
        ['first_mes', 'First message'], ['mes_example', 'Example dialogue'], ['system_prompt', 'System prompt'],
        ['post_history_instructions', 'Post-history instructions'],
      ]) {
        const field = text(character[key]); if (!field.trim()) continue;
        const section = el('section', 'jb-profile-field'); section.append(el('h3', '', label), el('p', '', field)); details.append(section);
      }
      if (details.childElementCount > 1) root.append(details);
    } catch {
      if (disposed || generation !== request) return;
      clear(); const error = el('p', 'jb-status', 'Could not load this character’s profile.'); error.setAttribute('role', 'status');
      const retry = el('button', 'jb-button', 'Retry'); retry.type = 'button'; retry.addEventListener('click', () => { void load(); });
      root.append(error, retry);
    } finally {
      if (!disposed && generation === request) root.removeAttribute('aria-busy');
    }
  }
  void load();
  return () => { if (disposed) return; disposed = true; request++; clear(); root.removeAttribute('aria-busy'); };
}
