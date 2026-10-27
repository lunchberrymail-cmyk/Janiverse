import card from '../assets/tutorials/card-import.webm';
import history from '../assets/tutorials/history-import.webm';
import cardCaptions from '../assets/tutorials/card-import.vtt' with { type: 'text' };
import historyCaptions from '../assets/tutorials/history-import.vtt' with { type: 'text' };
import type { TutorialFeature } from './feature-tutorials';
import type { TutorialRecording } from './tutorial-video';

/** Actual local browser recordings, using the fictional practice files in assets/tutorials/samples. */
export const tutorialRecordings: Partial<Record<TutorialFeature, TutorialRecording>> = {
  import: { src: card, captions: cardCaptions, chapters: [
    { time: 0, title: 'Open card import', scene: 0 },
    { time: 9, title: 'Choose a card file', scene: 1 },
    { time: 14, title: 'Import and open', scene: 2 },
  ] },
  history: { src: history, captions: historyCaptions, chapters: [
    { time: 0, title: 'Optional history import', scene: 0 },
    { time: 4, title: 'Use a history file', scene: 1 },
    { time: 9, title: 'Match the character', scene: 2 },
    { time: 18, title: 'Continue the chat', scene: 3 },
  ] },
};
