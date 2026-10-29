import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { openCharacterChoice } from '../src/character-choice';
import { featureTutorials } from '../src/feature-tutorials';

const original = { document: globalThis.document };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let dom: JSDOM, ctx: any, ran: string[];
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!; }

beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' }); globalThis.document = dom.window.document; ran = [];
  ctx = { ui: { showModal() {
    const node = document.createElement('section'); document.body.append(node); const listeners = new Set<() => void>(); let closed = false;
    return { root: node, onDismiss(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }, dismiss() { if (closed) return; closed = true; listeners.forEach(fn => fn()); node.remove(); } };
  } } };
});
afterEach(() => { dom.window.close(); globalThis.document = original.document; });

test('offers the familiar form first and Lumiverse’s editor with a guide, running nothing until chosen', async () => {
  openCharacterChoice(ctx, { openForm: () => { ran.push('form'); }, openEditor: () => { ran.push('editor'); } });
  const root = document.querySelector('.jb-character-choice')!;
  expect([...root.querySelectorAll('h3')].map(node => node.textContent)).toEqual(['JanitorAI-style form', 'Lumiverse editor, with a guide']);
  expect(ran).toEqual([]);
  button('Use the familiar form').click(); await settle();
  expect(ran).toEqual(['form']); expect(root.isConnected).toBe(false);
  openCharacterChoice(ctx, { openForm: () => { ran.push('form'); }, openEditor: () => { ran.push('editor'); } });
  button('Open with a guide').click(); await settle();
  expect(ran).toEqual(['form', 'editor']); expect(document.querySelector('.jb-character-choice')).toBeNull();
});

test('a failed editor shortcut stays open with a message, and a host error shows its own text', async () => {
  let result: () => Promise<boolean> = async () => false;
  openCharacterChoice(ctx, { openForm: () => {}, openEditor: () => result() });
  const root = document.querySelector('.jb-character-choice')!;
  button('Open with a guide').click(); await settle();
  expect(root.isConnected).toBe(true); expect(root.querySelector('[role=status]')!.textContent).toContain('+ → Create New');
  expect(button('Open with a guide').disabled).toBe(false);
  result = async () => { throw new Error('Permission request denied by user'); };
  button('Open with a guide').click(); await settle();
  expect(root.querySelector('[role=status]')!.textContent).toBe('Permission request denied by user');
});

test('the Lumiverse editor guide maps JanitorAI fields to the native tabs', () => {
  const guide = JSON.stringify(featureTutorials.character);
  for (const text of ['Create New', 'Core Prompts', 'Description', 'Greetings', 'First Message', 'Message Examples', 'Identity', 'Creator Notes', 'save automatically']) expect(guide).toContain(text);
  expect(featureTutorials.character.scenes[0].action?.destination).toEqual({ kind: 'drawer_tab', id: 'characters' });
});
