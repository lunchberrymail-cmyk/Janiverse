export type LunchPick = { name: string; url: string; note: string };

/** Lunch's published recommendations; edited with the extension's source. */
export const lunchPicks: readonly LunchPick[] = [
  {
    name: 'Choir', url: 'https://github.com/patatasbravasch-arch/Choir',
    note: 'Give narration and characters distinct voices, with optional sound effects, ambience, and background music.',
  },
  {
    name: 'LumiBooks', url: 'https://github.com/AMousePad/LumiBooks',
    note: 'Turn older messages into editable chapter and arc summaries, with optional story-detail tracking.',
  },
  {
    name: 'Cue — Living Novel', url: 'https://github.com/japolino/cue-living-novel',
    note: 'Read chats as a visual novel with paragraph reveals, scene staging, and generated images.',
  },
  {
    name: 'Pocket', url: 'https://github.com/kittyafterdark/Pocket',
    note: 'Add an in-world phone for messages, contacts, photos, notes, and other roleplay tools.',
  },
  {
    name: 'Prism', url: 'https://github.com/kittyafterdark/Prism',
    note: 'Color character dialogue and optional thoughts with per-speaker palettes, gradients, and manual attribution corrections.',
  },
];

export function createLunchPicks(picks: readonly LunchPick[] = lunchPicks): HTMLElement {
  const root = document.createElement('div'); root.className = 'jb-lunch-picks';
  for (const pick of picks) {
    let url: URL;
    try { url = new URL(pick.url); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const item = document.createElement('article'); item.className = 'jb-lunch-pick';
    const name = document.createElement('h3'); name.textContent = pick.name;
    const note = document.createElement('p'); note.textContent = pick.note;
    const link = document.createElement('a'); link.textContent = 'View extension'; link.href = url.href;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
    item.append(name, note, link); root.append(item);
  }
  if (!root.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'jb-lunch-picks-empty';
    empty.textContent = 'Lunch’s recommendations are coming soon.'; root.append(empty);
  }
  return root;
}
