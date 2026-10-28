import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import type { FeatureTutorialOptions, Scene } from './feature-tutorials';
import { screenshotSource } from './feature-tutorials';
import { screenshotAnnotations } from './tutorial-annotations';
import { readOptionalState, subscribeOptionalState } from './optional-state';
import { record, text } from './setup-data';

export const CONNECTION_GUIDE_KEY = 'onboarding:api_guide_v2';
type Profile = { id: string; name: string; provider: string; model: string; revision: string };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };

/** A non-modal companion in the public drawer footer. Only Test performs a provider request. */
export function openConnectionTutorial(ctx: SpindleFrontendContext, scenes: readonly Scene[], options: FeatureTutorialOptions) {
  let disposed = false, index = 0, interacted = false, minimized = false, targetId = '', opening = false;
  let profiles: Profile[] = [], baseline: Set<string> | undefined, readable = false, activeId = '', optionsKey = '';
  let testing = false, testEpoch = 0, passed: { id: string; revision: string } | undefined;
  let testAbort: AbortController | undefined, writeQueue = Promise.resolve();
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = make('section', 'jb-api-guide'); root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'API connection guide'); root.dataset.feature = 'connections';
  const mount = (() => { try { return ctx.ui.mount('drawer_footer'); } catch { return undefined; } })();
  let floating = !mount;
  if (mount) { mount.classList.add('jb-api-guide-mount'); mount.append(root); }
  else { root.classList.add('jb-api-guide-fallback'); document.body.append(root); }

  const header = make('header', 'jb-api-guide-header');
  const progress = make('span', 'jb-api-guide-progress');
  const minimize = make('button', 'jb-api-guide-icon', '−'); minimize.type = 'button'; minimize.setAttribute('aria-label', 'Minimize API guide'); minimize.setAttribute('aria-expanded', 'true');
  const close = make('button', 'jb-api-guide-icon', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close tutorial');
  header.append(progress, minimize, close);
  const body = make('div', 'jb-api-guide-body');
  const heading = make('h3', 'jb-api-guide-title'), instruction = make('p', 'jb-api-guide-instruction'), outcome = make('p', 'jb-api-guide-result');
  const selection = make('label', 'jb-api-guide-selection', 'Follow this saved connection');
  const select = make('select', 'jb-api-guide-select'); select.setAttribute('aria-label', 'Follow this saved connection'); selection.append(select);
  const checks = make('ul', 'jb-api-guide-checks'); checks.setAttribute('aria-label', 'Connection checks'); checks.setAttribute('aria-live', 'polite');
  const savedCheck = make('li', '', '○ Saved'), activeCheck = make('li', '', '○ Active'), testedCheck = make('li', '', '○ Test passed'); checks.append(savedCheck, activeCheck, testedCheck);
  const status = make('p', 'jb-api-guide-status'); status.setAttribute('role', 'status');
  const actions = make('div', 'jb-api-guide-actions');
  const reopen = make('button', '', 'Open Connections'), test = make('button', 'jb-api-guide-primary', 'Test selected connection'), finish = make('button', 'jb-api-guide-primary', 'Finish guide');
  for (const button of [reopen, test, finish]) button.type = 'button'; actions.append(reopen, test, finish);
  const picture = make('details', 'jb-api-guide-picture'); picture.append(make('summary', '', 'Example screenshot'));
  const figure = make('figure', 'jb-api-guide-figure'); picture.append(figure);
  const navigation = make('nav', 'jb-api-guide-nav'); navigation.setAttribute('aria-label', 'Walkthrough steps');
  const back = make('button', '', 'Back'), next = make('button', '', 'Next'); back.type = next.type = 'button'; navigation.append(back, next);
  const help = make('details', 'jb-api-guide-help'); help.append(make('summary', '', 'Help'));
  help.append(make('p', '', 'Use your own provider key. These screenshots use OpenRouter; choose your own provider and model in the form.'));
  help.append(make('p', '', 'No models? Check your provider, key, and URL, then refresh models. A supported model ID can also be entered directly.'));
  help.append(make('p', '', 'A failed test: Edit this saved connection, check its provider and key, then save and test again. The same test is in its More actions (⋮) menu.'));
  help.append(make('p', '', 'A test checks saved credentials. It does not guarantee access to every model. Chats pinned to another connection can keep using it.'));
  const restart = make('button', '', 'Restart guide'); restart.type = 'button'; help.append(restart);
  const preferenceStatus = make('p', 'jb-api-guide-preference'); preferenceStatus.setAttribute('role', 'status');
  body.append(heading, instruction, outcome, selection, checks, status, actions, picture, navigation, help, preferenceStatus); root.append(header, body);

  function persist() {
    const value = { step: index, connectionId: targetId };
    if (!ctx.settings?.set) return;
    writeQueue = writeQueue.then(() => ctx.settings.set(CONNECTION_GUIDE_KEY, value)).catch(() => { if (!disposed) preferenceStatus.textContent = 'Your place could not be saved. The guide still works in this session.'; });
  }
  function selected() { return profiles.find(profile => profile.id === targetId); }
  function verified(profile = selected()) { return !!profile && passed?.id === profile.id && passed.revision === profile.revision; }
  function configured(profile = selected()) { return !!profile?.provider && profile.provider !== 'model_roulette' && !!profile.model; }
  function cancelTest() { testEpoch++; testAbort?.abort(); testAbort = undefined; testing = false; }
  function syncControls() {
    const profile = selected(), saved = configured(profile), active = !!profile && profile.id === activeId, valid = verified(profile);
    selection.hidden = checks.hidden = index < 3;
    savedCheck.textContent = `${saved ? '✓' : '○'} Saved`; activeCheck.textContent = `${active ? '✓' : '○'} Active`; testedCheck.textContent = `${valid ? '✓' : '○'} Test passed`;
    checks.dataset.complete = String(saved && active && valid);
    select.disabled = !readable || testing;
    test.hidden = index < 5; test.disabled = !saved || testing || !readable; test.textContent = testing ? 'Testing…' : valid ? 'Test again' : 'Test selected connection';
    finish.hidden = index !== scenes.length - 1; finish.disabled = !saved || !active || !valid || testing;
    back.disabled = index === 0 || opening; next.disabled = index === scenes.length - 1 || opening;
    reopen.hidden = index !== 0 && !!mount; reopen.disabled = opening;
  }
  function syncVisibility() {
    const drawer = record(readOptionalState(ctx, 'ui.drawer', { open: true, tabId: 'connections' }));
    if (floating && mount && drawer.open === true && drawer.tabId === 'connections') { mount.append(root); floating = false; root.classList.remove('jb-api-guide-fallback'); }
    root.hidden = !floating && (drawer.open !== true || drawer.tabId !== 'connections');
  }
  function syncProfiles(changed = false) {
    if (disposed) return;
    const raw = readOptionalState<unknown>(ctx, 'connections.profiles', null);
    readable = Array.isArray(raw);
    profiles = readable ? (raw as unknown[]).map(record).filter(row => text(row.id)).map(row => ({ id: text(row.id), name: text(row.name) || 'Unnamed connection', provider: text(row.provider), model: text(row.model), revision: JSON.stringify([row.provider, row.model, row.api_url, row.updated_at, row.has_api_key]) })) : [];
    activeId = text(record(readOptionalState(ctx, 'connections.active', {})).activeProfileId);
    if (changed) { const invalidated = testing || !!passed; cancelTest(); passed = undefined; if (invalidated) status.textContent = 'Connections changed. Test the selected connection again when it is ready.'; }
    const ids = new Set(profiles.map(profile => profile.id));
    if (baseline && !targetId && index >= 3) {
      const added = profiles.filter(profile => !baseline!.has(profile.id));
      if (added.length === 1) { interacted = true; targetId = added[0].id; persist(); }
    }
    if (readable) baseline = ids;
    const key = JSON.stringify(profiles.map(profile => [profile.id, profile.name, profile.provider, profile.model]));
    if (key !== optionsKey) {
      optionsKey = key; select.replaceChildren(); const empty = make('option', '', profiles.length ? 'Choose your saved connection…' : readable ? 'Create a connection above first' : 'Connection status unavailable'); empty.value = ''; select.append(empty);
      for (const profile of profiles) { const option = make('option', '', `${profile.name} · ${profile.provider}`); option.value = profile.id; option.disabled = profile.provider === 'model_roulette'; select.append(option); }
    }
    select.value = targetId;
    if (passed && !verified()) { passed = undefined; status.textContent = 'The saved connection changed. Test it again.'; }
    if (!readable) status.textContent = 'Couldn’t read saved connections. Reopen Connections to refresh its list.';
    else if (targetId && !selected()) status.textContent = 'That connection is no longer available. Choose another saved connection.';
    syncControls();
  }
  function renderScene() {
    const scene = scenes[index]; root.dataset.scene = String(index + 1); root.dataset.screenshot = scene.screenshot;
    progress.textContent = `API guide · ${index + 1} / ${scenes.length}`; progress.setAttribute('aria-label', `Scene ${index + 1} of ${scenes.length}`);
    heading.textContent = scene.title; instruction.textContent = scene.instruction; outcome.textContent = `Look for: ${scene.result}`;
    picture.open = false; figure.replaceChildren();
    const screenshot = options.screenshots?.[scene.screenshot], source = screenshot && screenshotSource(screenshot.src);
    if (screenshot && source) {
      const shot = make('div', 'jb-tutorial-shot'), image = make('img', ''); image.src = source; image.alt = screenshot.alt; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      if (screenshot.width && screenshot.height) { image.width = screenshot.width; image.height = screenshot.height; }
      shot.append(image); const legend = screenshot.callouts && screenshotAnnotations(shot, screenshot.callouts); figure.append(shot); if (legend) figure.append(legend);
      image.addEventListener('error', () => { if (!disposed && figure.contains(image)) figure.replaceChildren(make('p', '', 'Screenshot unavailable. Follow the instruction above.')); });
    } else figure.append(make('p', '', 'Follow the instruction above in Connections.'));
    syncControls(); root.scrollTop = 0;
  }
  function chooseScene(value: number) { if (disposed || opening) return; interacted = true; index = Math.max(0, Math.min(scenes.length - 1, value)); persist(); renderScene(); }
  async function openConnections() {
    if (disposed || opening) return; opening = true; syncControls();
    function failed() { if (disposed) return; floating = true; root.classList.add('jb-api-guide-fallback'); document.body.append(root); status.textContent = 'Couldn’t open Connections. Open Connect from Lumiverse’s sidebar.'; }
    try { const ok = await options.invoke({ kind: 'drawer_tab', id: 'connections' }); if (!ok) failed(); }
    catch { failed(); }
    finally { opening = false; if (!disposed) { syncVisibility(); syncProfiles(); } }
  }
  async function runTest() {
    const profile = selected();
    if (disposed || root.hidden || minimized || testing || !configured(profile) || !readable || index < 5) return;
    interacted = true; cancelTest(); const generation = testEpoch, id = profile!.id, revision = profile!.revision;
    testAbort = new AbortController(); testing = true; passed = undefined; status.textContent = `Testing ${profile!.name}…`; syncControls();
    try {
      const response = await fetch(`/api/v1/connections/${encodeURIComponent(id)}/test`, { method: 'POST', credentials: 'same-origin', signal: testAbort.signal });
      const result = response.ok ? record(await response.json()) : {};
      if (disposed || generation !== testEpoch || selected()?.id !== id || selected()?.revision !== revision) return;
      if (response.ok && result.success === true) {
        passed = { id, revision }; index = scenes.length - 1; persist(); renderScene(); status.textContent = `Connection successful · ${profile!.name}. The provider accepted the saved credentials.`;
      } else status.textContent = 'Test failed. Edit this connection above, check the provider and key, save, then test again.';
    } catch { if (!disposed && generation === testEpoch) status.textContent = 'Couldn’t complete the test. Check your server connection and try again.'; }
    finally { if (!disposed && generation === testEpoch) { testing = false; testAbort = undefined; syncControls(); } }
  }
  function destroy() { if (disposed) return; disposed = true; cancelTest(); cleanups.reverse().forEach(stop => stop()); root.remove(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); options.onClose?.(); }
  close.addEventListener('click', destroy); finish.addEventListener('click', () => { if (!finish.disabled) destroy(); });
  back.addEventListener('click', () => chooseScene(index - 1)); next.addEventListener('click', () => chooseScene(index + 1));
  reopen.addEventListener('click', () => { void openConnections(); }); test.addEventListener('click', () => { void runTest(); });
  select.addEventListener('change', () => { if (disposed || testing) return; interacted = true; targetId = select.value; cancelTest(); passed = undefined; status.textContent = ''; persist(); syncControls(); });
  minimize.addEventListener('click', () => { if (disposed) return; minimized = !minimized; body.hidden = minimized; minimize.textContent = minimized ? '+' : '−'; minimize.setAttribute('aria-expanded', String(!minimized)); minimize.setAttribute('aria-label', minimized ? 'Resume API guide' : 'Minimize API guide'); });
  restart.addEventListener('click', () => { if (disposed) return; cancelTest(); passed = undefined; targetId = ''; status.textContent = ''; help.open = false; chooseScene(0); syncProfiles(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); destroy(); } });
  function nativeInteraction(event: Event) { const target = event.target as Element | null; if (target?.closest?.('[data-lumiverse-surface="viewport-drawer"]') && !root.contains(target)) interacted = true; }
  document.addEventListener('pointerdown', nativeInteraction, true); document.addEventListener('keydown', nativeInteraction, true);
  const cleanups = [subscribeOptionalState(ctx, 'connections.profiles', () => syncProfiles(true)), subscribeOptionalState(ctx, 'connections.active', () => syncProfiles()), subscribeOptionalState(ctx, 'ui.drawer', syncVisibility), () => { document.removeEventListener('pointerdown', nativeInteraction, true); document.removeEventListener('keydown', nativeInteraction, true); }];
  syncProfiles(); renderScene(); syncVisibility();
  if (ctx.settings?.get) void Promise.resolve().then(() => ctx.settings.get(CONNECTION_GUIDE_KEY)).then(value => {
    if (disposed || interacted) return; const saved = record(value);
    if (typeof saved.step === 'number' && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < scenes.length) index = saved.step;
    targetId = text(saved.connectionId); syncProfiles(); renderScene();
  }).catch(() => { if (!disposed) preferenceStatus.textContent = 'Your saved place could not be read. You can still follow the guide.'; });
  // Launching the guide is an explicit request to open its native workspace.
  void Promise.resolve().then(() => { if (!disposed) return openConnections(); });
  return { root, destroy };
}
