type IconName = 'settings' | 'memory' | 'customize' | 'new-chat' | 'all-chats' | 'prompt' | 'persona' | 'tools' | 'menu' | 'import' | 'arrow' | 'embeddings' | 'extension' | 'camera' | 'lorebook' | 'group' | 'voice' | 'edit' | 'trash' | 'regenerate' | 'continue' | 'message' | 'swipes';
const paths: Record<IconName, string[]> = {
  regenerate: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
  continue: ['M9 10l-5 5 5 5', 'M20 4v7a4 4 0 0 1-4 4H4'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  swipes: ['m8 5-7 7 7 7', 'm16 5 7 7-7 7'],
  edit: ['m16 3 5 5-13 13-6 1 1-6L16 3Z', 'm13 6 5 5'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15', 'M10 10v7M14 10v7'],
  lorebook: ['M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1Z', 'M5 8h4M5 12h4M15 8h4M15 12h4'],
  group: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM16 3.13a4 4 0 0 1 0 7.75'],
  voice: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z', 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
  camera: ['M14.5 4h-5L8 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z', 'M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  embeddings: ['M10 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-9 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', 'm9.7 6.4 4.6 2.2M7.2 8l.6 8m7.4-3.7-5 4.4'],
  extension: ['M8 3H4v6h2a3 3 0 1 1 0 6H4v6h6v-2a3 3 0 1 1 6 0v2h5v-6h-2a3 3 0 1 1 0-6h2V3h-6v2a3 3 0 1 1-6 0V3Z'],
  import: ['M12 15V3m-4 4 4-4 4 4', 'M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  settings: ['m14.7 6.3 3-3a5 5 0 0 1-6.4 6.4l-7.6 7.6a2.1 2.1 0 0 0 3 3l7.6-7.6a5 5 0 0 1 6.4-6.4l-3 3z', 'm3 3 5 5M2 4l2-2 3 2-3 3z'],
  memory: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z', 'M7 3v6h10V3M7 21v-8h10v8'],
  customize: ['M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.2 1.2 0 0 1 .9-2.1H18a3 3 0 0 0 3-3C21 7.3 17 3 12 3Z', 'M7.5 10h.01M10 6.8h.01M14 6.8h.01M17 10h.01'],
  'new-chat': ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z', 'M8 11h.01M12 11h.01M16 11h.01'],
  'all-chats': ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z', 'M8 7h8M8 11h6'],
  prompt: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6M8 13h8M8 17h5'],
  persona: ['M20 21v-2a7 7 0 0 0-14 0v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  tools: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
};
export function icon(name: IconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('jb-menu-icon');
  for (const d of paths[name]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
