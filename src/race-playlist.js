import { createMusicSystem } from './music.js';

const DEFAULT_MANIFEST_URL = '/assets/audio/music/manifest.json';

function normalizeTracks(manifest, manifestUrl) {
  const source = Array.isArray(manifest) ? manifest : manifest?.tracks;
  if (!Array.isArray(source)) return [];
  return source.flatMap((entry) => {
    const file = typeof entry === 'string' ? entry : entry?.file;
    if (typeof file !== 'string' || !file.trim()) return [];
    return [{
      file: new URL(file, new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/')).href,
      title: typeof entry?.title === 'string' ? entry.title : file,
    }];
  });
}

export function createRacePlaylist(raceAudio, options = {}) {
  const fallback = createMusicSystem(raceAudio);
  const manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL;
  const random = options.random ?? Math.random;
  let audio = null;
  let tracks = null;
  let loading = null;
  let activeToken = 0;
  let previousIndex = -1;
  let currentTrackId = null;
  let volume = 0.5;
  let enabled = true;
  let disposed = false;

  function ensureAudio() {
    if (audio || typeof globalThis.Audio !== 'function') return audio;
    audio = new globalThis.Audio();
    audio.preload = 'auto';
    audio.loop = true;
    audio.playsInline = true;
    audio.volume = volume;
    return audio;
  }

  async function loadTracks() {
    if (tracks) return tracks;
    if (loading) return loading;
    loading = fetch(manifestUrl, { cache: 'no-cache' })
      .then((response) => response.ok ? response.json() : null)
      .then((manifest) => normalizeTracks(manifest, manifestUrl))
      .catch(() => [])
      .then((loaded) => {
        tracks = loaded;
        return loaded;
      });
    return loading;
  }

  function chooseTrack(list) {
    if (list.length === 1) return 0;
    let index = Math.min(list.length - 1, Math.floor(random() * list.length));
    if (index === previousIndex) index = (index + 1) % list.length;
    previousIndex = index;
    return index;
  }

  async function start(trackId) {
    if (disposed) return false;
    currentTrackId = trackId;
    const token = ++activeToken;
    const list = await loadTracks();
    if (disposed || token !== activeToken || currentTrackId !== trackId) return false;
    const player = ensureAudio();
    if (!enabled || !player || list.length === 0) return fallback.start(trackId);
    const selected = list[chooseTrack(list)];
    fallback.stop(false);
    player.pause();
    player.src = selected.file;
    player.volume = volume;
    player.currentTime = 0;
    try {
      await player.play();
      return true;
    } catch {
      if (token === activeToken) fallback.start(trackId);
      return false;
    }
  }

  function stop(fade = true) {
    activeToken += 1;
    currentTrackId = null;
    if (audio) {
      audio.pause();
      try { audio.currentTime = 0; } catch { /* media metadata may not be loaded */ }
    }
    fallback.stop(fade);
  }

  function setVolume(value) {
    const number = Number(value);
    volume = Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
    if (audio) audio.volume = volume;
    fallback.setVolume(volume);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    fallback.setEnabled(enabled);
    if (!enabled) {
      audio?.pause();
    } else if (audio?.src && currentTrackId) {
      audio.play().catch(() => fallback.start(currentTrackId));
    }
  }

  function setIntensity(value) {
    fallback.setIntensity(value);
  }

  function resume() {
    if (!enabled || !currentTrackId || !audio?.src || !audio.paused) return false;
    audio.play().then(() => fallback.stop()).catch(() => {});
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop(false);
    if (audio) {
      audio.removeAttribute('src');
      audio.load();
    }
    fallback.dispose();
  }

  void loadTracks();
  return { start, stop, resume, setVolume, setEnabled, setIntensity, dispose, loadTracks };
}

export { normalizeTracks };
