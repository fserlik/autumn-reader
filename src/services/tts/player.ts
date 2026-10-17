import { synthesizedAudioUrl } from "./native";
import type { SynthesizedAudio } from "./types";

export interface LocalPlaybackEvents {
  ended(): void;
  error(): void;
  progress?(ratio: number): void;
}

/** Owns exactly one decoded neural-TTS clip and releases it eagerly on stop. */
export class LocalTtsPlayer {
  private audio?: HTMLAudioElement;

  get loaded(): boolean { return Boolean(this.audio); }

  async load(audioData: SynthesizedAudio, events: LocalPlaybackEvents, autoplay = true): Promise<void> {
    this.stop();
    const audio = new Audio(synthesizedAudioUrl(audioData));
    this.audio = audio;
    audio.preload = "auto";
    audio.onended = () => {
      if (this.audio !== audio) return;
      this.audio = undefined;
      events.ended();
    };
    audio.onerror = () => {
      if (this.audio !== audio) return;
      this.audio = undefined;
      events.error();
    };
    audio.ontimeupdate = () => {
      if (this.audio === audio && Number.isFinite(audio.duration) && audio.duration > 0) events.progress?.(audio.currentTime / audio.duration);
    };
    if (autoplay) await audio.play();
  }

  pause(): void { this.audio?.pause(); }
  async resume(): Promise<void> { await this.audio?.play(); }

  stop(): void {
    const audio = this.audio;
    this.audio = undefined;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.ontimeupdate = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}
