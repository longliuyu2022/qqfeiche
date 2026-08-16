export const DEFAULT_VOICE_PACK = 'female';

// 播报音色包。键要和 preferences.js 的 VOICE_PACK_OPTIONS 保持一致，
// 每个目录下都是同一套 clip 键名（见 scripts/generate-voice-pack.py）。
export const VOICE_PACKS = Object.freeze({
  female: '/assets/audio/voice-female/',
  classic: '/assets/audio/voice/',
});

export function voicePackBaseUrl(pack) {
  return VOICE_PACKS[pack] || VOICE_PACKS[DEFAULT_VOICE_PACK];
}

export class RaceAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.windSource = null;
    this.windGain = null;
    this.filter = null;
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.voiceGain = null;
    this.voiceEnabled = true;
    this.voiceBaseUrl = voicePackBaseUrl(DEFAULT_VOICE_PACK);
    this.voiceManifest = null;
    this.voiceBuffers = new Map();
    this.voiceData = new Map();
    this.voiceLoading = new Set();
    this.voiceFailed = new Set();
    this.voicePlaying = new Map();
    this._voiceReady = false;
    // 每换一次音色包自增，用来作废上一包的在途请求。
    this._voiceBankToken = 0;
  }

  async start() {
    if (!this.context) this.setup();
    if (this.context.state === 'suspended') await this.context.resume();
    this.ready = true;
    this._decodePendingVoiceData();
  }

  setup() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.32 * this.volume;
    this.master.connect(this.context.destination);

    this.engineOsc = this.context.createOscillator();
    const harmonic = this.context.createWaveShaper();
    harmonic.curve = RaceAudio.distortionCurve(38);
    this.filter = this.context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.8;
    this.engineGain = this.context.createGain();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain.gain.value = 0.035;
    this.engineOsc.connect(harmonic).connect(this.filter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();

    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.985 + white * 0.015;
      samples[i] = previous * 2.1;
    }
    this.windSource = this.context.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 230;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0;
    this.windSource.connect(windFilter).connect(this.windGain).connect(this.master);
    this.windSource.start();
  }

  update(speedKph, throttle, boosting) {
    if (!this.ready || !this.context) return;
    const now = this.context.currentTime;
    const rpm = 48 + Math.min(speedKph, 360) * 1.05 + throttle * 45;
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.055);
    this.filter.frequency.setTargetAtTime(620 + speedKph * 7 + (boosting ? 1100 : 0), now, 0.08);
    this.engineGain.gain.setTargetAtTime(0.027 + throttle * 0.035 + (boosting ? 0.018 : 0), now, 0.07);
    this.windGain.gain.setTargetAtTime(Math.min(0.075, speedKph / 4800) + (boosting ? 0.04 : 0), now, 0.12);
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, Number(value) || 0));
    this._applyMasterGain();
    return this;
  }

  setMuted(muted = true) {
    this.muted = Boolean(muted);
    this._applyMasterGain();
    return this;
  }

  _applyMasterGain() {
    this._applyVoiceGain();
    if (!this.master) return;
    const value = this.muted ? 0 : 0.32 * this.volume;
    if (this.context) this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.025);
    else this.master.gain.value = value;
  }

  tone(frequency, duration = 0.12, volume = 0.12, type = 'sine') {
    if (!this.ready || !this.context) return;
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.35, now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + duration);
  }

  countdown(final = false) {
    this.tone(final ? 820 : 420, final ? 0.28 : 0.11, final ? 0.16 : 0.1, 'square');
  }

  get voiceReady() {
    return this._voiceReady;
  }

  async loadVoiceBank(baseUrl = voicePackBaseUrl(DEFAULT_VOICE_PACK)) {
    const raw = String(baseUrl || voicePackBaseUrl(DEFAULT_VOICE_PACK));
    const base = raw.endsWith('/') ? raw : `${raw}/`;
    // applyPreferences 会被音量滑杆的 input 事件连续触发，同一个包必须原地返回，
    // 否则拖一次音量就会把 manifest 和 13 条音频重新拉一遍。
    if (base === this.voiceBaseUrl && (this._voiceReady || this.voiceLoading.size)) return this._voiceReady;
    if (base !== this.voiceBaseUrl) this._resetVoiceBank();
    this.voiceBaseUrl = base;
    const token = (this._voiceBankToken += 1);
    try {
      const response = await fetch(`${base}manifest.json`);
      if (!response.ok) return false;
      const manifest = await response.json();
      const clips = manifest && manifest.clips && typeof manifest.clips === 'object' ? manifest.clips : null;
      if (!clips) return false;
      // 拉取期间玩家又切了音色，这份结果已经过期。
      if (token !== this._voiceBankToken) return false;
      this.voiceManifest = clips;
      this._voiceReady = true;
      for (const name of Object.keys(clips)) this._loadVoiceClip(name, token);
      return true;
    } catch (error) {
      return false;
    }
  }

  // 切包时清空所有解码缓存：clip 键名两包相同，留着旧 buffer 会串音。
  _resetVoiceBank() {
    if (this.context) {
      const now = this.context.currentTime;
      for (const name of [...this.voicePlaying.keys()]) this._stopVoicePlayback(name, now);
    }
    this.voiceManifest = null;
    this._voiceReady = false;
    this.voiceBuffers.clear();
    this.voiceData.clear();
    this.voiceFailed.clear();
    this.voiceLoading.clear();
  }

  voice(name, { volume = 1 } = {}) {
    if (!this.voiceEnabled || !this._voiceReady || !this.ready || !this.context) return false;
    const buffer = this.voiceBuffers.get(name);
    if (!buffer) {
      this._loadVoiceClip(name);
      return false;
    }
    this._ensureVoiceGain();
    if (!this.voiceGain) return false;
    const now = this.context.currentTime;
    this._stopVoicePlayback(name, now);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const gain = this.context.createGain();
    gain.gain.value = Math.min(2, Math.max(0, Number(volume) || 0));
    source.connect(gain).connect(this.voiceGain);
    const active = { source, gain };
    this.voicePlaying.set(name, active);
    source.onended = () => {
      if (this.voicePlaying.get(name) === active) this.voicePlaying.delete(name);
      gain.disconnect();
    };
    source.start(now);
    return true;
  }

  setVoiceEnabled(enabled = true) {
    this.voiceEnabled = Boolean(enabled);
    this._applyVoiceGain();
    if (!this.voiceEnabled && this.context) {
      const now = this.context.currentTime;
      for (const name of [...this.voicePlaying.keys()]) this._stopVoicePlayback(name, now);
    }
    return this;
  }

  _stopVoicePlayback(name, now) {
    const active = this.voicePlaying.get(name);
    if (!active) return;
    active.gain.gain.setTargetAtTime(0, now, 0.012);
    try {
      active.source.stop(now + 0.06);
    } catch (error) {
      // already stopped
    }
    this.voicePlaying.delete(name);
  }

  _ensureVoiceGain() {
    if (!this.context || this.voiceGain) return;
    this.voiceGain = this.context.createGain();
    this.voiceGain.gain.value = this.muted || !this.voiceEnabled ? 0 : 0.9 * this.volume;
    this.voiceGain.connect(this.context.destination);
  }

  _applyVoiceGain() {
    if (!this.voiceGain || !this.context) return;
    const value = this.muted || !this.voiceEnabled ? 0 : 0.9 * this.volume;
    this.voiceGain.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }

  _decodePendingVoiceData() {
    if (!this.context || !this.voiceData.size) return;
    for (const name of [...this.voiceData.keys()]) this._loadVoiceClip(name);
  }

  async _loadVoiceClip(name, token = this._voiceBankToken) {
    if (this.voiceBuffers.has(name)) return this.voiceBuffers.get(name);
    const entry = this.voiceManifest ? this.voiceManifest[name] : null;
    if (!entry || !entry.file || this.voiceFailed.has(name) || this.voiceLoading.has(name)) return null;
    // 整个流程都用发起时的 base 和 token：中途换包的话这份结果一律丢弃，
    // 否则旧音色的音频会被写进新包的缓存。
    const base = this.voiceBaseUrl;
    this.voiceLoading.add(name);
    try {
      if (!this.voiceData.has(name)) {
        const response = await fetch(base + entry.file);
        if (token !== this._voiceBankToken) return null;
        if (!response.ok) {
          this.voiceFailed.add(name);
          return null;
        }
        const encoded = await response.arrayBuffer();
        if (token !== this._voiceBankToken) return null;
        this.voiceData.set(name, encoded);
      }
      if (!this.context) return null;
      try {
        const pending = this.voiceData.get(name);
        if (!pending) return null;
        const buffer = await this.context.decodeAudioData(pending.slice(0));
        if (token !== this._voiceBankToken) return null;
        this.voiceBuffers.set(name, buffer);
        this.voiceData.delete(name);
        return buffer;
      } catch (error) {
        if (token === this._voiceBankToken) {
          this.voiceFailed.add(name);
          this.voiceData.delete(name);
        }
        return null;
      }
    } catch (error) {
      return null;
    } finally {
      // 换过包的话 _resetVoiceBank 已经清过表，再删会误伤新包同名 clip 的在途标记。
      if (token === this._voiceBankToken) this.voiceLoading.delete(name);
    }
  }

  static distortionCurve(amount) {
    const curve = new Float32Array(256);
    const deg = Math.PI / 180;
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / curve.length - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }
}
