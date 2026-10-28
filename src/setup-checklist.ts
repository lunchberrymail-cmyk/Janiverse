import type { SpindleFrontendContext } from 'lumiverse-spindle-types';
import { providerName, readConnection, readPrompt, readSetupPage, watchSetup } from './setup-data';

export const SETUP_DISMISSED_KEY = 'onboarding:setup_dismissed_v1';
type Options = { openApi(): void; openImport(): void; openPersona(): void; openPrompt(): void; chooseCharacter(): void; dismissed(): void };
type Step = { key: string; label: string; optional?: boolean; action(): void; state: 'checking' | 'missing' | 'done' | 'unknown'; detail: string };
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, value = '') => { const node = document.createElement(tag); node.className = cls; node.textContent = value; return node; };

export function createSetupChecklist(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, active = false, epoch = 0, interacted = false, preferenceRead = false, preferenceHidden = false, preferenceEpoch = 0;
  let abort: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let writeQueue = Promise.resolve();
  const root = make('section', 'jb-setup-checklist'); root.setAttribute('aria-label', 'Your setup checklist');
  const progress = make('p', 'jb-setup-progress', 'Checking your setup…'); progress.setAttribute('role', 'status');
  const list = make('div', 'jb-setup-steps');
  const steps: Step[] = [
    { key: 'connection', label: 'Connect your AI', action: options.openApi, state: 'checking', detail: 'Checking connection…' },
    { key: 'card', label: 'Add a character card', action: options.openImport, state: 'checking', detail: 'Checking characters…' },
    { key: 'persona', label: 'Create a persona', optional: true, action: options.openPersona, state: 'checking', detail: 'Checking personas…' },
    { key: 'prompt', label: 'Preset or prompt', optional: true, action: options.openPrompt, state: 'checking', detail: 'Checking selection…' },
  ];
  const status = make('p', 'jb-setup-notice'); status.setAttribute('role', 'status');
  function act(action: () => void) { if (disposed || !active) return; interacted = true; status.textContent = ''; try { action(); } catch { status.textContent = 'Could not open this step. Try again from More.'; } }
  const controls = steps.map((step, index) => {
    const button = make('button', 'jb-setup-step'); button.type = 'button'; button.dataset.step = step.key;
    const mark = make('span', 'jb-setup-mark', String(index + 1)); mark.setAttribute('aria-hidden', 'true');
    const copy = make('span', 'jb-setup-copy'); const heading = make('span', 'jb-setup-label', step.label);
    if (step.optional) heading.append(make('span', 'jb-setup-optional', 'Optional'));
    const detail = make('span', 'jb-setup-detail'); copy.append(heading, detail); button.append(mark, copy);
    button.addEventListener('click', () => act(step.action)); list.append(button); return { button, mark, detail };
  });
  const footer = make('div', 'jb-setup-actions');
  const next = make('button', 'jb-setup-next', 'Check setup'); next.type = 'button';
  const retry = make('button', 'jb-setup-retry', 'Refresh setup'); retry.type = 'button';
  const dismiss = make('button', 'jb-setup-dismiss', 'Do this later'); dismiss.type = 'button';
  footer.append(next, retry, dismiss); root.append(progress, list, footer, status);
  function persist(value: boolean) {
    writeQueue = writeQueue.then(async () => { if (!disposed && ctx.settings?.set) await ctx.settings.set(SETUP_DISMISSED_KEY, value); }).catch(() => { if (!disposed) status.textContent = 'This choice could not be saved. You can still use the checklist.'; });
  }
  function render() {
    steps.forEach((step, index) => {
      const control = controls[index]; control.button.dataset.state = step.state;
      control.mark.textContent = step.state === 'done' ? '✓' : step.state === 'unknown' ? '?' : String(index + 1);
      control.detail.textContent = step.detail;
      control.button.setAttribute('aria-label', `${step.label}${step.optional ? ', optional' : ''}: ${step.detail}`);
    });
    const essentials = steps.slice(0, 2), ready = essentials.every(step => step.state === 'done');
    const checking = essentials.some(step => step.state === 'checking');
    progress.textContent = checking ? 'Checking your setup…' : ready ? 'The essentials are ready. Pick a character to start chatting.' : `${essentials.filter(step => step.state === 'done').length} of 2 essentials ready · Persona and prompt are optional.`;
    const unfinished = essentials.find(step => step.state !== 'done');
    next.disabled = checking; next.textContent = ready ? 'Choose a character →' : unfinished?.key === 'connection' ? 'Set up AI connection' : 'Add a character card';
    dismiss.textContent = ready ? 'Hide checklist' : 'Do this later';
  }
  async function refresh() {
    if (disposed || !active) return;
    const generation = ++epoch; abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    const current = () => !disposed && active && generation === epoch;
    retry.disabled = true;
    const connectionTask = readConnection(ctx, signal);
    const results = await Promise.allSettled([
      connectionTask, readSetupPage('/characters/summary?limit=1&offset=0', signal), readSetupPage('/personas?limit=1&offset=0', signal),
      connectionTask.then(connection => readPrompt(ctx, signal, connection)),
    ]);
    if (!current()) return;
    const [connection, cards, personas, prompt] = results;
    if (connection.status === 'fulfilled') {
      const value = connection.value, ready = !!value?.provider && !!value.model;
      Object.assign(steps[0], { state: ready ? 'done' : 'missing', detail: ready ? `${providerName(value!.provider)} · ${value!.model}` : value ? 'Choose a model in API settings' : 'Choose a provider and model' });
    } else Object.assign(steps[0], { state: 'unknown', detail: 'Couldn’t check · Open API settings' });
    if (cards.status === 'fulfilled') Object.assign(steps[1], { state: cards.value.first ? 'done' : 'missing', detail: cards.value.first ? `${cards.value.total} saved · Choose one below` : 'Import a PNG, JSON, CHARX or link' });
    else Object.assign(steps[1], { state: 'unknown', detail: 'Couldn’t check · Refresh to try again' });
    if (personas.status === 'fulfilled') Object.assign(steps[2], { state: personas.value.first ? 'done' : 'missing', detail: personas.value.first ? `${personas.value.total} saved · Who you play as` : 'Who you play as · You can do this later' });
    else Object.assign(steps[2], { state: 'unknown', detail: 'Couldn’t check · You can do this later' });
    if (prompt.status === 'fulfilled') Object.assign(steps[3], { state: prompt.value ? 'done' : 'missing', detail: prompt.value ? prompt.value.name : 'Choose writing instructions when you want' });
    else Object.assign(steps[3], { state: 'unknown', detail: 'Couldn’t check · Optional' });
    retry.disabled = false; render();
  }
  next.addEventListener('click', () => { if (next.disabled) return; const unfinished = steps.slice(0, 2).find(step => step.state !== 'done'); act(unfinished ? unfinished.action : options.chooseCharacter); });
  retry.addEventListener('click', () => { interacted = true; void refresh(); });
  dismiss.addEventListener('click', () => { if (disposed || !active) return; interacted = true; preferenceEpoch++; persist(true); options.dismissed(); });
  const stop = watchSetup(ctx, () => { if (!disposed && active) { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 250); } });
  render();
  return { root, refresh,
    activate() {
      if (disposed || active) return; active = true; void refresh();
      if (preferenceRead && preferenceHidden && !interacted) { options.dismissed(); return; }
      if (!preferenceRead && ctx.settings?.get) {
        preferenceRead = true; const generation = preferenceEpoch;
        try { void ctx.settings.get(SETUP_DISMISSED_KEY).then(value => { if (disposed || generation !== preferenceEpoch || interacted) return; preferenceHidden = value === true; if (active && preferenceHidden) options.dismissed(); }).catch(() => {}); } catch { /* Optional preference. */ }
      }
    },
    deactivate() { active = false; epoch++; abort?.abort(); clearTimeout(timer); },
    review() { if (disposed) return; interacted = true; preferenceEpoch++; persist(false); if (active) void refresh(); },
    destroy() { disposed = true; active = false; epoch++; abort?.abort(); clearTimeout(timer); stop(); root.remove(); },
  };
}
