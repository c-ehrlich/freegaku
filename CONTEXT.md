# Freegaku

A browser extension for mining Japanese from video (YouTube, Netflix, YouGlish, 4989) into Anki, and for understanding what is being said.

## Language

### Source material

**Cue**:
One timed subtitle line.
_Avoid_: Line (in code), caption, subtitle

**Transcript**:
The full ordered list of cues for the video currently playing, whether from a site track, Whisper generation, or a 4989 script.
_Avoid_: Subtitles (for the whole list), captions

**Auto-generated transcript**:
A transcript produced by speech recognition (YouTube auto-captions or Whisper generation) rather than written by a person, so it may contain mis-transcriptions.
_Avoid_: ASR track (outside code), auto subs

**Selection**:
Text the learner highlighted within the transcript, spanning one or more cues, with character offsets into the first and last cue.
_Avoid_: Highlight, span

### Mining

**Capture editor**:
The panel opened by "✂ Adjust & add" for tuning a capture's audio range and screenshot frame before it goes into Anki.
_Avoid_: Anki panel, adjust panel

### Explaining

**Explanation**:
An LLM-written answer about why a selection is said the way it is, grounded in the transcript and the video's metadata. Throwaway: it is not stored or added to cards.
_Avoid_: Translation, definition, gloss

**Explain panel**:
The panel opened by "💡 Explain", where the learner can optionally say what they want explained, then read the explanation and ask follow-ups.
_Avoid_: Explain popover, chat

**Follow-up**:
A further question asked in the explain panel that continues the same explanation thread; the thread ends when the panel closes.
