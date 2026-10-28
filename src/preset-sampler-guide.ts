import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

type Options = { presetName: string; openPreset(): Promise<boolean>; onClose?(): void };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };

/** Instructions beside the native editor. Opening this guide never edits or selects a preset. */
export function openPresetSamplerGuide(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, opening = false, minimized = false;
  const root = make('section', 'jb-api-guide jb-preset-sampler-guide'); root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'Preset sampler guide');
  const header = make('header', 'jb-api-guide-header'), minimize = make('button', 'jb-api-guide-icon', '−'), close = make('button', 'jb-api-guide-icon', '×');
  minimize.type = close.type = 'button'; minimize.setAttribute('aria-label', 'Minimize sampler guide'); minimize.setAttribute('aria-expanded', 'true'); close.setAttribute('aria-label', 'Close sampler guide');
  header.append(make('span', 'jb-api-guide-progress', 'Preset → Samplers'), minimize, close);
  const body = make('div', 'jb-api-guide-body'), list = make('ol', 'jb-sampler-guide-steps');
  list.append(make('li', '', `In the preset picker, choose “${options.presetName}”.`), make('li', '', 'Open Samplers near the top of the preset.'), make('li', '', 'Tick the parameter if needed, then edit its number or slider. Changes save automatically; check any save errors before leaving.'));
  const help = make('details', 'jb-api-guide-help'); help.append(make('summary', '', 'Missing controls or no effect?'), make('p', '', 'The provider decides which samplers appear. Check your API connection if the list is empty. Model profiles or a custom request body can override a preset value.'));
  const status = make('p', 'jb-api-guide-status'); status.setAttribute('role', 'status');
  const reopen = make('button', '', 'Open Preset'); reopen.type = 'button';
  const actions = make('div', 'jb-api-guide-actions'); actions.append(reopen);
  body.append(list, make('p', 'jb-settings-help', 'You are editing the original preset. Other chats using it can inherit these changes.'), status, actions, help); root.append(header, body);
  try { const mount = ctx.ui.mount('drawer_footer'); mount.classList.add('jb-api-guide-mount'); mount.append(root); }
  catch { root.classList.add('jb-api-guide-fallback'); document.body.append(root); }
  function destroy() { if (disposed) return; disposed = true; root.remove(); options.onClose?.(); }
  async function open() {
    if (disposed || opening) return; opening = true; reopen.disabled = true; status.textContent = '';
    try { if (!await options.openPreset() && !disposed) status.textContent = 'Open Preset from Lumiverse’s sidebar, then select the named preset and Samplers.'; }
    catch { if (!disposed) status.textContent = 'Couldn’t open Preset. Open it from Lumiverse’s sidebar, then Samplers.'; }
    finally { if (!disposed) { opening = false; reopen.disabled = false; } }
  }
  minimize.addEventListener('click', () => { if (disposed) return; minimized = !minimized; body.hidden = minimized; minimize.textContent = minimized ? '+' : '−'; minimize.setAttribute('aria-expanded', String(!minimized)); minimize.setAttribute('aria-label', minimized ? 'Resume sampler guide' : 'Minimize sampler guide'); });
  close.addEventListener('click', destroy); reopen.addEventListener('click', () => { void open(); }); root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); destroy(); } });
  void open(); return { root, destroy };
}
