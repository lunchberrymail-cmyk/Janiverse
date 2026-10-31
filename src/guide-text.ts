/**
 * Guide text marks on-screen labels as **Label**. They render bold in the accent
 * colour, and a ring points at the matching native control while it is visible.
 */
import { guideLabelNames } from './guide-label-names';

const LABEL = /\*\*([^*]+)\*\*/g;

export function plainGuideText(text: string) { return text.replace(LABEL, '$1'); }

/** Writes guide text as text nodes and bold labels (never HTML) and returns the labels in order. */
export function setGuideText(target: HTMLElement, text: string) {
  const labels: string[] = [], parts: (string | Node)[] = [];
  let last = 0;
  for (const match of text.matchAll(LABEL)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const strong = document.createElement('strong'); strong.className = 'jb-ui-label'; strong.textContent = match[1];
    parts.push(strong); labels.push(match[1]); last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  target.replaceChildren(...parts);
  return labels;
}

/** "Refresh models (↻)" and a button labelled "Refresh models" are the same control. */
export function guideLabelWords(value: string) {
  return value.replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}&@+]+/gu, ' ').trim().toLowerCase();
}

const SIDEBAR = '[class*="_sidebar_"]';
const CONTROLS = 'button, summary, a[href], label, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"]';

function onTop(element: Element) {
  const box = element.getBoundingClientRect(), view = element.ownerDocument.defaultView;
  if (!view || box.width < 4 || box.height < 4 || box.bottom < 0 || box.right < 0 || box.top > view.innerHeight || box.left > view.innerWidth) return false;
  const style = view.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  const x = Math.min(view.innerWidth - 1, Math.max(0, box.left + box.width / 2)), y = Math.min(view.innerHeight - 1, Math.max(0, box.top + box.height / 2));
  // A modal, a menu or the guide itself may cover the control; then the ring would point at the cover.
  const top = element.ownerDocument.elementFromPoint?.(x, y);
  return !top || element === top || element.contains(top) || top.contains(element);
}

/**
 * The clickable element around a matching name: a real control, or else the outermost element with
 * a pointer cursor just above it (Lumiverse's accordion headers are plain divs). Plain text gets none.
 */
function clickable(element: Element) {
  const control = element.closest(CONTROLS);
  if (control) return control;
  const view = element.ownerDocument.defaultView;
  let found: Element | undefined;
  for (let node: Element | null = element, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
    if (view?.getComputedStyle(node).cursor === 'pointer') found = node; else if (found) break;
  }
  return found;
}

/**
 * Finds the visible control named by one of the labels, preferring the earliest, outside the guide itself.
 * A control is named by its aria-label, its title, or a piece of text inside it ("Samplers" beside a
 * count). Lumiverse may be shown in another language, so its translated names count too. A label that
 * matches several visible controls (Save, Next…) gets no ring rather than a guess. Lumiverse's sidebar
 * tabs (one is called Create) only count when the step itself sends you to the sidebar.
 */
export function findGuideTarget(labels: readonly string[], doc: Document = document, guide?: Element, sidebar = false) {
  const names: [string, Element][] = [];
  for (const element of doc.querySelectorAll('[aria-label], [title]')) {
    for (const name of [element.getAttribute('aria-label'), element.getAttribute('title')]) if (name) names.push([guideLabelWords(name), element]);
  }
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    if (text.length <= 80 && /\S/.test(text) && node.parentElement) names.push([guideLabelWords(text), node.parentElement]);
  }
  for (const label of labels) {
    const wanted = new Set([guideLabelWords(label), ...(guideLabelNames[label] ?? [])].filter(Boolean));
    const matches = new Set<Element>();
    for (const [name, element] of names) {
      if (!wanted.has(name) || guide?.contains(element)) continue;
      const control = clickable(element);
      if (control && !guide?.contains(control) && (sidebar || !control.closest(SIDEBAR)) && onTop(control)) matches.add(control);
    }
    // A summary and the button inside it can share a name; they are one control.
    const controls = [...matches].filter(element => ![...matches].some(other => other !== element && element.contains(other)));
    if (controls.length === 1) return { label, element: controls[0] };
  }
  return undefined;
}

export function createGuidePointer(guide?: Element, doc: Document = document) {
  const view = doc.defaultView;
  let labels: string[] = [], sidebar = false, done = new Set<string>(), current: { label: string; element: Element } | undefined;
  let ring: HTMLElement | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const place = () => {
    current = current && current.element.isConnected && onTop(current.element) ? current : findGuideTarget(labels.filter(label => !done.has(label)), doc, guide, sidebar);
    if (!current) { ring?.remove(); ring = undefined; return; }
    if (!ring) { ring = doc.createElement('div'); ring.className = 'jb-guide-ring'; ring.setAttribute('aria-hidden', 'true'); doc.body.append(ring); }
    const box = current.element.getBoundingClientRect();
    Object.assign(ring.style, { left: `${box.left - 4}px`, top: `${box.top - 4}px`, width: `${box.width + 8}px`, height: `${box.height + 8}px` });
  };
  // Once the person uses the control, point at the next label of the step.
  const used = (event: Event) => { if (current && event.target && current.element.contains(event.target as Node)) { done.add(current.label); current = undefined; setTimeout(place, 0); } };
  const stop = () => {
    if (timer !== undefined) clearInterval(timer); timer = undefined; ring?.remove(); ring = undefined; current = undefined;
    doc.removeEventListener('click', used, true); view?.removeEventListener('resize', place); doc.removeEventListener('scroll', place, true);
  };
  return {
    /** Writes a step's text into the guide and points at the controls it names. */
    write(target: HTMLElement, text: string) { this.show(setGuideText(target, text), /\bsidebar\b/i.test(text)); },
    show(next: readonly string[], inSidebar = false) {
      stop(); labels = [...next]; sidebar = inSidebar; done = new Set();
      if (!labels.length || !view) return;
      doc.addEventListener('click', used, true); view.addEventListener('resize', place); doc.addEventListener('scroll', place, true);
      // Native panels open and re-render on their own, so look again a few times a second.
      place(); timer = setInterval(place, 400);
    },
    clear: stop,
    get target() { return current?.element; },
  };
}
