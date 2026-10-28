import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';
import { createNativePresetResolution, type Binding, type Scope } from './native-preset-scope';
import { createCustomDefault } from './custom-default';
import { uuid } from './uuid';

type Json = Record<string, unknown>;
type Preset = { id: string; name: string; provider: string; engine: string; parameters: Json; prompts: Json; metadata: Json; prompt_order: Json[]; cache_revision: number };
type Loaded = { scope: Scope; preset: Preset; binding: Binding | null; blockId: string | null; sourceId: string | null };
type PromptMode = 'custom' | 'preset';
type PresetChoice = { id: string; name: string; provider: string };
type PromptBase = { preset: Preset; binding: Binding | null; blockId: string | null; defaultsSourceId?: string };
type EditorHandle = Pick<SpindleModalHandle, 'root' | 'dismiss' | 'onDismiss'>;
export type PromptSettingsOptions = { openPresetManager?: () => void; openIllarinSettings?: () => void; openSamplerGuide?: (presetName: string) => void };
const owner = 'janitor_bridge';
const markerKey = '_janitor_bridge';
const defaultSlug = 'lumiverse-builtin-default-loom';
const defaultPromptId = '019e62a4-7dba-7001-a422-10836ade35dd';
const samplerFields = [
  { key: 'temperature', title: 'Temperature', min: 0, max: 2, step: .01, hint: 'Blank uses 1.0. Native value 0 leaves temperature out of the request.' },
  { key: 'maxTokens', title: 'Max new tokens', min: 1, max: 128000, step: 1, hint: 'Maximum response length. Blank uses the native 16,384 token default.' },
  { key: 'contextSize', title: 'Context size', min: 1024, max: 2097152, step: 1, hint: 'Total prompt budget, including the conversation. Blank uses the model’s context.' },
  { key: 'topP', title: 'Top P', min: 0, max: 1, step: .01, hint: 'Blank or 0 omits Top P. Some providers reject it together with temperature.' },
  { key: 'topK', title: 'Top K', min: 0, max: 500, step: 1, hint: 'Blank omits Top K; 0 explicitly sends 0.' },
  { key: 'repetitionPenalty', title: 'Repetition penalty', min: 0, max: 2, step: .01, hint: 'Provider dependent. Blank or 0 leaves it out of the request.' },
  { key: 'frequencyPenalty', title: 'Frequency penalty', min: 0, max: 2, step: .01, hint: 'Provider dependent. Blank or 0 leaves it out of the request.' },
] as const;
function rec(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}; }
function copy<T>(value: T): T { return structuredClone(value); }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const result = document.createElement(tag); result.className = cls; result.textContent = text; return result;
}
function string(value: unknown) { return typeof value === 'string' && value.trim() ? value : null; }
function block(name: string, marker: string | null = null): Json {
  return { id: uuid(), name, content: '', role: 'system', enabled: true, position: 'pre_history', depth: 0, marker, isLocked: !!marker, color: null, injectionTrigger: [], characterTagTrigger: [], group: null, categoryMode: null };
}
function isNativeDefault(preset: Preset) { return preset.provider === 'loom' && preset.metadata._lumiverse_preset_slug === defaultSlug && rec(preset.metadata[markerKey]).owner !== owner; }
function validPreset(preset: Preset | null): preset is Preset { return !!preset && Array.isArray(preset.prompt_order) && !!preset.parameters && !!preset.prompts && !!preset.metadata; }
function editablePrompt(preset: Preset): string | null {
  const ownedId = string(rec(preset.metadata[markerKey]).blockId);
  if (ownedId && preset.prompt_order.some(b => b.id === ownedId && !b.sealed)) return ownedId;
  if (preset.prompt_order.some(b => b.marker === 'category')) return null;
  const candidates = preset.prompt_order.filter(b => b.enabled !== false && !b.sealed && !b.isLocked && !b.marker && b.role === 'system' && b.position === 'pre_history' && !(Array.isArray(b.variables) && b.variables.length) && !(Array.isArray(b.injectionTrigger) && b.injectionTrigger.length) && !(Array.isArray(b.characterTagTrigger) && b.characterTagTrigger.length));
  return candidates.length === 1 ? string(candidates[0].id) : null;
}

/** A small editor for real native Loom presets and native scope bindings. */
export function createPromptSettings(ctx: SpindleFrontendContext, options: PromptSettingsOptions = {}) {
  let disposed = false;
  let active: { modal: EditorHandle; abort: AbortController; closed: boolean } | undefined;
  let ids = 0;
  function open(initial: 'prompt' | 'generation' = 'prompt') {
    if (disposed) return;
    active?.modal.dismiss();
    const modal = ctx.ui.showModal({ title: 'Prompt and generation settings', width: 720, maxHeight: 880 });
    render(modal, initial, false);
  }
  function mount(target: HTMLElement) {
    if (disposed) return { destroy() {}, refresh() {} };
    active?.modal.dismiss();
    const root = node('section', 'jb-prompt-settings-inline'); root.setAttribute('aria-label', 'Prompt and generation settings'); target.append(root);
    const listeners = new Set<() => void>(); let closed = false;
    const dismiss = () => { if (closed) return; closed = true; for (const listener of [...listeners]) listener(); listeners.clear(); root.remove(); };
    const editor = render({ root, dismiss, onDismiss(listener) { if (!closed) listeners.add(listener); return () => listeners.delete(listener); } }, 'prompt', true);
    return { destroy: dismiss, refresh: editor.refresh };
  }
  function render(modal: EditorHandle, initial: 'prompt' | 'generation', inline: boolean) {
    const session = { modal, abort: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && active === session && !session.closed;
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); if (active === session) active = undefined; });
    modal.root.classList.add('jb-settings');
    const suffix = `jb-prompt-${++ids}`;
    let loaded: Loaded | undefined, saving = false, loading = false, selected = initial, loadVersion = 0;
    let promptDirty = false, prefillDirty = false, samplersDirty = false, nameDirty = false;
    let copyDraft = false, pendingCreated = false, unconfirmedCreate = false;
    const editedSamplers = new Set<string>();
    let promptMode: PromptMode = 'custom', customizeCopy = false, sourceDirty = false, sourceLoading = false, sourceVersion = 0;
    let staged: PromptBase | undefined, choices: PresetChoice[] = [], unresolvedScope: Scope | undefined;
    const heading = node('h2', '', 'Instructions');
    const intro = node('p', 'jb-settings-intro', 'Set how your character responds.');
    const tabs = node('div', 'jb-settings-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Prompt and generation settings');
    const promptPanel = node('div', 'jb-settings-panel'); const generationPanel = node('div', 'jb-settings-panel');
    promptPanel.id = `${suffix}-prompt`; generationPanel.id = `${suffix}-generation`;
    const tabButtons: Array<{ button: HTMLButtonElement; tab: 'prompt' | 'generation' }> = [];
    const button = (label: string, fn: () => void, cls = 'jb-button') => { const result = node('button', cls, label); result.type = 'button'; result.addEventListener('click', fn); return result; };
    for (const [label, tab] of [['Instructions', 'prompt'], ['Generation', 'generation']] as const) {
      const item = button(label, () => show(tab), 'jb-settings-tab'); item.setAttribute('role', 'tab'); item.id = `${suffix}-tab-${tab}`; item.setAttribute('aria-controls', `${suffix}-${tab}`); tabButtons.push({ button: item, tab }); tabs.append(item);
    }
    function show(tab: 'prompt' | 'generation') {
      selected = tab; promptPanel.hidden = !inline && tab !== 'prompt'; generationPanel.hidden = !inline && tab !== 'generation';
      heading.textContent = tab === 'prompt' ? 'Instructions' : 'Generation settings';
      intro.textContent = tab === 'prompt' ? 'Set how your character responds.' : 'Adjust reply length and creativity.';
      for (const item of tabButtons) { item.button.setAttribute('aria-selected', String(item.tab === tab)); item.button.tabIndex = item.tab === tab ? 0 : -1; }
    }
    if (!inline) for (const [panel, tab] of [[promptPanel, 'prompt'], [generationPanel, 'generation']] as const) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `${suffix}-tab-${tab}`); }
    tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const index = tabButtons.findIndex(t => t.button === document.activeElement); if (index < 0) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
      show(tabButtons[next].tab); tabButtons[next].button.focus();
    });
    const scopeInfo = node('p', 'jb-settings-config jb-settings-scope', 'Loading saved settings…');
    function field(title: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, hint: string) {
      const label = node('label', 'jb-settings-field'); const text = node('span', 'jb-settings-label', title); const help = node('small', 'jb-settings-help', hint);
      control.id = `${suffix}-${control.name}`; help.id = `${control.id}-help`; control.setAttribute('aria-describedby', help.id); label.htmlFor = control.id; label.append(text, control, help); return label;
    }
    const prompt = node('textarea', 'jb-settings-textarea jb-settings-prompt'); prompt.name = 'global-prompt'; prompt.rows = 14; prompt.placeholder = 'Write or paste your full prompt here…';
    const promptHelp = 'Write a short instruction or paste a long prompt. Your character details and conversation stay in the native preset.';
    const prefill = node('textarea', 'jb-settings-textarea jb-settings-prefill'); prefill.name = 'assistant-prefill'; prefill.rows = 3; prefill.placeholder = 'Optional beginning of the assistant’s reply';
    prompt.addEventListener('input', () => { promptDirty = true; }); prefill.addEventListener('input', () => { prefillDirty = true; });
    const promptDisclosure = inline ? node('details', 'jb-settings-card jb-settings-global-prompt') : undefined;
    const promptCard = promptDisclosure ?? node('section', 'jb-settings-card');
    if (promptDisclosure) { const summary = node('summary', '', 'Global prompt'); summary.append(node('small', 'jb-settings-help', 'Optional')); promptDisclosure.append(summary); }
    const sourceChoice = node('select', 'jb-settings-select jb-settings-prompt-source'); sourceChoice.name = 'prompt-source';
    for (const [value, title] of [['custom', 'Custom prompt · Default base'], ['preset', 'Saved preset']] as const) { const option = node('option', '', title); option.value = value; sourceChoice.append(option); }
    const presetChoice = node('select', 'jb-settings-select jb-settings-preset-select'); presetChoice.name = 'prompt-preset';
    const presetField = field('Saved preset', presetChoice, 'Use an imported or saved Loom preset directly, including its linked regex. No duplicate is created.');
    presetField.hidden = true;
    const sourceHelp = node('p', 'jb-settings-help jb-settings-prompt-source-help'); sourceHelp.setAttribute('aria-live', 'polite');
    const sourceControls = node('div', 'jb-settings-prompt-source-controls'); sourceControls.append(field('Prompt source', sourceChoice, 'Use one text prompt, or keep a complete Lumiverse preset.'), presetField, sourceHelp);
    const promptName = node('input', 'jb-settings-input'); promptName.name = 'prompt-name'; promptName.maxLength = 200; promptName.placeholder = 'e.g. Slow-burn roleplay'; promptName.autocomplete = 'off';
    promptName.addEventListener('input', () => { nameDirty = true; promptName.removeAttribute('aria-invalid'); });
    const nameField = field('Prompt name', promptName, 'Find this name under Saved preset to reuse it in another chat. Save as new prompt keeps the previous version and uses the new one here.'); nameField.classList.add('jb-settings-prompt-name');
    const saveNew = button('Save as new prompt', () => { void saveSettings(true); }, 'jb-button jb-settings-save-new');
    saveNew.title = 'Save a separate named version and use it for this chat or connection.';
    const promptField = field('Global prompt', prompt, promptHelp); promptCard.append(sourceControls, nameField, promptField, saveNew);
    const manager = options.openPresetManager ? button('Manage / import presets', () => { if (!saving && !loading && !sourceLoading) options.openPresetManager?.(); }) : undefined;
    if (manager) sourceControls.append(manager);
    function customizePresetCopy() {
      if (!loaded || saving || loading || sourceLoading || promptMode !== 'preset' || customizeCopy) return;
      customizeCopy = true; copyDraft = true; nameDirty = false; sourceDirty = true; renderSource(staged ?? loaded, true); lock(false);
      message('You are editing a separate copy. The original stays intact. Preset-linked regex stays with the original; use Saved preset unchanged to keep that integration.', 'warning');
    }
    const customize = button('Customize a copy', customizePresetCopy);
    customize.hidden = true; sourceControls.append(customize);
    const promptGuide = node('details', 'jb-settings-details jb-settings-prompt-help');
    promptGuide.append(node('summary', '', 'How prompts and presets work'), node('p', 'jb-settings-help', 'Custom prompt starts from Lumiverse’s built-in Default preset. Paste your instructions in the large box; the character, persona, and conversation keep their normal places.'), node('p', 'jb-settings-help', 'Saved preset uses the original native preset unchanged, keeping its prompts, variables, generation settings, and linked regex. Use Manage / import presets to edit it in Lumiverse. Customize a copy is optional and creates a separate preset only when saved; preset-linked regex remains with the original.'), node('p', 'jb-settings-help', 'For a preset JSON from Discord, use Manage / import presets, then the Loom menu’s Import Loom JSON or Import Legacy Preset option. For Illarin, connect this Lumiverse instance in Illarin settings, then send the preset from Illarin. Choose the imported preset here afterward.'), node('p', 'jb-settings-help', 'Choosing a source only prepares a draft. Save settings applies the selected preset to this scope. Custom prompts and explicitly customized copies keep the source preset intact.'));
    const examples = node('details', 'jb-settings-details jb-settings-prompt-examples'); examples.append(node('summary', '', 'Prompt examples · Optional'), node('p', 'jb-settings-help', 'Append an example to your current text, then edit it to suit your story.'));
    const illarin = options.openIllarinSettings ? button('Connect Illarin', () => { if (!saving && !loading && !sourceLoading) options.openIllarinSettings?.(); }) : undefined;
    if (illarin) promptGuide.append(illarin);
    const exampleButtons: HTMLButtonElement[] = [];
    for (const [title, text] of [['Append writing style example', 'Write vivid, character-focused replies. Use dialogue and concrete actions, and leave room for my response.'], ['Append roleplay boundaries example', 'Write only for {{char}} and supporting characters. Let {{user}} decide their own words, thoughts, and actions.']] as const) {
      const example = button(title, () => { if (prompt.disabled) return; prompt.value = [prompt.value, text].filter(Boolean).join('\n\n'); promptDirty = true; if (promptDisclosure) promptDisclosure.open = true; message('Example appended to your draft. Review it before saving.'); prompt.focus(); }); exampleButtons.push(example); examples.append(example);
    }
    promptGuide.append(examples); promptCard.append(promptGuide);
    const replyPrefix = node('details', 'jb-settings-details jb-settings-prefill-options');
    replyPrefix.append(node('summary', '', 'Reply prefix · Optional'), field('Assistant prefill', prefill, 'Text to begin each reply. Leave empty to let the character start naturally.'));
    if (inline) promptCard.append(replyPrefix);
    promptPanel.append(promptCard); if (!inline) promptPanel.append(replyPrefix);
    const nativeInfo = node('p', 'jb-settings-help', 'Your character, persona, and chat memory stay included.'); promptCard.append(nativeInfo);
    const rawLabel = node('label', 'jb-settings-checkbox jb-settings-toggle-row'); const raw = node('input'); raw.type = 'checkbox'; raw.name = 'enable-chat-preset'; rawLabel.append(raw, node('span', '', 'Use a native preset for this raw test chat')); rawLabel.hidden = true;
    const enabledLabel = node('label', 'jb-settings-checkbox jb-settings-toggle-row'); const enabled = node('input'); enabled.type = 'checkbox'; enabled.name = 'sampler-overrides'; enabled.addEventListener('change', () => { samplersDirty = true; });
    const enabledCopy = node('span', '', 'Use these generation controls'); enabledCopy.append(node('small', 'jb-settings-help', 'Turn on to use the values below for new replies.')); enabledLabel.append(enabled, enabledCopy);
    const samplerGuide = node('section', 'jb-sampler-edit-guide'); samplerGuide.hidden = true; samplerGuide.setAttribute('aria-label', 'How to change preset generation settings');
    const samplerGuideTitle = node('h3'), samplerGuideText = node('p', 'jb-settings-help'), samplerGuideSteps = node('ol', 'jb-sampler-guide-steps');
    samplerGuideSteps.append(node('li', '', 'Turn on Use these generation controls.'), node('li', '', 'Adjust temperature, reply length or context below.'), node('li', '', `Choose ${inline ? 'Save prompt & generation' : 'Save settings'} to apply the copy.`));
    const samplerGuideActions = node('div', 'jb-sampler-guide-actions');
    const samplerNative = options.openSamplerGuide ? button('Edit preset samplers', () => {
      if (current() && loaded && !saving && !loading && !sourceLoading) options.openSamplerGuide?.((staged ?? loaded).preset.name);
    }) : undefined;
    const samplerCopy = button('Customize a copy here', () => {
      customizePresetCopy(); if (!useSavedOriginal() && current()) { show('generation'); enabled.focus({ preventScroll: true }); }
    });
    if (samplerNative) samplerGuideActions.append(samplerNative); samplerGuideActions.append(samplerCopy);
    const samplerCopyNote = node('p', 'jb-settings-help', 'A copy leaves the original unchanged. Preset-linked regex stays with the original.');
    samplerGuide.append(samplerGuideTitle, samplerGuideText, samplerGuideSteps, samplerGuideActions, samplerCopyNote);
    const generationCard = node('section', 'jb-settings-card'); if (inline) generationCard.append(node('h2', '', 'Generation settings')); generationCard.append(enabledLabel);
    const grid = node('div', 'jb-settings-grid'); const inputs = new Map<string, HTMLInputElement>(); const sliders = new Map<string, HTMLInputElement>();
    const advancedGeneration = node('details', 'jb-settings-advanced jb-settings-generation-advanced');
    const advancedGrid = node('div', 'jb-settings-grid');
    advancedGeneration.append(node('summary', '', 'Advanced generation controls'), advancedGrid);
    const basicHints: Record<string, string> = { temperature: 'Lower is steadier; higher adds variety.', maxTokens: 'How long a reply can be.', contextSize: 'How much conversation the model can use.' };
    for (const item of samplerFields) {
      const input = node('input', 'jb-settings-input'); input.type = 'number'; input.name = item.key; input.min = String(item.min); input.max = String(item.max); input.step = String(item.step); input.placeholder = 'Default'; input.title = item.hint; input.addEventListener('input', () => { samplersDirty = true; editedSamplers.add(item.key); input.removeAttribute('aria-invalid'); }); inputs.set(item.key, input);
      const label = field(item.title, input, basicHints[item.key] || item.hint);
      let wrapper: HTMLElement = label;
      if (inline && basicHints[item.key]) {
        const slider = node('input', 'jb-settings-range'); slider.type = 'range'; slider.name = `${item.key}-slider`; slider.min = String(item.min); slider.step = String(item.step); slider.setAttribute('aria-label', `${item.title} slider`); slider.setAttribute('aria-describedby', `${input.id}-help`);
        const control = node('span', 'jb-settings-slider-control'); control.append(slider, input); sliders.set(item.key, slider);
        const title = node('label', 'jb-settings-label', item.title); title.htmlFor = input.id;
        wrapper = node('div', 'jb-settings-field jb-settings-slider-field'); wrapper.append(title, control, label.querySelector('small')!);
        slider.addEventListener('input', () => { input.value = slider.value; samplersDirty = true; editedSamplers.add(item.key); input.removeAttribute('aria-invalid'); syncSlider(item.key); });
        input.addEventListener('input', () => syncSlider(item.key));
      }
      (basicHints[item.key] ? grid : advancedGrid).append(wrapper);
    }
    advancedGeneration.append(node('p', 'jb-settings-help', 'Blank temperature uses 1.0; 0 omits it from the request. Blank max new tokens uses 16,384. Blank context size uses the model’s context. Providers support different controls. Existing advanced options, model profiles, and custom request body remain intact; a custom body can override these values.'));
    generationCard.append(grid); generationPanel.append(samplerGuide, generationCard, advancedGeneration);
    const advanced = node('details', 'jb-settings-advanced jb-settings-details');
    const presetInfo = node('p', 'jb-settings-help');
    advanced.append(node('summary', '', 'How these settings are saved'), presetInfo, node('p', 'jb-settings-help', 'Saved preset binds the original preset without creating or updating a preset row. Custom prompt and Customize a copy save a separate native Loom preset; later edits reuse that copy. This chat uses a chat binding; an API configuration uses a connection binding. Chat, persona, and character bindings take priority over an API configuration. No universal default is replaced. If no preset was selected, this API configuration receives the chosen preset as its fallback.'), node('p', 'jb-settings-help', 'Assistant prefill follows your connection’s existing reply prefix. Continue uses the message being continued instead.'));
    const status = node('p', 'jb-settings-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const requestButton = button('Enable permissions', () => { void enablePermissions(); }); requestButton.hidden = true;
    const reloadButton = button('Reload saved settings', () => { void load(); }, 'jb-settings-cancel');
    const cancel = button('Close', () => modal.dismiss(), 'jb-settings-cancel'); const save = button('Save settings', () => { void saveSettings(); }, 'jb-settings-save');
    const actions = node('div', 'jb-settings-actions'); actions.append(node('small', 'jb-settings-help', 'Changes apply to new replies.'), requestButton);
    if (inline) advanced.append(reloadButton); else actions.append(reloadButton, cancel);
    actions.append(save);
    if (!inline) modal.root.append(tabs, heading, intro);
    modal.root.append(scopeInfo, rawLabel, promptPanel, generationPanel, advanced, status, actions); show(selected);
    if (inline) actions.prepend(status);
    const editable = [prompt, promptName, prefill, enabled, raw, sourceChoice, presetChoice, ...exampleButtons, ...inputs.values(), ...sliders.values(), ...(manager ? [manager] : []), ...(illarin ? [illarin] : [])];
    function syncSlider(key: string) {
      const slider = sliders.get(key), item = samplerFields.find(field => field.key === key); if (!slider || !item) return;
      const value = inputs.get(key)!.value.trim() === '' ? null : Number(inputs.get(key)!.value);
      const usualMax = key === 'maxTokens' ? 16384 : key === 'contextSize' ? 131072 : item.max;
      slider.max = String(Math.min(item.max, Math.max(usualMax, Number(slider.max) || usualMax, value !== null && Number.isFinite(value) ? value : usualMax)));
      // Range inputs clamp their displayed value. Never copy that value back
      // while loading or typing: the number field retains the native value.
      slider.value = String(value ?? (key === 'temperature' ? 1 : key === 'maxTokens' ? 16384 : 131072));
      slider.setAttribute('aria-valuetext', value === null ? 'Default' : String(value));
    }
    function useSavedOriginal() { return promptMode === 'preset' && !customizeCopy; }
    function lock(value: boolean) {
      editable.forEach(input => input.disabled = value);
      if (useSavedOriginal()) [prompt, promptName, prefill, enabled, ...exampleButtons, ...inputs.values(), ...sliders.values()].forEach(input => input.disabled = true);
      presetChoice.disabled = value || promptMode !== 'preset'; customize.disabled = value || loading || saving || sourceLoading;
      samplerCopy.disabled = value || loading || saving || sourceLoading; if (samplerNative) samplerNative.disabled = value || loading || saving || sourceLoading;
      if (manager) manager.disabled = saving || loading || sourceLoading; if (illarin) illarin.disabled = saving || loading || sourceLoading;
      save.disabled = value || unconfirmedCreate; saveNew.disabled = value || unconfirmedCreate || useSavedOriginal();
      saveNew.textContent = pendingCreated ? 'Finish saving prompt' : 'Save as new prompt';
      reloadButton.disabled = saving || sourceLoading; modal.root.setAttribute('aria-busy', String(saving || sourceLoading));
    }
    function message(text: string, tone = '') { status.textContent = text; status.dataset.tone = tone; }
    modal.root.addEventListener('input', () => { if (status.dataset.tone === 'success') message(''); });
    function requiredPermissions() { return loaded?.scope.kind === 'chat' || (!!ctx.getActiveChat().chatId && location.pathname.startsWith('/chat/')) ? ['presets', 'chats', 'generation'] : ['presets', 'generation']; }
    async function permissions() {
      const granted = await ctx.permissions.getGranted(); if (!current()) return false;
      const missing = requiredPermissions().filter(permission => !granted.includes(permission));
      requestButton.hidden = !missing.length;
      if (missing.length) { message(`Enable ${missing.join(' and ')} permission to read and save these native settings.`, 'warning'); return false; }
      return true;
    }
    async function enablePermissions() {
      requestButton.disabled = true;
      try { await ctx.permissions.request(requiredPermissions(), { reason: 'Read and save your native prompt preset and its chat or API configuration binding.' }); if (current()) await load(); }
      catch { if (current()) message('Permission was not enabled. Your existing native settings are unchanged.', 'warning'); }
      finally { if (current()) requestButton.disabled = false; }
    }
    async function api<T>(path: string, method = 'GET', body?: unknown, optional = false): Promise<T | null> {
      if (!current()) throw new DOMException('Closed', 'AbortError');
      if (method !== 'GET' && !await permissions()) throw new Error('permission');
      if (!current()) throw new DOMException('Closed', 'AbortError');
      const response = await fetch(`/api/v1${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: session.abort.signal, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (optional && response.status === 404) return null;
      if (!response.ok) { const error = new Error(response.status === 409 ? 'conflict' : `request-${response.status}`); throw error; }
      return await response.json() as T;
    }
    async function loadChoices() {
      const rows: PresetChoice[] = []; let offset = 0;
      while (current()) {
        const page = await api<Json>(`/presets/registry?provider=loom&limit=100&offset=${offset}`);
        if (!Array.isArray(page?.data) || typeof page.total !== 'number') throw new Error('invalid-registry');
        for (const value of page.data) { const row = rec(value); if (typeof row.id === 'string' && typeof row.name === 'string' && row.provider === 'loom') rows.push({ id: row.id, name: row.name, provider: row.provider }); }
        offset += page.data.length;
        if (offset >= page.total) { choices = rows; return; }
        if (!page.data.length) throw new Error('incomplete-registry');
      }
    }
    async function getDefault(): Promise<Preset> {
      // Registry rows omit metadata, and the native Default may be renamed.
      // Inspect every full-record page so a copied slug cannot select a wrong base.
      try {
        let offset = 0; const found: Preset[] = [];
        while (current()) {
          const page = await api<Json>(`/presets?limit=100&offset=${offset}`);
          if (!Array.isArray(page?.data) || typeof page.total !== 'number') throw new Error('invalid-presets');
          for (const candidate of page.data) if (validPreset(candidate as Preset) && isNativeDefault(candidate as Preset)) found.push(candidate as Preset);
          offset += page.data.length;
          if (offset >= page.total) break;
          if (!page.data.length) throw new Error('incomplete-presets');
        }
        if (found.length === 1 && found[0].prompt_order.length) return found[0];
      } catch (error) {
        if (!current()) throw error;
      }
      // Deleted, duplicated or temporarily unreadable built-ins must not make
      // the paste-your-own-prompt editor depend on another installed preset.
      // This draft has no native ID: opening it never writes or rebinds anything.
      return createCustomDefault();
    }
    function sourceBlock(preset: Preset, binding: Binding | null, mode: PromptMode) {
      const projection: Preset = { ...preset, prompt_order: preset.prompt_order.map(b => ({ ...b, ...(Object.hasOwn(binding?.block_states ?? {}, String(b.id)) ? { enabled: binding!.block_states[String(b.id)] } : {}) })) };
      if (mode === 'custom' && (isNativeDefault(preset) || !preset.id)) {
        const main = projection.prompt_order.find(b => b.id === defaultPromptId && !b.sealed && !b.marker && !b.isLocked && b.enabled !== false);
        if (main) return String(main.id);
      }
      return editablePrompt(projection);
    }
    function renderSource(base: PromptBase, preserveDraft = false) {
      sourceChoice.value = promptMode; presetField.hidden = promptMode !== 'preset';
      nameField.hidden = saveNew.hidden = useSavedOriginal();
      if (!preserveDraft || !nameDirty) promptName.value = copyDraft ? `${base.preset.name.slice(0, 193)} (copy)` : rec(base.preset.metadata[markerKey]).owner === owner ? base.preset.name : promptMode === 'preset' ? `${base.preset.name.slice(0, 193)} (copy)` : 'My prompt';
      const visible = new Map(choices.map(choice => [choice.id, choice])); if (base.preset.id) visible.set(base.preset.id, base.preset);
      presetChoice.replaceChildren(...[...visible.values()].map(choice => { const option = node('option', '', choice.name); option.value = choice.id; return option; })); presetChoice.value = base.preset.id || choices[0]?.id || '';
      sourceHelp.textContent = promptMode === 'custom' ? !base.preset.id ? 'Lumiverse’s installed Default could not be used, so a standard base is prepared. Write or paste your own prompt; character details, memory and chat history stay included. It is saved only when you choose Save settings.' : base.preset.metadata._janiverse_standard_base ? 'Your own prompt, using a standard base with character details, memory and chat history included. Save settings to apply your changes.' : 'Your own prompt, using Lumiverse’s native Default layout. The original Default preset stays intact.' : useSavedOriginal() ? `Using “${base.preset.name}” directly, including its linked regex. Settings below show its saved values. No duplicate is created.` : `Editing a separate “${base.preset.name}” copy. Preset-linked regex stays with the original.`;
      customize.hidden = promptMode !== 'preset' || customizeCopy;
      samplerGuide.hidden = promptMode !== 'preset' || customizeCopy && !copyDraft && !pendingCreated; samplerGuideSteps.hidden = useSavedOriginal(); samplerGuideActions.hidden = !useSavedOriginal();
      samplerGuideTitle.textContent = useSavedOriginal() ? 'These values come from your preset' : 'Adjust your copy, then save';
      samplerGuideText.textContent = useSavedOriginal() ? `“${base.preset.name}” is read-only here. Edit the original in Preset → Samplers (affects other chats using it), or customize a copy for ${loaded?.scope.kind === 'connection' ? 'this API configuration' : 'this chat'}.` : `Editing “${promptName.value}”. Nothing changes until you save.`;
      nativeInfo.textContent = useSavedOriginal() ? 'The saved preset is used unchanged. Edit the original in Manage / import presets, or choose Customize a copy.' : 'Your character, persona, and chat memory stay included.';
      promptField.querySelector('.jb-settings-label')!.textContent = promptMode === 'custom' ? 'Your prompt' : !base.blockId ? 'Additional instructions' : 'Global prompt';
      if (!preserveDraft || !promptDirty) { const target = base.preset.prompt_order.find(b => b.id === base.blockId); prompt.value = typeof target?.content === 'string' ? target.content : ''; }
      if (!preserveDraft || !prefillDirty) prefill.value = typeof rec(base.preset.prompts.completionSettings).assistantPrefill === 'string' ? String(rec(base.preset.prompts.completionSettings).assistantPrefill) : '';
      replyPrefix.open = !!prefill.value;
      if (!preserveDraft || !samplersDirty) {
        editedSamplers.clear();
        const sampler = rec(base.preset.parameters.samplerOverrides); enabled.checked = sampler.enabled === true;
        for (const item of samplerFields) { const input = inputs.get(item.key)!; input.value = typeof sampler[item.key] === 'number' ? String(sampler[item.key]) : ''; syncSlider(item.key); }
      }
    }
    async function chooseSource(mode: PromptMode, presetId: string) {
      if (!current() || (!loaded && !unresolvedScope) || saving || loading) return;
      const version = ++sourceVersion; sourceLoading = true; lock(true);
      try {
        let preset = mode === 'custom' ? await getDefault() : await api<Preset>(`/presets/${encodeURIComponent(presetId)}`);
        if (!validPreset(preset) || preset.provider !== 'loom') throw new Error('invalid-preset');
        let binding: Binding | null = null;
        if (preset.id) {
          try { binding = preset.id === loaded?.sourceId ? loaded.binding : await api<Binding>(`/preset-profiles/defaults?preset_id=${encodeURIComponent(preset.id)}`, 'GET', undefined, true); }
          catch (error) { if (mode !== 'custom' || !current()) throw error; preset = createCustomDefault(); }
        }
        if (!current() || version !== sourceVersion) return;
        promptMode = mode; customizeCopy = false; copyDraft = pendingCreated = false; staged = { preset, binding, blockId: sourceBlock(preset, binding, mode), ...(preset.id && preset.id !== loaded?.sourceId ? { defaultsSourceId: preset.id } : {}) }; sourceDirty = true;
        if (!loaded) loaded = { scope: unresolvedScope!, preset, binding: null, blockId: staged.blockId, sourceId: null };
        if (mode === 'preset') promptDirty = prefillDirty = samplersDirty = nameDirty = false;
        renderSource(staged, mode !== 'preset');
        message(mode === 'preset' ? 'Saved preset prepared unchanged. Save settings to use it, or choose Customize a copy to edit it.' : `${preset.id ? 'Prompt source prepared.' : 'The installed Default could not be used. A standard base is prepared.'} Save settings to use it.${promptDirty || prefillDirty || samplersDirty ? ' Your unsaved text and generation edits were kept.' : ''}`, 'warning');
      } catch (error) {
        if (current() && version === sourceVersion) { sourceChoice.value = promptMode; presetChoice.value = (staged?.preset ?? loaded?.preset)?.id || choices[0]?.id || ''; message((error as Error).message === 'missing-default' ? 'Lumiverse’s built-in Default preset is unavailable. Choose a native preset instead.' : (error as Error).message === 'ambiguous-default' ? 'More than one preset carries Lumiverse’s Default identity. Choose a specific native preset instead.' : 'Could not load that prompt source. Your current draft is still here.', 'error'); }
      } finally { if (current() && version === sourceVersion) { sourceLoading = false; lock(!loaded); } }
    }
    sourceChoice.addEventListener('change', () => { void chooseSource(sourceChoice.value === 'custom' ? 'custom' : 'preset', presetChoice.value); });
    presetChoice.addEventListener('change', () => { void chooseSource('preset', presetChoice.value); });
    const { getScope, effective } = createNativePresetResolution(ctx, api);
    async function load() {
      const version = ++loadVersion; const loadCurrent = () => current() && version === loadVersion;
      loading = true; let chooseFallback = false;
      lock(true); loaded = undefined; unresolvedScope = undefined; staged = undefined; sourceDirty = false; copyDraft = pendingCreated = unconfirmedCreate = false; message('');
      try {
        if (!await permissions() || !loadCurrent()) return;
        const scope = await getScope(); const resolved = scope.raw ? { preset_id: null, binding: null } : await effective(scope);
        if (!loadCurrent()) return;
        unresolvedScope = scope;
        scopeInfo.textContent = `Applies to: ${scope.label}`; rawLabel.hidden = !scope.raw; raw.checked = false;
        try { await loadChoices(); } catch { choices = []; }
        if (!loadCurrent()) return;
        let preset = resolved.preset_id ? await api<Preset>(`/presets/${encodeURIComponent(resolved.preset_id)}`) : await getDefault();
        if (!loadCurrent() || !preset) return;
        if (!validPreset(preset) || preset.provider !== 'loom') throw new Error('invalid-preset');
        // An empty hierarchy uses legacy/raw assembly. Adding just one text block
        // would drop that fallback's history; use the real native Default layout.
        if (!preset.prompt_order.length) preset = { ...preset, prompt_order: copy((await getDefault()).prompt_order) };
        if (!loadCurrent()) return;
        const owned = rec(preset.metadata[markerKey]);
        promptMode = !preset.id || isNativeDefault(preset) || owned.owner === owner && owned.promptMode === 'custom' ? 'custom' : 'preset';
        customizeCopy = owned.owner === owner && owned.scope === `${scope.kind}:${scope.id}`;
        loaded = { scope, preset, binding: resolved.binding, blockId: sourceBlock(preset, resolved.binding, promptMode), sourceId: resolved.preset_id };
        nativeInfo.textContent = 'Your character, persona, and chat memory stay included.';
        renderSource(loaded);
        scopeInfo.textContent = `Applies to: ${scope.label}`; presetInfo.textContent = `Currently applied preset: ${preset.id ? preset.name : 'Created on first save'}`;
        rawLabel.hidden = !scope.raw; raw.checked = false; promptDirty = prefillDirty = samplersDirty = nameDirty = false; lock(false);
        if (scope.raw) message('This temporary test chat bypasses presets. Tick “Use a native preset” to apply these settings.', 'warning');
        else if (!loaded.blockId && !useSavedOriginal()) {
          nativeInfo.textContent = 'These instructions are added to your existing preset. Your character, persona, and chat memory stay included.';
          message('Additional instructions. Your existing instructions are kept.');
        }
      } catch (error) {
        if (loadCurrent()) {
          const why = (error as Error).message;
          if (unresolvedScope && choices.length && ['missing-default', 'ambiguous-default'].includes(why)) {
            presetChoice.replaceChildren(...choices.map(choice => { const option = node('option', '', choice.name); option.value = choice.id; return option; })); chooseFallback = true;
          }
          if (manager) manager.disabled = false;
          message(why === 'no-connection' ? 'Open API Settings to add or select a connection, then reload saved settings.' : why === 'missing-default' ? 'Lumiverse’s built-in Default preset is unavailable. Choose a native preset instead.' : why === 'ambiguous-default' ? 'More than one preset carries Lumiverse’s Default identity. Choose a specific native preset instead.' : 'Could not load native settings. Try reloading saved settings.', 'error');
        }
      } finally {
        if (loadCurrent()) { loading = false; lock(!loaded); if (chooseFallback) sourceChoice.disabled = false; }
      }
    }
    async function saveSettings(asNew = false) {
      if (!current() || !loaded || loading || saving || sourceLoading || unconfirmedCreate || asNew && useSavedOriginal()) return;
      if (loaded.scope.raw && !raw.checked) { message('Tick “Use a native preset” to apply settings to this raw test chat.', 'warning'); raw.focus(); return; }
      const name = promptName.value.trim();
      if (!useSavedOriginal() && (!name || name.length > 200)) {
        show('prompt'); if (promptDisclosure) promptDisclosure.open = true;
        promptName.setAttribute('aria-invalid', 'true'); promptName.focus(); message('Give your prompt a name (up to 200 characters).', 'error'); return;
      }
      const values: Json = {};
      if (!useSavedOriginal() && samplersDirty) for (const item of samplerFields) {
        if (!editedSamplers.has(item.key)) continue;
        const input = inputs.get(item.key)!; const value = input.value.trim() === '' ? null : Number(input.value);
        if (value !== null && (!Number.isFinite(value) || value < item.min || value > item.max || (item.step === 1 && !Number.isInteger(value)))) { show('generation'); if (!basicHints[item.key]) advancedGeneration.open = true; input.setAttribute('aria-invalid', 'true'); message(`${item.title} must be ${item.step === 1 ? 'a whole number ' : ''}between ${item.min} and ${item.max}.`, 'error'); input.focus(); return; }
        values[item.key] = value;
      }
      saving = true; lock(true); message(useSavedOriginal() ? 'Applying the saved preset…' : 'Saving to your native preset…');
      try {
        if (!await permissions() || !current()) return;
        const visibleChatId = location.pathname.startsWith('/chat/') ? ctx.getActiveChat().chatId : null;
        if ((loaded.scope.kind === 'chat' && visibleChatId !== loaded.scope.id) || (loaded.scope.kind === 'connection' && visibleChatId)) throw new Error('scope-changed');
        const scopeNow = await getScope();
        if (scopeNow.kind !== loaded.scope.kind || scopeNow.id !== loaded.scope.id || scopeNow.connectionId !== loaded.scope.connectionId || scopeNow.raw !== loaded.scope.raw || scopeNow.temporary !== loaded.scope.temporary) throw new Error('scope-changed');
        if (!loaded.scope.raw) {
          const effectiveNow = await effective(loaded.scope);
          if (effectiveNow.preset_id !== loaded.sourceId || JSON.stringify(effectiveNow.binding) !== JSON.stringify(loaded.binding)) throw new Error('conflict');
        }
        const base = staged ?? loaded; const sourceBinding = base.binding;
        if (staged?.defaultsSourceId) {
          const latestDefaults = await api<Binding>(`/preset-profiles/defaults?preset_id=${encodeURIComponent(staged.defaultsSourceId)}`, 'GET', undefined, true);
          if (JSON.stringify(latestDefaults) !== JSON.stringify(staged.binding)) throw new Error('conflict');
        }
        if (staged && loaded.preset.id && loaded.preset.id !== staged.preset.id) {
          const original = await api<Preset>(`/presets/${encodeURIComponent(loaded.preset.id)}`);
          if (!original || original.cache_revision !== loaded.preset.cache_revision) throw new Error('conflict');
        }
        let preset = base.preset;
        if (preset.id) {
          const fresh = await api<Preset>(`/presets/${encodeURIComponent(preset.id)}`);
          if (!fresh || fresh.cache_revision !== preset.cache_revision) throw new Error('conflict');
          preset = fresh;
        }
        if (useSavedOriginal() && !sourceDirty && !loaded.scope.raw) {
          // Nothing was changed. Keep native inheritance and linked-default
          // behavior rather than unnecessarily capturing another scope binding.
          message(loaded.scope.kind === 'chat' ? 'This conversation already uses the saved preset unchanged.' : 'This API configuration already uses the saved preset unchanged.', 'success');
          return;
        }
        const next = copy(preset); const owned = rec(next.metadata[markerKey]);
        if (!useSavedOriginal() && !next.prompt_order.length) next.prompt_order = copy((await getDefault()).prompt_order);
        // Binding state remains authoritative on every Save, including later
        // edits after the native editor changed a checkbox in this copy.
        next.prompt_order = next.prompt_order.map(b => ({ ...b, ...(Object.hasOwn(sourceBinding?.block_states ?? {}, String(b.id)) ? { enabled: sourceBinding!.block_states[String(b.id)] } : {}) }));
        const scopeKey = `${loaded.scope.kind}:${loaded.scope.id}`;
        const reuse = (pendingCreated || !asNew && !copyDraft) && owned.owner === owner && owned.scope === scopeKey;
        if (!reuse) {
          next.id = '';
          // Preserve every native block/property and effective profile state, including variables.
          const { _lumiverse_preset_slug: builtinIdentity, ...metadata } = next.metadata;
          next.metadata = { ...metadata, _lumiverse_install_source: 'local', isDefault: false };
        }
        if (!useSavedOriginal()) next.name = name;
        let promptId = base.blockId;
        if (!promptId && (promptDirty || prompt.value)) {
          const section = { ...block('Janiverse'), marker: 'category', categoryMode: 'checkbox', isLocked: false };
          const added: Json = { ...block('Global prompt'), content: prompt.value };
          // Leading category isolates the new instructions from any radio category in the source.
          next.prompt_order.unshift(section, added); promptId = String(added.id);
        } else if (promptId && promptDirty) {
          next.prompt_order = next.prompt_order.map(b => b.id === promptId ? { ...b, content: prompt.value } : b);
        }
        if (prefillDirty) next.prompts = { ...next.prompts, completionSettings: { ...rec(next.prompts.completionSettings), assistantPrefill: prefill.value } };
        if (samplersDirty) next.parameters = { ...next.parameters, samplerOverrides: { ...rec(next.parameters.samplerOverrides), ...values, enabled: enabled.checked } };
        next.metadata = { ...next.metadata, [markerKey]: { ...owned, owner, scope: scopeKey, sourcePresetId: reuse ? owned.sourcePresetId : base.preset.id || null, blockId: promptId, promptMode } };
        const body = { name: next.name, provider: next.provider, engine: next.engine, parameters: next.parameters, prompts: next.prompts, metadata: next.metadata, prompt_order: next.prompt_order };
        const beforeWrite = await getScope();
        if (beforeWrite.kind !== loaded.scope.kind || beforeWrite.id !== loaded.scope.id || beforeWrite.connectionId !== loaded.scope.connectionId || beforeWrite.raw !== loaded.scope.raw || beforeWrite.temporary !== loaded.scope.temporary) throw new Error('scope-changed');
        if (!loaded.scope.raw) {
          const effectiveNow = await effective(loaded.scope);
          if (effectiveNow.preset_id !== loaded.sourceId || JSON.stringify(effectiveNow.binding) !== JSON.stringify(loaded.binding)) throw new Error('conflict');
        }
        // A normal saved preset keeps its identity. Regex, prompt activation,
        // future source updates and native integrations may be linked to this ID.
        // Creating or updating a preset requires an explicit custom/copy edit.
        let saved: Preset | null;
        const creating = !useSavedOriginal() && !next.id;
        try {
          saved = useSavedOriginal() ? preset : next.id ? await api<Preset>(`/presets/${encodeURIComponent(next.id)}`, 'PUT', { ...body, expected_cache_revision: preset.cache_revision }) : await api<Preset>('/presets', 'POST', body);
          if (creating && (!validPreset(saved) || typeof saved.id !== 'string' || !saved.id)) throw new Error('invalid-save');
        } catch (error) {
          if (creating && !['permission', 'conflict', 'request-400', 'request-401', 'request-403', 'request-404', 'request-422'].includes((error as Error).message)) { unconfirmedCreate = true; throw new Error('unconfirmed-create'); }
          throw error;
        }
        if (!saved || !current()) return;
        if (creating) { pendingCreated = true; copyDraft = false; }
        choices = [...choices.filter(choice => choice.id !== saved.id), { id: saved.id, name: saved.name, provider: saved.provider }];
        // Keep the new row for retry if the subsequent binding request fails.
        loaded.preset = saved; loaded.blockId = promptId;
        if (staged) staged = { ...staged, preset: saved, binding: sourceBinding, blockId: promptId };
        if (!await permissions() || !current()) return;
        const states = Object.fromEntries(saved.prompt_order.filter(b => typeof b.id === 'string').map(b => [String(b.id), Object.hasOwn(sourceBinding?.block_states ?? {}, String(b.id)) ? sourceBinding!.block_states[String(b.id)] : b.enabled === true]));
        const bindingBody = { preset_id: saved.id, block_states: states, ...(sourceBinding?.prompt_variables ? { prompt_variables: sourceBinding.prompt_variables } : {}) };
        const binding = await api<Binding>(`/preset-profiles/${loaded.scope.kind}/${encodeURIComponent(loaded.scope.id)}`, 'PUT', bindingBody);
        if (!current()) return;
        loaded.binding = binding; loaded.sourceId = saved.id;
        if (loaded.scope.connectionId && !string(ctx.state?.get('loom.activePresetId'))) {
          const connection = await api<Json>(`/connections/${encodeURIComponent(loaded.scope.connectionId)}`);
          if (!string(connection?.preset_id)) await api<Json>(`/connections/${encodeURIComponent(loaded.scope.connectionId)}`, 'PUT', { preset_id: saved.id });
        }
        if (!current()) return;
        if (loaded.scope.raw) { await api<Json>(`/chats/${encodeURIComponent(loaded.scope.id)}/metadata`, 'PATCH', { no_preset: false }); if (!current()) return; loaded.scope.raw = false; rawLabel.hidden = true; }
        const resolved = await effective(loaded.scope);
        if (!current()) return;
        if (resolved.preset_id !== saved.id) throw new Error('binding-not-active');
        promptDirty = prefillDirty = samplersDirty = sourceDirty = nameDirty = false; pendingCreated = copyDraft = false; staged = undefined; renderSource(loaded); scopeInfo.textContent = `Applies to: ${loaded.scope.label}`; presetInfo.textContent = `Currently applied preset: ${saved.name}`;
        const resultMessage = loaded.scope.kind === 'chat' ? 'Saved for this conversation.' : 'Saved for this API configuration. Chats with their own instructions keep them.';
        message(`${resultMessage} Saved as “${saved.name}”. Choose Saved preset to reuse it in another chat.`, 'success');
      } catch (error) {
        if (!current()) return;
        const why = (error as Error).message;
        if (why === 'permission') return;
        message(why === 'unconfirmed-create' ? 'The save could not be confirmed. Reload saved settings and check Saved preset for your prompt name before trying again.' : why === 'conflict' ? 'The native preset changed while you were editing. Your draft is still here. Reload saved settings before trying again.' : why === 'scope-changed' ? 'The active chat or API configuration changed. Reload saved settings before saving.' : why === 'binding-not-active' ? 'The preset was saved, but its native binding could not be verified. Reload saved settings before using it.' : 'Could not finish saving native settings. Your draft is still here; try again.', 'error');
      } finally { saving = false; if (current()) lock(!loaded); }
    }
    function refresh() {
      if (!current() || saving || sourceLoading) return;
      if (promptDirty || prefillDirty || samplersDirty || sourceDirty || nameDirty) {
        advanced.open = true;
        message('API configuration changed. Your unsaved prompt and generation settings are still here. Reload saved settings below before saving to the selected API configuration.', 'warning');
        return;
      }
      void load();
    }
    lock(true); void load();
    return { refresh };
  }
  function destroy() { disposed = true; active?.modal.dismiss(); active = undefined; }
  return { open, mount, destroy };
}
