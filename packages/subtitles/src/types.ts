/** Timing of a single word within a cue (ASR tracks only). Times in ms, absolute. */
export interface WordTiming {
  start: number;
  end: number;
  text: string;
}

/** One subtitle line. Times in ms from video start. */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  /** Present for ASR (auto-generated) tracks with word-level timing. */
  words?: WordTiming[];
}
