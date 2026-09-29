// Web Audio port of the original's SFX.gd / BGM.gd and bus layout:
//   SFX bus  (-10.52 dB, x sfx_volume)   -> Master (x master_volume)
//   BGM bus  (low-pass, x bgm_volume)    -> Master
// Sound effects: random pitch 1 +- range, a per-sound cooldown in physics steps.
// Music: shuffled playlist streamed from music/*.ogg after the game starts.
import * as assets from '../assets';
import { content } from '../data/content';
import type { SfxOptions } from '../ui/ctx';

const dbToGain = (db: number) => Math.pow(10, db / 20);

function dataUrlBuffer(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export interface BgmProfile {
  volume: number;
  lowpassHz: number;
  sec: number;
}

export class GameAudio {
  readonly master: GainNode;
  readonly sfxBus: GainNode;
  readonly bgmBus: GainNode;
  readonly bgmPlayer: GainNode;
  readonly lowpass: BiquadFilterNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private cooldown = new Map<string, number>();
  private voices = 0;
  private music: { order: number[]; current: number; source: AudioBufferSourceNode | null; next: Promise<AudioBuffer> | null } = { order: [], current: -1, source: null, next: null };
  private musicCache = new Map<number, Promise<AudioBuffer>>();
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private rng = Math.random;

  constructor(readonly ctx: AudioContext) {
    const bus = content.audio.buses;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.bgmBus = ctx.createGain();
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    // Godot AudioFilterSW uses resonance 0.5 as a linear Q; Web Audio's lowpass Q is in dB.
    this.lowpass.Q.value = 20 * Math.log10(0.5);
    this.lowpass.frequency.value = bus.bgmLowpassHz;
    this.bgmPlayer = ctx.createGain();
    this.bgmPlayer.gain.value = 0;
    this.bgmPlayer.connect(this.bgmBus);
    this.bgmBus.connect(this.lowpass);
    this.lowpass.connect(this.master);
    this.setVolumes(50, 100, 60);
  }

  async load(): Promise<void> {
    await Promise.all(
      Object.entries(assets.sfx).map(async ([name, urls]) => {
        const bufs = await Promise.all(urls.map((u) => this.ctx.decodeAudioData(dataUrlBuffer(u))));
        this.buffers.set(name, bufs);
      }),
    );
  }

  /** OptionData master/sfx/bgm volume (0-100, linear_to_db(v/100)). */
  setVolumes(master: number, sfx: number, bgm: number): void {
    const bus = content.audio.buses;
    this.master.gain.value = master / 100;
    this.sfxBus.gain.value = dbToGain(bus.sfxDb) * (sfx / 100);
    this.bgmBus.gain.value = dbToGain(bus.bgmDb) * (bgm / 100);
  }

  /** Called once per simulation step (SFX.gd counts cooldowns in physics frames). */
  step(): void {
    for (const [k, v] of this.cooldown) if (v > 0) this.cooldown.set(k, v - 1);
  }

  play(name: string, opts: SfxOptions = {}): void {
    const bufs = this.buffers.get(name);
    if (!bufs || this.ctx.state !== 'running') return;
    if ((this.cooldown.get(name) ?? 0) > 0) return;
    if (this.voices >= content.audio.sfx.voices) return;
    const range = opts.pitchRange ?? content.audio.sfx.defaultPitchRange;
    const src = this.ctx.createBufferSource();
    src.buffer = bufs[Math.floor(this.rng() * bufs.length)];
    src.playbackRate.value = 1 + (opts.pitchOffset ?? 0) + (this.rng() * 2 - 1) * range;
    const g = this.ctx.createGain();
    g.gain.value = dbToGain(opts.volumeDb ?? 0);
    src.connect(g).connect(this.sfxBus);
    this.voices++;
    src.onended = () => this.voices--;
    src.start();
    this.cooldown.set(name, opts.cooldownSteps ?? content.audio.sfx.cooldownSteps);
  }

  /** Looping players used by the ending (Static, VoiceLoop). */
  loop(name: string, volume = 1): GainNode | null {
    const bufs = this.buffers.get(name);
    if (!bufs) return null;
    this.stopLoop(name);
    const src = this.ctx.createBufferSource();
    src.buffer = bufs[0];
    src.loop = content.audio.loops.includes(name);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxBus);
    src.start();
    this.loops.set(name, { src, gain: g });
    return g;
  }

  /** AudioStreamPlayer.volume_db = linear_to_db(v): a linear gain. */
  setLoopVolume(name: string, volume: number): void {
    const l = this.loops.get(name);
    if (l) l.gain.gain.value = volume;
  }

  stopLoop(name: string): void {
    const s = this.loops.get(name)?.src;
    if (s) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
      this.loops.delete(name);
    }
  }

  async playStreamed(name: string): Promise<void> {
    const url = assets.streamed[name];
    if (!url) return;
    try {
      const buf = await this.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.sfxBus);
      src.start();
    } catch {
      // Missing file (e.g. a bare index.html): the ending just has no background noise.
    }
  }

  // ---- music ----------------------------------------------------------------------

  private fetchTrack(i: number): Promise<AudioBuffer> {
    let p = this.musicCache.get(i);
    if (!p) {
      p = fetch(assets.music[i])
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b));
      this.musicCache.set(i, p);
      // Keep at most the current and the next track decoded.
      if (this.musicCache.size > 3) this.musicCache.delete(this.musicCache.keys().next().value!);
    }
    return p;
  }

  /** BGM.pull_song: shuffle the playlist, never starting a new round with the song that just played. */
  private pull(): number {
    if (this.music.order.length === 0) {
      const n = assets.music.length;
      const order = Array.from({ length: n }, (_, i) => i);
      do {
        for (let i = n - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
      } while (n > 1 && order[0] === this.music.current);
      this.music.order = order;
    }
    return this.music.order.shift()!;
  }

  startMusic(): void {
    if (assets.music.length === 0 || this.music.source) return;
    void this.playNext();
  }

  private async playNext(): Promise<void> {
    const i = this.pull();
    this.music.current = i;
    let buf: AudioBuffer;
    try {
      buf = await this.fetchTrack(i);
    } catch {
      return; // Music files not published next to the page: play without music.
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.bgmPlayer);
    src.onended = () => {
      if (this.music.source === src) {
        this.music.source = null;
        void this.playNext();
      }
    };
    this.music.source = src;
    src.start();
    // Prefetch the following track (the next shuffle round is only built when needed).
    const peek = this.music.order[0];
    if (peek !== undefined) void this.fetchTrack(peek).catch(() => {});
  }

  /** BGM.change_settings(volume, low_pass_cutoff, duration). */
  bgm(p: BgmProfile, from?: number): void {
    const now = this.ctx.currentTime;
    const g = this.bgmPlayer.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from ?? g.value, now);
    g.linearRampToValueAtTime(p.volume, now + p.sec);
    const f = this.lowpass.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.linearRampToValueAtTime(p.lowpassHz, now + p.sec);
  }
}
