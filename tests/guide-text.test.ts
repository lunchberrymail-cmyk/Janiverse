import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createGuidePointer, findGuideTarget, plainGuideText, setGuideText } from '../src/guide-text';
import { featureTutorials } from '../src/feature-tutorials';

const original = { document: globalThis.document };
let dom: JSDOM;
beforeEach(() => { dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }); globalThis.document = dom.window.document; });
afterEach(() => { dom.window.close(); globalThis.document = original.document; });

/** jsdom has no layout: give a control a box on screen and make it the topmost element there. */
function place(element: Element, box = { left: 40, top: 60, width: 90, height: 28 }) {
  element.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON() {} }) as DOMRect;
  return element;
}

test('labels render as bold accent text without interpreting HTML', () => {
  const target = document.createElement('p');
  const labels = setGuideText(target, 'Expand **Samplers** for <b>temperature</b>, then **Save**.');
  expect(labels).toEqual(['Samplers', 'Save']);
  expect([...target.querySelectorAll('strong.jb-ui-label')].map(node => node.textContent)).toEqual(['Samplers', 'Save']);
  expect(target.textContent).toBe('Expand Samplers for <b>temperature</b>, then Save.');
  expect(target.querySelector('b')).toBeNull();
  expect(plainGuideText('Choose **Refresh models (↻)**.')).toBe('Choose Refresh models (↻).');
});

test('the target is the visible native control named by the label, never the guide itself', () => {
  const guide = document.createElement('section'); guide.innerHTML = '<button>Samplers</button>';
  const hidden = document.createElement('button'); hidden.textContent = 'Samplers';
  const summary = place(document.createElement('summary')); summary.innerHTML = '<svg></svg> Samplers ';
  const refresh = place(document.createElement('button'), { left: 200, top: 60, width: 30, height: 30 }); refresh.setAttribute('aria-label', 'Refresh models');
  place(guide.querySelector('button')!);
  document.body.append(guide, hidden, summary, refresh);
  document.elementFromPoint = (x: number) => (x > 150 ? refresh : summary);
  expect(findGuideTarget(['Samplers'], document, guide)?.element).toBe(summary);
  expect(findGuideTarget(['Refresh models (↻)'], document, guide)?.element).toBe(refresh);
  expect(findGuideTarget(['Missing', 'Refresh models (↻)'], document, guide)?.label).toBe('Refresh models (↻)');
  // Something covering the control (a modal or menu) means there is nothing to point at.
  const modal = document.createElement('div'); document.body.append(modal);
  document.elementFromPoint = () => modal;
  expect(findGuideTarget(['Samplers'], document, guide)).toBeUndefined();
});

test('the ring follows the control, moves on after it is used, and clears with the step', async () => {
  const create = place(document.createElement('button')); create.textContent = 'Create';
  const save = place(document.createElement('button'), { left: 300, top: 60, width: 60, height: 28 }); save.textContent = 'Save';
  document.body.append(create, save);
  document.elementFromPoint = (x: number) => (x > 250 ? save : create);
  const pointer = createGuidePointer();
  pointer.show(['Create', 'Save']);
  const ring = document.querySelector<HTMLElement>('.jb-guide-ring')!;
  expect(ring.getAttribute('aria-hidden')).toBe('true'); expect(ring.style.left).toBe('36px'); expect(ring.style.width).toBe('98px');
  create.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(pointer.target).toBe(save); expect(document.querySelector<HTMLElement>('.jb-guide-ring')!.style.left).toBe('296px');
  pointer.clear();
  expect(document.querySelector('.jb-guide-ring')).toBeNull();
  pointer.show([]); expect(document.querySelector('.jb-guide-ring')).toBeNull();
});

test('text inside a pointer-cursor row counts, sidebar tabs only when the step names the sidebar', () => {
  // Lumiverse's accordion header is a plain div: "Samplers" text beside a count badge.
  const header = place(document.createElement('div')); header.style.cursor = 'pointer';
  header.innerHTML = '<span style="cursor:pointer">Samplers</span><span>2</span>';
  const sidebar = document.createElement('nav'); sidebar.className = '_sidebar_1dabo_401';
  const tab = place(document.createElement('button'), { left: 300, top: 60, width: 55, height: 56 }); tab.innerHTML = '<svg></svg><span>Create</span>';
  const heading = place(document.createElement('h2'), { left: 500, top: 60, width: 90, height: 28 }); heading.textContent = 'Samplers';
  sidebar.append(tab); document.body.append(header, sidebar, heading);
  document.elementFromPoint = (x: number) => (x > 450 ? heading : x > 250 ? tab : header.firstElementChild);
  expect(findGuideTarget(['Samplers'])?.element).toBe(header);
  expect(findGuideTarget(['Create'])).toBeUndefined();
  expect(findGuideTarget(['Create'], document, undefined, true)?.element).toBe(tab);
  const pointer = createGuidePointer(), text = document.createElement('p');
  pointer.write(text, 'Open **Create** in the sidebar.'); expect(pointer.target).toBe(tab);
  pointer.write(text, 'Scroll down and choose **Create**.'); expect(pointer.target).toBeUndefined();
  pointer.clear();
});

test('every guide step keeps its labels balanced', () => {
  for (const tutorial of Object.values(featureTutorials)) for (const scene of tutorial.scenes) {
    expect((scene.instruction.match(/\*\*/g) ?? []).length % 2).toBe(0);
    expect(plainGuideText(scene.instruction)).not.toContain('*');
  }
  expect(featureTutorials.presets.scenes[2].instruction).toContain('**Samplers**');
});
