import type { SpindleFrontendContext, SpindleModalHandle } from 'lumiverse-spindle-types';

type Options = { openPersonas: () => Promise<boolean>; finishSetup: () => void };
type Session = { modal: SpindleModalHandle; abort: AbortController; closed: boolean };
const handoffKey = 'janiverse:persona-setup-handoff';

/** A user-requested reload refreshes the host's persona cache, including existing lists. */
export function reloadForPersonaSetup(storage: Pick<Storage, 'setItem'>, reload: () => void) {
  storage.setItem(handoffKey, String(Date.now()));
  reload();
}
export function consumePersonaSetupHandoff(storage: Pick<Storage, 'getItem' | 'removeItem'>) {
  const value = storage.getItem(handoffKey);
  if (value === null) return false;
  storage.removeItem(handoffKey);
  const age = Date.now() - Number(value);
  return Number.isFinite(age) && age >= 0 && age < 5 * 60_000;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}

/** A small first-persona guide, saved through Lumiverse's normal persona API. */
export function createPersonaCreate(ctx: SpindleFrontendContext, options: Options) {
  let disposed = false, serial = 0;
  let active: Session | undefined;
  function open() {
    if (disposed) return;
    if (active && !active.closed) { active.modal.root.querySelector<HTMLInputElement>('input')?.focus(); return; }
    const modal = ctx.ui.showModal({ title: 'Create a persona', width: 680, maxHeight: 940 });
    const session: Session = { modal, abort: new AbortController(), closed: false }; active = session;
    const current = () => !disposed && active === session && !session.closed;
    modal.onDismiss(() => { session.closed = true; session.abort.abort(); if (active === session) active = undefined; });
    modal.root.classList.add('jb-settings', 'jb-persona-create');
    const prefix = `jb-persona-${++serial}`;
    let busy = false, permissionAttempted = false, uncertain = false, saved = false;
    const intro = el('div', 'jb-persona-intro');
    intro.append(el('p', 'jb-persona-eyebrow', 'YOU IN THE STORY'), el('h2', '', 'Who will you chat as?'),
      el('p', '', 'A persona tells the AI who you are in the story. The character card is who you talk to; your persona is who you play.'));
    const form = el('form', 'jb-persona-form'); form.noValidate = true; form.id = `${prefix}-form`;
    const fields = el('fieldset', 'jb-persona-fields');
    function field(label: string, name: string, hint: string, multiline = false) {
      const wrap = el('label', 'jb-settings-field');
      const input = multiline ? el('textarea', 'jb-settings-textarea') : el('input', 'jb-settings-input');
      input.name = name; input.id = `${prefix}-${name}`; input.autocomplete = 'off'; wrap.htmlFor = input.id;
      const help = el('small', 'jb-settings-help', hint); help.id = `${input.id}-help`; input.setAttribute('aria-describedby', help.id);
      wrap.append(el('span', 'jb-settings-label', label), input, help);
      input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); sync(); });
      return { wrap, input };
    }
    const name = field('Persona name', 'name', 'The name the AI should call you. It can be a fictional name.');
    name.input.required = true; name.input.maxLength = 200; name.input.placeholder = 'e.g. Alex';
    const description = field('About your persona (optional)', 'description', 'Tell the AI your pronouns, appearance, personality, or background. A few sentences are enough.', true);
    (description.input as HTMLTextAreaElement).rows = 4;
    description.input.maxLength = 10_000; description.input.placeholder = 'Who are you in this story? What should the character know about you?';
    const example = el('aside', 'jb-persona-example'); example.setAttribute('aria-label', 'Persona example');
    const exampleText = (who: string) => `${who} uses they/them pronouns and has short dark hair. They are a curious, quick-witted traveler who asks too many questions and always helps a friend.`;
    example.append(el('strong', '', 'A simple example'), el('p', '', exampleText('Alex')));
    function button(label: string, action: () => void, className = 'jb-button') {
      const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', () => { if (current() && !busy) action(); }); return node;
    }
    const useExample = button('Use example', () => {
      if (saved || uncertain) return;
      if (!name.input.value.trim()) name.input.value = 'Alex';
      if (!description.input.value.trim()) description.input.value = exampleText(name.input.value.trim());
      sync(); description.input.focus();
    }, 'jb-settings-link');
    example.append(useExample, el('small', 'jb-settings-help', 'Fills blank fields. Change anything to make it yours.'));
    fields.append(name.wrap, description.wrap, example, el('p', 'jb-settings-help', 'You can add a portrait and edit more details in Personas later.'));
    const actions = el('div', 'jb-settings-actions');
    const create = el('button', 'jb-button jb-primary', 'Create persona'); create.type = 'submit'; create.setAttribute('form', form.id);
    const cancel = button('Cancel', () => modal.dismiss()); actions.append(cancel, create);
    form.append(fields);
    const status = el('p', 'jb-persona-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    function message(text: string, kind = '') { status.textContent = text; status.dataset.kind = kind; }
    const enable = button('Enable Personas permission', () => { void enablePermission(); }, 'jb-settings-link'); enable.hidden = true;
    const success = el('section', 'jb-persona-success'); success.hidden = true;
    const savedTitle = el('h3', '', 'Your persona is saved'); savedTitle.tabIndex = -1;
    const next = el('p');
    const finish = button('Reload and open Personas', () => {
      if (!saved) return;
      try { options.finishSetup(); }
      catch { message('Your persona is saved. Reload Janiverse, then open Personas from the sidebar to select it.', 'warning'); }
    }, 'jb-button jb-primary');
    const done = button('Done for now', () => modal.dismiss());
    const successActions = el('div', 'jb-settings-actions'); successActions.append(finish, done);
    success.append(savedTitle, next, el('p', 'jb-settings-help', 'A quick reload makes your new persona available throughout Janiverse.'), successActions);
    const manage = button('Open existing personas', () => {
      if (saved || uncertain) return;
      busy = true; sync();
      void Promise.resolve().then(() => current() ? options.openPersonas() : false).then(opened => {
        if (!current()) return;
        if (opened) modal.dismiss(); else message('Open Personas from Lumiverse’s sidebar to manage your personas.', 'warning');
      }).catch(() => { if (current()) message('Could not open Personas. Try its sidebar button.', 'warning'); })
        .finally(() => { if (current()) { busy = false; sync(); } });
    }, 'jb-settings-link');
    const check = button('Reload and check Personas', () => {
      if (!uncertain) return;
      try { options.finishSetup(); }
      catch { message('Reload Janiverse and check Personas before creating this persona again.', 'warning'); }
    }, 'jb-settings-link'); check.hidden = true;
    modal.root.append(intro, form, status, enable, success, manage, check, actions);
    function sync() {
      fields.disabled = busy || saved || uncertain; create.disabled = busy || saved || uncertain;
      cancel.disabled = busy; manage.disabled = busy; enable.disabled = busy;
      useExample.disabled = !!name.input.value.trim() && !!description.input.value.trim();
      form.setAttribute('aria-busy', String(busy));
      form.hidden = saved; actions.hidden = saved; success.hidden = !saved; manage.hidden = saved || uncertain; check.hidden = !uncertain;
      if (saved || uncertain) enable.hidden = true;
    }
    async function permission(request = false) {
      try {
        let granted = await ctx.permissions.getGranted(); if (!current()) return false;
        if (!granted.includes('personas') && request) {
          permissionAttempted = true;
          await ctx.permissions.request(['personas'], { reason: 'Save the persona you create in your Lumiverse library.' });
          if (!current()) return false;
          granted = await ctx.permissions.getGranted(); if (!current()) return false;
        }
        const allowed = granted.includes('personas'); enable.hidden = allowed;
        if (allowed) message('');
        if (!allowed) message('Enable Personas permission to save. Your draft is still here.', 'warning');
        return allowed;
      } catch { if (current()) { enable.hidden = false; message('Personas permission could not be checked. Your draft is still here.', 'warning'); } return false; }
    }
    async function enablePermission() {
      if (!current() || busy || saved || uncertain) return;
      busy = true; sync(); await permission(true); if (current()) { busy = false; sync(); }
    }
    async function submit() {
      if (!current() || busy || saved || uncertain) return;
      const input = { name: name.input.value.trim(), description: description.input.value };
      if (!input.name || input.name.length > 200) { name.input.setAttribute('aria-invalid', 'true'); name.input.focus(); message('Give your persona a name (up to 200 characters).', 'error'); return; }
      if (input.description.length > 10_000) { description.input.setAttribute('aria-invalid', 'true'); description.input.focus(); message('Keep your description under 10,000 characters.', 'error'); return; }
      busy = true; sync(); let sent = false;
      try {
        if (!await permission(!permissionAttempted) || !await permission() || !current()) return;
        sent = true; message('Saving your persona…');
        const response = await fetch('/api/v1/personas', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: session.abort.signal });
        if (!current()) return;
        if (!response.ok) {
          if ([400, 401, 403, 404, 422].includes(response.status)) { message('Your persona could not be saved. Check your name and Personas permission, then try again.', 'error'); return; }
          throw new Error('Unconfirmed save');
        }
        const result = await response.json(); if (!current()) return;
        if (!result || typeof result.id !== 'string' || !result.id) throw new Error('Unconfirmed save');
        saved = true; message('');
        next.textContent = `Select ${input.name} in Personas to chat as them. You can add a portrait or make them your default there.`;
        sync(); savedTitle.focus();
      } catch {
        if (!current()) return;
        if (sent) { uncertain = true; message('The save result could not be confirmed. Reload and check Personas before creating this persona again.', 'warning'); }
        else message('Your persona could not be saved. Your draft is still here.', 'error');
      } finally { if (current()) { busy = false; sync(); } }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void submit(); });
    sync(); name.input.focus();
  }
  return { open, destroy() { disposed = true; active?.modal.dismiss(); active = undefined; } };
}
