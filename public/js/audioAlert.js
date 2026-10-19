// Web Audio API Tactical Sound Synthesizer (Zero external audio file dependency)
class TacticalAudioAlert {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.onSirenEnded = null;
  }

  _initContext() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  // User gesture handler to unlock AudioContext if initially suspended
  unlock() {
    this._initContext();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stopSiren();
    }
    return this.isMuted;
  }

  // Tactical alert ping for new high-priority events
  playAlertPing(severity = 'CRITICAL') {
    if (this.isMuted) return;
    try {
      this._initContext();
      if (!this.audioCtx) return;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      const freq = severity === 'CRITICAL' ? 880 : 587.33; // A5 vs D5
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.audioCtx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.2, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }

  // Continuous alarm siren for unresolved critical breaches
  startSiren(durationSec = 8) {
    if (this.isMuted || this.sirenOsc) return;
    try {
      this._initContext();
      if (!this.audioCtx) return;
      this.sirenOsc = this.audioCtx.createOscillator();
      this.sirenGain = this.audioCtx.createGain();

      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.setValueAtTime(650, this.audioCtx.currentTime);

      // Oscillate frequency
      const now = this.audioCtx.currentTime;
      const cycles = Math.ceil(durationSec / 0.8);
      for (let i = 0; i < cycles; i++) {
        this.sirenOsc.frequency.linearRampToValueAtTime(950, now + i * 0.8 + 0.4);
        this.sirenOsc.frequency.linearRampToValueAtTime(650, now + i * 0.8 + 0.8);
      }

      this.sirenGain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.audioCtx.destination);

      this.sirenOsc.start();
      this.sirenOsc.stop(now + durationSec); // Configured duration
      this.sirenOsc.onended = () => {
        this.sirenOsc = null;
        this.sirenGain = null;
        if (typeof this.onSirenEnded === 'function') {
          this.onSirenEnded();
        }
      };
    } catch (e) {
      console.warn('Siren error:', e);
    }
  }

  stopSiren() {
    if (this.sirenOsc) {
      try {
        this.sirenOsc.stop();
      } catch (e) {}
      this.sirenOsc = null;
      this.sirenGain = null;
    }
  }

  isSirenPlaying() {
    return !!this.sirenOsc;
  }
}

window.tacticalAudio = new TacticalAudioAlert();
