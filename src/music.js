const BGM_MAX_GAIN = 0.17;
const LOOKAHEAD_SECONDS = 0.18;
const SCHEDULER_INTERVAL_MS = 90;
const STEPS_PER_BAR = 16;
const SONG_FADE_SECONDS = 0.45;

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

const THEMES = {
  night: {
    bpm: 104,
    leadWave: 'square',
    progression: [
      { bass: 45, notes: [57, 60, 64] },
      { bass: 41, notes: [53, 57, 60] },
      { bass: 48, notes: [55, 60, 64] },
      { bass: 43, notes: [55, 59, 62] },
    ],
    arp: [0, null, 1, null, 2, null, 3, null, 0, null, 1, null, 2, null, 3, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 2, 0, 2, 1, 2, 0, 0, 1, 2, 0, 2, 1, 2],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 12, null],
    bassSteps: 0.9,
    leadDecay: 0.16,
    delaySteps: 3,
    delayWet: 0.28,
    padAttack: 0.5,
    padDetune: 8,
    levels: { kick: 0.95, hat: 0.5, bass: 0.62, lead: 0.42, pad: 0.5 },
  },
  day: {
    bpm: 118,
    leadWave: 'square',
    progression: [
      { bass: 48, notes: [60, 64, 67] },
      { bass: 43, notes: [59, 62, 67] },
      { bass: 45, notes: [57, 60, 64] },
      { bass: 41, notes: [57, 60, 65] },
    ],
    arp: [0, null, 1, 2, null, 3, null, 2, 0, null, 1, 2, null, 3, 4, 2],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2],
    bass: [0, null, 0, null, 7, null, 0, null, 0, null, 0, null, 7, null, 12, null],
    bassSteps: 0.9,
    leadDecay: 0.13,
    delaySteps: 3,
    delayWet: 0.2,
    padAttack: 0.35,
    padDetune: 7,
    levels: { kick: 0.9, hat: 0.55, bass: 0.6, lead: 0.44, pad: 0.42 },
  },
  alpine: {
    bpm: 96,
    leadWave: 'triangle',
    progression: [
      { bass: 38, notes: [62, 64, 69] },
      { bass: 45, notes: [57, 62, 64] },
      { bass: 43, notes: [55, 57, 62] },
      { bass: 40, notes: [59, 64, 66] },
    ],
    arp: [0, null, null, null, 1, null, null, null, 2, null, null, null, 3, null, null, null],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    hat: [0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 0, 1, 0, 2, 0],
    bass: [0, null, null, null, null, null, null, null, 0, null, null, null, null, null, null, null],
    bassSteps: 7,
    leadDecay: 0.34,
    delaySteps: 4,
    delayWet: 0.42,
    padAttack: 0.8,
    padDetune: 11,
    levels: { kick: 0.7, hat: 0.32, bass: 0.5, lead: 0.34, pad: 0.85 },
  },
  canyon: {
    bpm: 112,
    leadWave: 'square',
    progression: [
      { bass: 45, notes: [57, 61, 64, 67] },
      { bass: 38, notes: [57, 60, 62, 66] },
      { bass: 45, notes: [57, 61, 64, 67] },
      { bass: 40, notes: [59, 62, 64, 68] },
    ],
    arp: [0, null, null, 2, null, 1, null, null, 3, null, 2, null, 0, null, 1, 3],
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hat: [1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 2, 2, 2],
    bass: [0, null, 0, null, 7, null, 10, null, 0, null, 0, null, 10, null, 7, null],
    bassSteps: 1.8,
    leadDecay: 0.18,
    delaySteps: 3,
    delayWet: 0.22,
    padAttack: 0.4,
    padDetune: 6,
    levels: { kick: 0.92, hat: 0.45, bass: 0.66, lead: 0.4, pad: 0.38 },
  },
  coast: {
    bpm: 116,
    leadWave: 'triangle',
    progression: [
      { bass: 48, notes: [60, 64, 67, 71] },
      { bass: 45, notes: [57, 60, 64, 67] },
      { bass: 41, notes: [53, 57, 60, 64] },
      { bass: 43, notes: [55, 59, 62, 65] },
    ],
    arp: [null, 0, null, 1, null, 2, null, 3, null, 4, null, 3, null, 2, null, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2],
    bass: [0, null, null, 0, null, null, 0, null, 0, null, null, 0, null, null, 7, null],
    bassSteps: 1.4,
    leadDecay: 0.12,
    delaySteps: 3,
    delayWet: 0.3,
    padAttack: 0.45,
    padDetune: 9,
    levels: { kick: 0.88, hat: 0.5, bass: 0.62, lead: 0.42, pad: 0.45 },
  },
};

export function createMusicSystem(raceAudio) {
  let context = null;
  let masterGain = null;
  let songGain = null;
  let compressor = null;
  let toneFilter = null;
  let mixBus = null;
  let delayNode = null;
  let delayFeedback = null;
  let delaySend = null;
  let noiseBuffer = null;

  let volume = 0.5;
  let enabled = true;
  let intensity = 0;
  let disposed = false;

  let currentTrackId = null;
  let theme = null;
  let schedulerId = null;
  let pendingTimer = null;
  let stepIndex = 0;
  let nextStepTime = 0;

  function ensureGraph() {
    const ctx = raceAudio ? raceAudio.context : null;
    if (!ctx) return false;
    if (context === ctx && masterGain) return true;
    context = ctx;

    masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);

    songGain = context.createGain();
    songGain.gain.value = 0;
    songGain.connect(masterGain);

    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.22;
    compressor.connect(songGain);

    toneFilter = context.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.value = 3000;
    toneFilter.Q.value = 0.8;
    toneFilter.connect(compressor);

    mixBus = context.createGain();
    mixBus.gain.value = 1;
    mixBus.connect(toneFilter);

    delayNode = context.createDelay(1.5);
    delayNode.delayTime.value = 0.32;
    delayFeedback = context.createGain();
    delayFeedback.gain.value = 0.34;
    delaySend = context.createGain();
    delaySend.gain.value = 0.25;
    delaySend.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(mixBus);

    noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 1.2), context.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;

    applyVolume();
    applyIntensity();
    return true;
  }

  function applyVolume() {
    if (!masterGain || !context) return;
    const target = enabled ? BGM_MAX_GAIN * volume : 0;
    masterGain.gain.setTargetAtTime(target, context.currentTime, 0.05);
  }

  function applyIntensity() {
    if (!toneFilter || !context) return;
    const cutoff = 3000 * Math.pow(3, intensity);
    toneFilter.frequency.setTargetAtTime(cutoff, context.currentTime, 0.18);
  }

  function stepSeconds() {
    return 60 / theme.bpm / 4;
  }

  function arpPool(chord) {
    return [...chord.notes, chord.notes[0] + 12, chord.notes[1] + 12];
  }

  function scheduleKick(time, velocity) {
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(velocity, time, 0.004);
    gain.gain.setTargetAtTime(0, time + 0.045, 0.055);
    osc.connect(gain).connect(mixBus);
    osc.onended = () => gain.disconnect();
    osc.start(time);
    osc.stop(time + 0.5);
  }

  function scheduleHat(time, velocity) {
    if (!noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6800;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(velocity, time, 0.0018);
    gain.gain.setTargetAtTime(0, time + 0.014, 0.016);
    source.connect(filter).connect(gain).connect(mixBus);
    source.onended = () => gain.disconnect();
    source.start(time, Math.random() * Math.max(0, noiseBuffer.duration - 0.25));
    source.stop(time + 0.12);
  }

  function scheduleBass(midi, time, duration, velocity) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToFrequency(midi), time);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.setTargetAtTime(340, time + 0.02, 0.09);
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(velocity, time, 0.012);
    gain.gain.setTargetAtTime(0, time + duration, 0.045);
    osc.connect(filter).connect(gain).connect(mixBus);
    osc.onended = () => gain.disconnect();
    osc.start(time);
    osc.stop(time + duration + 0.4);
  }

  function scheduleLead(midi, time, velocity) {
    const osc = context.createOscillator();
    osc.type = theme.leadWave;
    osc.frequency.setValueAtTime(midiToFrequency(midi), time);
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(velocity, time, 0.006);
    gain.gain.setTargetAtTime(0, time + 0.03, theme.leadDecay);
    osc.connect(gain);
    gain.connect(mixBus);
    gain.connect(delaySend);
    osc.onended = () => gain.disconnect();
    osc.start(time);
    osc.stop(time + 0.03 + theme.leadDecay * 7);
  }

  function schedulePad(chord, time) {
    const barSeconds = stepSeconds() * STEPS_PER_BAR;
    const level = theme.levels.pad / (chord.notes.length * 2);
    for (const midi of chord.notes) {
      for (const detune of [-theme.padDetune, theme.padDetune]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(midiToFrequency(midi), time);
        osc.detune.value = detune;
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.gain.setTargetAtTime(level, time, theme.padAttack);
        gain.gain.setTargetAtTime(0, time + barSeconds - 0.12, 0.28);
        osc.connect(gain).connect(mixBus);
        osc.onended = () => gain.disconnect();
        osc.start(time);
        osc.stop(time + barSeconds + 1.6);
      }
    }
  }

  function scheduleStep(index, time) {
    const step = index % STEPS_PER_BAR;
    const bar = Math.floor(index / STEPS_PER_BAR);
    const chord = theme.progression[bar % theme.progression.length];
    const levels = theme.levels;
    if (step === 0) schedulePad(chord, time);
    if (theme.kick[step]) scheduleKick(time, levels.kick);
    const hat = theme.hat[step];
    if (hat === 1 || (hat === 2 && intensity > 0.35) || (hat === 3 && intensity > 0.7)) {
      const accent = step % 4 === 0 ? 1 : 0.72;
      const fill = hat > 1 ? 0.55 + intensity * 0.45 : 1;
      scheduleHat(time, levels.hat * accent * fill);
    }
    const bassOffset = theme.bass[step];
    if (typeof bassOffset === 'number') {
      scheduleBass(chord.bass + bassOffset, time, stepSeconds() * theme.bassSteps, levels.bass);
    }
    const arpIndex = theme.arp[step];
    if (typeof arpIndex === 'number') {
      const pool = arpPool(chord);
      scheduleLead(pool[arpIndex % pool.length], time, levels.lead * (0.82 + intensity * 0.25));
    }
  }

  function schedulerTick() {
    if (!context || !theme) return;
    const now = context.currentTime;
    if (nextStepTime < now - 0.25) nextStepTime = now + 0.05;
    const horizon = now + LOOKAHEAD_SECONDS;
    while (nextStepTime < horizon) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += stepSeconds();
      stepIndex += 1;
    }
  }

  function stopScheduler() {
    if (schedulerId !== null) {
      clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  function clearPending() {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function beginTheme(trackId) {
    theme = THEMES[trackId];
    stepIndex = 0;
    nextStepTime = context.currentTime + 0.08;
    delayNode.delayTime.setTargetAtTime(stepSeconds() * theme.delaySteps, context.currentTime, 0.05);
    delaySend.gain.setTargetAtTime(theme.delayWet, context.currentTime, 0.05);
    songGain.gain.setTargetAtTime(1, context.currentTime, 0.3);
    if (schedulerId === null) schedulerId = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
  }

  function start(trackId) {
    if (disposed) return false;
    if (!ensureGraph()) return false;
    const id = Object.prototype.hasOwnProperty.call(THEMES, trackId) ? trackId : 'night';
    clearPending();
    if (currentTrackId === id && schedulerId !== null) {
      songGain.gain.setTargetAtTime(1, context.currentTime, 0.3);
      return true;
    }
    currentTrackId = id;
    if (!enabled) return true;
    if (schedulerId !== null) {
      songGain.gain.setTargetAtTime(0, context.currentTime, SONG_FADE_SECONDS * 0.3);
      stopScheduler();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (!disposed && enabled && currentTrackId === id) beginTheme(id);
      }, SONG_FADE_SECONDS * 1000);
    } else {
      beginTheme(id);
    }
    return true;
  }

  function stop(fade = true) {
    clearPending();
    currentTrackId = null;
    stopScheduler();
    if (!songGain || !context) return;
    songGain.gain.setTargetAtTime(0, context.currentTime, fade ? 0.4 : 0.012);
  }

  function setVolume(value) {
    volume = clamp01(value);
    applyVolume();
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (disposed) return;
    applyVolume();
    if (!enabled) {
      clearPending();
      stopScheduler();
    } else if (currentTrackId && schedulerId === null && ensureGraph()) {
      beginTheme(currentTrackId);
    }
  }

  function setIntensity(value) {
    intensity = clamp01(value);
    applyIntensity();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearPending();
    stopScheduler();
    theme = null;
    currentTrackId = null;
    if (masterGain && context) {
      masterGain.gain.setTargetAtTime(0, context.currentTime, 0.02);
      const nodes = [mixBus, toneFilter, compressor, songGain, masterGain, delayNode, delayFeedback, delaySend];
      setTimeout(() => {
        for (const node of nodes) {
          try {
            node.disconnect();
          } catch (error) {
            // already disconnected
          }
        }
      }, 250);
    }
  }

  return { start, stop, setVolume, setEnabled, setIntensity, dispose };
}
