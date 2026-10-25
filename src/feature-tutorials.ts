import type { SpindleFrontendContext, SpindleHostSurfaceRef } from 'lumiverse-spindle-types';

export type TutorialFeature = 'import' | 'memory' | 'lorebooks' | 'group' | 'voice' | 'extensions';
export type TutorialScreenshot = { src: string; alt: string; caption?: string };
export type TutorialScreenshots = Readonly<Record<string, TutorialScreenshot>>;
export type FeatureTutorialOptions = {
  invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean>;
  openImport?: () => void | Promise<void>;
  screenshots?: TutorialScreenshots;
  onClose?: () => void;
};
type Action = { label: string; destination: SpindleHostSurfaceRef | 'import'; fallback: string };
type Step = { title: string; text: readonly string[]; bullets?: readonly string[]; example?: string; screenshot?: string; action?: Action };
type Tutorial = { title: string; intro: string; before: string; steps: readonly Step[] };
const drawer = (id: string): SpindleHostSurfaceRef => ({ kind: 'drawer_tab', id });
const settings = (id: string): SpindleHostSurfaceRef => ({ kind: 'settings_tab', id });
const connections: Action = { label: 'Open Connections', destination: drawer('connections'), fallback: 'Open Connections from Lumiverse’s sidebar.' };
const loom: Action = { label: 'Open preset editor', destination: drawer('loom'), fallback: 'Open Loom from Lumiverse’s sidebar, or use Settings → Manage / import presets.' };

/** Labels and workflows checked against the native Lumiverse controls. */
export const featureTutorials: Readonly<Record<TutorialFeature, Tutorial>> = {
  group: {
    title: 'Your first group chat',
    intro: 'Put several character cards in one conversation, choose your own persona, and decide who replies. This guide follows the three-screen group creator and the controls inside the finished chat.',
    before: 'You need at least two character cards in your library, at least one opening greeting among them, and a working chat API connection. Creating the group saves a new conversation; requesting replies uses your chosen model.',
    steps: [
      { title: 'Prepare your chat API', text: ['A group uses a normal chat connection. In Connections, create or select an LLM connection with the correct provider, model, API URL and key, then save it. OpenRouter, NanoGPT and other compatible endpoints use their normal Lumiverse provider/base-URL options.', 'After creating the group, Janiverse’s chat menu → Settings lets you choose the configuration and Save & Use it for This chat. In native Group Settings, Connection Profile pins a saved connection to the group; an empty pin follows the active connection.'], screenshot: 'group-api', action: connections },
      { title: 'Open the creator and select the cast', text: ['Open Character Browser, then choose New Group Chat. On Select Characters, click at least two cards. Selected cards also appear as removable name chips above the search box.', 'Use Search characters… or the page controls to find more cards. Choose Next when your cast is selected.'], screenshot: 'group-select', action: { label: 'Open Character Browser', destination: drawer('characters'), fallback: 'Open Characters from Lumiverse’s sidebar, then choose New Group Chat.' } },
      { title: 'Choose the opening greeting', text: ['On Choose Opening Greeting, select one of the greetings supplied by your selected cards. This chooses the opening message and its speaker for the new group.', 'Choose Next. If this screen has no greetings, go Back and choose a card with a greeting, or edit a card’s First Message before trying again.'], screenshot: 'group-greeting' },
      { title: 'Set the shared scene and create the group', text: ['On Group Settings, give the conversation a Group Name. For a first try, keep the default card/lorebook modes and Talkativeness per Character values. Choose Sequential for a predictable member order.', 'Use Group Scenario → Custom scenario if all characters should start in one shared situation. Write a short setting that names the cast and what is happening, then choose Create Group Chat. You arrive in the new conversation.'], bullets: ['Character Card Macros: Swap cards on each turn uses the current speaker’s card. Merge all unmuted member cards or Merge all member cards includes more of the cast in card macros and can use more context.', 'Group Lorebooks controls which members’ attached books participate: follow card mode, active speaker, all unmuted members, or all members.', 'Group Response Order can be Sequential or Random. You can return to Group Settings from the native input quick menu later.'], example: 'The group has taken shelter in a closed roadside café during a storm. Everyone has a reason to stay until morning.', screenshot: 'group-settings' },
      { title: 'Choose who you play', text: ['In the chat composer, open the persona picker and select your persona. That is your identity when sending user messages; the character cards remain the AI cast.', 'If you need a new persona, open Personas, create or edit it, save, then return and select it. Check the displayed persona before sending your first message.'], screenshot: 'group-chat', action: { label: 'Open Personas', destination: drawer('personas'), fallback: 'Open Personas from Lumiverse’s sidebar, then return to this chat.' } },
      { title: 'Send a message and control the next replies', text: ['Write your message and send. A normal send starts with an unmuted member according to the group’s response order.', 'To address a particular member, type @ in the native composer and choose the member from the suggestions. Direct mentions respond first; several mentions can queue several replies, including a directly mentioned muted member.', 'Clicking a member’s portrait/name in the member bar immediately requests a reply from that member. It is a generation control and uses the active API. Wait for a reply to finish, or use Stop to interrupt it.'], screenshot: 'group-chat' },
      { title: 'Mute, add, or remove members', text: ['Right-click a member on desktop, or long-press on a touch screen, to open the member menu. Mute leaves the member in the group while excluding them from ordinary automatic targeting. Unmute brings them back.', 'Use the + button in the member bar to add a member. Remove from Group removes a member from this conversation; the group must keep at least two members. Voice… sets a voice override for that member in this chat.', 'Force Generate in the member menu requests an immediate reply and is unavailable while that member is muted. Unmute first, or address them through an explicit @ mention.'] },
      { title: 'Check the result and continue later', text: ['Confirm that the expected persona name, speaker name and model appear in your conversation. If a reply fails, check the active/pinned connection, key, model and provider balance in Settings or Connections.', 'If the wrong cast information appears, revisit Group Settings → Character Card Macros, Group Lorebooks and Group Scenario. If a member stays silent, check Mute and use an explicit mention.', 'The group is a normal saved Lumiverse chat. Return through My Chats or Character Browser’s Group Chats view; your individual character cards remain available for other conversations.'] },
    ],
  },
  lorebooks: {
    title: 'Build and activate a Lorebook',
    intro: 'A Lorebook stores reusable world details. A trigger entry contributes its content when a matching keyword appears in the scanned chat context.',
    before: 'Start with one small entry and an open chat. A book must be attached or active, and its entry must be enabled, before it can contribute context.',
    steps: [
      { title: 'Create or import a book', text: ['Open Lorebook from the sidebar or More → Lorebooks. Choose New Book, then edit its Name and optional Description under Book Details.', 'If you already have a compatible lorebook JSON, choose Import Book instead. Select the imported book in the book selector.'], action: { label: 'Open Lorebooks', destination: drawer('lorebook'), fallback: 'Open Lorebook from Lumiverse’s sidebar or More → Lorebooks.' } },
      { title: 'Add a focused entry', text: ['Choose New Entry and open its editor. Under Identity & Content, give Comment / Label a useful name and write the facts under Content. The label is for organizing; Content is the text supplied to the model.', 'For a keyword-triggered entry, set Primary Keys (comma-separated), leave it enabled, and keep Constant off. Start with the default injection settings.'], example: 'Comment / Label: The Lantern Café\nPrimary Keys: Lantern Café, lantern cafe\nContent: The Lantern Café closes at midnight. Its owner, Ada, keeps a spare key under the blue flowerpot.', screenshot: 'lorebook-entry' },
      { title: 'Wait for the edit to save', text: ['Entry changes save automatically after a short pause. Check the editor’s Saved indicator or any save/conflict notice before leaving.', 'Keep one topic per entry. Use Constant only for details that should be included regardless of keywords; Disabled prevents an entry from contributing. Vector activation is a separate, optional setup.'] },
      { title: 'Activate it in the right place', text: ['With your conversation open, find This Chat Only and choose Add to attach the book to that chat. This is a useful first test without applying the book everywhere.', 'Always Active → Add applies a book globally. Character-attached books follow that card; in groups, Group Lorebooks also controls which members’ books are considered.'], screenshot: 'lorebook-activation' },
      { title: 'Verify a matching entry reaches the prompt', text: ['Write a message that mentions one of your Primary Keys. Use the native prompt breakdown / Dry Run to inspect which world-info entries are included before relying on them.', 'If the entry is absent, check that the correct book is attached, the entry is enabled, its keyword occurs within Scan Depth, and activation conditions and token budget allow it. Avoid changing advanced recursion or vector settings until the basic keyword entry works.'] },
    ],
  },
  memory: {
    title: 'Set up useful chat memory',
    intro: 'Summary keeps a saved story overview. Chat Memory retrieves older passages. Memory Cortex adds entities and relationships to recall. Set up one route at a time and inspect what the model actually receives.',
    before: 'Open the conversation you want to improve. Janiverse’s Chat Memory editor writes the native Author’s Note; that note is separate from the Summary and recall systems below.',
    steps: [
      { title: 'Start with an editable Summary', text: ['Open Summary with the chat selected. Under Summarization Mode choose Manual to update on demand. Under API Source choose Active Connection or a Dedicated Connection for summary requests.', 'Set Manual Context to the number of recent messages to include. In Summary Text, you can write your own overview and Save without an AI request, or click Generate to update it using the existing summary and selected messages. Generation uses the chosen LLM connection; review the result and Save any manual corrections.'], screenshot: 'summary-editor', action: { label: 'Open Summary', destination: drawer('summary'), fallback: 'Open Summary from Lumiverse’s sidebar with your chat selected.' } },
      { title: 'Put the saved Summary in your preset', text: ['In your active Loom preset, add an enabled system block before Chat History containing the example below. Save the preset and use the resolved prompt / Dry Run to confirm the story overview is present.', 'The {{loomSummary}} macro reads saved text; it does not generate a summary. Without that macro, saving an overview alone does not place it in the prompt.'], example: 'Story so far:\n{{loomSummary}}', screenshot: 'summary-preset', action: loom },
      { title: 'Choose how updates should happen', text: ['When the manual route works, Automatic mode can update after the chosen Interval. Context controls how many messages a pass considers; Message Lag leaves the newest messages out so recent swipes or edits can settle.', 'A normal update uses recent messages plus the saved overview. Rebuild from scratch rereads history in batches and may make several model requests. Review its confirmation before choosing it.'] },
      { title: 'For older-passage recall, configure embeddings', text: ['Create an embedding connection in Connections → Embedding Models. In Settings → Embeddings, enable embeddings, select that connection/model, run Test API and enable Vectorise chat messages.', 'In Settings → Advanced → Long-Term Chat Memory, choose a starting Memory Mode such as Balanced. Leave Injection Strategy at Macro only and put {{memories}} in a separate enabled system block before Chat History. Embedding services may have their own usage charges.'], example: '{{memories}}', screenshot: 'memory-embeddings', action: { label: 'Open Embeddings settings', destination: settings('embeddings'), fallback: 'Open Lumiverse Settings → Embeddings.' } },
      { title: 'Add Memory Cortex if you want entity tracking', text: ['In Settings → Memory Cortex, turn on Enable Memory Cortex and choose Simple for the basic heuristic setup. Standard adds more relationship/arc features; Advanced exposes detailed controls.', 'A sidecar LLM is optional for heuristic analysis. Choosing a sidecar can enable extra AI analysis/summaries and model requests; check Connection, Model and AI summaries before enabling that route.'], screenshot: 'memory-cortex', action: { label: 'Open Memory Cortex settings', destination: settings('memoryCortex'), fallback: 'Open Lumiverse Settings → Memory Cortex.' } },
      { title: 'Prepare the chat and inspect its records', text: ['Open the chat input’s quick menu and choose Recompile Memories to prepare existing history. In Memory → Stats, check chunk/vector counts and the per-chat Cortex toggle. Cortex needs both its global switch and this chat’s switch enabled.', 'Open Entities and the other Memory tabs to inspect and correct records. A short chat or a cold cache may have no eligible recalled passages yet. Wait for processing, then inspect the resolved prompt.'], screenshot: 'memory-stats', action: { label: 'Open this chat’s Memory panel', destination: drawer('cortex'), fallback: 'Open Memory from Lumiverse’s sidebar, then select Stats.' } },
      { title: 'Confirm what the model can see', text: ['Check {{loomSummary}} for your saved overview and {{memories}} for recalled context in the prompt breakdown. Seeing stored entities or chunks in Memory does not mean all of them are included in every reply.', 'If Summary is empty, select the correct chat and refresh/save its text. If recall is empty, check the embedding connection, vectorization, activation and exclusion window. Correct misleading facts and keep your own copy of story details you want to preserve.'] },
    ],
  },
  voice: {
    title: 'Hear replies and dictate messages',
    intro: 'Text-to-Speech speaks text. Speech-to-Text turns your voice into a draft. They use different provider settings and can be used independently.',
    before: 'Have speakers or headphones available. Dictation needs microphone permission in a supported browser. Localhost or HTTPS is required for on-device Whistle.',
    steps: [
      { title: 'Choose a speech connection', text: ['Open Voice & Speech settings. Under Text-to-Speech, use Manage TTS connections to open Connections, add a supported TTS provider, then configure its model, voice and any required URL/key.', 'Return to Voice & Speech, turn on Enable text-to-speech, and select that connection/voice. Keep Auto-play responses off while setting up if you want to choose when playback starts.'], screenshot: 'voice-settings', action: { label: 'Open Voice & Speech', destination: settings('voice'), fallback: 'Open Lumiverse Settings → Voice & Speech.' } },
      { title: 'Test spoken output deliberately', text: ['Use the native speech test or a message’s playback control when ready. Adjust Volume and Speed, and stop playback if needed. Cloud TTS can make a billable provider request.', 'Separate narrator voice and speech-detection controls are optional. In a group chat, right-click/long-press a member and choose Voice… for a per-chat voice override.'] },
      { title: 'Select your dictation route', text: ['Under Speech-to-Text, choose Provider. Whistle (on this device) prepares and caches its model locally, needs no API key, and uses your device’s processing power.', 'Alternatively select a configured STT connection, or Web Speech API if supported. Choose Language and enable Show mic button in input bar. Cloud transcription and browser speech services follow their own provider behavior.'] },
      { title: 'Record, stop and review the draft', text: ['Return to the conversation and use the microphone control in the input bar. Allow microphone access when your browser asks. Finish recording and wait for the transcript; Whistle returns a completed transcript after recording stops.', 'Review names and punctuation before sending. Check Auto-submit after silence and related options if you want to control when recording stops or text is submitted.'] },
      { title: 'If audio or dictation fails', text: ['For playback, confirm the TTS connection, credentials/model/voice, output volume and browser audio permissions. For dictation, check microphone permissions and the selected input device.', 'Whistle’s setup status shows preparation progress and Try again on failure. A phone accessing an insecure HTTP server may need HTTPS for microphone access. Choose another available route if the device/browser does not support the selected engine.'] },
    ],
  },
  extensions: {
    title: 'Add and manage extensions',
    intro: 'Install a tool from its repository, enable it, and use its own controls. Janiverse and JAR Bridge are separate extensions, so either can be managed independently.',
    before: 'Choose the extension’s actual GitHub repository and read its setup requirements. You decide which extension to install and which requested permissions to grant.',
    steps: [
      { title: 'Open Extensions and add the repository', text: ['Open Extensions, then choose Add Extension in the header. Under Install from Source paste the GitHub repository URL.', 'If a Branch selector appears, keep the default release branch unless the author specifically asks you to use another branch.'], screenshot: 'extensions-install', action: { label: 'Open Extensions', destination: drawer('spindle'), fallback: 'Open Extensions from Lumiverse’s sidebar or More → Extensions.' } },
      { title: 'Install, review access and enable', text: ['Review the listed permissions, then choose Install. After it finishes, use the installed extension’s Enable toggle and grant the access needed for the features you choose to use.', 'A request for admin-only access may need the server owner. Follow the extension’s own instructions if it requires an external application, model or provider connection.'] },
      { title: 'Find its controls', text: ['Look for the extension’s named sidebar tab, widget or Configure control, as described in its README. JAR Bridge appears as JAR Import; installing it does not install or start JAR itself.', 'If a tab is missing, check that the extension is enabled and that its card reports no startup error. Use All, Active or Inactive and search to locate it.'] },
      { title: 'Update or turn it off', text: ['Use an extension card’s Update control to fetch and rebuild from its source. Read its release/setup notes if the update changes requirements.', 'Disable stops using the extension without uninstalling it. Use its own backup/export instructions before Uninstall if it stores data you want to keep.'] },
    ],
  },
  import: {
    title: 'Bring your old card and conversation',
    intro: 'A character card supplies the character; a history file or conversation link supplies old messages. Bring both to resume a story, or choose a character already in your library for a history-only import.',
    before: 'Use JAR Bridge for the guided JanitorAI transfer. A plain portrait or screenshot is not a character card, and a card file normally does not contain your chat history.',
    steps: [
      { title: 'Choose link or file import', text: ['Open the import assistant. If JAR Bridge is installed, it offers JanitorAI link, Import card file and Chat history routes. Without it, Janiverse’s normal card-file/link importer cannot import old conversation messages.', 'For files, use a real PNG, JSON or CHARX character card. History accepts JAR JSON or compatible SillyTavern JSONL; keep the original export as a backup.'], action: { label: 'Open import assistant', destination: 'import', fallback: 'Use Janiverse’s Start guided import button, or open JAR Import from the sidebar.' } },
      { title: 'For live links, start and sign into JAR once', text: ['JAR runs on a Windows, macOS or Linux computer with a graphical desktop, on the computer hosting Lumiverse. Extract its download fully, start its launcher and keep it running. Open the local address printed by JAR, usually http://127.0.0.1:4577.', 'Use log in in JAR and sign into JanitorAI in the separate browser it opens. Return to Lumiverse to paste links; your normal browser’s JanitorAI sign-in is a separate session.', 'JAR does not run directly on phones/tablets. A phone can use this importer when JAR is running on the server computer, or import downloaded files. Help and import guide includes the official setup and phone/card-file alternatives.'] },
      { title: 'Preview the card or conversation link', text: ['Paste a JanitorAI /characters/… or /chats/… URL into JanitorAI link, then choose Preview link. Review the character fields and portrait before choosing Import to Lumiverse.', 'If the character is already in your library, choose Use an existing character for this chat instead of importing another copy. A private conversation link needs the signed-in JAR session to have access.'], screenshot: 'import-link' },
      { title: 'Load history and choose its destination', text: ['Choose Next: import chat history. A conversation link’s loaded messages follow into this step. For a separate history export, choose Chat history → History file and select the JAR JSON or SillyTavern JSONL.', 'For a live history link, choose Chat history → From JAR, paste the JanitorAI conversation link and choose Load chat. Select the destination Lumiverse character and review message count, names and text.'], screenshot: 'import-history' },
      { title: 'Import, then continue the saved conversation', text: ['Choose Import chat, then Continue chat when the save succeeds. The result is a normal Lumiverse conversation attached to the destination character.', 'If a live link fails but JAR can load it, export that conversation from JAR and use History file. If a save response is interrupted, check the library or destination character’s chats before retrying to avoid duplicates.'] },
    ],
  },
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

function screenshotSource(value: string): string | undefined {
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value)) return value;
  try {
    const url = new URL(value, document.baseURI), origin = new URL(document.baseURI).origin;
    if (origin !== 'null' && url.origin === origin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  return undefined;
}

/** Host-owned modal; opening/reading it never invokes a native action or starts generation. */
export function openFeatureTutorial(ctx: SpindleFrontendContext, feature: TutorialFeature, options: FeatureTutorialOptions) {
  const tutorial = featureTutorials[feature];
  const previousFocus = document.activeElement as HTMLElement | null;
  const modal = ctx.ui.showModal({ title: tutorial.title, width: 1000, maxHeight: 960 });
  const root = modal.root; root.classList.add('jb-feature-tutorial'); root.dataset.feature = feature;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', tutorial.title); root.setAttribute('aria-modal', 'true');
  let disposed = false, opening = false, restoreFocus = true;
  const actionButtons: HTMLButtonElement[] = [];
  const header = make('header', 'jb-tutorial-header');
  const title = make('h2', '', tutorial.title);
  const close = make('button', 'jb-tutorial-close', 'Close tutorial'); close.type = 'button'; close.addEventListener('click', () => modal.dismiss());
  header.append(title, close);
  const intro = make('p', 'jb-tutorial-intro', tutorial.intro);
  const before = make('section', 'jb-tutorial-before'); before.append(make('h3', '', 'Before you start'), make('p', '', tutorial.before));
  const steps = make('ol', 'jb-tutorial-steps');
  for (const [index, step] of tutorial.steps.entries()) {
    const item = make('li', 'jb-tutorial-step'); item.append(make('h3', '', `${index + 1}. ${step.title}`));
    for (const text of step.text) item.append(make('p', '', text));
    if (step.bullets) { const list = make('ul'); for (const text of step.bullets) list.append(make('li', '', text)); item.append(list); }
    if (step.example) item.append(make('pre', 'jb-tutorial-example', step.example));
    const screenshot = step.screenshot && options.screenshots?.[step.screenshot];
    const source = screenshot && screenshotSource(screenshot.src);
    if (screenshot && source) {
      const figure = make('figure', 'jb-tutorial-figure');
      const imageBox = make('div', 'jb-tutorial-image-box'); imageBox.tabIndex = 0; imageBox.setAttribute('aria-label', 'Screenshot; scroll to pan when enlarged');
      const image = make('img'); image.src = source; image.alt = screenshot.alt; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      const caption = make('figcaption', '', screenshot.caption ?? screenshot.alt);
      const enlarge = make('button', 'jb-tutorial-image-toggle', 'Enlarge screenshot'); enlarge.type = 'button'; enlarge.setAttribute('aria-pressed', 'false');
      enlarge.addEventListener('click', () => {
        const expanded = imageBox.classList.toggle('jb-tutorial-image-expanded');
        enlarge.textContent = expanded ? 'Fit screenshot' : 'Enlarge screenshot'; enlarge.setAttribute('aria-pressed', String(expanded));
      });
      const failed = make('p', 'jb-tutorial-image-error', 'This screenshot could not load. The written steps still apply.'); failed.hidden = true;
      image.addEventListener('error', () => { if (!disposed) { imageBox.hidden = true; enlarge.hidden = true; failed.hidden = false; } });
      imageBox.append(image); figure.append(imageBox, caption, enlarge, failed); item.append(figure);
    }
    if (step.action) {
      const action = step.action;
      const button = make('button', 'jb-tutorial-action', action.label); button.type = 'button'; actionButtons.push(button);
      const status = make('p', 'jb-tutorial-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      button.addEventListener('click', () => {
        if (disposed || opening) return;
        opening = true; actionButtons.forEach(node => { node.disabled = true; }); status.textContent = '';
        void Promise.resolve().then(async () => {
          if (disposed) return false;
          return action.destination === 'import'
            ? options.openImport ? (await options.openImport(), true) : false
            : options.invoke(action.destination);
        }).then(ok => {
          if (disposed) return;
          if (ok) { restoreFocus = false; modal.dismiss(); }
          else status.textContent = `This shortcut is unavailable. ${action.fallback}`;
        }).catch(() => { if (!disposed) status.textContent = `Could not open that tool. ${action.fallback}`; }).finally(() => {
          opening = false; if (!disposed) actionButtons.forEach(node => { node.disabled = false; });
        });
      });
      item.append(button, status);
    }
    steps.append(item);
  }
  const back = make('button', 'jb-tutorial-back', 'Back to banner'); back.type = 'button'; back.addEventListener('click', () => modal.dismiss());
  root.append(header, intro, before, steps, back);
  const keydown = (event: KeyboardEvent) => {
    if (disposed) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); modal.dismiss(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href], [tabindex="0"]')].filter(node => !node.hidden && !node.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', keydown);
  modal.onDismiss(() => {
    if (disposed) return; disposed = true; root.removeEventListener('keydown', keydown);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    options.onClose?.();
  });
  close.focus();
  return { root, destroy() { if (!disposed) modal.dismiss(); } };
}
