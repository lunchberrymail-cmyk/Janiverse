import type { SpindleFrontendContext } from 'lumiverse-spindle-types';

type Options = { presetName: string; openPreset(): Promise<boolean>; onClose?(): void };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };

/** Instructions beside the native editor. Opening this guide never edits or selects a preset. */
export function openPresetSamplerGuide(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, opening = false, minimized = false, step = 0;
  const root = make('section', 'jb-api-guide jb-preset-sampler-guide'); root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'Preset sampler guide');
  const header = make('header', 'jb-api-guide-header'), minimize = make('button', 'jb-api-guide-icon', '−'), close = make('button', 'jb-api-guide-icon', '×');
  minimize.type = close.type = 'button'; minimize.setAttribute('aria-label', 'Minimize sampler guide'); minimize.setAttribute('aria-expanded', 'true'); close.setAttribute('aria-label', 'Close sampler guide');
  const progress = make('span', 'jb-api-guide-progress'); header.append(progress, minimize, close);
  const body = make('div', 'jb-api-guide-body'), title = make('h3', 'jb-api-guide-title'), instruction = make('p', 'jb-api-guide-instruction');
  const steps = [
    ['Choose your preset', `In the preset picker, choose “${options.presetName}”.`],
    ['Open Samplers', 'Expand Samplers near the top of the preset, below its cover.'],
    ['Adjust a value', 'Tick the parameter if needed, then edit its number or slider. Changes save automatically; check any save errors before leaving.'],
  ];
  const help = make('details', 'jb-api-guide-help'); help.append(make('summary', '', 'Help · Missing controls or no effect?'), make('p', '', 'The provider decides which samplers appear. Check your API connection if the list is empty. Model profiles or a custom request body can override a preset value.'));
  const status = make('p', 'jb-api-guide-status'); status.setAttribute('role', 'status');
  const reopen = make('button', '', 'Open Preset'); reopen.type = 'button';
  help.append(reopen);
  const nav = make('nav', 'jb-api-guide-nav'), back = make('button', '', 'Back'), next = make('button', 'jb-api-guide-primary'); back.type = next.type = 'button'; nav.setAttribute('aria-label', 'Sampler guide steps'); nav.append(back, next);
  body.append(title, instruction, make('p', 'jb-api-guide-result', 'Edits affect the original and other chats using it.'), status, nav, help); root.append(header, body);
  try { const mount = ctx.ui.mount('drawer_footer'); mount.classList.add('jb-api-guide-mount'); mount.append(root); }
  catch { root.classList.add('jb-api-guide-fallback'); document.body.append(root); }
  function destroy() { if (disposed) return; disposed = true; root.remove(); options.onClose?.(); }
  function render() { progress.textContent = `Preset → Samplers · ${step + 1} / ${steps.length}`; title.textContent = steps[step][0]; instruction.textContent = steps[step][1]; back.disabled = step === 0; next.textContent = step === steps.length - 1 ? 'Close guide' : 'Next'; }
  back.addEventListener('click', () => { if (step > 0) { step--; render(); } });
  next.addEventListener('click', () => { if (step === steps.length - 1) destroy(); else { step++; render(); } });
  async function open() {
    if (disposed || opening) return; opening = true; reopen.disabled = true; status.textContent = '';
    try { if (!await options.openPreset() && !disposed) status.textContent = 'Open Preset from Lumiverse’s sidebar, then select the named preset and Samplers.'; }
    catch { if (!disposed) status.textContent = 'Couldn’t open Preset. Open it from Lumiverse’s sidebar, then Samplers.'; }
    finally { if (!disposed) { opening = false; reopen.disabled = false; } }
  }
  minimize.addEventListener('click', () => { if (disposed) return; minimized = !minimized; body.hidden = minimized; minimize.textContent = minimized ? '+' : '−'; minimize.setAttribute('aria-expanded', String(!minimized)); minimize.setAttribute('aria-label', minimized ? 'Resume sampler guide' : 'Minimize sampler guide'); });
  close.addEventListener('click', destroy); reopen.addEventListener('click', () => { void open(); }); root.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); destroy(); } });
  render(); void open(); return { root, destroy };
}
