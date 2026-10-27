import { afterEach, beforeEach, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { createTutorialVideo, type TutorialRecording } from '../src/tutorial-video';

let dom: JSDOM, oldDocument: typeof document, loads: number, plays: number, pauses: number;
const recording: TutorialRecording = { src: 'data:video/webm;base64,AAAA', captions: 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:04.000\nChoose your card.\n', chapters: [{ time: 9, title: 'Choose a card file', scene: 1 }] };
beforeEach(() => {
  oldDocument = globalThis.document; dom = new JSDOM('<!doctype html><body></body>'); globalThis.document = dom.window.document; loads = plays = pauses = 0;
  dom.window.HTMLMediaElement.prototype.load = () => { loads++; };
  dom.window.HTMLMediaElement.prototype.play = async () => { plays++; };
  dom.window.HTMLMediaElement.prototype.pause = () => { pauses++; };
});
afterEach(() => { dom.window.close(); globalThis.document = oldDocument; });

test('recordings stay unloaded until requested; chapter seek waits for metadata without playing or opening tools', () => {
  const scenes: number[] = [], player = createTutorialVideo(recording, scene => scenes.push(scene))!;
  document.body.append(player.root); expect(player.video.hidden).toBe(true); expect(player.video.preload).toBe('none'); expect(player.video.hasAttribute('src')).toBe(false); expect(player.video.autoplay).toBe(false); expect(loads).toBe(0);
  player.root.querySelector<HTMLButtonElement>('.jb-tutorial-chapters button')!.click();
  expect(player.video.hidden).toBe(false); expect(scenes).toEqual([1]); expect(plays).toBe(0); expect(loads).toBe(1); expect(player.video.currentTime).toBe(0);
  Object.defineProperty(player.video, 'readyState', { value: 1 }); player.video.dispatchEvent(new dom.window.Event('loadedmetadata')); expect(player.video.currentTime).toBe(9);
  const track = player.video.querySelector('track')!; expect(track.default).toBe(true); expect(track.kind).toBe('captions'); expect(track.srclang).toBe('en'); expect(decodeURIComponent(track.src)).toContain('Choose your card.');
  expect(player.root.querySelector('details')!.textContent).toBe('Video transcriptChoose your card.');
  player.pause(); expect(pauses).toBe(1); player.destroy(); expect(pauses).toBe(2); expect(loads).toBe(2); expect(player.video.hasAttribute('src')).toBe(false); expect(player.video.children).toHaveLength(0);
  player.root.querySelector<HTMLButtonElement>('.jb-tutorial-chapters button')!.click(); expect(scenes).toEqual([1]);
});

test('explicit playback failures keep the transcript and steps usable; disposed media cannot write late status', async () => {
  let reject!: (reason: Error) => void; dom.window.HTMLMediaElement.prototype.play = () => new Promise((_resolve, fail) => { reject = fail; });
  const player = createTutorialVideo(recording, () => {})!; const launch = player.root.querySelector('button')!; launch.click(); expect(launch.hidden).toBe(true);
  player.video.dispatchEvent(new dom.window.Event('error')); expect(player.root.textContent).toContain('Use the transcript and written steps below.');
  const before = player.root.textContent; player.destroy(); reject(new Error('late')); await Promise.resolve(); player.video.dispatchEvent(new dom.window.Event('error')); expect(player.root.textContent).toBe(before);
});

test('only bundled video media is accepted; malformed chapter destinations stay inert', () => {
  for (const src of ['https://example.com/movie.webm', 'javascript:alert(1)', 'data:text/html;base64,AAAA']) expect(createTutorialVideo({ ...recording, src }, () => {})).toBeUndefined();
  const player = createTutorialVideo({ ...recording, chapters: [{ time: NaN, title: 'bad', scene: 0 }, { time: 2, title: 'bad', scene: -1 }] }, () => {})!;
  expect(player.root.querySelectorAll('.jb-tutorial-chapters button')).toHaveLength(0);
});
