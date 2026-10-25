import groupSelect from '../assets/tutorials/group-select.png';
import groupGreeting from '../assets/tutorials/group-greeting.png';
import groupSettings from '../assets/tutorials/group-settings.png';
import groupChat from '../assets/tutorials/group-chat.png';
import summaryEditor from '../assets/tutorials/summary-editor.png';
import memoryCortex from '../assets/tutorials/memory-cortex.png';
import memoryEmbeddings from '../assets/tutorials/memory-embeddings.png';
import voiceSettings from '../assets/tutorials/voice-settings.png';
import lorebookEntry from '../assets/tutorials/lorebook-entry.png';
import lorebookActivation from '../assets/tutorials/lorebook-activation.png';
import extensionsInstall from '../assets/tutorials/extensions-install.png';
import importLink from '../assets/tutorials/import-link.png';
import importHistory from '../assets/tutorials/import-history.png';
import type { TutorialScreenshots } from './feature-tutorials';

/** Real native controls, captured with fictional demo cards; bundled without remote requests. */
export const tutorialScreenshots: TutorialScreenshots = {
  'group-select': { src: groupSelect, alt: 'Select Characters: Mira and Rowan selected, search filtered to Tutorial, and Next available.', caption: 'Select at least two cards, then choose Next.' },
  'group-greeting': { src: groupGreeting, alt: 'Choose Opening Greeting: the two demo cards offer greetings, with Mira’s greeting selected.', caption: 'Choose the greeting that opens this group conversation.' },
  'group-settings': { src: groupSettings, alt: 'Group Settings showing the group name, default card and lorebook modes, Sequential response order, and Create Group Chat.', caption: 'Use the defaults for your first group; scroll for the remaining scenario and talkativeness settings.' },
  'group-chat': { src: groupChat, alt: 'A fictional group conversation with Mira and Rowan in the member bar, an opening greeting, API settings, and a persona picker in the composer.', caption: 'The member bar controls the cast. Your persona picker controls who you play.' },
  'summary-editor': { src: summaryEditor, alt: 'Native Summary panel with Summary Text, generation and save controls, Summarization Mode, Message Limit, and Prompt Template.', caption: 'Summary has its own text and mode. Generating a summary uses your selected model.' },
  'memory-cortex': { src: memoryCortex, alt: 'Native Memory Cortex settings showing its enable switch and optional automatic warmup switch.', caption: 'Enable and configure Cortex here; automatic warmup is a separate choice.' },
  'memory-embeddings': { src: memoryEmbeddings, alt: 'Native Embeddings setup with a readiness checklist and provider, model, and API URL fields.', caption: 'The readiness checklist identifies missing embedding setup. Use an embedding-capable model.' },
  'voice-settings': { src: voiceSettings, alt: 'Native Voice settings showing text-to-speech, its connection, playback speed and volume, and speech detection controls.', caption: 'Voice settings select your TTS connection. Scroll for speech-to-text and Whistle.' },
  'lorebook-entry': { src: lorebookEntry, alt: 'A fictional Lantern Café entry in World Book Editor, with Comment / Label, Primary Keys, and Content fields.', caption: 'Write the keyword under Primary Keys and the facts under Content. Scroll to see the full content and activation settings.' },
  'lorebook-activation': { src: lorebookActivation, alt: 'Native Lorebook panel with the demo Lantern Café book attached under This Chat Only.', caption: 'This Chat Only attaches the book to one conversation; Always Active applies it globally.' },
  'extensions-install': { src: extensionsInstall, alt: 'Extensions Add Extension menu with a public Hone GitHub URL and Install from Source button.', caption: 'Paste an extension’s GitHub repository under Install from Source. Review its permissions before enabling it.' },
  'import-link': { src: importLink, alt: 'JAR Bridge import assistant with JanitorAI link, Import card file, and Chat history tabs, plus the link preview input.', caption: 'Choose the source first, then preview before importing. JAR runs separately on a computer.' },
  'import-history': { src: importHistory, alt: 'JAR Bridge Chat history tab offering From JAR or History file and a conversation link field.', caption: 'Chat history is separate from the card. Load or choose its history file, review it, and select the matching character.' },
};
