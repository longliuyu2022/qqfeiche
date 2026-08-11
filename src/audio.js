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
  }

  async start() {
    if (!this.context) this.setup();
    if (this.context.state === 'suspended') await this.context.resume();
    this.ready = true;
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
