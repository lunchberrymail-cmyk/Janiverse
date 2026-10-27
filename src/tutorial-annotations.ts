import { uuid } from './uuid';

/** Marker and target positions are percentages of the screenshot itself. */
export type TutorialCallout = { label: string; x: number; y: number; targetX: number; targetY: number };

export function screenshotAnnotations(shot: HTMLElement, callouts: readonly TutorialCallout[]) {
  const valid = callouts.filter(point => point && typeof point.label === 'string' && point.label.trim() &&
    [point.x, point.y, point.targetX, point.targetY].every(value => Number.isFinite(value) && value >= 0 && value <= 100));
  if (!valid.length) return undefined;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.classList.add('jb-tutorial-arrows'); svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS(ns, 'defs'), marker = document.createElementNS(ns, 'marker'), arrow = document.createElementNS(ns, 'path');
  const id = `jb-tutorial-arrow-${uuid()}`;
  for (const [name, value] of Object.entries({ id, markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto', markerUnits: 'strokeWidth' })) marker.setAttribute(name, value);
  arrow.setAttribute('d', 'M0,0 L8,4 L0,8 L2,4 Z'); marker.append(arrow); defs.append(marker); svg.append(defs); shot.append(svg);
  const legend = document.createElement('ol'); legend.className = 'jb-tutorial-callouts'; legend.setAttribute('aria-label', 'Numbered screenshot instructions');
  valid.forEach((point, index) => {
    const x = Math.max(4, Math.min(96, point.x)), y = Math.max(4, Math.min(96, point.y));
    const line = document.createElementNS(ns, 'line');
    for (const [name, value] of Object.entries({ x1: `${x}%`, y1: `${y}%`, x2: `${point.targetX}%`, y2: `${point.targetY}%`, 'marker-end': `url(#${id})` })) line.setAttribute(name, value);
    svg.append(line);
    const badge = document.createElement('span'); badge.className = 'jb-tutorial-number'; badge.textContent = String(index + 1); badge.setAttribute('aria-hidden', 'true');
    Object.assign(badge.style, { left: `${x}%`, top: `${y}%` }); shot.append(badge);
    const item = document.createElement('li'), number = document.createElement('span'), label = document.createElement('span');
    number.className = 'jb-tutorial-callout-number'; number.textContent = String(index + 1); number.setAttribute('aria-hidden', 'true'); label.textContent = point.label;
    item.append(number, label); legend.append(item);
  });
  return legend;
}
