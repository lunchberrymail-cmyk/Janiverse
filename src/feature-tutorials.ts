import type { SpindleFrontendContext, SpindleHostSurfaceRef } from 'lumiverse-spindle-types';
import { screenshotAnnotations, type TutorialCallout } from './tutorial-annotations';

export type TutorialFeature = 'connections' | 'import' | 'history' | 'memory' | 'lorebooks' | 'group' | 'voice' | 'extensions';
export type TutorialHighlight = { x: number; y: number; width: number; height: number };
export type TutorialScreenshot = {
  src: string; alt: string; caption?: string;
  width?: number; height?: number;
  /** Percentages of the screenshot, not its surrounding panel. */
  highlight?: TutorialHighlight;
  callouts?: readonly TutorialCallout[];
  instruction?: string;
  result?: string;
};
export type TutorialScreenshots = Readonly<Record<string, TutorialScreenshot>>;
export type FeatureTutorialOptions = {
  invoke: (ref: SpindleHostSurfaceRef) => Promise<boolean>;
  openImport?: () => void | Promise<void>;
  openHistory?: () => boolean | Promise<boolean>;
  openHistoryTutorial?: () => void;
  screenshots?: TutorialScreenshots;
  onClose?: () => void;
};
type Action = { label: string; destination: SpindleHostSurfaceRef | 'import' | 'history'; fallback: string };
type Scene = { title: string; instruction: string; result: string; screenshot: string; fallbackScreenshot?: string; action?: Action };
type Tutorial = { title: string; intro: string; prerequisites: readonly string[]; scenes: readonly Scene[]; help: readonly string[]; setup?: Action };
const drawer = (id: string): SpindleHostSurfaceRef => ({ kind: 'drawer_tab', id });
const settings = (id: string): SpindleHostSurfaceRef => ({ kind: 'settings_tab', id });
const connections: Action = { label: 'Open Connections', destination: drawer('connections'), fallback: 'Open Connections from Lumiverse’s sidebar.' };
const loom: Action = { label: 'Open preset editor', destination: drawer('loom'), fallback: 'Open Preset from Lumiverse’s sidebar, or use Settings → Manage / import presets.' };

/** Guides show native controls; actions run only through explicitly chosen shortcuts. */
export const featureTutorials: Readonly<Record<TutorialFeature, Tutorial>> = {
  connections: {
    title: 'Add an API connection', intro: 'Connect a model provider in Lumiverse’s native Connections drawer. These steps use OpenRouter.',
    prerequisites: ['An API key from your model provider. Use your own key; the example key stays masked.', 'Use New Connection at the top of the drawer for chat models. Decision, embedding, image and speech connections have separate sections.'],
    scenes: [
      { title: 'Open Connections', instruction: 'On Home, choose 1. Add API connection. At the top of the Connections drawer, choose New Connection.', result: 'A new chat connection form opens.', screenshot: 'api-connection-open', action: connections },
      { title: 'Name it and enter your provider key', instruction: 'Give the connection a name, select OpenRouter under Provider, then paste your own key into API Key. OpenRouter uses its provider URL automatically.', result: 'The key stays masked. Selecting a provider does not save the form.', screenshot: 'api-connection-key' },
      { title: 'Choose a model', instruction: 'Choose Refresh models beside Model. Click the Model field, type to filter the list, and select the model you want.', result: 'The chosen model ID is included with the connection. Refresh uses your current form values before saving.', screenshot: 'api-connection-model' },
      { title: 'Save the connection', instruction: 'Scroll to the bottom of the form and choose Create. Set as default connection is optional.', result: 'The profile is saved in Connections. Saving it does not select it for every chat.', screenshot: 'api-connection-create' },
      { title: 'Select the saved connection', instruction: 'In the saved list, click the connection’s name to make it active.', result: 'Its row has an active check mark. Chats that follow the active connection can now use it.', screenshot: 'api-connection-saved' },
      { title: 'Test the saved key', instruction: 'Open the connection’s More actions (⋮) menu and choose Test connection.', result: 'Connection successful confirms the provider accepted the saved credentials.', screenshot: 'api-connection-menu' },
      { title: 'Check the result', instruction: 'Look for Connection successful below the saved connection’s name. If it fails, use Edit to check the provider and replace an expired or incorrect key.', result: 'The saved credentials were accepted. Model access still depends on the provider and your account.', screenshot: 'api-connection-tested' },
    ],
    help: ['Test connection checks the provider credentials. A successful test does not guarantee that every model or provider route is available to your account.', 'No model list? Check the provider, API key and API URL, then Refresh models again. A supported model ID can also be entered directly.', 'If a key expires or is rejected, Edit the saved connection and replace the key, then save and test again.', 'A chat pinned to a different connection can keep using that profile. Check the chat’s API connection picker if it does not follow your active connection.'],
  },
  group: {
    title: 'Your first group chat', intro: '2 cards · API configured. Follow the controls one screen at a time.',
    prerequisites: ['At least two character cards, including a card with an opening greeting.', 'A saved, working chat API connection. Replies use that model.'], setup: connections,
    scenes: [
      { title: 'Find New Group Chat', instruction: 'Choose Open Character Browser below. In the native browser, click New Group Chat.', result: 'The group creator opens on Select Characters.', screenshot: 'group-start', action: { label: 'Open Character Browser', destination: drawer('characters'), fallback: 'Open Characters from Lumiverse’s sidebar, then choose New Group Chat.' } },
      { title: 'Pick your cast', instruction: 'Select at least two cards on Select Characters, then click Next.', result: 'Choose Opening Greeting appears with greetings from your selected cards.', screenshot: 'group-select' },
      { title: 'Pick the opening', instruction: 'Select one greeting on Choose Opening Greeting, then click Next.', result: 'That character will speak the opening message. Group Settings opens next.', screenshot: 'group-greeting' },
      { title: 'Create the group', instruction: 'Enter a Group Name, keep the starting defaults, and click Create Group Chat.', result: 'Your saved group opens with its selected greeting and member bar.', screenshot: 'group-settings' },
      { title: 'Choose who you play', instruction: 'Open the persona picker below the message box and select your persona.', result: 'Your messages use this persona. The cards in the member bar remain the AI cast.', screenshot: 'group-chat', action: { label: 'Open Personas', destination: drawer('personas'), fallback: 'Open Personas from Lumiverse’s sidebar, then return to your group.' } },
      { title: 'Address a character', instruction: 'Type @ in the message box, select a member, then write and send your message.', result: 'Direct mentions respond first. Sending requests a reply from your configured API.', screenshot: 'group-mention', fallbackScreenshot: 'group-chat' },
      { title: 'Control the next turn', instruction: 'Right-click a member, or long-press on a phone, to find Mute and other member controls.', result: 'Mute skips ordinary automatic targeting. Clicking a member portrait immediately requests a reply.', screenshot: 'group-member-menu', fallbackScreenshot: 'group-chat' },
    ],
    help: ['No greeting? Go Back and choose a card with a First Message. At least one greeting is required.', 'No reply? In Janiverse Settings, select a configuration and Save & Use for This chat. Native Group Settings → Connection Profile can pin another connection; an empty pin follows the active one. Check key, model, provider balance, and Mute.', 'Group Settings → Group Scenario → Custom scenario gives everyone a shared scene. Character Card Macros and Group Lorebooks decide which card and book information enters the prompt. Sequential gives predictable member order; Random changes the starting choice.', 'Type several @ mentions to queue several replies. An explicit mention can address a muted member. Force Generate in the member menu needs that member unmuted.', 'Use + in the member bar to add a character. Remove from Group must leave at least two members. Voice… sets a per-chat voice override. Return to the saved conversation through My Chats.'],
  },
  lorebooks: {
    title: 'Build and activate a Lorebook', intro: 'Add one world detail, give it a keyword, then attach the book to a chat.',
    prerequisites: ['Open the chat that should use the book.', 'Start with one small entry and its default injection settings.'],
    scenes: [
      { title: 'Create a book and entry', instruction: 'Open Lorebook → New Book. Name it, then choose New Entry.', result: 'The entry editor opens. Comment / Label names the entry for you.', screenshot: 'lorebook-entry', action: { label: 'Open Lorebooks', destination: drawer('lorebook'), fallback: 'Open Lorebook from Lumiverse’s sidebar or More → Lorebooks.' } },
      { title: 'Write the trigger and facts', instruction: 'Put Lantern Café in Primary Keys and the café facts in Content. Under Activation, set Activation method to Key match and Status to Enabled.', result: 'The keyword can trigger those facts. Changes save automatically; pause briefly before continuing.', screenshot: 'lorebook-entry' },
      { title: 'Attach it to this chat', instruction: 'Under This Chat Only, choose Add and select your book.', result: 'The book appears in this chat’s attached list. Always Active would apply it globally.', screenshot: 'lorebook-activation' },
      { title: 'Check the prompt', instruction: 'Reveal Lumiverse tools from the chat menu. Type Lantern Café into the draft, then choose Extras (⋯) → Dry Run.', result: 'In Prompt Dry Run, check World Info for activation and Messages or Raw for the café facts. Leave the draft unsent.', screenshot: 'lorebook-verify', fallbackScreenshot: 'lorebook-activation' },
    ],
    help: ['Missing entry? Check the attached book, Enabled, exact Primary Keys, Scan Depth, activation conditions, and token budget.', 'Primary Keys accepts comma-separated alternatives. Content supplies model context; Comment / Label is for organizing.', 'Constant entries do not need a keyword. Disabled entries contribute nothing. Keep advanced recursion and vector activation at their defaults for this first test.', 'Import Book accepts compatible lorebook JSON. Always Active attaches a book globally; character-attached books and Group Lorebooks follow the relevant card/group rules.'],
  },
  memory: {
    title: 'Set up useful chat memory', intro: 'Start with a saved Summary. Embeddings and Cortex are optional next steps.',
    prerequisites: ['Open the conversation you want to improve.', 'Janiverse Chat Memory edits Author’s Note; Summary and recall are separate.'],
    scenes: [
      { title: 'Save a story recap', instruction: 'Open Summary. Write a short recap in Summary Text and choose Save.', result: 'The recap is stored with this chat. Generate can write it for you using your chosen model.', screenshot: 'summary-editor', action: { label: 'Open Summary', destination: drawer('summary'), fallback: 'Open Summary from Lumiverse’s sidebar with your chat selected.' } },
      { title: 'Include it in replies', instruction: 'Open Preset and check for an existing Story Summary block containing {{loomSummary}}. Enable it. If missing, choose Add Prompt → Story Summary.', result: 'Story Summary uses Role: System and Position: Before Chat History. The default preset already includes it; keep one copy. Edits use the block’s Save button.', screenshot: 'summary-preset', action: loom },
      { title: 'Prepare older-message recall', instruction: 'For recall, configure an Embedding Models connection. In Embeddings settings, select it, choose Test Embedding API, and enable Vectorize chat messages (long-term memory).', result: 'An embedding-capable model can prepare chat vectors. Embedding services may charge for usage.', screenshot: 'memory-embeddings', action: { label: 'Open Embeddings settings', destination: settings('embeddings'), fallback: 'Open Lumiverse Settings → Embeddings.' } },
      { title: 'Optionally add Cortex', instruction: 'In Memory Cortex settings, enable Cortex and start with Simple mode.', result: 'Cortex can track entities and relationships. A sidecar LLM is optional and can add model requests.', screenshot: 'memory-cortex', action: { label: 'Open Memory Cortex settings', destination: settings('memoryCortex'), fallback: 'Open Lumiverse Settings → Memory Cortex.' } },
      { title: 'Inspect what gets recalled', instruction: 'Use Recompile Memories in the chat quick menu. Check Memory → Stats and inspect your resolved prompt.', result: 'Stats shows preparation and the per-chat Cortex toggle. {{memories}} inserts eligible recalled context.', screenshot: 'memory-stats', fallbackScreenshot: 'memory-cortex', action: { label: 'Open this chat’s Memory panel', destination: drawer('cortex'), fallback: 'Open Memory from Lumiverse’s sidebar, then select Stats.' } },
    ],
    help: ['For recall: Settings → Advanced → Long-Term Chat Memory → Balanced is a starting mode. With Injection Strategy → Macro only, put {{memories}} in a separate enabled system block before Chat History.', 'Cortex needs its global switch and the per-chat Cortex toggle. Stored entities or chunks are not all inserted into every reply; confirm the resolved prompt.', 'Summary can update manually or automatically. API Source selects Active Connection or Dedicated Connection. Check Interval, Context, and Message Lag before enabling automatic updates. Rebuild from scratch can make several model calls.', 'Empty recap? Select the right chat and save Summary Text. Empty recall? Check embedding credentials/model, vectorization, activation, and exclusion window. Short chats or a cold cache may have no eligible older passages.'],
  },
  voice: {
    title: 'Hear replies and dictate messages', intro: 'Set up playback or dictation. They are separate features.',
    prerequisites: ['For playback, open Connections → Text-to-Speech → New TTS Connection. Enter Name, Provider, credentials, Model and Voice as needed, then choose Create.', 'Speakers or headphones for playback.', 'Microphone permission for dictation. On-device Whistle needs localhost or HTTPS.'], setup: connections,
    scenes: [
      { title: 'Set up spoken replies', instruction: 'Open Settings → Voice. Under Text-to-Speech, choose a Connection and turn on Enable text-to-speech. Leave Auto-play responses off.', result: 'Your saved connection supplies the model and voice. If the list is empty, use Before you start → Open Connections, then return here.', screenshot: 'voice-settings', action: { label: 'Open Voice & Speech', destination: settings('voice'), fallback: 'Open Lumiverse Settings → Voice.' } },
      { title: 'Try playback', instruction: 'On an AI message, choose its native Play button (speaker icon). You can also use Test under Settings → Voice → Text-to-Speech.', result: 'The chosen voice reads the text. Adjust Speed and Volume in Voice settings. Cloud TTS may use a billable provider request.', screenshot: 'voice-playback', fallbackScreenshot: 'voice-settings' },
      { title: 'Choose dictation', instruction: 'In Settings → Voice, scroll to Speech-to-Text. Choose a Provider and turn on Show mic button in input bar.', result: 'Whistle prepares its model on this device. STT Connection needs a saved connection; Web Speech API uses browser speech support.', screenshot: 'voice-dictation', fallbackScreenshot: 'voice-settings' },
      { title: 'Show the microphone', instruction: 'Open the chat menu, then choose Lumiverse tools.', result: 'The native attachments, microphone, and advanced input controls become visible.', screenshot: 'voice-tools' },
      { title: 'Record and review', instruction: 'Use the microphone in the message box. Allow access, record, stop, and review the transcript before sending.', result: 'Your speech becomes a message draft. Sending the draft is a separate choice.', screenshot: 'voice-compose' },
    ],
    help: ['Playback failure? Check the TTS connection, key, model, voice, output volume and browser audio permissions. Create a connection under Connections → Text-to-Speech → New TTS Connection, then choose it in Settings → Voice. Close Settings before working in the Connections drawer.', 'Dictation failure? Check the microphone device/permission and selected STT provider. Whistle’s status offers preparation progress and Try again; an insecure HTTP phone connection may need HTTPS.', 'Whistle uses your device’s processing power and needs no API key. Cloud transcription and Web Speech API follow their provider/browser behavior.', 'Review Auto-submit after silence if you want to control submission. Group member menu → Voice… sets a voice override for that member in the chat.'],
  },
  extensions: {
    title: 'Add and manage extensions', intro: 'Install from the author’s repository, then choose which tools to enable.',
    prerequisites: ['The extension’s actual GitHub repository URL.', 'Installation access for this Lumiverse account, or help from its administrator.'],
    scenes: [
      { title: 'Paste the repository', instruction: 'Open Extensions → Add Extension. Paste the GitHub URL under Install from Source.', result: 'Lumiverse can load that extension’s manifest. Keep the default branch unless its author says otherwise.', screenshot: 'extensions-install', action: { label: 'Open Extensions', destination: drawer('spindle'), fallback: 'Open Extensions from Lumiverse’s sidebar or More → Extensions.' } },
      { title: 'Install and enable', instruction: 'Choose Install from Source. Review its requested permissions, then enable the extension.', result: 'The installed card shows its status. Installation and permissions stay under your control.', screenshot: 'extensions-enabled', fallbackScreenshot: 'extensions-install' },
      { title: 'Find its controls', instruction: 'Follow the extension’s README to its sidebar tab, widget, or Configure control.', result: 'For example, JAR Bridge appears as JAR Import; it still needs the separate JAR app for live links.', screenshot: 'extensions-controls', fallbackScreenshot: 'extensions-enabled' },
      { title: 'Update or switch it off', instruction: 'Use the extension card’s Update control for new versions, or turn its Enable toggle off.', result: 'Disabling removes its active interface. Its own README explains any saved-data behavior.', screenshot: 'extensions-enabled', fallbackScreenshot: 'extensions-install' },
    ],
    help: ['Missing controls? Check Enable, startup errors, required permissions and the extension README. Search All, Active or Inactive to find its card.', 'Admin-only installation requires the server owner. Installing an extension does not automatically install its external application, model or provider.', 'Janiverse and JAR Bridge are separate extensions. You can update or disable either independently.'],
  },
  import: {
    title: 'Import a character card', intro: 'Use the regular card importer. You do not need JAR or JAR Bridge to add a downloaded card.',
    prerequisites: ['A real PNG, JSON or CHARX character card, or a supported public character link.', 'A portrait alone is not a character card. A card does not include your old conversations.'],
    scenes: [
      { title: 'Open the regular card importer', instruction: 'On Home, choose 2. Add a card. File is selected by default.', result: 'The regular Import character window opens, even when JAR Bridge is installed.', screenshot: 'card-import-open', action: { label: 'Open card importer', destination: 'import', fallback: 'Use 2. Add a card on Home, or More → Import characters.' } },
      { title: 'Choose your card', instruction: 'Choose card files and select the PNG, JSON or CHARX you downloaded. For a supported public character link, use the Link tab instead.', result: 'The queue shows your selected file and Ready to import. Selecting it has not saved the character yet.', screenshot: 'card-import-queue' },
      { title: 'Import and open the character', instruction: 'Check the queue, then choose Import. After Imported to your library appears, choose Open character.', result: 'The card is saved in your normal Lumiverse library. Its profile lets you review it and start a new chat.', screenshot: 'card-import-saved' },
    ],
    help: ['If the card fails, download an actual character-card export rather than a portrait or screenshot.', 'A public link can fail when its source is unavailable or requires sign-in. Try a downloaded card file instead.', 'Only bringing a character? You can stop here. Old messages are a separate, optional history import.', 'If you already have the card, use that saved character as the destination for any history import. You do not need another copy.'],
  },
  history: {
    title: 'Bring your old chat history', intro: 'Optional: attach an old conversation to the right saved character. This uses JAR Bridge.',
    prerequisites: ['The matching character is already in your Lumiverse library. Use the regular card importer first if needed.', 'JAR Bridge installed and enabled for history import. A JAR JSON or compatible JSONL history file works without the separate JAR app.', 'Only live JanitorAI links need the JAR app running and signed in on the Lumiverse server computer.'],
    scenes: [
      { title: 'Open history import', instruction: 'Open More → Import old chats (JAR Bridge), then choose Chat history.', result: 'JAR Bridge offers History file for an export, or From JAR for a live conversation link.', screenshot: 'import-history', action: { label: 'Open history importer', destination: 'history', fallback: 'Install and enable JAR Bridge in Extensions, then use More → Import old chats (JAR Bridge). Card-only imports do not need it.' } },
      { title: 'Load the conversation', instruction: 'Choose History file and select your JAR JSON or compatible JSONL export. Use From JAR only when the separate JAR app is running and signed in.', result: 'A preview shows the old messages. Loading the file has not saved another chat yet.', screenshot: 'history-file' },
      { title: 'Choose the saved character', instruction: 'Select the matching character from your Lumiverse library. Review the message count, speakers and text.', result: 'The destination is explicit. An existing character does not need to be imported again.', screenshot: 'import-complete' },
      { title: 'Save and continue', instruction: 'Review the destination and messages, choose Import chat, then Continue chat after it succeeds.', result: 'The imported history becomes a normal saved Lumiverse conversation.', screenshot: 'import-complete', fallbackScreenshot: 'import-history' },
    ],
    help: ['JAR runs on a Windows, macOS or Linux computer with a graphical desktop, on the computer hosting Lumiverse. Extract it fully, start its launcher and leave it running. Open its printed local address, usually http://127.0.0.1:4577.', 'Use log in inside JAR and sign into JanitorAI in the separate browser it opens. Your ordinary browser’s sign-in is a different session. Private conversation links need that JAR session to have access.', 'JAR does not run directly on phones/tablets. A phone can use the bridge when JAR is running on the server computer, or import downloaded files. The assistant’s help includes file-source alternatives.', 'A card does not include old messages. Without JAR Bridge, the normal Janiverse importer handles character files/public links, not conversation history.', 'If a live history link fails but works in JAR, export that conversation from JAR and use History file. Keep your original export. After an interrupted save, check the library or destination character’s chats before retrying to avoid duplicates.'],
  },
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function screenshotSource(value: string): string | undefined {
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value)) return value;
  try {
    const url = new URL(value, document.baseURI), origin = new URL(document.baseURI).origin;
    if (origin !== 'null' && url.origin === origin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  return undefined;
}
function validHighlight(value: TutorialHighlight | undefined): value is TutorialHighlight {
  return !!value && [value.x, value.y, value.width, value.height].every(Number.isFinite) && value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 && value.x + value.width <= 100 && value.y + value.height <= 100;
}

/** Reading these steps never invokes a native action. */
export function openFeatureTutorial(ctx: SpindleFrontendContext, feature: TutorialFeature, options: FeatureTutorialOptions) {
  const tutorial = featureTutorials[feature], previousFocus = document.activeElement as HTMLElement | null;
  const modal = ctx.ui.showModal({ title: tutorial.title, width: 780, maxHeight: 700 });
  const root = modal.root; root.classList.add('jb-feature-tutorial'); root.dataset.feature = feature;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', tutorial.title); root.setAttribute('aria-modal', 'true');
  let disposed = false, opening = false, restoreFocus = true, index = 0, renderedIndex = 0;
  const header = make('header', 'jb-tutorial-header'), title = make('h2', '', tutorial.title);
  const close = make('button', 'jb-tutorial-close', 'Close tutorial'); close.type = 'button'; close.addEventListener('click', () => { if (!disposed) modal.dismiss(); }); header.append(title, close);
  const intro = make('p', 'jb-tutorial-intro', tutorial.intro);
  const historyGuide = feature === 'import' && options.openHistoryTutorial ? make('button', 'jb-tutorial-history-guide', 'Need your old messages too?') : undefined;
  historyGuide?.addEventListener('click', () => { if (!disposed && !opening) options.openHistoryTutorial?.(); });
  const scene = make('section', 'jb-tutorial-scene'); scene.setAttribute('aria-live', 'polite'); scene.setAttribute('aria-atomic', 'true');
  const sceneHeading = make('h3', 'jb-tutorial-scene-title'), instruction = make('p', 'jb-tutorial-instruction'), outcome = make('p', 'jb-tutorial-result');
  const figure = make('figure', 'jb-tutorial-figure'), actions = make('div', 'jb-tutorial-actions');
  const status = make('p', 'jb-tutorial-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const sceneAction = make('button', 'jb-tutorial-action'); sceneAction.type = 'button'; actions.append(sceneAction, status); scene.append(sceneHeading, figure, actions);
  const controls = make('nav', 'jb-tutorial-controls'); controls.setAttribute('aria-label', 'Walkthrough steps');
  const previous = make('button', 'jb-tutorial-previous', 'Back'), next = make('button', 'jb-tutorial-next', 'Next'); previous.type = next.type = 'button';
  const progress = make('span', 'jb-tutorial-progress'); controls.append(previous, progress, next);
  const before = make('details', 'jb-tutorial-before'), checklist = make('ul'); before.append(make('summary', '', 'Before you start')); tutorial.prerequisites.forEach(text => checklist.append(make('li', '', text))); before.append(checklist);
  const setup = tutorial.setup && make('button', 'jb-tutorial-setup', tutorial.setup.label); if (setup) { setup.type = 'button'; before.append(setup); }
  const help = make('details', 'jb-tutorial-help'), tips = make('ul'); help.append(make('summary', '', 'Help & troubleshooting')); tutorial.help.forEach(text => tips.append(make('li', '', text))); help.append(tips);
  const back = make('button', 'jb-tutorial-back', 'Back to banner'); back.hidden = true; back.type = 'button'; back.addEventListener('click', () => { if (!disposed) modal.dismiss(); });
  const reading = make('details', 'jb-tutorial-reading'); reading.append(make('summary', '', 'Instructions & help'), intro, instruction, outcome, before, help);
  const footer = make('footer', 'jb-tutorial-footer'); footer.append(controls, reading);
  root.append(header, scene, footer, back);
  if (historyGuide) { historyGuide.type = 'button'; footer.append(historyGuide); }
  // The host already supplies the window title. Keep one accessible close control.
  title.classList.add('jb-tutorial-sr-only');

  function render() {
    const changed = renderedIndex !== index;
    renderScene(); renderedIndex = index;
    if (changed) {
      try { scene.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'instant' }); }
      catch { try { scene.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'auto' }); } catch {} }
    }
  }
  function renderScene() {
    const current = tutorial.scenes[index]; root.dataset.scene = String(index + 1); root.dataset.screenshot = current.screenshot;
    sceneHeading.textContent = `Step ${index + 1}. ${current.title}`; instruction.textContent = current.instruction; outcome.textContent = `Then: ${current.result}`;
    progress.textContent = `${index + 1} / ${tutorial.scenes.length}`; progress.setAttribute('aria-label', `Scene ${index + 1} of ${tutorial.scenes.length}`);
    previous.disabled = index === 0 || opening; next.disabled = index === tutorial.scenes.length - 1 || opening;
    sceneAction.hidden = !current.action; sceneAction.textContent = current.action?.label ?? ''; sceneAction.disabled = opening; if (setup) setup.disabled = opening;
    status.textContent = ''; figure.replaceChildren(); reading.querySelector('.jb-tutorial-callouts')?.remove();
    const exact = options.screenshots?.[current.screenshot], fallback = current.fallbackScreenshot && options.screenshots?.[current.fallbackScreenshot];
    const screenshot = exact ?? fallback, source = screenshot && screenshotSource(screenshot.src);
    if (!screenshot || !source) { figure.append(make('p', 'jb-tutorial-image-error', current.instruction)); return; }
    if (exact?.instruction) instruction.textContent = exact.instruction; if (exact?.result) outcome.textContent = `Then: ${exact.result}`;
    const viewport = make('div', 'jb-tutorial-image-box'); viewport.tabIndex = 0; viewport.setAttribute('aria-label', 'Screenshot; enlarge to read small controls');
    const shot = make('div', 'jb-tutorial-shot'), image = make('img'); image.src = source; image.alt = screenshot.alt; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; shot.append(image);
    if (Number.isFinite(screenshot.width) && Number.isFinite(screenshot.height) && screenshot.width! > 0 && screenshot.height! > 0) {
      image.width = screenshot.width!; image.height = screenshot.height!;
    }
    let callouts = exact?.callouts;
    if (exact && validHighlight(exact.highlight)) {
      const region = exact.highlight, highlight = make('span', 'jb-tutorial-highlight'); highlight.setAttribute('aria-hidden', 'true');
      Object.assign(highlight.style, { left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` }); shot.append(highlight);
      callouts ??= [{ label: screenshot.caption ?? current.instruction, x: region.x > 50 ? Math.min(94, region.x + region.width + 8) : Math.max(6, region.x - 8), y: Math.max(8, Math.min(92, region.y - 8)), targetX: region.x + region.width / 2, targetY: region.y + region.height / 2 }];
    }
    const legend = callouts && screenshotAnnotations(shot, callouts);
    viewport.append(shot); const caption = make('figcaption', '', screenshot.caption ?? screenshot.alt);
    const enlarge = make('button', 'jb-tutorial-image-toggle', 'Enlarge screenshot'); enlarge.type = 'button'; enlarge.setAttribute('aria-pressed', 'false');
    enlarge.addEventListener('click', () => { if (disposed) return; const expanded = viewport.classList.toggle('jb-tutorial-image-expanded'); enlarge.textContent = expanded ? 'Fit screenshot' : 'Enlarge screenshot'; enlarge.setAttribute('aria-pressed', String(expanded)); });
    const failed = make('p', 'jb-tutorial-image-error', 'This screenshot could not load. Follow the instruction above in Lumiverse.'); failed.hidden = true;
    image.addEventListener('error', () => { if (!disposed && figure.contains(image)) { viewport.hidden = true; enlarge.hidden = true; if (legend) legend.hidden = true; failed.hidden = false; reading.open = true; } });
    if (legend) reading.insertBefore(legend, outcome);
    caption.classList.add('jb-tutorial-sr-only');
    figure.append(viewport, caption, enlarge, failed);
  }
  function chooseScene(target: number) { if (disposed || opening) return; index = Math.max(0, Math.min(tutorial.scenes.length - 1, target)); render(); }
  previous.addEventListener('click', () => chooseScene(index - 1)); next.addEventListener('click', () => chooseScene(index + 1));
  function openAction(action: Action | undefined) {
    if (!action || disposed || opening) return; opening = true; render();
    void Promise.resolve().then(async () => { if (disposed) return false; return action.destination === 'import' ? options.openImport ? (await options.openImport(), true) : false : action.destination === 'history' ? options.openHistory ? await options.openHistory() : false : options.invoke(action.destination); }).then(ok => {
      if (disposed) return; if (ok) { restoreFocus = false; modal.dismiss(); } else status.textContent = `This shortcut is unavailable. ${action.fallback}`;
    }).catch(() => { if (!disposed) status.textContent = `Could not open that tool. ${action.fallback}`; }).finally(() => {
      opening = false; if (!disposed) { previous.disabled = index === 0; next.disabled = index === tutorial.scenes.length - 1; sceneAction.disabled = false; if (setup) setup.disabled = false; }
    });
  }
  sceneAction.addEventListener('click', () => openAction(tutorial.scenes[index].action)); setup?.addEventListener('click', () => openAction(tutorial.setup));
  const keydown = (event: KeyboardEvent) => {
    if (disposed) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); modal.dismiss(); return; } if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll<HTMLElement>('*')].filter(node => {
      if (!node.matches('button:not(:disabled),a[href],summary,[tabindex="0"]') || node.hidden || node.closest('[hidden]')) return false;
      for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(node)) return false;
      }
      return true;
    });
    const first = focusable[0], last = focusable.at(-1); if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', keydown);
  modal.onDismiss(() => { if (disposed) return; disposed = true; root.removeEventListener('keydown', keydown); if (restoreFocus && previousFocus?.isConnected) previousFocus.focus(); options.onClose?.(); });
  render(); close.focus();
  return { root, destroy() { if (!disposed) modal.dismiss(); } };
}
