import type { SpindleFrontendContext, SpindleHostSurfaceRef, SpindleModalHandle } from 'lumiverse-spindle-types';
import uiCSS from './ui.css' with { type: 'text' };
import themeCSS from './theme.css' with { type: 'text' };
import layoutCSS from './layout.css' with { type: 'text' };
import settingsCSS from './settings.css' with { type: 'text' };
import composerCSS from './composer.css' with { type: 'text' };
import chatToolsCSS from './chat-tools.css' with { type: 'text' };
import homeBannerCSS from './home-banner.css' with { type: 'text' };
import cardImportCSS from './card-import.css' with { type: 'text' };
import myChatsCSS from './my-chats.css' with { type: 'text' };
import soundCloudCSS from './soundcloud.css' with { type: 'text' };
import customizeCSS from './customize.css' with { type: 'text' };
import characterCreateCSS from './character-create.css' with { type: 'text' };
import tutorialCSS from './feature-tutorials.css' with { type: 'text' };
import welcomeCSS from './welcome.css' with { type: 'text' };
import { createChatMemory } from './memory';
import { createApiSettings } from './api-settings';
import { createPromptSettings } from './prompt-settings';
import { icon } from './icons';
import { createBrand } from './brand';
import { createComposer } from './composer';
import { createChatTools } from './chat-tools';
import { createHomeBanner, createMemoryPromo, createPresetPromo } from './home-banner';
import { createCardImport } from './card-import';
import { createMyChats } from './my-chats';
import { createSoundCloud } from './soundcloud';
import { mountCharacterProfile } from './character-profile';
import { createCustomize } from './customize';
import { createSettingsWindow } from './settings-window';
import { creatorAttribution, type CreatorAttribution } from './creator-attribution';
import { createCharacterCreate } from './character-create';
import { openFeatureTutorial, type TutorialFeature } from './feature-tutorials';
import { tutorialScreenshots } from './tutorial-screenshots';
import { readOptionalState, subscribeOptionalState } from './optional-state';
import { createWelcome } from './welcome';
import { groupCharacters, type CharacterGroup, type CharacterSignatureCache, type CharacterSummary } from './character-library';

type Character = CharacterSummary;
type View = 'browse' | 'chats';
const pageSize = 24;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
}
function button(text: string, action: () => void, cls = 'jb-button') {
  const node = el('button', cls, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function plain(value = '') { return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function payload(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }

/** A visual home/navigation layer using public extension slots. Native chat rendering stays mounted. */
export function setup(ctx: SpindleFrontendContext) {
  let disposed = false, view: View = 'browse', offset = 0, total = 0, filter = 'all', request = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
  let libraryRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let modal: SpindleModalHandle | undefined;
  let tutorialWindow: ReturnType<typeof openFeatureTutorial> | undefined;
  let tutorialRequest = 0;
  const cleanups: Array<() => void> = [];
  const notePreviews = new Map<string, { revision: number | undefined; text: string; creator?: CreatorAttribution }>();
  const signatures: CharacterSignatureCache = new Map();
  let libraryCache: { key: string; groups: CharacterGroup[]; cardCount: number } | undefined;
  const favoriteWrites = new Map<string, boolean>();
  let favoriteQueue = Promise.resolve();
  const mounts = [ctx.ui.mount('landing_header'), ctx.ui.mount('chat_header_left'), ctx.ui.mount('landing_hero')];
  const oldView = document.documentElement.getAttribute('data-janitor-bridge-view');
  const settingsWindow = createSettingsWindow(ctx, {
    hasChat: () => !!ctx.getActiveChat()?.chatId && location.pathname.startsWith('/chat/'),
    navigate: section => {
      if (section === 'memory') { const chatId = ctx.getActiveChat()?.chatId; if (chatId) openMemory(chatId); }
      else if (section === 'customize') openCustomize();
      else openApi();
    },
  });
  const memory = createChatMemory(settingsWindow.context('memory'), {
    mountPromo: target => {
      const promo = createMemoryPromo(ctx, { invoke: async ref => {
        const opened = await invoke(ref);
        if (opened) settingsWindow.close();
        return opened;
      } });
      target.append(promo.root);
      return promo;
    },
  });
  const composer = createComposer(ctx, {
    onDiscover: () => chatTools.openHelp('extensions'),
  });
  const chatTools = createChatTools(ctx, {
    onLayoutChange: layout => composer.setEnabled(layout === 'janitorai'),
    openApi,
    openMemory: () => { const chatId = ctx.getActiveChat()?.chatId; if (chatId) openMemory(chatId); },
    openPersonas: () => invoke({ kind: 'drawer_tab', id: 'personas' }),
    invoke,
  });
  const promptSettings = createPromptSettings(settingsWindow.context('settings'), {
    openConnection: openApi,
    openPresetManager: () => {
      void invoke({ kind: 'drawer_tab', id: 'loom' }).then(opened => {
        if (opened) settingsWindow.close();
      });
    },
    openIllarinSettings: () => {
      void invoke({ kind: 'settings_tab', id: 'illarin' }, { anchorId: 'setsec-illarin-general' }).then(opened => {
        if (opened) settingsWindow.close();
      });
    },
  });
  const apiSettings = createApiSettings(settingsWindow.context('settings'), {
    openInstructions: () => openPrompt('prompt'),
    openGeneration: () => openPrompt('generation'),
    openNativeConnections: () => { void invoke({ kind: 'drawer_tab', id: 'connections' }); },
    mountPreferences: target => {
      const preferences = promptSettings.mount(target);
      const footer = target.querySelector<HTMLElement>('.jb-prompt-settings-inline > .jb-settings-actions');
      const apiRoot = target.closest<HTMLElement>('.jb-api-settings');
      let footerObserver: MutationObserver | undefined;
      if (footer) {
        footer.classList.add('jb-settings-window-footer', 'jb-settings');
        const savePreferences = footer.querySelector<HTMLButtonElement>('.jb-settings-save');
        if (savePreferences) savePreferences.textContent = 'Save prompt & generation';
        target.closest('.jb-settings-window-root')?.append(footer);
        if (apiRoot && typeof MutationObserver === 'function') {
          const syncFooter = () => { footer.inert = apiRoot.getAttribute('aria-busy') === 'true'; };
          footerObserver = new MutationObserver(syncFooter);
          footerObserver.observe(apiRoot, { attributes: true, attributeFilter: ['aria-busy'] });
          syncFooter();
        }
      }
      const promo = createPresetPromo(ctx);
      target.parentElement?.prepend(promo.root);
      return { refresh() { preferences.refresh(); }, destroy() { footerObserver?.disconnect(); preferences.destroy(); promo.destroy(); footer?.remove(); } };
    },
    onApplied: () => { void refreshConnection(); },
  });
  const customize = createCustomize(ctx, { settings: () => openPrompt('generation'), memory: chatId => openMemory(chatId) });
  function openApi() { apiSettings.open(); }
  function openPrompt(tab: 'prompt' | 'generation') { promptSettings.open(tab); }
  function openMemory(chatId: string, draft?: string) { memory.open(chatId, draft); }
  function openCustomize() {
    settingsWindow.dismissEditor();
    const panel = customize.open();
    if (panel) settingsWindow.adoptCustomize(panel, () => customize.close());
  }
  const cardImport = createCardImport(ctx, {
    onImported: () => { libraryCache = undefined; offset = 0; void loadCharacters(); },
    openCharacter: id => {
      void ctx.characters.get(id).then(value => {
        const character = payload(value);
        if (!disposed && typeof character.id === 'string' && typeof character.name === 'string') preview(character as Character);
      }).catch(() => { if (!disposed) status.textContent = 'Could not open the imported character. It is saved in your character library.'; });
    },
  });
  const characterCreate = createCharacterCreate(ctx, {
    onCreated: () => { libraryCache = undefined; offset = 0; void loadCharacters(); },
    openCharacter: id => {
      void ctx.characters.get(id).then(value => {
        const character = payload(value);
        if (!disposed && typeof character.id === 'string' && typeof character.name === 'string') preview(character as Character);
      }).catch(() => { if (!disposed) status.textContent = 'Your character is saved. Open it from the character library.'; });
    },
  });
  cleanups.push(ctx.dom.addStyle(characterCreateCSS), ctx.dom.addStyle(tutorialCSS), ctx.dom.addStyle(welcomeCSS), ctx.dom.addStyle(chatToolsCSS));
  cleanups.push(ctx.dom.addStyle(themeCSS), ctx.dom.addStyle(layoutCSS), ctx.dom.addStyle(uiCSS), ctx.dom.addStyle(settingsCSS), ctx.dom.addStyle(composerCSS), ctx.dom.addStyle(homeBannerCSS), ctx.dom.addStyle(cardImportCSS), ctx.dom.addStyle(myChatsCSS), ctx.dom.addStyle(soundCloudCSS), ctx.dom.addStyle(customizeCSS));
  const status = el('p', 'jb-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const navButtons: Array<{ node: HTMLButtonElement; view: View }> = [];
  async function invoke(ref: SpindleHostSurfaceRef, params?: Record<string, string>) {
    if (!ctx.host.surfaces?.list([ref.kind]).some(s => s.id === ref.id && s.invocable !== false)) {
      status.textContent = 'This shortcut is unavailable. Open the same tool from Lumiverse’s sidebar.'; return false;
    }
    try { await ctx.host.surfaces.invoke(ref, params); return true; }
    catch { if (!disposed) status.textContent = 'Could not open that tool. Please try again from the sidebar.'; return false; }
  }
  function openImport() {
    const jar = ctx.host.surfaces?.list(['drawer_tab']).find(surface => surface.invocable !== false && surface.keywords?.includes('jar_bridge') && surface.keywords?.includes('jar-bridge-import'));
    if (jar && jar.keywords?.includes('jar-bridge-guided-import') && ctx.events?.emit) ctx.events.emit('jar_bridge:open_import', {});
    else if (jar) void invoke({ kind: 'drawer_tab', id: jar.id });
    else cardImport.open();
  }
  function openTutorial(feature: TutorialFeature) {
    tutorialWindow?.destroy();
    const request = ++tutorialRequest;
    tutorialWindow = openFeatureTutorial(ctx, feature, { invoke, openImport, screenshots: tutorialScreenshots,
      onClose: () => { if (request === tutorialRequest) tutorialWindow = undefined; },
    });
  }
  function setView(next: View, navigate = true) {
    soundCloud.close();
    view = next; document.documentElement.setAttribute('data-janitor-bridge-view', view);
    navButtons.forEach(({ node, view: target }) => {
      node.classList.toggle('jb-selected', target === view); node.setAttribute('aria-current', target === view ? 'page' : 'false');
    });
    if (navigate && location.pathname !== '/') void invoke({ kind: 'route', id: '/' });
    if (next === 'chats' && location.pathname === '/') myChats.activate(); else myChats.deactivate();
    if (next === 'browse' && location.pathname === '/') { void loadCharacters(); void loadRecent(); }
  }
  const masthead = el('div', 'jb-home-masthead');
  const nav = el('nav', 'jb-nav'); nav.setAttribute('aria-label', 'Main navigation');
  for (const [text, target] of [['Home', 'browse'], ['My Chats', 'chats']] as const) {
    const node = button(text, () => setView(target), 'jb-nav-link'); navButtons.push({ node, view: target }); nav.append(node);
  }
  const more = el('details', 'jb-more'); const moreLabel = el('summary', '', 'More'); const menu = el('div', 'jb-more-menu');
  for (const [label, action] of [
    ['Start here', () => welcome.open()],
    ['Import characters', openImport],
    ['Import card file or link', () => cardImport.open()],
    ['API Settings', openApi],
    ['Prompt', () => openPrompt('prompt')],
    ['Generation Settings', () => openPrompt('generation')],
  ] as const) menu.append(button(label, () => { more.open = false; action(); }, 'jb-menu-link'));
  for (const [label, id] of [['My Personas', 'personas'], ['Advanced Presets', 'loom'], ['Lorebooks', 'lorebook'], ['Extensions', 'spindle']]) {
    menu.append(button(label, () => { more.open = false; void invoke({ kind: 'drawer_tab', id }); }, 'jb-menu-link'));
  }
  menu.append(button('Chat tools & help', () => { more.open = false; chatTools.openHelp(); }, 'jb-menu-link'));
  more.append(moreLabel, menu);
  const create = button('Create a Character', () => characterCreate.open(), 'jb-create-link');
  masthead.append(nav);
  mounts[0].append(createBrand(() => { if (!disposed) setView('browse'); }), masthead);

  const chatHeader = el('header', 'jb-chat-header');
  const chatBar = el('div', 'jb-chat-bar'); const chatRight = el('div', 'jb-chat-right');
  const back = button('‹ Back', () => setView('chats'), 'jb-back');
  const api = button('API Settings', openApi, 'jb-api-status'); api.setAttribute('aria-label', 'API Settings');
  const helpButton = button('?', () => { chatMenu.open = false; chatTools.openHelp(); }, 'jb-chat-help-button'); helpButton.setAttribute('aria-label', 'Chat tools & help'); helpButton.title = 'Chat tools & help';
  const chatMenu = el('details', 'jb-more jb-chat-menu'); const chatMenuLabel = el('summary', '', '☰'); chatMenuLabel.setAttribute('aria-label', 'Chat menu');
  chatMenuLabel.replaceChildren(icon('menu'));
  const chatMenuItems = el('div', 'jb-more-menu'); chatMenuItems.setAttribute('role', 'menu'); chatMenuItems.setAttribute('aria-label', 'Chat actions');
  const chatAction = (label: string, action: () => void, picture: Parameters<typeof icon>[0]) => {
    const item = button(label, () => { chatMenu.open = false; action(); }, 'jb-menu-link'); item.setAttribute('role', 'menuitem'); item.prepend(icon(picture)); chatMenuItems.append(item); return item;
  };
  chatAction('Settings', openApi, 'settings');
  const memoryMenuItem = chatAction('Chat Memory', () => { const chatId = ctx.getActiveChat()?.chatId; if (chatId) openMemory(chatId); }, 'memory');
  chatAction('Customize', openCustomize, 'customize');
  chatAction('New Chat', () => { const characterId = ctx.getActiveChat()?.characterId; if (characterId) void invoke({ kind: 'entity_action', id: 'character_chat' }, { characterId, mode: 'new' }); }, 'new-chat');
  chatAction('All Chats', () => setView('chats'), 'all-chats');
  chatMenu.append(chatMenuLabel, chatMenuItems); chatRight.append(api, helpButton, chatMenu); chatBar.append(back, chatRight);
  chatMenu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && chatMenu.open) { event.preventDefault(); event.stopPropagation(); chatMenu.open = false; chatMenuLabel.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const choices = [...chatMenuItems.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!choices.length) return;
    event.preventDefault(); event.stopPropagation(); chatMenu.open = true;
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : index < 0 ? (event.key === 'ArrowUp' ? choices.length - 1 : 0) : (index + (event.key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    choices[next].focus();
  });
  const chatTitle = button('Conversation', () => { void invoke({ kind: 'drawer_tab', id: 'profile' }); }, 'jb-chat-title');
  const soundCloud = createSoundCloud(ctx);
  chatBar.insertBefore(chatTitle, chatRight);
  chatHeader.append(chatBar, soundCloud.root); mounts[1].append(chatHeader);
  let titleRequest = 0;
  async function refreshChatHeader() {
    const active = ctx.getActiveChat(); const generation = ++titleRequest;
    memoryMenuItem.disabled = !active?.chatId;
    chatTitle.textContent = 'Conversation';
    if (active?.characterId) {
      try { const character = payload(await ctx.characters.get(active.characterId)); if (!disposed && generation === titleRequest && typeof character.name === 'string') chatTitle.textContent = character.name; } catch { /* Native profile stays available. */ }
    }
  }
  let connectionRequest = 0;
  function renderConnection(connection: Record<string, unknown>) {
    const model = typeof connection.model === 'string' ? connection.model : '';
    const provider = typeof connection.provider === 'string' ? connection.provider : '';
    const providerNames: Record<string, string> = { custom: 'proxy', openai: 'OpenAI', openrouter: 'OpenRouter', nanogpt: 'NanoGPT', google_vertex: 'Vertex', google: 'Gemini', anthropic: 'Claude', deepseek: 'DeepSeek', zai: 'Z.AI', chutes: 'Chutes' };
    api.textContent = model || provider ? `using ${providerNames[provider] || provider || 'API'}` : 'API not ready · Set up';
    api.classList.toggle('jb-api-missing', !model && !provider);
    api.title = model || provider ? `API Settings: ${provider}${model ? ` / ${model}` : ''}` : 'Choose a provider and model';
  }
  async function refreshConnection() {
    const generation = ++connectionRequest;
    const connection = payload(readOptionalState(ctx, 'connections.active', null));
    const active = ctx.getActiveChat();
    renderConnection(connection);
    if (!active?.chatId) return;
    try {
      const chatResponse = await fetch(`/api/v1/chats/${encodeURIComponent(active.chatId)}?messages=false`, { credentials: 'same-origin' });
      if (!chatResponse.ok || disposed || generation !== connectionRequest) return;
      const metadata = payload(payload(await chatResponse.json()).metadata);
      if (disposed || generation !== connectionRequest) return;
      const profileId = typeof metadata.connection_profile_id === 'string' ? metadata.connection_profile_id : '';
      const model = typeof metadata.connection_model === 'string' ? metadata.connection_model : '';
      if (!profileId) { if (model) renderConnection({ ...connection, model }); return; }
      const response = await fetch(`/api/v1/connections/${encodeURIComponent(profileId)}`, { credentials: 'same-origin' });
      if (!response.ok) return;
      const profile = payload(await response.json());
      if (!disposed && generation === connectionRequest) renderConnection({ ...profile, ...(model ? { model } : {}) });
    } catch { /* The settings dialog reports unavailable saved configurations. */ }
  }
  const home = el('section', 'jb-home'); home.setAttribute('aria-label', 'Character browsing');
  const homeBanner = createHomeBanner(ctx, { invoke, openApi, openImport, openPrompt: () => openPrompt('prompt'), openTutorial }); home.append(homeBanner.root);
  const recentSection = el('section', 'jb-recent-section'); const recentHeading = el('div', 'jb-section-heading');
  recentHeading.append(el('h2', '', 'My chats'), button('View all →', () => setView('chats'), 'jb-text-button'));
  const recent = el('div', 'jb-recent'); recentSection.append(recentHeading, recent); home.append(recentSection);
  const heading = el('div', 'jb-browse-heading'); const title = el('div');
  const browseTitle = el('h2', '', 'All Characters'); title.append(el('div', 'jb-eyebrow', 'CHARACTERS'), browseTitle);
  title.append(el('p', 'jb-browse-help', 'Your saved character cards, including cards you haven’t chatted with yet.'));
  heading.append(title);
  const tools = el('div', 'jb-tools'); const filters = el('div', 'jb-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filter characters');
  const allButton = button('All characters', () => chooseFilter('all'), 'jb-filter jb-selected');
  const favoriteButton = button('♥ Favorites', () => chooseFilter('favorites'), 'jb-filter');
  allButton.setAttribute('aria-pressed', 'true'); favoriteButton.setAttribute('aria-pressed', 'false'); filters.append(allButton, favoriteButton);
  const searchLabel = el('label', 'jb-search'); searchLabel.append(el('span', 'jb-sr-only', 'Search characters'));
  const search = el('input'); search.type = 'search'; search.placeholder = 'Search for characters or creators…'; search.maxLength = 256; searchLabel.append(search);
  const sort = el('select', 'jb-sort'); sort.setAttribute('aria-label', 'Sort characters');
  for (const [value, text] of [['created', 'Newest added'], ['name', 'Name A–Z']]) { const option = el('option', '', text); option.value = value; sort.append(option); }
  masthead.append(searchLabel, create, more); heading.append(sort); tools.append(filters); home.append(tools, heading);
  const grid = el('div', 'jb-grid'); const count = el('p', 'jb-count');
  let cardCleanups: Array<() => void> = [];
  function disposeCards() { const previous = cardCleanups; cardCleanups = []; previous.forEach(cleanup => cleanup()); }
  cleanups.push(disposeCards);
  const paging = el('div', 'jb-paging'); const pageLabel = el('span');
  const previous = button('← Previous', () => { offset = Math.max(0, offset - pageSize); void loadCharacters(); });
  const next = button('Next →', () => { offset += pageSize; void loadCharacters(); }); paging.append(previous, pageLabel, next);
  home.append(status, count, grid, paging); mounts[2].append(home);
  const myChats = createMyChats(ctx, {
    invoke,
    openCharacter: id => openProfile(id),
    startChat: characterId => invoke({ kind: 'entity_action', id: 'character_chat' }, { characterId, mode: 'new' }),
  });
  mounts[2].append(myChats.root);
  function chooseFilter(nextFilter: string) {
    filter = nextFilter; offset = 0;
    browseTitle.textContent = filter === 'favorites' ? 'Favorites' : 'All Characters';
    for (const [node, value] of [[allButton, 'all'], [favoriteButton, 'favorites']] as const) {
      node.classList.toggle('jb-selected', filter === value); node.setAttribute('aria-pressed', String(filter === value));
    }
    void loadCharacters();
  }
  const favorites = () => {
    const value = readOptionalState<unknown>(ctx, 'characters.favorites', []); const ids = new Set<string>(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
    for (const [id, added] of favoriteWrites) { if (added) ids.add(id); else ids.delete(id); }
    return [...ids];
  };
  function renderCreator(target: HTMLElement, creator?: CreatorAttribution) {
    target.replaceChildren();
    if (!creator) { target.textContent = 'Creator not recorded'; return; }
    const name = creator.name === 'Creator profile' || creator.name.startsWith('@') ? creator.name : `@${creator.name}`;
    if (!creator.profileUrl) { target.textContent = name; return; }
    const link = el('a', '', name); link.href = creator.profileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `View creator ${creator.name}`); target.append(link);
  }
  function notePreview(value: string) {
    const text = plain(value.replace(/<\/?(?:p|div|h[1-6]|br|li|ul|ol|blockquote|hr)\b[^>]*>/gi, ' '));
    return text ? text.slice(0, 230) + (text.length > 230 ? '…' : '') : 'No creator’s note.';
  }
  function renderCards(groups: CharacterGroup[], generation = request) {
    disposeCards(); grid.replaceChildren();
    const pending: Array<{ character: Character; node: HTMLElement; creator: HTMLElement }> = [];
    for (const group of groups) {
      const character = group.character;
      const card = el('article', 'jb-card'); card.dataset.characterId = character.id; card.setAttribute('aria-label', character.name);
      card.addEventListener('click', event => { if (!(event.target as Element).closest?.('button,a,input,select,textarea,summary')) preview(character, group.copies); });
      const portrait = button('', () => preview(character, group.copies), 'jb-portrait jb-card-open'); portrait.setAttribute('aria-label', `Read Creator’s Notes for ${character.name}`);
      if (character.image_id) { const img = el('img'); img.src = `/api/v1/images/${encodeURIComponent(character.image_id)}?size=lg`; img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.remove()); portrait.append(img); }
      portrait.append(el('span', 'jb-avatar-fallback', character.name.slice(0, 1).toUpperCase()));
      portrait.append(el('span', 'jb-card-cta', 'Read Creator’s Notes →'));
      const cardTitle = el('h3', 'jb-card-name'); cardTitle.append(button(character.name, () => preview(character, group.copies), 'jb-card-title'));
      const media = el('div', 'jb-card-media');
      const cardStatus = el('p', 'jb-card-status'); cardStatus.setAttribute('role', 'status');
      const favorite = favoriteControl(character.id, {
        isCurrent: () => generation === request && view === 'browse' && card.isConnected,
        onDispose: cleanup => { cardCleanups.push(cleanup); },
      }, cardStatus, character.name);
      favorite.classList.add('jb-card-favorite'); media.append(portrait, favorite);
      const info = el('div', 'jb-card-info'); const creator = el('p', 'jb-creator'); info.append(creator);
      const cached = notePreviews.get(character.id);
      const freshCache = cached?.revision === character.updated_at ? cached : undefined;
      renderCreator(creator, freshCache?.creator ?? creatorAttribution(character));
      const note = el('p', 'jb-description');
      note.setAttribute('aria-label', 'Creator’s note');
      if (typeof character.creator_notes === 'string') note.textContent = notePreview(character.creator_notes);
      else if (freshCache) note.textContent = freshCache.text;
      else note.textContent = 'Loading creator’s note…';
      if (!freshCache && (typeof character.creator_notes !== 'string' || !creatorAttribution(character)?.profileUrl)) pending.push({ character, node: note, creator });
      info.append(note, cardStatus);
      if (group.copies.length > 1) {
        const copies = button(`${group.copies.length} saved copies`, () => preview(character, group.copies), 'jb-card-copies');
        copies.setAttribute('aria-label', `Choose saved copy of ${character.name}`); info.append(copies);
      }
      const tags = el('div', 'jb-tags'); for (const tag of (character.tags || []).slice(0, 4)) tags.append(el('span', '', tag)); info.append(tags);
      card.append(cardTitle, media, info); grid.append(card);
    }
    if (!groups.length) {
      const empty = el('div', 'jb-empty'); empty.append(el('h3', '', 'No character cards found'), el('p', '', filter === 'favorites' ? 'Character cards you favorite in Lumiverse appear here.' : search.value ? 'Try another name, creator, or description.' : 'Create or import a character card to add it to your library.'), button('Open character library', () => { void invoke({ kind: 'drawer_tab', id: 'characters' }); })); grid.append(empty);
    }
    // Summary DTOs can omit notes and creator provenance. Read only this page,
    // with one bounded pool, and cache both until a revision/library change.
    const current = () => !disposed && generation === request && view === 'browse';
    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (current()) {
        const item = pending.shift(); if (!item) return;
        try {
          const value = payload(await ctx.characters.get(item.character.id));
          if (!current()) return;
          if (value.id !== item.character.id) throw new Error('Wrong character');
          const text = notePreview(typeof value.creator_notes === 'string' ? value.creator_notes : item.character.creator_notes ?? '');
          const creator = creatorAttribution(value) ?? creatorAttribution(item.character);
          notePreviews.set(item.character.id, { revision: item.character.updated_at, text, creator });
          if (notePreviews.size > 200) notePreviews.delete(notePreviews.keys().next().value!);
          if (item.node.isConnected) item.node.textContent = text;
          if (item.creator.isConnected) renderCreator(item.creator, creator);
        } catch { if (current() && item.node.isConnected && typeof item.character.creator_notes !== 'string') item.node.textContent = 'Creator’s note unavailable.'; }
      }
    }));
  }
  async function loadCharacters() {
    const generation = ++request; controller?.abort(); controller = new AbortController(); grid.setAttribute('aria-busy', 'true'); status.textContent = '';
    previous.disabled = true; next.disabled = true;
    const params = new URLSearchParams({ limit: '1000', offset: '0', search: search.value.trim(), sort: sort.value, direction: sort.value === 'name' ? 'asc' : 'desc' });
    if (filter === 'favorites') { params.set('filter', 'favorites'); params.set('favorite_ids', favorites().join(',')); }
    try {
      const key = params.toString();
      if (libraryCache?.key !== key) {
        const characters: Character[] = [], ids = new Set<string>();
        if (filter !== 'favorites' || favorites().length) {
          let read = 0;
          // Group before slicing pages: the same saved card can be imported on
          // opposite sides of a native page boundary. Only summary data is
          // indexed; full definitions are compared for plausible collisions.
          while (true) {
            params.set('offset', String(read));
            const response = await fetch(`/api/v1/characters/summary?${params}`, { credentials: 'same-origin', signal: controller.signal });
            if (!response.ok) throw new Error('Character library unavailable');
            const result = await response.json(); if (disposed || generation !== request) return;
            if (!Array.isArray(result.data)) throw new Error('Invalid character index');
            const rows = result.data.filter((c: Character) => c && typeof c.id === 'string' && typeof c.name === 'string');
            let added = 0;
            for (const character of rows) if (!ids.has(character.id)) { ids.add(character.id); characters.push(character); added++; }
            read += result.data.length;
            const expected = typeof result.total === 'number' && Number.isFinite(result.total) ? result.total : read;
            if (!result.data.length || read >= expected) break;
            if (!added) throw new Error('Character index did not advance');
          }
        }
        const groups = await groupCharacters(characters, id => ctx.characters.get(id), signatures, () => !disposed && generation === request);
        if (disposed || generation !== request) return;
        libraryCache = { key, groups, cardCount: characters.length };
      }
      total = libraryCache.groups.length;
      if (offset >= total) offset = Math.max(0, Math.floor((total - 1) / pageSize) * pageSize);
      renderCards(libraryCache.groups.slice(offset, offset + pageSize));
      if (disposed || generation !== request) return;
      count.textContent = libraryCache.cardCount === total
        ? `${total} ${filter === 'favorites' ? 'favorite' : 'saved'} character card${total === 1 ? '' : 's'}`
        : `${total} character${total === 1 ? '' : 's'} · ${libraryCache.cardCount} ${filter === 'favorites' ? 'favorite' : 'saved'} cards`;
      pageLabel.textContent = total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : '0 character cards';
      paging.hidden = total <= pageSize; previous.disabled = offset === 0; next.disabled = offset + pageSize >= total;
    } catch (error) {
      if (disposed || generation !== request || (error as Error).name === 'AbortError') return;
      disposeCards(); grid.replaceChildren(); status.replaceChildren(document.createTextNode('Could not load character cards. '), button('Retry', () => { void loadCharacters(); })); count.textContent = ''; paging.hidden = true;
    } finally { if (!disposed && generation === request) grid.setAttribute('aria-busy', 'false'); }
  }
  let recentRequest = 0;
  async function loadRecent() {
    const generation = ++recentRequest;
    if (!ctx.chats.listRecent) { recentSection.hidden = true; return; }
    try {
      const result = await ctx.chats.listRecent({ limit: 5, offset: 0, sort: 'recent', direction: 'desc' });
      if (disposed || generation !== recentRequest) return;
      recent.replaceChildren(); recentSection.hidden = !result.data.length;
      for (const chat of result.data) {
        const node = button('', () => { void invoke({ kind: 'route', id: '/chat/:chatId' }, { chatId: chat.id }); }, 'jb-recent-card');
        node.append(el('strong', 'jb-recent-name', chat.character_name || chat.name || 'Untitled chat'));
        const row = el('span', 'jb-recent-body');
        if (chat.character_image_id) { const image = el('img'); image.src = `/api/v1/images/${encodeURIComponent(chat.character_image_id)}?size=sm`; image.alt = ''; image.loading = 'lazy'; row.append(image); }
        else row.append(el('span', 'jb-recent-avatar', (chat.character_name || chat.name || 'C').slice(0, 1)));
        row.append(el('span', 'jb-recent-preview', plain(chat.last_message_preview || '').slice(0, 150) || 'Your conversation is ready to continue.'));
        const count = chat.message_count ?? 0;
        const footer = el('span', 'jb-recent-footer'); footer.append(el('small', '', `${count} ${count === 1 ? 'message' : 'messages'}`), el('span', 'jb-continue', 'Continue'));
        node.append(row, footer); recent.append(node);
      }
    } catch { if (!disposed && generation === recentRequest) recentSection.hidden = true; }
  }
  function favoriteControl(characterId: string, owner: { isCurrent: () => boolean; onDispose: (cleanup: () => void) => void }, localStatus: HTMLElement, cardName?: string) {
    const toggle = button('Favorite', () => { void save(); });
    const abort = new AbortController(); let closed = false, busy = false;
    const current = () => !disposed && !closed && owner.isCurrent();
    function render() {
      const added = favorites().includes(characterId); toggle.textContent = cardName ? added ? '♥' : '♡' : added ? 'Favorited' : 'Favorite';
      toggle.setAttribute('aria-pressed', String(added)); toggle.title = added ? 'Remove from favorites' : 'Add to favorites'; toggle.disabled = busy;
      if (cardName) toggle.setAttribute('aria-label', added ? `Remove ${cardName} from favorites` : `Favorite ${cardName}`);
    }
    async function save() {
      if (!current() || busy) return;
      const added = !favorites().includes(characterId); busy = true; render(); localStatus.textContent = 'Saving favorite…';
      const previousWrite = favoriteQueue; let release!: () => void;
      favoriteQueue = new Promise<void>(resolve => { release = resolve; });
      try {
        await previousWrite; if (!current()) return;
        // Re-read the authenticated native preference before merging so unrelated
        // favorites saved from another surface are not replaced by our snapshot.
        const response = await fetch('/api/v1/settings/favorites', { credentials: 'same-origin', signal: abort.signal });
        if (!current()) return;
        if (!response.ok && response.status !== 404) throw new Error('read');
        const previous: unknown = response.status === 404 ? [] : payload(await response.json()).value;
        if (!current()) return;
        if (!Array.isArray(previous) || previous.some(id => typeof id !== 'string')) throw new Error('invalid favorites');
        const next = added ? [...new Set([...previous, characterId])] : previous.filter(id => id !== characterId);
        if (JSON.stringify(next) !== JSON.stringify(previous)) {
          const saved = await fetch('/api/v1/settings/favorites', { method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: next }) });
          if (!saved.ok) throw new Error('save');
        }
        if (!current()) return;
        // Only bridge the short gap until SETTINGS_UPDATED refreshes the host's
        // characters.favorites selector. Persistence belongs to Lumiverse.
        favoriteWrites.set(characterId, added);
        localStatus.textContent = added ? 'Added to favorites.' : 'Removed from favorites.';
        offset = 0; if (view === 'browse') void loadCharacters();
      } catch { if (current()) localStatus.textContent = 'Could not save this favorite. Please try again.'; }
      finally { release(); busy = false; if (current()) render(); }
    }
    const stop = subscribeOptionalState(ctx, 'characters.favorites', render);
    owner.onDispose(() => { closed = true; abort.abort(); stop?.(); });
    render(); return toggle;
  }
  function openProfile(characterId: string, name = 'Character profile', copies: Character[] = []) {
    modal?.dismiss(); modal = ctx.ui.showModal({ title: name, width: 720, maxHeight: 800 });
    const current = modal; current.root.classList.add('jb-preview', 'jb-profile-window');
    const actions = el('div', 'jb-preview-actions'); const localStatus = el('p', 'jb-status'); localStatus.setAttribute('role', 'status');
    const canStartChat = ctx.host.surfaces?.list(['entity_action']).some(s => s.id === 'character_chat' && s.invocable !== false) ?? false;
    const chat = button('Start new chat', () => {
      if (!canStartChat || chat.disabled) return;
      chat.disabled = true;
      void invoke({ kind: 'entity_action', id: 'character_chat' }, { characterId, mode: 'new' }).then(ok => {
        if (disposed || modal !== current) return;
        chat.disabled = false; if (ok) current.dismiss(); else localStatus.textContent = 'Enable the extension’s Chats permission in Extensions to start chats here.';
      });
    });
    chat.disabled = !canStartChat;
    if (!canStartChat) localStatus.textContent = 'Starting a chat needs the extension’s Chats permission. You can still read and favorite this card.';
    const edit = button('Edit card', () => {
      edit.disabled = true;
      void invoke({ kind: 'modal', id: 'character_editor' }, { id: characterId }).then(ok => {
        if (disposed || modal !== current) return;
        edit.disabled = false; if (ok) current.dismiss(); else localStatus.textContent = 'Could not open the character editor. Your profile is still available here.';
      });
    });
    edit.disabled = !ctx.host.surfaces?.list(['modal']).some(s => s.id === 'character_editor' && s.invocable !== false);
    actions.append(favoriteControl(characterId, { isCurrent: () => modal === current, onDispose: cleanup => { current.onDismiss(cleanup); } }, localStatus), edit, button('Close', () => current.dismiss()));
    if (copies.length > 1) {
      const picker = el('div', 'jb-profile-copies'); const label = el('label', '', 'Saved copy');
      const select = el('select', 'jb-profile-copy-select'); select.setAttribute('aria-label', 'Saved copy');
      for (const [index, copy] of copies.entries()) {
        const saved = typeof copy.created_at === 'number' ? new Date(copy.created_at * 1000) : undefined;
        const when = saved && Number.isFinite(saved.getTime()) ? ` · ${saved.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '';
        const option = el('option', '', `Copy ${index + 1}${when}`); option.value = copy.id; select.append(option);
      }
      select.value = characterId;
      select.addEventListener('change', () => { const copy = copies.find(copy => copy.id === select.value); if (copy && !disposed && modal === current) openProfile(copy.id, copy.name, copies); });
      label.append(select); picker.append(label, el('p', '', 'Choose a saved copy to read or use. Each keeps its own chats, favorites and lorebook links.')); current.root.append(picker);
    }
    const body = el('div', 'jb-preview-body'); const chatActions = el('div', 'jb-profile-chat-actions'); chatActions.append(chat);
    current.root.append(body, actions, localStatus, chatActions);
    const cleanup = mountCharacterProfile(ctx, body, characterId);
    current.onDismiss(() => { cleanup(); if (modal === current) modal = undefined; });
  }
  function preview(character: Character, copies?: Character[]) {
    openProfile(character.id, character.name, copies);
  }
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { offset = 0; void loadCharacters(); }, 200); });
  sort.addEventListener('change', () => { offset = 0; void loadCharacters(); });
  if (ctx.events?.on) {
    for (const event of ['CHARACTER_CREATED', 'CHARACTER_EDITED', 'CHARACTER_DELETED', 'CHARACTER_LIBRARY_CHANGED', 'CHARACTER_AVATAR_CHANGED', 'jar_bridge:imported'] as const) {
      cleanups.push(ctx.events.on(event, () => {
        notePreviews.clear(); libraryCache = undefined; signatures.clear(); request++; controller?.abort();
        clearTimeout(libraryRefreshTimer);
        libraryRefreshTimer = setTimeout(() => { if (!disposed) { offset = 0; if (view === 'browse') void loadCharacters(); else myChats.refresh(); } }, 300);
      }));
    }
  }
  cleanups.push(subscribeOptionalState(ctx, 'characters.favorites', () => { favoriteWrites.clear(); offset = 0; if (view === 'browse') void loadCharacters(); }));
  cleanups.push(subscribeOptionalState(ctx, 'chat.active', () => { void refreshChatHeader(); void refreshConnection(); }), subscribeOptionalState(ctx, 'connections.active', () => { void refreshConnection(); }));
  let lastPath = location.pathname, lastHome = lastPath === '/';
  const routeTimer = setInterval(() => {
    if (location.pathname !== lastPath) { settingsWindow.syncRoute(); if (!location.pathname.startsWith('/chat/')) soundCloud.close(); lastPath = location.pathname; }
    const atHome = location.pathname === '/';
    if (atHome && !lastHome) {
      if (view === 'chats') myChats.activate();
      else { void loadRecent(); void loadCharacters(); }
    } else if (!atHome && lastHome) myChats.deactivate();
    lastHome = atHome;
  }, 500);
  const welcome = createWelcome(ctx, {
    openHome: async () => {
      if (location.pathname !== '/' && !await invoke({ kind: 'route', id: '/' })) return false;
      setView('browse', false); return true;
    },
    openApi,
    openImport,
  });
  cleanups.push(() => welcome.destroy());
  setView('browse', false);
  void refreshChatHeader(); refreshConnection();
  void welcome.maybeOpen();
  return () => {
    disposed = true; request++; recentRequest++; titleRequest++; connectionRequest++; tutorialRequest++; notePreviews.clear(); signatures.clear(); libraryCache = undefined; controller?.abort(); clearTimeout(searchTimer); clearTimeout(libraryRefreshTimer); clearInterval(routeTimer); modal?.dismiss(); tutorialWindow?.destroy(); characterCreate.destroy(); customize.destroy(); soundCloud.destroy(); myChats.destroy(); homeBanner.destroy(); cardImport.destroy(); composer.destroy(); memory.destroy(); apiSettings.destroy(); promptSettings.destroy(); settingsWindow.destroy();
    cleanups.reverse().forEach(cleanup => cleanup()); mounts.forEach(root => root.replaceChildren());
    if (oldView === null) document.documentElement.removeAttribute('data-janitor-bridge-view'); else document.documentElement.setAttribute('data-janitor-bridge-view', oldView);
    chatTools.destroy();
  };
}
