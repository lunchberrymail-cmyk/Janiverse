import groupSelect from '../assets/tutorials/group-select.png';
import groupGreeting from '../assets/tutorials/group-greeting.png';
import groupSettings from '../assets/tutorials/group-settings.png';
import groupChat from '../assets/tutorials/group-chat.png';
import groupStart from '../assets/tutorials/group-start.png';
import groupMention from '../assets/tutorials/group-mention.png';
import groupMemberMenu from '../assets/tutorials/group-member-menu.png';
import summaryEditor from '../assets/tutorials/summary-editor.png';
import summaryPreset from '../assets/tutorials/summary-preset.png';
import memoryStats from '../assets/tutorials/memory-stats.png';
import memoryCortex from '../assets/tutorials/memory-cortex.png';
import memoryEmbeddings from '../assets/tutorials/memory-embeddings.png';
import voiceSettings from '../assets/tutorials/voice-settings.png';
import voicePlayback from '../assets/tutorials/voice-playback.png';
import voiceDictation from '../assets/tutorials/voice-dictation.png';
import voiceCompose from '../assets/tutorials/voice-compose.png';
import voiceTools from '../assets/tutorials/voice-tools.png';
import lorebookEntry from '../assets/tutorials/lorebook-entry.png';
import lorebookActivation from '../assets/tutorials/lorebook-activation.png';
import lorebookVerify from '../assets/tutorials/lorebook-verify.png';
import extensionsInstall from '../assets/tutorials/extensions-install.png';
import extensionsEnabled from '../assets/tutorials/extensions-enabled.png';
import extensionsControls from '../assets/tutorials/extensions-controls.png';
import importLink from '../assets/tutorials/import-link.png';
import importHistory from '../assets/tutorials/import-history.png';
import importPreview from '../assets/tutorials/import-preview.png';
import importComplete from '../assets/tutorials/import-complete.png';
import cardImportOpen from '../assets/tutorials/card-import-open.png';
import cardImportQueue from '../assets/tutorials/card-import-queue.png';
import cardImportSaved from '../assets/tutorials/card-import-saved.png';
import apiOpen from '../assets/tutorials/api-connection-open.png';
import apiKey from '../assets/tutorials/api-connection-key.png';
import apiModel from '../assets/tutorials/api-connection-model.png';
import apiSaved from '../assets/tutorials/api-connection-saved.png';
import apiTested from '../assets/tutorials/api-connection-tested.png';
import type { TutorialScreenshots } from './feature-tutorials';

/** Real native controls; credentials and unrelated content stay masked. Bundled without remote requests. */
export const tutorialScreenshots: TutorialScreenshots = {
  'api-connection-open': { src: apiOpen, alt: 'Lumiverse’s native Connections drawer with a new chat connection form open.', caption: 'Home → 1. Add API connection → New Connection. Use the top section for chat models.' },
  'api-connection-key': { src: apiKey, alt: 'OpenRouter selected as provider with the example API key masked.', caption: 'Use your own provider key. OpenRouter supplies its URL automatically.' },
  'api-connection-model': { src: apiModel, alt: 'The native connection form with openrouter/free selected in Model.', caption: 'Refresh models uses the current form values. Type to filter, then select a model.' },
  'api-connection-saved': { src: apiSaved, alt: 'The saved OpenRouter tutorial connection with its active check mark. Usage details are hidden.', caption: 'Create saves the profile. Clicking its name selects it as the active connection.' },
  'api-connection-tested': { src: apiTested, alt: 'The saved OpenRouter connection shows Connection successful. Usage details are hidden.', caption: 'More actions (⋮) → Test connection checks the saved credentials.' },
  'card-import-open': { src: cardImportOpen, alt: 'The regular Import character window on the File tab with Choose card files.', caption: 'Home → 2. Add a card opens this importer. JAR and JAR Bridge are not needed.' },
  'card-import-queue': { src: cardImportQueue, alt: 'Mira’s fictional JSON card in the regular import queue, Ready to import.', caption: 'Check the queued file, then choose Import. A selected file has not been saved yet.' },
  'card-import-saved': { src: cardImportSaved, alt: 'Mira’s imported card with Imported to your library and Open character.', caption: 'The success message confirms the save. Open character takes you to its profile.' },
  'group-start': { src: groupStart, alt: 'Character Browser toolbar with the New Group Chat button highlighted.', highlight: { x: 76, y: 54, width: 11, height: 15 }, caption: 'The two-person icon is New Group Chat.' },
  'group-select': { src: groupSelect, alt: 'Select Characters: Mira and Rowan selected, search filtered to Tutorial, and Next available.', highlight: { x: 20, y: 46, width: 31, height: 29 }, caption: 'Click two cards so both are selected, then Next at the bottom right.' },
  'group-greeting': { src: groupGreeting, alt: 'Choose Opening Greeting: the two demo cards offer greetings, with Mira’s greeting selected.', highlight: { x: 3, y: 25, width: 94, height: 23 }, caption: 'This selected greeting will open the new conversation.' },
  'group-settings': { src: groupSettings, alt: 'Group Settings showing the group name, default card and lorebook modes, Sequential response order, and Create Group Chat.', highlight: { x: 78, y: 90, width: 19, height: 7 }, caption: 'Name the group above, keep the starting defaults, then create it.' },
  'group-chat': { src: groupChat, alt: 'A fictional group conversation with a persona picker below the message box.', highlight: { x: 8, y: 91, width: 17, height: 8 }, caption: 'This picker is your role, separate from the AI cast above.' },
  'group-mention': { src: groupMention, alt: 'Typing @ opens the group member picker above the message box.', highlight: { x: 3, y: 35, width: 94, height: 18 }, caption: 'Choose a member from the suggestions. This does not send the message yet.' },
  'group-member-menu': { src: groupMemberMenu, alt: 'A member’s context menu with Force Generate, Mute, Voice, and Remove from Group.', highlight: { x: 10, y: 36, width: 54, height: 18 }, caption: 'Right-click or long-press a member to open this menu. A normal click generates a reply.' },
  'summary-editor': { src: summaryEditor, alt: 'Native Summary panel with Summary Text, generation and save controls, Summarization Mode, Message Limit, and Prompt Template.', caption: 'Summary has its own text and mode. Generating a summary uses your selected model.' },
  'summary-preset': { src: summaryPreset, alt: 'The native Add Prompt menu contains Story Summary.', highlight: { x: 4, y: 41, width: 92, height: 9 }, caption: 'Check for an existing Story Summary block first. Add this built-in block only if it is missing.' },
  'memory-stats': { src: memoryStats, alt: 'Memory Cortex Stats shows this chat’s enable toggle, preparation status, and recall statistics.', highlight: { x: 4, y: 46, width: 90, height: 16 }, caption: 'Stats shows whether this chat has Cortex enabled and memory ready to recall.' },
  'memory-cortex': { src: memoryCortex, alt: 'Native Memory Cortex settings showing its enable switch and optional automatic warmup switch.', caption: 'Enable and configure Cortex here; automatic warmup is a separate choice.' },
  'memory-embeddings': { src: memoryEmbeddings, alt: 'Native Embeddings setup with a readiness checklist and provider, model, and API URL fields.', caption: 'The readiness checklist identifies missing embedding setup. Use an embedding-capable model.' },
  'voice-settings': { src: voiceSettings, alt: 'Native Voice settings showing text-to-speech, its connection, playback speed and volume, and speech detection controls.', caption: 'Voice settings select your TTS connection. Scroll for speech-to-text and Whistle.' },
  'voice-playback': { src: voicePlayback, alt: 'A fictional Mira greeting with the native speaker playback control below it.', highlight: { x: 21, y: 67, width: 5, height: 19 }, caption: 'The speaker icon below a message is Play with TTS. Playing it can use your configured speech provider.' },
  'voice-dictation': { src: voiceDictation, alt: 'Speech-to-Text settings showing Provider, Language, and Show mic button in input bar.', highlight: { x: 74, y: 14, width: 25, height: 11 }, caption: 'Choose your speech-to-text provider here; the microphone visibility checkbox is at the bottom.' },
  'voice-tools': { src: voiceTools, alt: 'Janiverse chat menu with Lumiverse tools at the bottom.', highlight: { x: 5, y: 87, width: 90, height: 12 }, caption: 'Lumiverse tools reveals the native attachments, microphone, and advanced controls.' },
  'voice-compose': { src: voiceCompose, alt: 'The native microphone beside the message input with Lumiverse tools visible.', highlight: { x: 85, y: 70, width: 7, height: 25 }, caption: 'The microphone starts dictation; the arrow sends your reviewed draft separately.' },
  'lorebook-entry': { src: lorebookEntry, alt: 'A fictional Lantern Café entry in World Book Editor, with Comment / Label, Primary Keys, and Content fields.', caption: 'Write the keyword under Primary Keys and the facts under Content. Scroll to see the full content and activation settings.' },
  'lorebook-activation': { src: lorebookActivation, alt: 'Native Lorebook panel with the demo Lantern Café book attached under This Chat Only.', caption: 'This Chat Only attaches the book to one conversation; Always Active applies it globally.' },
  'lorebook-verify': { src: lorebookVerify, alt: 'The native composer Extras menu offers Dry Run to preview a prompt without generating.', highlight: { x: 3, y: 56, width: 94, height: 19 }, caption: 'Type a keyword into the draft first, then Extras → Dry Run. This checks the assembled prompt without sending a reply.' },
  'extensions-install': { src: extensionsInstall, alt: 'Extensions Add Extension menu with a public Hone GitHub URL and Install from Source button.', caption: 'Paste an extension’s GitHub repository under Install from Source. Review its permissions before enabling it.' },
  'extensions-enabled': { src: extensionsEnabled, alt: 'An installed JAR Bridge extension card with enabled status, permission review, Update, Restart and Branch controls.', highlight: { x: 83, y: 11, width: 14, height: 13 }, caption: 'The switch controls whether this extension is enabled. Update is below Permissions.' },
  'extensions-controls': { src: extensionsControls, alt: 'The native Extension UI section lists JAR Import as a drawer tab.', highlight: { x: 3, y: 55, width: 94, height: 39 }, caption: 'This lists where the extension added its interface. JAR Import is a tab in the native sidebar.' },
  'import-link': { src: importLink, alt: 'JAR Bridge import assistant with JanitorAI link, Import card file, and Chat history tabs, plus the link preview input.', caption: 'Choose the source first, then preview before importing. JAR runs separately on a computer.' },
  'import-history': { src: importHistory, alt: 'JAR Bridge Chat history tab offering From JAR or History file and a conversation link field.', caption: 'Chat history is separate from the card. Load or choose its history file, review it, and select the matching character.' },
  'import-preview': { src: importPreview, alt: 'A fictional card file is selected, with its filename and the Import to Lumiverse confirmation button visible.', highlight: { x: 79, y: 87, width: 19, height: 11 }, instruction: 'For a card file, confirm the selected filename and choose Import to Lumiverse. For a link preview, check the character details before confirming.', result: 'The character is saved in your normal Lumiverse library. If it is already there, use that existing card when loading history.', caption: 'Only selecting a file does not import it. This final button saves the card.' },
  'import-complete': { src: importComplete, alt: 'A fictional three-message history preview with Mira selected as its destination and Import chat ready to confirm.', highlight: { x: 85, y: 85, width: 13, height: 9 }, caption: 'Check the selected character and messages, then Import chat. Continue chat appears after it saves.' },
};
