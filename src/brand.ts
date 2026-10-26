/** The home identity is extension-owned, so removing Janiverse restores the host header. */
export function createBrand(openHome: () => void) {
  const link = document.createElement('a');
  link.className = 'jb-brand';
  link.href = '/';
  link.setAttribute('aria-label', 'Janiverse Home');

  const ns = 'http://www.w3.org/2000/svg';
  const mark = document.createElementNS(ns, 'svg');
  mark.setAttribute('viewBox', '0 0 40 40');
  mark.setAttribute('width', '34');
  mark.setAttribute('height', '34');
  mark.setAttribute('class', 'jb-brand-icon');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('focusable', 'false');
  for (const [tag, attributes] of [
    ['rect', { x: '1', y: '1', width: '38', height: '38', rx: '11', fill: '#b397d6', stroke: '#dfcaf0', 'stroke-width': '1' }],
    ['path', { d: 'M12 12h9v12a6 6 0 0 1-12 0', fill: 'none', stroke: '#302638', 'stroke-width': '3.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
    ['path', { d: 'm29 6.5 1.6 4.9 4.9 1.6-4.9 1.6-1.6 4.9-1.6-4.9-4.9-1.6 4.9-1.6Z', fill: '#fff3ff' }],
  ] as const) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    mark.append(node);
  }
  const name = document.createElement('h1');
  name.textContent = 'Janiverse';
  link.append(mark, name);
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openHome();
  });
  return link;
}
