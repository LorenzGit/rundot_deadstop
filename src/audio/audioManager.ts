import MUSIC_URL from "./assets/midnight-static.mp3";
/**
 * DEADSTOP audio is fully procedural: dry paper, pen ticks, and gunfire built
 * from filtered noise. The ambient bed is a metronome whose pulse follows the
 * Standstill clock, so the score literally breathes with the player.
 */

export type SoundCue =
    | "ui"
    | "shot_light"
    | "shot_heavy"
    | "shot_far"
    | "dry"
    | "throw"
    | "hit"
    | "down"
    | "pickup"
    | "graze"
    | "blast"
    | "wave"
    | "reward"
    | "defeat";

interface AudioSettings {
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
}

interface CueShape {
    /** Minimum real seconds between repeats. */
    gap: number;
    noise: { from: number; to: number; duration: number; q: number; level: number } | null;
    tone: { from: number; to: number; type: OscillatorType; duration: number; level: number } | null;
}

const CUES: Readonly<Record<SoundCue, CueShape>> = {
    ui: {
        gap: 0.03,
        noise: { from: 2600, to: 1400, duration: 0.045, q: 1.4, level: 0.5 },
        tone: null,
    },
    shot_light: {
        gap: 0.03,
        noise: { from: 3200, to: 420, duration: 0.11, q: 0.9, level: 1 },
        tone: { from: 240, to: 70, type: "triangle", duration: 0.075, level: 0.5 },
    },
    shot_heavy: {
        gap: 0.05,
        noise: { from: 1800, to: 180, duration: 0.24, q: 0.7, level: 1.25 },
        tone: { from: 150, to: 44, type: "triangle", duration: 0.18, level: 0.75 },
    },
    shot_far: {
        gap: 0.04,
        noise: { from: 2100, to: 380, duration: 0.13, q: 1.1, level: 0.5 },
        tone: { from: 190, to: 66, type: "triangle", duration: 0.09, level: 0.28 },
    },
    dry: {
        gap: 0.12,
        noise: { from: 4200, to: 2600, duration: 0.035, q: 2.2, level: 0.55 },
        tone: null,
    },
    throw: {
        gap: 0.08,
        noise: { from: 620, to: 2800, duration: 0.2, q: 3.4, level: 0.6 },
        tone: null,
    },
    hit: {
        gap: 0.035,
        noise: { from: 900, to: 240, duration: 0.09, q: 1.2, level: 0.7 },
        tone: null,
    },
    down: {
        gap: 0.06,
        noise: { from: 1500, to: 220, duration: 0.28, q: 0.8, level: 0.9 },
        tone: { from: 120, to: 52, type: "sawtooth", duration: 0.16, level: 0.35 },
    },
    pickup: {
        gap: 0.05,
        noise: { from: 3000, to: 1800, duration: 0.05, q: 2, level: 0.4 },
        tone: { from: 520, to: 880, type: "triangle", duration: 0.11, level: 0.4 },
    },
    graze: {
        gap: 0.05,
        noise: { from: 5200, to: 3400, duration: 0.05, q: 4, level: 0.35 },
        tone: null,
    },
    blast: {
        gap: 0.1,
        noise: { from: 1100, to: 80, duration: 0.55, q: 0.6, level: 1.5 },
        tone: { from: 96, to: 32, type: "sawtooth", duration: 0.4, level: 0.8 },
    },
    wave: {
        gap: 0.3,
        noise: { from: 1600, to: 3200, duration: 0.3, q: 2.6, level: 0.4 },
        tone: { from: 392, to: 587.33, type: "triangle", duration: 0.34, level: 0.5 },
    },
    reward: {
        gap: 0.25,
        noise: { from: 2400, to: 3600, duration: 0.22, q: 3, level: 0.35 },
        tone: { from: 523.25, to: 1046.5, type: "triangle", duration: 0.36, level: 0.5 },
    },
    defeat: {
        gap: 0.4,
        noise: { from: 900, to: 90, duration: 0.7, q: 0.7, level: 0.9 },
        tone: { from: 196, to: 62, type: "sawtooth", duration: 0.62, level: 0.6 },
    },
};

/**
 * The score is wired to the Standstill clock, exactly as the world is. Standing
 * still pulls the track behind a closed filter and drops it, so a held page
 * sounds like it is heard through a wall; moving opens it back up.
 *
 * Playback rate is deliberately NOT part of this. Varying it on an authored
 * track pitch-shifts the whole mix, which sounds broken rather than tense — the
 * filter and the level carry the whole effect. These are the two ends of that;
 * everything between is interpolated from timeScale.
 */
const MUSIC_LEVEL_STILL = 0.3;
const MUSIC_LEVEL_MOVING = 0.5;
/** Lowpass corner, in Hz: muffled when held, open when running. */
const MUSIC_CUTOFF_STILL = 460;
const MUSIC_CUTOFF_MOVING = 16_000;
/** Seconds of smoothing, so the score breathes rather than steps. */
const MUSIC_GLIDE = 0.22;

class AudioManager {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private musicFilter: BiquadFilterNode | null = null;
    private musicSource: AudioBufferSourceNode | null = null;
    private musicBuffer: AudioBuffer | null = null;
    private musicRequested = false;
    private settings: AudioSettings = {
        musicEnabled: true,
        musicVolume: 0.3,
        sfxEnabled: true,
        sfxVolume: 0.66,
    };
    private unlocked = false;
    private paused = false;
    private tension = 0;
    private readonly lastCueAt = new Map<SoundCue, number>();

    bindUnlock(): void {
        const unlock = (): void => {
            this.unlocked = true;
            const context = this.ensureContext();
            if (context) void context.resume().catch(() => undefined);
            this.syncMusic();
        };
        window.addEventListener("pointerdown", unlock, { once: true, passive: true });
        window.addEventListener("keydown", unlock, { once: true });
    }

    applySettings(settings: AudioSettings): void {
        this.settings = { ...settings };
        this.syncMusic();
    }

    setPaused(paused: boolean): void {
        this.paused = paused;
        const context = this.context;
        if (paused) {
            if (context) void context.suspend().catch(() => undefined);
        } else if (context) {
            void context.resume().catch(() => undefined);
        }
        this.syncMusic();
    }

    /**
     * Feeds the Standstill clock into the score. Movement opens the filter and
     * lifts the level; standing still closes it down to a muffled, quiet
     * version of the same music, at the same tempo.
     */
    setTension(timeScale: number): void {
        this.tension = Math.max(0, Math.min(1, timeScale));
        this.applyMusicTension();
    }

    private applyMusicTension(): void {
        const context = this.context;
        const filter = this.musicFilter;
        const gain = this.musicGain;
        if (!context || !this.musicSource || !filter || !gain) return;
        const t = this.tension;
        const now = context.currentTime;
        const level = this.musicActive() ? MUSIC_LEVEL_STILL + (MUSIC_LEVEL_MOVING - MUSIC_LEVEL_STILL) * t : 0;
        gain.gain.setTargetAtTime(level * this.settings.musicVolume, now, MUSIC_GLIDE);
        // Exponential so the sweep reads as evenly as the ear hears pitch.
        filter.frequency.setTargetAtTime(
            MUSIC_CUTOFF_STILL * (MUSIC_CUTOFF_MOVING / MUSIC_CUTOFF_STILL) ** t,
            now,
            MUSIC_GLIDE,
        );
    }

    play(cue: SoundCue): void {
        if (!this.settings.sfxEnabled || this.paused) return;
        const context = this.ensureContext();
        if (!context || !this.master) return;
        const shape = CUES[cue];
        const now = context.currentTime;
        if (now - (this.lastCueAt.get(cue) ?? -10) < shape.gap) return;
        this.lastCueAt.set(cue, now);
        const volume = this.settings.sfxVolume * 0.32;
        if (shape.noise) {
            this.noise(
                context,
                shape.noise.from,
                shape.noise.to,
                shape.noise.duration,
                shape.noise.q,
                shape.noise.level * volume,
            );
        }
        if (shape.tone) {
            this.tone(
                context,
                shape.tone.from,
                shape.tone.to,
                shape.tone.type,
                shape.tone.duration,
                shape.tone.level * volume,
            );
        }
    }

    destroy(): void {
        this.stopMusic();
        const context = this.context;
        if (context) void context.close().catch(() => undefined);
        this.context = null;
        this.master = null;
        this.musicGain = null;
        this.musicBuffer = null;
        this.musicRequested = false;
        this.noiseBuffer = null;
    }

    private musicActive(): boolean {
        return this.unlocked && !this.paused && this.settings.musicEnabled && this.context !== null;
    }

    private ensureContext(): AudioContext | null {
        if (this.context) return this.context;
        try {
            const context = new AudioContext();
            const master = context.createGain();
            master.gain.value = 1;
            master.connect(context.destination);
            const musicGain = context.createGain();
            musicGain.gain.value = 1;
            musicGain.connect(master);
            this.context = context;
            this.master = master;
            this.musicGain = musicGain;
            return context;
        } catch {
            return null;
        }
    }

    private syncMusic(): void {
        const context = this.ensureContext();
        if (!context) return;
        if (!this.musicActive()) {
            this.applyMusicTension();
            return;
        }
        void this.ensureMusic(context);
        this.applyMusicTension();
    }

    /**
     * Fetches and decodes the score once, then loops it. Music is a nicety, so
     * every failure here is swallowed: a missing or undecodable track leaves
     * the game silent but never blocks the loop or throws into the frame.
     */
    private async ensureMusic(context: AudioContext): Promise<void> {
        if (this.musicSource || this.musicRequested) {
            if (this.musicBuffer && !this.musicSource) this.startMusic(context);
            return;
        }
        this.musicRequested = true;
        try {
            const response = await fetch(MUSIC_URL);
            if (!response.ok) throw new Error(`music ${response.status}`);
            this.musicBuffer = await context.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
            console.warn("[audio] music unavailable", error);
            return;
        }
        if (this.musicActive()) this.startMusic(context);
    }

    private startMusic(context: AudioContext): void {
        const buffer = this.musicBuffer;
        if (!buffer || this.musicSource || !this.musicGain) return;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = MUSIC_CUTOFF_STILL;
        filter.Q.value = 0.6;
        filter.connect(this.musicGain);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(filter);
        // Come up from silence so unlocking never lands as a thump.
        this.musicGain.gain.value = 0;
        source.start();
        this.musicSource = source;
        this.musicFilter = filter;
        this.applyMusicTension();
    }

    private stopMusic(): void {
        const source = this.musicSource;
        this.musicSource = null;
        this.musicFilter = null;
        if (!source) return;
        try {
            source.stop();
        } catch {
            // Already stopped.
        }
    }

    /** A pen tick: the ambient metronome of the page. */
    private ensureNoise(context: AudioContext): AudioBuffer | null {
        if (this.noiseBuffer) return this.noiseBuffer;
        try {
            const length = Math.floor(context.sampleRate * 0.8);
            const buffer = context.createBuffer(1, length, context.sampleRate);
            const data = buffer.getChannelData(0);
            // Deterministic value noise; no Math.random in shipped code paths.
            let state = 0x9e37_79b9;
            for (let index = 0; index < length; index += 1) {
                state = (Math.imul(state, 0x8508_8405) + 0x3c6e_f35f) >>> 0;
                data[index] = (state / 0xffff_ffff) * 2 - 1;
            }
            this.noiseBuffer = buffer;
            return buffer;
        } catch {
            return null;
        }
    }

    private noise(context: AudioContext, from: number, to: number, duration: number, q: number, level: number): void {
        if (!this.master) return;
        const buffer = this.ensureNoise(context);
        if (!buffer) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = Math.max(0.2, q);
        const now = context.currentTime;
        filter.frequency.setValueAtTime(from, now);
        filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + duration);
        const gain = context.createGain();
        const amplitude = Math.max(0.0001, level);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(amplitude, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        source.start(now);
        source.stop(now + duration + 0.03);
    }

    private tone(
        context: AudioContext,
        from: number,
        to: number,
        type: OscillatorType,
        duration: number,
        level: number,
    ): void {
        if (!this.master) return;
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(from, now);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(gain);
        gain.connect(this.master);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.02);
    }
}

export const audioManager = new AudioManager();
