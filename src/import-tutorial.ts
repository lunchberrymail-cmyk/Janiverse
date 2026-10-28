import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { FeatureTutorialOptions, Scene } from './feature-tutorials';
import { screenshotSource } from './feature-tutorials';
import { screenshotAnnotations } from './tutorial-annotations';
import { record } from './setup-data';

export const CARD_GUIDE_KEY = 'onboarding:card_guide_v2';
export type ImportProgress = { queued: number; saved: number; failed: number; uncertain: number; busy: boolean };
export type ImportGuideAttachment = { root: HTMLElement; update(state: ImportProgress): void; mounted(closeWorkspace: () => void): void; interact(): void; dismiss(): void };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };

/** Lives in the ordinary importer; it observes results, never selects or submits files. */
export function openImportTutorial(ctx: SpindleFrontendContext, scenes: readonly Scene[], options: FeatureTutorialOptions) {
  let disposed = false, opening = false, index = 0, interacted = false, minimized = false, attached = false;
  let progress: ImportProgress = { queued: 0, saved: 0, failed: 0, uncertain: 0, busy: false };
  let closeWorkspace: (() => void) | undefined, writes = Promise.resolve();
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = make('section', 'jb-api-guide jb-import-guide jb-api-guide-fallback'); root.dataset.feature = 'import'; root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'Card import guide');
  const header = make('header', 'jb-api-guide-header'), count = make('span', 'jb-api-guide-progress');
  const minimize = make('button', 'jb-api-guide-icon', '−'), close = make('button', 'jb-api-guide-icon', '×');
  minimize.type = close.type = 'button'; minimize.setAttribute('aria-label', 'Minimize card guide'); minimize.setAttribute('aria-expanded', 'true'); close.setAttribute('aria-label', 'Close tutorial'); header.append(count, minimize, close);
  const body = make('div', 'jb-api-guide-body'), title = make('h3', 'jb-api-guide-title'), instruction = make('p', 'jb-api-guide-instruction'), outcome = make('p', 'jb-api-guide-result');
  const status = make('p', 'jb-api-guide-status'); status.setAttribute('role', 'status');
  const reopen = make('button', '', 'Open card importer'); reopen.type = 'button';
  const picture = make('details', 'jb-api-guide-picture'); picture.append(make('summary', '', 'Show example screenshot')); const figure = make('figure', 'jb-api-guide-figure'); picture.append(figure);
  const nav = make('nav', 'jb-api-guide-nav'); nav.setAttribute('aria-label', 'Walkthrough steps'); const back = make('button', '', 'Back'), next = make('button', '', 'Next'), finish = make('button', 'jb-api-guide-primary', 'Finish guide'); back.type = next.type = finish.type = 'button'; nav.append(back, next, finish);
  const history = make('button', 'jb-import-guide-history', 'Need your old messages too?'); history.type = 'button'; history.hidden = !options.openHistoryTutorial;
  const help = make('details', 'jb-api-guide-help'); help.append(make('summary', '', 'Before you start / Need help?'), make('p', '', 'You do not need JAR or JAR Bridge for character cards. Use a PNG, JSON or CHARX card export, not a portrait or screenshot.'), make('p', '', 'For Link, paste a supported public character link, choose Add link, then check the queue. An unavailable source may require a downloaded file instead.'), make('p', '', 'Already have this character? Keep that saved card and use “Need your old messages too?” to bring its history. There is no need to import another copy.'), make('p', '', 'A failed import needs attention in the queue. If the result is uncertain, check the library before retrying to avoid duplicates.'));
  const restart = make('button', '', 'Restart guide'); restart.type = 'button'; help.append(restart);
  const preference = make('p', 'jb-api-guide-preference'); preference.setAttribute('role', 'status');
  body.append(title, instruction, outcome, status, reopen, picture, nav, history, help, preference); root.append(header, body); document.body.append(root);

  function persist() { const value = { step: index }; if (ctx.settings?.set) writes = writes.then(() => ctx.settings.set(CARD_GUIDE_KEY, value)).catch(() => { if (!disposed) preference.textContent = 'Your place could not be saved. The guide still works here.'; }); }
  function controls() { back.disabled = index === 0 || opening || progress.busy; next.hidden = index === scenes.length - 1; next.disabled = opening || progress.busy; finish.hidden = index !== scenes.length - 1; finish.disabled = progress.saved === 0 || progress.busy; history.disabled = opening || progress.busy; restart.disabled = opening || progress.busy; reopen.hidden = attached; reopen.disabled = opening; }
  function reportProgress() {
    status.textContent = progress.busy ? 'Importing… Please wait for the result in the queue.' : progress.uncertain ? 'An import could not be confirmed. Check the library before retrying.' : progress.failed ? 'Some cards need attention. Read their queue messages before retrying.' : progress.saved ? `${progress.saved} card${progress.saved === 1 ? '' : 's'} saved in this session. Choose Open character on its queue row.` : index === scenes.length - 1 ? 'No saved card is confirmed in this session. If you imported it earlier, find it on Home and close this guide; do not import another copy.' : index > 0 && progress.queued === 0 ? 'Queue is empty. Choose your card if you haven’t imported it yet. Already saved? Find it on Home.' : '';
  }
  function render() {
    const scene = scenes[index]; root.dataset.scene = String(index + 1); root.dataset.screenshot = scene.screenshot; count.textContent = `Card guide · ${index + 1} / ${scenes.length}`; count.setAttribute('aria-label', `Scene ${index + 1} of ${scenes.length}`);
    title.textContent = scene.title; instruction.textContent = scene.instruction; outcome.textContent = `Look for: ${scene.result}`;
    picture.open = false; figure.replaceChildren(); const screenshot = options.screenshots?.[scene.screenshot], source = screenshot && screenshotSource(screenshot.src);
    if (screenshot && source) {
      const shot = make('div', 'jb-tutorial-shot'), image = make('img', ''); image.src = source; image.alt = screenshot.alt; image.decoding = 'async'; image.referrerPolicy = 'no-referrer'; if (screenshot.width && screenshot.height) { image.width = screenshot.width; image.height = screenshot.height; } shot.append(image); figure.append(shot); const legend = screenshot.callouts && screenshotAnnotations(shot, screenshot.callouts); if (legend) figure.append(legend);
      image.addEventListener('error', () => { if (!disposed && figure.contains(image)) figure.replaceChildren(make('p', '', 'Screenshot unavailable. Follow the instruction above.')); });
    } else figure.append(make('p', '', 'Follow the instruction above in the importer.'));
    controls(); reportProgress(); root.scrollTop = 0;
  }
  function choose(value: number) { if (disposed || opening || progress.busy) return; interacted = true; index = Math.max(0, Math.min(scenes.length - 1, value)); persist(); render(); }
  function destroy() { if (disposed) return; disposed = true; root.remove(); if (previousFocus?.isConnected && !attached) previousFocus.focus({ preventScroll: true }); options.onClose?.(); }
  const attachment: ImportGuideAttachment = {
    root, dismiss: destroy, interact() { interacted = true; },
    mounted(close) { if (disposed) return; attached = true; closeWorkspace = close; root.classList.remove('jb-api-guide-fallback'); controls(); },
    update(value) {
      if (disposed) return; progress = value;
      const target = value.saved > 0 ? scenes.length - 1 : value.queued > 0 && index === 0 ? 1 : index;
      if (target !== index) { interacted = true; index = target; persist(); render(); }
      reportProgress(); controls();
    },
  };
  async function open() {
    if (disposed || opening || attached) return; opening = true; controls();
    try { if (!options.openImport) throw new Error('Unavailable'); await options.openImport(attachment); if (!disposed && !attached) status.textContent = 'Use More → Import characters to open the regular importer.'; }
    catch { if (!disposed) status.textContent = 'Couldn’t open the importer. Try More → Import characters.'; }
    finally { opening = false; if (!disposed) controls(); }
  }
  close.addEventListener('click', destroy); finish.addEventListener('click', () => { if (!disposed && !finish.disabled) destroy(); }); reopen.addEventListener('click', () => { void open(); }); back.addEventListener('click', () => choose(index - 1)); next.addEventListener('click', () => choose(index + 1));
  minimize.addEventListener('click', () => { if (disposed) return; minimized = !minimized; body.hidden = minimized; minimize.textContent = minimized ? '+' : '−'; minimize.setAttribute('aria-label', minimized ? 'Resume card guide' : 'Minimize card guide'); minimize.setAttribute('aria-expanded', String(!minimized)); });
  restart.addEventListener('click', () => { if (disposed || progress.busy) return; help.open = false; choose(0); });
  history.addEventListener('click', () => { if (disposed || opening || progress.busy || !options.openHistoryTutorial) return; const close = closeWorkspace; destroy(); close?.(); options.openHistoryTutorial(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); destroy(); } });
  const touch = () => { interacted = true; }; root.addEventListener('pointerdown', touch, true); root.addEventListener('keydown', touch, true);
  render();
  if (ctx.settings?.get) void Promise.resolve().then(() => ctx.settings.get(CARD_GUIDE_KEY)).then(value => { if (disposed || interacted) return; const saved = record(value); if (typeof saved.step === 'number' && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < scenes.length) { index = saved.step; render(); } }).catch(() => { if (!disposed) preference.textContent = 'Your saved place could not be read. You can still follow the guide.'; });
  void Promise.resolve().then(() => { if (!disposed) return open(); });
  return { root, destroy };
}
