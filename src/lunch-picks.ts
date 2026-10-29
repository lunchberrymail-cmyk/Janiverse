export type LunchPick = { goal: string; name: string; url: string; note: string };

/** Lunch's published recommendations, the only extension list; edited with the extension's source. */
export const lunchPicks: readonly LunchPick[] = [
  {
    goal: 'Polish my writing', name: 'Hone', url: 'https://github.com/AMousePad/Hone',
    note: 'Refine AI replies or enhance your own drafts with a separate editing pass.',
  },
  {
    goal: 'Remember long stories', name: 'LumiBooks', url: 'https://github.com/AMousePad/LumiBooks',
    note: 'Turn older messages into editable chapter and arc summaries, with optional story-detail tracking.',
  },
  {
    goal: 'Hear character voices', name: 'Choir', url: 'https://github.com/patatasbravasch-arch/Choir',
    note: 'Give narration and characters distinct voices, with optional sound effects, ambience, and background music.',
  },
  {
    goal: 'Color character dialogue', name: 'Prism', url: 'https://github.com/kittyafterdark/Prism',
    note: 'Color character dialogue and optional thoughts with per-speaker palettes, gradients, and manual attribution corrections.',
  },
  {
    goal: 'Read it like a visual novel', name: 'Cue — Living Novel', url: 'https://github.com/japolino/cue-living-novel',
    note: 'Read chats as a visual novel with paragraph reveals, scene staging, and generated images.',
  },
  {
    goal: 'Add an in-world phone', name: 'Pocket', url: 'https://github.com/kittyafterdark/Pocket',
    note: 'Add an in-world phone for messages, contacts, photos, notes, and other roleplay tools.',
  },
];
