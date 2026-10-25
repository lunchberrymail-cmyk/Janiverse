import install from '../assets/tutorials/extensions-install.png';
import models from '../assets/tutorials/hone-models.png';
import input from '../assets/tutorials/hone-input.png';
import toolbar from '../assets/tutorials/hone-toolbar.png';
import type { HoneOptions } from './hone';

/** Actual Hone controls, captured without saving configuration or generating text. */
export const honeScreenshots: HoneOptions['screenshots'] = {
  'hone-install': { src: install, alt: 'Extensions Install from Source with the official Hone repository URL.', highlight: { x: 2, y: 47, w: 96, h: 49 } },
  'hone-models': { src: models, alt: 'Hone Models tab with the built-in Default model profile, which uses Lumiverse’s default connection.', highlight: { x: 33, y: 16, w: 61, h: 15 } },
  'hone-input': { src: input, alt: 'Hone Input tab with Input Single Pass 1.0 selected under Hone Input Preset.', highlight: { x: 41, y: 28, w: 54, h: 21 } },
  'hone-toolbar': { src: toolbar, alt: 'The Hone your draft button immediately beside Home in the native composer toolbar, with an unsent fictional draft.', highlight: { x: 8, y: 4, w: 5, h: 20 } },
};
