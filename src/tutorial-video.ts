export type TutorialRecording = {
  src: string;
  captions: string;
  chapters: readonly { time: number; title: string; scene: number }[];
};

/** Bundled recordings stay offline and load only when the viewer requests playback. */
export function createTutorialVideo(recording: TutorialRecording, onChapter: (scene: number) => void) {
  if (!/^data:video\/(?:webm|mp4);base64,[a-z0-9+/=\r\n]+$/i.test(recording.src)) return undefined;
  const root = document.createElement('section'); root.className = 'jb-tutorial-recording'; root.setAttribute('aria-label', 'Recorded walkthrough');
  const heading = document.createElement('h3'); heading.textContent = 'Watch the walkthrough';
  const hint = document.createElement('p'); hint.textContent = 'Recorded in Lumiverse · English captions · Pause, seek, change speed, or use full screen. Written steps are below.';
  const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.preload = 'none'; video.hidden = true; video.setAttribute('aria-label', 'Recorded walkthrough video');
  const launch = document.createElement('button'); launch.type = 'button'; launch.textContent = 'Watch video';
  const status = document.createElement('p'); status.className = 'jb-tutorial-status'; status.setAttribute('role', 'status');
  const chapters = document.createElement('nav'); chapters.className = 'jb-tutorial-chapters'; chapters.setAttribute('aria-label', 'Video chapters');
  const transcript = document.createElement('details'); transcript.className = 'jb-tutorial-transcript'; const summary = document.createElement('summary'); summary.textContent = 'Video transcript'; transcript.append(summary);
  // Captions use WebVTT; the transcript offers the same guidance without playback.
  const text = document.createElement('p'); text.textContent = recording.captions.replace(/^WEBVTT[^\n]*\n/, '').split('\n').filter(line => line.trim() && !line.includes('-->') && !/^\d+$/.test(line.trim())).join(' '); transcript.append(text);
  let disposed = false, loaded = false, pendingSeek: number | undefined;
  function load() { if (disposed || loaded) return; loaded = true; video.hidden = false; video.preload = 'metadata'; video.src = recording.src; const track = document.createElement('track'); track.kind = 'captions'; track.srclang = 'en'; track.label = 'English'; track.default = true; track.src = `data:text/vtt;charset=utf-8,${encodeURIComponent(recording.captions)}`; video.append(track); launch.hidden = true; video.load(); }
  function seek() { if (disposed || pendingSeek === undefined || video.readyState < 1) return; video.currentTime = pendingSeek; pendingSeek = undefined; }
  video.addEventListener('loadedmetadata', seek);
  video.addEventListener('error', () => { if (!disposed) { status.textContent = 'Video playback is unavailable in this browser. Use the transcript and written steps below.'; launch.hidden = true; } });
  launch.addEventListener('click', () => { if (disposed) return; load(); void video.play().catch(() => { if (!disposed) status.textContent = 'Use the video’s Play control to start playback.'; }); });
  for (const chapter of recording.chapters) {
    if (!Number.isFinite(chapter.time) || chapter.time < 0 || !Number.isInteger(chapter.scene) || chapter.scene < 0) continue;
    const button = document.createElement('button'); button.type = 'button'; const seconds = Math.floor(chapter.time); button.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${chapter.title}`;
    button.addEventListener('click', () => { if (disposed) return; load(); pendingSeek = chapter.time; seek(); onChapter(chapter.scene); }); chapters.append(button);
  }
  root.append(heading, hint, launch, video, status, chapters, transcript);
  return { root, video, pause() { if (loaded && !disposed) video.pause(); }, destroy() { if (disposed) return; if (loaded) video.pause(); disposed = true; video.removeAttribute('src'); video.replaceChildren(); if (loaded) video.load(); } };
}
